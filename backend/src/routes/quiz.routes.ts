import { Router } from 'express';
import * as quiz from '../controllers/quiz.controller.ts';
import { requireAuth } from '../middleware/auth.middleware.ts';

export const quizRouter = Router();

quizRouter.get('/courses/:slug/quiz', requireAuth, quiz.getQuiz);
