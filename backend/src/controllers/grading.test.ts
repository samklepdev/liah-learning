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
const course1 = subject.courses.find((c) => c.slug === SLUG)!;

let baseUrl: string;
let close: () => Promise<void>;
let cookie: string;

/** Answers `correctCount` questions correctly and the rest wrong. Returns the attempt id. */
async function takeQuiz(sessionCookie: string, correctCount: number): Promise<string> {
  const quizRes = await fetch(`${baseUrl}/api/v1/courses/${SLUG}/quiz`, {
    headers: { cookie: sessionCookie },
  });
  const { quiz } = (await quizRes.json()) as any;

  const startRes = await fetch(`${baseUrl}/api/v1/courses/${SLUG}/attempts`, {
    method: 'POST',
    headers: { cookie: sessionCookie },
  });
  const { attempt } = (await startRes.json()) as any;

  for (const [i, q] of quiz.questions.entries()) {
    const expected = course1.questions.find((x) => x.position === q.position)!;
    const correctLabel = expected.options.find((o) => o.isCorrect)!.label;
    const label = i < correctCount ? correctLabel : correctLabel === 'A' ? 'B' : 'A';
    const option = q.options.find((o: any) => o.label === label);

    const res = await fetch(`${baseUrl}/api/v1/attempts/${attempt.id}/answers/${q.id}`, {
      method: 'PUT',
      headers: { cookie: sessionCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ optionId: option.id }),
    });
    assert.equal(res.status, 204);
  }
  return attempt.id;
}

before(async () => {
  await resetDb();
  await seedSubject(subject);
  ({ baseUrl, close } = await startTestServer());
  ({ cookie } = await registerTestUser(baseUrl, 'grading'));
});

after(async () => {
  await close();
  await closeDb();
});

test('submitting scores against the answer key', async () => {
  const attemptId = await takeQuiz(cookie, 8);

  const res = await fetch(`${baseUrl}/api/v1/attempts/${attemptId}/submit`, {
    method: 'POST',
    headers: { cookie },
  });
  assert.equal(res.status, 200);
  const { attempt } = (await res.json()) as any;
  assert.equal(attempt.score, 8);
  assert.equal(attempt.questionCount, 10);
  assert.equal(attempt.passScore, 9);
  // The results page links back to the subject's quiz list, so it needs the
  // subject slug — the course slug alone cannot address that route.
  assert.equal(attempt.subjectSlug, 'chassis');
});

test('the graded result carries explanations and modules to review', async () => {
  const res = await fetch(`${baseUrl}/api/v1/courses/${SLUG}/attempts`, {
    method: 'POST',
    headers: { cookie },
  });
  assert.equal(res.status, 201, 'previous attempt should be closed, so a new one starts');
  const { attempt: fresh } = (await res.json()) as any;

  // Answer only question 1, correctly; the other nine stay blank.
  const quiz = (await (
    await fetch(`${baseUrl}/api/v1/courses/${SLUG}/quiz`, { headers: { cookie } })
  ).json()) as any;
  const q1 = quiz.quiz.questions[0];
  const correct = course1.questions[0]!.options.find((o) => o.isCorrect)!.label;
  await fetch(`${baseUrl}/api/v1/attempts/${fresh.id}/answers/${q1.id}`, {
    method: 'PUT',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ optionId: q1.options.find((o: any) => o.label === correct).id }),
  });

  await fetch(`${baseUrl}/api/v1/attempts/${fresh.id}/submit`, {
    method: 'POST',
    headers: { cookie },
  });

  const graded = (await (
    await fetch(`${baseUrl}/api/v1/attempts/${fresh.id}`, { headers: { cookie } })
  ).json()) as any;

  assert.equal(graded.attempt.score, 1, 'unanswered questions count as wrong');
  assert.equal(graded.attempt.questions.length, 10);
  assert.equal(graded.attempt.previousBest, 8);

  const first = graded.attempt.questions[0];
  assert.equal(first.wasCorrect, true);
  assert.ok(first.explanation.length > 0);
  assert.ok(first.options.some((o: any) => o.isCorrect));

  const blank = graded.attempt.questions[1];
  assert.equal(blank.selectedOptionId, null);
  assert.equal(blank.wasCorrect, false);

  assert.ok(graded.attempt.modulesToReview.length > 0);
});

test('submitting twice is idempotent and does not regrade', async () => {
  const attemptId = await takeQuiz(cookie, 5);
  const first = await fetch(`${baseUrl}/api/v1/attempts/${attemptId}/submit`, {
    method: 'POST',
    headers: { cookie },
  });
  const a = (await first.json()) as any;

  const second = await fetch(`${baseUrl}/api/v1/attempts/${attemptId}/submit`, {
    method: 'POST',
    headers: { cookie },
  });
  assert.equal(second.status, 200);
  const b = (await second.json()) as any;
  assert.equal(b.attempt.score, a.attempt.score);
  assert.equal(b.attempt.submittedAt, a.attempt.submittedAt);
});

test("another user cannot submit someone else's attempt", async () => {
  const quizRes = await fetch(`${baseUrl}/api/v1/courses/${SLUG}/attempts`, {
    method: 'POST',
    headers: { cookie },
  });
  const { attempt } = (await quizRes.json()) as any;

  const other = await registerTestUser(baseUrl, 'thief');
  const res = await fetch(`${baseUrl}/api/v1/attempts/${attempt.id}/submit`, {
    method: 'POST',
    headers: { cookie: other.cookie },
  });
  assert.equal(res.status, 404);
});
