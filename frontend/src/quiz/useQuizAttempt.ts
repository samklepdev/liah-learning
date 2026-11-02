import { useCallback, useEffect, useState } from 'react';
import { quizApi, type GradedAttempt, type OpenAttempt, type Quiz } from './api';

/**
 * What the loader produced, tagged with the slug it belongs to. Keying on slug
 * is what lets `loading` be derived rather than reset: when the slug changes,
 * the stored state simply stops matching and we are loading again. That means
 * nothing is assigned synchronously inside the effect, which is both what the
 * react-hooks rule requires and why the states below cannot contradict.
 */
type LoadState =
  | {
      kind: 'ready';
      slug: string;
      quiz: Quiz;
      attemptId: string;
      answers: Record<string, string>;
      /** Question index, or `quiz.questions.length` for the review step. */
      index: number;
    }
  | { kind: 'error'; slug: string; message: string };

export type QuizAttemptState = {
  quiz: Quiz | null;
  attemptId: string | null;
  loading: boolean;
  /** Fatal: the quiz could not be loaded at all. */
  error: string | null;
  /** Non-fatal: a save or submit failed, but the quiz is still usable. */
  actionError: string | null;
  answers: Record<string, string>;
  index: number;
  saving: boolean;
  submitting: boolean;
  select: (questionId: string, optionId: string) => void;
  goTo: (index: number) => void;
  next: () => void;
  back: () => void;
  submit: () => Promise<string | null>;
};

/**
 * Loads the quiz, starts or resumes an attempt, and saves each selection as it
 * is made. Because answers live on the server, reloading mid-quiz restores them.
 */
export function useQuizAttempt(slug: string): QuizAttemptState {
  const [state, setState] = useState<LoadState | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Data from a previous slug does not count as loaded.
  const current = state?.slug === slug ? state : null;
  const loading = current === null;
  const attemptId = current?.kind === 'ready' ? current.attemptId : null;

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const [{ quiz }, { attempt }] = await Promise.all([
          quizApi.getQuiz(slug),
          quizApi.startAttempt(slug),
        ]);
        const existing = (await quizApi.getAttempt(attempt.id)).attempt as
          | OpenAttempt
          | GradedAttempt;

        if (cancelled) return;
        setState({
          kind: 'ready',
          slug,
          quiz,
          attemptId: attempt.id,
          answers:
            'answers' in existing
              ? Object.fromEntries(existing.answers.map((a) => [a.questionId, a.optionId]))
              : {},
          index: 0,
        });
      } catch (err) {
        if (cancelled) return;
        setState({
          kind: 'error',
          slug,
          message: err instanceof Error ? err.message : 'Could not load the quiz',
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [slug]);

  const select = useCallback(
    (questionId: string, optionId: string) => {
      if (!attemptId) return;

      setActionError(null);
      setSaving(true);

      // Optimistic: reflect the choice immediately, then persist it.
      setState((prev) =>
        prev?.kind === 'ready'
          ? { ...prev, answers: { ...prev.answers, [questionId]: optionId } }
          : prev,
      );

      quizApi
        .saveAnswer(attemptId, questionId, optionId)
        .catch((err: unknown) =>
          // Keep the quiz on screen; one failed save should not discard it.
          setActionError(err instanceof Error ? err.message : 'Could not save that answer'),
        )
        .finally(() => setSaving(false));
    },
    [attemptId],
  );

  const goTo = useCallback((i: number) => {
    setState((prev) => {
      if (prev?.kind !== 'ready') return prev;
      const clamped = Math.max(0, Math.min(i, prev.quiz.questions.length));
      return clamped === prev.index ? prev : { ...prev, index: clamped };
    });
  }, []);

  const next = useCallback(() => {
    setState((prev) =>
      prev?.kind === 'ready'
        ? { ...prev, index: Math.min(prev.index + 1, prev.quiz.questions.length) }
        : prev,
    );
  }, []);

  const back = useCallback(() => {
    setState((prev) =>
      prev?.kind === 'ready' ? { ...prev, index: Math.max(prev.index - 1, 0) } : prev,
    );
  }, []);

  const submit = useCallback(async (): Promise<string | null> => {
    if (!attemptId) return null;
    setActionError(null);
    setSubmitting(true);
    try {
      await quizApi.submit(attemptId);
      return attemptId;
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not submit the quiz');
      return null;
    } finally {
      setSubmitting(false);
    }
  }, [attemptId]);

  return {
    quiz: current?.kind === 'ready' ? current.quiz : null,
    attemptId,
    loading,
    error: current?.kind === 'error' ? current.message : null,
    actionError,
    answers: current?.kind === 'ready' ? current.answers : {},
    index: current?.kind === 'ready' ? current.index : 0,
    saving,
    submitting,
    select,
    goTo,
    next,
    back,
    submit,
  };
}
