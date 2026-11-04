import { Router } from 'express';
import * as adminImport from '../controllers/admin-import.controller.ts';

export const adminImportRouter = Router();

adminImportRouter.post('/parse', adminImport.uploadPdf, adminImport.parseImport);

// The larger body-size cap for this route is applied in app.ts, ahead of the
// global express.json() — see the comment there.
adminImportRouter.post('/confirm', adminImport.confirmImport);
