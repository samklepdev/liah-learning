import { useId } from 'react';
import { NavLink, useLocation } from 'react-router';
import { BookIcon, ChevronRightIcon, SubjectIcon } from './icons';
import type { SubjectNavState } from './useSubjectNav';

/**
 * One subject: a disclosure button whose panel lists that subject's quizzes.
 * Hand-rolled rather than a component library — a real <button> already gives
 * Enter/Space activation and focus handling, so what's left is aria-expanded
 * and aria-controls pointing at the panel.
 */
function SubjectGroup({
  slug,
  title,
  courseCount,
  nav,
  isCurrent,
  onNavigate,
}: {
  slug: string;
  title: string;
  courseCount: number;
  nav: SubjectNavState;
  isCurrent: boolean;
  onNavigate?: () => void;
}) {
  const panelId = useId();
  const open = nav.isOpen(slug);
  const quizzes = nav.courses[slug];

  return (
    <li className="nav-group">
      <button
        type="button"
        className={isCurrent ? 'nav-item current' : 'nav-item'}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => nav.toggle(slug)}
      >
        <SubjectIcon slug={slug} className="nav-icon" />
        <span className="nav-label">{title}</span>
        <span className="nav-count">{courseCount}</span>
        <ChevronRightIcon className={open ? 'nav-chevron open' : 'nav-chevron'} />
      </button>

      <ul id={panelId} className="nav-panel" hidden={!open}>
        {quizzes === undefined && <li className="nav-panel-note">Loading…</li>}

        {quizzes?.length === 0 && <li className="nav-panel-note">No quizzes yet</li>}

        {quizzes?.map((c) => (
          <li key={c.id}>
            <NavLink
              to={`/courses/${c.slug}/quiz`}
              onClick={onNavigate}
              className={({ isActive }: { isActive: boolean }) =>
                isActive ? 'nav-sublink active' : 'nav-sublink'
              }
            >
              <span className="nav-sublink-pos">{c.position}</span>
              <span>{c.title}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </li>
  );
}

export function SidebarNav({
  nav,
  userEmail,
  onNavigate,
}: {
  nav: SubjectNavState;
  userEmail?: string;
  onNavigate?: () => void;
}) {
  const { pathname } = useLocation();

  const itemClass = ({ isActive }: { isActive: boolean }) =>
    isActive ? 'nav-item current' : 'nav-item';

  return (
    <nav className="sidebar-nav" aria-label="Subjects">
      <ul className="nav-list">
        <li>
          <NavLink to="/subjects" onClick={onNavigate} end className={itemClass}>
            <BookIcon className="nav-icon" />
            <span className="nav-label">All subjects</span>
          </NavLink>
        </li>

        {nav.error && (
          <li role="alert" className="nav-panel-note">
            {nav.error}
          </li>
        )}

        {!nav.error && !nav.loading && nav.subjects.length === 0 && (
          <li className="nav-panel-note">No subjects imported yet</li>
        )}

        {nav.subjects.map((s) => (
          <SubjectGroup
            key={s.id}
            slug={s.slug}
            title={s.title}
            courseCount={s.courseCount}
            nav={nav}
            isCurrent={pathname.startsWith(`/subjects/${s.slug}`)}
            onNavigate={onNavigate}
          />
        ))}
      </ul>

      {userEmail && (
        <div className="sidebar-footer">
          <span className="sidebar-avatar" aria-hidden="true">
            {userEmail.charAt(0).toUpperCase()}
          </span>
          <span className="sidebar-footer-email">{userEmail}</span>
        </div>
      )}
    </nav>
  );
}
