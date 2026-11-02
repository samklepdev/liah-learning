import type { PublicUser } from '../models/user.model.ts';

declare global {
  namespace Express {
    interface Request {
      /** Set by the attachUser middleware when a valid session cookie exists. */
      user?: PublicUser;
    }
  }
}
