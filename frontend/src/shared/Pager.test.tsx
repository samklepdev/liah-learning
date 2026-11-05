import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Pager } from './Pager';

describe('Pager', () => {
  test('shows the current page and total', () => {
    render(<Pager page={2} totalPages={5} canPrev canNext onPrev={() => {}} onNext={() => {}} />);
    expect(screen.getByText('Page 2 of 5')).toBeInTheDocument();
  });

  test('disables Prev on the first page and Next on the last page', () => {
    render(
      <Pager page={1} totalPages={1} canPrev={false} canNext={false} onPrev={() => {}} onNext={() => {}} />,
    );
    expect(screen.getByRole('button', { name: 'Prev' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  test('calls onPrev/onNext when clicked', () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    render(<Pager page={2} totalPages={3} canPrev canNext onPrev={onPrev} onNext={onNext} />);
    screen.getByRole('button', { name: 'Prev' }).click();
    screen.getByRole('button', { name: 'Next' }).click();
    expect(onPrev).toHaveBeenCalledOnce();
    expect(onNext).toHaveBeenCalledOnce();
  });
});
