import { Router } from 'express';
import * as catalog from '../controllers/catalog.controller.ts';

export const catalogRouter = Router();

// Public: the catalog is browsable before signing in. Per-user columns are
// populated only when a session cookie is present.
catalogRouter.get('/subjects', catalog.getSubjects);
catalogRouter.get('/courses', catalog.getCourses);
