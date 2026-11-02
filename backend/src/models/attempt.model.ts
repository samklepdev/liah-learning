import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { attemptAnswers, attempts, questionOptions, questions } from './schema.ts';

export type AttemptRow = {
  id: string;
  userId: string;
  courseId: string;
  score: number | null;
  startedAt: Date;
  submittedAt: Date | null;
};

export type SavedAnswer = { questionId: string; optionId: string };

export async function findOpenAttempt(
  userId: string,
  courseId: string,
): Promise<AttemptRow | null> {
  const [row] = await db
    .select()
    .from(attempts)
    .where(
      and(
        eq(attempts.userId, userId),
        eq(attempts.courseId, courseId),
        isNull(attempts.submittedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Returns the caller's unfinished attempt if one exists, otherwise creates one.
 * A partial unique index guarantees at most one open attempt per user+course.
 */
export async function startOrResumeAttempt(
  userId: string,
  courseId: string,
): Promise<{ attempt: AttemptRow; created: boolean }> {
  const existing = await findOpenAttempt(userId, courseId);
  if (existing) return { attempt: existing, created: false };

  const [row] = await db.insert(attempts).values({ userId, courseId }).returning();
  return { attempt: row!, created: true };
}

export async function findAttemptById(id: string): Promise<AttemptRow | null> {
  const [row] = await db.select().from(attempts).where(eq(attempts.id, id)).limit(1);
  return row ?? null;
}

export async function listAnswers(attemptId: string): Promise<SavedAnswer[]> {
  return db
    .select({ questionId: attemptAnswers.questionId, optionId: attemptAnswers.optionId })
    .from(attemptAnswers)
    .where(eq(attemptAnswers.attemptId, attemptId));
}

/** Confirms the option really belongs to the question, and reports its course. */
export async function findOptionForQuestion(
  questionId: string,
  optionId: string,
): Promise<{ isCorrect: boolean; courseId: string } | null> {
  const [row] = await db
    .select({ isCorrect: questionOptions.isCorrect, courseId: questions.courseId })
    .from(questionOptions)
    .innerJoin(questions, eq(questions.id, questionOptions.questionId))
    .where(and(eq(questionOptions.id, optionId), eq(questionOptions.questionId, questionId)))
    .limit(1);
  return row ?? null;
}

export async function saveAnswer(
  attemptId: string,
  questionId: string,
  optionId: string,
  isCorrect: boolean,
): Promise<void> {
  await db
    .insert(attemptAnswers)
    .values({ attemptId, questionId, optionId, isCorrect })
    .onConflictDoUpdate({
      target: [attemptAnswers.attemptId, attemptAnswers.questionId],
      set: { optionId, isCorrect },
    });
}
