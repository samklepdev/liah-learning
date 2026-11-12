import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import liahLogo from '../assets/liah-logo.png';
import { useAuth } from '../auth/useAuth';
import type { CatalogContext } from '../quiz/useCatalog';
import { AccountMenu } from './AccountMenu';
import { GlobalSearch } from './GlobalSearch';
import { SidebarNav } from './SidebarNav';
import { useSidebar } from './useSidebar';
import { useSubjectNav } from './useSubjectNav';

/**
 * Persistent chrome for every signed-in route: a top navbar, a collapsible
 * sidebar of subjects, and the routed content. Subjects are fetched once here,
 * so moving between subjects or into a quiz never refetches the nav.
 */
export function AppShell() {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { collapsed, toggle, close } = useSidebar();

  // Logging out clears the user but doesn't change the route, so without
  // this the login form renders in place at whatever page you logged out
  // from (e.g. mid-quiz). "/" is signed out's landing page (see router.tsx),
  // so this always leaves the address bar showing "/" with the login form,
  // never the page you signed out of. `replace` so Back doesn't return to it.
  async function handleLogout() {
    await logout();
    navigate('/', { replace: true });
  }

  // Read from the path rather than useParams: this is a pathless layout route,
  // so the child route's :subjectSlug is not in its own params.
  const subjectSlug = pathname.startsWith('/subjects/')
    ? pathname.split('/')[2] || undefined
    : undefined;

  const nav = useSubjectNav(subjectSlug);

  return (
    <div className={collapsed ? 'shell collapsed' : 'shell'}>
      <header className="topnav">
        <div className="topnav-start">
          <button
            type="button"
            className="sidebar-toggle"
            onClick={toggle}
            aria-expanded={!collapsed}
            aria-controls="app-sidebar"
            aria-label={collapsed ? 'Open sidebar' : 'Close sidebar'}
          >
            <span className="toggle-bars" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </button>

          <Link to="/subjects" className="topnav-brand">
            <img src={liahLogo} alt="" className="topnav-mark" />
            <span className="topnav-brand-label">LIAH</span>
          </Link>
        </div>

        <GlobalSearch />

        <div className="topnav-right">
          {user && (
            <AccountMenu username={user.username} role={user.role} onLogout={() => void handleLogout()} />
          )}
        </div>
      </header>

      <div className="shell-body">
        <aside id="app-sidebar" className="shell-sidebar" hidden={collapsed}>
          <SidebarNav nav={nav} username={user?.username} onNavigate={close} />
        </aside>

        {/* Only visible on narrow screens, where the sidebar overlays content. */}
        {!collapsed && <div className="shell-scrim" onClick={close} aria-hidden="true" />}

        <main className="shell-main">
          <Outlet context={{ subjects: nav.subjects } satisfies CatalogContext} />
        </main>
      </div>
    </div>
  );
}
