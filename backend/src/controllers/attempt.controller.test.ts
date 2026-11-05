import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resetDb, closeDb } from '../test/helpers/db.ts';
import { startTestServer, registerTestUser } from '../test/helpers/server.ts';
import { seedSubject } from '../scripts/seed-quizzes.ts';
import { insertOpenAttempt, startOrResumeAttempt } from '../models/attempt.model.ts';
import { findQuizByCourseSlug } from '../models/quiz.model.ts';
import type { ParsedSubject } from '../lib/quiz-parser.ts';

const subject: ParsedSubject = JSON.parse(
  readFileSync(new URL('../data/chassis.quiz.json', import.meta.url), 'utf8'),
);
const SLUG = 'chassis-tire-and-rim-essentials';

let baseUrl: string;
let close: () => Promise<void>;
let cookie: string;

async function getQuiz(): Promise<any> {
  const res = await fetch(`${baseUrl}/api/v1/courses/${SLUG}/quiz`, { headers: { cookie } });
  return ((await res.json()) as any).quiz;
}

before(async () => {
  await resetDb();
  await seedSubject(subject);
  ({ baseUrl, close } = await startTestServer());
  ({ cookie } = await registerTestUser(baseUrl, 'attempt@example.com'));
});

after(async () => {
  await close();
  await closeDb();
});

test('POST attempts requires a session', async () => {
  const res = await fetch(`${baseUrl}/api/v1/courses/${SLUG}/attempts`, { method: 'POST' });
  assert.equal(res.status, 401);
});

test('POST attempts starts an attempt, and repeating resumes the same one', async () => {
  const first = await fetch(`${baseUrl}/api/v1/courses/${SLUG}/attempts`, {
    method: 'POST',
    headers: { cookie },
  });
  assert.equal(first.status, 201);
  const a = (await first.json()) as { attempt: { id: string; submittedAt: string | null } };
  assert.equal(a.attempt.submittedAt, null);

  const second = await fetch(`${baseUrl}/api/v1/courses/${SLUG}/attempts`, {
    method: 'POST',
    headers: { cookie },
  });
  assert.equal(second.status, 200);
  const b = (await second.json()) as { attempt: { id: string } };
  assert.equal(b.attempt.id, a.attempt.id, 'should resume, not create a second attempt');
});

test('two concurrent starts yield one attempt, not a 500', async () => {
  // React StrictMode double-invokes effects, so the quiz page fires this twice
  // on every mount. A read-then-write has both requests miss the existing row
  // and both insert, tripping the one-open-attempt index.
  //
  // A fresh user is essential: with an attempt already open, both requests
  // take the resume path and the race never happens.
  const racer = await registerTestUser(baseUrl, 'racer@example.com');

  const [a, b] = await Promise.all([
    fetch(`${baseUrl}/api/v1/courses/${SLUG}/attempts`, {
      method: 'POST',
      headers: { cookie: racer.cookie },
    }),
    fetch(`${baseUrl}/api/v1/courses/${SLUG}/attempts`, {
      method: 'POST',
      headers: { cookie: racer.cookie },
    }),
  ]);

  assert.ok(a.status < 500, `first returned ${a.status}`);
  assert.ok(b.status < 500, `second returned ${b.status}`);

  const first = (await a.json()) as { attempt: { id: string } };
  const second = (await b.json()) as { attempt: { id: string } };
  assert.equal(first.attempt.id, second.attempt.id, 'both must resolve to one attempt');
});

test('the atomic insert refuses a second open attempt', async () => {
  // Deterministic cover for the conflict branch, rather than hoping to win a
  // race: the second insert must come back null, not throw, so the caller can
  // re-read the winner.
  const { userId } = await registerTestUser(baseUrl, 'atomic@example.com');
  const quiz = await findQuizByCourseSlug(SLUG);
  assert.ok(quiz);

  const first = await insertOpenAttempt(userId, quiz.courseId);
  assert.ok(first, 'first insert should succeed');

  const second = await insertOpenAttempt(userId, quiz.courseId);
  assert.equal(second, null, 'second insert must conflict, not throw');

  // And the caller recovers by returning the existing attempt.
  const resumed = await startOrResumeAttempt(userId, quiz.courseId);
  assert.equal(resumed.created, false);
  assert.equal(resumed.attempt.id, first.id);
});

test('submitting frees the slot, so a retake can start — the 500 path', async () => {
  // This is the exact sequence that returned an internal server error: finish
  // a quiz, then hit Retake. The index is partial on submitted_at IS NULL, so
  // submitting must free the slot for a fresh attempt.
  const owner = await registerTestUser(baseUrl, 'retaker@example.com');
  const quiz = await findQuizByCourseSlug(SLUG);
  assert.ok(quiz);

  const first = await insertOpenAttempt(owner.userId, quiz.courseId);
  assert.ok(first);

  const submitted = await fetch(`${baseUrl}/api/v1/attempts/${first.id}/submit`, {
    method: 'POST',
    headers: { cookie: owner.cookie },
  });
  assert.equal(submitted.status, 200);

  const retake = await startOrResumeAttempt(owner.userId, quiz.courseId);
  assert.equal(retake.created, true, 'a submitted attempt must not block a retake');
  assert.notEqual(retake.attempt.id, first.id);
  assert.equal(retake.attempt.submittedAt, null);
});

