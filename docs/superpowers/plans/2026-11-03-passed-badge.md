# Passed Badge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show an explicit "Passed" badge on each quiz row in a subject's quiz list once the user's best score meets that quiz's pass score, leaving retakes unlimited.

**Architecture:** A new presentational component `PassBadge` owns the `bestScore >= passScore` rule and renders nothing when it does not hold. `SubjectCoursesPage` renders it inside the existing `.course-score` cell, before the score text. One new CSS rule styles it as a pill derived from the existing `--success` token. No backend, API, or data-shape changes — `CourseSummary` already carries `bestScore` and `passScore`.

**Tech Stack:** React 19, TypeScript, Vite, Vitest + jsdom, @testing-library/react, @testing-library/jest-dom. Plain CSS with custom properties (no CSS framework).

**Spec:** `docs/superpowers/specs/2026-11-03-passed-badge-design.md`

## Global Constraints

- Frontend work only. Do not modify anything under `backend/`.
- Do not add dependencies. Everything needed is already in `frontend/package.json`.
- All commands run from the `frontend/` directory.
- Pass basis is **best-ever** score (`bestScore`), never the most recent attempt.
- The badge must convey pass state as **text**, not colour alone — that is the whole point of the change. The existing `.course-passed` / `.course-below` colouring stays as a secondary cue and must not be removed.
- Do not introduce new CSS custom properties. Derive the badge background from the existing `--success` via `color-mix`.
- Do not change the quiz `Link`, and do not add any attempt limiting, locking, or gating.

## File Structure

| File | Responsibility |
|---|---|
| `frontend/src/quiz/PassBadge.tsx` (create) | Owns the pass rule and the badge markup. Takes two numbers, returns the badge or `null`. |
| `frontend/src/pages/SubjectCoursesPage.tsx` (modify) | Renders `PassBadge` in the score cell of each row. No other change. |
| `frontend/src/App.css` (modify) | One `.course-badge` rule, next to the existing `.course-passed` / `.course-below` rules. |
| `frontend/src/pages/SubjectCoursesPage.test.tsx` (modify) | Four new tests: badge shown, hidden below target, hidden when unattempted, and the retake link survives a pass. |

This is a single task: the component is useless without its wiring, and the CSS without both, so there is no boundary where a reviewer could sensibly accept one piece and reject another.

---

### Task 1: Passed badge on quiz list rows

**Files:**
- Create: `frontend/src/quiz/PassBadge.tsx`
- Modify: `frontend/src/pages/SubjectCoursesPage.tsx:68-79` (the `.course-score` div)
- Modify: `frontend/src/App.css:115-117` (append after `.course-below`)
- Test: `frontend/src/pages/SubjectCoursesPage.test.tsx`

**Interfaces:**
- Consumes: `CourseSummary` from `frontend/src/quiz/api.ts` — relevant fields are `passScore: number`, `questionCount: number`, `bestScore: number | null`, `attemptCount: number`. The test fixture `makeCourse(overrides?: Partial<CourseSummary>): CourseSummary` from `frontend/src/test/fixtures.ts` defaults to `passScore: 9`, `questionCount: 10`, `bestScore: null`, `attemptCount: 0`, `title: 'Tire and Rim Essentials'`.
- Produces: `PassBadge({ bestScore, passScore }: { bestScore: number | null; passScore: number }): JSX.Element | null`, exported from `frontend/src/quiz/PassBadge.tsx`. Nothing else in the plan depends on it.

**Testing notes for the implementer:**

The badge's DOM is `<span class="course-badge"><span aria-hidden="true">✓</span> Passed</span>`. `screen.findByText('Passed')` matches it on an exact string even though the tick is nested, because Testing Library builds each candidate's text from its **direct text-node children only** — here `" Passed"`, which the default normalizer trims to `"Passed"`. The inner span contributes `"✓"` and does not match. Do not "fix" this with a regex; the exact string is the stronger assertion.

The existing test `'flags a score at or above the target as passed'` queries `findByText(/Best 9\/10/)` and asserts `toHaveClass('course-passed')`. Adding the badge as a **sibling** inside `.course-score` leaves that query pointing at the score span, so it keeps passing. If you find yourself editing that test, you have put the badge in the wrong place.

- [ ] **Step 1: Write the failing tests**

Append these four tests inside the existing `describe('SubjectCoursesPage', ...)` block in `frontend/src/pages/SubjectCoursesPage.test.tsx`, after the `'flags a score at or above the target as passed'` test:

```tsx
  test('shows a Passed badge once the best score meets the target', async () => {
    listCourses.mockResolvedValue({
      courses: [makeCourse({ bestScore: 9, attemptCount: 1 })],
    });
    renderPage();

    expect(await screen.findByText('Passed')).toBeInTheDocument();
  });

  test('shows no badge while the best score is below the target', async () => {
    listCourses.mockResolvedValue({
      courses: [makeCourse({ bestScore: 8, attemptCount: 3 })],
    });
    renderPage();

    // Await something that does render, so a missing badge is a real absence
    // rather than an assertion that ran before the fetch resolved.
    await screen.findByText(/Best 8\/10/);
    expect(screen.queryByText('Passed')).not.toBeInTheDocument();
  });

  test('shows no badge for a course that has never been attempted', async () => {
    renderPage();

    await screen.findByText('Not attempted');
    expect(screen.queryByText('Passed')).not.toBeInTheDocument();
  });

  // Passing is not a lock: a passed quiz stays open for unlimited retakes.
  test('keeps the quiz link available after a pass', async () => {
    listCourses.mockResolvedValue({
      courses: [makeCourse({ bestScore: 10, attemptCount: 1 })],
    });
    renderPage();

    const link = await screen.findByRole('link', { name: 'Tire and Rim Essentials' });
    expect(link).toHaveAttribute(
      'href',
      '/courses/chassis-tire-and-rim-essentials/quiz',
    );
  });
```

