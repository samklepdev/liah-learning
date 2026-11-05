# My Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a signed-in learner a page that lists every course they've completed at least one quiz for, with their best score, attempt count, and a link back into the detailed results of their most recent attempt.

**Architecture:** One new read-only endpoint, `GET /api/me/progress`, scoped to the caller via `req.user!.id`, aggregating the existing `attempts` table per course. One new frontend page (`ProgressPage`) consuming it, reachable via a new `/progress` route and a new sidebar link.

**Tech Stack:** Express 5 + Drizzle ORM (backend), React 19 + react-router (frontend), `node:test` (backend tests), Vitest + Testing Library (frontend tests).

## Global Constraints

- Backend models/controllers/routes use `.ts` extensions in imports (ESM + tsx), matching every existing file in `backend/src`.
- Frontend API client functions go through the existing `request<T>()` helper in `frontend/src/quiz/api.ts` — no new fetch wrapper.
- Reuse the existing `admin-table` CSS class for any new table; do not add new CSS unless the existing classes are insufficient.
- Follow existing test conventions exactly: backend route/model behavior is tested through real HTTP requests against a test server (see `backend/src/controllers/grading.test.ts`), not through mocked DB calls. Frontend page components are tested by mocking `../quiz/api`, not the network.

---

### Task 1: Backend — `GET /me/progress` endpoint

**Files:**
- Modify: `backend/src/models/attempt.model.ts`
- Modify: `backend/src/controllers/attempt.controller.ts`
- Modify: `backend/src/routes/quiz.routes.ts`
- Test: `backend/src/controllers/progress.test.ts` (new)

**Interfaces:**
- Consumes: `db`, `attempts`, `courses`, `subjects` from `backend/src/models/schema.ts` (already imported in `attempt.model.ts`); `requireAuth` from `backend/src/middleware/auth.middleware.ts` (already imported in `quiz.routes.ts`).
- Produces: `ProgressRow` type and `findMyProgress(userId: string): Promise<ProgressRow[]>` in `attempt.model.ts`, consumed by Task 1's own controller only. `GET /api/me/progress` — requires a session; returns `{ courses: ProgressRow[] }` with dates serialized to ISO strings by `res.json`.

- [ ] **Step 1: Write the failing test file**

Create `backend/src/controllers/progress.test.ts`:

