import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import type { Request, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { parseUserRows } from '../lib/user-import-parser.ts';
import { createUser, findUserByName } from '../models/user.model.ts';

/** User lists are small — far below the 10MB cap on the quiz-PDF importer. */
export const uploadFile = multer({ limits: { fileSize: 5 * 1024 * 1024 } }).single('file');

export function parseImport(req: Request, res: Response): void {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: 'No file uploaded under field "file"' });
    return;
  }

  let result;
  try {
    result = parseUserRows({ buffer: file.buffer, originalname: file.originalname });
  } catch {
    // pdftotext failed on a malformed/corrupt PDF — same 422 handling as
    // admin-import.controller.ts's parseImport.
    res.status(422).json({
      error: 'Could not extract text from the uploaded file.',
      errors: [{ row: 0, message: 'Could not extract text from the uploaded file.' }],
    });
    return;
  }
  res.json(result);
}

const confirmBody = z.object({
  rows: z
    .array(
      z.object({
        row: z.number(),
        firstName: z.string().trim().min(1),
        lastName: z.string().trim().min(1),
        role: z.enum(['user', 'admin']),
      }),
    )
    .max(200, 'A single import is limited to 200 rows. Split larger files and import in batches.'),
});

/** 9 random bytes -> 12 base64url characters, ~72 bits of entropy. */
function generatePassword(): string {
  return randomBytes(9).toString('base64url');
}

export async function confirmImport(req: Request, res: Response): Promise<void> {
  const parsed = confirmBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: z.prettifyError(parsed.error) });
    return;
  }

  const created: Array<{
    username: string;
    firstName: string | null;
    lastName: string | null;
    role: string;
    password: string;
  }> = [];
  const skipped: Array<{ firstName: string | null; lastName: string | null; reason: string }> = [];

  for (const row of parsed.data.rows) {
    const existing = await findUserByName(row.firstName, row.lastName);
    if (existing) {
      skipped.push({ firstName: row.firstName, lastName: row.lastName, reason: 'already registered' });
      continue;
    }

    const password = generatePassword();
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await createUser(row.firstName, row.lastName, passwordHash, row.role);

    created.push({
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      password,
    });
  }

  res.json({ created, skipped });
}
