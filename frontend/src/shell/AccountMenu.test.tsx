import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { AccountMenu } from './AccountMenu';

function renderMenu(role: 'user' | 'admin' = 'user') {
  const onLogout = vi.fn();
  render(
    <MemoryRouter>
      <AccountMenu username="techsmith" role={role} onLogout={onLogout} />
    </MemoryRouter>,
  );
  return { onLogout };
}

describe('AccountMenu', () => {
  test('the panel starts closed', () => {
    renderMenu();
    expect(screen.getByRole('button', { name: /techsmith/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getByText('Sign out')).not.toBeVisible();
  });

  test('a plain user sees Profile and Sign out but no admin links', () => {
    renderMenu('user');
    fireEvent.click(screen.getByRole('button', { name: /techsmith/ }));

    expect(screen.getByRole('link', { name: 'Profile' })).toBeVisible();
    expect(screen.getByText('Sign out')).toBeVisible();
    expect(screen.queryByText('Users')).not.toBeInTheDocument();
    expect(screen.queryByText('Courses')).not.toBeInTheDocument();
    expect(screen.queryByText('Password Requests')).not.toBeInTheDocument();
  });

  test('an admin sees the Password Requests link after Recycle Bin', () => {
    renderMenu('admin');
    fireEvent.click(screen.getByRole('button', { name: /techsmith/ }));

    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    const recycleBinIndex = items.findIndex((t) => t?.includes('Recycle Bin'));
    const requestsIndex = items.findIndex((t) => t?.includes('Password Requests'));

    expect(recycleBinIndex).toBeLessThan(requestsIndex);
  });

  test('Profile comes before Sign out, which comes before the admin links', () => {
    renderMenu('admin');
    fireEvent.click(screen.getByRole('button', { name: /techsmith/ }));

    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    const profileIndex = items.findIndex((t) => t?.includes('Profile'));
    const signOutIndex = items.findIndex((t) => t?.includes('Sign out'));
    const usersIndex = items.findIndex((t) => t === 'Users');
    const coursesIndex = items.findIndex((t) => t === 'Courses');

    expect(profileIndex).toBeLessThan(signOutIndex);
    expect(signOutIndex).toBeLessThan(usersIndex);
    expect(usersIndex).toBeLessThan(coursesIndex);
  });

  test('clicking Sign out calls onLogout and closes the panel', () => {
    const { onLogout } = renderMenu();
    fireEvent.click(screen.getByRole('button', { name: /techsmith/ }));
    fireEvent.click(screen.getByText('Sign out'));

    expect(onLogout).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /techsmith/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  test('clicking Profile links to /profile and closes the panel', () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: /techsmith/ }));
    const link = screen.getByRole('link', { name: 'Profile' });
    expect(link).toHaveAttribute('href', '/profile');

    fireEvent.click(link);
    expect(screen.getByRole('button', { name: /techsmith/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  test('clicking an admin link closes the panel', () => {
    renderMenu('admin');
    fireEvent.click(screen.getByRole('button', { name: /techsmith/ }));
    fireEvent.click(screen.getByRole('link', { name: 'Users' }));

    expect(screen.getByRole('button', { name: /techsmith/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });
});
