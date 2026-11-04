import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb, closeDb } from '../test/helpers/db.ts';
import { startTestServer, registerTestUser } from '../test/helpers/server.ts';
import { setUserRole } from '../models/admin-user.model.ts';
import { findUserByEmailWithHash } from '../models/user.model.ts';

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

async function adminCookie() {
  const { cookie, userId } = await registerTestUser(baseUrl, 'admin@example.com');
  await setUserRole(userId, 'admin');
  return cookie;
}

function csvForm(csv: string, filename = 'students.csv') {
  const form = new FormData();
  form.append('file', new Blob([csv], { type: 'text/csv' }), filename);
  return form;
}

test('POST /api/admin/users/import/parse returns rows and errors for a csv', async () => {
  const cookie = await adminCookie();
  const csv = 'Name,Email,Role\nJane Doe,jane@example.com,admin\nBad Row,not-an-email,\n';

  const res = await fetch(`${baseUrl}/api/admin/users/import/parse`, {
    method: 'POST',
    headers: { cookie },
    body: csvForm(csv),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    rows: Array<{ email: string }>;
    errors: Array<{ row: number }>;
  };
  assert.equal(body.rows.length, 1);
  assert.equal(body.rows[0]?.email, 'jane@example.com');
  assert.equal(body.errors.length, 1);
});

test('POST /api/admin/users/import/parse 404s for a non-admin', async () => {
  const { cookie } = await registerTestUser(baseUrl, 'plain@example.com');
  const res = await fetch(`${baseUrl}/api/admin/users/import/parse`, {
    method: 'POST',
    headers: { cookie },
    body: csvForm('Name,Email\nA,a@example.com\n'),
  });
  assert.equal(res.status, 404);
});

test('POST /api/admin/users/import/confirm creates users with a hashed password', async () => {
  const cookie = await adminCookie();
  const rows = [{ row: 2, name: 'Jane Doe', email: 'jane@example.com', role: 'admin' as const }];

  const res = await fetch(`${baseUrl}/api/admin/users/import/confirm`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    created: Array<{ email: string; name: string | null; role: string; password: string }>;
    skipped: unknown[];
  };
  assert.equal(body.created.length, 1);
  assert.equal(body.created[0]?.email, 'jane@example.com');
  assert.equal(body.created[0]?.role, 'admin');
  assert.ok(body.created[0]?.password && body.created[0].password.length > 0);
  assert.deepEqual(body.skipped, []);

  const stored = await findUserByEmailWithHash('jane@example.com');
  assert.notEqual(stored?.passwordHash, body.created[0]?.password);
});

test('POST /api/admin/users/import/confirm skips an already-registered email', async () => {
  const cookie = await adminCookie();
  await registerTestUser(baseUrl, 'existing@example.com');

  const rows = [{ row: 2, name: null, email: 'existing@example.com', role: 'user' as const }];
  const res = await fetch(`${baseUrl}/api/admin/users/import/confirm`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { created: unknown[]; skipped: Array<{ email: string }> };
  assert.deepEqual(body.created, []);
  assert.equal(body.skipped[0]?.email, 'existing@example.com');
});
