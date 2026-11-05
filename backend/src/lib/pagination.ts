import type { Request } from 'express';

export const PAGE_SIZE = 20;

export type Page<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

/**
 * Reads `page` from the query string. Defaults to 1 and clamps to >= 1 for
 * any missing/non-numeric/negative input, matching the loose req.query
 * handling already used elsewhere in this codebase (e.g. catalog.controller.ts).
 */
export function parsePage(req: Request): number {
  const raw = req.query.page;
  const value = typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(value) && value >= 1 ? value : 1;
}
