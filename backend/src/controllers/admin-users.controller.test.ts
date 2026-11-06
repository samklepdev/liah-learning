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

async function makeAdmin(label: string) {
  const { cookie, userId, username } = await registerTestUser(baseUrl, label);
  await setUserRole(userId, 'admin');
  return { cookie, userId, username };
}

test('GET /api/v1/admin/users 404s for a signed-in non-admin', async () => {
  const { cookie } = await registerTestUser(baseUrl, 'Plain');
  const res = await fetch(`${baseUrl}/api/v1/admin/users`, { headers: { cookie } });
  assert.equal(res.status, 404);
});

test('GET /api/v1/admin/users lists users for an admin', async () => {
  const { cookie, username: adminUsername } = await makeAdmin('Admin');
  const { username: studentUsername } = await registerTestUser(baseUrl, 'Student');

  const res = await fetch(`${baseUrl}/api/v1/admin/users`, { headers: { cookie } });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { items: Array<{ username: string }> };
  const usernames = body.items.map((u) => u.username).sort();
  assert.deepEqual(usernames, [adminUsername, studentUsername].sort());
});

test('GET /api/v1/admin/users includes pagination metadata', async () => {
  const { cookie } = await makeAdmin('Admin');
  await registerTestUser(baseUrl, 'Student');

  const res = await fetch(`${baseUrl}/api/v1/admin/users`, { headers: { cookie } });
  const body = (await res.json()) as { total: number; page: number; pageSize: number };
  assert.equal(body.total, 2);
  assert.equal(body.page, 1);
  assert.equal(body.pageSize, 20);
});

test('PATCH role promotes a user to admin', async () => {
  const { cookie } = await makeAdmin('Admin');
  const { userId } = await registerTestUser(baseUrl, 'Student');

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
  const { cookie, userId } = await makeAdmin('Admin');

  const res = await fetch(`${baseUrl}/api/v1/admin/users/${userId}/role`, {
    method: 'PATCH',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'user' }),
  });
  assert.equal(res.status, 400);
});

test('DELETE removes a user', async () => {
  const { cookie } = await makeAdmin('Admin');
  const { userId, username } = await registerTestUser(baseUrl, 'Student');

  const res = await fetch(`${baseUrl}/api/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: { cookie },
  });
  assert.equal(res.status, 204);

  const list = await fetch(`${baseUrl}/api/v1/admin/users`, { headers: { cookie } });
  const body = (await list.json()) as { items: Array<{ username: string }> };
  assert.equal(body.items.some((u) => u.username === username), false);
});

test('DELETE rejects an admin deleting themselves', async () => {
  const { cookie, userId } = await makeAdmin('Admin');

  const res = await fetch(`${baseUrl}/api/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: { cookie },
  });
  assert.equal(res.status, 400);
});

test("GET /api/v1/admin/users/:id/attempts lists that user's attempts", async () => {
  const { cookie } = await makeAdmin('Admin');
  const { userId } = await registerTestUser(baseUrl, 'Student');

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
  const { cookie } = await makeAdmin('Admin');
  const res = await fetch(
    `${baseUrl}/api/v1/admin/users/00000000-0000-0000-0000-000000000000/attempts`,
    { headers: { cookie } },
  );
  assert.equal(res.status, 404);
});

test('POST /api/v1/admin/users creates a user with the shared initial password', async () => {
  const { cookie } = await makeAdmin('Admin');

  const res = await fetch(`${baseUrl}/api/v1/admin/users`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: 'New', lastName: 'Person', role: 'user' }),
  });
  assert.equal(res.status, 201);
  const body = (await res.json()) as {
    user: { username: string; firstName: string; lastName: string; role: string; mustChangePassword: boolean };
  };
  assert.equal(body.user.username, 'nperson');
  assert.equal(body.user.firstName, 'New');
  assert.equal(body.user.lastName, 'Person');
  assert.equal(body.user.role, 'user');
  assert.equal(body.user.mustChangePassword, true);
  assert.equal('password' in body.user, false);

  const login = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'nperson', password: 'liahwellness' }),
  });
  assert.equal(login.status, 200);
});

test('POST /api/v1/admin/users rejects a duplicate name', async () => {
  const { cookie } = await makeAdmin('Admin');
  await registerTestUser(baseUrl, 'Existing');

  const res = await fetch(`${baseUrl}/api/v1/admin/users`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: 'Test', lastName: 'Existing', role: 'user' }),
  });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, 'A user with this name already exists');
});

test('POST /api/v1/admin/users rejects a missing last name', async () => {
  const { cookie } = await makeAdmin('Admin');

  const res = await fetch(`${baseUrl}/api/v1/admin/users`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: 'Solo', lastName: '', role: 'user' }),
  });
  assert.equal(res.status, 400);
});

test('POST /api/v1/admin/users 404s for a non-admin', async () => {
  const { cookie } = await registerTestUser(baseUrl, 'Plain');

  const res = await fetch(`${baseUrl}/api/v1/admin/users`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: 'New', lastName: 'Person', role: 'user' }),
  });
  assert.equal(res.status, 404);
});

test('DELETE soft-deletes a user, who appears in the recycle bin and can be restored', async () => {
  const { cookie } = await makeAdmin('Admin');
  const { userId, username } = await registerTestUser(baseUrl, 'Student');

  const del = await fetch(`${baseUrl}/api/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: { cookie },
  });
  assert.equal(del.status, 204);

  const deletedList = await fetch(`${baseUrl}/api/v1/admin/users/deleted`, { headers: { cookie } });
  assert.equal(deletedList.status, 200);
  const deletedBody = (await deletedList.json()) as { items: Array<{ username: string }> };
  assert.equal(deletedBody.items.some((u) => u.username === username), true);

  const restore = await fetch(`${baseUrl}/api/v1/admin/users/${userId}/restore`, {
    method: 'POST',
    headers: { cookie },
  });
  assert.equal(restore.status, 200);

  const activeList = await fetch(`${baseUrl}/api/v1/admin/users`, { headers: { cookie } });
  const activeBody = (await activeList.json()) as { items: Array<{ username: string }> };
  assert.equal(activeBody.items.some((u) => u.username === username), true);
});

test('DELETE 404s when the user is already deleted', async () => {
  const { cookie } = await makeAdmin('Admin');
  const { userId } = await registerTestUser(baseUrl, 'Student');

  await fetch(`${baseUrl}/api/v1/admin/users/${userId}`, { method: 'DELETE', headers: { cookie } });
  const second = await fetch(`${baseUrl}/api/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: { cookie },
  });
  assert.equal(second.status, 404);
});

test('POST restore 404s for a user that is not deleted', async () => {
  const { cookie } = await makeAdmin('Admin');
  const { userId } = await registerTestUser(baseUrl, 'Student');

  const res = await fetch(`${baseUrl}/api/v1/admin/users/${userId}/restore`, {
    method: 'POST',
    headers: { cookie },
  });
  assert.equal(res.status, 404);
});

test('a soft-deleted user is signed out immediately', async () => {
  const { cookie: adminCookie } = await makeAdmin('Admin');
  const { cookie: studentCookie, userId } = await registerTestUser(baseUrl, 'Student');

  const before = await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { cookie: studentCookie } });
  assert.equal(before.status, 200);

  await fetch(`${baseUrl}/api/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: { cookie: adminCookie },
  });

  const after = await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { cookie: studentCookie } });
  assert.equal(after.status, 401);
});
