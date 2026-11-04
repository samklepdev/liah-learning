import { desc, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { attempts, courses, subjects } from './schema.ts';

export type AdminAttemptRow = {
  id: string;
  courseTitle: string;
  courseSlug: string;
  subjectSlug: string;
  score: number | null;
  startedAt: Date;
  submittedAt: Date | null;
};

export async function listAttemptsForUser(userId: string): Promise<AdminAttemptRow[]> {
  return db
    .select({
      id: attempts.id,
      courseTitle: courses.title,
      courseSlug: courses.slug,
      subjectSlug: subjects.slug,
      score: attempts.score,
      startedAt: attempts.startedAt,
      submittedAt: attempts.submittedAt,
    })
    .from(attempts)
    .innerJoin(courses, eq(courses.id, attempts.courseId))
    .innerJoin(subjects, eq(subjects.id, courses.subjectId))
    .where(eq(attempts.userId, userId))
    .orderBy(desc(attempts.startedAt));
}
