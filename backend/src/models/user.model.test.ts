import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb, closeDb } from '../test/helpers/db.ts';
import { createUser, findUserByIdWithHash, updatePasswordHash, updateName } from './user.model.ts';

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

test('createUser stores an optional first/last name and role', async () => {
  const user = await createUser('with-name@example.com', 'hash', 'Jane', 'Doe', 'admin');
  assert.equal(user?.firstName, 'Jane');
  assert.equal(user?.lastName, 'Doe');
  assert.equal(user?.role, 'admin');
});

test('createUser defaults first/last name to null when omitted', async () => {
  const user = await createUser('no-name@example.com', 'hash');
  assert.equal(user?.firstName, null);
  assert.equal(user?.lastName, null);
});

test('updateName sets first and last name', async () => {
  const user = await createUser('rename@example.com', 'hash');
  const updated = await updateName(user!.id, 'Jane', 'Doe');
  assert.equal(updated?.firstName, 'Jane');
  assert.equal(updated?.lastName, 'Doe');
});

test('updateName clears a name back to null', async () => {
  const user = await createUser('clear-name@example.com', 'hash', 'Jane', 'Doe');
  const updated = await updateName(user!.id, null, null);
  assert.equal(updated?.firstName, null);
  assert.equal(updated?.lastName, null);
});
