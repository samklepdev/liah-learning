import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
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

app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use(attachUser);

app.use('/api', apiRouter);

app.use(notFound);
app.use(errorHandler);
