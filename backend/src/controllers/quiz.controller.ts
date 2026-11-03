import type { Request, Response } from 'express';
import { param } from '../lib/http.ts';
import { findCourseHistory } from '../models/attempt.model.ts';
import { findQuizByCourseSlug } from '../models/quiz.model.ts';

export async function getQuiz(req: Request, res: Response): Promise<void> {
  const quiz = await findQuizByCourseSlug(param(req, 'slug'));
  if (!quiz) {
    res.status(404).json({ error: 'Course not found' });
    return;
  }

  // History rides alongside the quiz rather than inside it: the quiz payload is
  // guarded by a leak test and must stay free of per-user state. The route is
  // requireAuth, so req.user is always present here.
  const history = await findCourseHistory(req.user!.id, quiz.courseId);

  res.json({ quiz, history });
}
