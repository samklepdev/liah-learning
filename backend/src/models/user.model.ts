import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { buildBaseUsername } from '../lib/username.ts';
import { users, type User } from './schema.ts';

/** The user shape that is safe to send to a client — never the password hash. */
export type PublicUser = Pick<
  User,
  'id' | 'username' | 'firstName' | 'lastName' | 'role' | 'mustChangePassword' | 'createdAt'
>;

/** Fixed initial password for every admin-created account (single-add and
 *  bulk import). A shared secret is a weaker guarantee than a random
 *  per-user password, which is why every admin-created account also gets
 *  mustChangePassword: true — the exposure window is bounded to "before
 *  the user's first login." */
export const INITIAL_PASSWORD = 'liahwellness';

const publicColumns = {
  id: users.id,
  username: users.username,
  firstName: users.firstName,
  lastName: users.lastName,
  role: users.role,
  mustChangePassword: users.mustChangePassword,
  createdAt: users.createdAt,
};

const MAX_USERNAME_ATTEMPTS = 1000;

/**
 * Generates a unique username from first/last name and inserts the user.
 * Tries the base username first, then `${base}2`, `${base}3`, ... on
 * conflict. Never returns null — a name collision changes the generated
 * username, it does not block creation.
 */
export async function createUser(
  firstName: string,
  lastName: string,
  passwordHash: string,
  role: 'user' | 'admin',
  mustChangePassword: boolean,
): Promise<PublicUser> {
  const base = buildBaseUsername(firstName, lastName);

  for (let attempt = 1; attempt <= MAX_USERNAME_ATTEMPTS; attempt++) {
    const username = attempt === 1 ? base : `${base}${attempt}`;
    const [user] = await db
      .insert(users)
      .values({ username, passwordHash, firstName, lastName, role, mustChangePassword })
      .onConflictDoNothing({ target: users.username })
      .returning(publicColumns);

    if (user) return user;
  }

  throw new Error(`Could not generate a unique username for base "${base}" after ${MAX_USERNAME_ATTEMPTS} attempts`);
}

/** Case-insensitive exact match on first+last name — used by the admin
 *  import's dedup check. Returns null if either name is unset on a row. */
export async function findUserByName(firstName: string, lastName: string): Promise<PublicUser | null> {
  const [user] = await db
    .select(publicColumns)
    .from(users)
    .where(
      and(
        sql`lower(${users.firstName}) = lower(${firstName})`,
        sql`lower(${users.lastName}) = lower(${lastName})`,
      ),
    )
    .limit(1);

  return user ?? null;
}

/** Includes the password hash — only the login path should call this. */
export async function findUserByUsernameWithHash(
  username: string,
): Promise<(PublicUser & { passwordHash: string }) | null> {
  const [user] = await db
    .select({ ...publicColumns, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.username, username))
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

export async function clearMustChangePassword(id: string): Promise<void> {
  await db.update(users).set({ mustChangePassword: false }).where(eq(users.id, id));
}
