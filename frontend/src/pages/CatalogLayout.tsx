import { useEffect, useState } from 'react';
import { Outlet } from 'react-router';
import { quizApi, type SubjectSummary } from '../quiz/api';
import { SubjectSidebar } from '../quiz/SubjectSidebar';
import type { CatalogContext } from '../quiz/useCatalog';

type State =
  | { kind: 'ready'; subjects: SubjectSummary[] }
  | { kind: 'error'; message: string };

/**
 * Sidebar of subjects beside the selected subject's courses. The subject list
 * is fetched here, once, rather than in each child — switching subjects should
 * not refetch the sidebar.
 */
export function CatalogLayout() {
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

  if (state === null) return <div className="auth-loading">Loading subjects…</div>;
  if (state.kind === 'error') {
    return (
      <p role="alert" className="auth-error">
        {state.message}
      </p>
    );
  }

  return (
    <div className="catalog">
      <SubjectSidebar subjects={state.subjects} />
      <main className="catalog-main">
        <Outlet context={{ subjects: state.subjects } satisfies CatalogContext} />
      </main>
    </div>
  );
}
