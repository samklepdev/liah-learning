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
