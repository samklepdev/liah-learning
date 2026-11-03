# Passed Badge on Quiz List Rows — Design

**Date:** 2026-11-03
**Status:** Approved

## Goal

Show an explicit "Passed" badge on each quiz row in a subject's quiz list once the user
has met that quiz's pass score, while leaving retakes unlimited.

## Premise correction

The request was framed as replacing a lock ("a test can be passed but taken multiple
times"). There is no lock in this codebase to replace:

- `startOrResumeAttempt` (`backend/src/models/attempt.model.ts`) applies no pass check
  and no attempt cap. It only enforces *one open attempt at a time* per user and course,
  via a partial unique index — a concurrency guard, not an attempt limit.
- `ResultsPage` already renders a "Retake quiz" link.

So retakes are already unlimited and no code needs to be removed. The gap is purely the
badge.

## Why a badge

Today a pass is signalled only by text colour: `.course-passed { color: var(--success) }`
versus `.course-below { color: var(--warning) }` (`frontend/src/App.css`). The row reads
"Best 9/10" in green or amber. Colour alone does not survive colour-blindness and conveys
nothing to a screen reader, so a user relying on either cannot tell a pass from a fail.
The badge makes the state textual.

## Decisions

| Question | Decision |
|---|---|
| Placement | Quiz list rows only (`SubjectCoursesPage`). Not the sidebar, not the results page. |
| Pass basis | Best-ever score. Once passed, stays passed; a weaker retake does not revoke the badge. |
| Backend | No change. `listCoursesBySubject` already returns `bestScore` and `passScore`. |

Best-ever was chosen over most-recent because it needs no new API field and because
revoking a badge for practising is the wrong incentive.

## Components

### `PassBadge` — `frontend/src/quiz/PassBadge.tsx` (new)

```tsx
export function PassBadge({
  bestScore,
  passScore,
}: {
  bestScore: number | null;
  passScore: number;
}) {
  if (bestScore === null || bestScore < passScore) return null;
  return (
    <span className="course-badge">
      <span aria-hidden="true">✓</span> Passed
    </span>
  );
}
```

- **Does:** renders a pass badge, or nothing.
- **Interface:** the two numbers that define a pass. No course object, so it stays usable
  from the sidebar or results page without reshaping data.
- **Depends on:** nothing but the `.course-badge` class.

Returning `null` rather than having the caller branch keeps the `bestScore >= passScore`
rule in one place. That rule is currently duplicated in `SubjectCoursesPage` and
`ResultsPage`; this adds no third copy. Unifying the two existing copies is out of scope.

The tick glyph is `aria-hidden`, so assistive tech announces "Passed" and nothing else.

### `SubjectCoursesPage` — modified

Inside `.course-score`, the badge renders before the existing score text. The
"Best N/M · K attempts" text and its green/amber colour both stay, now as a secondary
cue rather than the sole signal. No change to the quiz `Link`.

### `App.css` — one new rule

```css
.course-badge {
  display: inline-block;
  margin-right: 0.5rem;
  padding: 0.1rem 0.45rem;
  border-radius: 999px;
  font-size: 0.7rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--success);
  background: color-mix(in srgb, var(--success) 14%, transparent);
}
```

Placed next to the existing `.course-passed` / `.course-below` rules. The background is
derived from `--success` via `color-mix`, so it follows the dark-theme override in
`index.css` without introducing a new token.

## Data flow

`listCoursesBySubject` → `GET /api/subjects/:slug/courses` → `quizApi.listCourses` →
`SubjectCoursesPage` state → `PassBadge({ bestScore, passScore })`. Unchanged except for
the final step.

## Error handling

None to add. `PassBadge` is a pure function of two props already present on every
`CourseSummary`; `bestScore: null` (never attempted) is the normal no-badge case, not an
error. The page's existing loading and error states are untouched.

## Testing

Extend `frontend/src/pages/SubjectCoursesPage.test.tsx`:

1. Badge renders for a course where `bestScore >= passScore`.
2. No badge where `bestScore < passScore`.
3. No badge where `bestScore === null`.
4. The quiz link still renders for a passed course — a regression guard, so a future
   attempt limit cannot be introduced without a test failing.

Case 4 exists because the original request assumed passing blocks retakes. Encoding
"passing does not block retaking" in a test makes that assumption false by construction
rather than by inspection.

## Out of scope

- Badges in the sidebar nav or on the results page.
- De-duplicating the existing pass-rule expressions in `SubjectCoursesPage` and
  `ResultsPage`.
- Any attempt limiting, locking, or certificate behaviour.