```ts
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resetDb, closeDb } from '../test/helpers/db.ts';
import { startTestServer, registerTestUser } from '../test/helpers/server.ts';
import { seedSubject } from '../scripts/seed-quizzes.ts';
import type { ParsedCourse, ParsedSubject } from '../lib/quiz-parser.ts';

const subject: ParsedSubject = JSON.parse(
  readFileSync(new URL('../data/chassis.quiz.json', import.meta.url), 'utf8'),
);
const SLUG_1 = 'chassis-tire-and-rim-essentials';
const SLUG_2 = 'chassis-best-practice-tire-fitment';
const course1 = subject.courses.find((c) => c.slug === SLUG_1)!;
const course2 = subject.courses.find((c) => c.slug === SLUG_2)!;

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

/** Answers `correctCount` questions correctly and the rest wrong, then submits. */
async function takeQuiz(
  sessionCookie: string,
  slug: string,
  course: ParsedCourse,
  correctCount: number,
): Promise<{ id: string; score: number }> {
  const quizRes = await fetch(`${baseUrl}/api/courses/${slug}/quiz`, {
    headers: { cookie: sessionCookie },
  });
  const { quiz } = (await quizRes.json()) as any;

  const startRes = await fetch(`${baseUrl}/api/courses/${slug}/attempts`, {
    method: 'POST',
    headers: { cookie: sessionCookie },
  });
  const { attempt } = (await startRes.json()) as any;

  for (const [i, q] of quiz.questions.entries()) {
    const expected = course.questions.find((x) => x.position === q.position)!;
    const correctLabel = expected.options.find((o) => o.isCorrect)!.label;
    const label = i < correctCount ? correctLabel : correctLabel === 'A' ? 'B' : 'A';
    const option = q.options.find((o: any) => o.label === label);

    await fetch(`${baseUrl}/api/attempts/${attempt.id}/answers/${q.id}`, {
      method: 'PUT',
      headers: { cookie: sessionCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ optionId: option.id }),
    });
  }

  const submitRes = await fetch(`${baseUrl}/api/attempts/${attempt.id}/submit`, {
    method: 'POST',
    headers: { cookie: sessionCookie },
  });
  const { attempt: graded } = (await submitRes.json()) as any;
  return { id: attempt.id, score: graded.score };
}

test('GET /me/progress requires a session', async () => {
  const res = await fetch(`${baseUrl}/api/me/progress`);
  assert.equal(res.status, 401);
});

test('an unattempted account sees an empty list', async () => {
  const { cookie } = await registerTestUser(baseUrl, 'fresh@example.com');
  const res = await fetch(`${baseUrl}/api/me/progress`, { headers: { cookie } });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { courses: unknown[] };
  assert.deepEqual(body.courses, []);
});

test('tracks best score and attempt count independently of the most recent attempt', async () => {
  const { cookie } = await registerTestUser(baseUrl, 'retaker@example.com');

  await takeQuiz(cookie, SLUG_1, course1, 8);
  const second = await takeQuiz(cookie, SLUG_1, course1, 5);

  const res = await fetch(`${baseUrl}/api/me/progress`, { headers: { cookie } });
  const body = (await res.json()) as { courses: any[] };
  assert.equal(body.courses.length, 1);
  const row = body.courses[0];
  assert.equal(row.courseSlug, SLUG_1);
  assert.equal(row.subjectSlug, 'chassis');
  assert.equal(row.bestScore, 8, 'best score must survive a worse retake');
  assert.equal(row.attemptCount, 2);
  assert.equal(row.lastAttemptId, second.id, 'last attempt must be the most recent submission');
});

test('lists multiple courses, newest completion first', async () => {
  const { cookie } = await registerTestUser(baseUrl, 'multi@example.com');

  await takeQuiz(cookie, SLUG_1, course1, 6);
  await takeQuiz(cookie, SLUG_2, course2, 9);

  const res = await fetch(`${baseUrl}/api/me/progress`, { headers: { cookie } });
  const body = (await res.json()) as { courses: any[] };
  assert.equal(body.courses.length, 2);
  assert.equal(body.courses[0].courseSlug, SLUG_2, 'most recently completed course comes first');
  assert.equal(body.courses[1].courseSlug, SLUG_1);
});

test("one user's progress never includes another user's attempts", async () => {
  const mine = await registerTestUser(baseUrl, 'mine@example.com');
  const other = await registerTestUser(baseUrl, 'other@example.com');

  await takeQuiz(other.cookie, SLUG_1, course1, 7);

  const res = await fetch(`${baseUrl}/api/me/progress`, { headers: { cookie: mine.cookie } });
  const body = (await res.json()) as { courses: unknown[] };
  assert.deepEqual(body.courses, []);
});

test('an open, unsubmitted attempt does not appear', async () => {
  const { cookie } = await registerTestUser(baseUrl, 'inprogress@example.com');

  await fetch(`${baseUrl}/api/courses/${SLUG_1}/attempts`, {
    method: 'POST',
    headers: { cookie },
  });

  const res = await fetch(`${baseUrl}/api/me/progress`, { headers: { cookie } });
  const body = (await res.json()) as { courses: unknown[] };
  assert.deepEqual(body.courses, []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && node --import tsx --env-file=.env.test --test src/controllers/progress.test.ts`

Expected: FAIL — `GET /api/me/progress` 404s (route not found) for every test, since nothing exists yet.

- [ ] **Step 3: Add `findMyProgress` to the model**

