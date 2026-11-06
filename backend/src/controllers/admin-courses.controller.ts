import type { Request, Response } from 'express';
import { param } from '../lib/http.ts';
import {
  deleteCourseById,
  listCourses,
  listDeletedCourses,
  restoreCourseById,
} from '../models/admin-course.model.ts';

export async function getCourses(_req: Request, res: Response): Promise<void> {
  res.json({ items: await listCourses() });
}

export async function deleteCourse(req: Request, res: Response): Promise<void> {
  const id = param(req, 'id');
  const deleted = await deleteCourseById(id);
  if (!deleted) {
    res.status(404).json({ error: 'Course not found' });
    return;
  }
  res.status(204).end();
}

export async function getDeletedCourses(_req: Request, res: Response): Promise<void> {
  res.json({ items: await listDeletedCourses() });
}

export async function restoreCourseHandler(req: Request, res: Response): Promise<void> {
  const id = param(req, 'id');
  const course = await restoreCourseById(id);
  if (!course) {
    res.status(404).json({ error: 'Deleted course not found' });
    return;
  }
  res.json({ course });
}
