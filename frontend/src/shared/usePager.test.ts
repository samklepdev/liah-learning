import { describe, expect, test } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { PAGE_SIZE, usePager } from './usePager';

describe('usePager', () => {
  test('starts on page 1 and computes totalPages from totalItems', () => {
    const { result } = renderHook(() => usePager(PAGE_SIZE * 2 + 1));
    expect(result.current.page).toBe(1);
    expect(result.current.totalPages).toBe(3);
    expect(result.current.canPrev).toBe(false);
    expect(result.current.canNext).toBe(true);
  });

  test('prev() does nothing on page 1', () => {
    const { result } = renderHook(() => usePager(PAGE_SIZE * 2));
    act(() => result.current.prev());
    expect(result.current.page).toBe(1);
  });

  test('next() stops at the last page', () => {
    const { result } = renderHook(() => usePager(PAGE_SIZE + 5));
    expect(result.current.totalPages).toBe(2);
    act(() => result.current.next());
    expect(result.current.page).toBe(2);
    expect(result.current.canNext).toBe(false);
    act(() => result.current.next());
    expect(result.current.page).toBe(2);
  });

  test('resets to the new last page when totalItems shrinks below the current page', () => {
    const { result, rerender } = renderHook(({ total }) => usePager(total), {
      initialProps: { total: PAGE_SIZE * 3 },
    });
    act(() => result.current.next());
    act(() => result.current.next());
    expect(result.current.page).toBe(3);

    rerender({ total: PAGE_SIZE + 2 });
    expect(result.current.page).toBe(2);
  });
});
