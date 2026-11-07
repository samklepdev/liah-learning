import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { ApiError } from '../quiz/api';
import { useGlobalSearch } from './useGlobalSearch';

const search = vi.fn();

vi.mock('../quiz/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../quiz/api')>();
  return {
    ...actual,
    quizApi: { ...actual.quizApi, search: (q: string) => search(q) },
  };
});

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  search.mockResolvedValue({ subjects: [], courses: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useGlobalSearch', () => {
  test('does not search for a query under 2 characters', async () => {
    const { result } = renderHook(() => useGlobalSearch());

    act(() => result.current.setQuery('t'));
    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(search).not.toHaveBeenCalled();
    expect(result.current.subjects).toEqual([]);
    expect(result.current.courses).toEqual([]);
  });

  test('debounces and then searches once the query settles', async () => {
    search.mockResolvedValue({
      subjects: [{ id: 's1', slug: 'chassis', title: 'Chassis', courseCount: 11 }],
      courses: [],
    });
    const { result } = renderHook(() => useGlobalSearch());

    act(() => result.current.setQuery('ch'));
    act(() => result.current.setQuery('cha'));
    act(() => result.current.setQuery('chas'));

    // Mid-typing: no call yet, since each keystroke resets the debounce.
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(search).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    expect(search).toHaveBeenCalledWith('chas');
    expect(result.current.subjects).toEqual([
      { id: 's1', slug: 'chassis', title: 'Chassis', courseCount: 11 },
    ]);
  });

  test('a later response is not clobbered by an earlier, slower one', async () => {
    let resolveFirst!: (v: { subjects: never[]; courses: never[] }) => void;
    search.mockImplementationOnce(
      () => new Promise((resolve) => (resolveFirst = resolve)),
    );
    search.mockResolvedValueOnce({
      subjects: [{ id: 's2', slug: 'engine', title: 'Engine', courseCount: 9 }],
      courses: [],
    });

    const { result } = renderHook(() => useGlobalSearch());

    act(() => result.current.setQuery('cha'));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    act(() => result.current.setQuery('eng'));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    await waitFor(() => expect(search).toHaveBeenCalledTimes(2));
    resolveFirst({ subjects: [], courses: [] });

    await waitFor(() =>
      expect(result.current.subjects).toEqual([
        { id: 's2', slug: 'engine', title: 'Engine', courseCount: 9 },
      ]),
    );
  });

  test('a failed search sets an error and clears results', async () => {
    search.mockRejectedValue(new ApiError('search down', 500));
    const { result } = renderHook(() => useGlobalSearch());

    act(() => result.current.setQuery('cha'));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    await waitFor(() => expect(result.current.error).toBe('search down'));
    expect(result.current.subjects).toEqual([]);
    expect(result.current.courses).toEqual([]);
  });

  test('clearing the query back below 2 characters clears results without a new search', async () => {
    search.mockResolvedValue({
      subjects: [{ id: 's1', slug: 'chassis', title: 'Chassis', courseCount: 11 }],
      courses: [],
    });
    const { result } = renderHook(() => useGlobalSearch());

    act(() => result.current.setQuery('cha'));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    await waitFor(() => expect(result.current.subjects).toHaveLength(1));

    act(() => result.current.setQuery(''));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current.subjects).toEqual([]);
    expect(search).toHaveBeenCalledTimes(1);
  });
});
