import { describe, expect, test, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { makeQuiz } from '../test/fixtures';
import { ApiError } from './api';
import { useQuizAttempt } from './useQuizAttempt';

const quiz = makeQuiz();

const getQuiz = vi.fn();
const startAttempt = vi.fn();
const getAttempt = vi.fn();
const saveAnswer = vi.fn();
const submit = vi.fn();

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>();
  return {
    ...actual,
    quizApi: {
      listCourses: vi.fn(),
      getQuiz: (...a: unknown[]) => getQuiz(...a),
      startAttempt: (...a: unknown[]) => startAttempt(...a),
      getAttempt: (...a: unknown[]) => getAttempt(...a),
      saveAnswer: (...a: unknown[]) => saveAnswer(...a),
      submit: (...a: unknown[]) => submit(...a),
    },
  };
});

beforeEach(() => {
  getQuiz.mockResolvedValue({ quiz });
  startAttempt.mockResolvedValue({ attempt: { id: 'attempt-1' } });
  getAttempt.mockResolvedValue({
    attempt: {
      id: 'attempt-1',
      courseId: 'course-1',
      startedAt: '2026-11-02T12:00:00.000Z',
      submittedAt: null,
      answers: [],
    },
  });
  saveAnswer.mockResolvedValue(undefined);
  submit.mockResolvedValue({ attempt: {} });
});

async function renderReady() {
  const view = renderHook(() => useQuizAttempt(quiz.slug));
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  return view;
}

describe('useQuizAttempt', () => {
  test('loads the quiz and starts an attempt', async () => {
    const { result } = await renderReady();

    expect(result.current.quiz?.slug).toBe(quiz.slug);
    expect(result.current.attemptId).toBe('attempt-1');
    expect(result.current.error).toBeNull();
    expect(result.current.index).toBe(0);
    expect(result.current.answers).toEqual({});
  });

  test('restores answers already saved on the server', async () => {
    getAttempt.mockResolvedValue({
      attempt: {
        id: 'attempt-1',
        courseId: 'course-1',
        startedAt: '2026-11-02T12:00:00.000Z',
        submittedAt: null,
        answers: [{ questionId: 'q1', optionId: 'q1-C' }],
      },
    });

    const { result } = await renderReady();

    // This is the reload-mid-quiz case: the cookie is httpOnly and answers
    // live server-side, so progress must come back from the attempt.
    expect(result.current.answers).toEqual({ q1: 'q1-C' });
  });

  test('select updates immediately and persists the choice', async () => {
    const { result } = await renderReady();

    act(() => result.current.select('q1', 'q1-B'));

    expect(result.current.answers).toEqual({ q1: 'q1-B' });
    await waitFor(() =>
      expect(saveAnswer).toHaveBeenCalledWith('attempt-1', 'q1', 'q1-B'),
    );
  });

  test('a failed save surfaces a non-fatal error and keeps the quiz', async () => {
    saveAnswer.mockRejectedValue(new ApiError('network down', 500));
    const { result } = await renderReady();

    act(() => result.current.select('q1', 'q1-B'));

    await waitFor(() => expect(result.current.actionError).toBe('network down'));
    // The whole quiz must not be replaced by an error screen.
    expect(result.current.quiz).not.toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.answers).toEqual({ q1: 'q1-B' });
  });

  test('navigation clamps to the review step and to zero', async () => {
    const { result } = await renderReady();

    act(() => result.current.back());
    expect(result.current.index).toBe(0);

    for (let i = 0; i < 10; i++) act(() => result.current.next());
    // 3 questions, so index 3 is the review step and it must not go past it.
    expect(result.current.index).toBe(3);

    act(() => result.current.goTo(1));
    expect(result.current.index).toBe(1);

    act(() => result.current.goTo(-5));
    expect(result.current.index).toBe(0);
  });

  test('submit returns the attempt id', async () => {
    const { result } = await renderReady();

    let returned: string | null = null;
    await act(async () => {
      returned = await result.current.submit();
    });

    expect(returned).toBe('attempt-1');
    expect(submit).toHaveBeenCalledWith('attempt-1');
  });

  test('a failed submit reports an error without losing the quiz', async () => {
    submit.mockRejectedValue(new ApiError('could not submit', 500));
    const { result } = await renderReady();

    let returned: string | null = 'unset';
    await act(async () => {
      returned = await result.current.submit();
    });

    expect(returned).toBeNull();
    expect(result.current.actionError).toBe('could not submit');
    expect(result.current.quiz).not.toBeNull();
  });

  test('a failed load reports a fatal error', async () => {
    getQuiz.mockRejectedValue(new ApiError('Course not found', 404));
    const { result } = renderHook(() => useQuizAttempt('nope'));

    await waitFor(() => expect(result.current.error).toBe('Course not found'));
    expect(result.current.quiz).toBeNull();
    expect(result.current.loading).toBe(false);
  });
});
