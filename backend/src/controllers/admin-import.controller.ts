import type { Request, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { extractPdfText } from '../lib/pdf-text.ts';
import { parseQuizPack, QuizParseError, slugify, type ParsedSubject } from '../lib/quiz-parser.ts';
import { seedSubject } from '../scripts/seed-quizzes.ts';

/** 10MB is comfortably above any of the eight existing subject packs. */
export const uploadPdf = multer({ limits: { fileSize: 10 * 1024 * 1024 } }).single('pdf');

const titleBody = z.object({ subjectTitle: z.string().trim().min(1) });

/**
 * A .txt upload (used by tests, which post pre-extracted text to avoid a
 * pdftotext/poppler dependency in CI) is used as-is.
 */
function extractText(file: Express.Multer.File): string {
  if (file.originalname.toLowerCase().endsWith('.txt')) {
    return file.buffer.toString('utf8');
  }
  return extractPdfText(file.buffer);
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

const confirmBody = z.object({
  subject: z.object({
    slug: z.string(),
    title: z.string(),
    courses: z.array(z.unknown()),
  }),
});

/**
 * The shallow `courses: z.array(z.unknown())` is deliberate: parseQuizPack
 * already validated the full shape when it produced this payload in
 * /parse. This only confirms the request looks like a subject before
 * re-trusting it as ParsedSubject, not re-running every assertion the
 * parser already made.
 */
export async function confirmImport(req: Request, res: Response): Promise<void> {
  const parsed = confirmBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: z.prettifyError(parsed.error) });
    return;
  }

  const result = await seedSubject(parsed.data.subject as ParsedSubject);
  res.json(result);
}
