import { asc, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { courses, modules, questionOptions, questions } from './schema.ts';

/** Deliberately omits isCorrect. See Quiz below. */
export type QuizOption = { id: string; label: string; body: string };

export type QuizQuestion = {
  id: string;
  position: number;
  prompt: string;
  moduleTitle: string;
  options: QuizOption[];
};

/**
 * The learner-facing view of a quiz. It carries no isCorrect flag and no
 * explanation — those exist only in the graded result after submission.
 */
export type Quiz = {
  courseId: string;
  slug: string;
  title: string;
  passScore: number;
  questionCount: number;
  questions: QuizQuestion[];
};

export async function findQuizByCourseSlug(slug: string): Promise<Quiz | null> {
  const [course] = await db.select().from(courses).where(eq(courses.slug, slug)).limit(1);
  if (!course) return null;

  const rows = await db
    .select({
      questionId: questions.id,
      position: questions.position,
      prompt: questions.prompt,
      moduleTitle: modules.title,
      optionId: questionOptions.id,
      label: questionOptions.label,
      body: questionOptions.body,
    })
    .from(questions)
    .innerJoin(modules, eq(modules.id, questions.moduleId))
    .innerJoin(questionOptions, eq(questionOptions.questionId, questions.id))
    .where(eq(questions.courseId, course.id))
    .orderBy(asc(questions.position), asc(questionOptions.label));

  const byQuestion = new Map<string, QuizQuestion>();
  for (const r of rows) {
    let q = byQuestion.get(r.questionId);
    if (!q) {
      q = {
        id: r.questionId,
        position: r.position,
        prompt: r.prompt,
        moduleTitle: r.moduleTitle,
        options: [],
      };
      byQuestion.set(r.questionId, q);
    }
    q.options.push({ id: r.optionId, label: r.label, body: r.body });
  }

  return {
    courseId: course.id,
    slug: course.slug,
    title: course.title,
    passScore: course.passScore,
    questionCount: course.questionCount,
    questions: [...byQuestion.values()],
  };
}
