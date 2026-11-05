# My Progress: self-service grades/history view

## Problem

Learners can see a pass checkmark next to a course in the sidebar, but have no
page that summarizes their quiz grades across subjects, or a way to jump back
into a past result. Admins got this for any user in
[[2026-11-05-admin-view-user-attempts-design]]; this gives learners the same
view scoped to themselves.

## Existing support (no changes needed)

- `backend/src/models/attempt.model.ts` already has the per-course aggregates
  this needs individually (`findBestScoreBefore`, `findCourseHistory`) but
  nothing that lists *all* of a user's courses in one query — that's the new
  piece.
- `backend/src/models/admin-attempt.model.ts: listAttemptsForUser` is the
  closest existing query (same joins, grouped by attempt instead of by
  course) — the new query is a variant of this, not a copy of
  `findCourseHistory`.
- Results page already exists at `/courses/:slug/results/:attemptId` and
  renders full per-question grading — reused as-is for drill-in.

## Design

### Backend

New function in `backend/src/models/attempt.model.ts`:

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

export async function findMyProgress(userId: string): Promise<ProgressRow[]>
```

- Scope: submitted attempts only (`isNotNull(attempts.submittedAt)`), grouped
  by `attempts.courseId`. A course with zero submitted attempts never
  appears — matches the "only attempted courses" decision.
- `bestScore`: `max(attempts.score)` per course.
- `attemptCount`: `count(attempts.id)` per course.
- `lastAttemptId` / `lastSubmittedAt`: the most recent submitted attempt per
  course. Drizzle has no `DISTINCT ON` helper, so implement as: a subquery
  selecting `max(submittedAt)` per `(userId, courseId)`, inner-joined back to
  `attempts` on `courseId` + `submittedAt` to recover that attempt's `id`.
  (Ties on `submittedAt` are not expected in practice — scores are only
  submitted once per request — so any one row is an acceptable tie-break.)
- Order by `lastSubmittedAt desc`.

New controller function `getMyProgress` in `attempt.controller.ts`:
- Calls `findMyProgress(req.user!.id)`, returns `{ courses: ProgressRow[] }`.
- No ownership check needed beyond scoping the query to `req.user!.id` — it
  never takes an id param.

New route in `quiz.routes.ts`:
```ts
quizRouter.get('/me/progress', requireAuth, attempt.getMyProgress);
```

### Frontend

- Add `MyProgressRow` type and a `getMyProgress()` call to
  `frontend/src/quiz/api.ts` (alongside the existing `startAttempt`/
  `getAttempt` helpers) calling `GET /me/progress`.
- New page `frontend/src/pages/ProgressPage.tsx`:
  - Fetches on mount; loading / error / empty states follow the same pattern
    as `SubjectCoursesPage.tsx`.
  - Empty state: "You haven't completed any quizzes yet."
  - Otherwise, a table (reusing the `admin-table` CSS class rather than a new
    one) with columns **Subject / Course / Best score / Attempts / Last
    completed**, one row per course:
    - Subject: `subjectSlug`.
    - Course: `courseTitle`, rendered as a link to
      `/courses/${courseSlug}/results/${lastAttemptId}`.
    - Best score: `${bestScore} / ${questionCount}`.
    - Attempts: `attemptCount`.
    - Last completed: `new Date(lastSubmittedAt).toLocaleDateString()`.
  - Row key: `courseId`.
- New route `/progress` in `router.tsx`, inside the existing authenticated
  `AppShell` layout route (same tier as `/profile`).
- New sidebar entry in `SidebarNav.tsx`: a "My Progress" `NavLink` to
  `/progress`, placed next to "All subjects" (above the subject list),
  reusing the existing `nav-item` style and an existing icon (e.g. a chart or
  the existing `BookIcon` sibling) — no new icon component unless the
  existing icon set has nothing suitable.

## Out of scope

- No full per-course attempt history (every retake) — best score + count only,
  per the agreed scope. A later drill-down into all attempts for one course
  (if wanted) would reuse the admin modal pattern.
- No change to the sidebar's existing per-course pass checkmark.
- No pagination — course counts are small (currently 81 total courses across
  all subjects).

## Testing

- Backend: model test for `findMyProgress` — empty (no attempts), single
  course with multiple attempts (best score ≠ last attempt's score, to prove
  "best" and "last" are tracked independently), multiple courses, cross-user
  isolation (another user's attempts never appear). Controller test for the
  route (auth required, returns own data only).
- Frontend: component test for `ProgressPage` — loading, empty, populated
  (correct columns and result-page link `href`), error state.
