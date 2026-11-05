import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb, closeDb } from '../test/helpers/db.ts';
import { db } from '../db/index.ts';
import { users } from './schema.ts';
import { countUsers, listUsers } from './admin-user.model.ts';
import { PAGE_SIZE } from '../lib/pagination.ts';

after(async () => {
  await closeDb();
});

beforeEach(async () => {
  await resetDb();
});

async function seedUsers(count: number) {
  const rows = Array.from({ length: count }, (_, i) => ({
    email: `user${String(i).padStart(3, '0')}@example.com`,
    passwordHash: 'hash',
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
  }));
  await db.insert(users).values(rows);
}

test('listUsers returns PAGE_SIZE rows for page 1 and the remainder for page 2', async () => {
  const total = PAGE_SIZE + 5;
  await seedUsers(total);

  const page1 = await listUsers(1);
  const page2 = await listUsers(2);

  assert.equal(page1.length, PAGE_SIZE);
  assert.equal(page2.length, 5);
  assert.equal(page1[0]!.email, 'user000@example.com');
  assert.equal(page2[0]!.email, `user${String(PAGE_SIZE).padStart(3, '0')}@example.com`);
});

test('countUsers returns the total row count regardless of page size', async () => {
  await seedUsers(PAGE_SIZE + 5);
  assert.equal(await countUsers(), PAGE_SIZE + 5);
});
