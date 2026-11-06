import { useId, useState } from 'react';
import { NavLink } from 'react-router';
import { CogIcon, SignOutIcon, UserIcon } from './icons';

/**
 * The signed-in user's menu in the top navbar: account actions first
 * (Profile, Sign out), then admin-only links after a divider. One
 * disclosure rather than two separate controls, since both are "things
 * about you as a signed-in user" — admin-ness is just an extra fact about
 * that user, not a different kind of menu.
 *
 * Closes on blur leaving the whole menu (button + panel), which covers both
 * a click outside and Tab away, without a document-level listener.
 */
export function AccountMenu({
  username,
  role,
  onLogout,
}: {
  username: string;
  role: 'user' | 'admin';
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <div
      className="account-menu"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <button
        type="button"
        className="account-menu-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="account-avatar" aria-hidden="true">
          {username.charAt(0).toUpperCase()}
        </span>
        <span className="account-email">{username}</span>
      </button>

      <ul id={panelId} className="account-menu-panel" hidden={!open}>
        <li>
          <NavLink to="/profile" className="account-menu-item" onClick={() => setOpen(false)}>
            <UserIcon className="nav-icon" />
            Profile
          </NavLink>
        </li>
        <li>
          <button
            type="button"
            className="account-menu-item"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
          >
            <SignOutIcon className="nav-icon" />
            Sign out
          </button>
        </li>

        {role === 'admin' && (
          <>
            <li className="account-menu-divider" role="separator" />
            <li>
              <NavLink to="/admin/users" className="account-menu-item" onClick={() => setOpen(false)}>
                <CogIcon className="nav-icon" />
                Admin · Users
              </NavLink>
            </li>
            <li>
              <NavLink to="/admin/courses" className="account-menu-item" onClick={() => setOpen(false)}>
                <CogIcon className="nav-icon" />
                Admin · Courses
              </NavLink>
            </li>
            <li>
              <NavLink to="/admin/recycle-bin" className="account-menu-item" onClick={() => setOpen(false)}>
                <CogIcon className="nav-icon" />
                Admin · Recycle Bin
              </NavLink>
            </li>
          </>
        )}
      </ul>
    </div>
  );
}
