import { useEffect, useState } from 'react';

export const PAGE_SIZE = 20;

export function usePager(totalItems: number) {
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  return {
    page,
    totalPages,
    canPrev: page > 1,
    canNext: page < totalPages,
    next: () => setPage((p) => Math.min(p + 1, totalPages)),
    prev: () => setPage((p) => Math.max(p - 1, 1)),
  };
}
