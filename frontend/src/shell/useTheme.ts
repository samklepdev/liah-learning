import { useCallback, useEffect, useState } from 'react';

export type ThemePref = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'liah.theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

function readStored(): ThemePref {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === 'light' || raw === 'dark' ? raw : 'system';
  } catch {
    return 'system';
  }
}

function resolve(pref: ThemePref): 'light' | 'dark' {
  if (pref !== 'system') return pref;
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

/**
 * Theme preference with three states: an explicit light or dark choice, or
 * `system` to follow the OS. `system` is stored as the *absence* of a stored
 * value, which keeps it consistent with the pre-paint script in index.html.
 *
 * The applied value is written to `document.documentElement.dataset.theme`,
 * which is what the CSS keys off.
 */
export function useTheme(): {
  pref: ThemePref;
  setPref: (next: ThemePref) => void;
  cycle: () => void;
} {
  const [pref, setPrefState] = useState<ThemePref>(readStored);

  // DOM write, not a state update, so it is safe to do directly in an effect.
  useEffect(() => {
    document.documentElement.dataset.theme = resolve(pref);
  }, [pref]);

  // Only while following the OS: react to it changing under us.
  useEffect(() => {
    if (pref !== 'system') return;

    const query = window.matchMedia(DARK_QUERY);
    const onChange = () => {
      document.documentElement.dataset.theme = resolve('system');
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [pref]);

  const setPref = useCallback((next: ThemePref) => {
    setPrefState(next);
    try {
      if (next === 'system') window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Preference just won't survive a reload.
    }
  }, []);

  const cycle = useCallback(() => {
    setPref(pref === 'light' ? 'dark' : pref === 'dark' ? 'system' : 'light');
  }, [pref, setPref]);

  return { pref, setPref, cycle };
}
