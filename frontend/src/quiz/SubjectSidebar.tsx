import { NavLink } from 'react-router';
import type { SubjectSummary } from './api';

export function SubjectSidebar({ subjects }: { subjects: SubjectSummary[] }) {
  return (
    <nav className="subject-sidebar" aria-label="Subjects">
      <p className="label">Subjects</p>
      <ul>
        {subjects.map((s) => (
          <li key={s.id}>
            <NavLink
              to={`/subjects/${s.slug}`}
              className={({ isActive }: { isActive: boolean }) =>
                isActive ? 'subject-link active' : 'subject-link'
              }
            >
              <span className="subject-title">{s.title}</span>
              <span className="subject-count">{s.courseCount}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
