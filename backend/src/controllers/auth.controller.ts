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
import { deleteSession, deleteSessionsForUser, insertSession } from '../models/session.model.ts';
import {
  createUser,
  findUserByUsernameWithHash,
  findUserByIdWithHash,
  updatePasswordHash,
  updateName,
  clearMustChangePassword,
} from '../models/user.model.ts';

const registerBody = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(100),
  lastName: z.string().trim().min(1, 'Last name is required').max(100),
  password: z.string().min(8, 'Password must be at least 8 characters').max(256),
});

const loginBody = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1).max(256),
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
  const parsed = registerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: z.prettifyError(parsed.error) });
    return;
  }
  const { firstName, lastName, password } = parsed.data;

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const user = await createUser(firstName, lastName, passwordHash, 'user', false);

  await startSession(res, user.id);
  res.status(201).json({ user });
}

/**
 * Logs in an existing user and starts a session for them.
 * @param req
 * @param res
 */
export async function login(req: Request, res: Response): Promise<void> {
  const parsed = loginBody.safeParse(req.body);
  if (!parsed.success) {
    // Deliberately vague: don't reveal which field failed on a login attempt.
    res.status(401).json({ error: 'Invalid username or password' });
    return;
  }
  const { username, password } = parsed.data;

  const existing = await findUserByUsernameWithHash(username);
  const ok = await argon2.verify(existing?.passwordHash ?? DUMMY_HASH, password);

  if (!existing || !ok) {
    res.status(401).json({ error: 'Invalid username or password' });
    return;
  }

  // Fresh session on every login — prevents session fixation.
  await startSession(res, existing.id);
  const { passwordHash: _passwordHash, ...user } = existing;
  res.json({ user });
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

const changePasswordBody = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: registerBody.shape.password,
});

/**
 * Changes the signed-in user's password. Requires the current password.
 * Revokes every other session for this user, then issues a fresh session for
 * the current request so this device stays signed in.
 * @param req
 * @param res
 */
export async function changePassword(req: Request, res: Response): Promise<void> {
  const parsed = changePasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: z.prettifyError(parsed.error) });
    return;
  }
  const { currentPassword, newPassword } = parsed.data;

  const existing = await findUserByIdWithHash(req.user!.id);
  const ok = existing ? await argon2.verify(existing.passwordHash, currentPassword) : false;

  if (!existing || !ok) {
    res.status(401).json({ error: 'Current password is incorrect' });
    return;
  }

  const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
  await updatePasswordHash(existing.id, passwordHash);
  await clearMustChangePassword(existing.id);

  await deleteSessionsForUser(existing.id);
  await startSession(res, existing.id);

  res.status(204).end();
}

export function me(req: Request, res: Response): void {
  res.json({ user: req.user });
}

const nameBody = z.object({
  firstName: z.string().trim().max(100).optional(),
  lastName: z.string().trim().max(100).optional(),
});

/**
 * Updates the signed-in user's first/last name. This is a true partial
 * update: a field omitted from the body is left untouched, while a field
 * present but blank clears that name — unlike the import flow's validation,
 * this is an edit surface where un-setting a name back to blank is a
 * legitimate action.
 * @param req
 * @param res
 */
export async function updateNameHandler(req: Request, res: Response): Promise<void> {
  const parsed = nameBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: z.prettifyError(parsed.error) });
    return;
  }

  const updates: { firstName?: string | null; lastName?: string | null } = {};
  if ('firstName' in parsed.data) {
    updates.firstName = parsed.data.firstName === '' ? null : parsed.data.firstName;
  }
  if ('lastName' in parsed.data) {
    updates.lastName = parsed.data.lastName === '' ? null : parsed.data.lastName;
  }

  const user = await updateName(req.user!.id, updates);
  if (!user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  res.json({ user });
}
