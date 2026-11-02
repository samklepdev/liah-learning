import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { parseQuizPack, slugify, QuizParseError } from '../lib/quiz-parser.ts';

function usage(): never {
  console.error(
    'Usage: npm run quiz:parse -w backend -- <path-to-pdf> [subject-title]\n' +
      'Example: npm run quiz:parse -w backend -- ' +
      '"$HOME/Documents/LIAH-classes/quizzes/Chassis Pop Quizzes.pdf"',
  );
  process.exit(1);
}

const pdfPath = process.argv[2];
if (!pdfPath) usage();

// "Chassis Pop Quizzes.pdf" -> "Chassis"
const inferred = basename(pdfPath).replace(/\s*Pop Quizzes\.pdf$/i, '').trim();
const subjectTitle = process.argv[3] ?? inferred;
const subjectSlug = slugify(subjectTitle);

let text: string;
try {
  text = execFileSync('pdftotext', ['-layout', resolve(pdfPath), '-'], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
} catch {
  console.error('pdftotext failed. Install it with: brew install poppler');
  process.exit(1);
}

try {
  const subject = parseQuizPack(text, { subjectSlug, subjectTitle });
  const outDir = new URL('../data/', import.meta.url);
  mkdirSync(outDir, { recursive: true });
  const outFile = new URL(`${subjectSlug}.quiz.json`, outDir);
  writeFileSync(outFile, `${JSON.stringify(subject, null, 2)}\n`, 'utf8');

  const questions = subject.courses.reduce((n, c) => n + c.questions.length, 0);
  console.log(
    `Parsed ${subject.courses.length} courses, ${questions} questions -> ` +
      `src/data/${subjectSlug}.quiz.json`,
  );
} catch (err) {
  if (err instanceof QuizParseError) {
    console.error(`Parse failed: ${err.message}`);
    process.exit(1);
  }
  throw err;
}
