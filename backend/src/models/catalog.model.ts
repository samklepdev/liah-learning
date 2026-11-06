import { and, asc, count, eq, isNotNull, max, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { attempts, courses, subjects } from './schema.ts';

export type SubjectSummary = {
  id: string;
  slug: string;
  title: string;
  courseCount: number;
};

export async function listSubjects(): Promise<SubjectSummary[]> {
  const rows = await db
    .select({
      id: subjects.id,
      slug: subjects.slug,
      title: subjects.title,
      courseCount: count(courses.id),
    })
    .from(subjects)
    .leftJoin(courses, and(eq(courses.subjectId, subjects.id), eq(courses.isActive, true)))
    .groupBy(subjects.id, subjects.slug, subjects.title)
    .orderBy(asc(subjects.title));

  return rows.map((r) => ({ ...r, courseCount: Number(r.courseCount) }));
}

export type CourseSummary = {
  id: string;
  slug: string;
  title: string;
  position: number;
  passScore: number;
  questionCount: number;
  bestScore: number | null;
  attemptCount: number;
};

export async function findSubjectBySlug(slug: string) {
  const [row] = await db.select().from(subjects).where(eq(subjects.slug, slug)).limit(1);
  return row ?? null;
}

/**
 * Courses in a subject. When userId is null the per-user columns are zeroed
 * rather than omitted, so the response shape never changes.
 */
export async function listCoursesBySubject(
  subjectSlug: string,
  userId: string | null,
): Promise<CourseSummary[]> {
  const subject = await findSubjectBySlug(subjectSlug);
  if (!subject) return [];

  const rows = await db
    .select({
      id: courses.id,
      slug: courses.slug,
      title: courses.title,
      position: courses.position,
      passScore: courses.passScore,
      questionCount: courses.questionCount,
      bestScore: max(attempts.score),
      attemptCount: count(attempts.id),
    })
    .from(courses)
    .leftJoin(
      attempts,
      userId
        ? and(
            eq(attempts.courseId, courses.id),
            eq(attempts.userId, userId),
            isNotNull(attempts.submittedAt),
          )
        : sql`false`,
    )
    .where(and(eq(courses.subjectId, subject.id), eq(courses.isActive, true)))
    .groupBy(
      courses.id,
      courses.slug,
      courses.title,
      courses.position,
      courses.passScore,
      courses.questionCount,
    )
    .orderBy(asc(courses.position));

  return rows.map((r) => ({
    ...r,
    bestScore: r.bestScore === null ? null : Number(r.bestScore),
    attemptCount: Number(r.attemptCount),
  }));
}
