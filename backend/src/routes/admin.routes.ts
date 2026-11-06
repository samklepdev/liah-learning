import { Router } from 'express';
import * as adminCourses from '../controllers/admin-courses.controller.ts';
import * as adminUsers from '../controllers/admin-users.controller.ts';
import * as adminUserImport from '../controllers/admin-user-import.controller.ts';
import { adminImportRouter } from './admin-import.routes.ts';

export const adminRouter = Router();

adminRouter.get('/users', adminUsers.getUsers);
adminRouter.get('/users/deleted', adminUsers.getDeletedUsers);
adminRouter.post('/users', adminUsers.createUserHandler);
adminRouter.get('/users/:id/attempts', adminUsers.getUserAttempts);
adminRouter.patch('/users/:id/role', adminUsers.patchUserRole);
adminRouter.delete('/users/:id', adminUsers.deleteUser);
adminRouter.post('/users/:id/restore', adminUsers.restoreUserHandler);
adminRouter.post('/users/:id/reset-password', adminUsers.resetUserPassword);
adminRouter.get('/password-reset-requests', adminUsers.getPasswordResetRequests);
adminRouter.delete('/password-reset-requests/:userId', adminUsers.dismissPasswordResetRequest);
adminRouter.post('/users/import/parse', adminUserImport.uploadFile, adminUserImport.parseImport);
adminRouter.post('/users/import/confirm', adminUserImport.confirmImport);
adminRouter.use('/import', adminImportRouter);

adminRouter.get('/courses', adminCourses.getCourses);
adminRouter.delete('/courses/:id', adminCourses.deleteCourse);
adminRouter.get('/courses/deleted', adminCourses.getDeletedCourses);
adminRouter.post('/courses/:id/restore', adminCourses.restoreCourseHandler);
