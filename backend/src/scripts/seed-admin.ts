import argon2 from 'argon2';
import { pool } from '../db/index.ts';
import { createUser } from '../models/user.model.ts';

/**
 * Creates a new admin user from first/last name. Insert-only: unlike the old
 * email-keyed version, this can't safely upsert, because the identifier
 * (username) is generated from the name rather than supplied — re-running
 * with the same name would either silently promote an unrelated existing
 * user or just create a second account. Re-running this script always
 * creates a new admin.
 */
export async function seedAdmin(firstName: string, lastName: string, password: string): Promise<string> {
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const user = await createUser(firstName, lastName, passwordHash, 'admin', false);
  return user.username;
}

async function main(): Promise<void> {
  const firstName = process.env.ADMIN_FIRST_NAME;
  const lastName = process.env.ADMIN_LAST_NAME;
  const password = process.env.ADMIN_PASSWORD ?? 'liahwellness';

  if (!firstName || !lastName) {
    console.error('Set ADMIN_FIRST_NAME and ADMIN_LAST_NAME, then re-run.');
    process.exit(1);
  }

  const username = await seedAdmin(firstName, lastName, password);
  console.log(`Admin ready: ${username}`);
  await pool.end();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
