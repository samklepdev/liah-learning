# Pass Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make pass state visible on the results page, at the top of a retake, and in the sidebar nav — always best-ever, never disappearing.

**Architecture:** One shared predicate, `hasPassed`, backs all four surfaces. The results page derives best-ever from data it already has (`score` + `previousBest`). The quiz page needs new data, delivered as a `history` sibling of `quiz` on the existing quiz response so the leak-guarded `Quiz` type stays free of per-user state. The sidebar needs no new data.

**Tech Stack:** Backend — Express 5, Drizzle ORM, Postgres 17, `node:test`. Frontend — React 19, TypeScript, Vite, Vitest + jsdom, @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-11-03-pass-visibility-design.md`

## Global Constraints

- Pass state is **best-ever, everywhere, and never disappears.** No surface may show a lower retake score in place of a better one, or revoke a badge.
- The retake banner carries **summary numbers only** — `bestScore`, `attemptCount`, `passScore`, `questionCount`. Never per-question data: `backend/src/controllers/quiz.controller.test.ts` asserts the raw quiz payload contains neither `isCorrect` nor `explanation`, and that test must keep passing **unmodified**.
- `findQuizByCourseSlug` keeps its current signature `(slug: string)` and takes no user argument. Per-user state is composed in the controller.
- `attemptCount` and `bestScore` count **submitted attempts only**, matching `listCoursesBySubject`.
- Do not add dependencies.
- Do not add attempt limiting, locking, or gating. Retakes stay unlimited.
- Backend commands run from `backend/`, frontend commands from `frontend/`.
- The Postgres container must be running for backend tests: `docker compose up -d` from the repo root. The compose service is named `postgres` (container `liah-postgres`), not `db`.

## File Structure

| File | Responsibility |
|---|---|
| `frontend/src/quiz/passed.ts` (create) | The pass rule, `hasPassed`. Nothing else. |
| `frontend/src/quiz/QuizHistoryBanner.tsx` (create) | The retake strip. `null` when `attemptCount === 0`. |
| `frontend/src/quiz/PassBadge.tsx` (modify) | Delegates to `hasPassed`. Markup unchanged. |
| `frontend/src/pages/SubjectCoursesPage.tsx` (modify) | Uses `hasPassed` for its score-colour ternary. |
| `frontend/src/pages/ResultsPage.tsx` (modify) | Best-ever headline, badge, "this attempt" line, breakdown heading. |
| `frontend/src/pages/QuizPage.tsx` (modify) | Renders the banner above the quiz header. |
| `frontend/src/shell/SidebarNav.tsx` (modify) | Tick on passed rows. |
| `frontend/src/quiz/useQuizAttempt.ts` (modify) | Threads `history` through. |
| `frontend/src/quiz/api.ts` (modify) | `CourseHistory` type; `getQuiz` return type. |
| `frontend/src/test/fixtures.ts` (modify) | `makeCourseHistory`. |
| `frontend/src/App.css` (modify) | `.quiz-history`, `.nav-sublink-pass`, score-block badge spacing. |
| `backend/src/models/attempt.model.ts` (modify) | `findCourseHistory`. |
| `backend/src/controllers/quiz.controller.ts` (modify) | Composes `{ quiz, history }`. |

Five tasks. Task 1 is the shared rule, Task 2 the results page, Task 3 the backend, Task 4 the retake banner (consumes Task 3), Task 5 the sidebar. Tasks 2 and 5 are independent of Tasks 3-4; a reviewer could reject the backend shape while accepting the results page.

---

### Task 1: The shared pass rule

**Files:**
- Create: `frontend/src/quiz/passed.ts`
- Create: `frontend/src/quiz/passed.test.ts`
- Modify: `frontend/src/quiz/PassBadge.tsx`
- Modify: `frontend/src/pages/SubjectCoursesPage.tsx:73-75`

**Interfaces:**
- Consumes: nothing.
- Produces: `hasPassed(bestScore: number | null, passScore: number): boolean`, exported from `frontend/src/quiz/passed.ts`. Tasks 2, 4 and 5 all import it.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/quiz/passed.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { hasPassed } from './passed';

describe('hasPassed', () => {
  test('is false below the target', () => {
    expect(hasPassed(8, 9)).toBe(false);
  });

  test('is true exactly at the target', () => {
    expect(hasPassed(9, 9)).toBe(true);
  });

  test('is true above the target', () => {
    expect(hasPassed(10, 9)).toBe(true);
  });

  // null means never attempted, which is not the same as scoring zero.
  test('is false when there is no score at all', () => {
    expect(hasPassed(null, 9)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd frontend && npx vitest run src/quiz/passed.test.ts
```

