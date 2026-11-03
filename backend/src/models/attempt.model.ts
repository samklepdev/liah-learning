import { and, asc, count, eq, isNotNull, isNull, max, ne } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  attemptAnswers,
  attempts,
  courses,
  modules,
  questionOptions,
  questions,
} from './schema.ts';

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
 * Creates an open attempt, or returns null if this user already has one for
 * this course. The conflict target matches the partial unique index, so
 * Postgres — not application code — decides the winner when two requests
 * insert at once.
 */
export async function insertOpenAttempt(
  userId: string,
  courseId: string,
): Promise<AttemptRow | null> {
  const [row] = await db
    .insert(attempts)
    .values({ userId, courseId })
    // `where` — not `targetWhere`. onConflictDoNothing only accepts
    // { target, where }, and silently drops targetWhere, which produces
    // `ON CONFLICT (cols) DO NOTHING` with no predicate. Postgres then fails
    // with "no unique or exclusion constraint matching the ON CONFLICT
    // specification", because the index is partial.
    .onConflictDoNothing({
      target: [attempts.userId, attempts.courseId],
      where: isNull(attempts.submittedAt),
    })
    .returning();

  return row ?? null;
}

/**
 * Returns the caller's unfinished attempt if one exists, otherwise creates one.
 *
 * Must not be a read-then-write: the quiz page fires this twice per mount
 * (React StrictMode double-invokes effects), and two requests that both read
 * "no open attempt" would both insert, tripping the one-open-attempt index and
 * surfacing as a 500 on retake. The insert is therefore atomic, and losing the
 * race just means re-reading whoever won.
 */
export async function startOrResumeAttempt(
  userId: string,
  courseId: string,
): Promise<{ attempt: AttemptRow; created: boolean }> {
  const existing = await findOpenAttempt(userId, courseId);
  if (existing) return { attempt: existing, created: false };

  const created = await insertOpenAttempt(userId, courseId);
  if (created) return { attempt: created, created: true };

  // Conflict: a concurrent request created it between our read and our insert.
  const winner = await findOpenAttempt(userId, courseId);
  if (winner) return { attempt: winner, created: false };

  // Neither inserted nor findable. Only reachable if the row was submitted in
  // the same instant, which would make a fresh attempt the right answer.
  const retried = await insertOpenAttempt(userId, courseId);
  if (retried) return { attempt: retried, created: true };

  throw new Error(
    `Could not open an attempt for user ${userId} on course ${courseId}: ` +
      'insert conflicted but no open attempt exists.',
  );
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

export type GradedOption = { id: string; label: string; body: string; isCorrect: boolean };

export type GradedQuestion = {
  id: string;
  position: number;
  prompt: string;
  moduleTitle: string;
  explanation: string;
  selectedOptionId: string | null;
  wasCorrect: boolean;
  options: GradedOption[];
};

export type GradedAttempt = {
  id: string;
  courseSlug: string;
  courseTitle: string;
  score: number;
  questionCount: number;
  passScore: number;
  previousBest: number | null;
  submittedAt: Date;
  modulesToReview: string[];
  questions: GradedQuestion[];
};

/**
 * Grades and closes the attempt. Score is the count of answers already flagged
 * correct at save time, so unanswered questions simply never contribute.
 * Returns the score. Caller must ensure the attempt is still open.
 */
export async function submitAttempt(attemptId: string): Promise<number> {
  const [row] = await db
    .select({ correct: count() })
    .from(attemptAnswers)
    .where(and(eq(attemptAnswers.attemptId, attemptId), eq(attemptAnswers.isCorrect, true)));

  const score = Number(row?.correct ?? 0);

  await db
    .update(attempts)
    .set({ score, submittedAt: new Date() })
    .where(and(eq(attempts.id, attemptId), isNull(attempts.submittedAt)));

  return score;
}

/** Best submitted score for this user and course, excluding the given attempt. */
export async function findBestScoreBefore(
  userId: string,
  courseId: string,
  attemptId: string,
): Promise<number | null> {
  const [row] = await db
    .select({ best: max(attempts.score) })
    .from(attempts)
    .where(
      and(
        eq(attempts.userId, userId),
        eq(attempts.courseId, courseId),
        isNotNull(attempts.submittedAt),
        ne(attempts.id, attemptId),
      ),
    );
  return row?.best === null || row?.best === undefined ? null : Number(row.best);
}

export async function findGradedAttempt(attemptId: string): Promise<GradedAttempt | null> {
  const attempt = await findAttemptById(attemptId);
  if (!attempt || attempt.submittedAt === null) return null;

  const [course] = await db
    .select()
    .from(courses)
    .where(eq(courses.id, attempt.courseId))
    .limit(1);
  if (!course) return null;

  const rows = await db
    .select({
      questionId: questions.id,
      position: questions.position,
      prompt: questions.prompt,
      explanation: questions.explanation,
      moduleTitle: modules.title,
      optionId: questionOptions.id,
      label: questionOptions.label,
      body: questionOptions.body,
      isCorrect: questionOptions.isCorrect,
      selectedOptionId: attemptAnswers.optionId,
    })
    .from(questions)
    .innerJoin(modules, eq(modules.id, questions.moduleId))
    .innerJoin(questionOptions, eq(questionOptions.questionId, questions.id))
    .leftJoin(
      attemptAnswers,
      and(
        eq(attemptAnswers.questionId, questions.id),
        eq(attemptAnswers.attemptId, attemptId),
      ),
    )
    .where(eq(questions.courseId, attempt.courseId))
    .orderBy(asc(questions.position), asc(questionOptions.label));

  const byQuestion = new Map<string, GradedQuestion>();
  for (const r of rows) {
    let q = byQuestion.get(r.questionId);
    if (!q) {
      q = {
        id: r.questionId,
        position: r.position,
        prompt: r.prompt,
        moduleTitle: r.moduleTitle,
        explanation: r.explanation,
        selectedOptionId: r.selectedOptionId ?? null,
        wasCorrect: false,
        options: [],
      };
      byQuestion.set(r.questionId, q);
    }
    if (r.selectedOptionId) q.selectedOptionId = r.selectedOptionId;
    q.options.push({ id: r.optionId, label: r.label, body: r.body, isCorrect: r.isCorrect });
  }

  const graded = [...byQuestion.values()].map((q) => ({
    ...q,
    wasCorrect:
      q.selectedOptionId !== null &&
      q.options.some((o) => o.id === q.selectedOptionId && o.isCorrect),
  }));

  const modulesToReview = [
    ...new Set(graded.filter((q) => !q.wasCorrect).map((q) => q.moduleTitle)),
  ];

  return {
    id: attempt.id,
    courseSlug: course.slug,
    courseTitle: course.title,
    score: attempt.score ?? 0,
    questionCount: course.questionCount,
    passScore: course.passScore,
    previousBest: await findBestScoreBefore(attempt.userId, attempt.courseId, attempt.id),
    submittedAt: attempt.submittedAt,
    modulesToReview,
    questions: graded,
  };
}
