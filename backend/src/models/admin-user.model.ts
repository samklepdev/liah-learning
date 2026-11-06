import { count, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { PAGE_SIZE } from '../lib/pagination.ts';
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
};

export async function listUsers(page: number): Promise<PublicUser[]> {
  return db
    .select(publicColumns)
    .from(users)
    .orderBy(users.createdAt)
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);
}

export async function countUsers(): Promise<number> {
  const [row] = await db.select({ value: count() }).from(users);
  return Number(row?.value ?? 0);
}

export async function findUserById(id: string): Promise<PublicUser | null> {
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

/** True if a row was deleted. */
export async function deleteUserById(id: string): Promise<boolean> {
  const result = await db.delete(users).where(eq(users.id, id)).returning({ id: users.id });
  return result.length > 0;
}
