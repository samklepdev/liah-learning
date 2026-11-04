import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { env, isProd } from './config/env.ts';
import { attachUser } from './middleware/auth.middleware.ts';
import { errorHandler, notFound } from './middleware/error.middleware.ts';
import { apiRouter } from './routes/index.ts';

export const app = express();

// Required for `secure` cookies to be set when running behind a proxy/load
// balancer in production, which terminates TLS before the request reaches us.
if (isProd) app.set('trust proxy', 1);

// Only needed when the frontend is on a different origin. In dev the Vite
// proxy makes them same-origin, so this is a no-op. `credentials: true` plus an
// explicit origin is mandatory for cookies — a wildcard origin will not work.
if (env.CORS_ORIGIN) {
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
}

// A full parsed subject (all its courses, questions and options) can exceed
// the 100kb general-purpose cap below — the Chassis pack alone is ~108kb.
// body-parser skips a second json() call once a request's body is already
// parsed, so mounting this narrower, larger-limit parser first lets it win
// for just this one path without loosening the limit everywhere else.
app.use('/api/admin/import/confirm', express.json({ limit: '2mb' }));
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use(attachUser);

app.use('/api', apiRouter);

// Scoped to /api so an unknown API route still answers with JSON, leaving
// everything else for the SPA fallback below.
app.use('/api', notFound);

if (env.SERVE_FRONTEND) {
  // Resolves to <repo>/frontend/dist from both backend/src (tsx) and
  // backend/dist (built), since both are two levels under the repo root.
  const distDir = fileURLToPath(new URL('../../frontend/dist/', import.meta.url));
  const indexHtml = join(distDir, 'index.html');

  if (!existsSync(indexHtml)) {
    throw new Error(
      `SERVE_FRONTEND is on but ${indexHtml} is missing. Run: npm run build -w frontend`,
    );
  }

  // Hashed asset filenames are safe to cache hard; index.html must not be.
  app.use(express.static(distDir, { index: false, maxAge: '1y' }));

  // SPA fallback. A path middleware rather than app.get('*') — Express 5 uses
  // path-to-regexp v8, where a bare '*' is no longer a valid pattern.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    res.sendFile(indexHtml);
  });
}

app.use(notFound);
app.use(errorHandler);
