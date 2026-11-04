import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { SidebarNav } from './SidebarNav';
import type { SubjectNavState } from './useSubjectNav';

const emptyNav: SubjectNavState = {
  subjects: [],
  loading: false,
  error: null,
  isOpen: () => false,
  courses: {},
  toggle: () => {},
};

describe('SidebarNav', () => {
  test('shows no Admin section for a plain user', () => {
    render(
      <MemoryRouter>
        <SidebarNav nav={emptyNav} userEmail="a@b.com" userRole="user" />
      </MemoryRouter>,
    );
    expect(screen.queryByText('Admin · Users')).not.toBeInTheDocument();
  });

  test('shows the Admin section for an admin', () => {
    render(
      <MemoryRouter>
        <SidebarNav nav={emptyNav} userEmail="a@b.com" userRole="admin" />
      </MemoryRouter>,
    );
    expect(screen.getByText('Admin · Users')).toBeInTheDocument();
    expect(screen.getByText('Admin · Import')).toBeInTheDocument();
  });
});
