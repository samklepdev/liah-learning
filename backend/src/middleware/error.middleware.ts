import type { NextFunction, Request, Response } from 'express';

/** Terminal 404 — mount after all routers. */
export function notFound(_req: Request, res: Response) {
  res.status(404).json({ error: 'Not found' });
}

/**
 * Express 5 forwards rejected promises from async handlers here automatically,
 * so route handlers don't need their own try/catch.
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
}
