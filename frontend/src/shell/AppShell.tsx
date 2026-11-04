import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../auth/useAuth';
import type { CatalogContext } from '../quiz/useCatalog';
import { AccountMenu } from './AccountMenu';
import { AutoThemeIcon, MoonIcon, SunIcon } from './icons';
import { SidebarNav } from './SidebarNav';
import { useSidebar } from './useSidebar';
import { useSubjectNav } from './useSubjectNav';
import { useTheme, type ThemePref } from './useTheme';

const THEME_LABEL: Record<ThemePref, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
};

function ThemeToggle() {
  const { pref, cycle } = useTheme();
  const Icon = pref === 'light' ? SunIcon : pref === 'dark' ? MoonIcon : AutoThemeIcon;

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={cycle}
      // The accessible name states the current setting and what comes next,
      // because the icon alone cannot convey three states.
      aria-label={`Theme: ${THEME_LABEL[pref]}. Change theme`}
      title={`Theme: ${THEME_LABEL[pref]}`}
    >
      <Icon className="theme-icon" />
      <span className="theme-label">{THEME_LABEL[pref]}</span>
    </button>
  );
}

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
  // from (e.g. mid-quiz) instead of a sane landing page.
  async function handleLogout() {
    await logout();
    navigate('/');
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
          <span className="topnav-mark" aria-hidden="true">
            L
          </span>
          LIAH Learning
        </Link>

        <div className="topnav-right">
          <ThemeToggle />
          {user && (
            <AccountMenu email={user.email} role={user.role} onLogout={() => void handleLogout()} />
          )}
        </div>
      </header>

      <div className="shell-body">
        <aside id="app-sidebar" className="shell-sidebar" hidden={collapsed}>
          <SidebarNav nav={nav} userEmail={user?.email} onNavigate={close} />
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
