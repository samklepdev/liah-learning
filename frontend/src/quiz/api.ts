import { ApiError, request } from '../lib/apiClient';
export { ApiError };

export type SubjectSummary = {
  id: string;
  slug: string;
  title: string;
  courseCount: number;
};

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

export type SearchCourseResult = CourseSummary & { subjectSlug: string; subjectTitle: string };

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

/** The caller's record on one course. bestScore is null when never submitted. */
export type CourseHistory = {
  bestScore: number | null;
  attemptCount: number;
};

export type ProgressCourse = {
  courseId: string;
  courseTitle: string;
  courseSlug: string;
  subjectSlug: string;
  passScore: number;
  questionCount: number;
  bestScore: number;
  attemptCount: number;
  lastAttemptId: string;
  lastSubmittedAt: string;
};

export type GradedAttempt = {
  id: string;
  courseSlug: string;
  courseTitle: string;
  subjectSlug: string;
  score: number;
  questionCount: number;
  passScore: number;
  previousBest: number | null;
  submittedAt: string;
  modulesToReview: string[];
  questions: GradedQuestion[];
};

export const quizApi = {
  listSubjects: () => request<{ subjects: SubjectSummary[] }>('/subjects'),

  listCourses: (subject: string) =>
    request<{ courses: CourseSummary[] }>(`/courses?subject=${encodeURIComponent(subject)}`),

  search: (q: string) =>
    request<{ subjects: SubjectSummary[]; courses: SearchCourseResult[] }>(
      `/search?q=${encodeURIComponent(q)}`,
    ),

  getQuiz: (slug: string) =>
    request<{ quiz: Quiz; history: CourseHistory }>(`/courses/${slug}/quiz`),

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

  getMyProgress: () => request<{ courses: ProgressCourse[] }>('/me/progress'),
};
