import { useEffect, useState } from 'react';
import { Link, Outlet } from 'react-router';
import { useAuth } from '../auth/useAuth';
import { quizApi, type SubjectSummary } from '../quiz/api';
import type { CatalogContext } from '../quiz/useCatalog';
import { SidebarNav } from './SidebarNav';
import { useSidebar } from './useSidebar';

type State =
  | { kind: 'ready'; subjects: SubjectSummary[] }
  | { kind: 'error'; message: string };

/**
 * Persistent chrome for every signed-in page: a collapsible sidebar of
 * subjects, a top bar, and the routed content. Subjects are fetched once here
 * — navigating between subjects or into a quiz must not refetch the nav.
 */
export function AppShell() {
  const { user, logout } = useAuth();
  const { collapsed, toggle, close } = useSidebar();
  const [state, setState] = useState<State | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const { subjects } = await quizApi.listSubjects();
        if (!cancelled) setState({ kind: 'ready', subjects });
      } catch (err) {
        if (!cancelled) {
          setState({
            kind: 'error',
            message: err instanceof Error ? err.message : 'Could not load subjects',
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const subjects = state?.kind === 'ready' ? state.subjects : [];

  return (
    <div className={collapsed ? 'shell collapsed' : 'shell'}>
      <header className="shell-topbar">
        <button
          type="button"
          className="sidebar-toggle"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-controls="app-sidebar"
          aria-label={collapsed ? 'Open sidebar' : 'Close sidebar'}
        >
          <span aria-hidden="true">{collapsed ? '☰' : '✕'}</span>
        </button>

        <Link to="/subjects" className="shell-brand">
          LIAH Learning
        </Link>

        <div className="shell-user">
          {user && <span className="shell-email">{user.email}</span>}
          {user && (
            <button type="button" onClick={() => void logout()}>
              Sign out
            </button>
          )}
        </div>
      </header>

      <div className="shell-body">
        {/* Kept mounted while collapsed so the open/close transition can run and
            focus order stays stable; hidden from assistive tech when closed. */}
        <aside id="app-sidebar" className="shell-sidebar" hidden={collapsed}>
          {state?.kind === 'error' ? (
            <p role="alert" className="sidebar-empty">
              {state.message}
            </p>
          ) : (
            <SidebarNav subjects={subjects} onNavigate={close} />
          )}
        </aside>

        {/* Tapping the dimmed area closes the drawer on narrow screens. */}
        {!collapsed && <div className="shell-scrim" onClick={close} aria-hidden="true" />}

        <main className="shell-main">
          {state === null ? (
            <div className="auth-loading">Loading…</div>
          ) : (
            <Outlet context={{ subjects } satisfies CatalogContext} />
          )}
        </main>
      </div>
    </div>
  );
}
