import argon2 from 'argon2';
import { pool } from '../db/index.ts';
import {
  findUserByUsernameWithHash,
  forcePasswordChange,
  INITIAL_PASSWORD,
  updatePasswordHash,
} from '../models/user.model.ts';

/**
 * Bypasses the API/auth entirely — for the case where there is no other
 * admin available to do the reset through the UI. Resolves by username
 * (not id) since that's what an operator has on hand.
 */
export async function resetAdminPassword(username: string, password: string): Promise<void> {
  const user = await findUserByUsernameWithHash(username);
  if (!user) throw new Error(`No user found with username "${username}"`);

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  await updatePasswordHash(user.id, passwordHash);
  await forcePasswordChange(user.id);
}

async function main(): Promise<void> {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD ?? INITIAL_PASSWORD;

  if (!username) {
    console.error('Set ADMIN_USERNAME, then re-run.');
    process.exit(1);
  }

  await resetAdminPassword(username, password);
  console.log(`Password reset for ${username}. They must change it on next login.`);
  await pool.end();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
