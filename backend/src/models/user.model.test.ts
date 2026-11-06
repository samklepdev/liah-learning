import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb, closeDb } from '../test/helpers/db.ts';
import {
  createUser,
  findUserByIdWithHash,
  findUserByUsernameWithHash,
  findUserByName,
  updatePasswordHash,
  clearMustChangePassword,
  INITIAL_PASSWORD,
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

test('createUser stores the given role', async () => {
  const user = await createUser('Role', 'Default', 'hash', 'user', false);
  assert.equal(user.role, 'user');
});

test('createUser generates a username from first/last name', async () => {
  const user = await createUser('Jane', 'Doe', 'hash', 'user', false);
  assert.equal(user.username, 'jdoe');
});

test('createUser appends a number when the base username is taken', async () => {
  const first = await createUser('Jane', 'Doe', 'hash', 'user', false);
  const second = await createUser('Jane', 'Doe', 'hash', 'user', false);
  assert.equal(first.username, 'jdoe');
  assert.equal(second.username, 'jdoe2');
});

test('findUserByUsernameWithHash returns the hash for a known user', async () => {
  const user = await createUser('Hash', 'Lookup', 'some-hash', 'user', false);
  const found = await findUserByUsernameWithHash(user.username);
  assert.equal(found?.passwordHash, 'some-hash');
});

test('findUserByUsernameWithHash returns null for an unknown username', async () => {
  const found = await findUserByUsernameWithHash('nobody');
  assert.equal(found, null);
});

test('findUserByIdWithHash returns the hash for a known user', async () => {
  const user = await createUser('Hash', 'Lookup2', 'some-hash', 'user', false);
  const found = await findUserByIdWithHash(user.id);
  assert.equal(found?.passwordHash, 'some-hash');
});

test('findUserByIdWithHash returns null for an unknown id', async () => {
  const found = await findUserByIdWithHash('00000000-0000-0000-0000-000000000000');
  assert.equal(found, null);
});

test('findUserByName matches case-insensitively', async () => {
  await createUser('Jane', 'Doe', 'hash', 'user', false);
  const found = await findUserByName('jane', 'DOE');
  assert.equal(found?.firstName, 'Jane');
});

test('findUserByName returns null when no match exists', async () => {
  const found = await findUserByName('Nobody', 'Here');
  assert.equal(found, null);
});

test('updatePasswordHash persists the new hash', async () => {
  const user = await createUser('Update', 'Hash', 'old-hash', 'user', false);
  await updatePasswordHash(user.id, 'new-hash');
  const found = await findUserByIdWithHash(user.id);
  assert.equal(found?.passwordHash, 'new-hash');
});

test('createUser stores first/last name and role', async () => {
  const user = await createUser('Jane', 'Doe', 'hash', 'admin', false);
  assert.equal(user.firstName, 'Jane');
  assert.equal(user.lastName, 'Doe');
  assert.equal(user.role, 'admin');
});

test('createUser persists mustChangePassword', async () => {
  const forced = await createUser('Must', 'Change', 'hash', 'user', true);
  assert.equal(forced.mustChangePassword, true);

  const free = await createUser('No', 'Force', 'hash', 'user', false);
  assert.equal(free.mustChangePassword, false);
});

test('clearMustChangePassword flips the flag to false', async () => {
  const user = await createUser('Clear', 'Flag', 'hash', 'user', true);
  await clearMustChangePassword(user.id);
  const found = await findUserByIdWithHash(user.id);
  assert.equal(found?.mustChangePassword, false);
});

test('INITIAL_PASSWORD is the fixed shared password', () => {
  assert.equal(INITIAL_PASSWORD, 'liahwellness');
});
