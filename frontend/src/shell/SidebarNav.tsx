import { NavLink } from 'react-router';
import type { SubjectSummary } from '../quiz/api';

/**
 * The sidebar's contents. `onNavigate` lets the shell close the drawer after a
 * selection on narrow screens, where the sidebar overlays the content.
 */
export function SidebarNav({
  subjects,
  onNavigate,
}: {
  subjects: SubjectSummary[];
  onNavigate?: () => void;
}) {
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    isActive ? 'subject-link active' : 'subject-link';

  return (
    <nav className="sidebar-nav" aria-label="Subjects">
      <p className="label">Subjects</p>

      {subjects.length === 0 ? (
        <p className="sidebar-empty">No subjects imported yet.</p>
      ) : (
        <ul>
          {subjects.map((s) => (
            <li key={s.id}>
              <NavLink to={`/subjects/${s.slug}`} className={linkClass} onClick={onNavigate}>
                <span className="subject-title">{s.title}</span>
                <span className="subject-count" title={`${s.courseCount} quizzes`}>
                  {s.courseCount}
                </span>
              </NavLink>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
