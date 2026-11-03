import { sql } from 'drizzle-orm';
import { db, pool } from '../../db/index.ts';
import { env } from '../../config/env.ts';

if (!env.DATABASE_URL.endsWith('_test')) {
  throw new Error(
    `Refusing to run tests against ${env.DATABASE_URL} — the database name must end in _test.`,
  );
}

/** Empties every table. Safe only against the _test database. */
export async function resetDb(): Promise<void> {
  await db.execute(sql`
    truncate table attempt_answers, attempts, question_options, questions,
                   modules, courses, subjects, sessions, users
    restart identity cascade
  `);
}

export async function closeDb(): Promise<void> {
  await pool.end();
}
