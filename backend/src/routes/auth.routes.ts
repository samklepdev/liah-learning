import { Router } from 'express';
import * as auth from '../controllers/auth.controller.ts';
import { requireAuth } from '../middleware/auth.middleware.ts';
import { authRateLimiter } from '../middleware/rate-limit.middleware.ts';

export const authRouter = Router();

authRouter.post('/register', authRateLimiter, auth.register);
authRouter.post('/login', authRateLimiter, auth.login);
authRouter.post('/logout', auth.logout);
authRouter.get('/me', requireAuth, auth.me);
authRouter.patch('/password', requireAuth, authRateLimiter, auth.changePassword);
