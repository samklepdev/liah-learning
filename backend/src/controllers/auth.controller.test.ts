import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb, closeDb } from '../test/helpers/db.ts';
import { startTestServer } from '../test/helpers/server.ts';

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
