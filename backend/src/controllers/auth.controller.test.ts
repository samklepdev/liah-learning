import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb, closeDb } from '../test/helpers/db.ts';
import { startTestServer, registerTestUser } from '../test/helpers/server.ts';

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

test('POST /api/v1/auth/login returns the role, not just id/username/createdAt', async () => {
  const registerRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: 'Login', lastName: 'Role', password: 'test-password-123' }),
  });
  const { user: registered } = (await registerRes.json()) as { user: { username: string } };

  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: registered.username, password: 'test-password-123' }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { user: { role: string; passwordHash?: string } };
  assert.equal(body.user.role, 'user');
  assert.equal(body.user.passwordHash, undefined);
});

test('PATCH /api/v1/auth/password rejects a wrong current password', async () => {
  const { cookie } = await registerTestUser(baseUrl, 'PwWrong');

  const res = await fetch(`${baseUrl}/api/v1/auth/password`, {
    method: 'PATCH',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword: 'not-the-password', newPassword: 'new-password-123' }),
  });
  assert.equal(res.status, 401);
});

test('PATCH /api/v1/auth/password rejects a too-short new password', async () => {
  const { cookie } = await registerTestUser(baseUrl, 'PwShort');

  const res = await fetch(`${baseUrl}/api/v1/auth/password`, {
    method: 'PATCH',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword: 'test-password-123', newPassword: 'short' }),
  });
  assert.equal(res.status, 400);
});

test('PATCH /api/v1/auth/password requires a session', async () => {
  const res = await fetch(`${baseUrl}/api/v1/auth/password`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword: 'test-password-123', newPassword: 'new-password-123' }),
  });
  assert.equal(res.status, 401);
});

test('PATCH /api/v1/auth/password changes the password, revokes other sessions, keeps this one', async () => {
  const { cookie, username } = await registerTestUser(baseUrl, 'PwChange');

  // A second "device": log in again to get an independent session cookie.
  const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'test-password-123' }),
  });
  const otherCookie = loginRes.headers.get('set-cookie')!.split(';')[0]!;

  const res = await fetch(`${baseUrl}/api/v1/auth/password`, {
    method: 'PATCH',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword: 'test-password-123', newPassword: 'new-password-456' }),
  });
  assert.equal(res.status, 204);
  const newCookie = res.headers.get('set-cookie')!.split(';')[0]!;

  // The other device's session is revoked.
  const otherMe = await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { cookie: otherCookie } });
  assert.equal(otherMe.status, 401);

  // This device's *old* cookie is revoked too (it was swapped for a fresh one).
  const oldMe = await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { cookie } });
  assert.equal(oldMe.status, 401);

  // This device continues on the newly issued cookie.
  const newMe = await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { cookie: newCookie } });
  assert.equal(newMe.status, 200);

  // The new password actually works for a fresh login.
  const relogin = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'new-password-456' }),
  });
  assert.equal(relogin.status, 200);
});

test('PATCH /api/v1/auth/name requires a session', async () => {
  const res = await fetch(`${baseUrl}/api/v1/auth/name`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: 'Jane', lastName: 'Doe' }),
  });
  assert.equal(res.status, 401);
});

test('PATCH /api/v1/auth/name updates and returns the user', async () => {
  const { cookie } = await registerTestUser(baseUrl, 'NameUpdate');

  const res = await fetch(`${baseUrl}/api/v1/auth/name`, {
    method: 'PATCH',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: 'Jane', lastName: 'Doe' }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { user: { firstName: string | null; lastName: string | null } };
  assert.equal(body.user.firstName, 'Jane');
  assert.equal(body.user.lastName, 'Doe');
});

test('PATCH /api/v1/auth/name clears a name when given blank strings', async () => {
  const { cookie } = await registerTestUser(baseUrl, 'NameClear');
  await fetch(`${baseUrl}/api/v1/auth/name`, {
    method: 'PATCH',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: 'Jane', lastName: 'Doe' }),
  });

  const res = await fetch(`${baseUrl}/api/v1/auth/name`, {
    method: 'PATCH',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: '', lastName: '' }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { user: { firstName: string | null; lastName: string | null } };
  assert.equal(body.user.firstName, null);
  assert.equal(body.user.lastName, null);
});

test('PATCH /api/v1/auth/name with only firstName in the body does not clear lastName', async () => {
  const { cookie } = await registerTestUser(baseUrl, 'NamePartial');
  await fetch(`${baseUrl}/api/v1/auth/name`, {
    method: 'PATCH',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: 'Jane', lastName: 'Doe' }),
  });

  const res = await fetch(`${baseUrl}/api/v1/auth/name`, {
    method: 'PATCH',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: 'Janet' }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { user: { firstName: string | null; lastName: string | null } };
  assert.equal(body.user.firstName, 'Janet');
  assert.equal(body.user.lastName, 'Doe');
});

test('PATCH /api/v1/auth/name rejects a name over 100 characters', async () => {
  const { cookie } = await registerTestUser(baseUrl, 'NameTooLong');

  const res = await fetch(`${baseUrl}/api/v1/auth/name`, {
    method: 'PATCH',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: 'a'.repeat(101) }),
  });
  assert.equal(res.status, 400);
});

test('PATCH /api/v1/auth/name with an empty body leaves both names unchanged', async () => {
  const { cookie } = await registerTestUser(baseUrl, 'NameEmptyBody');
  await fetch(`${baseUrl}/api/v1/auth/name`, {
    method: 'PATCH',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: 'Jane', lastName: 'Doe' }),
  });

  const res = await fetch(`${baseUrl}/api/v1/auth/name`, {
    method: 'PATCH',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { user: { firstName: string | null; lastName: string | null } };
  assert.equal(body.user.firstName, 'Jane');
  assert.equal(body.user.lastName, 'Doe');
});

test('POST /api/v1/auth/register rejects a missing first or last name', async () => {
  const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: '', lastName: 'Doe', password: 'test-password-123' }),
  });
  assert.equal(res.status, 400);
});

test('POST /api/v1/auth/register with a duplicate name still succeeds, with a numbered username', async () => {
  const first = await registerTestUser(baseUrl, 'Duplicate');
  const secondRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: 'Test', lastName: 'Duplicate', password: 'test-password-123' }),
  });
  assert.equal(secondRes.status, 201);
  const body = (await secondRes.json()) as { user: { username: string } };
  assert.notEqual(body.user.username, first.username);
});
