import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { quizApi, type CourseSummary, type SubjectSummary } from '../quiz/api';

export type SubjectNavState = {
  subjects: SubjectSummary[];
  loading: boolean;
  error: string | null;
  isOpen: (slug: string) => boolean;
  /** Courses per subject slug; undefined until that group has been opened. */
  courses: Readonly<Record<string, CourseSummary[] | undefined>>;
  toggle: (slug: string) => void;
};

/**
 * Subjects for the sidebar, with each subject's quizzes fetched lazily the
 * first time its group opens — eight requests up front would load a list that
 * mostly stays collapsed.
 *
 * Open state is *derived*: the group for the subject you are viewing is open
 * unless you explicitly closed it. Deriving rather than setting it in an effect
 * avoids a synchronous setState during render, and means the sidebar always
 * reflects the current route without a syncing effect to get wrong.
 */
export function useSubjectNav(currentSubjectSlug?: string): SubjectNavState {
  const [subjects, setSubjects] = useState<SubjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [courses, setCourses] = useState<Record<string, CourseSummary[] | undefined>>({});
  /** Explicit user open/closed choices, overriding the route-derived default. */
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  /** Requests in flight. A ref, so tracking them causes no re-render. */
  const inFlight = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const res = await quizApi.listSubjects();
        if (!cancelled) setSubjects(res.subjects);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load subjects');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const isOpen = useCallback(
    (slug: string) => overrides[slug] ?? slug === currentSubjectSlug,
    [overrides, currentSubjectSlug],
  );

  const openSlugs = useMemo(
    () => subjects.map((s) => s.slug).filter(isOpen),
    [subjects, isOpen],
  );

  // Fetch the quizzes for whichever groups are open. Every state write happens
  // after an await, so nothing is set synchronously inside the effect.
  useEffect(() => {
    for (const slug of openSlugs) {
      if (courses[slug] !== undefined || inFlight.current.has(slug)) continue;

      inFlight.current.add(slug);
      void quizApi
        .listCourses(slug)
        .then((res) => setCourses((prev) => ({ ...prev, [slug]: res.courses })))
        // An empty list is a truthful "nothing here" and stops the request
        // retrying every time the group is reopened.
        .catch(() => setCourses((prev) => ({ ...prev, [slug]: [] })))
        .finally(() => inFlight.current.delete(slug));
    }
  }, [openSlugs, courses]);

  const toggle = useCallback(
    (slug: string) => {
      setOverrides((prev) => ({ ...prev, [slug]: !(prev[slug] ?? slug === currentSubjectSlug) }));
    },
    [currentSubjectSlug],
  );

  return { subjects, loading, error, isOpen, courses, toggle };
}
