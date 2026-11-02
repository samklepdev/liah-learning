# Interactive Graded Quiz Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A logged-in user picks a course, answers its ten-question quiz, submits, and receives a server-computed grade with per-question explanations and a list of modules to review.

**Architecture:** A pure text-to-data parser converts `pdftotext` output into a committed JSON file, which an idempotent seed script loads into Postgres. An Express API serves questions without their answers, records each selection as it is made, and grades server-side on submit. A react-router frontend has three screens: course list, quiz, results.

**Tech Stack:** Node 26, Express 5, Drizzle ORM, Postgres 17, TypeScript 6.0.3 (ESM), React 19, Vite 8, react-router 8. Tests use the built-in `node:test` runner via `tsx` — no test framework dependency.

**Spec:** `docs/superpowers/specs/2026-11-02-interactive-quiz-design.md`

## Global Constraints

- Branch: `feat/interactive-quiz`. Do not commit to `main`.
- Backend is ESM with `rewriteRelativeImportExtensions`. **All relative imports use the `.ts` extension** (`import { db } from '../db/index.ts'`). Frontend imports are extensionless.
- Follow the established backend layering: `models/` own queries, `controllers/` own HTTP, `routes/` own paths, `lib/` owns pure helpers. Files are named `<thing>.model.ts`, `<thing>.controller.ts`, `<thing>.routes.ts`.
- Drizzle columns declare explicit snake_case names: `text('password_hash')`, not `text()`.
- `is_correct` and `explanation` must never appear in any payload for an unsubmitted attempt.
- Course slugs are globally unique, formed as `<subject>-<course-title>` kebab-cased.
- Module display titles come from the `MODULES COVERED` list (title case), matched to bracketed question tags case-insensitively with whitespace collapsed.
- `question_count` is read from the cover page, never hardcoded.
- Postgres runs in Docker on host port **54330**. Dev database `liah_learning`, test database `liah_learning_test`.
- The API runs on port **3000**. Port 5000 is unusable on macOS (AirPlay Receiver).
- Run `npm install` from the repo root only — this is an npm workspaces monorepo.

## Verified Facts

These were confirmed against the real PDF and toolchain before this plan was written. Trust them.

- `pdftotext -layout "Chassis Pop Quizzes.pdf"` yields 1531 lines containing 11 courses and 110 questions.
- **Options never wrap** across lines. Every continuation line is either a wrapped module tag or page furniture.
- Question prompts wrap in three patterns: tag entirely on the next line (6 occurrences), prompt and tag both continuing, and a tag split mid-name (`[TREAD AND RIM` / `TECHNOLOGY]`).
- **101 of 110 answer-key explanations wrap** across lines. Joining is required, not an edge case.
- The prototype of the algorithm in Task 3 and Task 4 parses all 110 questions with 0 malformed and 0 unresolved module tags.
- `node --import tsx --env-file=.env.test --test "src/**/*.test.ts"` works with zero new dependencies.
- `react-router@8.5.1` is the correct package. `react-router-dom@7` is a legacy wrapper. Peers (`react >=19.2.7`, `@types/react >=19.2.0`) are already satisfied.

---

### Task 1: Test harness and build split

Establishes the test runner, a test database, and a build config that excludes tests. Proven by one real test.

**Files:**
- Create: `backend/.env.test`
- Create: `backend/tsconfig.build.json`
- Create: `backend/src/test/helpers/db.ts`
- Create: `backend/src/lib/quiz-parser.ts`
- Create: `backend/src/lib/quiz-parser.test.ts`
- Modify: `backend/package.json` (scripts)

**Interfaces:**
- Consumes: nothing.
- Produces: `slugify(input: string): string` from `lib/quiz-parser.ts`. `resetDb(): Promise<void>` and `closeDb(): Promise<void>` from `test/helpers/db.ts`. Test command `npm test -w backend`.

- [ ] **Step 1: Create the test database (idempotent)**

`CREATE DATABASE` cannot run inside a transaction or an `IF NOT EXISTS`, and `\gexec` is a psql meta-command that does not work through `psql -c`. Test for the database first, then create it:

```bash
docker exec liah-postgres psql -U liah -d postgres -tAc \
  "select 1 from pg_database where datname='liah_learning_test'" | grep -q 1 \
  && echo "liah_learning_test already exists" \
  || docker exec liah-postgres createdb -U liah -O liah liah_learning_test
```

Expected: either `liah_learning_test already exists` or no output (created).

- [ ] **Step 2: Create `backend/.env.test`**

`PORT` must be a positive integer — `env.ts` rejects `0` via `.positive()`. Tests bind an ephemeral port with `listen(0)` directly and never read `env.PORT`.

```
NODE_ENV=test
PORT=3001
DATABASE_URL=postgresql://liah:liah_dev_password@127.0.0.1:54330/liah_learning_test
SESSION_TTL_DAYS=7
```

- [ ] **Step 3: Create `backend/tsconfig.build.json`**

Tests live beside source so `typecheck` covers them, but they must not reach `dist/`.

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["src/**/*.test.ts", "src/test/**"]
}
```

- [ ] **Step 4: Point the build at it and add the test script**

```bash
cd /Users/sam/Projects/liah-wellness/liah-learning
npm pkg set scripts.build="tsc -p tsconfig.build.json" -w backend
npm pkg set scripts.test="node --import tsx --env-file=.env.test --test --test-concurrency=1 \"src/**/*.test.ts\"" -w backend
npm pkg set scripts.db:push:test="node --env-file=.env.test ../node_modules/drizzle-kit/bin.cjs push" -w backend
```

**`--test-concurrency=1` is required, not a preference.** `node:test` runs test *files* in parallel by default. Every database-backed test file here truncates shared tables in its `before`/`beforeEach`, so running two in parallel makes them delete each other's fixtures — producing failures in a file you did not touch. Serial execution is the price of one shared test database.

`drizzle-kit` is hoisted to the repo-root `node_modules`, hence the `../` path. Invoking its binary directly (rather than `npx drizzle-kit`) is what lets `--env-file` apply.

This works because `--env-file` populates `process.env` *before* `drizzle.config.ts` runs, and the `process.loadEnvFile('.env')` inside that config **does not overwrite variables that are already set**. So `.env.test`'s `DATABASE_URL` wins and the push targets `liah_learning_test`. This was verified, not assumed — but if a future Node release changes that precedence, this script would silently push to the dev database, so re-check the target database if `db:push:test` ever behaves oddly.

Verify the scripts landed:

```bash
npm pkg get scripts -w backend
```

Expected: `build`, `test` and `db:push:test` present with the values above.

- [ ] **Step 5: Create `backend/src/test/helpers/db.ts`**

The guard is the important part: truncating the dev database by accident would destroy seeded content.

```ts
import { sql } from 'drizzle-orm';
import { db, pool } from '../../db/index.ts';
import { env } from '../../config/env.ts';

if (!env.DATABASE_URL.endsWith('_test')) {
  throw new Error(
    `Refusing to run tests against ${env.DATABASE_URL} — the database name must end in _test.`,
  );
}

/** Empties every table. Safe only against the _test database. */
export async function resetDb(): Promise<void> {
  await db.execute(sql`
    truncate table attempt_answers, attempts, question_options, questions,
                   modules, courses, subjects, sessions, users
    restart identity cascade
  `);
}

export async function closeDb(): Promise<void> {
  await pool.end();
}
```

Note: `resetDb` references tables created in Task 5. It will not be called until Task 7.

- [ ] **Step 6: Write the failing test**

Create `backend/src/lib/quiz-parser.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from './quiz-parser.ts';

test('slugify lowercases and hyphenates', () => {
  assert.equal(slugify('Tire and Rim Essentials'), 'tire-and-rim-essentials');
});

test('slugify strips punctuation and collapses separators', () => {
  assert.equal(
    slugify('Best Practice Low Profile / Run Flat Tire Strip and Fit'),
    'best-practice-low-profile-run-flat-tire-strip-and-fit',
  );
});

