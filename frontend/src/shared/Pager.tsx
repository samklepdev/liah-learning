type PagerProps = {
  page: number;
  totalPages: number;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
};

export function Pager({ page, totalPages, canPrev, canNext, onPrev, onNext }: PagerProps) {
  return (
    <div className="admin-pager">
      <button type="button" className="auth-submit-secondary" disabled={!canPrev} onClick={onPrev}>
        Prev
      </button>
      <span>
        Page {page} of {totalPages}
      </span>
      <button type="button" className="auth-submit-secondary" disabled={!canNext} onClick={onNext}>
        Next
      </button>
    </div>
  );
}
