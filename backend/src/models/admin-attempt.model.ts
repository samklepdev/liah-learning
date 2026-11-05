import { count, desc, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { attemptAnswers, attempts, courses, subjects } from './schema.ts';

export type AdminAttemptRow = {
  id: string;
  courseTitle: string;
  courseSlug: string;
  subjectSlug: string;
  score: number | null;
  startedAt: Date;
  submittedAt: Date | null;
  /** Count of saved answers. Distinguishes an untouched open attempt (0) from one the learner has actually worked on. */
  answeredCount: number;
};

export async function listAttemptsForUser(userId: string): Promise<AdminAttemptRow[]> {
  const rows = await db
    .select({
      id: attempts.id,
      courseTitle: courses.title,
      courseSlug: courses.slug,
      subjectSlug: subjects.slug,
      score: attempts.score,
      startedAt: attempts.startedAt,
      submittedAt: attempts.submittedAt,
      answeredCount: count(attemptAnswers.id),
    })
    .from(attempts)
    .innerJoin(courses, eq(courses.id, attempts.courseId))
    .innerJoin(subjects, eq(subjects.id, courses.subjectId))
    .leftJoin(attemptAnswers, eq(attemptAnswers.attemptId, attempts.id))
    .where(eq(attempts.userId, userId))
    .groupBy(
      attempts.id,
      courses.title,
      courses.slug,
      subjects.slug,
      attempts.score,
      attempts.startedAt,
      attempts.submittedAt,
    )
    .orderBy(desc(attempts.startedAt));

  return rows.map((row) => ({ ...row, answeredCount: Number(row.answeredCount) }));
}
