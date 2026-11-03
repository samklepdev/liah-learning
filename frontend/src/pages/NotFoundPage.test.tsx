import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { NotFoundPage } from './NotFoundPage';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/courses" element={<div>COURSES PAGE</div>} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('NotFoundPage', () => {
  test('renders for an unmatched path and names it', () => {
    renderAt('/totally/made/up');

    expect(screen.getByText('404')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByText('/totally/made/up')).toBeInTheDocument();
  });

  test('offers a way back to courses', () => {
    renderAt('/nope');

    expect(screen.getByRole('link', { name: 'Go to courses' })).toHaveAttribute(
      'href',
      '/courses',
    );
  });

  test('does not hijack a path that does have a route', () => {
    renderAt('/courses');

    expect(screen.getByText('COURSES PAGE')).toBeInTheDocument();
    expect(screen.queryByText('404')).not.toBeInTheDocument();
  });
});
