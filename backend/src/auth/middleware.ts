import type { NextFunction, Request, Response } from 'express';
import { SESSION_COOKIE, resolveSession } from './sessions.ts';

/** Attaches req.user when a valid session cookie is present; never rejects. */
export async function attachUser(req: Request, _res: Response, next: NextFunction) {
  try {
    const user = await resolveSession(req.cookies?.[SESSION_COOKIE]);
    if (user) req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

/** Gates a route behind a valid session. Must run after attachUser. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  next();
}
