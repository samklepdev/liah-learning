import { desc, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { passwordResetRequests, users } from './schema.ts';

export type PendingPasswordResetRequest = {
  userId: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
  requestedAt: Date;
};

/** Upserts a pending request for this user — a repeat request just bumps
 *  requestedAt rather than creating a second row (userId is unique). */
export async function upsertPasswordResetRequest(userId: string): Promise<void> {
  await db
    .insert(passwordResetRequests)
    .values({ userId })
    .onConflictDoUpdate({
      target: passwordResetRequests.userId,
      set: { requestedAt: new Date() },
    });
}

/** All pending requests, joined to the user, newest first. */
export async function listPasswordResetRequests(): Promise<PendingPasswordResetRequest[]> {
  return db
    .select({
      userId: passwordResetRequests.userId,
      username: users.username,
      firstName: users.firstName,
      lastName: users.lastName,
      requestedAt: passwordResetRequests.requestedAt,
    })
    .from(passwordResetRequests)
    .innerJoin(users, eq(users.id, passwordResetRequests.userId))
    .orderBy(desc(passwordResetRequests.requestedAt));
}

/** No-op if there's no pending request for this user. */
export async function deletePasswordResetRequest(userId: string): Promise<void> {
  await db.delete(passwordResetRequests).where(eq(passwordResetRequests.userId, userId));
}
