import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useTheme } from './useTheme';

/** jsdom has no matchMedia; stand one in that we can flip. */
function stubMatchMedia(prefersDark: boolean) {
  const listeners = new Set<() => void>();
  const mql = {
    matches: prefersDark,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  };
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => mql),
  );
  return {
    set(next: boolean) {
      mql.matches = next;
      for (const fn of listeners) fn();
    },
    listenerCount: () => listeners.size,
  };
}

const applied = () => document.documentElement.dataset.theme;

beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('useTheme', () => {
  test('defaults to following the system, resolving dark', () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => useTheme());

    expect(result.current.pref).toBe('system');
    expect(applied()).toBe('dark');
  });

  test('defaults to following the system, resolving light', () => {
    stubMatchMedia(false);
    renderHook(() => useTheme());

    expect(applied()).toBe('light');
  });

  test('cycles light to dark to system', () => {
    stubMatchMedia(false);
    const { result } = renderHook(() => useTheme());

    act(() => result.current.setPref('light'));
    expect(result.current.pref).toBe('light');
    expect(applied()).toBe('light');

    act(() => result.current.cycle());
    expect(result.current.pref).toBe('dark');
    expect(applied()).toBe('dark');

    act(() => result.current.cycle());
    expect(result.current.pref).toBe('system');

    act(() => result.current.cycle());
    expect(result.current.pref).toBe('light');
  });

  test('an explicit choice overrides the system setting', () => {
    // System says dark; the user insists on light.
    stubMatchMedia(true);
    const { result } = renderHook(() => useTheme());
    expect(applied()).toBe('dark');

    act(() => result.current.setPref('light'));
    expect(applied()).toBe('light');
  });

  test('an explicit choice persists; system is stored as no value', () => {
    stubMatchMedia(false);
    const { result } = renderHook(() => useTheme());

    act(() => result.current.setPref('dark'));
    expect(window.localStorage.getItem('liah.theme')).toBe('dark');

    act(() => result.current.setPref('system'));
    // Absence of a value is what the pre-paint script in index.html reads as
    // "follow the OS", so the two must agree.
    expect(window.localStorage.getItem('liah.theme')).toBeNull();
  });

  test('a stored choice is picked up on mount', () => {
    stubMatchMedia(true);
    window.localStorage.setItem('liah.theme', 'light');

    const { result } = renderHook(() => useTheme());

    expect(result.current.pref).toBe('light');
    expect(applied()).toBe('light');
  });

  test('follows the OS changing while set to system', () => {
    const media = stubMatchMedia(false);
    renderHook(() => useTheme());
    expect(applied()).toBe('light');

    act(() => media.set(true));
    expect(applied()).toBe('dark');
  });

  test('ignores the OS changing once a choice is explicit', () => {
    const media = stubMatchMedia(false);
    const { result } = renderHook(() => useTheme());

    act(() => result.current.setPref('light'));
    act(() => media.set(true));

    expect(applied()).toBe('light');
    // The listener is torn down when not following the system.
    expect(media.listenerCount()).toBe(0);
  });

  test('survives localStorage throwing', () => {
    stubMatchMedia(false);
    const getItem = vi
      .spyOn(window.localStorage, 'getItem')
      .mockImplementation(() => {
        throw new Error('blocked');
      });
    const setItem = vi
      .spyOn(window.localStorage, 'setItem')
      .mockImplementation(() => {
        throw new Error('blocked');
      });

    const { result } = renderHook(() => useTheme());
    expect(result.current.pref).toBe('system');

    act(() => result.current.setPref('dark'));
    expect(applied()).toBe('dark');

    getItem.mockRestore();
    setItem.mockRestore();
  });
});
