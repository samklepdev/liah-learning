import type { SessionUser } from '../auth/sessions.ts';

declare global {
  namespace Express {
    interface Request {
      /** Set by the attachUser middleware when a valid session cookie exists. */
      user?: SessionUser;
    }
  }
}
