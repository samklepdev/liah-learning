import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { requireAdmin } from './auth.middleware.ts';
import type { PublicUser } from '../models/user.model.ts';

function appWith(user: PublicUser | undefined) {
  const app = express();
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.get('/probe', requireAdmin, (_req, res) => res.json({ ok: true }));
  return app;
}

function adminUser(): PublicUser {
  return { id: 'u1', email: 'admin@example.com', role: 'admin', createdAt: new Date() };
}

function plainUser(): PublicUser {
  return { id: 'u2', email: 'user@example.com', role: 'user', createdAt: new Date() };
}

test('requireAdmin passes through for an admin', async () => {
  const server = appWith(adminUser()).listen(0);
  const { port } = server.address() as import('node:net').AddressInfo;
  const res = await fetch(`http://127.0.0.1:${port}/probe`);
  assert.equal(res.status, 200);
  server.close();
});

test('requireAdmin 404s for a signed-in non-admin', async () => {
  const server = appWith(plainUser()).listen(0);
  const { port } = server.address() as import('node:net').AddressInfo;
  const res = await fetch(`http://127.0.0.1:${port}/probe`);
  assert.equal(res.status, 404);
  server.close();
});

test('requireAdmin 404s when signed out', async () => {
  const server = appWith(undefined).listen(0);
  const { port } = server.address() as import('node:net').AddressInfo;
  const res = await fetch(`http://127.0.0.1:${port}/probe`);
  assert.equal(res.status, 404);
  server.close();
});
