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

async function getQuiz(): Promise<any> {
  const res = await fetch(`${baseUrl}/api/courses/${SLUG}/quiz`, { headers: { cookie } });
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
  const res = await fetch(`${baseUrl}/api/courses/${SLUG}/attempts`, { method: 'POST' });
  assert.equal(res.status, 401);
});

test('POST attempts starts an attempt, and repeating resumes the same one', async () => {
  const first = await fetch(`${baseUrl}/api/courses/${SLUG}/attempts`, {
    method: 'POST',
    headers: { cookie },
  });
  assert.equal(first.status, 201);
  const a = (await first.json()) as { attempt: { id: string; submittedAt: string | null } };
  assert.equal(a.attempt.submittedAt, null);

  const second = await fetch(`${baseUrl}/api/courses/${SLUG}/attempts`, {
    method: 'POST',
    headers: { cookie },
  });
  assert.equal(second.status, 200);
  const b = (await second.json()) as { attempt: { id: string } };
  assert.equal(b.attempt.id, a.attempt.id, 'should resume, not create a second attempt');
});

test('PUT answer saves a selection and is idempotent', async () => {
  const quiz = await getQuiz();
  const res0 = await fetch(`${baseUrl}/api/courses/${SLUG}/attempts`, {
    method: 'POST',
    headers: { cookie },
  });
  const { attempt } = (await res0.json()) as { attempt: { id: string } };

  const q = quiz.questions[0];
  const save = async (optionId: string) =>
    fetch(`${baseUrl}/api/attempts/${attempt.id}/answers/${q.id}`, {
      method: 'PUT',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ optionId }),
    });

  assert.equal((await save(q.options[1].id)).status, 204);
  assert.equal((await save(q.options[0].id)).status, 204);

  const res = await fetch(`${baseUrl}/api/attempts/${attempt.id}`, { headers: { cookie } });
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    attempt: { answers: Array<{ questionId: string; optionId: string }> };
  };
  assert.equal(body.attempt.answers.length, 1, 'changing an answer must not add a row');
  assert.equal(body.attempt.answers[0]?.optionId, q.options[0].id);
});

test('PUT answer rejects an option that belongs to another question', async () => {
  const quiz = await getQuiz();
  const res0 = await fetch(`${baseUrl}/api/courses/${SLUG}/attempts`, {
    method: 'POST',
    headers: { cookie },
  });
  const { attempt } = (await res0.json()) as { attempt: { id: string } };

  const res = await fetch(
    `${baseUrl}/api/attempts/${attempt.id}/answers/${quiz.questions[0].id}`,
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
  const res0 = await fetch(`${baseUrl}/api/courses/${SLUG}/attempts`, {
    method: 'POST',
    headers: { cookie },
  });
  const { attempt } = (await res0.json()) as { attempt: { id: string } };
  await fetch(`${baseUrl}/api/attempts/${attempt.id}/answers/${quiz.questions[0].id}`, {
    method: 'PUT',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ optionId: quiz.questions[0].options[0].id }),
  });

  const raw = await (
    await fetch(`${baseUrl}/api/attempts/${attempt.id}`, { headers: { cookie } })
  ).text();
  assert.ok(!raw.includes('isCorrect'), 'in-progress attempt leaked correctness');
  assert.ok(!raw.includes('explanation'), 'in-progress attempt leaked explanations');
});

test("another user's attempt is a 404", async () => {
  const res0 = await fetch(`${baseUrl}/api/courses/${SLUG}/attempts`, {
    method: 'POST',
    headers: { cookie },
  });
  const { attempt } = (await res0.json()) as { attempt: { id: string } };

  const other = await registerTestUser(baseUrl, 'intruder@example.com');
  const res = await fetch(`${baseUrl}/api/attempts/${attempt.id}`, {
    headers: { cookie: other.cookie },
  });
  assert.equal(res.status, 404);
});