In `backend/src/models/attempt.model.ts`, change the import line at the top from:

```ts
import { and, asc, count, eq, isNotNull, isNull, max, ne } from 'drizzle-orm';
```

to:

```ts
import { and, asc, count, desc, eq, isNotNull, isNull, max, ne } from 'drizzle-orm';
```

Then append this to the end of the file:

```ts
export type ProgressRow = {
  courseId: string;
  courseTitle: string;
  courseSlug: string;
  subjectSlug: string;
  passScore: number;
  questionCount: number;
  bestScore: number;
  attemptCount: number;
  lastAttemptId: string;
  lastSubmittedAt: Date;
};

/**
 * One row per course the caller has at least one submitted attempt for,
 * newest last-completed first. A course never submitted does not appear.
 */
export async function findMyProgress(userId: string): Promise<ProgressRow[]> {
  const aggregates = await db
    .select({
      courseId: attempts.courseId,
      courseTitle: courses.title,
      courseSlug: courses.slug,
      subjectSlug: subjects.slug,
      passScore: courses.passScore,
      questionCount: courses.questionCount,
      bestScore: max(attempts.score),
      attemptCount: count(attempts.id),
    })
    .from(attempts)
    .innerJoin(courses, eq(courses.id, attempts.courseId))
    .innerJoin(subjects, eq(subjects.id, courses.subjectId))
    .where(and(eq(attempts.userId, userId), isNotNull(attempts.submittedAt)))
    .groupBy(
      attempts.courseId,
      courses.title,
      courses.slug,
      subjects.slug,
      courses.passScore,
      courses.questionCount,
    );

  if (aggregates.length === 0) return [];

  // Newest first, so the first row seen per course below is that course's
  // most recent submitted attempt. Simpler than a SQL window function, and
  // this scans one caller's own attempts — never a large set.
  const submitted = await db
    .select({ courseId: attempts.courseId, id: attempts.id, submittedAt: attempts.submittedAt })
    .from(attempts)
    .where(and(eq(attempts.userId, userId), isNotNull(attempts.submittedAt)))
    .orderBy(desc(attempts.submittedAt));

  const lastByCourse = new Map<string, { id: string; submittedAt: Date }>();
  for (const row of submitted) {
    if (!lastByCourse.has(row.courseId)) {
      lastByCourse.set(row.courseId, { id: row.id, submittedAt: row.submittedAt! });
    }
  }

  return aggregates
    .map((row) => {
      const last = lastByCourse.get(row.courseId)!;
      return {
        courseId: row.courseId,
        courseTitle: row.courseTitle,
        courseSlug: row.courseSlug,
        subjectSlug: row.subjectSlug,
        passScore: row.passScore,
        questionCount: row.questionCount,
        bestScore: Number(row.bestScore),
        attemptCount: Number(row.attemptCount),
        lastAttemptId: last.id,
        lastSubmittedAt: last.submittedAt,
      };
    })
    .sort((a, b) => b.lastSubmittedAt.getTime() - a.lastSubmittedAt.getTime());
}
```

- [ ] **Step 4: Add the controller function**

In `backend/src/controllers/attempt.controller.ts`, change the model import at the top from:

```ts
import {
  findAttemptById,
  findGradedAttempt,
  findOptionForQuestion,
  listAnswers,
  saveAnswer,
  startOrResumeAttempt,
  submitAttempt,
  type AttemptRow,
} from '../models/attempt.model.ts';
```

to:

```ts
import {
  findAttemptById,
  findGradedAttempt,
  findMyProgress,
  findOptionForQuestion,
  listAnswers,
  saveAnswer,
  startOrResumeAttempt,
  submitAttempt,
  type AttemptRow,
} from '../models/attempt.model.ts';
```

Then append this function to the end of the file:

```ts
export async function getMyProgress(req: Request, res: Response): Promise<void> {
  const courses = await findMyProgress(req.user!.id);
  res.json({ courses });
}
```

