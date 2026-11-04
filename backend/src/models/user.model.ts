import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { users, type User } from './schema.ts';

/** The user shape that is safe to send to a client — never the password hash. */
export type PublicUser = Pick<User, 'id' | 'email' | 'role' | 'createdAt'>;

const publicColumns = {
  id: users.id,
  email: users.email,
  role: users.role,
  createdAt: users.createdAt,
};

/** Returns null when the email is already registered. */
export async function createUser(
  email: string,
  passwordHash: string,
): Promise<PublicUser | null> {
  const [user] = await db
    .insert(users)
    .values({ email, passwordHash })
    .onConflictDoNothing({ target: users.email })
    .returning(publicColumns);

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
