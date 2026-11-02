import type { NextFunction, Request, Response } from 'express';
import { SESSION_COOKIE } from '../lib/cookies.ts';
import { hashToken } from '../lib/tokens.ts';
import { findUserBySessionId } from '../models/session.model.ts';

/** Attaches req.user when a valid session cookie is present; never rejects. */
export async function attachUser(req: Request, _res: Response, next: NextFunction) {
  try {
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof token === 'string') {
      const user = await findUserBySessionId(hashToken(token));
      if (user) req.user = user;
    }
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