No new imports are needed — `screen`, `makeCourse`, `renderPage` and `listCourses` are already in the file.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd frontend && npx vitest run src/pages/SubjectCoursesPage.test.tsx
```

Expected: 3 failures, 1 pass. The two "shows a Passed badge" / "no badge" negative tests and the link test behave as follows — `'shows a Passed badge once the best score meets the target'` fails with `TestingLibraryElementError: Unable to find an element with the text: Passed`; the two `queryByText` tests pass already (nothing renders a badge yet); `'keeps the quiz link available after a pass'` passes already.

So the honest expectation is **1 failure, 3 passes**. That one failing test is the real red. The three that already pass are regression guards, not drivers — that is intentional and correct for this change, because three of the four behaviours the spec asks for are behaviours the code must *not* break.

- [ ] **Step 3: Create the PassBadge component**

Create `frontend/src/quiz/PassBadge.tsx`:

```tsx
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
  if (bestScore === null || bestScore < passScore) return null;

  return (
    <span className="course-badge">
      <span aria-hidden="true">✓</span> Passed
    </span>
  );
}
```

- [ ] **Step 4: Render the badge in the quiz row**

In `frontend/src/pages/SubjectCoursesPage.tsx`, add the import after the existing `quizApi` import on line 3:

```tsx
import { PassBadge } from '../quiz/PassBadge';
```

Then replace the `.course-score` div (lines 68-79) with:

```tsx
            <div className="course-score">
              <PassBadge bestScore={c.bestScore} passScore={c.passScore} />
              {c.bestScore === null ? (
                <span className="course-untaken">Not attempted</span>
              ) : (
                <span
                  className={c.bestScore >= c.passScore ? 'course-passed' : 'course-below'}
                >
                  Best {c.bestScore}/{c.questionCount}
                  {c.attemptCount > 1 ? ` · ${c.attemptCount} attempts` : ''}
                </span>
              )}
            </div>
```

The only change is the added `PassBadge` line. Everything else is byte-identical to what was there.

- [ ] **Step 5: Style the badge**

In `frontend/src/App.css`, immediately after the `.course-below` rule on line 117, add:

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

`color-mix` off the existing `--success` means the pill follows the dark-theme override in `frontend/src/index.css` with no new token to keep in sync.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd frontend && npx vitest run src/pages/SubjectCoursesPage.test.tsx
```

Expected: PASS, 8 tests (the original 4 plus the 4 new ones).

- [ ] **Step 7: Run the full frontend suite, typecheck and lint**

```bash
cd frontend && npm test && npx tsc -b && npm run lint
```

Expected: all three clean. `npm test` runs `vitest run` over every suite — confirming the row change broke no other page's queries. `tsc -b` catches a mistyped prop; `npm run lint` catches an unused import.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/quiz/PassBadge.tsx \
        frontend/src/pages/SubjectCoursesPage.tsx \
        frontend/src/pages/SubjectCoursesPage.test.tsx \
        frontend/src/App.css
git commit -m "feat(web): badge a passed quiz, without closing it to retakes

A pass was signalled only by the score turning green, which conveys
nothing to a screen reader or a colour-blind user. PassBadge makes the
state textual and owns the rule, so no caller re-derives it.

Retakes stay unlimited; a test pins the quiz link open after a pass."
```

---

## Self-Review

**1. Spec coverage**

| Spec requirement | Task / step |
|---|---|
| `PassBadge` component, exact signature and markup | Task 1, Step 3 |
| Badge in `.course-score` before the score text, score text and colour retained | Task 1, Step 4 |
| `.course-badge` CSS rule via `color-mix` off `--success` | Task 1, Step 5 |
| Test: badge when `bestScore >= passScore` | Task 1, Step 1, test 1 |
| Test: no badge when `bestScore < passScore` | Task 1, Step 1, test 2 |
| Test: no badge when `bestScore === null` | Task 1, Step 1, test 3 |
| Test: quiz link survives a pass (regression guard) | Task 1, Step 1, test 4 |
| No backend change | Global Constraints |
| Placement limited to list rows; no sidebar, no results page | File Structure (neither file appears) |
| No de-duplication of existing pass expressions | Step 4 leaves the `course-passed` ternary untouched |

No gaps.

**2. Placeholder scan**

No TBDs, no "add error handling", no "similar to Task N", no "write tests for the above". Every code step carries complete code.

**3. Type consistency**

`PassBadge`'s props (`bestScore: number | null`, `passScore: number`) match the `CourseSummary` fields passed at the call site in Step 4 and the fixture defaults in `frontend/src/test/fixtures.ts`. The component name is spelled `PassBadge` and the class `course-badge` consistently in Steps 3, 4 and 5. The file path `frontend/src/quiz/PassBadge.tsx` matches the import `'../quiz/PassBadge'` from `frontend/src/pages/`.

**One honest deviation from the template:** Step 2's expected output is "1 failure, 3 passes", not four failures. Three of the four required behaviours are *absences* (no badge, link still works), which the pre-change code already satisfies. Writing them as red-first tests would mean faking a regression to go green on. They are documented as regression guards instead, and the plan says so rather than overstating the red.