- [ ] **Step 5: Add the route**

In `backend/src/routes/quiz.routes.ts`, add this line after the existing `attempt.submit` route:

```ts
quizRouter.get('/me/progress', requireAuth, attempt.getMyProgress);
```

The full route block should now read:

```ts
quizRouter.get('/courses/:slug/quiz', requireAuth, quiz.getQuiz);

quizRouter.post('/courses/:slug/attempts', requireAuth, attempt.startAttempt);
quizRouter.get('/attempts/:id', requireAuth, attempt.getAttempt);
quizRouter.put('/attempts/:id/answers/:questionId', requireAuth, attempt.putAnswer);
quizRouter.post('/attempts/:id/submit', requireAuth, attempt.submit);
quizRouter.get('/me/progress', requireAuth, attempt.getMyProgress);
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd backend && node --import tsx --env-file=.env.test --test src/controllers/progress.test.ts`

Expected: PASS, all 6 tests.

- [ ] **Step 7: Run the full backend test suite to check for regressions**

Run: `npm run test:api`

Expected: PASS, no regressions.

- [ ] **Step 8: Commit**

```bash
git add backend/src/models/attempt.model.ts backend/src/controllers/attempt.controller.ts backend/src/routes/quiz.routes.ts backend/src/controllers/progress.test.ts
git commit -m "feat(api): add GET /me/progress for a learner's own grades"
```

---

### Task 2: Frontend — `ProgressPage`

**Files:**
- Modify: `frontend/src/quiz/api.ts`
- Modify: `frontend/src/test/fixtures.ts`
- Create: `frontend/src/pages/ProgressPage.tsx`
- Test: `frontend/src/pages/ProgressPage.test.tsx` (new)

**Interfaces:**
- Consumes: `request<T>()` and the `quizApi` object in `frontend/src/quiz/api.ts` (existing); `GET /api/me/progress` from Task 1, returning `{ courses: ProgressRow[] }` where `ProgressRow` serializes over JSON with `lastSubmittedAt` as an ISO string.
- Produces: `ProgressCourse` type and `quizApi.getMyProgress()` in `frontend/src/quiz/api.ts`; `makeProgressRow()` fixture in `frontend/src/test/fixtures.ts`; the `ProgressPage` component, consumed by Task 3's route.

- [ ] **Step 1: Write the failing test file**

Create `frontend/src/pages/ProgressPage.test.tsx`:

```tsx
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { makeProgressRow } from '../test/fixtures';
import { ProgressPage } from './ProgressPage';

const getMyProgress = vi.fn();

vi.mock('../quiz/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../quiz/api')>();
  return {
    ...actual,
    quizApi: { ...actual.quizApi, getMyProgress: () => getMyProgress() },
  };
});

function renderPage() {
  return render(
    <MemoryRouter>
      <ProgressPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  getMyProgress.mockReset();
});

describe('ProgressPage', () => {
  test('shows an empty state when nothing has been completed', async () => {
    getMyProgress.mockResolvedValue({ courses: [] });
    renderPage();
    expect(
      await screen.findByText("You haven't completed any quizzes yet."),
    ).toBeInTheDocument();
  });

  test('lists best score, attempts, and links to the most recent result', async () => {
    getMyProgress.mockResolvedValue({
      courses: [makeProgressRow({ bestScore: 8, attemptCount: 2, lastAttemptId: 'attempt-9' })],
    });
    renderPage();

    expect(await screen.findByText('8/10')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Tire and Rim Essentials' });
    expect(link).toHaveAttribute(
      'href',
      '/courses/chassis-tire-and-rim-essentials/results/attempt-9',
    );
  });

  test('shows an error message when the fetch fails', async () => {
    getMyProgress.mockRejectedValue(new Error('boom'));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:web -- src/pages/ProgressPage.test.tsx`

