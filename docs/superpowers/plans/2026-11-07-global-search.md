# Global Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a signed-in user search subjects and quizzes by title from a search bar in the top nav, and jump straight to the result.

**Architecture:** A new public `GET /search?q=` endpoint does an `ILIKE` title match against `subjects` and active `courses`. A new `GlobalSearch` React component in the top nav debounces keystrokes, calls the endpoint, and renders a keyboard-navigable dropdown that links to `/subjects/:slug` or `/courses/:slug/quiz`.

**Tech Stack:** Express + Drizzle ORM (backend), React + React Router + Vitest/Testing Library (frontend), Node's built-in `node:test` + `fetch` (backend tests).

## Global Constraints

- Search matches **titles only** — no question/module body text.
- Results are capped at 8 subjects and 8 courses, ordered by title ascending.
- Only `courses.isActive = true` rows are eligible (same filter as `listCoursesBySubject`).
- The endpoint is public (no auth required), matching `/subjects` and `/courses`.
- `q` shorter than 2 characters (after trim) returns empty results, not an error. Missing/empty `q` is a `400`.
- `%`, `_`, and `\` in the user's query must be escaped before being placed in the `ILIKE` pattern.
- Course results carry `subjectSlug` and `subjectTitle` on top of the existing `CourseSummary` fields — this is new only on the search response, not on `/courses`.
- No per-user `bestScore`/`attemptCount` computation for search results.
- Quiz result click navigates straight to `/courses/:slug/quiz`; subject result click navigates to `/subjects/:slug`.

---

## File Structure

| File | Responsibility |
|---|---|
| `backend/src/models/catalog.model.ts` | Add `searchCatalog(q)` — the `ILIKE` queries against `subjects`/`courses`. |
| `backend/src/controllers/catalog.controller.ts` | Add `search` handler — validates `q`, calls the model. |
| `backend/src/routes/catalog.routes.ts` | Add the `GET /search` route. |
| `backend/src/controllers/catalog.controller.test.ts` | Add tests for the new endpoint. |
| `frontend/src/quiz/api.ts` | Add `SearchCourseResult` type and `quizApi.search`. |
| `frontend/src/shell/useGlobalSearch.ts` (new) | Debounced search state hook. |
| `frontend/src/shell/useGlobalSearch.test.ts` (new) | Hook behavior tests. |
| `frontend/src/shell/GlobalSearch.tsx` (new) | The input + dropdown UI. |
| `frontend/src/shell/GlobalSearch.test.tsx` (new) | Component behavior tests. |
| `frontend/src/shell/icons.tsx` | Add `SearchIcon`. |
| `frontend/src/shell/AppShell.tsx` | Render `<GlobalSearch />` in the top nav. |
| `frontend/src/shell/AppShell.test.tsx` | Extend to confirm `GlobalSearch` renders in the shell. |
| `frontend/src/App.css` | Styles for `.global-search` and its dropdown. |

---

### Task 1: Backend — `searchCatalog` model function

**Files:**
- Modify: `backend/src/models/catalog.model.ts`
- Test: none yet (covered end-to-end in Task 2's controller test, which is the existing pattern in this file — `listSubjects`/`listCoursesBySubject` have no standalone model-level tests either)

**Interfaces:**
- Consumes: `db`, `subjects`, `courses` from existing imports; `SubjectSummary`, `CourseSummary` types already defined in this file.
- Produces:
  ```ts
  export type SearchCourseResult = CourseSummary & { subjectSlug: string; subjectTitle: string };
  export type SearchResult = { subjects: SubjectSummary[]; courses: SearchCourseResult[] };
  export async function searchCatalog(q: string): Promise<SearchResult>
  ```
  Task 2 imports `searchCatalog` and `SearchResult` from this module.

- [ ] **Step 1: Add the escape helper and `searchCatalog` function**

Add to `backend/src/models/catalog.model.ts`. First update the import line to add `ilike`:

```ts
import { and, asc, count, eq, ilike, isNotNull, max, sql } from 'drizzle-orm';
```

Then append at the end of the file:

```ts
export type SearchCourseResult = CourseSummary & { subjectSlug: string; subjectTitle: string };

