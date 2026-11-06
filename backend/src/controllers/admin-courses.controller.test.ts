import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { resetDb, closeDb } from '../test/helpers/db.ts';
import { startTestServer, registerTestUser } from '../test/helpers/server.ts';
import { seedSubject } from '../scripts/seed-quizzes.ts';
import { setUserRole } from '../models/admin-user.model.ts';
import { courses } from '../models/schema.ts';
import type { ParsedSubject } from '../lib/quiz-parser.ts';

const subject: ParsedSubject = JSON.parse(
  readFileSync(new URL('../data/chassis.quiz.json', import.meta.url), 'utf8'),
);
const SLUG = 'chassis-tire-and-rim-essentials';

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
  await seedSubject(subject);
});

async function makeAdmin(label: string) {
  const { cookie, userId } = await registerTestUser(baseUrl, label);
  await setUserRole(userId, 'admin');
  return { cookie, userId };
}

async function courseId(slug: string): Promise<string> {
  const [row] = await db.select({ id: courses.id }).from(courses).where(eq(courses.slug, slug));
  return row!.id;
}

test('GET /api/v1/admin/courses lists courses with their subject', async () => {
  const { cookie } = await makeAdmin('Admin');
  const res = await fetch(`${baseUrl}/api/v1/admin/courses`, { headers: { cookie } });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { items: Array<{ slug: string; subjectSlug: string }> };
  assert.equal(body.items.length, 11);
  assert.equal(body.items.some((c) => c.slug === SLUG && c.subjectSlug === 'chassis'), true);
});

test('GET /api/v1/admin/courses 404s for a non-admin', async () => {
  const { cookie } = await registerTestUser(baseUrl, 'Plain');
  const res = await fetch(`${baseUrl}/api/v1/admin/courses`, { headers: { cookie } });
  assert.equal(res.status, 404);
});

test('DELETE soft-deletes a course, hiding it from the catalog and admin list', async () => {
  const { cookie } = await makeAdmin('Admin');
  const id = await courseId(SLUG);

  const res = await fetch(`${baseUrl}/api/v1/admin/courses/${id}`, {
    method: 'DELETE',
    headers: { cookie },
  });
  assert.equal(res.status, 204);

  const list = await fetch(`${baseUrl}/api/v1/admin/courses`, { headers: { cookie } });
  const body = (await list.json()) as { items: Array<{ slug: string }> };
  assert.equal(body.items.some((c) => c.slug === SLUG), false);

  const catalog = await fetch(`${baseUrl}/api/v1/courses?subject=chassis`);
  const catalogBody = (await catalog.json()) as { courses: Array<{ slug: string }> };
  assert.equal(catalogBody.courses.some((c) => c.slug === SLUG), false);
});

test('DELETE 404s when the course is already deleted', async () => {
  const { cookie } = await makeAdmin('Admin');
  const id = await courseId(SLUG);

  await fetch(`${baseUrl}/api/v1/admin/courses/${id}`, { method: 'DELETE', headers: { cookie } });
  const second = await fetch(`${baseUrl}/api/v1/admin/courses/${id}`, {
    method: 'DELETE',
    headers: { cookie },
  });
  assert.equal(second.status, 404);
});

test('GET /api/v1/admin/courses/deleted lists a soft-deleted course, and restore brings it back', async () => {
  const { cookie } = await makeAdmin('Admin');
  const id = await courseId(SLUG);
  await fetch(`${baseUrl}/api/v1/admin/courses/${id}`, { method: 'DELETE', headers: { cookie } });

  const deletedList = await fetch(`${baseUrl}/api/v1/admin/courses/deleted`, { headers: { cookie } });
  const deletedBody = (await deletedList.json()) as { items: Array<{ slug: string }> };
  assert.equal(deletedBody.items.some((c) => c.slug === SLUG), true);

  const restore = await fetch(`${baseUrl}/api/v1/admin/courses/${id}/restore`, {
    method: 'POST',
    headers: { cookie },
  });
  assert.equal(restore.status, 200);

  const catalog = await fetch(`${baseUrl}/api/v1/courses?subject=chassis`);
  const catalogBody = (await catalog.json()) as { courses: Array<{ slug: string }> };
  assert.equal(catalogBody.courses.some((c) => c.slug === SLUG), true);
});

test('POST restore 404s for a course that is not deleted', async () => {
  const { cookie } = await makeAdmin('Admin');
  const id = await courseId(SLUG);

  const res = await fetch(`${baseUrl}/api/v1/admin/courses/${id}/restore`, {
    method: 'POST',
    headers: { cookie },
  });
  assert.equal(res.status, 404);
});
