import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb, closeDb } from '../test/helpers/db.ts';
import { createUser, findUserByIdWithHash, updatePasswordHash } from './user.model.ts';

before(async () => {
  await resetDb();
});

after(async () => {
  await closeDb();
});

beforeEach(async () => {
  await resetDb();
});

test('createUser defaults role to "user"', async () => {
  const user = await createUser('role-default@example.com', 'hash');
  assert.equal(user?.role, 'user');
});

test('findUserByIdWithHash returns the hash for a known user', async () => {
  const user = await createUser('hash-lookup@example.com', 'some-hash');
  const found = await findUserByIdWithHash(user!.id);
  assert.equal(found?.passwordHash, 'some-hash');
});

test('findUserByIdWithHash returns null for an unknown id', async () => {
  const found = await findUserByIdWithHash('00000000-0000-0000-0000-000000000000');
  assert.equal(found, null);
});

test('updatePasswordHash persists the new hash', async () => {
  const user = await createUser('update-hash@example.com', 'old-hash');
  await updatePasswordHash(user!.id, 'new-hash');
  const found = await findUserByIdWithHash(user!.id);
  assert.equal(found?.passwordHash, 'new-hash');
});

test('createUser stores an optional name and role', async () => {
  const user = await createUser('with-name@example.com', 'hash', 'Jane Doe', 'admin');
  assert.equal(user?.name, 'Jane Doe');
  assert.equal(user?.role, 'admin');
});

test('createUser defaults name to null when omitted', async () => {
  const user = await createUser('no-name@example.com', 'hash');
  assert.equal(user?.name, null);
});
