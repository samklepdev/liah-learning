import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resetDb, closeDb } from '../test/helpers/db.ts';
import { startTestServer, registerTestUser } from '../test/helpers/server.ts';
import { seedSubject } from '../scripts/seed-quizzes.ts';
import type { ParsedSubject } from '../lib/quiz-parser.ts';

const subject: ParsedSubject = JSON.parse(
  readFileSync(new URL('../data/chassis.quiz.json', import.meta.url), 'utf8'),
);
const SLUG = 'chassis-tire-and-rim-essentials';

let baseUrl: string;
let close: () => Promise<void>;
let cookie: string;

before(async () => {
  await resetDb();
  await seedSubject(subject);
  ({ baseUrl, close } = await startTestServer());
  ({ cookie } = await registerTestUser(baseUrl, 'quiz@example.com'));
});

after(async () => {
  await close();
  await closeDb();
});

test('GET quiz requires a session', async () => {
  const res = await fetch(`${baseUrl}/api/v1/courses/${SLUG}/quiz`);
  assert.equal(res.status, 401);
});

test('GET quiz returns ten questions in order with four options each', async () => {
  const res = await fetch(`${baseUrl}/api/v1/courses/${SLUG}/quiz`, { headers: { cookie } });
  assert.equal(res.status, 200);
  const { quiz } = (await res.json()) as { quiz: Record<string, any> };

  assert.equal(quiz.slug, SLUG);
  assert.equal(quiz.passScore, 9);
  assert.equal(quiz.questions.length, 10);
  assert.deepEqual(
    quiz.questions.map((q: any) => q.position),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  );
  for (const q of quiz.questions) {
    assert.equal(q.options.length, 4);
    assert.deepEqual(
      q.options.map((o: any) => o.label),
      ['A', 'B', 'C', 'D'],
    );
  }
  assert.equal(quiz.questions[0].moduleTitle, 'Tire Technology');
});

test('GET quiz never leaks correct answers or explanations', async () => {
  const res = await fetch(`${baseUrl}/api/v1/courses/${SLUG}/quiz`, { headers: { cookie } });
  const raw = await res.text();

  assert.ok(!raw.includes('isCorrect'), 'payload contained isCorrect');
  assert.ok(!raw.includes('is_correct'), 'payload contained is_correct');
  assert.ok(!raw.includes('explanation'), 'payload contained explanation');
  assert.ok(
    !raw.includes('The R stands for radial construction'),
    'payload contained answer-key prose',
  );
});

test('GET quiz 404s for an unknown course', async () => {
  const res = await fetch(`${baseUrl}/api/v1/courses/not-a-course/quiz`, {
    headers: { cookie },
  });
  assert.equal(res.status, 404);
});

/** The quiz payload's per-user history block. */
async function fetchHistory(sessionCookie: string) {
  const res = await fetch(`${baseUrl}/api/v1/courses/${SLUG}/quiz`, {
    headers: { cookie: sessionCookie },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { history: Record<string, unknown> };
  return body.history;
}

/** Starts an attempt and returns its id. Answers nothing, so it scores zero. */
async function startAttempt(sessionCookie: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/courses/${SLUG}/attempts`, {
    method: 'POST',
    headers: { cookie: sessionCookie },
  });
  const { attempt } = (await res.json()) as { attempt: { id: string } };
  return attempt.id;
}

test('GET quiz reports no history before the first attempt', async () => {
  assert.deepEqual(await fetchHistory(cookie), { bestScore: null, attemptCount: 0 });
});

test('GET quiz counts a submitted attempt in the history', async () => {
  const id = await startAttempt(cookie);
  const res = await fetch(`${baseUrl}/api/v1/attempts/${id}/submit`, {
    method: 'POST',
    headers: { cookie },
  });
  assert.equal(res.status, 200);

  // Nothing was answered, so the score is a genuine zero — distinct from the
  // null above, which means "never attempted".
  assert.deepEqual(await fetchHistory(cookie), { bestScore: 0, attemptCount: 1 });
});

test('GET quiz does not count an attempt still in progress', async () => {
  await startAttempt(cookie);
  assert.deepEqual(await fetchHistory(cookie), { bestScore: 0, attemptCount: 1 });
});

test("GET quiz does not leak another user's history", async () => {
  const { cookie: otherCookie } = await registerTestUser(baseUrl, 'quiz-other@example.com');
  assert.deepEqual(await fetchHistory(otherCookie), { bestScore: null, attemptCount: 0 });
});
