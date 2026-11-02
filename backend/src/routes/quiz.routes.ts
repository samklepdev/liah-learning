import { Router } from 'express';
import * as quiz from '../controllers/quiz.controller.ts';
import * as attempt from '../controllers/attempt.controller.ts';
import { requireAuth } from '../middleware/auth.middleware.ts';

export const quizRouter = Router();

quizRouter.get('/courses/:slug/quiz', requireAuth, quiz.getQuiz);

quizRouter.post('/courses/:slug/attempts', requireAuth, attempt.startAttempt);
quizRouter.get('/attempts/:id', requireAuth, attempt.getAttempt);
quizRouter.put('/attempts/:id/answers/:questionId', requireAuth, attempt.putAnswer);
