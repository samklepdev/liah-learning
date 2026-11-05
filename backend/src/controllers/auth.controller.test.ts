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

test('POST /api/auth/login returns the role, not just id/email/createdAt', async () => {
  await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'login-role@example.com', password: 'test-password-123' }),
  });

  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'login-role@example.com', password: 'test-password-123' }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { user: { role: string; passwordHash?: string } };
  assert.equal(body.user.role, 'user');
  assert.equal(body.user.passwordHash, undefined);
});

test('PATCH /api/auth/password rejects a wrong current password', async () => {
  const { cookie } = await registerTestUser(baseUrl, 'pw-wrong@example.com');

  const res = await fetch(`${baseUrl}/api/auth/password`, {
    method: 'PATCH',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword: 'not-the-password', newPassword: 'new-password-123' }),
  });
  assert.equal(res.status, 401);
});

test('PATCH /api/auth/password rejects a too-short new password', async () => {
  const { cookie } = await registerTestUser(baseUrl, 'pw-short@example.com');

  const res = await fetch(`${baseUrl}/api/auth/password`, {
    method: 'PATCH',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword: 'test-password-123', newPassword: 'short' }),
  });
  assert.equal(res.status, 400);
});

test('PATCH /api/auth/password requires a session', async () => {
  const res = await fetch(`${baseUrl}/api/auth/password`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword: 'test-password-123', newPassword: 'new-password-123' }),
  });
  assert.equal(res.status, 401);
});

test('PATCH /api/auth/password changes the password, revokes other sessions, keeps this one', async () => {
  const { cookie } = await registerTestUser(baseUrl, 'pw-change@example.com');

  // A second "device": log in again to get an independent session cookie.
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'pw-change@example.com', password: 'test-password-123' }),
  });
  const otherCookie = loginRes.headers.get('set-cookie')!.split(';')[0]!;

  const res = await fetch(`${baseUrl}/api/auth/password`, {
    method: 'PATCH',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword: 'test-password-123', newPassword: 'new-password-456' }),
  });
  assert.equal(res.status, 204);
  const newCookie = res.headers.get('set-cookie')!.split(';')[0]!;

  // The other device's session is revoked.
  const otherMe = await fetch(`${baseUrl}/api/auth/me`, { headers: { cookie: otherCookie } });
  assert.equal(otherMe.status, 401);

  // This device's *old* cookie is revoked too (it was swapped for a fresh one).
  const oldMe = await fetch(`${baseUrl}/api/auth/me`, { headers: { cookie } });
  assert.equal(oldMe.status, 401);

  // This device continues on the newly issued cookie.
  const newMe = await fetch(`${baseUrl}/api/auth/me`, { headers: { cookie: newCookie } });
  assert.equal(newMe.status, 200);

  // The new password actually works for a fresh login.
  const relogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'pw-change@example.com', password: 'new-password-456' }),
  });
  assert.equal(relogin.status, 200);
});

test('PATCH /api/auth/name requires a session', async () => {
  const res = await fetch(`${baseUrl}/api/auth/name`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: 'Jane', lastName: 'Doe' }),
  });
  assert.equal(res.status, 401);
});

test('PATCH /api/auth/name updates and returns the user', async () => {
  const { cookie } = await registerTestUser(baseUrl, 'name-update@example.com');

  const res = await fetch(`${baseUrl}/api/auth/name`, {
    method: 'PATCH',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: 'Jane', lastName: 'Doe' }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { user: { firstName: string | null; lastName: string | null } };
  assert.equal(body.user.firstName, 'Jane');
  assert.equal(body.user.lastName, 'Doe');
});

test('PATCH /api/auth/name clears a name when given blank strings', async () => {
  const { cookie } = await registerTestUser(baseUrl, 'name-clear@example.com');
  await fetch(`${baseUrl}/api/auth/name`, {
    method: 'PATCH',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: 'Jane', lastName: 'Doe' }),
  });

  const res = await fetch(`${baseUrl}/api/auth/name`, {
    method: 'PATCH',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: '', lastName: '' }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { user: { firstName: string | null; lastName: string | null } };
  assert.equal(body.user.firstName, null);
  assert.equal(body.user.lastName, null);
});
