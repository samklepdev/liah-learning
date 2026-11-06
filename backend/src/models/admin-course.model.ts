import { and, asc, desc, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { courses, subjects } from './schema.ts';

export type AdminCourse = {
  id: string;
  slug: string;
  title: string;
  position: number;
  passScore: number;
  questionCount: number;
  subjectSlug: string;
  subjectTitle: string;
  isActive: boolean;
  deletedAt: Date | null;
};

const columns = {
  id: courses.id,
  slug: courses.slug,
  title: courses.title,
  position: courses.position,
  passScore: courses.passScore,
  questionCount: courses.questionCount,
  subjectSlug: subjects.slug,
  subjectTitle: subjects.title,
  isActive: courses.isActive,
  deletedAt: courses.deletedAt,
};

export async function listCourses(): Promise<AdminCourse[]> {
  return db
    .select(columns)
    .from(courses)
    .innerJoin(subjects, eq(courses.subjectId, subjects.id))
    .where(eq(courses.isActive, true))
    .orderBy(asc(subjects.title), asc(courses.position));
}

/** Soft delete: only rows that are currently active can be deleted, so
 *  deleting an already-deleted course 404s instead of silently no-op-ing. */
export async function deleteCourseById(id: string): Promise<boolean> {
  const result = await db
    .update(courses)
    .set({ isActive: false, deletedAt: new Date() })
    .where(and(eq(courses.id, id), eq(courses.isActive, true)))
    .returning({ id: courses.id });
  return result.length > 0;
}

export async function listDeletedCourses(): Promise<AdminCourse[]> {
  return db
    .select(columns)
    .from(courses)
    .innerJoin(subjects, eq(courses.subjectId, subjects.id))
    .where(eq(courses.isActive, false))
    .orderBy(desc(courses.deletedAt));
}

/** Restore: only rows that are currently inactive can be restored. */
export async function restoreCourseById(id: string): Promise<AdminCourse | null> {
  const [updated] = await db
    .update(courses)
    .set({ isActive: true, deletedAt: null })
    .where(and(eq(courses.id, id), eq(courses.isActive, false)))
    .returning({ id: courses.id });
  if (!updated) return null;

  const [row] = await db
    .select(columns)
    .from(courses)
    .innerJoin(subjects, eq(courses.subjectId, subjects.id))
    .where(eq(courses.id, id));
  return row ?? null;
}
