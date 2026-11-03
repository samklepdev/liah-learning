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

/** Every pack scores each quiz out of ten; only some say so on the cover. */
const QUESTIONS_PER_QUIZ = 10;

/**
 * En/em dashes stand in for hyphens inconsistently across packs. The plain
 * hyphen goes last so these stay literal when embedded in a larger class.
 */
const DASH_CHARS = '–—-';
const DASH = `[${DASH_CHARS}]`;

/** Page headers, footers and form fields that carry no quiz content. */
const FURNITURE = [
  /Practice Material\s{2,}/,
  /^\f/,
  /^\s*Name:/,
  /^\s*Circle the best answer/,
  /POP QUIZ/i,
  /MODULES COVERED/i,
  /^\s*Courses covered\s*$/i,
  /Retake date:/,
  /Second score:/,
  /^\s*Course \d+: .*- Questions/,
  // A page number, or the orphaned tail of a wrapped "- Questions 6-10"
  // banner. Never meaningful content: prose continuations are never bare
  // digits, and a numeric option body arrives on its own "B. ..." line.
  /^\s*\d{1,3}\s*$/,
  /Answer key: see/,
  /^\s*Answer Key\b/i,
  /^\s*QUIZ \d+ OF \d+\s*$/i,
  /^\s*Quiz\s+Course\s+Modules/,
  /^\s*Q\s+Answer\s+Why\s*$/,
  /^\s*Total modules/i,
  /^\s*End of Quiz/i,
  /^\s*Finished\?/i,
  /Page \d+ of \d+/,
  /Score: ___/,
];

export function isFurniture(line: string): boolean {
  return FURNITURE.some((re) => re.test(line));
}

// ---------------------------------------------------------------------------
// Dialects
// ---------------------------------------------------------------------------

type KeyEntry = { letter: OptionLabel; explanation: string };

export type Dialect = {
  name: string;
  /** Heading that opens the answer-key section, capturing the quiz number. */
  keyHeading: RegExp;
  parseCover: (body: string[]) => CoverEntry[];
  parseKey: (key: string[]) => Map<number, Map<number, KeyEntry>>;
};

const KEY_HEADING_CLASSIC = new RegExp(`^\\s*Quiz (\\d+):.*${DASH} Answer Key\\s*$`);
const KEY_HEADING_TABLE = new RegExp(`^\\s*Answer Key\\s*${DASH}\\s*Quiz (\\d+)\\s*[:${DASH_CHARS}]`);
const KEY_HEADING_NUMBERED = /^\s*ANSWER KEY\s*-\s*QUIZ (\d+) OF \d+\s*$/i;

/**
 * Chassis and Engine: a numbered cover list carrying both counts, "Course N:"
 * quiz headings, bracketed module tags and per-quiz answer-key sections.
 */
const CLASSIC: Dialect = {
  name: 'classic',
  keyHeading: KEY_HEADING_CLASSIC,
  parseCover: parseCoverNumbered,
  parseKey: (key) => parseKeyInline(key, KEY_HEADING_CLASSIC, false),
};

/**
 * Drive Train, Drivers Assist, Electrical, HVAC and Servicing: a cover table
 * giving only module counts, "Quiz N - Title" headings, and module tags that
 * may be bracketed, on a "Module:" line, or an upper-case group heading.
 */
const TABLE: Dialect = {
  name: 'table',
  keyHeading: KEY_HEADING_TABLE,
  parseCover: parseCoverTable,
  parseKey: (key) => parseKeyInline(key, KEY_HEADING_TABLE, false),
};

/**
 * Electrical restates the correct option on the entry line and puts the
 * explanation on the line below it.
 */
const TABLE_SPLIT_KEY: Dialect = {
  ...TABLE,
  name: 'table-split-key',
  parseKey: (key) => parseKeyInline(key, KEY_HEADING_TABLE, true),
};

/**
 * Diagnostics: the cover is a two-column list that pdftotext interleaves, so
 * courses are read from the body instead. Its answer key is a Q/Answer/Why
 * table rather than a list of entries.
 */