export type SearchResult = {
  subjects: SubjectSummary[];
  courses: SearchCourseResult[];
};

/** Escapes ILIKE wildcard characters so user input can't widen the match. */
function escapeLike(raw: string): string {
  return raw.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Title-only search across subjects and active courses, for the top-nav
 * search bar. Mirrors listSubjects/listCoursesBySubject's isActive filter —
 * a soft-deleted course must not be findable here either.
 */
export async function searchCatalog(q: string): Promise<SearchResult> {
  const pattern = `%${escapeLike(q)}%`;

  const subjectRows = await db
    .select({ id: subjects.id, slug: subjects.slug, title: subjects.title })
    .from(subjects)
    .where(ilike(subjects.title, pattern))
    .orderBy(asc(subjects.title))
    .limit(8);

  const courseRows = await db
    .select({
      id: courses.id,
      slug: courses.slug,
      title: courses.title,
      position: courses.position,
      passScore: courses.passScore,
      questionCount: courses.questionCount,
      subjectSlug: subjects.slug,
      subjectTitle: subjects.title,
    })
    .from(courses)
    .innerJoin(subjects, eq(courses.subjectId, subjects.id))
    .where(and(ilike(courses.title, pattern), eq(courses.isActive, true)))
    .orderBy(asc(courses.title))
    .limit(8);

  return {
    subjects: subjectRows.map((r) => ({ ...r, courseCount: 0 })),
    courses: courseRows.map((r) => ({ ...r, bestScore: null, attemptCount: 0 })),
  };
}
```

Note: `subjectRows` doesn't need `courseCount` for search display, but `SubjectSummary` requires the field, so it's zeroed — same technique `listCoursesBySubject` already uses for per-user columns when `userId` is null.

- [ ] **Step 2: Typecheck**

Run: `cd backend && npm run typecheck`
Expected: no errors (this step has no runtime test yet — Task 2 exercises it through the HTTP layer).

- [ ] **Step 3: Commit**

```bash
cd backend
git add src/models/catalog.model.ts
git commit -m "feat(catalog): add searchCatalog model function"
```

---

### Task 2: Backend — `GET /search` route and controller

**Files:**
- Modify: `backend/src/controllers/catalog.controller.ts`
- Modify: `backend/src/routes/catalog.routes.ts`
- Test: `backend/src/controllers/catalog.controller.test.ts`

**Interfaces:**
- Consumes: `searchCatalog` from `catalog.model.ts` (Task 1).
- Produces: `GET /api/v1/search?q=` — the frontend's `quizApi.search` (Task 3) depends on this exact path and response shape (`{ subjects, courses }`, each `course` carrying `subjectSlug`/`subjectTitle`).

- [ ] **Step 1: Write the failing tests**

Append to `backend/src/controllers/catalog.controller.test.ts`:

```ts
test('GET /api/v1/search matches subject and course titles', async () => {
  const res = await fetch(`${baseUrl}/api/v1/search?q=tire`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    subjects: Array<{ slug: string }>;
    courses: Array<{ slug: string; subjectSlug: string; subjectTitle: string }>;
  };
  assert.equal(body.subjects.length, 0);
  assert.equal(body.courses.length, 2);
  assert.equal(
    body.courses.some((c) => c.slug === 'chassis-tire-and-rim-essentials'),
    true,
  );
  assert.equal(body.courses[0]?.subjectSlug, 'chassis');
  assert.equal(body.courses[0]?.subjectTitle, 'Chassis');
});

test('GET /api/v1/search matches a subject title', async () => {
  const res = await fetch(`${baseUrl}/api/v1/search?q=chas`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { subjects: Array<{ slug: string }> };
  assert.equal(body.subjects.length, 1);
  assert.equal(body.subjects[0]?.slug, 'chassis');
});

test('GET /api/v1/search is case-insensitive', async () => {
  const res = await fetch(`${baseUrl}/api/v1/search?q=TIRE`);
  const body = (await res.json()) as { courses: unknown[] };
  assert.equal(body.courses.length, 2);
});

test('GET /api/v1/search excludes a soft-deleted course', async () => {
  const [course] = await db
    .select({ id: courses.id })
    .from(courses)
    .where(eq(courses.slug, 'chassis-tire-and-rim-essentials'));
  await db
    .update(courses)
    .set({ isActive: false, deletedAt: new Date() })
    .where(eq(courses.id, course!.id));

  const res = await fetch(`${baseUrl}/api/v1/search?q=tire`);
  const body = (await res.json()) as { courses: Array<{ slug: string }> };
  assert.equal(
    body.courses.some((c) => c.slug === 'chassis-tire-and-rim-essentials'),
    false,
  );

  await db.update(courses).set({ isActive: true, deletedAt: null }).where(eq(courses.id, course!.id));
});

test('GET /api/v1/search treats a wildcard character literally', async () => {
  const res = await fetch(`${baseUrl}/api/v1/search?q=${encodeURIComponent('%')}`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { subjects: unknown[]; courses: unknown[] };
  assert.equal(body.subjects.length, 0);
  assert.equal(body.courses.length, 0);
});

test('GET /api/v1/search returns empty results for a 1-character query', async () => {
  const res = await fetch(`${baseUrl}/api/v1/search?q=t`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { subjects: unknown[]; courses: unknown[] };
  assert.equal(body.subjects.length, 0);
  assert.equal(body.courses.length, 0);
});

test('GET /api/v1/search 400s when q is missing', async () => {
  const res = await fetch(`${baseUrl}/api/v1/search`);
  assert.equal(res.status, 400);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npm test`
Expected: FAIL — the new `/search` tests fail because the route doesn't exist yet (requests 404 instead of matching the asserted statuses/bodies). All other tests in the file still pass.

- [ ] **Step 3: Implement the controller and route**

Add to `backend/src/controllers/catalog.controller.ts`:

```ts
import {
  findSubjectBySlug,
  listCoursesBySubject,
  listSubjects,
  searchCatalog,
} from '../models/catalog.model.ts';
```

(replacing the existing import list), then append:

```ts
export async function search(req: Request, res: Response): Promise<void> {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!q) {
    res.status(400).json({ error: 'A q query parameter is required' });
    return;
  }

  if (q.length < 2) {
    res.json({ subjects: [], courses: [] });
    return;
  }

  res.json(await searchCatalog(q));
}
```

Add to `backend/src/routes/catalog.routes.ts`:

```ts
catalogRouter.get('/search', catalog.search);
```

(placed after the existing two route lines).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npm test`
Expected: PASS — all tests in `catalog.controller.test.ts`, including the new `/search` ones, plus the full existing suite (no regressions).

- [ ] **Step 5: Commit**

```bash
cd backend
git add src/controllers/catalog.controller.ts src/routes/catalog.routes.ts src/controllers/catalog.controller.test.ts
git commit -m "feat(api): add GET /search for subjects and courses"
```

---

### Task 3: Frontend — API client

**Files:**
- Modify: `frontend/src/quiz/api.ts`
- Test: covered by Task 4/5 (hook and component tests mock `quizApi.search` directly, matching how `listSubjects`/`listCourses` are tested — this file has no standalone API-client test today)

**Interfaces:**
- Consumes: `request` from `../lib/apiClient`, `CourseSummary`/`SubjectSummary` already defined in this file.
- Produces:
  ```ts
  export type SearchCourseResult = CourseSummary & { subjectSlug: string; subjectTitle: string };
  search: (q: string) => Promise<{ subjects: SubjectSummary[]; courses: SearchCourseResult[] }>
  ```
  Task 4's `useGlobalSearch` calls `quizApi.search(q)`.

- [ ] **Step 1: Add the type and client method**

Add to `frontend/src/quiz/api.ts`, after `CourseSummary`:

```ts
export type SearchCourseResult = CourseSummary & { subjectSlug: string; subjectTitle: string };
```

Add inside the `quizApi` object, after `listCourses`:

```ts
  search: (q: string) =>
    request<{ subjects: SubjectSummary[]; courses: SearchCourseResult[] }>(
      `/search?q=${encodeURIComponent(q)}`,
    ),
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npm run build`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd frontend
git add src/quiz/api.ts
git commit -m "feat(api): add quizApi.search client method"
```

---

### Task 4: Frontend — `useGlobalSearch` hook

**Files:**
- Create: `frontend/src/shell/useGlobalSearch.ts`
- Test: `frontend/src/shell/useGlobalSearch.test.ts`

**Interfaces:**
- Consumes: `quizApi.search` (Task 3), `SubjectSummary`/`SearchCourseResult` types from `../quiz/api`.
- Produces:
  ```ts
  export type GlobalSearchState = {
    query: string;
    setQuery: (q: string) => void;
    subjects: SubjectSummary[];
    courses: SearchCourseResult[];
    loading: boolean;
    error: string | null;
  };
  export function useGlobalSearch(): GlobalSearchState
  ```
  Task 5's `GlobalSearch` component consumes this hook.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/shell/useGlobalSearch.test.ts`:

```ts
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { ApiError } from '../quiz/api';
import { useGlobalSearch } from './useGlobalSearch';

const search = vi.fn();

vi.mock('../quiz/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../quiz/api')>();
  return {
    ...actual,
    quizApi: { ...actual.quizApi, search: (q: string) => search(q) },
  };
});

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  search.mockResolvedValue({ subjects: [], courses: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useGlobalSearch', () => {
  test('does not search for a query under 2 characters', async () => {
    const { result } = renderHook(() => useGlobalSearch());

    act(() => result.current.setQuery('t'));
    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(search).not.toHaveBeenCalled();
    expect(result.current.subjects).toEqual([]);
    expect(result.current.courses).toEqual([]);
  });

  test('debounces and then searches once the query settles', async () => {
    search.mockResolvedValue({
      subjects: [{ id: 's1', slug: 'chassis', title: 'Chassis', courseCount: 11 }],
      courses: [],
    });
    const { result } = renderHook(() => useGlobalSearch());

    act(() => result.current.setQuery('ch'));
    act(() => result.current.setQuery('cha'));
    act(() => result.current.setQuery('chas'));

    // Mid-typing: no call yet, since each keystroke resets the debounce.
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(search).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    expect(search).toHaveBeenCalledWith('chas');
    expect(result.current.subjects).toEqual([
      { id: 's1', slug: 'chassis', title: 'Chassis', courseCount: 11 },
    ]);
  });

  test('a later response is not clobbered by an earlier, slower one', async () => {
    let resolveFirst!: (v: { subjects: never[]; courses: never[] }) => void;
    search.mockImplementationOnce(
      () => new Promise((resolve) => (resolveFirst = resolve)),
    );
    search.mockResolvedValueOnce({
      subjects: [{ id: 's2', slug: 'engine', title: 'Engine', courseCount: 9 }],
      courses: [],
    });

    const { result } = renderHook(() => useGlobalSearch());

    act(() => result.current.setQuery('cha'));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    act(() => result.current.setQuery('eng'));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    await waitFor(() => expect(search).toHaveBeenCalledTimes(2));
    resolveFirst({ subjects: [], courses: [] });

    await waitFor(() =>
      expect(result.current.subjects).toEqual([
        { id: 's2', slug: 'engine', title: 'Engine', courseCount: 9 },
      ]),
    );
  });

  test('a failed search sets an error and clears results', async () => {
    search.mockRejectedValue(new ApiError('search down', 500));
    const { result } = renderHook(() => useGlobalSearch());

    act(() => result.current.setQuery('cha'));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    await waitFor(() => expect(result.current.error).toBe('search down'));
    expect(result.current.subjects).toEqual([]);
    expect(result.current.courses).toEqual([]);
  });

  test('clearing the query back below 2 characters clears results without a new search', async () => {
    search.mockResolvedValue({
      subjects: [{ id: 's1', slug: 'chassis', title: 'Chassis', courseCount: 11 }],
      courses: [],
    });
    const { result } = renderHook(() => useGlobalSearch());

    act(() => result.current.setQuery('cha'));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    await waitFor(() => expect(result.current.subjects).toHaveLength(1));

    act(() => result.current.setQuery(''));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current.subjects).toEqual([]);
    expect(search).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/shell/useGlobalSearch.test.ts`
Expected: FAIL with "Failed to resolve import ./useGlobalSearch" (file doesn't exist).

- [ ] **Step 3: Implement the hook**

Create `frontend/src/shell/useGlobalSearch.ts`:

```ts
import { useEffect, useState } from 'react';
import { quizApi, type SearchCourseResult, type SubjectSummary } from '../quiz/api';

export type GlobalSearchState = {
  query: string;
  setQuery: (q: string) => void;
  subjects: SubjectSummary[];
  courses: SearchCourseResult[];
  loading: boolean;
  error: string | null;
};

const DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;

/**
 * Debounced search against GET /search. Below MIN_QUERY_LENGTH the results
 * are cleared locally with no request — short queries are noisy and cheap
 * to reject before they ever leave the browser.
 */
export function useGlobalSearch(): GlobalSearchState {
  const [query, setQuery] = useState('');
  const [subjects, setSubjects] = useState<SubjectSummary[]>([]);
  const [courses, setCourses] = useState<SearchCourseResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = query.trim();

    if (trimmed.length < MIN_QUERY_LENGTH) {
      setSubjects([]);
      setCourses([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const timer = setTimeout(() => {
      void quizApi
        .search(trimmed)
        .then((res) => {
          if (cancelled) return;
          setSubjects(res.subjects);
          setCourses(res.courses);
          setError(null);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setSubjects([]);
          setCourses([]);
          setError(err instanceof Error ? err.message : 'Search failed');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  return { query, setQuery, subjects, courses, loading, error };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/shell/useGlobalSearch.test.ts`
Expected: PASS, all 6 tests.

- [ ] **Step 5: Commit**

```bash
cd frontend
git add src/shell/useGlobalSearch.ts src/shell/useGlobalSearch.test.ts
git commit -m "feat(shell): add useGlobalSearch debounced search hook"
```

---

### Task 5: Frontend — `SearchIcon`

**Files:**
- Modify: `frontend/src/shell/icons.tsx`

**Interfaces:**
- Produces: `export function SearchIcon({ className }: IconProps)`, used by Task 6's `GlobalSearch` component.

- [ ] **Step 1: Add the icon**

Add to `frontend/src/shell/icons.tsx`, after `ChevronRightIcon`:

```tsx
export function SearchIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npm run build`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd frontend
git add src/shell/icons.tsx
git commit -m "feat(shell): add SearchIcon"
```

---

### Task 6: Frontend — `GlobalSearch` component

**Files:**
- Create: `frontend/src/shell/GlobalSearch.tsx`
- Test: `frontend/src/shell/GlobalSearch.test.tsx`

**Interfaces:**
- Consumes: `useGlobalSearch` (Task 4), `SearchIcon` (Task 5), `useNavigate` from `react-router`.
- Produces: `export function GlobalSearch()` — a self-contained component with no props, rendered by Task 7 inside `AppShell`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/shell/GlobalSearch.test.tsx`:

```tsx
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { GlobalSearch } from './GlobalSearch';

const search = vi.fn();

vi.mock('../quiz/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../quiz/api')>();
  return {
    ...actual,
    quizApi: { ...actual.quizApi, search: (q: string) => search(q) },
  };
});

function renderAt(path = '/subjects') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/subjects" element={<GlobalSearch />} />
        <Route path="/subjects/:slug" element={<div>SUBJECT PAGE</div>} />
        <Route path="/courses/:slug/quiz" element={<div>QUIZ PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const input = () => screen.getByRole('combobox', { name: 'Search subjects and quizzes' });

beforeEach(() => {
  search.mockResolvedValue({
    subjects: [{ id: 's1', slug: 'chassis', title: 'Chassis', courseCount: 11 }],
    courses: [
      {
        id: 'c1',
        slug: 'chassis-tire-and-rim-essentials',
        title: 'Tire and Rim Essentials',
        position: 1,
        passScore: 9,
        questionCount: 10,
        bestScore: null,
        attemptCount: 0,
        subjectSlug: 'chassis',
        subjectTitle: 'Chassis',
      },
    ],
  });
});

describe('GlobalSearch', () => {
  test('typing shows matching subjects and quizzes', async () => {
    renderAt();
    await userEvent.type(input(), 'cha');

    expect(await screen.findByRole('option', { name: /Chassis/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Tire and Rim Essentials/ })).toBeInTheDocument();
  });

  test('a one-character query shows no dropdown', async () => {
    renderAt();
    await userEvent.type(input(), 'c');

    expect(search).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  test('clicking a subject result navigates to the subject page', async () => {
    renderAt();
    await userEvent.type(input(), 'cha');

    await userEvent.click(await screen.findByRole('option', { name: /Chassis/ }));

    expect(await screen.findByText('SUBJECT PAGE')).toBeInTheDocument();
  });

  test('clicking a quiz result navigates straight into the quiz', async () => {
    renderAt();
    await userEvent.type(input(), 'cha');

    await userEvent.click(await screen.findByRole('option', { name: /Tire and Rim Essentials/ }));

    expect(await screen.findByText('QUIZ PAGE')).toBeInTheDocument();
  });

  test('arrow keys move the highlighted option and Enter navigates it', async () => {
    renderAt();
    await userEvent.type(input(), 'cha');
    await screen.findByRole('option', { name: /Chassis/ });

    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');

    expect(await screen.findByText('QUIZ PAGE')).toBeInTheDocument();
  });

  test('Escape closes the dropdown', async () => {
    renderAt();
    await userEvent.type(input(), 'cha');
    await screen.findByRole('option', { name: /Chassis/ });

    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  test('no matches shows a message instead of an empty panel', async () => {
    search.mockResolvedValue({ subjects: [], courses: [] });
    renderAt();
    await userEvent.type(input(), 'zzz');

    expect(await screen.findByText('No matches')).toBeInTheDocument();
  });

  test('clicking outside closes the dropdown', async () => {
    renderAt();
    await userEvent.type(input(), 'cha');
    await screen.findByRole('option', { name: /Chassis/ });

    await userEvent.click(document.body);

    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/shell/GlobalSearch.test.tsx`
Expected: FAIL with "Failed to resolve import ./GlobalSearch" (file doesn't exist).

- [ ] **Step 3: Implement the component**

Create `frontend/src/shell/GlobalSearch.tsx`:

```tsx
import { useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { SearchIcon } from './icons';
import { useGlobalSearch } from './useGlobalSearch';

type ResultItem =
  | { kind: 'subject'; key: string; label: string; sublabel: null; href: string }
  | { kind: 'course'; key: string; label: string; sublabel: string; href: string };

/**
 * Top-nav search bar: debounced title search across subjects and quizzes,
 * with a keyboard-navigable dropdown. Self-contained — AppShell renders it
 * with no props.
 */
export function GlobalSearch() {
  const { query, setQuery, subjects, courses, error } = useGlobalSearch();
  const navigate = useNavigate();
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  const items: ResultItem[] = useMemo(
    () => [
      ...subjects.map((s): ResultItem => ({
        kind: 'subject',
        key: `subject-${s.id}`,
        label: s.title,
        sublabel: null,
        href: `/subjects/${s.slug}`,
      })),
      ...courses.map((c): ResultItem => ({
        kind: 'course',
        key: `course-${c.id}`,
        label: c.title,
        sublabel: c.subjectTitle,
        href: `/courses/${c.slug}/quiz`,
      })),
    ],
    [subjects, courses],
  );

  const trimmed = query.trim();
  const showPanel = open && trimmed.length >= 2;

  function go(item: ResultItem) {
    navigate(item.href);
    setQuery('');
    setOpen(false);
    setHighlighted(-1);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showPanel) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((i) => (items.length === 0 ? -1 : (i + 1) % items.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((i) => (items.length === 0 ? -1 : (i - 1 + items.length) % items.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = items[highlighted];
      if (item) go(item);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setHighlighted(-1);
    }
  }

  function handleBlur(e: React.FocusEvent<HTMLDivElement>) {
    if (!containerRef.current?.contains(e.relatedTarget)) {
      setOpen(false);
      setHighlighted(-1);
    }
  }

  return (
    <div className="global-search" ref={containerRef} onBlur={handleBlur}>
      <SearchIcon className="global-search-icon" />
      <input
        type="text"
        role="combobox"
        aria-label="Search subjects and quizzes"
        aria-expanded={showPanel}
        aria-controls={listboxId}
        aria-activedescendant={highlighted >= 0 ? items[highlighted]?.key : undefined}
        className="global-search-input"
        placeholder="Search subjects and quizzes"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setHighlighted(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
      />

      {showPanel && (
        <ul id={listboxId} role="listbox" className="global-search-panel">
          {error && <li className="global-search-note">{error}</li>}

          {!error && items.length === 0 && <li className="global-search-note">No matches</li>}

          {!error &&
            items.map((item, index) => (
              <li key={item.key} role="presentation">
                <button
                  type="button"
                  id={item.key}
                  role="option"
                  aria-selected={index === highlighted}
                  className={
                    index === highlighted ? 'global-search-option highlighted' : 'global-search-option'
                  }
                  onMouseEnter={() => setHighlighted(index)}
                  onClick={() => go(item)}
                >
                  <span className="global-search-option-label">{item.label}</span>
                  {item.sublabel && (
                    <span className="global-search-option-sublabel">{item.sublabel}</span>
                  )}
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/shell/GlobalSearch.test.tsx`
Expected: PASS, all 8 tests.

- [ ] **Step 5: Commit**

```bash
cd frontend
git add src/shell/GlobalSearch.tsx src/shell/GlobalSearch.test.tsx
git commit -m "feat(shell): add GlobalSearch dropdown component"
```

---

### Task 7: Frontend — wire into `AppShell` and style

**Files:**
- Modify: `frontend/src/shell/AppShell.tsx`
- Modify: `frontend/src/shell/AppShell.test.tsx`
- Modify: `frontend/src/App.css`

**Interfaces:**
- Consumes: `GlobalSearch` (Task 6).
- Produces: nothing new — this is the integration point, no other task depends on it.

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/shell/AppShell.test.tsx`, in a new `describe` block (after the existing `describe('AppShell — theme toggle', ...)` block is fine):

```tsx
describe('AppShell — global search', () => {
  test('renders the search bar in the top nav', async () => {
    renderAt();
    await nav();

    expect(
      screen.getByRole('combobox', { name: 'Search subjects and quizzes' }),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/shell/AppShell.test.tsx`
Expected: FAIL — no element with that role/name exists yet.

- [ ] **Step 3: Render `GlobalSearch` in the top nav**

In `frontend/src/shell/AppShell.tsx`, add the import:

```tsx
import { GlobalSearch } from './GlobalSearch';
```

Then update the `<header className="topnav">` block to insert `<GlobalSearch />` between the brand link and `topnav-right`:

```tsx
        <Link to="/subjects" className="topnav-brand">
          <img src={liahLogo} alt="" className="topnav-mark" />
          LIAH Learning
        </Link>

        <GlobalSearch />

        <div className="topnav-right">
```

- [ ] **Step 4: Add styles**

Add to `frontend/src/App.css`, after the `.topnav-right` rule (around line 466):

```css
.global-search { position: relative; flex: 1 1 auto; max-width: 22rem; margin: 0 0.5rem; }

.global-search-icon {
  position: absolute;
  left: 0.6rem;
  top: 50%;
  transform: translateY(-50%);
  width: 1rem;
  height: 1rem;
  color: var(--text);
  pointer-events: none;
}

.global-search-input {
  width: 100%;
  height: 2.25rem;
  padding: 0 0.75rem 0 2rem;
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  background: var(--surface);
  color: inherit;
  font-size: 0.9rem;
}
.global-search-input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.global-search-panel {
  position: absolute;
  top: calc(100% + 0.25rem);
  left: 0;
  right: 0;
  margin: 0;
  padding: 0.25rem;
  list-style: none;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  box-shadow: var(--shadow);
  max-height: 20rem;
  overflow-y: auto;
  z-index: 40;
}

.global-search-note { padding: 0.5rem 0.6rem; color: var(--text); font-size: 0.85rem; }

.global-search-option {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  width: 100%;
  padding: 0.45rem 0.6rem;
  border: none;
  border-radius: 0.4rem;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  font-size: 0.9rem;
}
.global-search-option:hover,
.global-search-option.highlighted { background: var(--accent-bg); }

.global-search-option-sublabel { font-size: 0.75rem; color: var(--text); }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/shell/AppShell.test.tsx`
Expected: PASS, including the new test and all pre-existing ones (no regressions from the new element in the header).

- [ ] **Step 6: Run the full frontend test suite**

Run: `cd frontend && npm test -- --run`
Expected: PASS — confirms `GlobalSearch`, `useGlobalSearch`, and `AppShell` all pass together with no cross-test interference.

- [ ] **Step 7: Commit**

```bash
cd frontend
git add src/shell/AppShell.tsx src/shell/AppShell.test.tsx src/App.css
git commit -m "feat(shell): wire GlobalSearch into the top nav"
```

---

### Task 8: Full-stack smoke check

**Files:** none (manual verification only)

**Interfaces:** none — this task consumes the finished feature end-to-end and produces nothing for later tasks.

- [ ] **Step 1: Run both test suites**

Run:
```bash
cd backend && npm test
cd ../frontend && npm test -- --run
```
Expected: both PASS in full.

- [ ] **Step 2: Start the app and exercise the search bar manually**

Run (from repo root, or however this project is normally started — check `README.md` / `docker-compose.yml` if unsure):
```bash
docker-compose up -d
```
Then sign in, and in the top nav:
- Type a 1-character query → no dropdown appears.
- Type a subject title fragment (e.g. "chas") → the subject appears under "Subjects"; clicking it navigates to `/subjects/chassis`.
- Type a quiz title fragment (e.g. "tire") → matching quizzes appear under "Quizzes" with their subject as a sub-label; clicking one navigates straight into `/courses/<slug>/quiz`.
- Type a nonsense query → "No matches".
- Use ArrowDown/ArrowUp/Enter to navigate and select a result without the mouse.
- Press Escape while the dropdown is open → it closes.

- [ ] **Step 3: Report completion**

No commit — this task is verification only. If any manual check fails, return to the relevant task above and fix it before considering the plan complete.
