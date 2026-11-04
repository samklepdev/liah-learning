import { Router } from 'express';
import * as auth from '../controllers/auth.controller.ts';
import { requireAuth } from '../middleware/auth.middleware.ts';

export const authRouter = Router();

authRouter.post('/register', auth.register);
authRouter.post('/login', auth.login);
authRouter.post('/logout', auth.logout);
authRouter.get('/me', requireAuth, auth.me);
authRouter.patch('/password', requireAuth, auth.changePassword);
