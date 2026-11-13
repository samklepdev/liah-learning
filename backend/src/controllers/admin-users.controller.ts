import type { Request, Response } from 'express';
import { z } from 'zod';
import { param } from '../lib/http.ts';
import { PAGE_SIZE, parsePage } from '../lib/pagination.ts';
import { listAttemptsForUser } from '../models/admin-attempt.model.ts';
import {
  countDeletedUsers,
  countUsers,
  deleteUserById,
  findUserById,
  listDeletedUsers,
  listUsers,
  restoreUserById,
  setUserRole,
} from '../models/admin-user.model.ts';
import {
  createUser,
  findUserByName,
  forcePasswordChange,
  INITIAL_PASSWORD,
  updatePasswordHash,
} from '../models/user.model.ts';
import { deleteSessionsForUser } from '../models/session.model.ts';
import { deletePasswordResetRequest, listPasswordResetRequests } from '../models/password-reset-request.model.ts';
import argon2 from 'argon2';

const roleBody = z.object({ role: z.enum(['user', 'admin']) });

const createUserBody = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(100),
  lastName: z.string().trim().min(1, 'Last name is required').max(100),
  role: z.enum(['user', 'admin']),
});

export async function createUserHandler(req: Request, res: Response): Promise<void> {
  const parsed = createUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: z.prettifyError(parsed.error) });
    return;
  }
  const { firstName, lastName, role } = parsed.data;

  const existing = await findUserByName(firstName, lastName);
  if (existing) {
    res.status(400).json({ error: 'A user with this name already exists' });
    return;
  }

  const passwordHash = await argon2.hash(INITIAL_PASSWORD, { type: argon2.argon2id });
  const user = await createUser(firstName, lastName, passwordHash, role, true);
  res.status(201).json({ user });
}

export async function getUsers(req: Request, res: Response): Promise<void> {
  const page = parsePage(req);
  const [items, total] = await Promise.all([listUsers(page), countUsers()]);
  res.json({ items, total, page, pageSize: PAGE_SIZE });
}

export async function getDeletedUsers(req: Request, res: Response): Promise<void> {
  const page = parsePage(req);
  const [items, total] = await Promise.all([listDeletedUsers(page), countDeletedUsers()]);
  res.json({ items, total, page, pageSize: PAGE_SIZE });
}

export async function restoreUserHandler(req: Request, res: Response): Promise<void> {
  const id = param(req, 'id');
  const user = await restoreUserById(id);
  if (!user) {
    res.status(404).json({ error: 'Deleted user not found' });
    return;
  }
  res.json({ user });
}

export async function patchUserRole(req: Request, res: Response): Promise<void> {
  const id = param(req, 'id');

  if (id === req.user!.id) {
    res.status(400).json({ error: 'You cannot change your own role' });
    return;
  }

  const parsed = roleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: z.prettifyError(parsed.error) });
    return;
  }

  const user = await setUserRole(id, parsed.data.role);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json({ user });
}

export async function deleteUser(req: Request, res: Response): Promise<void> {
  const id = param(req, 'id');

  if (id === req.user!.id) {
    res.status(400).json({ error: 'You cannot delete your own account' });
    return;
  }

  const deleted = await deleteUserById(id);
  if (!deleted) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.status(204).end();
}

export async function resetUserPassword(req: Request, res: Response): Promise<void> {
  const id = param(req, 'id');

  if (id === req.user!.id) {
    res.status(400).json({ error: 'Use the change-password form to update your own password' });
    return;
  }

  const target = await findUserById(id);
  if (!target || !target.isActive) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const passwordHash = await argon2.hash(INITIAL_PASSWORD, { type: argon2.argon2id });
  await updatePasswordHash(id, passwordHash);
  await forcePasswordChange(id);
  await deleteSessionsForUser(id);
  await deletePasswordResetRequest(id);

  res.status(204).end();
}

export async function getPasswordResetRequests(req: Request, res: Response): Promise<void> {
  const requests = await listPasswordResetRequests();
  res.json({ requests });
}

export async function dismissPasswordResetRequest(req: Request, res: Response): Promise<void> {
  const userId = param(req, 'userId');
  await deletePasswordResetRequest(userId);
  res.status(204).end();
}

export async function getUserAttempts(req: Request, res: Response): Promise<void> {
  const id = param(req, 'id');
  const user = await findUserById(id);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  const attempts = await listAttemptsForUser(id);
  res.json({ attempts });
}