Expected: FAIL — `Failed to resolve import "./passed"`.

- [ ] **Step 3: Create the predicate**

Create `frontend/src/quiz/passed.ts`:

```ts
/**
 * Whether a course counts as passed. Takes the *best* score, never a single
 * attempt's: a weaker retake must not revoke a pass.
 *
 * `null` means never attempted, which is distinct from scoring zero.
 */
export function hasPassed(bestScore: number | null, passScore: number): boolean {
  return bestScore !== null && bestScore >= passScore;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd frontend && npx vitest run src/quiz/passed.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Route the two existing call sites through it**

In `frontend/src/quiz/PassBadge.tsx`, add the import at the top and replace the guard. The full file becomes:

```tsx
import { hasPassed } from './passed';

/**
 * A pass marker for a course row. Renders nothing unless the best score meets
 * the target, so callers never branch on the rule themselves.
 *
 * Pass state has to be readable as text, not just as green: the row's score
 * colour alone tells a colour-blind or screen-reader user nothing. The tick is
 * decorative and hidden, so assistive tech announces exactly "Passed".
 */
export function PassBadge({
  bestScore,
  passScore,
}: {
  bestScore: number | null;
  passScore: number;
}) {
  if (!hasPassed(bestScore, passScore)) return null;

  return (
    <span className="course-badge">
      <span aria-hidden="true">✓</span> Passed
    </span>
  );
}
```

In `frontend/src/pages/SubjectCoursesPage.tsx`, add after the `PassBadge` import on line 4:

```tsx
import { hasPassed } from '../quiz/passed';
```

and replace the score span's `className` expression:

```tsx
                <span
                  className={hasPassed(c.bestScore, c.passScore) ? 'course-passed' : 'course-below'}
                >
```

- [ ] **Step 6: Run the full suite, typecheck and lint**

```bash
cd frontend && npm test && npx tsc -b && npm run lint
```

Expected: all clean. 71 tests (67 existing + 4 new). The existing `SubjectCoursesPage` and `PassBadge` behaviour is unchanged, so no existing test should need editing — if one fails, the refactor changed behaviour and is wrong.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/quiz/passed.ts frontend/src/quiz/passed.test.ts \
        frontend/src/quiz/PassBadge.tsx frontend/src/pages/SubjectCoursesPage.tsx
git commit -m "refactor(web): extract the pass rule to one predicate

Four surfaces need to decide whether a course is passed. hasPassed takes
the best score, never a single attempt's, so the rule that a weaker
retake cannot revoke a pass lives in exactly one place."
```

---

### Task 2: Results page shows best-ever

**Files:**
- Modify: `frontend/src/pages/ResultsPage.tsx:58-86`
- Modify: `frontend/src/App.css` (append after `.score-previous`, line 192)
- Test: `frontend/src/pages/ResultsPage.test.tsx`

**Interfaces:**
- Consumes: `hasPassed(bestScore: number | null, passScore: number): boolean` from `frontend/src/quiz/passed.ts`; `PassBadge({ bestScore, passScore })` from `frontend/src/quiz/PassBadge.tsx`. The `GradedAttempt` type already carries `score: number`, `passScore: number`, `questionCount: number`, `previousBest: number | null`.
- Produces: nothing other tasks consume.

**Context the implementer needs:** `makeGradedAttempt()` in `frontend/src/test/fixtures.ts` defaults to `score: 2`, `questionCount: 3`, `passScore: 3`, `previousBest: null`. So the default fixture is a *failing* attempt with no history — best-ever equals 2 and nothing changes for it. `previousBest` excludes the attempt being viewed, which is why best-ever needs a `Math.max`.

- [ ] **Step 1: Rewrite the obsolete test and add the new ones**

In `frontend/src/pages/ResultsPage.test.tsx`, **replace** the existing test `'shows the previous best only when there is one'` (lines 53-61) with the four tests below. It is being replaced because the "Your previous best was N" line no longer exists — the headline now carries the best score, and the secondary line reports *this* attempt instead.

