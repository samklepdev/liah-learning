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
