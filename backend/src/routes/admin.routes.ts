import { Router } from 'express';
import * as adminUsers from '../controllers/admin-users.controller.ts';
import * as adminUserImport from '../controllers/admin-user-import.controller.ts';
import { adminImportRouter } from './admin-import.routes.ts';

export const adminRouter = Router();

adminRouter.get('/users', adminUsers.getUsers);
adminRouter.get('/users/:id/attempts', adminUsers.getUserAttempts);
adminRouter.patch('/users/:id/role', adminUsers.patchUserRole);
adminRouter.delete('/users/:id', adminUsers.deleteUser);
adminRouter.post('/users/import/parse', adminUserImport.uploadFile, adminUserImport.parseImport);
adminRouter.post('/users/import/confirm', adminUserImport.confirmImport);
adminRouter.use('/import', adminImportRouter);
