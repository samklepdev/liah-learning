import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb, closeDb } from '../test/helpers/db.ts';
import { startTestServer, registerTestUser } from '../test/helpers/server.ts';
import { setUserRole } from '../models/admin-user.model.ts';
import { findUserByUsernameWithHash } from '../models/user.model.ts';

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
  const { cookie, userId } = await registerTestUser(baseUrl, 'Admin');
  await setUserRole(userId, 'admin');
  return cookie;
}

function csvForm(csv: string, filename = 'students.csv') {
  const form = new FormData();
  form.append('file', new Blob([csv], { type: 'text/csv' }), filename);
  return form;
}

test('POST /api/v1/admin/users/import/parse returns rows and errors for a csv', async () => {
  const cookie = await adminCookie();
  const csv = 'First Name,Last Name,Role\nJane,Doe,admin\n,Roe,\n';

  const res = await fetch(`${baseUrl}/api/v1/admin/users/import/parse`, {
    method: 'POST',
    headers: { cookie },
    body: csvForm(csv),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    rows: Array<{ firstName: string; lastName: string }>;
    errors: Array<{ row: number }>;
  };
  assert.equal(body.rows.length, 1);
  assert.equal(body.rows[0]?.firstName, 'Jane');
  assert.equal(body.rows[0]?.lastName, 'Doe');
  assert.equal(body.errors.length, 1);
});

test('POST /api/v1/admin/users/import/parse 404s for a non-admin', async () => {
  const { cookie } = await registerTestUser(baseUrl, 'Plain');
  const res = await fetch(`${baseUrl}/api/v1/admin/users/import/parse`, {
    method: 'POST',
    headers: { cookie },
    body: csvForm('First Name,Last Name\nA,B\n'),
  });
  assert.equal(res.status, 404);
});

test('POST /api/v1/admin/users/import/confirm creates users with the shared initial password', async () => {
  const cookie = await adminCookie();
  const rows = [{ row: 2, firstName: 'Jane', lastName: 'Doe', role: 'admin' as const }];

  const res = await fetch(`${baseUrl}/api/v1/admin/users/import/confirm`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    created: Array<{ username: string; firstName: string | null; lastName: string | null; role: string }>;
    skipped: unknown[];
  };
  assert.equal(body.created.length, 1);
  assert.equal(body.created[0]?.username, 'jdoe');
  assert.equal(body.created[0]?.firstName, 'Jane');
  assert.equal(body.created[0]?.lastName, 'Doe');
  assert.equal(body.created[0]?.role, 'admin');
  assert.deepEqual(body.skipped, []);
  assert.equal('password' in (body.created[0] ?? {}), false);

  const stored = await findUserByUsernameWithHash('jdoe');
  assert.equal(stored?.mustChangePassword, true);

  const login = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'jdoe', password: 'liahwellness' }),
  });
  assert.equal(login.status, 200);
});

test('POST /api/v1/admin/users/import/confirm skips a row matching an existing user by name', async () => {
  const cookie = await adminCookie();
  await registerTestUser(baseUrl, 'Existing');

  const rows = [{ row: 2, firstName: 'Test', lastName: 'Existing', role: 'user' as const }];
  const res = await fetch(`${baseUrl}/api/v1/admin/users/import/confirm`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    created: unknown[];
    skipped: Array<{ firstName: string | null; lastName: string | null; reason: string }>;
  };
  assert.deepEqual(body.created, []);
  assert.equal(body.skipped[0]?.firstName, 'Test');
  assert.equal(body.skipped[0]?.lastName, 'Existing');
});

test('a 150-row parse-then-confirm round trip creates every row', async () => {
  const cookie = await adminCookie();
  const csvLines = ['First Name,Last Name,Role'];
  for (let i = 0; i < 150; i++) {
    csvLines.push(`User,${i},user`);
  }

  const parseRes = await fetch(`${baseUrl}/api/v1/admin/users/import/parse`, {
    method: 'POST',
    headers: { cookie },
    body: csvForm(csvLines.join('\n') + '\n'),
  });
  assert.equal(parseRes.status, 200);
  const parsed = (await parseRes.json()) as {
    rows: Array<{ row: number; firstName: string; lastName: string; role: string }>;
    errors: unknown[];
  };
  assert.equal(parsed.rows.length, 150);
  assert.deepEqual(parsed.errors, []);

  const confirmRes = await fetch(`${baseUrl}/api/v1/admin/users/import/confirm`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows: parsed.rows }),
  });
  assert.equal(confirmRes.status, 200);
  const confirmed = (await confirmRes.json()) as { created: unknown[]; skipped: unknown[] };
  assert.equal(confirmed.created.length, 150);
  assert.deepEqual(confirmed.skipped, []);
});

test('POST /api/v1/admin/users/import/confirm rejects more than 200 rows', async () => {
  const cookie = await adminCookie();
  const rows = Array.from({ length: 201 }, (_, i) => ({
    row: i + 2,
    firstName: `User ${i}`,
    lastName: 'Test',
    role: 'user' as const,
  }));

  const res = await fetch(`${baseUrl}/api/v1/admin/users/import/confirm`, {
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
    firstName: `User ${padding}${i}`,
    lastName: 'Test',
    role: 'user' as const,
  }));

  const body = JSON.stringify({ rows });
  assert.ok(Buffer.byteLength(body) > 100 * 1024, 'test body should exceed 100KB');
  assert.ok(Buffer.byteLength(body) < 2 * 1024 * 1024, 'test body should stay under 2MB');

  const res = await fetch(`${baseUrl}/api/v1/admin/users/import/confirm`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body,
  });
  assert.equal(res.status, 200);
});
