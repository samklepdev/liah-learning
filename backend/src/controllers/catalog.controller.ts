import type { Request, Response } from 'express';
import {
  findSubjectBySlug,
  listCoursesBySubject,
  listSubjects,
} from '../models/catalog.model.ts';

export async function getSubjects(_req: Request, res: Response): Promise<void> {
  res.json({ subjects: await listSubjects() });
}

export async function getCourses(req: Request, res: Response): Promise<void> {
  const slug = typeof req.query.subject === 'string' ? req.query.subject : '';
  if (!slug) {
    res.status(400).json({ error: 'A subject query parameter is required' });
    return;
  }

  if (!(await findSubjectBySlug(slug))) {
    res.status(404).json({ error: 'Subject not found' });
    return;
  }

  res.json({ courses: await listCoursesBySubject(slug, req.user?.id ?? null) });
}
