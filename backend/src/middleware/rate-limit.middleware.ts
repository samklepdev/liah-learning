import rateLimit from 'express-rate-limit';
import { isTest } from '../config/env.ts';

/**
 * `skip` rather than not mounting either limiter at all in tests, so route
 * wiring stays identical between test and real servers; the suite otherwise
 * regularly exceeds both within a single file (many requests — including
 * many logins/registrations — against one shared test server).
 */
const skipInTest = () => isTest;

/**
 * Baseline cap on every /api/v1 request, keyed by IP (the default). Generous
 * enough for normal use (browsing subjects, taking a quiz, polling search as
 * you type) — this is a backstop against a single client hammering the API,
 * not a precise per-endpoint budget.
 */
export const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  message: { error: 'Too many requests. Try again later.' },
});

/**
 * Additional, much tighter cap stacked on top of `apiRateLimiter` for
 * credential-guessing and account-creation spam on the sensitive auth
 * endpoints (login, register, password change). A stolen session is exactly
 * the case changePassword still needs this for.
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  message: { error: 'Too many attempts. Try again later.' },
});
