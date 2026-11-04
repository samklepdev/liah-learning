import { Router } from 'express';
import * as adminUsers from '../controllers/admin-users.controller.ts';

export const adminRouter = Router();

adminRouter.get('/users', adminUsers.getUsers);
adminRouter.patch('/users/:id/role', adminUsers.patchUserRole);
adminRouter.delete('/users/:id', adminUsers.deleteUser);
