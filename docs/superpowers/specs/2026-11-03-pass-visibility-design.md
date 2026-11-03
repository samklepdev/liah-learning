# Pass Visibility Across the App — Design

**Date:** 2026-11-03
**Status:** Approved
**Builds on:** `2026-11-03-passed-badge-design.md`

## Goal

Wherever a learner looks, they can tell whether they have passed a quiz. The badge
already exists on subject quiz-list rows; this extends pass state to the results page,
the top of a retake, and the sidebar nav.

## Governing rule

**Pass state is best-ever, everywhere, and never disappears.** A weaker retake never
revokes a badge and never replaces a better score in any headline figure. This is the
single rule behind every decision below; where a surface previously showed the current
attempt instead, that is treated as the thing to change.

Expressed once, in `frontend/src/quiz/passed.ts`:

```ts
export function hasPassed(bestScore: number | null, passScore: number): boolean {
  return bestScore !== null && bestScore >= passScore;
}
```

Four surfaces consume it: the list row, the results page, the retake banner, the sidebar.
The earlier spec declared de-duplicating the two existing inline copies out of scope; at
four call sites it no longer is, so this folds that in.

## Surfaces

### 1. Results page (`ResultsPage.tsx`)

The headline number becomes best-ever rather than this attempt's score.

```
      10/10          ← best-ever
  ✓ PASSED
  Target of 9/10 met
  This attempt: 7/10
```

- Best-ever is `Math.max(attempt.score, attempt.previousBest ?? attempt.score)`. The API
  already returns `previousBest`, so no backend change is needed for this surface.
- The badge and the target line both read best-ever, so a 7/10 retake after a 10/10 pass
  still shows "Passed" and "Target of 9/10 met".
- `This attempt: N/M` renders **only when best-ever exceeds this attempt's score**, so a
  single-attempt result shows no redundant line. It replaces today's
  "Your previous best was N" line, which is subsumed by the headline.
- The breakdown heading changes from `All {n} questions` to
  `All {n} questions from this attempt`.

**Known consequence, accepted:** the route is per-attempt
(`/courses/:slug/results/:attemptId`), so two attempts on the same course now show the
same headline figure, and the headline no longer matches the per-question breakdown
beneath it. The explicit "this attempt" labelling on both the score line and the
breakdown heading is what keeps this honest. Chosen deliberately over showing the lower
number, because a learner reading their own result should see what they achieved, not
their worst run.

### 2. Retake banner (`QuizPage.tsx`)

A summary strip above the quiz header, on retakes only:

```
┌──────────────────────────────────────┐
│ ✓ PASSED   Best 10/10 · 2 attempts   │
└──────────────────────────────────────┘
```

**Summary only — never per-question data.** `findQuizByCourseSlug` deliberately omits
`isCorrect` and `explanation`, and `quiz.controller.test.ts` asserts the raw payload
contains neither string. Putting a previous attempt's breakdown on the quiz page would
hand over the answer key mid-retake and make that test meaningless. The banner therefore
carries three numbers and nothing else.

Hidden entirely when `attemptCount === 0`, so a first attempt sees no banner.

### 3. Sidebar nav (`SidebarNav.tsx`)

A tick at the end of each passed quiz row:

```
  1  Tire and Rim Essentials        ✓
  2  Best Practice Tire Fitment
  3  Complete Steering Systems      ✓
```

Markup: `<span className="nav-sublink-pass" role="img" aria-label="Passed">✓</span>`. The
`aria-label` is what stops this being a glyph-and-colour-only signal. Rendered inline in
`SidebarNav` rather than as a component, consistent with how that file already inlines
`nav-sublink-pos`. No new data: `useSubjectNav` already holds `CourseSummary`.

## Backend

### `findCourseHistory` — `attempt.model.ts` (new)

```ts
export async function findCourseHistory(
  userId: string,
  courseId: string,
): Promise<{ bestScore: number | null; attemptCount: number }>;
```

Max score and count over **submitted attempts only**, matching the definition
`listCoursesBySubject` already uses — so a retake in progress does not inflate
`attemptCount`.

### `getQuiz` — `quiz.controller.ts` (modified)