const NUMBERED: Dialect = {
  name: 'numbered',
  keyHeading: KEY_HEADING_NUMBERED,
  parseCover: parseCoverFromBody,
  parseKey: parseKeyTable,
};

/** Picks a dialect from the answer-key heading style, which is unambiguous. */
export function detectDialect(text: string): Dialect {
  const lines = text.split('\n');
  const has = (re: RegExp): boolean => lines.some((l) => re.test(l));

  if (has(KEY_HEADING_CLASSIC)) return CLASSIC;
  if (has(KEY_HEADING_NUMBERED)) return NUMBERED;
  if (has(KEY_HEADING_TABLE)) {
    // Electrical's entry line holds the option text, not the explanation, and
    // its heading separates the title with a dash where the others use a colon.
    const splitKey = new RegExp(`^\\s*Answer Key\\s*${DASH}\\s*Quiz \\d+\\s*${DASH}\\s`);
    return has(splitKey) ? TABLE_SPLIT_KEY : TABLE;
  }
  throw new QuizParseError(
    'No answer key section found (expected one of "Quiz N: ... - Answer Key", ' +
      '"Answer Key - Quiz N: ...", or "ANSWER KEY - QUIZ N OF M").',
  );
}

/**
 * Splits at the first answer-key heading. Everything before is quiz bodies;
 * everything from there on is the key.
 */
export function splitSections(
  text: string,
  dialect: Dialect = detectDialect(text),
): { body: string[]; key: string[] } {
  const lines = text.split('\n');
  const keyStart = lines.findIndex((l) => dialect.keyHeading.test(l));
  if (keyStart === -1) {
    throw new QuizParseError(
      `No answer key section found for the ${dialect.name} dialect.`,
    );
  }
  return { body: lines.slice(0, keyStart), key: lines.slice(keyStart) };
}

// ---------------------------------------------------------------------------
// Cover pages
// ---------------------------------------------------------------------------

const COVER_NUMBERED_RE = new RegExp(
  `^\\s*\\d{1,2}\\.\\s+Course\\s+(\\d+)\\s+${DASH}\\s+(.+?)\\s+\\((\\d+) modules?, (\\d+) questions?\\)`,
);

