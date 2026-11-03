import type { Request } from 'express';

/**
 * Express 5 types every route param as `string | string[]` because a pattern
 * can repeat a name. None of our routes do, so this narrows to the single
 * value and keeps controllers free of casts.
 */
export function param(req: Request, name: string): string {
  const value = req.params[name];
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}
