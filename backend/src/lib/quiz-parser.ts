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

const COURSE_HEADER_RE = /^\s*Course (\d+):\s+(.+?)\s*$/;
const QUESTION_RE = /^\s*(\d{1,2})\.\s+(.+)$/;
const OPTION_RE = /^\s{2,}([A-D])\.\s+(.+)$/;
const MODULE_LIST_ITEM_RE = /^\s{3,}\S/;

/** The course header opening a quiz, ignoring the "- Questions 6-10" banner. */
function courseHeaderAt(line: string): number | null {
  const m = COURSE_HEADER_RE.exec(line);
  if (!m || line.includes('- Questions')) return null;
  return Number(m[1]);
}

/**
 * Each course declares its module count on the cover page, so we take exactly
 * that many indented lines after its "MODULES COVERED" banner.
 */
export function parseModuleLists(
  body: string[],
  cover: CoverEntry[],
): Map<number, string[]> {
  const expected = new Map(cover.map((c) => [c.position, c.moduleCount]));
  const out = new Map<number, string[]>();
  let current: number | null = null;

  for (let i = 0; i < body.length; i++) {
    const line = body[i]!;
    const header = courseHeaderAt(line);
    if (header !== null) current = header;

    if (!line.includes('MODULES COVERED') || current === null) continue;
    if (out.has(current)) continue;

    const want = expected.get(current);
    if (want === undefined) {
      throw new QuizParseError(
        `Course ${current} has a module list but is not on the cover page.`,
      );
    }

    const titles: string[] = [];
    for (let j = i + 1; j < body.length && titles.length < want; j++) {
      const candidate = body[j]!;
      if (!candidate.trim()) continue;
      if (isFurniture(candidate) || !MODULE_LIST_ITEM_RE.test(candidate)) break;
      titles.push(candidate.trim());
    }

    if (titles.length !== want) {
      throw new QuizParseError(
        `Course ${current}: cover page declared ${want} modules, found ${titles.length}.`,
      );
    }
    out.set(current, titles);
  }
  return out;
}

export type RawQuestion = {
  position: number;
  prompt: string;
  moduleTag: string;
  options: Map<string, string>;
};

/**
 * Walks each quiz body. A question's text may wrap across lines, and the
 * bracketed module tag may start on one line and close on another, so lines are
 * joined until the accumulated text contains a complete [...] tag. Options never
 * wrap, so an option line always terminates the join.
 */
export function parseQuestionBlocks(body: string[]): Map<number, RawQuestion[]> {
  const out = new Map<number, RawQuestion[]>();
  let course: number | null = null;
  let i = 0;

  while (i < body.length) {
    const line = body[i]!;

    const header = courseHeaderAt(line);
    if (header !== null) {
      course = header;
      i++;
      continue;
    }

    const qm = QUESTION_RE.exec(line);
    const isCoverLine = qm?.[2]?.startsWith('Course ') ?? false;
    if (!qm || isCoverLine || course === null || isFurniture(line)) {
      i++;
      continue;
    }

    let accumulated = qm[2]!;
    let j = i + 1;
    while (!/\[[^\]]+\]/.test(accumulated) && j < body.length) {
      const next = body[j]!;
      if (!next.trim() || isFurniture(next)) {
        j++;
        continue;
      }
      if (OPTION_RE.test(next) || QUESTION_RE.test(next)) break;
      accumulated = `${accumulated} ${next.trim()}`.trim();
      j++;
    }

    const tagMatch = /\[([^\]]+)\]/.exec(accumulated);
    const prompt = accumulated
      .replace(/\s*\[[^\]]+\]\s*/, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const options = new Map<string, string>();
    let k = j;
    while (k < body.length && options.size < 4) {
      const candidate = body[k]!;
      const om = OPTION_RE.exec(candidate);
      if (om) {
        options.set(om[1]!, om[2]!.trim());
      } else if (
        candidate.trim() &&
        !isFurniture(candidate) &&
        QUESTION_RE.test(candidate)
      ) {
        break;
      }
      k++;
    }

    const list = out.get(course) ?? [];
    list.push({
      position: Number(qm[1]),
      prompt,
      moduleTag: (tagMatch?.[1] ?? '').replace(/\s+/g, ' ').trim(),
      options,
    });
    out.set(course, list);
    i = k;
  }

  return out;
}
