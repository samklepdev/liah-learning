import { describe, expect, test } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { AdminMenu } from './AdminMenu';

function renderMenu() {
  return render(
    <MemoryRouter>
      <AdminMenu />
    </MemoryRouter>,
  );
}

describe('AdminMenu', () => {
  test('the panel starts closed', () => {
    renderMenu();
    expect(screen.getByRole('button', { name: /admin/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getByText('Users')).not.toBeVisible();
  });

  test('clicking the trigger opens the panel with links to both admin pages', () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: /admin/i }));

    expect(screen.getByText('Users')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Users' })).toHaveAttribute('href', '/admin/users');
    expect(screen.getByRole('link', { name: 'Import' })).toHaveAttribute(
      'href',
      '/admin/import',
    );
  });

  test('clicking a link closes the panel', () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: /admin/i }));
    fireEvent.click(screen.getByRole('link', { name: 'Users' }));

    expect(screen.getByRole('button', { name: /admin/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });
});
