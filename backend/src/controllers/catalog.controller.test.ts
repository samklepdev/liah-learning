import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { resetDb, closeDb } from '../test/helpers/db.ts';
import { startTestServer, registerTestUser } from '../test/helpers/server.ts';
import { seedSubject } from '../scripts/seed-quizzes.ts';
import { courses } from '../models/schema.ts';
import type { ParsedSubject } from '../lib/quiz-parser.ts';

const subject: ParsedSubject = JSON.parse(
  readFileSync(new URL('../data/chassis.quiz.json', import.meta.url), 'utf8'),
);

let baseUrl: string;
let close: () => Promise<void>;

before(async () => {
  await resetDb();
  await seedSubject(subject);
  ({ baseUrl, close } = await startTestServer());
});

after(async () => {
  await close();
  await closeDb();
});

test('GET /api/v1/subjects lists subjects with course counts', async () => {
  const res = await fetch(`${baseUrl}/api/v1/subjects`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { subjects: Array<Record<string, unknown>> };
  assert.equal(body.subjects.length, 1);
  assert.equal(body.subjects[0]?.slug, 'chassis');
  assert.equal(body.subjects[0]?.courseCount, 11);
});

test('GET /api/v1/courses returns courses in order, no best score when anonymous', async () => {
  const res = await fetch(`${baseUrl}/api/v1/courses?subject=chassis`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { courses: Array<Record<string, unknown>> };
  assert.equal(body.courses.length, 11);
  assert.equal(body.courses[0]?.position, 1);
  assert.equal(body.courses[0]?.slug, 'chassis-tire-and-rim-essentials');
  assert.equal(body.courses[0]?.questionCount, 10);
  assert.equal(body.courses[0]?.passScore, 9);
  assert.equal(body.courses[0]?.bestScore, null);
});

test('GET /api/v1/courses includes bestScore for a signed-in user', async () => {
  const { cookie } = await registerTestUser(baseUrl, 'catalog');
  const res = await fetch(`${baseUrl}/api/v1/courses?subject=chassis`, {
    headers: { cookie },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { courses: Array<Record<string, unknown>> };
  assert.equal(body.courses[0]?.bestScore, null);
  assert.equal(body.courses[0]?.attemptCount, 0);
});

test('GET /api/v1/courses 404s for an unknown subject', async () => {
  const res = await fetch(`${baseUrl}/api/v1/courses?subject=nope`);
  assert.equal(res.status, 404);
});

test('an unknown /api/v1 route answers with JSON, not the SPA fallback', async () => {
  // The notFound handler is scoped to /api/v1 so the SPA fallback can own every
  // other path. If that scoping is lost, unknown API routes start returning
  // index.html and the frontend's error handling breaks silently.
  const res = await fetch(`${baseUrl}/api/v1/nope`);
  assert.equal(res.status, 404);
  assert.match(res.headers.get('content-type') ?? '', /application\/json/);
  assert.deepEqual(await res.json(), { error: 'Not found' });
});

test('GET /api/v1/courses excludes a soft-deleted course', async () => {
  const [course] = await db
    .select({ id: courses.id })
    .from(courses)
    .where(eq(courses.slug, 'chassis-tire-and-rim-essentials'));
  await db
    .update(courses)
    .set({ isActive: false, deletedAt: new Date() })
    .where(eq(courses.id, course!.id));

  const res = await fetch(`${baseUrl}/api/v1/courses?subject=chassis`);
  const body = (await res.json()) as { courses: Array<{ slug: string }> };
  assert.equal(body.courses.length, 10);
  assert.equal(body.courses.some((c) => c.slug === 'chassis-tire-and-rim-essentials'), false);

  // Reset so later tests in this file see the full seeded set again.
  await db.update(courses).set({ isActive: true, deletedAt: null }).where(eq(courses.id, course!.id));
});

test('GET /api/v1/subjects excludes a soft-deleted course from the count', async () => {
  const [course] = await db
    .select({ id: courses.id })
    .from(courses)
    .where(eq(courses.slug, 'chassis-tire-and-rim-essentials'));
  await db
    .update(courses)
    .set({ isActive: false, deletedAt: new Date() })
    .where(eq(courses.id, course!.id));

  const res = await fetch(`${baseUrl}/api/v1/subjects`);
  const body = (await res.json()) as { subjects: Array<{ courseCount: number }> };
  assert.equal(body.subjects[0]?.courseCount, 10);

  await db.update(courses).set({ isActive: true, deletedAt: null }).where(eq(courses.id, course!.id));
});

test('GET /api/v1/search matches subject and course titles', async () => {
  const res = await fetch(`${baseUrl}/api/v1/search?q=tire`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    subjects: Array<{ slug: string }>;
    courses: Array<{ slug: string; subjectSlug: string; subjectTitle: string }>;
  };
  assert.equal(body.subjects.length, 0);
  assert.equal(body.courses.length, 2);
  assert.equal(
    body.courses.some((c) => c.slug === 'chassis-tire-and-rim-essentials'),
    true,
  );
  assert.equal(body.courses[0]?.subjectSlug, 'chassis');
  assert.equal(body.courses[0]?.subjectTitle, 'Chassis');
});

test('GET /api/v1/search matches a subject title', async () => {
  const res = await fetch(`${baseUrl}/api/v1/search?q=chas`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { subjects: Array<{ slug: string }> };
  assert.equal(body.subjects.length, 1);
  assert.equal(body.subjects[0]?.slug, 'chassis');
});

test('GET /api/v1/search is case-insensitive', async () => {
  const res = await fetch(`${baseUrl}/api/v1/search?q=TIRE`);
  const body = (await res.json()) as { courses: unknown[] };
  assert.equal(body.courses.length, 2);
});

test('GET /api/v1/search excludes a soft-deleted course', async () => {
  const [course] = await db
    .select({ id: courses.id })
    .from(courses)
    .where(eq(courses.slug, 'chassis-tire-and-rim-essentials'));
  await db
    .update(courses)
    .set({ isActive: false, deletedAt: new Date() })
    .where(eq(courses.id, course!.id));

  const res = await fetch(`${baseUrl}/api/v1/search?q=tire`);
  const body = (await res.json()) as { courses: Array<{ slug: string }> };
  assert.equal(
    body.courses.some((c) => c.slug === 'chassis-tire-and-rim-essentials'),
    false,
  );

  await db.update(courses).set({ isActive: true, deletedAt: null }).where(eq(courses.id, course!.id));
});

test('GET /api/v1/search treats a wildcard character literally', async () => {
  const res = await fetch(`${baseUrl}/api/v1/search?q=${encodeURIComponent('%')}`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { subjects: unknown[]; courses: unknown[] };
  assert.equal(body.subjects.length, 0);
  assert.equal(body.courses.length, 0);
});

test('GET /api/v1/search returns empty results for a 1-character query', async () => {
  const res = await fetch(`${baseUrl}/api/v1/search?q=t`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { subjects: unknown[]; courses: unknown[] };
  assert.equal(body.subjects.length, 0);
  assert.equal(body.courses.length, 0);
});

test('GET /api/v1/search 400s when q is missing', async () => {
  const res = await fetch(`${baseUrl}/api/v1/search`);
  assert.equal(res.status, 400);
});
