import { and, eq, gt, lt } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { sessions, users } from './schema.ts';
import type { PublicUser } from './user.model.ts';

/** `id` is the hashed token — see lib/tokens.ts. */
export async function insertSession(
  id: string,
  userId: string,
  expiresAt: Date,
): Promise<void> {
  await db.insert(sessions).values({ id, userId, expiresAt });
}

/** Resolves a session id to its user, or null if expired or unknown. */
export async function findUserBySessionId(id: string): Promise<PublicUser | null> {
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      createdAt: users.createdAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())))
    .limit(1);

  return row ?? null;
}

export async function deleteSession(id: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, id));
}

/** Invalidate every session for a user — use after a password change. */
export async function deleteSessionsForUser(userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

/** Housekeeping: expired rows are harmless but accumulate. Nothing calls this
 *  on a schedule yet. */
export async function deleteExpiredSessions(): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}