test('slugify trims leading and trailing hyphens', () => {
  assert.equal(slugify('  ABS Operations & Testing  '), 'abs-operations-testing');
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `npm test -w backend`
Expected: FAIL — `Cannot find module '.../src/lib/quiz-parser.ts'`

- [ ] **Step 8: Write the minimal implementation**

Create `backend/src/lib/quiz-parser.ts`:

```ts
/** Lowercase kebab-case slug. Strips punctuation, collapses separators. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `npm test -w backend`
Expected: `pass 3`, `fail 0`

- [ ] **Step 10: Verify the build still excludes tests**

```bash
cd /Users/sam/Projects/liah-wellness/liah-learning
rm -rf backend/dist && npm run build -w backend
find backend/dist -name '*.test.js' -o -path '*/test/*' | head
```

Expected: build succeeds, the `find` prints nothing.

- [ ] **Step 11: Commit**

```bash
git add backend/.env.test backend/tsconfig.build.json backend/package.json \
        backend/src/test/helpers/db.ts backend/src/lib/quiz-parser.ts \
        backend/src/lib/quiz-parser.test.ts package-lock.json
git commit -m "test: add node:test harness, test database, and build/test config split"
```

---

### Task 2: Parser — fixture and cover page

**Files:**
- Create: `backend/src/test/fixtures/chassis.txt` (generated, committed — ~58KB)
- Modify: `backend/src/lib/quiz-parser.ts`
- Modify: `backend/src/lib/quiz-parser.test.ts`

**Interfaces:**
- Consumes: `slugify` from Task 1.
- Produces:
  ```ts
  export class QuizParseError extends Error {}
  export type CoverEntry = { position: number; title: string; moduleCount: number; questionCount: number };
  export function splitSections(text: string): { body: string[]; key: string[] };
  export function parseCoverList(body: string[]): CoverEntry[];
  ```

- [ ] **Step 1: Generate the fixture from the real PDF**

```bash
cd /Users/sam/Projects/liah-wellness/liah-learning
mkdir -p backend/src/test/fixtures
pdftotext -layout "$HOME/Documents/LIAH-classes/quizzes/Chassis Pop Quizzes.pdf" \
          backend/src/test/fixtures/chassis.txt
wc -l backend/src/test/fixtures/chassis.txt
```

Expected: `1531 backend/src/test/fixtures/chassis.txt`

If `pdftotext` is missing: `brew install poppler`.

- [ ] **Step 2: Write the failing tests**

Append to `backend/src/lib/quiz-parser.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { splitSections, parseCoverList } from './quiz-parser.ts';

const fixture = readFileSync(
  new URL('../test/fixtures/chassis.txt', import.meta.url),
  'utf8',
);

test('splitSections divides quiz bodies from the answer key', () => {
  const { body, key } = splitSections(fixture);
  assert.ok(body.length > 900, `body had ${body.length} lines`);
  assert.ok(key.length > 300, `key had ${key.length} lines`);
  assert.ok(!body.some((l) => /- Answer Key\s*$/.test(l)));
});

test('parseCoverList finds all 11 courses with their declared counts', () => {
  const { body } = splitSections(fixture);
  const cover = parseCoverList(body);

  assert.equal(cover.length, 11);
  assert.deepEqual(cover[0], {
    position: 1,
    title: 'Tire and Rim Essentials',
    moduleCount: 4,
    questionCount: 10,
  });
  assert.equal(cover[10]?.title, 'Park Brake Technology');
  assert.ok(cover.every((c) => c.questionCount === 10));
});

test('parseCoverList throws when no courses are present', () => {
  assert.throws(() => parseCoverList(['nothing here']), { name: 'QuizParseError' });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm test -w backend`
Expected: FAIL — `splitSections is not a function`

- [ ] **Step 4: Implement**

Append to `backend/src/lib/quiz-parser.ts`:

```ts
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
    throw new QuizParseError('No answer key section found (expected "Quiz N: ... - Answer Key").');
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
```

- [ ] **Step 5: Run to verify pass**

Run: `npm test -w backend`
Expected: `pass 6`, `fail 0`

- [ ] **Step 6: Commit**

```bash
git add backend/src/test/fixtures/chassis.txt backend/src/lib/quiz-parser.ts \
        backend/src/lib/quiz-parser.test.ts
git commit -m "feat(parser): split sections and parse the cover course list"
```

---

### Task 3: Parser — module lists and question blocks

The line-joining algorithm here is the core of the parser. It was prototyped against all 110 questions.

**Files:**
- Modify: `backend/src/lib/quiz-parser.ts`
- Modify: `backend/src/lib/quiz-parser.test.ts`

**Interfaces:**
- Consumes: `splitSections`, `parseCoverList`, `isFurniture`, `QuizParseError` from Task 2.
- Produces:
  ```ts
  export function parseModuleLists(body: string[], cover: CoverEntry[]): Map<number, string[]>;
  export type RawQuestion = { position: number; prompt: string; moduleTag: string; options: Map<string, string> };
  export function parseQuestionBlocks(body: string[]): Map<number, RawQuestion[]>;
  ```

- [ ] **Step 1: Write the failing tests**

Append to `backend/src/lib/quiz-parser.test.ts`:

```ts
import { parseModuleLists, parseQuestionBlocks } from './quiz-parser.ts';

test('parseModuleLists reads each course list at its declared length', () => {
  const { body } = splitSections(fixture);
  const cover = parseCoverList(body);
  const mods = parseModuleLists(body, cover);

  assert.equal(mods.size, 11);
  assert.deepEqual(mods.get(1), [
    'Tire Technology',
    'Tread and Rim Technology',
    'Run Flat Tires',
    'Tire Pressure Monitoring',
  ]);
  for (const c of cover) {
    assert.equal(mods.get(c.position)?.length, c.moduleCount, `course ${c.position}`);
  }
});

test('parseQuestionBlocks finds 110 questions, each with four options', () => {
  const { body } = splitSections(fixture);
  const byCourse = parseQuestionBlocks(body);

  const total = [...byCourse.values()].reduce((n, qs) => n + qs.length, 0);
  assert.equal(total, 110);
  for (const [course, qs] of byCourse) {
    assert.equal(qs.length, 10, `course ${course}`);
    for (const q of qs) {
      assert.equal(q.options.size, 4, `course ${course} q${q.position}`);
      assert.deepEqual([...q.options.keys()].sort(), ['A', 'B', 'C', 'D']);
      assert.ok(q.moduleTag.length > 0, `course ${course} q${q.position} has no tag`);
    }
  }
});

test('parseQuestionBlocks reads a question whose tag is entirely on the next line', () => {
  const { body } = splitSections(fixture);
  const q = parseQuestionBlocks(body).get(4)?.find((x) => x.position === 7);
  assert.equal(q?.moduleTag, 'TORSION BAR INSPECTION PROCEDURES');
  assert.match(q?.prompt ?? '', /^During torsion bar inspection/);
  assert.ok(!q?.prompt.includes('['), 'prompt must not retain the tag');
});

test('parseQuestionBlocks rejoins a tag split across lines', () => {
  const { body } = splitSections(fixture);
  const q = parseQuestionBlocks(body).get(1)?.find((x) => x.position === 4);
  assert.equal(q?.moduleTag, 'TREAD AND RIM TECHNOLOGY');
});

test('parseQuestionBlocks rejoins a prompt that wraps before its tag', () => {
  const { body } = splitSections(fixture);
  // Course 4 "Understanding Suspension Systems" — Electronic Kinetic Dynamic
  // Suspension is its 7th module, per the PDF's own MODULES COVERED list.
  const q = parseQuestionBlocks(body).get(4)?.find((x) => x.position === 10);
  assert.equal(q?.moduleTag, 'ELECTRONIC KINETIC DYNAMIC SUSPENSION');
  assert.match(q?.prompt ?? '', /roll control and off-road articulation by:/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w backend`
Expected: FAIL — `parseModuleLists is not a function`

- [ ] **Step 3: Implement**

Append to `backend/src/lib/quiz-parser.ts`:

```ts
const COURSE_HEADER_RE = /^\s*Course (\d+):\s+(.+?)\s*$/;
const QUESTION_RE = /^\s*(\d{1,2})\.\s+(.+)$/;
const OPTION_RE = /^\s{2,}([A-D])\.\s+(.+)$/;
const MODULE_LIST_ITEM_RE = /^\s{3,}\S/;

/** The course header that opens a quiz, ignoring the "- Questions 6-10" continuation banner. */
function courseHeaderAt(line: string): number | null {
  const m = COURSE_HEADER_RE.exec(line);
  if (!m || line.includes('- Questions')) return null;
  return Number(m[1]);
}

/**
 * Each course declares its module count on the cover page, so we take exactly
 * that many indented lines after its "MODULES COVERED" banner.
 */
export function parseModuleLists(body: string[], cover: CoverEntry[]): Map<number, string[]> {
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
      throw new QuizParseError(`Course ${current} has a module list but is not on the cover page.`);
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
    const prompt = accumulated.replace(/\s*\[[^\]]+\]\s*/, ' ').replace(/\s+/g, ' ').trim();

    const options = new Map<string, string>();
    let k = j;
    while (k < body.length && options.size < 4) {
      const candidate = body[k]!;
      const om = OPTION_RE.exec(candidate);
      if (om) {
        options.set(om[1]!, om[2]!.trim());
      } else if (candidate.trim() && !isFurniture(candidate) && QUESTION_RE.test(candidate)) {
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
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -w backend`
Expected: `pass 11`, `fail 0`

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/quiz-parser.ts backend/src/lib/quiz-parser.test.ts
git commit -m "feat(parser): parse module lists and question blocks with line rejoining"
```

---

### Task 4: Parser — answer key, assembly, and fail-loud validation

**Files:**
- Modify: `backend/src/lib/quiz-parser.ts`
- Modify: `backend/src/lib/quiz-parser.test.ts`
- Create: `backend/src/test/fixtures/malformed.txt`

**Interfaces:**
- Consumes: everything from Tasks 2 and 3.
- Produces:
  ```ts
  export type ParsedOption = { label: 'A'|'B'|'C'|'D'; body: string; isCorrect: boolean };
  export type ParsedQuestion = { position: number; prompt: string; moduleTitle: string; explanation: string; options: ParsedOption[] };
  export type ParsedCourse = { position: number; slug: string; title: string; moduleTitles: string[]; questionCount: number; questions: ParsedQuestion[] };
  export type ParsedSubject = { slug: string; title: string; courses: ParsedCourse[] };
  export function parseQuizPack(text: string, opts: { subjectSlug: string; subjectTitle: string }): ParsedSubject;
  ```

- [ ] **Step 1: Create the malformed fixture**

Create `backend/src/test/fixtures/malformed.txt` — a cover page promising 10 questions with only one present:

```
1. Course 1 - Broken Course (1 modules, 10 questions)

Course 1: Broken Course
  MODULES COVERED (1)
     Only Module

1. The only question here? [ONLY MODULE]
   A. One
   B. Two
   C. Three
   D. Four

Quiz 1: Broken Course - Answer Key
1. A - Because one. [ONLY MODULE]
```

- [ ] **Step 2: Write the failing tests**

Append to `backend/src/lib/quiz-parser.test.ts`:

```ts
import { parseQuizPack } from './quiz-parser.ts';

const malformed = readFileSync(
  new URL('../test/fixtures/malformed.txt', import.meta.url),
  'utf8',
);

test('parseQuizPack assembles the whole Chassis pack', () => {
  const subject = parseQuizPack(fixture, { subjectSlug: 'chassis', subjectTitle: 'Chassis' });

  assert.equal(subject.slug, 'chassis');
  assert.equal(subject.courses.length, 11);

  const total = subject.courses.reduce((n, c) => n + c.questions.length, 0);
  assert.equal(total, 110);

  for (const course of subject.courses) {
    assert.equal(course.questions.length, course.questionCount);
    for (const q of course.questions) {
      assert.equal(q.options.filter((o) => o.isCorrect).length, 1, `${course.slug} q${q.position}`);
      assert.ok(q.explanation.length > 0);
      assert.ok(!q.explanation.includes('['), 'explanation must not retain the tag');
      assert.ok(course.moduleTitles.includes(q.moduleTitle));
    }
  }
});

test('parseQuizPack slugs courses with the subject prefix', () => {
  const subject = parseQuizPack(fixture, { subjectSlug: 'chassis', subjectTitle: 'Chassis' });
  assert.equal(subject.courses[0]?.slug, 'chassis-tire-and-rim-essentials');
});

test('parseQuizPack resolves tags to title-case module names', () => {
  const subject = parseQuizPack(fixture, { subjectSlug: 'chassis', subjectTitle: 'Chassis' });
  const q = subject.courses[0]?.questions.find((x) => x.position === 4);
  assert.equal(q?.moduleTitle, 'Tread and Rim Technology');
});

test('parseQuizPack marks the answer-key letter as the correct option', () => {
  const subject = parseQuizPack(fixture, { subjectSlug: 'chassis', subjectTitle: 'Chassis' });
  const q = subject.courses[0]?.questions.find((x) => x.position === 1);
  assert.equal(q?.options.find((o) => o.isCorrect)?.label, 'A');
  assert.match(q?.explanation ?? '', /radial construction/i);
});

test('parseQuizPack joins an explanation that wraps across lines', () => {
  const subject = parseQuizPack(fixture, { subjectSlug: 'chassis', subjectTitle: 'Chassis' });
  const q = subject.courses[0]?.questions.find((x) => x.position === 7);
  assert.match(q?.explanation ?? '', /reduced speed with zero pressure\.?$/);
});

test('parseQuizPack rejects a pack with a missing question', () => {
  assert.throws(
    () => parseQuizPack(malformed, { subjectSlug: 'broken', subjectTitle: 'Broken' }),
    (err: Error) => err.name === 'QuizParseError' && /declared 10 questions, found 1/.test(err.message),
  );
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm test -w backend`
Expected: FAIL — `parseQuizPack is not a function`

- [ ] **Step 4: Implement**

Append to `backend/src/lib/quiz-parser.ts`:

```ts
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

/** Answer-key explanations wrap constantly — 101 of 110 in the Chassis pack. */
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
      e.explanation = e.explanation.replace(/\s*\[[^\]]*\]?\s*$/, '').replace(/\s+/g, ' ').trim();
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
        throw new QuizParseError(`${at}: expected 4 options, found ${raw.options.size}.`);
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
```

- [ ] **Step 5: Run to verify pass**

Run: `npm test -w backend`
Expected: `pass 17`, `fail 0`

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck -w backend`
Expected: no output

- [ ] **Step 7: Commit**

```bash
git add backend/src/lib/quiz-parser.ts backend/src/lib/quiz-parser.test.ts \
        backend/src/test/fixtures/malformed.txt
git commit -m "feat(parser): parse answer key and assemble validated quiz packs"
```

---

### Task 5: Database schema

**Files:**
- Modify: `backend/src/models/schema.ts`

**Interfaces:**
- Consumes: existing `users` table.
- Produces: Drizzle tables `subjects`, `courses`, `modules`, `questions`, `questionOptions`, `attempts`, `attemptAnswers`, plus inferred types `Course`, `Question`, `QuestionOption`, `Attempt`.

- [ ] **Step 1: Extend the schema**

Append to `backend/src/models/schema.ts`, and extend the import on line 1 to include `boolean`, `integer`, `unique` and `uniqueIndex`; add `import { sql } from 'drizzle-orm';` at the top:

```ts
export const subjects = pgTable('subjects', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
});

export const courses = pgTable(
  'courses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    /** Globally unique: "<subject>-<course-title>". */
    slug: text('slug').notNull().unique(),
    title: text('title').notNull(),
    passScore: integer('pass_score').notNull().default(9),
    questionCount: integer('question_count').notNull().default(10),
  },
  (t) => [unique('courses_subject_position_unique').on(t.subjectId, t.position)],
);

export const modules = pgTable(
  'modules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
  },
  (t) => [unique('modules_course_title_unique').on(t.courseId, t.title)],
);

export const questions = pgTable(
  'questions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    moduleId: uuid('module_id')
      .notNull()
      .references(() => modules.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    prompt: text('prompt').notNull(),
    explanation: text('explanation').notNull(),
  },
  (t) => [unique('questions_course_position_unique').on(t.courseId, t.position)],
);

export const questionOptions = pgTable(
  'question_options',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    body: text('body').notNull(),
    isCorrect: boolean('is_correct').notNull(),
  },
  (t) => [unique('question_options_question_label_unique').on(t.questionId, t.label)],
);

export const attempts = pgTable(
  'attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    /** Written once at submission; never recomputed on read. */
    score: integer('score'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
  },
  (t) => [
    index('attempts_user_course_idx').on(t.userId, t.courseId),
    // At most one unfinished attempt per user per course, so "start" and
    // "resume" can be the same call.
    uniqueIndex('attempts_one_open_per_user_course')
      .on(t.userId, t.courseId)
      .where(sql`${t.submittedAt} is null`),
  ],
);

export const attemptAnswers = pgTable(
  'attempt_answers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    attemptId: uuid('attempt_id')
      .notNull()
      .references(() => attempts.id, { onDelete: 'cascade' }),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    optionId: uuid('option_id')
      .notNull()
      .references(() => questionOptions.id, { onDelete: 'cascade' }),
    /** Denormalised at save time so later content edits cannot rewrite history. */
    isCorrect: boolean('is_correct').notNull(),
  },
  (t) => [unique('attempt_answers_attempt_question_unique').on(t.attemptId, t.questionId)],
);

export type Subject = typeof subjects.$inferSelect;
export type Course = typeof courses.$inferSelect;
export type Module = typeof modules.$inferSelect;
export type Question = typeof questions.$inferSelect;
export type QuestionOption = typeof questionOptions.$inferSelect;
export type Attempt = typeof attempts.$inferSelect;
export type AttemptAnswer = typeof attemptAnswers.$inferSelect;
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck -w backend`
Expected: no output

- [ ] **Step 3: Push to both databases**

```bash
cd /Users/sam/Projects/liah-wellness/liah-learning
npm run db:push -w backend
npm run db:push:test -w backend
```

Expected: `[✓] Changes applied` for each.

- [ ] **Step 4: Verify the tables and the partial index**

```bash
docker exec liah-postgres psql -U liah -d liah_learning -c '\dt' \
  -c "select indexdef from pg_indexes where indexname='attempts_one_open_per_user_course';"
```

Expected: nine tables listed; the index definition ends with `WHERE (submitted_at IS NULL)`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/models/schema.ts
git commit -m "feat(db): add subject, course, module, question and attempt tables"
```

---

### Task 6: Parse script producing committed JSON

**Files:**
- Create: `backend/src/scripts/parse-quiz-pdf.ts`
- Create: `backend/src/data/chassis.quiz.json` (generated, committed)
- Modify: `backend/package.json`, root `package.json`

**Interfaces:**
- Consumes: `parseQuizPack`, `ParsedSubject` from Task 4.
- Produces: `backend/src/data/<subject>.quiz.json` conforming to `ParsedSubject`.

- [ ] **Step 1: Write the script**

Create `backend/src/scripts/parse-quiz-pdf.ts`:

```ts
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { parseQuizPack, slugify, QuizParseError } from '../lib/quiz-parser.ts';

function usage(): never {
  console.error(
    'Usage: npm run quiz:parse -w backend -- <path-to-pdf> [subject-title]\n' +
      'Example: npm run quiz:parse -w backend -- "$HOME/Documents/LIAH-classes/quizzes/Chassis Pop Quizzes.pdf"',
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
```

- [ ] **Step 2: Add the scripts**

```bash
cd /Users/sam/Projects/liah-wellness/liah-learning
npm pkg set scripts.quiz:parse="tsx src/scripts/parse-quiz-pdf.ts" -w backend
npm pkg set scripts.quiz:parse="npm run quiz:parse -w backend --"
```

- [ ] **Step 3: Run it against the real PDF**

```bash
npm run quiz:parse -w backend -- "$HOME/Documents/LIAH-classes/quizzes/Chassis Pop Quizzes.pdf"
```

Expected: `Parsed 11 courses, 110 questions -> src/data/chassis.quiz.json`

- [ ] **Step 4: Spot-check the output before trusting it**

```bash
cd /Users/sam/Projects/liah-wellness/liah-learning/backend
node -e "
const s=require('./src/data/chassis.quiz.json');
console.log('subject:', s.slug, '| courses:', s.courses.length);
const c=s.courses[0];
console.log('course slug:', c.slug);
const q=c.questions[0];
console.log('q1 prompt:', q.prompt);
console.log('q1 module:', q.moduleTitle);
console.log('q1 correct:', q.options.find(o=>o.isCorrect).label, '-', q.options.find(o=>o.isCorrect).body);
console.log('q1 explanation:', q.explanation);
console.log('every q has 1 correct:', s.courses.every(c=>c.questions.every(q=>q.options.filter(o=>o.isCorrect).length===1)));
"
```

Expected: subject `chassis`, 11 courses, course slug `chassis-tire-and-rim-essentials`, q1 correct `A - Radial construction`, and `every q has 1 correct: true`.

**This is the review gate the JSON step exists for.** Read the printed values; if a prompt is truncated or an explanation carries a stray `[`, fix the parser before continuing.

- [ ] **Step 5: Commit**

```bash
git add backend/src/scripts/parse-quiz-pdf.ts backend/src/data/chassis.quiz.json \
        backend/package.json package.json
git commit -m "feat(quiz): add PDF parse script and committed Chassis quiz data"
```

---

### Task 7: Idempotent seed script

**Files:**
- Create: `backend/src/scripts/seed-quizzes.ts`
- Create: `backend/src/scripts/seed-quizzes.test.ts`
- Modify: `backend/package.json`, root `package.json`

**Interfaces:**
- Consumes: schema from Task 5, `ParsedSubject` from Task 4, `resetDb`/`closeDb` from Task 1.
- Produces: `seedSubject(subject: ParsedSubject): Promise<{ courses: number; questions: number }>` from `scripts/seed-quizzes.ts`.

- [ ] **Step 1: Write the failing test**

Create `backend/src/scripts/seed-quizzes.test.ts`:

```ts
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { resetDb, closeDb } from '../test/helpers/db.ts';
import { seedSubject } from './seed-quizzes.ts';
import type { ParsedSubject } from '../lib/quiz-parser.ts';

const subject: ParsedSubject = JSON.parse(
  readFileSync(new URL('../data/chassis.quiz.json', import.meta.url), 'utf8'),
);

async function counts() {
  const r = await db.execute(sql`
    select
      (select count(*) from subjects)         as subjects,
      (select count(*) from courses)          as courses,
      (select count(*) from modules)          as modules,
      (select count(*) from questions)        as questions,
      (select count(*) from question_options) as options
  `);
  return r.rows[0] as Record<string, string>;
}

before(async () => { await resetDb(); });
beforeEach(async () => { await resetDb(); });
after(async () => { await closeDb(); });

test('seedSubject loads the whole pack', async () => {
  const result = await seedSubject(subject);
  assert.equal(result.courses, 11);
  assert.equal(result.questions, 110);

  const c = await counts();
  assert.equal(Number(c.subjects), 1);
  assert.equal(Number(c.courses), 11);
  assert.equal(Number(c.questions), 110);
  assert.equal(Number(c.options), 440);
});

test('seedSubject is idempotent', async () => {
  await seedSubject(subject);
  const first = await counts();
  await seedSubject(subject);
  const second = await counts();
  assert.deepEqual(second, first);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w backend`
Expected: FAIL — `Cannot find module '.../scripts/seed-quizzes.ts'`

- [ ] **Step 3: Implement the seed**

Create `backend/src/scripts/seed-quizzes.ts`:

```ts
import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { db, pool } from '../db/index.ts';
import {
  courses,
  modules,
  questionOptions,
  questions,
  subjects,
} from '../models/schema.ts';
import type { ParsedSubject } from '../lib/quiz-parser.ts';

/**
 * Upserts a parsed subject. Content is replaced per course rather than merged —
 * questions cascade-delete, so re-seeding after a parser fix yields exactly the
 * JSON's contents. Attempts reference courses, which are preserved by slug.
 */
export async function seedSubject(
  subject: ParsedSubject,
): Promise<{ courses: number; questions: number }> {
  return db.transaction(async (tx) => {
    const [subjectRow] = await tx
      .insert(subjects)
      .values({ slug: subject.slug, title: subject.title })
      .onConflictDoUpdate({ target: subjects.slug, set: { title: subject.title } })
      .returning({ id: subjects.id });

    let questionTotal = 0;

    for (const course of subject.courses) {
      const [courseRow] = await tx
        .insert(courses)
        .values({
          subjectId: subjectRow!.id,
          position: course.position,
          slug: course.slug,
          title: course.title,
          questionCount: course.questionCount,
        })
        .onConflictDoUpdate({
          target: courses.slug,
          set: {
            subjectId: subjectRow!.id,
            position: course.position,
            title: course.title,
            questionCount: course.questionCount,
          },
        })
        .returning({ id: courses.id });

      const courseId = courseRow!.id;

      // Replace content wholesale; questions and options cascade from modules.
      await tx.delete(modules).where(eq(modules.courseId, courseId));

      const moduleRows = await tx
        .insert(modules)
        .values(course.moduleTitles.map((title) => ({ courseId, title })))
        .returning({ id: modules.id, title: modules.title });

      const moduleIdByTitle = new Map(moduleRows.map((m) => [m.title, m.id]));

      for (const q of course.questions) {
        const moduleId = moduleIdByTitle.get(q.moduleTitle);
        if (!moduleId) {
          throw new Error(`${course.slug} q${q.position}: unknown module "${q.moduleTitle}"`);
        }

        const [questionRow] = await tx
          .insert(questions)
          .values({
            courseId,
            moduleId,
            position: q.position,
            prompt: q.prompt,
            explanation: q.explanation,
          })
          .returning({ id: questions.id });

        await tx.insert(questionOptions).values(
          q.options.map((o) => ({
            questionId: questionRow!.id,
            label: o.label,
            body: o.body,
            isCorrect: o.isCorrect,
          })),
        );

        questionTotal += 1;
      }
    }

    return { courses: subject.courses.length, questions: questionTotal };
  });
}

/** CLI entry: seeds every *.quiz.json passed, defaulting to Chassis. */
async function main(): Promise<void> {
  const files = process.argv.slice(2);
  const paths = files.length > 0 ? files : [new URL('../data/chassis.quiz.json', import.meta.url)];

  for (const path of paths) {
    const parsed: ParsedSubject = JSON.parse(readFileSync(path as string | URL, 'utf8'));
    const result = await seedSubject(parsed);
    console.log(`Seeded ${parsed.slug}: ${result.courses} courses, ${result.questions} questions`);
  }
  await pool.end();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w backend`
Expected: `pass 19`, `fail 0`

- [ ] **Step 5: Add the seed scripts and seed the dev database**

```bash
cd /Users/sam/Projects/liah-wellness/liah-learning
npm pkg set scripts.quiz:seed="node --import tsx --env-file-if-exists=.env src/scripts/seed-quizzes.ts" -w backend
npm pkg set scripts.quiz:seed="npm run quiz:seed -w backend"
npm run quiz:seed
```

Expected: `Seeded chassis: 11 courses, 110 questions`

- [ ] **Step 6: Commit**

```bash
git add backend/src/scripts/seed-quizzes.ts backend/src/scripts/seed-quizzes.test.ts \
        backend/package.json package.json
git commit -m "feat(quiz): add idempotent seed script with coverage"
```

---

### Task 8: Catalog model and API

**Files:**
- Create: `backend/src/models/catalog.model.ts`
- Create: `backend/src/controllers/catalog.controller.ts`
- Create: `backend/src/routes/catalog.routes.ts`
- Create: `backend/src/test/helpers/server.ts`
- Create: `backend/src/controllers/catalog.controller.test.ts`
- Modify: `backend/src/routes/index.ts`

**Interfaces:**
- Consumes: schema from Task 5, seeded data from Task 7.
- Produces:
  ```ts
  // models/catalog.model.ts
  export type SubjectSummary = { id: string; slug: string; title: string; courseCount: number };
  export type CourseSummary = { id: string; slug: string; title: string; position: number;
                                passScore: number; questionCount: number;
                                bestScore: number | null; attemptCount: number };
  export function listSubjects(): Promise<SubjectSummary[]>;
  export function listCoursesBySubject(subjectSlug: string, userId: string | null): Promise<CourseSummary[]>;

  // test/helpers/server.ts
  export function startTestServer(): Promise<{ baseUrl: string; close: () => Promise<void> }>;
  export function registerTestUser(baseUrl: string, email: string): Promise<{ cookie: string; userId: string }>;
  ```

- [ ] **Step 1: Create the server test helper**

Create `backend/src/test/helpers/server.ts`:

```ts
import type { AddressInfo } from 'node:net';
import { app } from '../../app.ts';

export async function startTestServer(): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Registers a user and returns the session cookie to send on later requests. */
export async function registerTestUser(
  baseUrl: string,
  email: string,
): Promise<{ cookie: string; userId: string }> {
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'test-password-123' }),
  });
  if (res.status !== 201) {
    throw new Error(`register failed: ${res.status} ${await res.text()}`);
  }
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) throw new Error('register returned no cookie');
  const body = (await res.json()) as { user: { id: string } };
  return { cookie: setCookie.split(';')[0]!, userId: body.user.id };
}
```

- [ ] **Step 2: Write the failing test**

Create `backend/src/controllers/catalog.controller.test.ts`:

```ts
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resetDb, closeDb } from '../test/helpers/db.ts';
import { startTestServer, registerTestUser } from '../test/helpers/server.ts';
import { seedSubject } from '../scripts/seed-quizzes.ts';
import type { ParsedSubject } from '../lib/quiz-parser.ts';

const subject: ParsedSubject = JSON.parse(
  readFileSync(new URL('../data/chassis.quiz.json', import.meta.url), 'utf8'),
);

let baseUrl: string;
let close: () => Promise<void>;

before(async () => {
  await resetDb();
  await seedSubject(subject);
  ({ baseUrl, close } = await startTestServer());
});

after(async () => {
  await close();
  await closeDb();
});

test('GET /api/subjects lists subjects with course counts', async () => {
  const res = await fetch(`${baseUrl}/api/subjects`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { subjects: Array<Record<string, unknown>> };
  assert.equal(body.subjects.length, 1);
  assert.equal(body.subjects[0]?.slug, 'chassis');
  assert.equal(body.subjects[0]?.courseCount, 11);
});

test('GET /api/courses returns courses in order, no best score when anonymous', async () => {
  const res = await fetch(`${baseUrl}/api/courses?subject=chassis`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { courses: Array<Record<string, unknown>> };
  assert.equal(body.courses.length, 11);
  assert.equal(body.courses[0]?.position, 1);
  assert.equal(body.courses[0]?.slug, 'chassis-tire-and-rim-essentials');
  assert.equal(body.courses[0]?.questionCount, 10);
  assert.equal(body.courses[0]?.passScore, 9);
  assert.equal(body.courses[0]?.bestScore, null);
});

test('GET /api/courses includes bestScore for a signed-in user', async () => {
  const { cookie } = await registerTestUser(baseUrl, 'catalog@example.com');
  const res = await fetch(`${baseUrl}/api/courses?subject=chassis`, {
    headers: { cookie },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { courses: Array<Record<string, unknown>> };
  assert.equal(body.courses[0]?.bestScore, null);
  assert.equal(body.courses[0]?.attemptCount, 0);
});

test('GET /api/courses 404s for an unknown subject', async () => {
  const res = await fetch(`${baseUrl}/api/courses?subject=nope`);
  assert.equal(res.status, 404);
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm test -w backend`
Expected: FAIL — 404 on `/api/subjects`

- [ ] **Step 4: Implement the model**

Create `backend/src/models/catalog.model.ts`:

```ts
import { and, asc, count, eq, isNotNull, max, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { attempts, courses, subjects } from './schema.ts';

export type SubjectSummary = {
  id: string;
  slug: string;
  title: string;
  courseCount: number;
};

export async function listSubjects(): Promise<SubjectSummary[]> {
  const rows = await db
    .select({
      id: subjects.id,
      slug: subjects.slug,
      title: subjects.title,
      courseCount: count(courses.id),
    })
    .from(subjects)
    .leftJoin(courses, eq(courses.subjectId, subjects.id))
    .groupBy(subjects.id, subjects.slug, subjects.title)
    .orderBy(asc(subjects.title));

  return rows.map((r) => ({ ...r, courseCount: Number(r.courseCount) }));
}

export type CourseSummary = {
  id: string;
  slug: string;
  title: string;
  position: number;
  passScore: number;
  questionCount: number;
  bestScore: number | null;
  attemptCount: number;
};

export async function findSubjectBySlug(slug: string) {
  const [row] = await db.select().from(subjects).where(eq(subjects.slug, slug)).limit(1);
  return row ?? null;
}

/**
 * Courses in a subject. When userId is null the per-user columns are zeroed
 * rather than omitted, so the response shape never changes.
 */
export async function listCoursesBySubject(
  subjectSlug: string,
  userId: string | null,
): Promise<CourseSummary[]> {
  const subject = await findSubjectBySlug(subjectSlug);
  if (!subject) return [];

  const rows = await db
    .select({
      id: courses.id,
      slug: courses.slug,
      title: courses.title,
      position: courses.position,
      passScore: courses.passScore,
      questionCount: courses.questionCount,
      bestScore: max(attempts.score),
      attemptCount: count(attempts.id),
    })
    .from(courses)
    .leftJoin(
      attempts,
      userId
        ? and(
            eq(attempts.courseId, courses.id),
            eq(attempts.userId, userId),
            isNotNull(attempts.submittedAt),
          )
        : sql`false`,
    )
    .where(eq(courses.subjectId, subject.id))
    .groupBy(
      courses.id,
      courses.slug,
      courses.title,
      courses.position,
      courses.passScore,
      courses.questionCount,
    )
    .orderBy(asc(courses.position));

  return rows.map((r) => ({
    ...r,
    bestScore: r.bestScore === null ? null : Number(r.bestScore),
    attemptCount: Number(r.attemptCount),
  }));
}
```

- [ ] **Step 5: Implement the controller**

Create `backend/src/controllers/catalog.controller.ts`:

```ts
import type { Request, Response } from 'express';
import {
  findSubjectBySlug,
  listCoursesBySubject,
  listSubjects,
} from '../models/catalog.model.ts';

export async function getSubjects(_req: Request, res: Response): Promise<void> {
  res.json({ subjects: await listSubjects() });
}

export async function getCourses(req: Request, res: Response): Promise<void> {
  const slug = typeof req.query.subject === 'string' ? req.query.subject : '';
  if (!slug) {
    res.status(400).json({ error: 'A subject query parameter is required' });
    return;
  }

  if (!(await findSubjectBySlug(slug))) {
    res.status(404).json({ error: 'Subject not found' });
    return;
  }

  res.json({ courses: await listCoursesBySubject(slug, req.user?.id ?? null) });
}
```

- [ ] **Step 6: Implement the routes and mount them**

Create `backend/src/routes/catalog.routes.ts`:

```ts
import { Router } from 'express';
import * as catalog from '../controllers/catalog.controller.ts';

export const catalogRouter = Router();

// Public: the catalog is browsable before signing in. Per-user columns are
// populated only when a session cookie is present.
catalogRouter.get('/subjects', catalog.getSubjects);
catalogRouter.get('/courses', catalog.getCourses);
```

Modify `backend/src/routes/index.ts` — add the import and mount, keeping existing content:

```ts
import { catalogRouter } from './catalog.routes.ts';

// …after the /health route:
apiRouter.use('/', catalogRouter);
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test -w backend`
Expected: `pass 23`, `fail 0`

- [ ] **Step 8: Commit**

```bash
git add backend/src/models/catalog.model.ts backend/src/controllers/catalog.controller.ts \
        backend/src/controllers/catalog.controller.test.ts \
        backend/src/routes/catalog.routes.ts backend/src/routes/index.ts \
        backend/src/test/helpers/server.ts
git commit -m "feat(api): add subject and course catalog endpoints"
```

---

### Task 9: Quiz fetch endpoint with answer-leak protection

**Files:**
- Create: `backend/src/models/quiz.model.ts`
- Create: `backend/src/controllers/quiz.controller.ts`
- Create: `backend/src/routes/quiz.routes.ts`
- Create: `backend/src/controllers/quiz.controller.test.ts`
- Modify: `backend/src/routes/index.ts`

**Interfaces:**
- Consumes: schema from Task 5, test helpers from Tasks 1 and 8.
- Produces:
  ```ts
  export type QuizOption = { id: string; label: string; body: string };
  export type QuizQuestion = { id: string; position: number; prompt: string; moduleTitle: string; options: QuizOption[] };
  export type Quiz = { courseId: string; slug: string; title: string; passScore: number; questionCount: number; questions: QuizQuestion[] };
  export function findQuizByCourseSlug(slug: string): Promise<Quiz | null>;
  ```

- [ ] **Step 1: Write the failing test**

Create `backend/src/controllers/quiz.controller.test.ts`:

```ts
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resetDb, closeDb } from '../test/helpers/db.ts';
import { startTestServer, registerTestUser } from '../test/helpers/server.ts';
import { seedSubject } from '../scripts/seed-quizzes.ts';
import type { ParsedSubject } from '../lib/quiz-parser.ts';

const subject: ParsedSubject = JSON.parse(
  readFileSync(new URL('../data/chassis.quiz.json', import.meta.url), 'utf8'),
);
const SLUG = 'chassis-tire-and-rim-essentials';

let baseUrl: string;
let close: () => Promise<void>;
let cookie: string;

before(async () => {
  await resetDb();
  await seedSubject(subject);
  ({ baseUrl, close } = await startTestServer());
  ({ cookie } = await registerTestUser(baseUrl, 'quiz@example.com'));
});

after(async () => {
  await close();
  await closeDb();
});

test('GET quiz requires a session', async () => {
  const res = await fetch(`${baseUrl}/api/courses/${SLUG}/quiz`);
  assert.equal(res.status, 401);
});

test('GET quiz returns ten questions in order with four options each', async () => {
  const res = await fetch(`${baseUrl}/api/courses/${SLUG}/quiz`, { headers: { cookie } });
  assert.equal(res.status, 200);
  const { quiz } = (await res.json()) as { quiz: Record<string, any> };

  assert.equal(quiz.slug, SLUG);
  assert.equal(quiz.passScore, 9);
  assert.equal(quiz.questions.length, 10);
  assert.deepEqual(
    quiz.questions.map((q: any) => q.position),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  );
  for (const q of quiz.questions) {
    assert.equal(q.options.length, 4);
    assert.deepEqual(q.options.map((o: any) => o.label), ['A', 'B', 'C', 'D']);
  }
  assert.equal(quiz.questions[0].moduleTitle, 'Tire Technology');
});

test('GET quiz never leaks correct answers or explanations', async () => {
  const res = await fetch(`${baseUrl}/api/courses/${SLUG}/quiz`, { headers: { cookie } });
  const raw = await res.text();

  assert.ok(!raw.includes('isCorrect'), 'payload contained isCorrect');
  assert.ok(!raw.includes('is_correct'), 'payload contained is_correct');
  assert.ok(!raw.includes('explanation'), 'payload contained explanation');
  assert.ok(
    !raw.includes('The R stands for radial construction'),
    'payload contained answer-key prose',
  );
});

test('GET quiz 404s for an unknown course', async () => {
  const res = await fetch(`${baseUrl}/api/courses/not-a-course/quiz`, { headers: { cookie } });
  assert.equal(res.status, 404);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w backend`
Expected: FAIL — 404 on the quiz route

- [ ] **Step 3: Implement the model**

Create `backend/src/models/quiz.model.ts`:

```ts
import { asc, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { courses, modules, questionOptions, questions } from './schema.ts';

/** Deliberately omits isCorrect. See Quiz below. */
export type QuizOption = { id: string; label: string; body: string };

export type QuizQuestion = {
  id: string;
  position: number;
  prompt: string;
  moduleTitle: string;
  options: QuizOption[];
};

/**
 * The learner-facing view of a quiz. It carries no isCorrect flag and no
 * explanation — those exist only in the graded result after submission.
 */
export type Quiz = {
  courseId: string;
  slug: string;
  title: string;
  passScore: number;
  questionCount: number;
  questions: QuizQuestion[];
};

export async function findQuizByCourseSlug(slug: string): Promise<Quiz | null> {
  const [course] = await db.select().from(courses).where(eq(courses.slug, slug)).limit(1);
  if (!course) return null;

  const rows = await db
    .select({
      questionId: questions.id,
      position: questions.position,
      prompt: questions.prompt,
      moduleTitle: modules.title,
      optionId: questionOptions.id,
      label: questionOptions.label,
      body: questionOptions.body,
    })
    .from(questions)
    .innerJoin(modules, eq(modules.id, questions.moduleId))
    .innerJoin(questionOptions, eq(questionOptions.questionId, questions.id))
    .where(eq(questions.courseId, course.id))
    .orderBy(asc(questions.position), asc(questionOptions.label));

  const byQuestion = new Map<string, QuizQuestion>();
  for (const r of rows) {
    let q = byQuestion.get(r.questionId);
    if (!q) {
      q = {
        id: r.questionId,
        position: r.position,
        prompt: r.prompt,
        moduleTitle: r.moduleTitle,
        options: [],
      };
      byQuestion.set(r.questionId, q);
    }
    q.options.push({ id: r.optionId, label: r.label, body: r.body });
  }

  return {
    courseId: course.id,
    slug: course.slug,
    title: course.title,
    passScore: course.passScore,
    questionCount: course.questionCount,
    questions: [...byQuestion.values()],
  };
}
```

- [ ] **Step 4: Implement the controller and routes**

Create `backend/src/controllers/quiz.controller.ts`:

```ts
import type { Request, Response } from 'express';
import { findQuizByCourseSlug } from '../models/quiz.model.ts';

export async function getQuiz(req: Request, res: Response): Promise<void> {
  const quiz = await findQuizByCourseSlug(req.params.slug!);
  if (!quiz) {
    res.status(404).json({ error: 'Course not found' });
    return;
  }
  res.json({ quiz });
}
```

Create `backend/src/routes/quiz.routes.ts`:

```ts
import { Router } from 'express';
import * as quiz from '../controllers/quiz.controller.ts';
import { requireAuth } from '../middleware/auth.middleware.ts';

export const quizRouter = Router();

quizRouter.get('/courses/:slug/quiz', requireAuth, quiz.getQuiz);
```

Modify `backend/src/routes/index.ts` — add the import and mount after the catalog router:

```ts
import { quizRouter } from './quiz.routes.ts';

apiRouter.use('/', quizRouter);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -w backend`
Expected: `pass 27`, `fail 0`

- [ ] **Step 6: Commit**

```bash
git add backend/src/models/quiz.model.ts backend/src/controllers/quiz.controller.ts \
        backend/src/controllers/quiz.controller.test.ts backend/src/routes/quiz.routes.ts \
        backend/src/routes/index.ts
git commit -m "feat(api): serve quizzes without answers, with a leak test"
```

---

### Task 10: Attempt lifecycle — start, resume, save answers

**Files:**
- Create: `backend/src/models/attempt.model.ts`
- Create: `backend/src/controllers/attempt.controller.ts`
- Create: `backend/src/controllers/attempt.controller.test.ts`
- Modify: `backend/src/routes/quiz.routes.ts`

**Interfaces:**
- Consumes: schema from Task 5, `findQuizByCourseSlug` from Task 9.
- Produces:
  ```ts
  export type AttemptRow = { id: string; userId: string; courseId: string; score: number | null;
                             startedAt: Date; submittedAt: Date | null };
  export type SavedAnswer = { questionId: string; optionId: string };
  export function findOpenAttempt(userId: string, courseId: string): Promise<AttemptRow | null>;
  export function startOrResumeAttempt(userId: string, courseId: string):
    Promise<{ attempt: AttemptRow; created: boolean }>;   // `created` drives 201 vs 200
  export function findAttemptById(id: string): Promise<AttemptRow | null>;
  export function listAnswers(attemptId: string): Promise<SavedAnswer[]>;
  export function findOptionForQuestion(questionId: string, optionId: string):
    Promise<{ isCorrect: boolean; courseId: string } | null>;
  export function saveAnswer(attemptId: string, questionId: string, optionId: string, isCorrect: boolean): Promise<void>;
  ```

- [ ] **Step 1: Write the failing test**

Create `backend/src/controllers/attempt.controller.test.ts`:

```ts
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resetDb, closeDb } from '../test/helpers/db.ts';
import { startTestServer, registerTestUser } from '../test/helpers/server.ts';
import { seedSubject } from '../scripts/seed-quizzes.ts';
import type { ParsedSubject } from '../lib/quiz-parser.ts';

const subject: ParsedSubject = JSON.parse(
  readFileSync(new URL('../data/chassis.quiz.json', import.meta.url), 'utf8'),
);
const SLUG = 'chassis-tire-and-rim-essentials';

let baseUrl: string;
let close: () => Promise<void>;
let cookie: string;

async function getQuiz(): Promise<any> {
  const res = await fetch(`${baseUrl}/api/courses/${SLUG}/quiz`, { headers: { cookie } });
  return ((await res.json()) as any).quiz;
}

before(async () => {
  await resetDb();
  await seedSubject(subject);
  ({ baseUrl, close } = await startTestServer());
  ({ cookie } = await registerTestUser(baseUrl, 'attempt@example.com'));
});

after(async () => {
  await close();
  await closeDb();
});

test('POST attempts requires a session', async () => {
  const res = await fetch(`${baseUrl}/api/courses/${SLUG}/attempts`, { method: 'POST' });
  assert.equal(res.status, 401);
});

test('POST attempts starts an attempt, and repeating resumes the same one', async () => {
  const first = await fetch(`${baseUrl}/api/courses/${SLUG}/attempts`, {
    method: 'POST',
    headers: { cookie },
  });
  assert.equal(first.status, 201);
  const a = (await first.json()) as { attempt: { id: string; submittedAt: string | null } };
  assert.equal(a.attempt.submittedAt, null);

  const second = await fetch(`${baseUrl}/api/courses/${SLUG}/attempts`, {
    method: 'POST',
    headers: { cookie },
  });
  assert.equal(second.status, 200);
  const b = (await second.json()) as { attempt: { id: string } };
  assert.equal(b.attempt.id, a.attempt.id, 'should resume, not create a second attempt');
});

test('PUT answer saves a selection and is idempotent', async () => {
  const quiz = await getQuiz();
  const res0 = await fetch(`${baseUrl}/api/courses/${SLUG}/attempts`, {
    method: 'POST',
    headers: { cookie },
  });
  const { attempt } = (await res0.json()) as { attempt: { id: string } };

  const q = quiz.questions[0];
  const save = async (optionId: string) =>
    fetch(`${baseUrl}/api/attempts/${attempt.id}/answers/${q.id}`, {
      method: 'PUT',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ optionId }),
    });

  assert.equal((await save(q.options[1].id)).status, 204);
  assert.equal((await save(q.options[0].id)).status, 204);

  const res = await fetch(`${baseUrl}/api/attempts/${attempt.id}`, { headers: { cookie } });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { attempt: { answers: Array<{ questionId: string; optionId: string }> } };
  assert.equal(body.attempt.answers.length, 1, 'changing an answer must not add a row');
  assert.equal(body.attempt.answers[0]?.optionId, q.options[0].id);
});

test('PUT answer rejects an option that belongs to another question', async () => {
  const quiz = await getQuiz();
  const res0 = await fetch(`${baseUrl}/api/courses/${SLUG}/attempts`, {
    method: 'POST',
    headers: { cookie },
  });
  const { attempt } = (await res0.json()) as { attempt: { id: string } };

  const res = await fetch(
    `${baseUrl}/api/attempts/${attempt.id}/answers/${quiz.questions[0].id}`,
    {
      method: 'PUT',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ optionId: quiz.questions[1].options[0].id }),
    },
  );
  assert.equal(res.status, 400);
});

test("an in-progress attempt's answers do not reveal correctness", async () => {
  const quiz = await getQuiz();
  const res0 = await fetch(`${baseUrl}/api/courses/${SLUG}/attempts`, {
    method: 'POST',
    headers: { cookie },
  });
  const { attempt } = (await res0.json()) as { attempt: { id: string } };
  await fetch(`${baseUrl}/api/attempts/${attempt.id}/answers/${quiz.questions[0].id}`, {
    method: 'PUT',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ optionId: quiz.questions[0].options[0].id }),
  });

  const raw = await (await fetch(`${baseUrl}/api/attempts/${attempt.id}`, { headers: { cookie } })).text();
  assert.ok(!raw.includes('isCorrect'), 'in-progress attempt leaked correctness');
  assert.ok(!raw.includes('explanation'), 'in-progress attempt leaked explanations');
});

test("another user's attempt is a 404", async () => {
  const res0 = await fetch(`${baseUrl}/api/courses/${SLUG}/attempts`, {
    method: 'POST',
    headers: { cookie },
  });
  const { attempt } = (await res0.json()) as { attempt: { id: string } };

  const other = await registerTestUser(baseUrl, 'intruder@example.com');
  const res = await fetch(`${baseUrl}/api/attempts/${attempt.id}`, {
    headers: { cookie: other.cookie },
  });
  assert.equal(res.status, 404);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w backend`
Expected: FAIL — 404 on the attempts route

- [ ] **Step 3: Implement the model**

Create `backend/src/models/attempt.model.ts`:

```ts
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { attemptAnswers, attempts, questionOptions, questions } from './schema.ts';

export type AttemptRow = {
  id: string;
  userId: string;
  courseId: string;
  score: number | null;
  startedAt: Date;
  submittedAt: Date | null;
};

export type SavedAnswer = { questionId: string; optionId: string };

export async function findOpenAttempt(
  userId: string,
  courseId: string,
): Promise<AttemptRow | null> {
  const [row] = await db
    .select()
    .from(attempts)
    .where(
      and(
        eq(attempts.userId, userId),
        eq(attempts.courseId, courseId),
        isNull(attempts.submittedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Returns the caller's unfinished attempt if one exists, otherwise creates one.
 * A partial unique index guarantees at most one open attempt per user+course.
 */
export async function startOrResumeAttempt(
  userId: string,
  courseId: string,
): Promise<{ attempt: AttemptRow; created: boolean }> {
  const existing = await findOpenAttempt(userId, courseId);
  if (existing) return { attempt: existing, created: false };

  const [row] = await db.insert(attempts).values({ userId, courseId }).returning();
  return { attempt: row!, created: true };
}

export async function findAttemptById(id: string): Promise<AttemptRow | null> {
  const [row] = await db.select().from(attempts).where(eq(attempts.id, id)).limit(1);
  return row ?? null;
}

export async function listAnswers(attemptId: string): Promise<SavedAnswer[]> {
  return db
    .select({ questionId: attemptAnswers.questionId, optionId: attemptAnswers.optionId })
    .from(attemptAnswers)
    .where(eq(attemptAnswers.attemptId, attemptId));
}

/** Confirms the option really belongs to the question, and reports its course. */
export async function findOptionForQuestion(
  questionId: string,
  optionId: string,
): Promise<{ isCorrect: boolean; courseId: string } | null> {
  const [row] = await db
    .select({ isCorrect: questionOptions.isCorrect, courseId: questions.courseId })
    .from(questionOptions)
    .innerJoin(questions, eq(questions.id, questionOptions.questionId))
    .where(and(eq(questionOptions.id, optionId), eq(questionOptions.questionId, questionId)))
    .limit(1);
  return row ?? null;
}

export async function saveAnswer(
  attemptId: string,
  questionId: string,
  optionId: string,
  isCorrect: boolean,
): Promise<void> {
  await db
    .insert(attemptAnswers)
    .values({ attemptId, questionId, optionId, isCorrect })
    .onConflictDoUpdate({
      target: [attemptAnswers.attemptId, attemptAnswers.questionId],
      set: { optionId, isCorrect },
    });
}
```

- [ ] **Step 4: Implement the controller**

Create `backend/src/controllers/attempt.controller.ts`:

```ts
import type { Request, Response } from 'express';
import { z } from 'zod';
import { findQuizByCourseSlug } from '../models/quiz.model.ts';
import {
  findAttemptById,
  findOptionForQuestion,
  listAnswers,
  saveAnswer,
  startOrResumeAttempt,
  type AttemptRow,
} from '../models/attempt.model.ts';

const answerBody = z.object({ optionId: z.uuid() });

/**
 * Loads an attempt the caller owns. A missing attempt and someone else's
 * attempt are both 404 — a 403 would confirm the id exists.
 */
async function loadOwnedAttempt(req: Request, res: Response): Promise<AttemptRow | null> {
  const attempt = await findAttemptById(req.params.id!);
  if (!attempt || attempt.userId !== req.user!.id) {
    res.status(404).json({ error: 'Attempt not found' });
    return null;
  }
  return attempt;
}

export async function startAttempt(req: Request, res: Response): Promise<void> {
  const quiz = await findQuizByCourseSlug(req.params.slug!);
  if (!quiz) {
    res.status(404).json({ error: 'Course not found' });
    return;
  }

  const { attempt, created } = await startOrResumeAttempt(req.user!.id, quiz.courseId);
  res.status(created ? 201 : 200).json({ attempt });
}

export async function getAttempt(req: Request, res: Response): Promise<void> {
  const attempt = await loadOwnedAttempt(req, res);
  if (!attempt) return;

  if (attempt.submittedAt) {
    res.status(409).json({ error: 'Attempt is submitted; fetch the graded result instead' });
    return;
  }

  res.json({
    attempt: {
      id: attempt.id,
      courseId: attempt.courseId,
      startedAt: attempt.startedAt,
      submittedAt: null,
      answers: await listAnswers(attempt.id),
    },
  });
}

export async function putAnswer(req: Request, res: Response): Promise<void> {
  const attempt = await loadOwnedAttempt(req, res);
  if (!attempt) return;

  if (attempt.submittedAt) {
    res.status(409).json({ error: 'Attempt already submitted' });
    return;
  }

  const parsed = answerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'optionId must be a uuid' });
    return;
  }

  const option = await findOptionForQuestion(req.params.questionId!, parsed.data.optionId);
  if (!option) {
    res.status(400).json({ error: 'That option does not belong to that question' });
    return;
  }
  if (option.courseId !== attempt.courseId) {
    res.status(400).json({ error: 'That question does not belong to this attempt' });
    return;
  }

  await saveAnswer(attempt.id, req.params.questionId!, parsed.data.optionId, option.isCorrect);
  res.status(204).end();
}
```

- [ ] **Step 5: Add the routes**

Modify `backend/src/routes/quiz.routes.ts` — append:

```ts
import * as attempt from '../controllers/attempt.controller.ts';

quizRouter.post('/courses/:slug/attempts', requireAuth, attempt.startAttempt);
quizRouter.get('/attempts/:id', requireAuth, attempt.getAttempt);
quizRouter.put('/attempts/:id/answers/:questionId', requireAuth, attempt.putAnswer);
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -w backend`
Expected: `pass 33`, `fail 0`

- [ ] **Step 7: Commit**

```bash
git add backend/src/models/attempt.model.ts backend/src/controllers/attempt.controller.ts \
        backend/src/controllers/attempt.controller.test.ts backend/src/routes/quiz.routes.ts
git commit -m "feat(api): start, resume and record answers for quiz attempts"
```

---

### Task 11: Submit and grade

**Files:**
- Modify: `backend/src/models/attempt.model.ts`
- Modify: `backend/src/controllers/attempt.controller.ts`
- Modify: `backend/src/routes/quiz.routes.ts`
- Create: `backend/src/controllers/grading.test.ts`

**Interfaces:**
- Consumes: everything from Task 10.
- Produces:
  ```ts
  export type GradedOption = { id: string; label: string; body: string; isCorrect: boolean };
  export type GradedQuestion = { id: string; position: number; prompt: string; moduleTitle: string;
                                 explanation: string; selectedOptionId: string | null;
                                 wasCorrect: boolean; options: GradedOption[] };
  export type GradedAttempt = { id: string; courseSlug: string; courseTitle: string;
                                score: number; questionCount: number; passScore: number;
                                previousBest: number | null; submittedAt: Date;
                                modulesToReview: string[]; questions: GradedQuestion[] };
  export function submitAttempt(attemptId: string): Promise<number>;
  export function findGradedAttempt(attemptId: string): Promise<GradedAttempt | null>;
  export function findBestScoreBefore(userId: string, courseId: string, attemptId: string): Promise<number | null>;
  ```

- [ ] **Step 1: Write the failing test**

Create `backend/src/controllers/grading.test.ts`:

```ts
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resetDb, closeDb } from '../test/helpers/db.ts';
import { startTestServer, registerTestUser } from '../test/helpers/server.ts';
import { seedSubject } from '../scripts/seed-quizzes.ts';
import type { ParsedSubject } from '../lib/quiz-parser.ts';

const subject: ParsedSubject = JSON.parse(
  readFileSync(new URL('../data/chassis.quiz.json', import.meta.url), 'utf8'),
);
const SLUG = 'chassis-tire-and-rim-essentials';
const course1 = subject.courses.find((c) => c.slug === SLUG)!;

let baseUrl: string;
let close: () => Promise<void>;
let cookie: string;

/** Answers `correctCount` questions correctly and the rest wrong. Returns the attempt id. */
async function takeQuiz(sessionCookie: string, correctCount: number): Promise<string> {
  const quizRes = await fetch(`${baseUrl}/api/courses/${SLUG}/quiz`, {
    headers: { cookie: sessionCookie },
  });
  const { quiz } = (await quizRes.json()) as any;

  const startRes = await fetch(`${baseUrl}/api/courses/${SLUG}/attempts`, {
    method: 'POST',
    headers: { cookie: sessionCookie },
  });
  const { attempt } = (await startRes.json()) as any;

  for (const [i, q] of quiz.questions.entries()) {
    const expected = course1.questions.find((x) => x.position === q.position)!;
    const correctLabel = expected.options.find((o) => o.isCorrect)!.label;
    const label = i < correctCount ? correctLabel : correctLabel === 'A' ? 'B' : 'A';
    const option = q.options.find((o: any) => o.label === label);

    const res = await fetch(`${baseUrl}/api/attempts/${attempt.id}/answers/${q.id}`, {
      method: 'PUT',
      headers: { cookie: sessionCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ optionId: option.id }),
    });
    assert.equal(res.status, 204);
  }
  return attempt.id;
}

before(async () => {
  await resetDb();
  await seedSubject(subject);
  ({ baseUrl, close } = await startTestServer());
  ({ cookie } = await registerTestUser(baseUrl, 'grading@example.com'));
});

after(async () => {
  await close();
  await closeDb();
});

test('submitting scores against the answer key', async () => {
  const attemptId = await takeQuiz(cookie, 8);

  const res = await fetch(`${baseUrl}/api/attempts/${attemptId}/submit`, {
    method: 'POST',
    headers: { cookie },
  });
  assert.equal(res.status, 200);
  const { attempt } = (await res.json()) as any;
  assert.equal(attempt.score, 8);
  assert.equal(attempt.questionCount, 10);
  assert.equal(attempt.passScore, 9);
});

test('the graded result carries explanations and modules to review', async () => {
  const res = await fetch(`${baseUrl}/api/courses/${SLUG}/attempts`, {
    method: 'POST',
    headers: { cookie },
  });
  assert.equal(res.status, 201, 'previous attempt should be closed, so a new one starts');
  const { attempt: fresh } = (await res.json()) as any;

  // Answer only question 1, correctly; the other nine stay blank.
  const quiz = (await (
    await fetch(`${baseUrl}/api/courses/${SLUG}/quiz`, { headers: { cookie } })
  ).json()) as any;
  const q1 = quiz.quiz.questions[0];
  const correct = course1.questions[0]!.options.find((o) => o.isCorrect)!.label;
  await fetch(`${baseUrl}/api/attempts/${fresh.id}/answers/${q1.id}`, {
    method: 'PUT',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ optionId: q1.options.find((o: any) => o.label === correct).id }),
  });

  await fetch(`${baseUrl}/api/attempts/${fresh.id}/submit`, { method: 'POST', headers: { cookie } });

  const graded = (await (
    await fetch(`${baseUrl}/api/attempts/${fresh.id}`, { headers: { cookie } })
  ).json()) as any;

  assert.equal(graded.attempt.score, 1, 'unanswered questions count as wrong');
  assert.equal(graded.attempt.questions.length, 10);
  assert.equal(graded.attempt.previousBest, 8);

  const first = graded.attempt.questions[0];
  assert.equal(first.wasCorrect, true);
  assert.ok(first.explanation.length > 0);
  assert.ok(first.options.some((o: any) => o.isCorrect));

  const blank = graded.attempt.questions[1];
  assert.equal(blank.selectedOptionId, null);
  assert.equal(blank.wasCorrect, false);

  assert.ok(graded.attempt.modulesToReview.length > 0);
  assert.ok(!graded.attempt.modulesToReview.includes('Tire Technology') ||
            graded.attempt.questions.some((q: any) => !q.wasCorrect && q.moduleTitle === 'Tire Technology'));
});

test('submitting twice is idempotent and does not regrade', async () => {
  const attemptId = await takeQuiz(cookie, 5);
  const first = await fetch(`${baseUrl}/api/attempts/${attemptId}/submit`, {
    method: 'POST',
    headers: { cookie },
  });
  const a = (await first.json()) as any;

  const second = await fetch(`${baseUrl}/api/attempts/${attemptId}/submit`, {
    method: 'POST',
    headers: { cookie },
  });
  assert.equal(second.status, 200);
  const b = (await second.json()) as any;
  assert.equal(b.attempt.score, a.attempt.score);
  assert.equal(b.attempt.submittedAt, a.attempt.submittedAt);
});

test("another user cannot submit someone else's attempt", async () => {
  const quizRes = await fetch(`${baseUrl}/api/courses/${SLUG}/attempts`, {
    method: 'POST',
    headers: { cookie },
  });
  const { attempt } = (await quizRes.json()) as any;

  const other = await registerTestUser(baseUrl, 'thief@example.com');
  const res = await fetch(`${baseUrl}/api/attempts/${attempt.id}/submit`, {
    method: 'POST',
    headers: { cookie: other.cookie },
  });
  assert.equal(res.status, 404);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w backend`
Expected: FAIL — 404 on the submit route

- [ ] **Step 3: Extend the attempt model**

Append to `backend/src/models/attempt.model.ts`. **Merge the new drizzle-orm names into the existing import on line 1** rather than adding a second import statement — re-importing `eq` is a TS error, and `noUnusedLocals` rejects names you don't use. Line 1 becomes:

```ts
import { and, asc, count, eq, isNotNull, isNull, max, ne } from 'drizzle-orm';
```

And extend the schema import to include the content tables:

```ts
import {
  attemptAnswers, attempts, courses, modules, questionOptions, questions,
} from './schema.ts';
```

Then append:

```ts
export type GradedOption = { id: string; label: string; body: string; isCorrect: boolean };

export type GradedQuestion = {
  id: string;
  position: number;
  prompt: string;
  moduleTitle: string;
  explanation: string;
  selectedOptionId: string | null;
  wasCorrect: boolean;
  options: GradedOption[];
};

export type GradedAttempt = {
  id: string;
  courseSlug: string;
  courseTitle: string;
  score: number;
  questionCount: number;
  passScore: number;
  previousBest: number | null;
  submittedAt: Date;
  modulesToReview: string[];
  questions: GradedQuestion[];
};

/**
 * Grades and closes the attempt. Score is the count of answers already flagged
 * correct at save time, so unanswered questions simply never contribute.
 * Returns the score. Caller must ensure the attempt is still open.
 */
export async function submitAttempt(attemptId: string): Promise<number> {
  const [row] = await db
    .select({ correct: count() })
    .from(attemptAnswers)
    .where(and(eq(attemptAnswers.attemptId, attemptId), eq(attemptAnswers.isCorrect, true)));

  const score = Number(row?.correct ?? 0);

  await db
    .update(attempts)
    .set({ score, submittedAt: new Date() })
    .where(and(eq(attempts.id, attemptId), isNull(attempts.submittedAt)));

  return score;
}

/** Best submitted score for this user and course, excluding the given attempt. */
export async function findBestScoreBefore(
  userId: string,
  courseId: string,
  attemptId: string,
): Promise<number | null> {
  const [row] = await db
    .select({ best: max(attempts.score) })
    .from(attempts)
    .where(
      and(
        eq(attempts.userId, userId),
        eq(attempts.courseId, courseId),
        isNotNull(attempts.submittedAt),
        ne(attempts.id, attemptId),
      ),
    );
  return row?.best === null || row?.best === undefined ? null : Number(row.best);
}

export async function findGradedAttempt(attemptId: string): Promise<GradedAttempt | null> {
  const attempt = await findAttemptById(attemptId);
  if (!attempt || attempt.submittedAt === null) return null;

  const [course] = await db
    .select()
    .from(courses)
    .where(eq(courses.id, attempt.courseId))
    .limit(1);
  if (!course) return null;

  const rows = await db
    .select({
      questionId: questions.id,
      position: questions.position,
      prompt: questions.prompt,
      explanation: questions.explanation,
      moduleTitle: modules.title,
      optionId: questionOptions.id,
      label: questionOptions.label,
      body: questionOptions.body,
      isCorrect: questionOptions.isCorrect,
      selectedOptionId: attemptAnswers.optionId,
    })
    .from(questions)
    .innerJoin(modules, eq(modules.id, questions.moduleId))
    .innerJoin(questionOptions, eq(questionOptions.questionId, questions.id))
    .leftJoin(
      attemptAnswers,
      and(
        eq(attemptAnswers.questionId, questions.id),
        eq(attemptAnswers.attemptId, attemptId),
      ),
    )
    .where(eq(questions.courseId, attempt.courseId))
    .orderBy(asc(questions.position), asc(questionOptions.label));

  const byQuestion = new Map<string, GradedQuestion>();
  for (const r of rows) {
    let q = byQuestion.get(r.questionId);
    if (!q) {
      q = {
        id: r.questionId,
        position: r.position,
        prompt: r.prompt,
        moduleTitle: r.moduleTitle,
        explanation: r.explanation,
        selectedOptionId: r.selectedOptionId ?? null,
        wasCorrect: false,
        options: [],
      };
      byQuestion.set(r.questionId, q);
    }
    if (r.selectedOptionId) q.selectedOptionId = r.selectedOptionId;
    q.options.push({ id: r.optionId, label: r.label, body: r.body, isCorrect: r.isCorrect });
  }

  const graded = [...byQuestion.values()].map((q) => ({
    ...q,
    wasCorrect:
      q.selectedOptionId !== null &&
      q.options.some((o) => o.id === q.selectedOptionId && o.isCorrect),
  }));

  const modulesToReview = [
    ...new Set(graded.filter((q) => !q.wasCorrect).map((q) => q.moduleTitle)),
  ];

  return {
    id: attempt.id,
    courseSlug: course.slug,
    courseTitle: course.title,
    score: attempt.score ?? 0,
    questionCount: course.questionCount,
    passScore: course.passScore,
    previousBest: await findBestScoreBefore(attempt.userId, attempt.courseId, attempt.id),
    submittedAt: attempt.submittedAt,
    modulesToReview,
    questions: graded,
  };
}
```

Run `npm run typecheck -w backend` after this step and remove any import `noUnusedLocals` flags.

- [ ] **Step 4: Extend the controller**

Modify `backend/src/controllers/attempt.controller.ts`. Replace `getAttempt` so it serves either the in-progress or the graded shape, and add `submit`:

```ts
import {
  findGradedAttempt,
  submitAttempt,
} from '../models/attempt.model.ts';

export async function getAttempt(req: Request, res: Response): Promise<void> {
  const attempt = await loadOwnedAttempt(req, res);
  if (!attempt) return;

  if (attempt.submittedAt) {
    const graded = await findGradedAttempt(attempt.id);
    if (!graded) {
      res.status(404).json({ error: 'Attempt not found' });
      return;
    }
    res.json({ attempt: graded });
    return;
  }

  res.json({
    attempt: {
      id: attempt.id,
      courseId: attempt.courseId,
      startedAt: attempt.startedAt,
      submittedAt: null,
      answers: await listAnswers(attempt.id),
    },
  });
}

export async function submit(req: Request, res: Response): Promise<void> {
  const attempt = await loadOwnedAttempt(req, res);
  if (!attempt) return;

  // Idempotent: a second submit returns the existing grade rather than regrading.
  if (!attempt.submittedAt) {
    await submitAttempt(attempt.id);
  }

  const graded = await findGradedAttempt(attempt.id);
  if (!graded) {
    res.status(500).json({ error: 'Attempt could not be graded' });
    return;
  }
  res.json({ attempt: graded });
}
```

- [ ] **Step 5: Add the route**

Append to `backend/src/routes/quiz.routes.ts`:

```ts
quizRouter.post('/attempts/:id/submit', requireAuth, attempt.submit);
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -w backend`
Expected: `pass 37`, `fail 0`

- [ ] **Step 7: Typecheck and commit**

```bash
npm run typecheck -w backend
git add backend/src/models/attempt.model.ts backend/src/controllers/attempt.controller.ts \
        backend/src/routes/quiz.routes.ts backend/src/controllers/grading.test.ts
git commit -m "feat(api): grade attempts server-side with explanations and review modules"
```

---

### Task 12: Frontend routing and course list

Frontend tasks have no automated tests — the spec's testing section covers the backend only. Each carries explicit manual verification instead.

**Files:**
- Create: `frontend/src/quiz/api.ts`
- Create: `frontend/src/pages/CoursesPage.tsx`
- Create: `frontend/src/router.tsx`
- Modify: `frontend/src/App.tsx`, `frontend/src/main.tsx`, `frontend/src/App.css`

**Interfaces:**
- Consumes: the API from Tasks 8–11, `useAuth` from `frontend/src/auth/useAuth`.
- Produces:
  ```ts
  export type CourseSummary = { id: string; slug: string; title: string; position: number;
                                passScore: number; questionCount: number;
                                bestScore: number | null; attemptCount: number };
  export type QuizOption = { id: string; label: string; body: string };
  export type QuizQuestion = { id: string; position: number; prompt: string; moduleTitle: string; options: QuizOption[] };
  export type Quiz = { courseId: string; slug: string; title: string; passScore: number; questionCount: number; questions: QuizQuestion[] };
  export type OpenAttempt = { id: string; courseId: string; startedAt: string;
                              submittedAt: null; answers: Array<{ questionId: string; optionId: string }> };
  export type GradedOption = { id: string; label: string; body: string; isCorrect: boolean };
  export type GradedQuestion = { id: string; position: number; prompt: string; moduleTitle: string;
                                 explanation: string; selectedOptionId: string | null;
                                 wasCorrect: boolean; options: GradedOption[] };
  export type GradedAttempt = { id: string; courseSlug: string; courseTitle: string; score: number;
                                questionCount: number; passScore: number; previousBest: number | null;
                                submittedAt: string; modulesToReview: string[]; questions: GradedQuestion[] };
  export const quizApi: {
    listCourses(subject: string): Promise<{ courses: CourseSummary[] }>;
    getQuiz(slug: string): Promise<{ quiz: Quiz }>;
    startAttempt(slug: string): Promise<{ attempt: { id: string } }>;
    getAttempt(id: string): Promise<{ attempt: OpenAttempt | GradedAttempt }>;
    saveAnswer(attemptId: string, questionId: string, optionId: string): Promise<void>;
    submit(attemptId: string): Promise<{ attempt: GradedAttempt }>;
  };
  ```

- [ ] **Step 1: Install react-router**

```bash
cd /Users/sam/Projects/liah-wellness/liah-learning
npm i react-router@^8.5.1 -w frontend
```

Expected: installs cleanly. Import from `react-router`, **not** `react-router-dom` (which is a legacy wrapper around v7).

- [ ] **Step 2: Create the quiz API client**

Create `frontend/src/quiz/api.ts`:

```ts
export type CourseSummary = {
  id: string;
  slug: string;
  title: string;
  position: number;
  passScore: number;
  questionCount: number;
  bestScore: number | null;
  attemptCount: number;
};

export type QuizOption = { id: string; label: string; body: string };

export type QuizQuestion = {
  id: string;
  position: number;
  prompt: string;
  moduleTitle: string;
  options: QuizOption[];
};

export type Quiz = {
  courseId: string;
  slug: string;
  title: string;
  passScore: number;
  questionCount: number;
  questions: QuizQuestion[];
};

export type OpenAttempt = {
  id: string;
  courseId: string;
  startedAt: string;
  submittedAt: null;
  answers: Array<{ questionId: string; optionId: string }>;
};

export type GradedOption = { id: string; label: string; body: string; isCorrect: boolean };

export type GradedQuestion = {
  id: string;
  position: number;
  prompt: string;
  moduleTitle: string;
  explanation: string;
  selectedOptionId: string | null;
  wasCorrect: boolean;
  options: GradedOption[];
};

export type GradedAttempt = {
  id: string;
  courseSlug: string;
  courseTitle: string;
  score: number;
  questionCount: number;
  passScore: number;
  previousBest: number | null;
  submittedAt: string;
  modulesToReview: string[];
  questions: GradedQuestion[];
};

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}) as Record<string, unknown>);
  if (!res.ok) {
    const message = typeof body.error === 'string' ? body.error : res.statusText;
    throw new ApiError(message, res.status);
  }
  return body as T;
}

export const quizApi = {
  listCourses: (subject: string) =>
    request<{ courses: CourseSummary[] }>(`/courses?subject=${encodeURIComponent(subject)}`),

  getQuiz: (slug: string) => request<{ quiz: Quiz }>(`/courses/${slug}/quiz`),

  startAttempt: (slug: string) =>
    request<{ attempt: { id: string } }>(`/courses/${slug}/attempts`, { method: 'POST' }),

  getAttempt: (id: string) =>
    request<{ attempt: OpenAttempt | GradedAttempt }>(`/attempts/${id}`),

  saveAnswer: (attemptId: string, questionId: string, optionId: string) =>
    request<void>(`/attempts/${attemptId}/answers/${questionId}`, {
      method: 'PUT',
      body: JSON.stringify({ optionId }),
    }),

  submit: (attemptId: string) =>
    request<{ attempt: GradedAttempt }>(`/attempts/${attemptId}/submit`, { method: 'POST' }),
};
```

- [ ] **Step 3: Create the courses page**

Create `frontend/src/pages/CoursesPage.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { quizApi, type CourseSummary } from '../quiz/api';

export function CoursesPage() {
  const [courses, setCourses] = useState<CourseSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    quizApi
      .listCourses('chassis')
      .then(({ courses }) => {
        if (!cancelled) setCourses(courses);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load courses');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p role="alert" className="auth-error">{error}</p>;
  if (!courses) return <div className="auth-loading">Loading courses…</div>;

  return (
    <div className="course-list">
      <h1>Chassis Program</h1>
      <p className="course-intro">
        {courses.length} courses. Take a quiz after finishing each one; aim for 9 out of 10.
      </p>

      <ul>
        {courses.map((c) => (
          <li key={c.id} className="course-row">
            <div>
              <span className="course-position">Course {c.position}</span>
              <Link to={`/courses/${c.slug}/quiz`}>{c.title}</Link>
            </div>
            <div className="course-score">
              {c.bestScore === null ? (
                <span className="course-untaken">Not attempted</span>
              ) : (
                <span className={c.bestScore >= c.passScore ? 'course-passed' : 'course-below'}>
                  Best {c.bestScore}/{c.questionCount}
                  {c.attemptCount > 1 ? ` · ${c.attemptCount} attempts` : ''}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Create the router**

Create `frontend/src/router.tsx`:

```tsx
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { LoginForm } from './auth/LoginForm';
import { useAuth } from './auth/useAuth';
import { CoursesPage } from './pages/CoursesPage';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="auth-loading">Loading…</div>;
  if (!user) return <LoginForm />;
  return <>{children}</>;
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/courses" replace />} />
        <Route
          path="/courses"
          element={
            <RequireAuth>
              <CoursesPage />
            </RequireAuth>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
```

Note: `React.ReactNode` here resolves through the UMD global. Import the type instead to match the existing codebase convention:

```tsx
import { type ReactNode } from 'react';
// …and use `{ children }: { children: ReactNode }`
```

- [ ] **Step 5: Wire the router into the app**

Replace `frontend/src/App.tsx`:

```tsx
import './App.css';
import { AppRouter } from './router';
import { useAuth } from './auth/useAuth';

function SignOutBar() {
  const { user, logout } = useAuth();
  if (!user) return null;
  return (
    <div className="topbar">
      <span>{user.email}</span>
      <button type="button" onClick={() => void logout()}>
        Sign out
      </button>
    </div>
  );
}

export default function App() {
  return (
    <>
      <SignOutBar />
      <AppRouter />
    </>
  );
}
```

`main.tsx` already wraps `<App />` in `<AuthProvider>` — leave it as is.

- [ ] **Step 6: Add styles**

Append to `frontend/src/App.css`:

```css
.topbar {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1.25rem;
  border-bottom: 1px solid rgb(128 128 128 / 0.25);
  font-size: 0.875rem;
}

.course-list {
  max-width: 44rem;
  margin: 2.5rem auto;
  padding: 0 1.25rem;
  text-align: left;
}

.course-intro {
  opacity: 0.75;
  font-size: 0.9rem;
}

.course-list ul {
  list-style: none;
  padding: 0;
  margin: 1.5rem 0 0;
}

.course-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  padding: 0.85rem 0;
  border-bottom: 1px solid rgb(128 128 128 / 0.2);
}

.course-position {
  display: block;
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  opacity: 0.6;
}

.course-score { font-size: 0.85rem; white-space: nowrap; }
.course-untaken { opacity: 0.55; }
.course-passed { color: #1a7f37; }
.course-below { color: #9a6700; }
```

- [ ] **Step 7: Verify build and lint**

```bash
cd /Users/sam/Projects/liah-wellness/liah-learning
npm run build -w frontend && npm run lint -w frontend
```

Expected: build succeeds, eslint prints nothing.

- [ ] **Step 8: Verify manually in the browser**

```bash
npm run dev
```

Open `http://localhost:5173/`. Sign in. Expected: redirected to `/courses`, showing 11 Chassis courses in order, each "Not attempted", each linking to `/courses/<slug>/quiz`. Reload the page — you stay on `/courses` and remain signed in.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/quiz/api.ts frontend/src/pages/CoursesPage.tsx frontend/src/router.tsx \
        frontend/src/App.tsx frontend/src/App.css frontend/package.json package-lock.json
git commit -m "feat(web): add react-router and the course list page"
```

---

### Task 13: Quiz page

**Files:**
- Create: `frontend/src/quiz/useQuizAttempt.ts`
- Create: `frontend/src/quiz/QuestionCard.tsx`
- Create: `frontend/src/quiz/ReviewGrid.tsx`
- Create: `frontend/src/pages/QuizPage.tsx`
- Modify: `frontend/src/router.tsx`, `frontend/src/App.css`

**Interfaces:**
- Consumes: `quizApi`, `Quiz`, `QuizQuestion` from Task 12.
- Produces:
  ```ts
  export type QuizAttemptState = {
    quiz: Quiz | null; attemptId: string | null; loading: boolean; error: string | null;
    answers: Record<string, string>;      // questionId -> optionId
    index: number; saving: boolean; submitting: boolean;
    select: (questionId: string, optionId: string) => void;
    goTo: (index: number) => void; next: () => void; back: () => void;
    submit: () => Promise<string | null>; // resolves to attemptId on success
  };
  export function useQuizAttempt(slug: string): QuizAttemptState;
  ```

- [ ] **Step 1: Create the hook**

Create `frontend/src/quiz/useQuizAttempt.ts`:

```ts
import { useCallback, useEffect, useState } from 'react';
import { quizApi, type GradedAttempt, type OpenAttempt, type Quiz } from './api';

export type QuizAttemptState = {
  quiz: Quiz | null;
  attemptId: string | null;
  loading: boolean;
  error: string | null;
  answers: Record<string, string>;
  index: number;
  saving: boolean;
  submitting: boolean;
  select: (questionId: string, optionId: string) => void;
  goTo: (index: number) => void;
  next: () => void;
  back: () => void;
  submit: () => Promise<string | null>;
};

/**
 * Loads the quiz, starts or resumes an attempt, and saves each selection as it
 * is made. Because answers live on the server, reloading mid-quiz restores them.
 */
export function useQuizAttempt(slug: string): QuizAttemptState {
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    (async () => {
      const [{ quiz }, { attempt }] = await Promise.all([
        quizApi.getQuiz(slug),
        quizApi.startAttempt(slug),
      ]);
      const existing = (await quizApi.getAttempt(attempt.id)).attempt as OpenAttempt | GradedAttempt;

      if (cancelled) return;
      setQuiz(quiz);
      setAttemptId(attempt.id);
      if ('answers' in existing) {
        setAnswers(Object.fromEntries(existing.answers.map((a) => [a.questionId, a.optionId])));
      }
    })()
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load the quiz');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [slug]);

  const select = useCallback(
    (questionId: string, optionId: string) => {
      if (!attemptId) return;
      setAnswers((prev) => ({ ...prev, [questionId]: optionId }));
      setSaving(true);
      quizApi
        .saveAnswer(attemptId, questionId, optionId)
        .catch((err: unknown) =>
          setError(err instanceof Error ? err.message : 'Could not save that answer'),
        )
        .finally(() => setSaving(false));
    },
    [attemptId],
  );

  const total = quiz?.questions.length ?? 0;
  const goTo = useCallback((i: number) => setIndex(Math.max(0, Math.min(i, total))), [total]);
  const next = useCallback(() => goTo(index + 1), [goTo, index]);
  const back = useCallback(() => goTo(index - 1), [goTo, index]);

  const submit = useCallback(async (): Promise<string | null> => {
    if (!attemptId) return null;
    setSubmitting(true);
    try {
      await quizApi.submit(attemptId);
      return attemptId;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit the quiz');
      return null;
    } finally {
      setSubmitting(false);
    }
  }, [attemptId]);

  return {
    quiz, attemptId, loading, error, answers, index, saving, submitting,
    select, goTo, next, back, submit,
  };
}
```

- [ ] **Step 2: Create the question card**

Create `frontend/src/quiz/QuestionCard.tsx`:

```tsx
import type { QuizQuestion } from './api';

export function QuestionCard({
  question,
  selectedOptionId,
  onSelect,
}: {
  question: QuizQuestion;
  selectedOptionId: string | undefined;
  onSelect: (optionId: string) => void;
}) {
  return (
    <div className="question-card">
      <p className="question-module">{question.moduleTitle}</p>
      <p className="question-prompt">{question.prompt}</p>

      <ul className="option-list">
        {question.options.map((o) => (
          <li key={o.id}>
            <label className={o.id === selectedOptionId ? 'option selected' : 'option'}>
              <input
                type="radio"
                name={`q-${question.id}`}
                value={o.id}
                checked={o.id === selectedOptionId}
                onChange={() => onSelect(o.id)}
              />
              <span className="option-label">{o.label}</span>
              <span>{o.body}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Create the review grid**

Create `frontend/src/quiz/ReviewGrid.tsx`:

```tsx
import type { QuizQuestion } from './api';

export function ReviewGrid({
  questions,
  answers,
  onJump,
  onSubmit,
  submitting,
}: {
  questions: QuizQuestion[];
  answers: Record<string, string>;
  onJump: (index: number) => void;
  onSubmit: () => void;
  submitting: boolean;
}) {
  const unanswered = questions.filter((q) => !answers[q.id]);

  return (
    <div className="review-grid">
      <h2>Review before submitting</h2>
      <p className={unanswered.length ? 'review-warning' : 'review-ok'}>
        {unanswered.length === 0
          ? `All ${questions.length} questions answered.`
          : `Answered ${questions.length - unanswered.length} of ${questions.length} — ` +
            `${unanswered.length} still blank. Blank answers are marked wrong.`}
      </p>

      <div className="review-cells">
        {questions.map((q, i) => (
          <button
            key={q.id}
            type="button"
            className={answers[q.id] ? 'review-cell answered' : 'review-cell blank'}
            onClick={() => onJump(i)}
            aria-label={`Question ${q.position}, ${answers[q.id] ? 'answered' : 'blank'}`}
          >
            {q.position}
          </button>
        ))}
      </div>

      <button type="button" className="primary" onClick={onSubmit} disabled={submitting}>
        {submitting ? 'Submitting…' : 'Submit quiz'}
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Create the quiz page**

Create `frontend/src/pages/QuizPage.tsx`:

```tsx
import { useNavigate, useParams } from 'react-router';
import { QuestionCard } from '../quiz/QuestionCard';
import { ReviewGrid } from '../quiz/ReviewGrid';
import { useQuizAttempt } from '../quiz/useQuizAttempt';

export function QuizPage() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const state = useQuizAttempt(slug);

  if (state.loading) return <div className="auth-loading">Loading quiz…</div>;
  if (state.error) return <p role="alert" className="auth-error">{state.error}</p>;
  if (!state.quiz) return <p role="alert" className="auth-error">Quiz not found</p>;

  const { quiz, index, answers } = state;
  const total = quiz.questions.length;
  const onReview = index >= total;

  async function handleSubmit() {
    const attemptId = await state.submit();
    if (attemptId) navigate(`/courses/${slug}/results/${attemptId}`);
  }

  return (
    <div className="quiz-page">
      <div className="quiz-header">
        <span>{quiz.title}</span>
        <span>{onReview ? 'Review' : `Question ${index + 1} of ${total}`}</span>
      </div>

      <div className="progress-track">
        <div
          className="progress-fill"
          style={{ width: `${(Math.min(index, total) / total) * 100}%` }}
        />
      </div>

      {onReview ? (
        <ReviewGrid
          questions={quiz.questions}
          answers={answers}
          onJump={state.goTo}
          onSubmit={() => void handleSubmit()}
          submitting={state.submitting}
        />
      ) : (
        <QuestionCard
          question={quiz.questions[index]!}
          selectedOptionId={answers[quiz.questions[index]!.id]}
          onSelect={(optionId) => state.select(quiz.questions[index]!.id, optionId)}
        />
      )}

      <div className="quiz-nav">
        <button type="button" onClick={state.back} disabled={index === 0}>
          Back
        </button>
        <span className="quiz-saving">{state.saving ? 'Saving…' : ''}</span>
        {!onReview && (
          <button type="button" onClick={state.next}>
            {index === total - 1 ? 'Review' : 'Next'}
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Add the route**

Modify `frontend/src/router.tsx` — add the import and route:

```tsx
import { QuizPage } from './pages/QuizPage';

// inside <Routes>:
<Route
  path="/courses/:slug/quiz"
  element={
    <RequireAuth>
      <QuizPage />
    </RequireAuth>
  }
/>
```

- [ ] **Step 6: Add styles**

Append to `frontend/src/App.css`:

```css
.quiz-page { max-width: 42rem; margin: 2rem auto; padding: 0 1.25rem; text-align: left; }

.quiz-header {
  display: flex; justify-content: space-between;
  font-size: 0.8rem; opacity: 0.75; margin-bottom: 0.5rem;
}

.progress-track {
  height: 6px; border-radius: 3px;
  background: rgb(128 128 128 / 0.25); margin-bottom: 1.5rem; overflow: hidden;
}
.progress-fill { height: 100%; background: currentColor; opacity: 0.55; transition: width 0.2s; }

.question-module {
  font-size: 0.72rem; letter-spacing: 0.08em;
  text-transform: uppercase; opacity: 0.6; margin: 0 0 0.4rem;
}
.question-prompt { font-weight: 600; font-size: 1.05rem; margin: 0 0 1rem; }

.option-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.5rem; }

.option {
  display: flex; align-items: flex-start; gap: 0.6rem;
  padding: 0.7rem 0.85rem; cursor: pointer;
  border: 1px solid rgb(128 128 128 / 0.35); border-radius: 0.5rem;
}
.option.selected { border-color: currentColor; background: rgb(128 128 128 / 0.1); }
.option input { margin-top: 0.2rem; }
.option-label { font-weight: 600; min-width: 1.2rem; }

.quiz-nav { display: flex; justify-content: space-between; align-items: center; margin-top: 1.5rem; }
.quiz-saving { font-size: 0.78rem; opacity: 0.6; }

.review-grid h2 { font-size: 1.1rem; margin: 0 0 0.5rem; }
.review-warning { color: #9a6700; font-size: 0.875rem; }
.review-ok { color: #1a7f37; font-size: 0.875rem; }
.review-cells { display: flex; flex-wrap: wrap; gap: 0.4rem; margin: 1rem 0 1.25rem; }

.review-cell {
  width: 2.2rem; height: 2.2rem; cursor: pointer;
  border-radius: 0.4rem; border: 1px solid rgb(128 128 128 / 0.4); background: transparent; color: inherit;
}
.review-cell.answered { border-color: currentColor; background: rgb(128 128 128 / 0.15); }
.review-cell.blank { border-style: dashed; opacity: 0.6; }

button.primary { padding: 0.6rem 1rem; border-radius: 0.5rem; cursor: pointer; }
```

- [ ] **Step 7: Verify build and lint**

```bash
npm run build -w frontend && npm run lint -w frontend
```

Expected: build succeeds, eslint prints nothing.

- [ ] **Step 8: Verify manually**

With `npm run dev` running, open `/courses`, click Course 1. Expected: question 1 of 10 with four options and the module name. Select an answer — "Saving…" flashes. **Reload the page: your selection is still there.** Click through to Review; leave one blank and confirm the warning counts it. Submitting navigates to a results URL (which 404s until Task 14).

- [ ] **Step 9: Commit**

```bash
git add frontend/src/quiz/useQuizAttempt.ts frontend/src/quiz/QuestionCard.tsx \
        frontend/src/quiz/ReviewGrid.tsx frontend/src/pages/QuizPage.tsx \
        frontend/src/router.tsx frontend/src/App.css
git commit -m "feat(web): add the quiz page with autosave, navigation and review step"
```

---

### Task 14: Results page

**Files:**
- Create: `frontend/src/quiz/ResultsBreakdown.tsx`
- Create: `frontend/src/pages/ResultsPage.tsx`
- Modify: `frontend/src/router.tsx`, `frontend/src/App.css`

**Interfaces:**
- Consumes: `quizApi.getAttempt`, `GradedAttempt`, `GradedQuestion` from Task 12.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Create the breakdown component**

Create `frontend/src/quiz/ResultsBreakdown.tsx`:

```tsx
import { useState } from 'react';
import type { GradedQuestion } from './api';

function MissedQuestion({ question }: { question: GradedQuestion }) {
  const chosen = question.options.find((o) => o.id === question.selectedOptionId);
  const correct = question.options.find((o) => o.isCorrect)!;

  return (
    <li className="result-missed">
      <p className="result-q">
        ✕ {question.position}. {question.prompt}
      </p>
      <p className="result-line">
        {chosen ? (
          <>
            You chose <strong>{chosen.label}</strong> — {chosen.body}
          </>
        ) : (
          <em>You left this blank</em>
        )}
      </p>
      <p className="result-line">
        Correct is <strong>{correct.label}</strong> — {correct.body}
      </p>
      <p className="result-explanation">{question.explanation}</p>
      <span className="result-module">{question.moduleTitle}</span>
    </li>
  );
}

function CorrectQuestion({ question }: { question: GradedQuestion }) {
  const [open, setOpen] = useState(false);
  const chosen = question.options.find((o) => o.id === question.selectedOptionId);

  return (
    <li className="result-correct">
      <button type="button" className="result-toggle" onClick={() => setOpen(!open)}>
        <span>
          ✓ {question.position}. {question.prompt}
        </span>
        <span className="result-answer">{chosen?.label}</span>
      </button>
      {open && <p className="result-explanation">{question.explanation}</p>}
    </li>
  );
}

export function ResultsBreakdown({ questions }: { questions: GradedQuestion[] }) {
  return (
    <ul className="result-list">
      {questions.map((q) =>
        q.wasCorrect ? (
          <CorrectQuestion key={q.id} question={q} />
        ) : (
          <MissedQuestion key={q.id} question={q} />
        ),
      )}
    </ul>
  );
}
```

- [ ] **Step 2: Create the results page**

Create `frontend/src/pages/ResultsPage.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { quizApi, type GradedAttempt } from '../quiz/api';
import { ResultsBreakdown } from '../quiz/ResultsBreakdown';

export function ResultsPage() {
  const { slug = '', attemptId = '' } = useParams();
  const [attempt, setAttempt] = useState<GradedAttempt | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    quizApi
      .getAttempt(attemptId)
      .then(({ attempt }) => {
        if (cancelled) return;
        if (!('score' in attempt)) {
          setError('That attempt has not been submitted yet.');
          return;
        }
        setAttempt(attempt);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load the result');
      });
    return () => {
      cancelled = true;
    };
  }, [attemptId]);

  if (error) return <p role="alert" className="auth-error">{error}</p>;
  if (!attempt) return <div className="auth-loading">Loading result…</div>;

  const passed = attempt.score >= attempt.passScore;

  return (
    <div className="results-page">
      <div className="score-block">
        <div className="score-number">
          {attempt.score}
          <span className="score-of">/{attempt.questionCount}</span>
        </div>
        <p className={passed ? 'course-passed' : 'course-below'}>
          {passed
            ? `Target of ${attempt.passScore}/${attempt.questionCount} met`
            : `Target is ${attempt.passScore}/${attempt.questionCount} — not there yet`}
        </p>
        {attempt.previousBest !== null && (
          <p className="score-previous">Your previous best was {attempt.previousBest}</p>
        )}
      </div>

      {attempt.modulesToReview.length > 0 && (
        <div className="modules-block">
          <p className="label">Modules to review</p>
          <p>{attempt.modulesToReview.join(' · ')}</p>
        </div>
      )}

      <p className="label">All {attempt.questionCount} questions</p>
      <ResultsBreakdown questions={attempt.questions} />

      <div className="results-actions">
        <Link className="primary" to={`/courses/${slug}/quiz`}>
          Retake quiz
        </Link>
        <Link to="/courses">Back to courses</Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add the route**

Modify `frontend/src/router.tsx`:

```tsx
import { ResultsPage } from './pages/ResultsPage';

// inside <Routes>:
<Route
  path="/courses/:slug/results/:attemptId"
  element={
    <RequireAuth>
      <ResultsPage />
    </RequireAuth>
  }
/>
```

- [ ] **Step 4: Add styles**

Append to `frontend/src/App.css`:

```css
.results-page { max-width: 42rem; margin: 2rem auto; padding: 0 1.25rem; text-align: left; }

.score-block {
  text-align: center; padding: 1.25rem 0 1.5rem;
  border-bottom: 1px solid rgb(128 128 128 / 0.25); margin-bottom: 1.25rem;
}
.score-number { font-size: 2.6rem; font-weight: 700; line-height: 1; }
.score-of { font-size: 1.1rem; opacity: 0.6; }
.score-previous { font-size: 0.82rem; opacity: 0.7; margin: 0.25rem 0 0; }

.modules-block {
  padding: 0.85rem 1rem; margin-bottom: 1.5rem;
  border-radius: 0.5rem; background: rgb(128 128 128 / 0.1);
}

.label {
  font-size: 0.72rem; letter-spacing: 0.08em;
  text-transform: uppercase; opacity: 0.65; margin: 0 0 0.5rem;
}

.result-list { list-style: none; padding: 0; margin: 0; }

.result-missed {
  border-left: 3px solid #b3261e; padding: 0.6rem 0 0.6rem 0.75rem; margin: 0.6rem 0;
}
.result-q { font-weight: 600; font-size: 0.95rem; margin: 0 0 0.3rem; }
.result-line { font-size: 0.86rem; margin: 0 0 0.2rem; }
.result-explanation { font-size: 0.86rem; opacity: 0.85; margin: 0.35rem 0 0.4rem; }

.result-module {
  display: inline-block; padding: 0.15rem 0.5rem;
  font-size: 0.72rem; border-radius: 0.3rem; background: rgb(128 128 128 / 0.18);
}

.result-correct { border-bottom: 1px solid rgb(128 128 128 / 0.15); }
.result-toggle {
  width: 100%; display: flex; justify-content: space-between; gap: 1rem;
  padding: 0.5rem 0; background: none; border: none; cursor: pointer;
  color: inherit; font: inherit; font-size: 0.86rem; opacity: 0.7; text-align: left;
}
.result-answer { font-weight: 600; }

.results-actions { display: flex; gap: 1rem; align-items: center; margin-top: 1.75rem; }
.results-actions .primary {
  padding: 0.55rem 1rem; border-radius: 0.5rem;
  border: 1px solid currentColor; text-decoration: none; color: inherit;
}
```

- [ ] **Step 5: Verify build and lint**

```bash
npm run build -w frontend && npm run lint -w frontend
```

Expected: build succeeds, eslint prints nothing.

- [ ] **Step 6: Verify the whole flow manually**

With `npm run dev` running:

1. Sign in, open Course 1, answer all ten, submit.
2. Expected: results page with your score, a "Modules to review" line naming the modules behind your misses, and all ten questions — missed ones expanded with the correct answer and explanation, correct ones collapsed and clickable.
3. Click "Back to courses". Expected: Course 1 now shows "Best N/10".
4. Retake and score differently. Expected: the results page shows "Your previous best was N".
5. **Reload the results URL directly.** Expected: it renders — results are linkable.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/quiz/ResultsBreakdown.tsx frontend/src/pages/ResultsPage.tsx \
        frontend/src/router.tsx frontend/src/App.css
git commit -m "feat(web): add the graded results page with explanations and review modules"
```

---

### Task 15: Full verification and documentation

**Files:**
- Modify: `/Users/sam/Documents/agent-wiki/Projects/LIAH/LIAH Learning.md`
- Modify: `/Users/sam/Documents/agent-wiki/Home.md`
- Create: `/Users/sam/Documents/agent-wiki/Development Notes/Quiz Content Pipeline.md`

**Interfaces:**
- Consumes: the finished feature.
- Produces: nothing.

- [ ] **Step 1: Run the full backend suite**

```bash
cd /Users/sam/Projects/liah-wellness/liah-learning
npm test -w backend
```

Expected: `pass 37`, `fail 0`

- [ ] **Step 2: Typecheck and build everything**

```bash
npm run typecheck -w backend
npm run build -w backend
npm run build -w frontend
npm run lint -w frontend
```

Expected: all succeed, no output from typecheck or lint.

- [ ] **Step 3: Verify the seed is reproducible from a clean database**

```bash
docker exec liah-postgres psql -U liah -d liah_learning \
  -c "truncate table attempt_answers, attempts, question_options, questions, modules, courses, subjects cascade;"
npm run quiz:seed
docker exec liah-postgres psql -U liah -d liah_learning -c \
  "select (select count(*) from courses) courses, (select count(*) from questions) questions, (select count(*) from question_options) options;"
```

Expected: `11 | 110 | 440`

- [ ] **Step 4: Confirm no answer leak on the live server**

```bash
npm run dev &
sleep 8
curl -s -c /tmp/qjar -X POST http://localhost:5173/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"leakcheck@example.com","password":"test-password-123"}' > /dev/null
curl -s -b /tmp/qjar http://localhost:5173/api/courses/chassis-tire-and-rim-essentials/quiz \
  | grep -c -E 'isCorrect|explanation' || echo "no leak: 0 matches"
```

Expected: `no leak: 0 matches`

Then clean up: `docker exec liah-postgres psql -U liah -d liah_learning -c "delete from users where email='leakcheck@example.com';"` and stop the dev server.

- [ ] **Step 5: Update the project wiki note**

In `/Users/sam/Documents/agent-wiki/Projects/LIAH/LIAH Learning.md`, replace the `## Status` section with:

```markdown
## Status

Auth (httpOnly cookie sessions) and the interactive quiz both work end to end.
Chassis is seeded: 11 courses, 110 questions. The other seven subjects are one
`quiz:parse` + `quiz:seed` each — see [[Quiz Content Pipeline]].

Next: learning module content, and importing the remaining subjects.
```

- [ ] **Step 6: Write the pipeline how-to**

Create `/Users/sam/Documents/agent-wiki/Development Notes/Quiz Content Pipeline.md`:

```markdown
---
tags: [how-to, quiz, parsing]
created: 2026-11-02
project: "[[LIAH Learning]]"
---

# Quiz Content Pipeline

Turning a LIAH pop-quiz PDF into seeded quiz content. Two commands, with a
reviewable JSON file in between.

## Adding a subject

    npm run quiz:parse -w backend -- "$HOME/Documents/LIAH-classes/quizzes/Engine Pop Quizzes.pdf"
    # review the git diff on backend/src/data/engine.quiz.json
    npm run quiz:seed

Requires `pdftotext` (`brew install poppler`). The seed is idempotent.

## Why JSON sits in the middle

The PDFs live in `~/Documents`, outside the repo, so a parse-straight-to-database
pipeline would make them a hidden prerequisite for every clone and CI run.
Committing the parse also makes it reviewable as a diff and turns a parser
regression on an already-imported subject into a visible change.

## What the format guarantees

Verified against Chassis: 11 courses, 110 questions, four options each, one
answer-key entry per question with a written explanation and a module tag.

The parser asserts all of that and throws `QuizParseError` naming the course and
question number rather than emitting partial data.

## Extraction gotchas

- **Options never wrap.** Every continuation line is a wrapped module tag or page furniture.
- **Prompts and tags wrap three different ways** — tag entirely on the next line, prompt and
  tag both continuing, or a tag split mid-name (`[TREAD AND RIM` / `TECHNOLOGY]`). The parser
  joins lines until a complete `[...]` is present.
- **101 of 110 answer-key explanations wrap.** Joining is the norm, not an edge case.
- Module *display* names come from the `MODULES COVERED` list (title case); question tags are
  upper case and matched case-insensitively.
```

- [ ] **Step 7: Link it from Home**

In `/Users/sam/Documents/agent-wiki/Home.md`, add under `## How-tos`:

```markdown
- [[Quiz Content Pipeline]] — turning a LIAH pop-quiz PDF into seeded quiz content, and the PDF-extraction gotchas behind it.
```

- [ ] **Step 8: Commit and open a PR**

```bash
cd /Users/sam/Projects/liah-wellness/liah-learning
git add -A
git commit -m "docs: record quiz pipeline status"
git push -u origin feat/interactive-quiz
gh pr create --title "Interactive graded quiz (Chassis)" --body "$(cat <<'EOF'
Implements `docs/superpowers/specs/2026-11-02-interactive-quiz-design.md`.

A logged-in user picks a course, answers its ten-question quiz, and receives a
server-computed grade with per-question explanations and modules to review.

- PDF → committed JSON → idempotent seed. Chassis: 11 courses, 110 questions.
- Correct answers never leave the server before submission (asserted by test).
- Answers save as selected, so reloading mid-quiz restores progress.
- 37 backend tests: parser, seed idempotency, attempt lifecycle, grading,
  auth gating, cross-user isolation, answer-leak.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Spec coverage.** Every spec section maps to a task: content pipeline → 6, 7; data model → 5; API → 8–11; screens → 12–14; parser contract → 1–4; error handling → 9, 10, 11; testing → embedded throughout; documentation → 15.

**Two deliberate deviations from the spec, both narrowing:**

1. The spec listed `GET /api/courses/:slug/attempts` (attempt history). No screen in the approved design consumes it — the course list shows best score and attempt count, which Task 8 already provides. Dropped as YAGNI. Add it when a history screen exists.
2. The spec named `react-router-dom`; the correct modern package is `react-router@8`. `react-router-dom@7` is a legacy wrapper.

**One known gap:** there are no automated frontend tests. The spec's testing section lists only backend concerns, and adding vitest plus testing-library is a meaningful setup not covered by the approved design. Tasks 12–14 carry explicit manual verification steps instead. If you want this closed, it should be its own plan.
