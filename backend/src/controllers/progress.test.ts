import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resetDb, closeDb } from '../test/helpers/db.ts';
import { startTestServer, registerTestUser } from '../test/helpers/server.ts';
import { seedSubject } from '../scripts/seed-quizzes.ts';
import type { ParsedCourse, ParsedSubject } from '../lib/quiz-parser.ts';

const subject: ParsedSubject = JSON.parse(
  readFileSync(new URL('../data/chassis.quiz.json', import.meta.url), 'utf8'),
);
const SLUG_1 = 'chassis-tire-and-rim-essentials';
const SLUG_2 = 'chassis-best-practice-tire-fitment';
const course1 = subject.courses.find((c) => c.slug === SLUG_1)!;
const course2 = subject.courses.find((c) => c.slug === SLUG_2)!;

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

/** Answers `correctCount` questions correctly and the rest wrong, then submits. */
async function takeQuiz(
  sessionCookie: string,
  slug: string,
  course: ParsedCourse,
  correctCount: number,
): Promise<{ id: string; score: number }> {
  const quizRes = await fetch(`${baseUrl}/api/courses/${slug}/quiz`, {
    headers: { cookie: sessionCookie },
  });
  const { quiz } = (await quizRes.json()) as any;

  const startRes = await fetch(`${baseUrl}/api/courses/${slug}/attempts`, {
    method: 'POST',
    headers: { cookie: sessionCookie },
  });
  const { attempt } = (await startRes.json()) as any;

  for (const [i, q] of quiz.questions.entries()) {
    const expected = course.questions.find((x) => x.position === q.position)!;
    const correctLabel = expected.options.find((o) => o.isCorrect)!.label;
    const label = i < correctCount ? correctLabel : correctLabel === 'A' ? 'B' : 'A';
    const option = q.options.find((o: any) => o.label === label);

    await fetch(`${baseUrl}/api/attempts/${attempt.id}/answers/${q.id}`, {
      method: 'PUT',
      headers: { cookie: sessionCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ optionId: option.id }),
    });
  }

  const submitRes = await fetch(`${baseUrl}/api/attempts/${attempt.id}/submit`, {
    method: 'POST',
    headers: { cookie: sessionCookie },
  });
  const { attempt: graded } = (await submitRes.json()) as any;
  return { id: attempt.id, score: graded.score };
}

test('GET /me/progress requires a session', async () => {
  const res = await fetch(`${baseUrl}/api/me/progress`);
  assert.equal(res.status, 401);
});

test('an unattempted account sees an empty list', async () => {
  const { cookie } = await registerTestUser(baseUrl, 'fresh@example.com');
  const res = await fetch(`${baseUrl}/api/me/progress`, { headers: { cookie } });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { courses: unknown[] };
  assert.deepEqual(body.courses, []);
});

test('tracks best score and attempt count independently of the most recent attempt', async () => {
  const { cookie } = await registerTestUser(baseUrl, 'retaker@example.com');

  await takeQuiz(cookie, SLUG_1, course1, 8);
  const second = await takeQuiz(cookie, SLUG_1, course1, 5);

  const res = await fetch(`${baseUrl}/api/me/progress`, { headers: { cookie } });
  const body = (await res.json()) as { courses: any[] };
  assert.equal(body.courses.length, 1);
  const row = body.courses[0];
  assert.equal(row.courseSlug, SLUG_1);
  assert.equal(row.subjectSlug, 'chassis');
  assert.equal(row.bestScore, 8, 'best score must survive a worse retake');
  assert.equal(row.attemptCount, 2);
  assert.equal(row.lastAttemptId, second.id, 'last attempt must be the most recent submission');
});

test('lists multiple courses, newest completion first', async () => {
  const { cookie } = await registerTestUser(baseUrl, 'multi@example.com');

  await takeQuiz(cookie, SLUG_1, course1, 6);
  await takeQuiz(cookie, SLUG_2, course2, 9);

  const res = await fetch(`${baseUrl}/api/me/progress`, { headers: { cookie } });
  const body = (await res.json()) as { courses: any[] };
  assert.equal(body.courses.length, 2);
  assert.equal(body.courses[0].courseSlug, SLUG_2, 'most recently completed course comes first');
  assert.equal(body.courses[1].courseSlug, SLUG_1);
});

test("one user's progress never includes another user's attempts", async () => {
  const mine = await registerTestUser(baseUrl, 'mine@example.com');
  const other = await registerTestUser(baseUrl, 'other@example.com');

  await takeQuiz(other.cookie, SLUG_1, course1, 7);

  const res = await fetch(`${baseUrl}/api/me/progress`, { headers: { cookie: mine.cookie } });
  const body = (await res.json()) as { courses: unknown[] };
  assert.deepEqual(body.courses, []);
});

test('an open, unsubmitted attempt does not appear', async () => {
  const { cookie } = await registerTestUser(baseUrl, 'inprogress@example.com');

  await fetch(`${baseUrl}/api/courses/${SLUG_1}/attempts`, {
    method: 'POST',
    headers: { cookie },
  });

  const res = await fetch(`${baseUrl}/api/me/progress`, { headers: { cookie } });
  const body = (await res.json()) as { courses: unknown[] };
  assert.deepEqual(body.courses, []);
});
