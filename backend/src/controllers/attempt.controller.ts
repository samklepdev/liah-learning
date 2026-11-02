import type { Request, Response } from 'express';
import { z } from 'zod';
import { param } from '../lib/http.ts';
import { findQuizByCourseSlug } from '../models/quiz.model.ts';
import {
  findAttemptById,
  findGradedAttempt,
  findOptionForQuestion,
  listAnswers,
  saveAnswer,
  startOrResumeAttempt,
  submitAttempt,
  type AttemptRow,
} from '../models/attempt.model.ts';

const answerBody = z.object({ optionId: z.uuid() });

/**
 * Loads an attempt the caller owns. A missing attempt and someone else's
 * attempt are both 404 — a 403 would confirm the id exists.
 */
async function loadOwnedAttempt(req: Request, res: Response): Promise<AttemptRow | null> {
  const attempt = await findAttemptById(param(req, 'id'));
  if (!attempt || attempt.userId !== req.user!.id) {
    res.status(404).json({ error: 'Attempt not found' });
    return null;
  }
  return attempt;
}

export async function startAttempt(req: Request, res: Response): Promise<void> {
  const quiz = await findQuizByCourseSlug(param(req, 'slug'));
  if (!quiz) {
    res.status(404).json({ error: 'Course not found' });
    return;
  }

  const { attempt, created } = await startOrResumeAttempt(req.user!.id, quiz.courseId);
  res.status(created ? 201 : 200).json({ attempt });
}

export async function getAttempt(req: Request, res: Response): Promise<void> {
  const attempt = await loadOwnedAttempt(req, res);
  if (!attempt) return;

  if (attempt.submittedAt) {
    const graded = await findGradedAttempt(attempt.id);
    if (!graded) {
      res.status(404).json({ error: 'Attempt not found' });
      return;
    }
    res.json({ attempt: graded });
    return;
  }

  res.json({
    attempt: {
      id: attempt.id,
      courseId: attempt.courseId,
      startedAt: attempt.startedAt,
      submittedAt: null,
      answers: await listAnswers(attempt.id),
    },
  });
}

export async function submit(req: Request, res: Response): Promise<void> {
  const attempt = await loadOwnedAttempt(req, res);
  if (!attempt) return;

  // Idempotent: a second submit returns the existing grade rather than regrading.
  if (!attempt.submittedAt) {
    await submitAttempt(attempt.id);
  }

  const graded = await findGradedAttempt(attempt.id);
  if (!graded) {
    res.status(500).json({ error: 'Attempt could not be graded' });
    return;
  }
  res.json({ attempt: graded });
}

export async function putAnswer(req: Request, res: Response): Promise<void> {
  const attempt = await loadOwnedAttempt(req, res);
  if (!attempt) return;

  if (attempt.submittedAt) {
    res.status(409).json({ error: 'Attempt already submitted' });
    return;
  }

  const parsed = answerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'optionId must be a uuid' });
    return;
  }

  const option = await findOptionForQuestion(param(req, 'questionId'), parsed.data.optionId);
  if (!option) {
    res.status(400).json({ error: 'That option does not belong to that question' });
    return;
  }
  if (option.courseId !== attempt.courseId) {
    res.status(400).json({ error: 'That question does not belong to this attempt' });
    return;
  }

  await saveAnswer(attempt.id, param(req, 'questionId'), parsed.data.optionId, option.isCorrect);
  res.status(204).end();
}
