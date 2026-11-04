import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { AccountMenu } from './AccountMenu';

function renderMenu(role: 'user' | 'admin' = 'user') {
  const onLogout = vi.fn();
  render(
    <MemoryRouter>
      <AccountMenu email="tech@example.com" role={role} onLogout={onLogout} />
    </MemoryRouter>,
  );
  return { onLogout };
}

describe('AccountMenu', () => {
  test('the panel starts closed', () => {
    renderMenu();
    expect(screen.getByRole('button', { name: /tech@example.com/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getByText('Sign out')).not.toBeVisible();
  });

  test('a plain user sees Sign out but no admin links', () => {
    renderMenu('user');
    fireEvent.click(screen.getByRole('button', { name: /tech@example.com/ }));

    expect(screen.getByText('Sign out')).toBeVisible();
    expect(screen.queryByText('Admin · Users')).not.toBeInTheDocument();
    expect(screen.queryByText('Admin · Import')).not.toBeInTheDocument();
  });

  test('an admin sees Sign out first, then the admin links', () => {
    renderMenu('admin');
    fireEvent.click(screen.getByRole('button', { name: /tech@example.com/ }));

    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    const signOutIndex = items.findIndex((t) => t?.includes('Sign out'));
    const usersIndex = items.findIndex((t) => t?.includes('Admin · Users'));
    const importIndex = items.findIndex((t) => t?.includes('Admin · Import'));

    expect(signOutIndex).toBeLessThan(usersIndex);
    expect(usersIndex).toBeLessThan(importIndex);
  });

  test('clicking Sign out calls onLogout and closes the panel', () => {
    const { onLogout } = renderMenu();
    fireEvent.click(screen.getByRole('button', { name: /tech@example.com/ }));
    fireEvent.click(screen.getByText('Sign out'));

    expect(onLogout).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /tech@example.com/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  test('clicking an admin link closes the panel', () => {
    renderMenu('admin');
    fireEvent.click(screen.getByRole('button', { name: /tech@example.com/ }));
    fireEvent.click(screen.getByRole('link', { name: /Admin · Users/ }));

    expect(screen.getByRole('button', { name: /tech@example.com/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });
});
