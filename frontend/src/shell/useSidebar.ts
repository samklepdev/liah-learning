import { useCallback, useState } from 'react';

const STORAGE_KEY = 'liah.sidebar.collapsed';

function readStored(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    // Private browsing or a blocked storage partition — default to open.
    return false;
  }
}

/**
 * Collapsed state for the app sidebar, remembered across reloads. Read lazily
 * from localStorage in the initialiser rather than in an effect, so the first
 * paint is already in the right state and the sidebar doesn't flash open.
 */
export function useSidebar(): {
  collapsed: boolean;
  toggle: () => void;
  close: () => void;
} {
  const [collapsed, setCollapsed] = useState(readStored);

  const persist = useCallback((next: boolean) => {
    setCollapsed(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // Not being able to remember the preference is not worth failing over.
    }
  }, []);

  const toggle = useCallback(() => persist(!collapsed), [collapsed, persist]);
  const close = useCallback(() => persist(true), [persist]);

  return { collapsed, toggle, close };
}
