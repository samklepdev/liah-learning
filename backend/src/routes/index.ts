import { Router } from 'express';
import type { Request, Response } from 'express';
import { requireAdmin, requireAuth } from '../middleware/auth.middleware.ts';
import { adminRouter } from './admin.routes.ts';
import { authRouter } from './auth.routes.ts';
import { catalogRouter } from './catalog.routes.ts';
import { quizRouter } from './quiz.routes.ts';

/** Everything under /api/v1. Mounted once in app.ts. */
export const apiRouter = Router();

apiRouter.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

apiRouter.use('/auth', authRouter);
apiRouter.use('/', catalogRouter);
apiRouter.use('/', quizRouter);
apiRouter.use('/admin', requireAuth, requireAdmin, adminRouter);

// Example of a gated route — anything behind requireAuth gets req.user.
apiRouter.get('/me/dashboard', requireAuth, (req: Request, res: Response) => {
  res.json({ message: `Welcome back, ${req.user!.email}` });
});
