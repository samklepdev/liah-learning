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

export type OptionLabel = 'A' | 'B' | 'C' | 'D';

export type ParsedOption = { label: OptionLabel; body: string; isCorrect: boolean };

export type ParsedQuestion = {
  position: number;
  prompt: string;
  moduleTitle: string;
  explanation: string;
  options: ParsedOption[];
};

export type ParsedCourse = {
  position: number;
  slug: string;
  title: string;
  moduleTitles: string[];
  questionCount: number;
  questions: ParsedQuestion[];
};

export type ParsedSubject = { slug: string; title: string; courses: ParsedCourse[] };

type KeyEntry = { letter: OptionLabel; explanation: string };

const KEY_HEADER_RE = /^\s*Quiz (\d+):.*- Answer Key\s*$/;
const KEY_ENTRY_RE = /^\s*(\d{1,2})\.\s+([A-D])\s+-\s+(.+)$/;

/** Answer-key explanations wrap constantly - 101 of 110 in the Chassis pack. */
export function parseAnswerKey(key: string[]): Map<number, Map<number, KeyEntry>> {
  const out = new Map<number, Map<number, KeyEntry>>();
  let quiz: number | null = null;
  let current: KeyEntry | null = null;

  for (const line of key) {
    const header = KEY_HEADER_RE.exec(line);
    if (header) {
      quiz = Number(header[1]);
      current = null;
      continue;
    }

    const entry = KEY_ENTRY_RE.exec(line);
    if (entry && quiz !== null) {
      current = { letter: entry[2] as OptionLabel, explanation: entry[3]!.trim() };
      const perQuiz = out.get(quiz) ?? new Map<number, KeyEntry>();
      perQuiz.set(Number(entry[1]), current);
      out.set(quiz, perQuiz);
      continue;
    }

    if (current && line.trim() && !isFurniture(line) && !KEY_HEADER_RE.test(line)) {
      current.explanation = `${current.explanation} ${line.trim()}`.trim();
    }
  }

  for (const perQuiz of out.values()) {
    for (const e of perQuiz.values()) {
      e.explanation = e.explanation
        .replace(/\s*\[[^\]]*\]?\s*$/, '')
        .replace(/\s+/g, ' ')
        .trim();
    }
  }
  return out;
}

const normalize = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase();

export function parseQuizPack(
  text: string,
  opts: { subjectSlug: string; subjectTitle: string },
): ParsedSubject {
  const { body, key } = splitSections(text);
  const cover = parseCoverList(body);
  const moduleLists = parseModuleLists(body, cover);
  const questionBlocks = parseQuestionBlocks(body);
  const answerKey = parseAnswerKey(key);

  const courses: ParsedCourse[] = cover.map((entry) => {
    const where = `Course ${entry.position} (${entry.title})`;
    const moduleTitles = moduleLists.get(entry.position);
    if (!moduleTitles) throw new QuizParseError(`${where}: no module list found.`);

    const byTitle = new Map(moduleTitles.map((t) => [normalize(t), t]));
    const raws = questionBlocks.get(entry.position) ?? [];
    if (raws.length !== entry.questionCount) {
      throw new QuizParseError(
        `${where}: cover page declared ${entry.questionCount} questions, found ${raws.length}.`,
      );
    }

    const keyForQuiz = answerKey.get(entry.position);
    if (!keyForQuiz) throw new QuizParseError(`${where}: no answer key section found.`);

    const questions: ParsedQuestion[] = raws.map((raw) => {
      const at = `${where} question ${raw.position}`;

      if (raw.options.size !== 4) {
        throw new QuizParseError(
          `${at}: expected 4 options, found ${raw.options.size}.`,
        );
      }

      const moduleTitle = byTitle.get(normalize(raw.moduleTag));
      if (!moduleTitle) {
        throw new QuizParseError(
          `${at}: module tag [${raw.moduleTag}] does not match any listed module ` +
            `(${moduleTitles.join(', ')}).`,
        );
      }

      const entryForQ = keyForQuiz.get(raw.position);
      if (!entryForQ) throw new QuizParseError(`${at}: no answer-key entry.`);
      if (!raw.options.has(entryForQ.letter)) {
        throw new QuizParseError(
          `${at}: answer key says ${entryForQ.letter} but that option does not exist.`,
        );
      }

      const options: ParsedOption[] = (['A', 'B', 'C', 'D'] as const).map((label) => ({
        label,
        body: raw.options.get(label)!,
        isCorrect: label === entryForQ.letter,
      }));

      return {
        position: raw.position,
        prompt: raw.prompt,
        moduleTitle,
        explanation: entryForQ.explanation,
        options,
      };
    });

    return {
      position: entry.position,
      slug: `${opts.subjectSlug}-${slugify(entry.title)}`,
      title: entry.title,
      moduleTitles,
      questionCount: entry.questionCount,
      questions,
    };
  });

  return { slug: opts.subjectSlug, title: opts.subjectTitle, courses };
}
