import type { Request, Response } from 'express';
import { findQuizByCourseSlug } from '../models/quiz.model.ts';

export async function getQuiz(req: Request, res: Response): Promise<void> {
  const quiz = await findQuizByCourseSlug(req.params.slug!);
  if (!quiz) {
    res.status(404).json({ error: 'Course not found' });
    return;
  }
  res.json({ quiz });
}
