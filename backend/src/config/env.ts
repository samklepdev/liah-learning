import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.url(),
  /** Empty/unset means the frontend is same-origin (the Vite proxy in dev). */
  CORS_ORIGIN: z
    .string()
    .transform((v) => v.trim())
    .pipe(z.url().or(z.literal('')))
    .optional()
    .transform((v) => (v === '' ? undefined : v)),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(7),
  /**
   * Serve frontend/dist from this server, with an SPA fallback. Required in
   * production: BrowserRouter means a direct hit on /courses/x/results/y must
   * return index.html, not 404. Off by default so dev and tests keep Vite's
   * dev server as the only thing serving HTML.
   */
  SERVE_FRONTEND: z.stringbool().default(false),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error(
    'Invalid environment. Copy backend/.env.example to backend/.env and fill it in.\n' +
      z.prettifyError(parsed.error),
  );
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
