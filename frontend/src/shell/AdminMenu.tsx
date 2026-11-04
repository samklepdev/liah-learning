import { useId, useState } from 'react';
import { NavLink } from 'react-router';
import { CogIcon } from './icons';

/**
 * Admin-only navigation, as a disclosure button in the top navbar rather than
 * the sidebar — it's a destination for occasional management tasks, not part
 * of the subject browsing the sidebar is for.
 *
 * Closes on blur leaving the whole menu (button + panel), which covers both
 * a click outside and Tab away, without a document-level listener.
 */
export function AdminMenu() {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <div
      className="admin-menu"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <button
        type="button"
        className="admin-menu-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <CogIcon className="nav-icon" />
        Admin
      </button>

      <ul id={panelId} className="admin-menu-panel" hidden={!open}>
        <li>
          <NavLink to="/admin/users" onClick={() => setOpen(false)}>
            Users
          </NavLink>
        </li>
        <li>
          <NavLink to="/admin/import" onClick={() => setOpen(false)}>
            Import
          </NavLink>
        </li>
      </ul>
    </div>
  );
}