Expected: FAIL — `./ProgressPage` does not exist, and `getMyProgress` is not a property of `quizApi`.

- [ ] **Step 3: Add the type and API method**

In `frontend/src/quiz/api.ts`, add this type directly below the existing `CourseHistory` type (after its closing `};`, before `export type GradedAttempt`):

```ts
export type ProgressCourse = {
  courseId: string;
  courseTitle: string;
  courseSlug: string;
  subjectSlug: string;
  passScore: number;
  questionCount: number;
  bestScore: number;
  attemptCount: number;
  lastAttemptId: string;
  lastSubmittedAt: string;
};
```

Then add this method inside the `quizApi` object, after `submit`:

```ts
  getMyProgress: () => request<{ courses: ProgressCourse[] }>('/me/progress'),
```

- [ ] **Step 4: Add the fixture**

In `frontend/src/test/fixtures.ts`, add `ProgressCourse` to the type import at the top:

```ts
import type {
  CourseHistory,
  CourseSummary,
  GradedAttempt,
  GradedQuestion,
  ProgressCourse,
  Quiz,
  QuizQuestion,
} from '../quiz/api';
```

Then append this function to the end of the file:

```ts
export function makeProgressRow(overrides: Partial<ProgressCourse> = {}): ProgressCourse {
  return {
    courseId: 'course-1',
    courseTitle: 'Tire and Rim Essentials',
    courseSlug: 'chassis-tire-and-rim-essentials',
    subjectSlug: 'chassis',
    passScore: 9,
    questionCount: 10,
    bestScore: 8,
    attemptCount: 2,
    lastAttemptId: 'attempt-1',
    lastSubmittedAt: '2026-11-02T12:00:00.000Z',
    ...overrides,
  };
}
```

- [ ] **Step 5: Write the `ProgressPage` component**

Create `frontend/src/pages/ProgressPage.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { quizApi, type ProgressCourse } from '../quiz/api';

type State = { kind: 'ready'; courses: ProgressCourse[] } | { kind: 'error'; message: string };

export function ProgressPage() {
  const [state, setState] = useState<State | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const { courses } = await quizApi.getMyProgress();
        if (!cancelled) setState({ kind: 'ready', courses });
      } catch (err) {
        if (!cancelled) {
          setState({
            kind: 'error',
            message: err instanceof Error ? err.message : 'Could not load your progress',
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (state === null) return <div className="auth-loading">Loading your progress…</div>;
  if (state.kind === 'error') {
    return (
      <p role="alert" className="auth-error">
        {state.message}
      </p>
    );
  }

  const { courses } = state;

  return (
    <div className="course-list">
      <h1>My Progress</h1>

      {courses.length === 0 ? (
        <p className="course-intro">You haven&apos;t completed any quizzes yet.</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Subject</th>
              <th>Course</th>
              <th>Best score</th>
              <th>Attempts</th>
              <th>Last completed</th>
            </tr>
          </thead>
          <tbody>
            {courses.map((c) => (
              <tr key={c.courseId}>
                <td>{c.subjectSlug}</td>
                <td>
                  <Link to={`/courses/${c.courseSlug}/results/${c.lastAttemptId}`}>
                    {c.courseTitle}
                  </Link>
                </td>
                <td>
                  {c.bestScore}/{c.questionCount}
                </td>
                <td>{c.attemptCount}</td>
                <td>{new Date(c.lastSubmittedAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm run test:web -- src/pages/ProgressPage.test.tsx`

Expected: PASS, all 3 tests.

- [ ] **Step 7: Run the full frontend test suite to check for regressions**

Run: `npm run test:web`