```tsx
  test('shows this attempt only when a better one exists', async () => {
    renderPage();
    await screen.findByText(/not there yet/);
    // Best-ever equals this attempt, so there is nothing to distinguish.
    expect(screen.queryByText(/This attempt/)).not.toBeInTheDocument();
  });

  test('keeps the badge when this attempt is below a target already met', async () => {
    getAttempt.mockResolvedValue({
      attempt: makeGradedAttempt({ score: 2, previousBest: 3 }),
    });
    renderPage();

    expect(await screen.findByText('Passed')).toBeInTheDocument();
    expect(screen.getByText(/Target of 3\/3 met/)).toBeInTheDocument();
    expect(screen.getByText('This attempt: 2/3')).toBeInTheDocument();
  });

  test('headlines the best score, not a weaker retake', async () => {
    getAttempt.mockResolvedValue({
      attempt: makeGradedAttempt({ score: 2, previousBest: 3 }),
    });
    renderPage();

    const block = (await screen.findByText(/Target of/)).closest('.score-block');
    expect(block).not.toBeNull();
    // The headline reads 3, not the 2 scored on this attempt.
    expect(within(block as HTMLElement).getByText('3')).toBeInTheDocument();
    expect(within(block as HTMLElement).queryByText('2')).not.toBeInTheDocument();
  });

  test('shows the badge for a passing attempt', async () => {
    getAttempt.mockResolvedValue({
      attempt: makeGradedAttempt({ score: 3, modulesToReview: [] }),
    });
    renderPage();

    expect(await screen.findByText('Passed')).toBeInTheDocument();
  });
```

`within` is already imported on line 2 of that file. No other import changes are needed.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd frontend && npx vitest run src/pages/ResultsPage.test.tsx
```

Expected: 3 failures. `'keeps the badge when this attempt is below a target already met'` fails with `Unable to find an element with the text: Passed`; `'headlines the best score, not a weaker retake'` fails because the headline still reads 2; `'shows the badge for a passing attempt'` fails on the missing badge. `'shows this attempt only when a better one exists'` passes already — no such line exists yet — and is a guard for Step 3's conditional.

- [ ] **Step 3: Rewrite the score block**

In `frontend/src/pages/ResultsPage.tsx`, add these imports after the existing `ResultsBreakdown` import on line 4:

```tsx
import { PassBadge } from '../quiz/PassBadge';
import { hasPassed } from '../quiz/passed';
```

Replace lines 58-76 (from `const { attempt } = current;` through the closing `</div>` of the score block) with:

```tsx
  const { attempt } = current;
  // Best-ever, so a weaker retake never replaces a better number nor revokes
  // the badge. previousBest excludes the attempt being viewed, hence the max.
  const bestScore = Math.max(attempt.score, attempt.previousBest ?? attempt.score);
  const passed = hasPassed(bestScore, attempt.passScore);

  return (
    <div className="results-page">
      <div className="score-block">
        <div className="score-number">
          {bestScore}
          <span className="score-of">/{attempt.questionCount}</span>
        </div>
        <PassBadge bestScore={bestScore} passScore={attempt.passScore} />
        <p className={passed ? 'course-passed' : 'course-below'}>
          {passed
            ? `Target of ${attempt.passScore}/${attempt.questionCount} met`
            : `Target is ${attempt.passScore}/${attempt.questionCount} — not there yet`}
        </p>
        {/* Only when it differs from the headline, so a first attempt shows no
            redundant line. */}
        {bestScore > attempt.score && (
          <p className="score-previous">
            This attempt: {attempt.score}/{attempt.questionCount}
          </p>
        )}
      </div>
```

Then change the breakdown heading on what was line 85, so the headline figure and the per-question list are not read as the same thing:

```tsx
      <p className="label">All {attempt.questionCount} questions from this attempt</p>
```

- [ ] **Step 4: Centre the badge in the score block**

In `frontend/src/App.css`, immediately after `.score-previous` (line 192), add:

```css
/* The row-level badge carries a right margin for inline use; inside the
   centred score block that would knock it off centre. */
.score-block .course-badge { margin: 0.4rem 0 0; }
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd frontend && npx vitest run src/pages/ResultsPage.test.tsx
```

Expected: PASS, 13 tests.

- [ ] **Step 6: Run the full suite, typecheck and lint**

```bash
cd frontend && npm test && npx tsc -b && npm run lint
```

Expected: all clean, 75 tests.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/ResultsPage.tsx frontend/src/pages/ResultsPage.test.tsx \
        frontend/src/App.css
git commit -m "feat(web): headline the best score on the results page

A weaker retake replaced a better number and dropped the pass marker.
The headline and badge now read best-ever; the attempt in front of you
gets its own line, and the breakdown heading says which attempt it is.

The route is still per-attempt, so two attempts on one course show the
same headline — the explicit \"this attempt\" labelling is what keeps
that honest."
```

---

### Task 3: Per-course history on the quiz response

**Files:**
- Modify: `backend/src/models/attempt.model.ts` (append after `findBestScoreBefore`)
- Modify: `backend/src/controllers/quiz.controller.ts`
- Test: `backend/src/controllers/quiz.controller.test.ts`

**Interfaces:**
- Consumes: the Drizzle `attempts` table from `backend/src/models/schema.ts`, already imported in `attempt.model.ts`. `count`, `eq`, `and`, `max`, `isNotNull`, `isNull` are all already imported there too.
- Produces: `findCourseHistory(userId: string, courseId: string): Promise<{ bestScore: number | null; attemptCount: number }>` from `backend/src/models/attempt.model.ts`. The HTTP response shape `{ quiz, history }` is what Task 4 consumes.

**Context the implementer needs:** `backend/src/controllers/quiz.controller.test.ts` already has `baseUrl`, `cookie` and `SLUG` set up in a `before` hook, seeding the Chassis subject. The first three tests in that file are read-only. The new tests below mutate state (they create attempts), so they must be appended **at the end** of the file and they run in order — `node:test` is sequential within a file and `backend/package.json` sets `--test-concurrency=1`. The ordering matters: the "no history" assertion must run before any attempt exists.

- [ ] **Step 1: Write the failing tests**

Append to `backend/src/controllers/quiz.controller.test.ts`. Add `registerTestUser` to the existing import from `../test/helpers/server.ts` if it is not already there — it is, on line 5.

```ts
/** The quiz payload's per-user history block. */
async function fetchHistory(sessionCookie: string) {
  const res = await fetch(`${baseUrl}/api/courses/${SLUG}/quiz`, {
    headers: { cookie: sessionCookie },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { history: Record<string, unknown> };
  return body.history;
}

/** Starts an attempt and returns its id. Answers nothing, so it scores zero. */
async function startAttempt(sessionCookie: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/courses/${SLUG}/attempts`, {
    method: 'POST',
    headers: { cookie: sessionCookie },
  });
  const { attempt } = (await res.json()) as { attempt: { id: string } };
  return attempt.id;
}

