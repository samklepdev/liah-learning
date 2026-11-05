import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb, closeDb } from '../test/helpers/db.ts';
import { startTestServer, registerTestUser } from '../test/helpers/server.ts';
import { setUserRole } from '../models/admin-user.model.ts';

let baseUrl: string;
let close: () => Promise<void>;

before(async () => {
  ({ baseUrl, close } = await startTestServer());
});

after(async () => {
  await close();
  await closeDb();
});

beforeEach(async () => {
  await resetDb();
});

async function makeAdmin(email: string) {
  const { cookie, userId } = await registerTestUser(baseUrl, email);
  await setUserRole(userId, 'admin');
  return { cookie, userId };
}

test('GET /api/v1/admin/users 404s for a signed-in non-admin', async () => {
  const { cookie } = await registerTestUser(baseUrl, 'plain@example.com');
  const res = await fetch(`${baseUrl}/api/v1/admin/users`, { headers: { cookie } });
  assert.equal(res.status, 404);
});

test('GET /api/v1/admin/users lists users for an admin', async () => {
  const { cookie } = await makeAdmin('admin@example.com');
  await registerTestUser(baseUrl, 'student@example.com');

  const res = await fetch(`${baseUrl}/api/v1/admin/users`, { headers: { cookie } });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { users: Array<{ email: string }> };
  const emails = body.users.map((u) => u.email).sort();
  assert.deepEqual(emails, ['admin@example.com', 'student@example.com']);
});

test('PATCH role promotes a user to admin', async () => {
  const { cookie } = await makeAdmin('admin@example.com');
  const { userId } = await registerTestUser(baseUrl, 'student@example.com');

  const res = await fetch(`${baseUrl}/api/v1/admin/users/${userId}/role`, {
    method: 'PATCH',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'admin' }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { user: { role: string } };
  assert.equal(body.user.role, 'admin');
});

test('PATCH role rejects an admin demoting themselves', async () => {
  const { cookie, userId } = await makeAdmin('admin@example.com');

  const res = await fetch(`${baseUrl}/api/v1/admin/users/${userId}/role`, {
    method: 'PATCH',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'user' }),
  });
  assert.equal(res.status, 400);
});

test('DELETE removes a user', async () => {
  const { cookie } = await makeAdmin('admin@example.com');
  const { userId } = await registerTestUser(baseUrl, 'student@example.com');

  const res = await fetch(`${baseUrl}/api/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: { cookie },
  });
  assert.equal(res.status, 204);

  const list = await fetch(`${baseUrl}/api/v1/admin/users`, { headers: { cookie } });
  const body = (await list.json()) as { users: Array<{ email: string }> };
  assert.equal(body.users.some((u) => u.email === 'student@example.com'), false);
});

test('DELETE rejects an admin deleting themselves', async () => {
  const { cookie, userId } = await makeAdmin('admin@example.com');

  const res = await fetch(`${baseUrl}/api/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: { cookie },
  });
  assert.equal(res.status, 400);
});

test("GET /api/v1/admin/users/:id/attempts lists that user's attempts", async () => {
  const { cookie } = await makeAdmin('admin@example.com');
  const { userId } = await registerTestUser(baseUrl, 'student@example.com');

  // The student has no course content seeded in this test's empty DB, so this
  // only exercises the empty-list path — content-bearing cases are covered by
  // the quiz/attempt lifecycle tests elsewhere.
  const res = await fetch(`${baseUrl}/api/v1/admin/users/${userId}/attempts`, {
    headers: { cookie },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { attempts: unknown[] };
  assert.deepEqual(body.attempts, []);
});

test('GET /api/v1/admin/users/:id/attempts 404s for an unknown user', async () => {
  const { cookie } = await makeAdmin('admin@example.com');
  const res = await fetch(
    `${baseUrl}/api/v1/admin/users/00000000-0000-0000-0000-000000000000/attempts`,
    { headers: { cookie } },
  );
  assert.equal(res.status, 404);
});
