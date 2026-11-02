import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { authRouter } from './auth/routes.ts';
import { attachUser, requireAuth } from './auth/middleware.ts';
import { env, isProd } from './env.ts';

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

app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use(attachUser);

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

app.use('/api/auth', authRouter);

// Example of a gated route — anything mounted behind requireAuth gets req.user.
app.get('/api/me/dashboard', requireAuth, (req: Request, res: Response) => {
  res.json({ message: `Welcome back, ${req.user!.email}` });
});

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});
