import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { users, type User } from './schema.ts';

/** The user shape that is safe to send to a client — never the password hash. */
export type PublicUser = Pick<User, 'id' | 'email' | 'firstName' | 'lastName' | 'role' | 'createdAt'>;

const publicColumns = {
  id: users.id,
  email: users.email,
  firstName: users.firstName,
  lastName: users.lastName,
  role: users.role,
  createdAt: users.createdAt,
};

/** Returns null when the email is already registered. */
export async function createUser(
  email: string,
  passwordHash: string,
  firstName?: string | null,
  lastName?: string | null,
  role?: 'user' | 'admin',
): Promise<PublicUser | null> {
  const [user] = await db
    .insert(users)
    .values({
      email,
      passwordHash,
      firstName: firstName ?? null,
      lastName: lastName ?? null,
      role: role ?? 'user',
    })
    .onConflictDoNothing({ target: users.email })
    .returning(publicColumns);

  return user ?? null;
}

/**
 * Used by the profile name-edit form. Only the columns present in `updates`
 * are written — an omitted key leaves that column untouched, while an
 * explicit `null` clears it. This is a true partial update: callers must
 * only include the keys they actually intend to change.
 */
export async function updateName(
  id: string,
  updates: { firstName?: string | null; lastName?: string | null },
): Promise<PublicUser | null> {
  if (Object.keys(updates).length === 0) {
    const [user] = await db.select(publicColumns).from(users).where(eq(users.id, id)).limit(1);
    return user ?? null;
  }

  const [user] = await db.update(users).set(updates).where(eq(users.id, id)).returning(publicColumns);

  return user ?? null;
}

/** Includes the password hash — only the login path should call this. */
export async function findUserByEmailWithHash(
  email: string,
): Promise<(PublicUser & { passwordHash: string }) | null> {
  const [user] = await db
    .select({ ...publicColumns, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  return user ?? null;
}

/** Includes the password hash — only the change-password path should call this. */
export async function findUserByIdWithHash(
  id: string,
): Promise<(PublicUser & { passwordHash: string }) | null> {
  const [user] = await db
    .select({ ...publicColumns, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  return user ?? null;
}

export async function updatePasswordHash(id: string, passwordHash: string): Promise<void> {
  await db.update(users).set({ passwordHash }).where(eq(users.id, id));
}
