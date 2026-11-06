import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb, closeDb } from '../test/helpers/db.ts';
import {
  createUser,
  findUserByIdWithHash,
  findUserByUsernameWithHash,
  findUserByName,
  updatePasswordHash,
  updateName,
} from './user.model.ts';

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
  const user = await createUser('Role', 'Default', 'hash');
  assert.equal(user.role, 'user');
});

test('createUser generates a username from first/last name', async () => {
  const user = await createUser('Jane', 'Doe', 'hash');
  assert.equal(user.username, 'jdoe');
});

test('createUser appends a number when the base username is taken', async () => {
  const first = await createUser('Jane', 'Doe', 'hash');
  const second = await createUser('Jane', 'Doe', 'hash');
  assert.equal(first.username, 'jdoe');
  assert.equal(second.username, 'jdoe2');
});

test('findUserByUsernameWithHash returns the hash for a known user', async () => {
  const user = await createUser('Hash', 'Lookup', 'some-hash');
  const found = await findUserByUsernameWithHash(user.username);
  assert.equal(found?.passwordHash, 'some-hash');
});

test('findUserByUsernameWithHash returns null for an unknown username', async () => {
  const found = await findUserByUsernameWithHash('nobody');
  assert.equal(found, null);
});

test('findUserByIdWithHash returns the hash for a known user', async () => {
  const user = await createUser('Hash', 'Lookup2', 'some-hash');
  const found = await findUserByIdWithHash(user.id);
  assert.equal(found?.passwordHash, 'some-hash');
});

test('findUserByIdWithHash returns null for an unknown id', async () => {
  const found = await findUserByIdWithHash('00000000-0000-0000-0000-000000000000');
  assert.equal(found, null);
});

test('findUserByName matches case-insensitively', async () => {
  await createUser('Jane', 'Doe', 'hash');
  const found = await findUserByName('jane', 'DOE');
  assert.equal(found?.firstName, 'Jane');
});

test('findUserByName returns null when no match exists', async () => {
  const found = await findUserByName('Nobody', 'Here');
  assert.equal(found, null);
});

test('updatePasswordHash persists the new hash', async () => {
  const user = await createUser('Update', 'Hash', 'old-hash');
  await updatePasswordHash(user.id, 'new-hash');
  const found = await findUserByIdWithHash(user.id);
  assert.equal(found?.passwordHash, 'new-hash');
});

test('createUser stores first/last name and role', async () => {
  const user = await createUser('Jane', 'Doe', 'hash', 'admin');
  assert.equal(user.firstName, 'Jane');
  assert.equal(user.lastName, 'Doe');
  assert.equal(user.role, 'admin');
});

test('updateName sets first and last name', async () => {
  const user = await createUser('Rename', 'Me', 'hash');
  const updated = await updateName(user.id, { firstName: 'Jane', lastName: 'Doe' });
  assert.equal(updated?.firstName, 'Jane');
  assert.equal(updated?.lastName, 'Doe');
});

test('updateName clears a name back to null', async () => {
  const user = await createUser('Clear', 'Name', 'hash');
  const updated = await updateName(user.id, { firstName: null, lastName: null });
  assert.equal(updated?.firstName, null);
  assert.equal(updated?.lastName, null);
});

test('updateName with only firstName leaves lastName untouched', async () => {
  const user = await createUser('Partial', 'Update', 'hash');
  const updated = await updateName(user.id, { firstName: 'Janet' });
  assert.equal(updated?.firstName, 'Janet');
  assert.equal(updated?.lastName, 'Update');
});

test('updateName with no keys leaves both names untouched and returns the current user', async () => {
  const user = await createUser('Empty', 'Update', 'hash');
  const updated = await updateName(user.id, {});
  assert.equal(updated?.firstName, 'Empty');
  assert.equal(updated?.lastName, 'Update');
});
