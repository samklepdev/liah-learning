import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, lt } from 'drizzle-orm';
import type { CookieOptions, Response } from 'express';
import { db } from '../db/index.ts';
import { sessions, users, type User } from '../db/schema.ts';
import { env, isProd } from '../env.ts';

export const SESSION_COOKIE = 'sid';

const TTL_MS = env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;

/**
 * The cookie holds a random token; the database holds only its SHA-256. Lookup
 * hashes the incoming token, so the stored value is useless to an attacker.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    // Dev is plain http://localhost, so `secure` would stop the cookie being set.
    secure: isProd,
    // 'lax' still sends the cookie on top-level navigation but not on
    // cross-site POSTs, which is most of our CSRF surface covered.
    // Cross-origin deployments need 'none' + secure.
    sameSite: env.CORS_ORIGIN ? 'none' : 'lax',
    path: '/',
    maxAge: TTL_MS,
  };
}

/** Issues a fresh session and sets the cookie. Call on login AND register. */
export async function createSession(res: Response, userId: string): Promise<void> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + TTL_MS);

  await db.insert(sessions).values({ id: hashToken(token), userId, expiresAt });

  res.cookie(SESSION_COOKIE, token, cookieOptions());
}

export type SessionUser = Pick<User, 'id' | 'email' | 'createdAt'>;

/** Resolves a cookie token to its user, or null if missing/expired/unknown. */
export async function resolveSession(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;

  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      createdAt: users.createdAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);

  return row ?? null;
}

export async function destroySession(res: Response, token: string | undefined): Promise<void> {
  if (token) {
    await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
  }
  // Must match the attributes the cookie was set with, or the browser keeps it.
  res.clearCookie(SESSION_COOKIE, { ...cookieOptions(), maxAge: undefined });
}

/** Invalidate every session for a user — use after a password change. */
export async function destroyAllSessionsForUser(userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

/** Housekeeping: expired rows are harmless but accumulate. */
export async function deleteExpiredSessions(): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}

/** Constant-time compare for CSRF-style token checks. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