test('retaking through the API returns 201 for a fresh attempt', async () => {
  const owner = await registerTestUser(baseUrl, 'retaker2@example.com');

  const started = await fetch(`${baseUrl}/api/v1/courses/${SLUG}/attempts`, {
    method: 'POST',
    headers: { cookie: owner.cookie },
  });
  assert.equal(started.status, 201);
  const { attempt } = (await started.json()) as { attempt: { id: string } };

  await fetch(`${baseUrl}/api/v1/attempts/${attempt.id}/submit`, {
    method: 'POST',
    headers: { cookie: owner.cookie },
  });

  // Retake: the quiz page fires this twice per mount under StrictMode.
  const [a, b] = await Promise.all([
    fetch(`${baseUrl}/api/v1/courses/${SLUG}/attempts`, {
      method: 'POST',
      headers: { cookie: owner.cookie },
    }),
    fetch(`${baseUrl}/api/v1/courses/${SLUG}/attempts`, {
      method: 'POST',
      headers: { cookie: owner.cookie },
    }),
  ]);

  assert.ok(a.status < 500, `first retake returned ${a.status}`);
  assert.ok(b.status < 500, `second retake returned ${b.status}`);

  const one = (await a.json()) as { attempt: { id: string } };
  const two = (await b.json()) as { attempt: { id: string } };
  assert.equal(one.attempt.id, two.attempt.id);
  assert.notEqual(one.attempt.id, attempt.id, 'must be a new attempt, not the submitted one');
});

test('PUT answer saves a selection and is idempotent', async () => {
  const quiz = await getQuiz();
  const res0 = await fetch(`${baseUrl}/api/v1/courses/${SLUG}/attempts`, {
    method: 'POST',
    headers: { cookie },
  });
  const { attempt } = (await res0.json()) as { attempt: { id: string } };

  const q = quiz.questions[0];
  const save = async (optionId: string) =>
    fetch(`${baseUrl}/api/v1/attempts/${attempt.id}/answers/${q.id}`, {
      method: 'PUT',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ optionId }),
    });

  assert.equal((await save(q.options[1].id)).status, 204);
  assert.equal((await save(q.options[0].id)).status, 204);

  const res = await fetch(`${baseUrl}/api/v1/attempts/${attempt.id}`, { headers: { cookie } });
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    attempt: { answers: Array<{ questionId: string; optionId: string }> };
  };
  assert.equal(body.attempt.answers.length, 1, 'changing an answer must not add a row');
  assert.equal(body.attempt.answers[0]?.optionId, q.options[0].id);
});

test('PUT answer rejects an option that belongs to another question', async () => {
  const quiz = await getQuiz();
  const res0 = await fetch(`${baseUrl}/api/v1/courses/${SLUG}/attempts`, {
    method: 'POST',
    headers: { cookie },
  });
  const { attempt } = (await res0.json()) as { attempt: { id: string } };

  const res = await fetch(
    `${baseUrl}/api/v1/attempts/${attempt.id}/answers/${quiz.questions[0].id}`,
    {
      method: 'PUT',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ optionId: quiz.questions[1].options[0].id }),
    },
  );
  assert.equal(res.status, 400);
});

test("an in-progress attempt's answers do not reveal correctness", async () => {
  const quiz = await getQuiz();
  const res0 = await fetch(`${baseUrl}/api/v1/courses/${SLUG}/attempts`, {
    method: 'POST',
    headers: { cookie },
  });
  const { attempt } = (await res0.json()) as { attempt: { id: string } };
  await fetch(`${baseUrl}/api/v1/attempts/${attempt.id}/answers/${quiz.questions[0].id}`, {
    method: 'PUT',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ optionId: quiz.questions[0].options[0].id }),
  });

  const raw = await (
    await fetch(`${baseUrl}/api/v1/attempts/${attempt.id}`, { headers: { cookie } })
  ).text();
  assert.ok(!raw.includes('isCorrect'), 'in-progress attempt leaked correctness');
  assert.ok(!raw.includes('explanation'), 'in-progress attempt leaked explanations');
});

test("another user's attempt is a 404", async () => {
  const res0 = await fetch(`${baseUrl}/api/v1/courses/${SLUG}/attempts`, {
    method: 'POST',
    headers: { cookie },
  });
  const { attempt } = (await res0.json()) as { attempt: { id: string } };

  const other = await registerTestUser(baseUrl, 'intruder@example.com');
  const res = await fetch(`${baseUrl}/api/v1/attempts/${attempt.id}`, {
    headers: { cookie: other.cookie },
  });
  assert.equal(res.status, 404);
});
