import argon2 from 'argon2';
import { db, pool } from '../db/index.ts';
import { users } from '../models/schema.ts';

/**
 * Upserts a user by email as an admin. Existing users are promoted and get
 * their password reset; this is the only way to create the first admin,
 * since every other path to the admin role requires an existing admin.
 */
export async function seedAdmin(email: string, password: string): Promise<void> {
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const normalizedEmail = email.trim().toLowerCase();

  await db
    .insert(users)
    .values({ email: normalizedEmail, passwordHash, role: 'admin' })
    .onConflictDoUpdate({
      target: users.email,
      set: { passwordHash, role: 'admin' },
    });
}

async function main(): Promise<void> {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD, then re-run.');
    process.exit(1);
  }

  await seedAdmin(email, password);
  console.log(`Admin ready: ${email.trim().toLowerCase()}`);
  await pool.end();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