Response becomes `{ quiz, history }`.

`findQuizByCourseSlug` keeps its current signature and stays a pure content query with no
user argument; the controller composes the two. This keeps per-user state out of the
object the leak test guards, and keeps `Quiz` meaning "the quiz content". The route is
already `requireAuth`, so `req.user` is available and no second request is needed.

Rejected alternatives: widening `Quiz` itself with `bestScore`/`attemptCount` (makes the
leak-guarded type user-dependent), and a separate `GET /courses/:slug/history` endpoint
(an extra round trip for two numbers the quiz page always wants).

## Components

| File | Responsibility |
|---|---|
| `frontend/src/quiz/passed.ts` (new) | The pass rule, `hasPassed`. Nothing else. |
| `frontend/src/quiz/QuizHistoryBanner.tsx` (new) | The retake strip. Returns `null` when `attemptCount === 0`. |
| `frontend/src/quiz/PassBadge.tsx` (modify) | Delegates to `hasPassed` instead of inlining the comparison. Markup unchanged. |
| `frontend/src/pages/ResultsPage.tsx` (modify) | Best-ever headline, badge, "this attempt" line, breakdown heading. |
| `frontend/src/pages/QuizPage.tsx` (modify) | Renders `QuizHistoryBanner` above the quiz header. |
| `frontend/src/pages/SubjectCoursesPage.tsx` (modify) | Uses `hasPassed` for its score-colour ternary. |
| `frontend/src/shell/SidebarNav.tsx` (modify) | The tick on passed rows. |
| `frontend/src/quiz/useQuizAttempt.ts` (modify) | Threads `history` through alongside `quiz`. |
| `frontend/src/quiz/api.ts` (modify) | `CourseHistory` type; `getQuiz` return type gains `history`. |
| `frontend/src/App.css` (modify) | `.quiz-history`, `.nav-sublink-pass`. |
| `backend/src/models/attempt.model.ts` (modify) | `findCourseHistory`. |
| `backend/src/controllers/quiz.controller.ts` (modify) | Composes `{ quiz, history }`. |

`QuizHistoryBanner` takes `bestScore`, `attemptCount`, `passScore`, `questionCount` as
four scalars rather than a course or quiz object, so it stays usable from anywhere
without reshaping data — the same choice `PassBadge` made.

## Data flow

`findCourseHistory` → `getQuiz` → `quizApi.getQuiz` → `useQuizAttempt` → `QuizPage` →
`QuizHistoryBanner`. The sidebar and list row need no new data. The results page derives
best-ever from `score` and `previousBest`, both already in the response.

## Error handling

Nothing new. `history` is two numbers that always exist for an authenticated caller
(`{ bestScore: null, attemptCount: 0 }` for an untried course), so there is no
partial-failure state to model. The quiz page's existing loading and error branches
already cover a failed request, and a missing banner is indistinguishable from a first
attempt — the correct rendering either way.

## Testing

**Backend** (`node:test`, real DB):

1. The quiz response carries the caller's `history` — `bestScore` and `attemptCount`.
2. Another user's attempts on the same course do not count toward it.
3. An unsubmitted attempt does not inflate `attemptCount`.
4. The existing leak test passes unchanged — asserted by not modifying it.

**Frontend** (vitest):

5. `hasPassed` boundary cases: 8, 9, 10 against `passScore` 9, and `null`.
6. Results page shows the badge when this attempt passed.
7. Results page shows the badge when this attempt is **below** target but `previousBest`
   passed — the never-disappears guarantee.
8. Results page headline shows best-ever, not this attempt, on a weaker retake.
9. Results page shows "This attempt: N/M" only when best-ever exceeds this attempt.
10. Retake banner absent when `attemptCount === 0`.
11. Retake banner shows badge and score after a pass.
12. Retake banner shows score without badge after a failed attempt.
13. Sidebar renders the tick for a passed quiz and not for an unpassed one.

## Out of scope

- Any attempt limiting, locking, or gating. Retakes stay unlimited.
- Certificates, or any notion of completion beyond the pass badge.
- Per-question history on the quiz page — excluded on purpose, see surface 2.
