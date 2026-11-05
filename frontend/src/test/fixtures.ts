import type {
  CourseHistory,
  CourseSummary,
  GradedAttempt,
  GradedQuestion,
  ProgressCourse,
  Quiz,
  QuizQuestion,
} from '../quiz/api';

/** Three questions rather than ten — enough to exercise navigation and review. */
export function makeQuiz(overrides: Partial<Quiz> = {}): Quiz {
  const questions: QuizQuestion[] = [1, 2, 3].map((n) => ({
    id: `q${n}`,
    position: n,
    prompt: `Question ${n} prompt?`,
    moduleTitle: `Module ${n}`,
    options: (['A', 'B', 'C', 'D'] as const).map((label) => ({
      id: `q${n}-${label}`,
      label,
      body: `Answer ${label} for ${n}`,
    })),
  }));

  return {
    courseId: 'course-1',
    slug: 'chassis-tire-and-rim-essentials',
    title: 'Tire and Rim Essentials',
    passScore: 3,
    questionCount: 3,
    questions,
    ...overrides,
  };
}

export function makeCourse(overrides: Partial<CourseSummary> = {}): CourseSummary {
  return {
    id: 'course-1',
    slug: 'chassis-tire-and-rim-essentials',
    title: 'Tire and Rim Essentials',
    position: 1,
    passScore: 9,
    questionCount: 10,
    bestScore: null,
    attemptCount: 0,
    ...overrides,
  };
}

export function makeCourseHistory(
  overrides: Partial<CourseHistory> = {},
): CourseHistory {
  return { bestScore: null, attemptCount: 0, ...overrides };
}

/**
 * Two correct, one missed — the shape the results screen has to render both
 * branches of.
 */
export function makeGradedAttempt(overrides: Partial<GradedAttempt> = {}): GradedAttempt {
  const questions: GradedQuestion[] = [1, 2, 3].map((n) => {
    const wasCorrect = n !== 2;
    return {
      id: `q${n}`,
      position: n,
      prompt: `Question ${n} prompt?`,
      moduleTitle: `Module ${n}`,
      explanation: `Because of reason ${n}.`,
      selectedOptionId: wasCorrect ? `q${n}-A` : `q${n}-B`,
      wasCorrect,
      options: (['A', 'B', 'C', 'D'] as const).map((label) => ({
        id: `q${n}-${label}`,
        label,
        body: `Answer ${label} for ${n}`,
        isCorrect: label === 'A',
      })),
    };
  });

  return {
    id: 'attempt-1',
    courseSlug: 'chassis-tire-and-rim-essentials',
    courseTitle: 'Tire and Rim Essentials',
    subjectSlug: 'chassis',
    score: 2,
    questionCount: 3,
    passScore: 3,
    previousBest: null,
    submittedAt: '2026-11-02T12:00:00.000Z',
    modulesToReview: ['Module 2'],
    questions,
    ...overrides,
  };
}

export function makeProgressRow(overrides: Partial<ProgressCourse> = {}): ProgressCourse {
  return {
    courseId: 'course-1',
    courseTitle: 'Tire and Rim Essentials',
    courseSlug: 'chassis-tire-and-rim-essentials',
    subjectSlug: 'chassis',
    passScore: 9,
    questionCount: 10,
    bestScore: 8,
    attemptCount: 2,
    lastAttemptId: 'attempt-1',
    lastSubmittedAt: '2026-11-02T12:00:00.000Z',
    ...overrides,
  };
}
