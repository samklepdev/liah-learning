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

test('a 150-row parse-then-confirm round trip creates every row', async () => {
  const cookie = await adminCookie();
  const csvLines = ['Name,Email,Role'];
  for (let i = 0; i < 150; i++) {
    csvLines.push(`User ${i},user${i}@example.com,user`);
  }

  const parseRes = await fetch(`${baseUrl}/api/admin/users/import/parse`, {
    method: 'POST',
    headers: { cookie },
    body: csvForm(csvLines.join('\n') + '\n'),
  });
  assert.equal(parseRes.status, 200);
  const parsed = (await parseRes.json()) as {
    rows: Array<{ row: number; name: string | null; email: string; role: string }>;
    errors: unknown[];
  };
  assert.equal(parsed.rows.length, 150);
  assert.deepEqual(parsed.errors, []);

  const confirmRes = await fetch(`${baseUrl}/api/admin/users/import/confirm`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows: parsed.rows }),
  });
  assert.equal(confirmRes.status, 200);
  const confirmed = (await confirmRes.json()) as { created: unknown[]; skipped: unknown[] };
  assert.equal(confirmed.created.length, 150);
  assert.deepEqual(confirmed.skipped, []);
});

test('POST /api/admin/users/import/confirm rejects more than 200 rows', async () => {
  const cookie = await adminCookie();
  const rows = Array.from({ length: 201 }, (_, i) => ({
    row: i + 2,
    name: `User ${i}`,
    email: `user${i}@example.com`,
    role: 'user' as const,
  }));

  const res = await fetch(`${baseUrl}/api/admin/users/import/confirm`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows }),
  });
  assert.equal(res.status, 400);
});

test('a 200-row body over 100KB still succeeds under the 2mb carve-out', async () => {
  const cookie = await adminCookie();
  const padding = 'x'.repeat(2000);
  const rows = Array.from({ length: 200 }, (_, i) => ({
    row: i + 2,
    name: `User ${padding}${i}`,
    email: `user${i}-${padding}@example.com`.toLowerCase(),
    role: 'user' as const,
  }));

  const body = JSON.stringify({ rows });
  assert.ok(Buffer.byteLength(body) > 100 * 1024, 'test body should exceed 100KB');
  assert.ok(Buffer.byteLength(body) < 2 * 1024 * 1024, 'test body should stay under 2MB');

  const res = await fetch(`${baseUrl}/api/admin/users/import/confirm`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body,
  });
  assert.equal(res.status, 200);
});
