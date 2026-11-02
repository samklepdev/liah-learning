import argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.ts';
import { users } from '../db/schema.ts';
import { requireAuth } from './middleware.ts';
import { SESSION_COOKIE, createSession, destroySession } from './sessions.ts';

export const authRouter = Router();

const credentials = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(12, 'Password must be at least 12 characters').max(256),
});

/**
 * A valid argon2 hash of a throwaway value. Verified against when no user
 * matches, so a wrong email and a wrong password take the same time and
 * attackers can't enumerate accounts from response latency.
 */
const DUMMY_HASH = await argon2.hash('timing-equalizer-not-a-real-password');

authRouter.post('/register', async (req, res) => {
  const parsed = credentials.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: z.prettifyError(parsed.error) });
    return;
  }
  const { email, password } = parsed.data;

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  const [user] = await db
    .insert(users)
    .values({ email, passwordHash })
    .onConflictDoNothing({ target: users.email })
    .returning({ id: users.id, email: users.email, createdAt: users.createdAt });

  if (!user) {
    res.status(409).json({ error: 'That email is already registered' });
    return;
  }

  await createSession(res, user.id);
  res.status(201).json({ user });
});

authRouter.post('/login', async (req, res) => {
  const parsed = credentials.safeParse(req.body);
  if (!parsed.success) {
    // Deliberately vague: don't reveal which field failed on a login attempt.
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }
  const { email, password } = parsed.data;

  const [existing] = await db
    .select({
      id: users.id,
      email: users.email,
      createdAt: users.createdAt,
      passwordHash: users.passwordHash,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  const ok = await argon2.verify(existing?.passwordHash ?? DUMMY_HASH, password);

  if (!existing || !ok) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  // Fresh session on every login — prevents session fixation.
  await createSession(res, existing.id);
  res.json({ user: { id: existing.id, email: existing.email, createdAt: existing.createdAt } });
});

authRouter.post('/logout', async (req, res) => {
  await destroySession(res, req.cookies?.[SESSION_COOKIE]);
  res.status(204).end();
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});
