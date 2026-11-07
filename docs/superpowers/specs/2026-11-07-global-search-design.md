# Global Search

## Problem

Signed-in users can only find a subject or quiz by browsing the sidebar, which lazily loads each subject's courses only after it's expanded. There's no way to jump directly to a known quiz or subject by name.

## Goal

A search bar in the top nav, available on every signed-in route, that matches against subject and quiz (course) titles and lets the user jump straight to the result.

## Scope

- Title-only matching for subjects and courses.
- Dropdown-as-you-type in the top nav.
- No question/body full-text search.
- No dedicated `/search` results page.
- No visibility rules beyond what `/subjects` and `/courses` already expose — search surfaces nothing a user couldn't already reach by browsing the sidebar.

## Backend

### `GET /search?q=<term>`

Added alongside the existing public catalog routes in `catalog.routes.ts`.

- **Auth posture**: public, same as `/subjects` and `/courses` — the catalog is browsable before sign-in; per-user columns aren't needed for search results.
- **Validation**: missing/empty `q` → `400 { error: 'A q query parameter is required' }`, matching the existing `subject` param check in `getCourses`. A `q` with fewer than 2 characters (after trimming) returns empty results rather than erroring, to avoid flooding on the first keystroke.
- **Matching**: case-insensitive substring match (`ILIKE '%term%'`) against `subjects.title` and `courses.title`. `%`, `_`, and `\` in the input are escaped before interpolation into the `ILIKE` pattern so user input can't alter the match shape.
- **Filtering**: only `courses.isActive = true`, matching `listCoursesBySubject`.
- **Limits**: up to 8 subjects and up to 8 courses, each ordered by title ascending.
- **Response shape**:
  ```ts
  type SearchResult = {
    subjects: SubjectSummary[]; // existing type
    courses: Array<CourseSummary & { subjectSlug: string; subjectTitle: string }>;
  };
  ```
  `subjectSlug`/`subjectTitle` are new on this response only (not added to the base `CourseSummary`, since `/courses` responses are already scoped to one known subject). They let the frontend build the course link and show which subject a quiz result belongs to.
- **Per-user columns**: `bestScore`/`attemptCount` on course results are not computed for search (zeroed/omitted) — search is a navigation aid, not a progress view, and computing per-user stats for an unauthenticated-capable endpoint adds cost with no use here.

Implementation lands in:
- `catalog.model.ts` — new `searchCatalog(q: string)` function.
- `catalog.controller.ts` — new `search` handler.
- `catalog.routes.ts` — new `catalogRouter.get('/search', catalog.search)` line.

## Frontend

### API client

`src/quiz/api.ts`: add
```ts
export type SearchCourseResult = CourseSummary & { subjectSlug: string; subjectTitle: string };

search: (q: string) =>
  request<{ subjects: SubjectSummary[]; courses: SearchCourseResult[] }>(
    `/search?q=${encodeURIComponent(q)}`,
  ),
```

### `useGlobalSearch` hook

New file `src/shell/useGlobalSearch.ts`, modeled on the cancellation pattern already used in `useSubjectNav`:

- Local `query` state, `results` state (`{ subjects, courses } | null`), `loading`, `error`.
- Debounces the API call ~250ms after `query` changes.
- Only fires when the trimmed query is ≥2 characters; otherwise clears results without a request.
- Tracks a `cancelled` flag per effect run so a stale response can't overwrite a newer one.

### `GlobalSearch` component

New file `src/shell/GlobalSearch.tsx`, rendered in `AppShell.tsx`'s `<header className="topnav">`, positioned between `topnav-brand` and `topnav-right`.

- Text `<input>` with a search icon, placeholder "Search subjects and quizzes".
- A dropdown panel opens when the input has focus and a non-empty query; closes on blur-outside, Escape, or navigation.
- Panel sections, shown only when non-empty: "Subjects" then "Quizzes". Each quiz row shows the course title plus its subject title as a muted sub-label.
- Loading state while debounced request is in flight; "No matches" row when settled with zero results in both lists.
- Keyboard handling: ArrowDown/ArrowUp move a highlighted index across the combined flattened result list, Enter navigates the highlighted item (or does nothing if none highlighted), Escape clears focus/closes the panel.
- Navigation: subject row → `/subjects/:slug`; quiz row → `/courses/:slug/quiz`. After navigating, the input is cleared and the panel closes.
- Markup uses a `role="combobox"`/`listbox` pattern consistent with accessible autocomplete conventions (`aria-expanded`, `aria-activedescendant`, `aria-controls` pointing at the panel), matching the accessibility care already present in `SidebarNav.tsx`'s disclosure buttons.

## Out of scope / explicitly deferred

- Full-text search over question prompts/module titles.
- A standalone search results page for queries with more results than the dropdown shows.
- Search analytics (tracking what users search for).
