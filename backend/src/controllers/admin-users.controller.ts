import type { Request, Response } from 'express';
import { z } from 'zod';
import { param } from '../lib/http.ts';
import { deleteUserById, listUsers, setUserRole } from '../models/admin-user.model.ts';

const roleBody = z.object({ role: z.enum(['user', 'admin']) });

export async function getUsers(_req: Request, res: Response): Promise<void> {
  const users = await listUsers();
  res.json({ users });
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
