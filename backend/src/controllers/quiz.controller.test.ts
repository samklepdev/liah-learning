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
  const res = await fetch(`${baseUrl}/api/courses/${SLUG}/quiz`);
  assert.equal(res.status, 401);
});

test('GET quiz returns ten questions in order with four options each', async () => {
  const res = await fetch(`${baseUrl}/api/courses/${SLUG}/quiz`, { headers: { cookie } });
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
  const res = await fetch(`${baseUrl}/api/courses/${SLUG}/quiz`, { headers: { cookie } });
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
  const res = await fetch(`${baseUrl}/api/courses/not-a-course/quiz`, {
    headers: { cookie },
  });
  assert.equal(res.status, 404);
});
