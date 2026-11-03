import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { resetDb, closeDb } from '../test/helpers/db.ts';
import { seedSubject } from './seed-quizzes.ts';
import type { ParsedSubject } from '../lib/quiz-parser.ts';

const subject: ParsedSubject = JSON.parse(
  readFileSync(new URL('../data/chassis.quiz.json', import.meta.url), 'utf8'),
);

async function counts() {
  const r = await db.execute(sql`
    select
      (select count(*) from subjects)         as subjects,
      (select count(*) from courses)          as courses,
      (select count(*) from modules)          as modules,
      (select count(*) from questions)        as questions,
      (select count(*) from question_options) as options
  `);
  return r.rows[0] as Record<string, string>;
}

before(async () => {
  await resetDb();
});
beforeEach(async () => {
  await resetDb();
});
after(async () => {
  await closeDb();
});

test('seedSubject loads the whole pack', async () => {
  const result = await seedSubject(subject);
  assert.equal(result.courses, 11);
  assert.equal(result.questions, 110);

  const c = await counts();
  assert.equal(Number(c.subjects), 1);
  assert.equal(Number(c.courses), 11);
  assert.equal(Number(c.questions), 110);
  assert.equal(Number(c.options), 440);
});

test('seedSubject is idempotent', async () => {
  await seedSubject(subject);
  const first = await counts();
  await seedSubject(subject);
  const second = await counts();
  assert.deepEqual(second, first);
});
