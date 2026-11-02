import type { CookieOptions } from 'express';
import { env, isProd } from '../config/env.ts';

export const SESSION_COOKIE = 'sid';

export const SESSION_TTL_MS = env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;

export function sessionCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    // Dev is plain http://localhost, so `secure` would stop the cookie being set.
    secure: isProd,
    // 'lax' still sends the cookie on top-level navigation but not on
    // cross-site POSTs, which covers most of our CSRF surface.
    // Cross-origin deployments need 'none' + secure.
    sameSite: env.CORS_ORIGIN ? 'none' : 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS,
  };
}

/** clearCookie must repeat the attributes the cookie was set with, or the
 *  browser keeps it. Same options minus the lifetime. */
export function clearSessionCookieOptions(): CookieOptions {
  return { ...sessionCookieOptions(), maxAge: undefined };
}
