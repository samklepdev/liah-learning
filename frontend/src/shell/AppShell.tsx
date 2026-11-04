import { Link, Outlet, useLocation } from 'react-router';
import { useAuth } from '../auth/useAuth';
import type { CatalogContext } from '../quiz/useCatalog';
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
  const { collapsed, toggle, close } = useSidebar();

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

        {/* The signed-in identity lives in the sidebar footer, so the navbar
            carries only the action. */}
        <div className="topnav-right">
          <ThemeToggle />
          {user && (
            <button type="button" className="topnav-signout" onClick={() => void logout()}>
              Sign out
            </button>
          )}
        </div>
      </header>

      <div className="shell-body">
        <aside id="app-sidebar" className="shell-sidebar" hidden={collapsed}>
          <SidebarNav nav={nav} userEmail={user?.email} userRole={user?.role} onNavigate={close} />
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
