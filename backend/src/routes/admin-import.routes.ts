import { Router } from 'express';
import * as adminImport from '../controllers/admin-import.controller.ts';

export const adminImportRouter = Router();

adminImportRouter.post('/parse', adminImport.uploadPdf, adminImport.parseImport);
