import { execFileSync } from 'node:child_process';
import type { Request, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { parseQuizPack, QuizParseError, slugify, type ParsedSubject } from '../lib/quiz-parser.ts';

/** 10MB is comfortably above any of the eight existing subject packs. */
export const uploadPdf = multer({ limits: { fileSize: 10 * 1024 * 1024 } }).single('pdf');

const titleBody = z.object({ subjectTitle: z.string().trim().min(1) });

/**
 * Runs pdftotext on a real PDF upload. A .txt upload (used by tests, which
 * post pre-extracted text to avoid a pdftotext/poppler dependency in CI) is
 * used as-is.
 */
function extractText(file: Express.Multer.File): string {
  if (file.originalname.toLowerCase().endsWith('.txt')) {
    return file.buffer.toString('utf8');
  }
  return execFileSync('pdftotext', ['-layout', '-', '-'], {
    input: file.buffer,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
}

export async function parseImport(req: Request, res: Response): Promise<void> {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: 'No file uploaded under field "pdf"' });
    return;
  }

  const parsedBody = titleBody.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: z.prettifyError(parsedBody.error) });
    return;
  }
  const { subjectTitle } = parsedBody.data;
  const subjectSlug = slugify(subjectTitle);

  let text: string;
  try {
    text = extractText(file);
  } catch {
    res.status(422).json({ errors: ['Could not extract text from the uploaded file.'] });
    return;
  }

  try {
    const subject: ParsedSubject = parseQuizPack(text, { subjectSlug, subjectTitle });
    const questionCount = subject.courses.reduce((n, c) => n + c.questions.length, 0);
    res.json({
      subject,
      summary: { courses: subject.courses.length, questions: questionCount },
    });
  } catch (err) {
    if (err instanceof QuizParseError) {
      res.status(422).json({ errors: [err.message] });
      return;
    }
    throw err;
  }
}
