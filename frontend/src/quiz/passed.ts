/**
 * Whether a course counts as passed. Takes the *best* score, never a single
 * attempt's: a weaker retake must not revoke a pass.
 *
 * `null` means never attempted, which is distinct from scoring zero.
 */
export function hasPassed(bestScore: number | null, passScore: number): boolean {
  return bestScore !== null && bestScore >= passScore;
}