test('GET quiz reports no history before the first attempt', async () => {
  assert.deepEqual(await fetchHistory(cookie), { bestScore: null, attemptCount: 0 });
});

test('GET quiz counts a submitted attempt in the history', async () => {
  const id = await startAttempt(cookie);
  const res = await fetch(`${baseUrl}/api/attempts/${id}/submit`, {
    method: 'POST',
    headers: { cookie },
  });
  assert.equal(res.status, 200);

  // Nothing was answered, so the score is a genuine zero — distinct from the
  // null above, which means "never attempted".
  assert.deepEqual(await fetchHistory(cookie), { bestScore: 0, attemptCount: 1 });
});

test('GET quiz does not count an attempt still in progress', async () => {
  await startAttempt(cookie);
  assert.deepEqual(await fetchHistory(cookie), { bestScore: 0, attemptCount: 1 });
});

test("GET quiz does not leak another user's history", async () => {
  const { cookie: otherCookie } = await registerTestUser(baseUrl, 'quiz-other@example.com');
  assert.deepEqual(await fetchHistory(otherCookie), { bestScore: null, attemptCount: 0 });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Make sure Postgres is up first:

```bash
docker compose up -d
cd backend && npm test
```

Expected: 4 failures, all of the form `AssertionError: Expected values to be strictly deep-equal` with `actual: undefined` — the response has no `history` key yet.

- [ ] **Step 3: Add the model function**

In `backend/src/models/attempt.model.ts`, add after `findBestScoreBefore`:

```ts
/**
 * The caller's record on one course: best submitted score and how many
 * submissions. Submitted attempts only, matching listCoursesBySubject — an
 * attempt still open is not a result yet and must not inflate the count.
 *
 * bestScore is null for a course never submitted, which callers must not
 * conflate with a score of zero.
 */
export async function findCourseHistory(
  userId: string,
  courseId: string,
): Promise<{ bestScore: number | null; attemptCount: number }> {
  const [row] = await db
    .select({ best: max(attempts.score), submitted: count(attempts.id) })
    .from(attempts)
    .where(
      and(
        eq(attempts.userId, userId),
        eq(attempts.courseId, courseId),
        isNotNull(attempts.submittedAt),
      ),
    );

  return {
    bestScore: row?.best === null || row?.best === undefined ? null : Number(row.best),
    attemptCount: Number(row?.submitted ?? 0),
  };
}
```

- [ ] **Step 4: Compose the response in the controller**

Replace the whole of `backend/src/controllers/quiz.controller.ts` with:

```ts
import type { Request, Response } from 'express';
import { param } from '../lib/http.ts';
import { findCourseHistory } from '../models/attempt.model.ts';
import { findQuizByCourseSlug } from '../models/quiz.model.ts';

export async function getQuiz(req: Request, res: Response): Promise<void> {
  const quiz = await findQuizByCourseSlug(param(req, 'slug'));
  if (!quiz) {
    res.status(404).json({ error: 'Course not found' });
    return;
  }

  // History rides alongside the quiz rather than inside it: the quiz payload is
  // guarded by a leak test and must stay free of per-user state. The route is
  // requireAuth, so req.user is always present here.
  const history = await findCourseHistory(req.user!.id, quiz.courseId);

  res.json({ quiz, history });
}
```

- [ ] **Step 5: Run the backend suite**

```bash
cd backend && npm test
```

Expected: PASS, 46 tests, 0 failures. In particular `GET quiz never leaks correct answers or explanations` must still pass **without having been edited** — `history` adds only numbers, so neither `isCorrect` nor `explanation` appears in the payload.

- [ ] **Step 6: Commit**

```bash
git add backend/src/models/attempt.model.ts backend/src/controllers/quiz.controller.ts \
        backend/src/controllers/quiz.controller.test.ts
git commit -m "feat(api): return the caller's course history with the quiz

The retake banner needs best score and attempt count. They ride beside
the quiz rather than inside it, so the payload the leak test guards stays
free of per-user state and findQuizByCourseSlug stays a pure content
query.

Submitted attempts only: an attempt still open is not a result."
```

---

### Task 4: Retake banner on the quiz page

**Files:**
- Create: `frontend/src/quiz/QuizHistoryBanner.tsx`
- Modify: `frontend/src/quiz/api.ts:59` (add `CourseHistory`, widen `getQuiz`)
- Modify: `frontend/src/quiz/useQuizAttempt.ts`
- Modify: `frontend/src/pages/QuizPage.tsx`
- Modify: `frontend/src/test/fixtures.ts`
- Modify: `frontend/src/App.css`
- Test: `frontend/src/pages/QuizPage.test.tsx`, `frontend/src/quiz/useQuizAttempt.test.ts`

**Interfaces:**
- Consumes: `{ quiz, history }` from `GET /api/courses/:slug/quiz` where `history` is `{ bestScore: number | null; attemptCount: number }` (Task 3). `hasPassed` from `frontend/src/quiz/passed.ts` (Task 1), used indirectly via `PassBadge`.
- Produces: `CourseHistory` type and `makeCourseHistory` fixture, both consumed only within this task.

**Context the implementer needs:** two existing test files mock `getQuiz` as `{ quiz }` with no history — `frontend/src/pages/QuizPage.test.tsx:32` and `frontend/src/quiz/useQuizAttempt.test.ts:31`. Both must be updated in Step 1, or the banner will read `undefined`. No defensive default is added in the hook: the API always returns `history`, the type says so, and a silent fallback would hide a real backend regression. `makeQuiz()` defaults to `passScore: 3`, `questionCount: 3`.

- [ ] **Step 1: Write the failing tests**

First add the fixture. In `frontend/src/test/fixtures.ts`, add `CourseHistory` to the type import at the top and append this function:

```ts
export function makeCourseHistory(
  overrides: Partial<CourseHistory> = {},
): CourseHistory {
  return { bestScore: null, attemptCount: 0, ...overrides };
}
```

The import on line 1 becomes:

```ts
import type {
  CourseHistory,
  CourseSummary,
  GradedAttempt,
  GradedQuestion,
  Quiz,
  QuizQuestion,
} from '../quiz/api';
```

In `frontend/src/quiz/useQuizAttempt.test.ts`, change line 3's import to add the fixture and line 31's mock:

```ts
import { makeCourseHistory, makeQuiz } from '../test/fixtures';
```

```ts
  getQuiz.mockResolvedValue({ quiz, history: makeCourseHistory() });
```

In `frontend/src/pages/QuizPage.test.tsx`, change line 5's import and line 32's mock the same way:

```tsx
import { makeCourseHistory, makeQuiz } from '../test/fixtures';
```

```tsx
  getQuiz.mockResolvedValue({ quiz, history: makeCourseHistory() });
```

Then append these three tests inside the existing `describe('QuizPage', ...)` block:

```tsx
  test('shows no history banner on a first attempt', async () => {
    renderPage();
    await screen.findByText('Question 1 of 3');

    expect(screen.queryByText(/Best /)).not.toBeInTheDocument();
  });

  test('shows the best score and badge when retaking a passed quiz', async () => {
    getQuiz.mockResolvedValue({
      quiz,
      history: makeCourseHistory({ bestScore: 3, attemptCount: 2 }),
    });
    renderPage();

    expect(await screen.findByText('Passed')).toBeInTheDocument();
    expect(screen.getByText('Best 3/3 · 2 attempts')).toBeInTheDocument();
  });

  test('shows the best score without a badge when the quiz is not yet passed', async () => {
    getQuiz.mockResolvedValue({
      quiz,
      history: makeCourseHistory({ bestScore: 2, attemptCount: 1 }),
    });
    renderPage();

    expect(await screen.findByText('Best 2/3 · 1 attempt')).toBeInTheDocument();
    expect(screen.queryByText('Passed')).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd frontend && npx vitest run src/pages/QuizPage.test.tsx
```

Expected: 2 failures — `'shows the best score and badge when retaking a passed quiz'` and `'shows the best score without a badge...'` both fail with `Unable to find an element with the text`. `'shows no history banner on a first attempt'` passes already and guards the `attemptCount === 0` branch.

- [ ] **Step 3: Add the API type**

In `frontend/src/quiz/api.ts`, add above `export type GradedAttempt` (line 59):

```ts
/** The caller's record on one course. bestScore is null when never submitted. */
export type CourseHistory = {
  bestScore: number | null;
  attemptCount: number;
};
```

and change the `getQuiz` method (line 103) to:

```ts
  getQuiz: (slug: string) =>
    request<{ quiz: Quiz; history: CourseHistory }>(`/courses/${slug}/quiz`),
```

- [ ] **Step 4: Create the banner**

Create `frontend/src/quiz/QuizHistoryBanner.tsx`:

```tsx
import { PassBadge } from './PassBadge';

/**
 * Your record on this course, shown above a retake. Renders nothing before the
 * first submission, so a first attempt is not cluttered by an empty record.
 *
 * Summary numbers only — never per-question history. The quiz payload
 * deliberately carries no answer key, and showing a previous attempt's
 * breakdown here would hand it over mid-retake.
 */
export function QuizHistoryBanner({
  bestScore,
  attemptCount,
  passScore,
  questionCount,
}: {
  bestScore: number | null;
  attemptCount: number;
  passScore: number;
  questionCount: number;
}) {
  if (attemptCount === 0) return null;

  return (
    <div className="quiz-history">
      <PassBadge bestScore={bestScore} passScore={passScore} />
      <span>
        Best {bestScore}/{questionCount} · {attemptCount}{' '}
        {attemptCount === 1 ? 'attempt' : 'attempts'}
      </span>
    </div>
  );
}
```

- [ ] **Step 5: Thread history through the hook**

In `frontend/src/quiz/useQuizAttempt.ts`, make four edits.

Add `CourseHistory` to the type import on line 2:

```ts
import { quizApi, type CourseHistory, type GradedAttempt, type OpenAttempt, type Quiz } from './api';
```

Add `history` to the `ready` variant of `LoadState` (after `quiz: Quiz;` on line 15):

```ts
      history: CourseHistory;
```

Add it to the exported state type (after `quiz: Quiz | null;` on line 24):

```ts
  history: CourseHistory | null;
```

In the effect, destructure and store it — line 62's `const [{ quiz }, ...]` becomes `const [{ quiz, history }, ...]`, and the `setState` call gains `history,` next to `quiz,`:

```ts
        const [{ quiz, history }, { attempt }] = await Promise.all([
          quizApi.getQuiz(slug),
          quizApi.startAttempt(slug),
        ]);
```

```ts
        setState({
          kind: 'ready',
          slug,
          quiz,
          history,
          attemptId: attempt.id,
```

And in the returned object, after the `quiz:` line:

```ts
    history: current?.kind === 'ready' ? current.history : null,
```

- [ ] **Step 6: Render the banner**

In `frontend/src/pages/QuizPage.tsx`, add the import after line 4:

```tsx
import { QuizHistoryBanner } from '../quiz/QuizHistoryBanner';
```

Change the destructure on line 27 to pull `history` out:

```tsx
  const { quiz, index, answers, history } = state;
```

and render it as the first child of `.quiz-page`, above the header:

```tsx
    <div className="quiz-page">
      {history && (
        <QuizHistoryBanner
          bestScore={history.bestScore}
          attemptCount={history.attemptCount}
          passScore={quiz.passScore}
          questionCount={quiz.questionCount}
        />
      )}

      <div className="quiz-header">
```

- [ ] **Step 7: Style the banner**

In `frontend/src/App.css`, add immediately after the `.quiz-header` rule (which ends on line 136):

```css
.quiz-history {
  display: flex;
  align-items: center;
  gap: 0.15rem;
  margin-bottom: 0.75rem;
  padding: 0.5rem 0.75rem;
  border-radius: 0.5rem;
  background: var(--accent-bg);
  font-size: 0.8rem;
}
```

- [ ] **Step 8: Run the tests to verify they pass**

```bash
cd frontend && npx vitest run src/pages/QuizPage.test.tsx src/quiz/useQuizAttempt.test.ts
```

Expected: PASS. If `useQuizAttempt.test.ts` fails on a missing `history`, the Step 1 mock update was missed.

- [ ] **Step 9: Run the full suite, typecheck and lint**

```bash
cd frontend && npm test && npx tsc -b && npm run lint
```

Expected: all clean, 78 tests.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/quiz/QuizHistoryBanner.tsx frontend/src/quiz/api.ts \
        frontend/src/quiz/useQuizAttempt.ts frontend/src/pages/QuizPage.tsx \
        frontend/src/pages/QuizPage.test.tsx frontend/src/quiz/useQuizAttempt.test.ts \
        frontend/src/test/fixtures.ts frontend/src/App.css
git commit -m "feat(web): show your record above a retake

Starting a quiz you have already taken gave no sign you had passed it.
The banner carries best score, attempt count and the badge — summary
numbers only, so the answer key stays out of the quiz payload.

Hidden entirely on a first attempt, which has no record to show."
```

---

### Task 5: Pass tick in the sidebar

**Files:**
- Modify: `frontend/src/shell/SidebarNav.tsx:50-64`
- Modify: `frontend/src/App.css` (append after `.nav-sublink-pos`, line 435)
- Test: `frontend/src/shell/AppShell.test.tsx`

**Interfaces:**
- Consumes: `hasPassed(bestScore: number | null, passScore: number): boolean` from `frontend/src/quiz/passed.ts` (Task 1). `nav.courses[slug]` is already `CourseSummary[]`, carrying `bestScore` and `passScore`.
- Produces: nothing.

**Context the implementer needs:** `AppShell.test.tsx` mocks `listCourses` in a `beforeEach` (line 60) returning two courses from `makeCourse()`, whose default `bestScore` is `null` — so by default no tick renders. `nav()` on line 55 is a helper returning the sidebar by its `navigation` role with accessible name `Subjects`. Adding the tick inside the `NavLink` extends that link's accessible name to end with "Passed", but every existing assertion uses a regex (`/Tire and Rim Essentials/`), so none breaks.

- [ ] **Step 1: Write the failing test**

Append to the `describe('AppShell — subject disclosure', ...)` block in `frontend/src/shell/AppShell.test.tsx`:

```tsx
  test('ticks the quizzes you have passed', async () => {
    listCourses.mockResolvedValue({
      courses: [
        makeCourse({ bestScore: 9 }),
        makeCourse({ id: 'c2', slug: 'chassis-fitment', title: 'Tire Fitment', position: 2 }),
      ],
    });
    renderAt();
    const sidebar = await nav();

    await userEvent.click(within(sidebar).getByRole('button', { name: /Chassis/ }));

    // One tick, on the passed quiz only. Labelled, so it is not a
    // glyph-and-colour-only signal.
    const ticks = await within(sidebar).findAllByRole('img', { name: 'Passed' });
    expect(ticks).toHaveLength(1);
    expect(
      within(sidebar).getByRole('link', { name: /Tire and Rim Essentials/ }),
    ).toContainElement(ticks[0]!);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd frontend && npx vitest run src/shell/AppShell.test.tsx
```

Expected: FAIL — `Unable to find an accessible element with the role "img" and name "Passed"`.

- [ ] **Step 3: Render the tick**

In `frontend/src/shell/SidebarNav.tsx`, add the import after line 4:

```tsx
import { hasPassed } from '../quiz/passed';
```

and add the tick inside the `NavLink`, after the title span:

```tsx
              <span className="nav-sublink-pos">{c.position}</span>
              <span>{c.title}</span>
              {hasPassed(c.bestScore, c.passScore) && (
                <span className="nav-sublink-pass" role="img" aria-label="Passed">
                  ✓
                </span>
              )}
```

- [ ] **Step 4: Style the tick**

In `frontend/src/App.css`, add immediately after `.nav-sublink-pos` (line 435):

```css
/* margin-left:auto pushes the tick to the row's end; .nav-sublink is a flex
   row, so this needs no fixed width and tolerates long titles. */
.nav-sublink-pass { margin-left: auto; color: var(--success); }
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd frontend && npx vitest run src/shell/AppShell.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Run the full suite, typecheck and lint**

```bash
cd frontend && npm test && npx tsc -b && npm run lint
```

Expected: all clean, 79 tests.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/shell/SidebarNav.tsx frontend/src/shell/AppShell.test.tsx \
        frontend/src/App.css
git commit -m "feat(web): tick the passed quizzes in the sidebar

The sidebar is the fastest way to see where you are across a subject,
and it showed no pass state at all. A labelled tick keeps the narrow row
intact and still reads as \"Passed\" to a screen reader."
```

---

## Self-Review

**1. Spec coverage**

| Spec requirement | Task |
|---|---|
| `hasPassed` in `frontend/src/quiz/passed.ts`, four consumers | Task 1 (rule + 2 consumers), Tasks 2, 5 (remaining 2, via `PassBadge` and directly) |
| De-duplicate the existing inline pass expressions | Task 1, Step 5 |
| Results page: best-ever headline | Task 2, Step 3 |
| Results page: badge | Task 2, Step 3 |
| Results page: "This attempt: N/M" only when best exceeds it | Task 2, Step 3 |
| Results page: breakdown heading says "from this attempt" | Task 2, Step 3 |
| `findCourseHistory`, submitted attempts only | Task 3, Step 3 |
| `{ quiz, history }`; `findQuizByCourseSlug` signature unchanged | Task 3, Step 4 |
| Retake banner, summary only | Task 4, Step 4 |
| Banner hidden when `attemptCount === 0` | Task 4, Step 4 |
| `useQuizAttempt` threads `history` | Task 4, Step 5 |
| Sidebar tick with `aria-label="Passed"` | Task 5, Step 3 |
| Test 1 (history on response) | Task 3, Step 1 |
| Test 2 (another user's attempts excluded) | Task 3, Step 1 |
| Test 3 (unsubmitted attempt excluded) | Task 3, Step 1 |
| Test 4 (leak test unchanged) | Task 3, Steps 1 and 5 — stated as "must pass unmodified" |
| Test 5 (`hasPassed` boundaries) | Task 1, Step 1 |
| Test 6 (badge on a passing attempt) | Task 2, Step 1 |
| Test 7 (badge survives a weaker retake) | Task 2, Step 1 |
| Test 8 (headline is best-ever) | Task 2, Step 1 |
| Test 9 ("This attempt" conditional) | Task 2, Step 1 |
| Test 10 (banner absent on first attempt) | Task 4, Step 1 |
| Test 11 (banner with badge) | Task 4, Step 1 |
| Test 12 (banner without badge) | Task 4, Step 1 |
| Test 13 (sidebar tick present/absent) | Task 5, Step 1 |

All 13 spec test cases and every surface are covered. No gaps.

**2. Placeholder scan**

No TBDs, no "handle edge cases", no "similar to Task N", no test steps without test code. Every code step carries complete code. Two steps note that an added test passes immediately and say why (Task 2 Step 2, Task 4 Step 2) rather than overstating the red.

**3. Type consistency**

- `hasPassed(bestScore: number | null, passScore: number): boolean` — defined Task 1 Step 3, consumed with that signature in Task 1 Step 5, Task 2 Step 3, Task 5 Step 3.
- `findCourseHistory(userId, courseId) → { bestScore: number | null; attemptCount: number }` — defined Task 3 Step 3, called in Task 3 Step 4.
- `CourseHistory` — the frontend type (Task 4 Step 3) has exactly the two fields the backend returns (Task 3 Step 3).
- `QuizHistoryBanner` props `bestScore`, `attemptCount`, `passScore`, `questionCount` — declared Task 4 Step 4, passed in that order in Task 4 Step 6.
- `makeCourseHistory(overrides?: Partial<CourseHistory>): CourseHistory` — added Task 4 Step 1, used in the same step's mocks and tests.
- CSS classes `course-badge` (existing), `quiz-history` (Task 4 Step 7), `nav-sublink-pass` (Task 5 Step 4) each defined exactly where first used.

**Running test counts** assume 67 passing before Task 1 and add 4, 4, 3, 1 across Tasks 1, 2, 4, 5 — Task 2 replaces one test with four, a net of +3, giving 71 → 75 → 78 → 79. Backend goes 42 → 46. If a count is off by a little, trust the suite over this plan; the counts are a sanity check, not an assertion.