Expected: PASS, no regressions (confirms the `fixtures.ts` and `quiz/api.ts` edits didn't break any test that imports them).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/quiz/api.ts frontend/src/test/fixtures.ts frontend/src/pages/ProgressPage.tsx frontend/src/pages/ProgressPage.test.tsx
git commit -m "feat(web): add ProgressPage for a learner's own grades"
```

---

### Task 3: Frontend — route, sidebar link, icon

**Files:**
- Modify: `frontend/src/shell/icons.tsx`
- Modify: `frontend/src/shell/SidebarNav.tsx`
- Modify: `frontend/src/router.tsx`
- Modify: `frontend/src/shell/AppShell.test.tsx`

**Interfaces:**
- Consumes: `ProgressPage` from Task 2 (`frontend/src/pages/ProgressPage.tsx`); the existing `itemClass`/`NavLink` pattern and `nav-item`/`nav-icon`/`nav-label` CSS classes already used in `SidebarNav.tsx`.
- Produces: the `/progress` route; a "My Progress" sidebar link, verified by an `AppShell` test.

- [ ] **Step 1: Write the failing test**

In `frontend/src/shell/AppShell.test.tsx`, add this test inside the existing `describe('AppShell — subject disclosure', ...)` block, right after the `'links to all subjects'` test:

```tsx
  test('links to my progress', async () => {
    renderAt();
    const sidebar = await nav();

    expect(within(sidebar).getByRole('link', { name: 'My Progress' })).toHaveAttribute(
      'href',
      '/progress',
    );
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:web -- src/shell/AppShell.test.tsx`

Expected: FAIL on the new test — no "My Progress" link exists yet. (All other tests in this file still pass.)

- [ ] **Step 3: Add a chart icon**

In `frontend/src/shell/icons.tsx`, add this function after `BookIcon` and before `SunIcon`:

```tsx
/** Bar chart / progress. */
export function ChartIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4.5 19.5h15" />
      <path d="M7 19.5v-6M12 19.5v-10M17 19.5v-4" />
    </svg>
  );
}
```

- [ ] **Step 4: Add the sidebar link**

In `frontend/src/shell/SidebarNav.tsx`, add `ChartIcon` to the existing icon import:

```ts
import { BookIcon, ChartIcon, ChevronRightIcon, SubjectIcon } from './icons';
```

Then add a new `<li>` directly after the "All subjects" `<li>` (before the `{nav.error && (...)}` block):

```tsx
        <li>
          <NavLink to="/progress" onClick={onNavigate} className={itemClass}>
            <ChartIcon className="nav-icon" />
            <span className="nav-label">My Progress</span>
          </NavLink>
        </li>
```

- [ ] **Step 5: Add the route**

In `frontend/src/router.tsx`, add this import alongside the other page imports (alphabetically, after `ProfilePage`):

```ts
import { ProgressPage } from './pages/ProgressPage';
```

Then add this route inside the authenticated `AppShell` layout route, directly after the `/profile` route:

```tsx
          <Route path="/progress" element={<ProgressPage />} />
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm run test:web -- src/shell/AppShell.test.tsx`

Expected: PASS, all tests in the file including the new one.

- [ ] **Step 7: Run the full frontend test suite to check for regressions**

Run: `npm run test:web`

Expected: PASS, no regressions.

- [ ] **Step 8: Run the full project test suite and typecheck**

Run: `npm test && npm run typecheck`

Expected: PASS.

- [ ] **Step 9: Manually verify in the browser**

Run: `npm run dev`

- Sign in, confirm a "My Progress" link appears in the sidebar below "All subjects".
- With no completed quizzes: visiting `/progress` shows "You haven't completed any quizzes yet."
- Complete a quiz, revisit `/progress`: confirm the row shows the right subject, course title, best score, attempt count, and last-completed date, and that clicking the course title opens that attempt's results page.
- Retake the same quiz with a worse score: confirm best score stays the higher one and attempt count increments.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/shell/icons.tsx frontend/src/shell/SidebarNav.tsx frontend/src/router.tsx frontend/src/shell/AppShell.test.tsx
git commit -m "feat(web): wire up /progress route and sidebar link"
```
