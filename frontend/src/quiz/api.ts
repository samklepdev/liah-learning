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

export type QuizOption = { id: string; label: string; body: string };

export type QuizQuestion = {
  id: string;
  position: number;
  prompt: string;
  moduleTitle: string;
  options: QuizOption[];
};

export type Quiz = {
  courseId: string;
  slug: string;
  title: string;
  passScore: number;
  questionCount: number;
  questions: QuizQuestion[];
};

export type OpenAttempt = {
  id: string;
  courseId: string;
  startedAt: string;
  submittedAt: null;
  answers: Array<{ questionId: string; optionId: string }>;
};

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
  submittedAt: string;
  modulesToReview: string[];
  questions: GradedQuestion[];
};

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}) as Record<string, unknown>);
  if (!res.ok) {
    const message = typeof body.error === 'string' ? body.error : res.statusText;
    throw new ApiError(message, res.status);
  }
  return body as T;
}

export const quizApi = {
  listCourses: (subject: string) =>
    request<{ courses: CourseSummary[] }>(`/courses?subject=${encodeURIComponent(subject)}`),

  getQuiz: (slug: string) => request<{ quiz: Quiz }>(`/courses/${slug}/quiz`),

  startAttempt: (slug: string) =>
    request<{ attempt: { id: string } }>(`/courses/${slug}/attempts`, { method: 'POST' }),

  getAttempt: (id: string) =>
    request<{ attempt: OpenAttempt | GradedAttempt }>(`/attempts/${id}`),

  saveAnswer: (attemptId: string, questionId: string, optionId: string) =>
    request<void>(`/attempts/${attemptId}/answers/${questionId}`, {
      method: 'PUT',
      body: JSON.stringify({ optionId }),
    }),

  submit: (attemptId: string) =>
    request<{ attempt: GradedAttempt }>(`/attempts/${attemptId}/submit`, { method: 'POST' }),
};
