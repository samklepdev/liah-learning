import argon2 from 'argon2';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  clearSessionCookieOptions,
  sessionCookieOptions,
} from '../lib/cookies.ts';
import { generateToken, hashToken } from '../lib/tokens.ts';
import { deleteSession, insertSession } from '../models/session.model.ts';
import { createUser, findUserByEmailWithHash } from '../models/user.model.ts';

const credentials = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(8, 'Password must be at least 8 characters').max(256),
});

/**
 * A valid argon2 hash of a throwaway value. Verified against when no user
 * matches, so a wrong email and a wrong password take the same time and
 * attackers can't enumerate accounts from response latency.
 */
const DUMMY_HASH = await argon2.hash('timing-equalizer-not-a-real-password');

/** Issues a fresh session and sets the cookie. Used by register AND login. */
async function startSession(res: Response, userId: string): Promise<void> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await insertSession(hashToken(token), userId, expiresAt);

  res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
}

/**
 * Registers a new user and starts a session for them.
 * @param req
 * @param res
 */
export async function register(req: Request, res: Response): Promise<void> {
  const parsed = credentials.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: z.prettifyError(parsed.error) });
    return;
  }
  const { email, password } = parsed.data;

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const user = await createUser(email, passwordHash);

  if (!user) {
    res.status(409).json({ error: 'That email is already registered' });
    return;
  }

  await startSession(res, user.id);
  res.status(201).json({ user });
}

/**
 * Logs in an existing user and starts a session for them.
 * @param req
 * @param res
 */
export async function login(req: Request, res: Response): Promise<void> {
  const parsed = credentials.safeParse(req.body);
  if (!parsed.success) {
    // Deliberately vague: don't reveal which field failed on a login attempt.
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }
  const { email, password } = parsed.data;

  const existing = await findUserByEmailWithHash(email);
  const ok = await argon2.verify(existing?.passwordHash ?? DUMMY_HASH, password);

  if (!existing || !ok) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  // Fresh session on every login — prevents session fixation.
  await startSession(res, existing.id);
  res.json({
    user: { id: existing.id, email: existing.email, createdAt: existing.createdAt },
  });
}

/**
 * Logs out the current user and invalidates their session.
 * @param req
 * @param res
 */
export async function logout(req: Request, res: Response): Promise<void> {
  const token: unknown = req.cookies?.[SESSION_COOKIE];
  if (typeof token === 'string') {
    await deleteSession(hashToken(token));
  }
  res.clearCookie(SESSION_COOKIE, clearSessionCookieOptions());
  res.status(204).end();
}

export function me(req: Request, res: Response): void {
  res.json({ user: req.user });
}
