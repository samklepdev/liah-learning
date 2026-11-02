/** Lowercase kebab-case slug. Strips punctuation, collapses separators. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export class QuizParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuizParseError';
  }
}

export type CoverEntry = {
  position: number;
  title: string;
  moduleCount: number;
  questionCount: number;
};

/** Page headers, footers and form fields that carry no quiz content. */
const FURNITURE = [
  /Practice Material\s{2,}/,
  /^\f/,
  /^\s*Name:/,
  /^\s*Circle the best answer/,
  /POP QUIZ/,
  /MODULES COVERED/,
  /Retake date:/,
  /^\s*Course \d+: .*- Questions/,
  /Answer key: see/,
];

export function isFurniture(line: string): boolean {
  return FURNITURE.some((re) => re.test(line));
}

/**
 * Splits at the first per-quiz answer-key heading. Everything before is quiz
 * bodies; everything from there on is the key.
 */
export function splitSections(text: string): { body: string[]; key: string[] } {
  const lines = text.split('\n');
  const keyStart = lines.findIndex((l) => /^\s*Quiz \d+:.*- Answer Key\s*$/.test(l));
  if (keyStart === -1) {
    throw new QuizParseError(
      'No answer key section found (expected "Quiz N: ... - Answer Key").',
    );
  }
  return { body: lines.slice(0, keyStart), key: lines.slice(keyStart) };
}

const COVER_RE =
  /^\s*\d{1,2}\.\s+Course\s+(\d+)\s+-\s+(.+?)\s+\((\d+) modules?, (\d+) questions?\)/;

export function parseCoverList(body: string[]): CoverEntry[] {
  const entries: CoverEntry[] = [];
  for (const line of body) {
    const m = COVER_RE.exec(line);
    if (!m) continue;
    entries.push({
      position: Number(m[1]),
      title: m[2]!.trim(),
      moduleCount: Number(m[3]),
      questionCount: Number(m[4]),
    });
  }
  if (entries.length === 0) {
    throw new QuizParseError('Cover page listed no courses.');
  }
  return entries;
}
