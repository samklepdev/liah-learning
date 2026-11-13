import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb, closeDb } from '../test/helpers/db.ts';
import { createUser } from './user.model.ts';
import {
  upsertPasswordResetRequest,
  listPasswordResetRequests,
  deletePasswordResetRequest,
} from './password-reset-request.model.ts';

before(async () => {
  await resetDb();
});

after(async () => {
  await closeDb();
});

beforeEach(async () => {
  await resetDb();
});

test('upsertPasswordResetRequest creates a pending request', async () => {
  const user = await createUser('Jane', 'Doe', 'hash', 'user', false);
  await upsertPasswordResetRequest(user.id);

  const requests = await listPasswordResetRequests();
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.userId, user.id);
  assert.equal(requests[0]?.username, user.username);
});

test('a second request for the same user updates the timestamp instead of adding a row', async () => {
  const user = await createUser('Jane', 'Doe', 'hash', 'user', false);
  await upsertPasswordResetRequest(user.id);
  const first = await listPasswordResetRequests();

  await upsertPasswordResetRequest(user.id);
  const second = await listPasswordResetRequests();

  assert.equal(second.length, 1);
  assert.ok(second[0]!.requestedAt.getTime() >= first[0]!.requestedAt.getTime());
});

test('listPasswordResetRequests orders newest first', async () => {
  const first = await createUser('First', 'User', 'hash', 'user', false);
  const second = await createUser('Second', 'User', 'hash', 'user', false);
  await upsertPasswordResetRequest(first.id);
  await upsertPasswordResetRequest(second.id);

  const requests = await listPasswordResetRequests();
  assert.deepEqual(requests.map((r) => r.userId), [second.id, first.id]);
});

test('deletePasswordResetRequest removes the pending row', async () => {
  const user = await createUser('Jane', 'Doe', 'hash', 'user', false);
  await upsertPasswordResetRequest(user.id);
  await deletePasswordResetRequest(user.id);

  assert.deepEqual(await listPasswordResetRequests(), []);
});

test('deletePasswordResetRequest is a no-op when there is no pending request', async () => {
  const user = await createUser('Jane', 'Doe', 'hash', 'user', false);
  await deletePasswordResetRequest(user.id);
  assert.deepEqual(await listPasswordResetRequests(), []);
});
