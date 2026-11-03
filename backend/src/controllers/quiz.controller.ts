import type { Request, Response } from 'express';
import { param } from '../lib/http.ts';
import { findQuizByCourseSlug } from '../models/quiz.model.ts';

export async function getQuiz(req: Request, res: Response): Promise<void> {
  const quiz = await findQuizByCourseSlug(param(req, 'slug'));
  if (!quiz) {
    res.status(404).json({ error: 'Course not found' });
    return;
  }
  res.json({ quiz });
}
