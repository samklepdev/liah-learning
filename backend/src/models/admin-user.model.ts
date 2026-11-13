import { and, count, desc, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { PAGE_SIZE } from '../lib/pagination.ts';
import { deleteSessionsForUser } from './session.model.ts';
import { users } from './schema.ts';
import type { PublicUser } from './user.model.ts';

const publicColumns = {
  id: users.id,
  username: users.username,
  firstName: users.firstName,
  lastName: users.lastName,
  role: users.role,
  mustChangePassword: users.mustChangePassword,
  createdAt: users.createdAt,
  isActive: users.isActive,
  deletedAt: users.deletedAt,
};

export async function listUsers(page: number): Promise<PublicUser[]> {
  return db
    .select(publicColumns)
    .from(users)
    .where(eq(users.isActive, true))
    .orderBy(users.createdAt)
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);
}

export async function countUsers(): Promise<number> {
  const [row] = await db.select({ value: count() }).from(users).where(eq(users.isActive, true));
  return Number(row?.value ?? 0);
}

export async function findUserById(
  id: string,
): Promise<(PublicUser & { isActive: boolean; deletedAt: Date | null }) | null> {
  const [row] = await db.select(publicColumns).from(users).where(eq(users.id, id)).limit(1);
  return row ?? null;
}

export async function setUserRole(
  id: string,
  role: 'user' | 'admin',
): Promise<PublicUser | null> {
  const [row] = await db
    .update(users)
    .set({ role })
    .where(eq(users.id, id))
    .returning(publicColumns);
  return row ?? null;
}

/**
 * Soft delete: marks the user inactive and kills every one of their
 * sessions. Only rows that are currently active can be deleted, so deleting
 * an already-deleted user 404s instead of silently no-op-ing. True if a row
 * was deactivated.
 */
export async function deleteUserById(id: string): Promise<boolean> {
  const result = await db
    .update(users)
    .set({ isActive: false, deletedAt: new Date() })
    .where(and(eq(users.id, id), eq(users.isActive, true)))
    .returning({ id: users.id });

  if (result.length === 0) return false;
  await deleteSessionsForUser(id);
  return true;
}

export async function listDeletedUsers(page: number): Promise<PublicUser[]> {
  return db
    .select(publicColumns)
    .from(users)
    .where(eq(users.isActive, false))
    .orderBy(desc(users.deletedAt))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);
}

export async function countDeletedUsers(): Promise<number> {
  const [row] = await db.select({ value: count() }).from(users).where(eq(users.isActive, false));
  return Number(row?.value ?? 0);
}

/** Restore: only rows that are currently inactive can be restored. */
export async function restoreUserById(id: string): Promise<PublicUser | null> {
  const [row] = await db
    .update(users)
    .set({ isActive: true, deletedAt: null })
    .where(and(eq(users.id, id), eq(users.isActive, false)))
    .returning(publicColumns);
  return row ?? null;
}
