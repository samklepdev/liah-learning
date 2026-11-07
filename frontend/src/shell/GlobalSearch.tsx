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