export function parseCoverNumbered(body: string[]): CoverEntry[] {
  const entries: CoverEntry[] = [];
  for (const line of body) {
    const m = COVER_NUMBERED_RE.exec(line);
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

const COVER_TABLE_HEADER_RE = /^\s*Quiz\s+Course\s+Modules/;
const COVER_TABLE_ROW_RE = /^\s*(\d{1,2})\s{2,}(\S.*?)\s{2,}(\d{1,2})\s*(?:___.*)?$/;

/** A "Quiz | Course | Modules" table; question counts are not stated. */
export function parseCoverTable(body: string[]): CoverEntry[] {
  const start = body.findIndex((l) => COVER_TABLE_HEADER_RE.test(l));
  if (start === -1) throw new QuizParseError('Cover page listed no courses.');

  const entries: CoverEntry[] = [];
  for (let i = start + 1; i < body.length; i++) {
    const line = body[i]!;
    if (/^\s*Name:/.test(line) || /^\s*Total modules/i.test(line)) break;
    const m = COVER_TABLE_ROW_RE.exec(line);
    if (!m) continue;
    const position = Number(m[1]);
    // The table is ordered, so a row numbered out of sequence is page noise.
    if (position !== entries.length + 1) continue;
    entries.push({
      position,
      title: m[2]!.trim(),
      moduleCount: Number(m[3]),
      questionCount: QUESTIONS_PER_QUIZ,
    });
  }
  if (entries.length === 0) throw new QuizParseError('Cover page listed no courses.');
  return entries;
}

const MODULE_BANNER_RE = /Modules\s+covered\s*(?:\((\d+)\))?\s*:?\s*(.*)$/i;

/**
 * Reads courses from the quiz bodies rather than the cover page, for packs
 * whose cover is a multi-column list that pdftotext interleaves unusably.
 */
export function parseCoverFromBody(body: string[]): CoverEntry[] {
  const entries: CoverEntry[] = [];
  const seen = new Set<number>();

  for (let i = 0; i < body.length; i++) {
    const position = courseHeaderAt(body[i]!);
    if (position === null || seen.has(position)) continue;

    // The module banner's parenthesised count is the course's module total.
    for (let j = i + 1; j < Math.min(i + 12, body.length); j++) {
      const m = MODULE_BANNER_RE.exec(body[j]!);
      if (!m) continue;
      const moduleCount = Number(m[1]);
      if (!moduleCount) break;
      seen.add(position);
      entries.push({
        position,
        title: courseTitleAt(body[i]!) ?? `Course ${position}`,
        moduleCount,
        questionCount: QUESTIONS_PER_QUIZ,
      });
      break;
    }
  }

  if (entries.length === 0) throw new QuizParseError('Cover page listed no courses.');
  entries.sort((a, b) => a.position - b.position);
  return entries;
}

/** Kept for the Chassis-era call sites and tests. */
export const parseCoverList = parseCoverNumbered;

// ---------------------------------------------------------------------------
// Quiz headings
// ---------------------------------------------------------------------------

const COURSE_HEADER_RE = new RegExp(`^\\s*(?:Course|Quiz) (\\d+)\\s*[:${DASH_CHARS}]\\s+(.+?)\\s*$`);

/** The heading opening a quiz, ignoring continuation and page banners. */
function courseHeaderAt(line: string): number | null {
  const m = COURSE_HEADER_RE.exec(line);
  if (!m) return null;
  if (line.includes('- Questions')) return null;
  if (/Answer Key/i.test(line)) return null;
  return Number(m[1]);
}

function courseTitleAt(line: string): string | null {
  const m = COURSE_HEADER_RE.exec(line);
  if (!m) return null;
  return m[2]!
    .replace(/\s*\((?:\d+ of \d+|continued)\)\s*$/i, '')
    .replace(/\s{2,}.*$/, '')
    .trim();
}

// ---------------------------------------------------------------------------
// Module lists
// ---------------------------------------------------------------------------

const MODULE_LIST_ITEM_RE = /^\s{2,}\S/;

/**
 * Inline lists separate modules by pipe, bullet or comma. The explicit
 * separators win over the comma, because a module title may itself contain one
 * ("Engine Oil Basis Additives, and Compositions" in the Servicing pack).
 */
const INLINE_SEPARATORS = [/\s*\|\s*/, /\s*•\s*/, /\s*,\s*/];

function splitInlineModules(text: string): string[] {
  const separator = INLINE_SEPARATORS.find((re) => re.test(text)) ?? /\s*,\s*/;
  return text
    .split(separator)
    .map((s) => s.replace(/^\s*\d{1,2}\.\s*/, '').trim())
    .filter(Boolean);
}

/**
 * Each course declares its module count, so we read exactly that many titles
 * after its "Modules covered" banner. The list is either inline on the banner
 * (wrapping across following lines) or one title per indented line.
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

    const banner = MODULE_BANNER_RE.exec(line);
    if (!banner || current === null || out.has(current)) continue;

    const want = expected.get(current);
    if (want === undefined) {
      throw new QuizParseError(
        `Course ${current} has a module list but is not on the cover page.`,
      );
    }

    const inlineRest = banner[2]?.trim() ?? '';
    const titles = inlineRest
      ? collectInlineModules(body, i, inlineRest, want)
      : collectListedModules(body, i, want);

    if (titles.length !== want) {
      throw new QuizParseError(
        `Course ${current}: cover page declared ${want} modules, found ${titles.length}.`,
      );
    }
    out.set(current, titles);
  }
  return out;
}

/**
 * An inline list wraps across lines, and the wrap can fall mid-title ("48 Volt
 * Electric Turbo" / "Technology"), so the block is collected structurally — to
 * the first blank line or heading — rather than stopping once `want` separators
 * have been seen. Stopping on the count truncates the final title.
 */
function collectInlineModules(
  body: string[],
  bannerIndex: number,
  inlineRest: string,
  want: number,
): string[] {
  let accumulated = inlineRest;
  for (let j = bannerIndex + 1; j < body.length; j++) {
    const next = body[j]!;
    if (!next.trim()) break;
    if (isFurniture(next) || QUESTION_RE.test(next) || OPTION_RE.test(next)) break;
    if (!MODULE_LIST_ITEM_RE.test(next)) break;
    accumulated = `${accumulated} ${next.trim()}`.trim();
  }
  return splitInlineModules(accumulated).slice(0, want);
}

/**
 * A list sitting below its banner is either one title per line, or a numbered
 * run joined by pipes that wraps across lines. The wrap can fall mid-title
 * ("Engine Oil Basis Additives" / "and Compositions"), so a separated run is
 * gathered whole and split once rather than line by line.
 */
function collectListedModules(
  body: string[],
  bannerIndex: number,
  want: number,
): string[] {
  const block: string[] = [];
  for (let j = bannerIndex + 1; j < body.length; j++) {
    const candidate = body[j]!;
    if (!candidate.trim()) {
      if (block.length > 0) break;
      continue;
    }
    if (isFurniture(candidate) || !MODULE_LIST_ITEM_RE.test(candidate)) break;
    block.push(candidate.trim());
    if (block.length >= want && !hasInlineSeparator(block[0]!)) break;
  }

  if (block.length > 0 && hasInlineSeparator(block[0]!)) {
    return splitInlineModules(block.join(' ')).slice(0, want);
  }
  return block.slice(0, want);
}

function hasInlineSeparator(text: string): boolean {
  return /\||•/.test(text);
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

export type RawQuestion = {
  position: number;
  prompt: string;
  moduleTag: string;
  options: Map<string, string>;
};

const QUESTION_RE = /^\s*(\d{1,2})\.\s+(.+)$/;
const OPTION_RE = /^\s*([A-D])\.\s+(.+)$/;
const MODULE_LINE_RE = /^\s*Module:\s*(.+?)\s*$/;
/**
 * Allows a space after the first letter because some packs set these headings
 * in tracked-out type, which pdftotext renders letter by letter
 * ("M A N U A L T R A N S M I S S I O N").
 */
const GROUP_HEADING_RE = /^\s*([A-Z][A-Z0-9 /&'()+.-]{4,})\s*$/;

/** Comparison that survives letter-spacing and punctuation differences. */
const squash = (s: string): string => s.replace(/[^a-z0-9]/gi, '').toLowerCase();

/**
 * Whether a line can be the continuation of a wrapped prompt or option.
 *
 * Wrapped prose is a single text flow, so it never contains a long run of
 * internal spaces. A run of three or more means pdftotext laid two columns side
 * by side on one line — a page footer printed across the option text, say — and
 * appending it would interleave furniture into the content.
 */
function isContinuation(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length > 0 && !/\s{3,}/.test(trimmed);
}

/**
 * Walks each quiz body as a small state machine. Prompts, module tags and
 * options all wrap across lines in at least one pack, so a line is attached to
 * whatever is currently open and only a recognised heading closes it.
 *
 * A question number is only accepted when it is the next one expected for the
 * course, which is what keeps numbered module lists, cover rows and wrapped
 * option text from being mistaken for questions.
 */
export function parseQuestionBlocks(
  body: string[],
  moduleLists?: Map<number, string[]>,
): Map<number, RawQuestion[]> {
  const out = new Map<number, RawQuestion[]>();
  let course: number | null = null;
  let group = '';

  // Module titles per course, for recognising upper-case group headings and
  // resolving them back to the title as written in the module list.
  const titlesFor = (position: number | null): Map<string, string> =>
    new Map(
      (position === null ? [] : moduleLists?.get(position) ?? []).map((t) => [
        squash(t),
        t,
      ]),
    );

  let i = 0;
  while (i < body.length) {
    const line = body[i]!;

    const header = courseHeaderAt(line);
    if (header !== null) {
      if (header !== course) group = '';
      course = header;
      i++;
      continue;
    }

    if (course !== null) {
      const heading = GROUP_HEADING_RE.exec(line);
      if (heading && !isFurniture(line)) {
        const known = titlesFor(course);
        const matched = known.get(squash(heading[1]!));
        if (matched !== undefined || known.size === 0) {
          group = matched ?? heading[1]!.trim();
          i++;
          continue;
        }
      }
    }

    const qm = QUESTION_RE.exec(line);
    const expected = course === null ? 0 : (out.get(course)?.length ?? 0) + 1;
    if (!qm || course === null || isFurniture(line) || Number(qm[1]) !== expected) {
      i++;
      continue;
    }

    const parsed = readQuestion(body, i, qm, group);

    // Servicing numbers its modules ("1. High Voltage Awareness | 2. ...") on a
    // line that reads exactly like question 1. A question always has options,
    // so a candidate with none is a numbered list; the per-course count check
    // in parseQuizPack still catches a genuinely missing question.
    if (parsed.question.options.size === 0) {
      i++;
      continue;
    }

    const list = out.get(course) ?? [];
    list.push(parsed.question);
    out.set(course, list);
    i = parsed.next;
  }

  return out;
}

/** Reads one question, its module tag and its four options. */
function readQuestion(
  body: string[],
  start: number,
  qm: RegExpExecArray,
  group: string,
): { question: RawQuestion; next: number } {
  let prompt = qm[2]!;
  let tag = '';
  const options = new Map<string, string>();
  let openOption: string | null = null;
  let i = start + 1;

  for (; i < body.length; i++) {
    const line = body[i]!;

    if (!line.trim()) {
      // Prompts and option text only ever wrap onto the very next line, so a
      // blank gap after a complete question ends it. Without this the last
      // question of a section absorbs the prose that introduces the next one.
      // Below four options the gap is tolerated, since a quiz may be split
      // across a page break mid-question.
      if (options.size >= 4) break;
      continue;
    }

    const om = OPTION_RE.exec(line);
    if (om && !isFurniture(line)) {
      openOption = om[1]!;
      options.set(openOption, om[2]!.trim());
      continue;
    }

    // A numbered line is always the next question: prompts and option text wrap
    // onto unnumbered lines, so nothing inside a question looks like one.
    if (QUESTION_RE.test(line) || courseHeaderAt(line) !== null) break;
    // Only once the options are complete can an upper-case line be the next
    // module's group heading rather than wrapped option text.
    if (options.size >= 4 && GROUP_HEADING_RE.test(line) && !isFurniture(line)) break;

    const mod = MODULE_LINE_RE.exec(line);
    if (mod) {
      tag = mod[1]!;
      continue;
    }

    if (isFurniture(line) || !isContinuation(line)) continue;

    if (openOption) {
      // Continuation of the option text.
      options.set(openOption, `${options.get(openOption)} ${line.trim()}`.trim());
    } else {
      prompt = `${prompt} ${line.trim()}`.trim();
    }
  }

  const bracket = /\[([^\]]+)\]/.exec(prompt);
  if (bracket) tag = bracket[1]!;

  return {
    question: {
      position: Number(qm[1]),
      prompt: prompt
        .replace(/\s*\[[^\]]+\]\s*/, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
      moduleTag: (tag || group).replace(/\s+/g, ' ').trim(),
      options,
    },
    next: i,
  };
}

// ---------------------------------------------------------------------------
// Answer keys
// ---------------------------------------------------------------------------

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

const KEY_ENTRY_RE = new RegExp(`^\\s*(\\d{1,2})\\.\\s+([A-D])\\s+${DASH}\\s+(.+)$`);

/**
 * Answer-key explanations wrap constantly - 101 of 110 in the Chassis pack.
 *
 * `explanationOnNextLine` covers the packs whose entry line restates the
 * correct option and carry the explanation on the line below.
 */
export function parseKeyInline(
  key: string[],
  heading: RegExp,
  explanationOnNextLine: boolean,
): Map<number, Map<number, KeyEntry>> {
  const out = new Map<number, Map<number, KeyEntry>>();
  let quiz: number | null = null;
  let current: KeyEntry | null = null;
  let awaitingFirstLine = false;

  for (const line of key) {
    const header = heading.exec(line);
    if (header) {
      quiz = Number(header[1]);
      current = null;
      continue;
    }

    const entry = KEY_ENTRY_RE.exec(line);
    if (entry && quiz !== null) {
      current = {
        letter: entry[2] as OptionLabel,
        explanation: explanationOnNextLine ? '' : entry[3]!.trim(),
      };
      awaitingFirstLine = explanationOnNextLine;
      const perQuiz = out.get(quiz) ?? new Map<number, KeyEntry>();
      perQuiz.set(Number(entry[1]), current);
      out.set(quiz, perQuiz);
      continue;
    }

    // An explanation wraps onto the following line, so a blank gap closes it.
    // Otherwise the last entry of a section absorbs the printing notes and
    // headings that follow it, which also buries the trailing [MODULE TAG]
    // mid-string where it can no longer be stripped.
    if (!line.trim()) {
      current = null;
      continue;
    }

    if (!current || isFurniture(line) || heading.test(line)) continue;
    if (MODULE_LINE_RE.test(line)) continue;

    current.explanation = awaitingFirstLine
      ? line.trim()
      : `${current.explanation} ${line.trim()}`.trim();
    awaitingFirstLine = false;
  }

  return finishExplanations(out);
}

const KEY_TABLE_ROW_RE = /^\s*(\d{1,2})\s{2,}([A-D])\s{2,}(\S.*)$/;

/** A "Q | Answer | Why" table, with explanations wrapping in the third column. */
export function parseKeyTable(key: string[]): Map<number, Map<number, KeyEntry>> {
  const out = new Map<number, Map<number, KeyEntry>>();
  let quiz: number | null = null;
  let current: KeyEntry | null = null;

  for (const line of key) {
    const header = KEY_HEADING_NUMBERED.exec(line);
    if (header) {
      quiz = Number(header[1]);
      current = null;
      continue;
    }

    const row = KEY_TABLE_ROW_RE.exec(line);
    if (row && quiz !== null) {
      current = { letter: row[2] as OptionLabel, explanation: row[3]!.trim() };
      const perQuiz = out.get(quiz) ?? new Map<number, KeyEntry>();
      perQuiz.set(Number(row[1]), current);
      out.set(quiz, perQuiz);
      continue;
    }

    // As in parseKeyInline, a blank gap closes the entry's third column.
    if (!line.trim()) {
      current = null;
      continue;
    }

    if (!current || isFurniture(line)) continue;
    if (MODULE_LINE_RE.test(line) || courseHeaderAt(line) !== null) continue;

    current.explanation = `${current.explanation} ${line.trim()}`.trim();
  }

  return finishExplanations(out);
}

function finishExplanations(
  out: Map<number, Map<number, KeyEntry>>,
): Map<number, Map<number, KeyEntry>> {
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

/** Kept for the Chassis-era call sites and tests. */
export function parseAnswerKey(key: string[]): Map<number, Map<number, KeyEntry>> {
  return parseKeyInline(key, KEY_HEADING_CLASSIC, false);
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export function parseQuizPack(
  text: string,
  opts: { subjectSlug: string; subjectTitle: string; dialect?: Dialect },
): ParsedSubject {
  const dialect = opts.dialect ?? detectDialect(text);
  const { body, key } = splitSections(text, dialect);
  const cover = dialect.parseCover(body);
  const moduleLists = parseModuleLists(body, cover);
  const questionBlocks = parseQuestionBlocks(body, moduleLists);
  const answerKey = dialect.parseKey(key);

  const courses: ParsedCourse[] = cover.map((entry) => {
    const where = `Course ${entry.position} (${entry.title})`;
    const moduleTitles = moduleLists.get(entry.position);
    if (!moduleTitles) throw new QuizParseError(`${where}: no module list found.`);

    // Matched on letters and digits alone: tags differ from the module list in
    // case, letter-spacing, and stray punctuation ("Engine Oil Basis
    // Additives, and Compositions" is listed with a comma the tag omits).
    const byTitle = new Map(moduleTitles.map((t) => [squash(t), t]));
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

      const moduleTitle = byTitle.get(squash(raw.moduleTag));
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
