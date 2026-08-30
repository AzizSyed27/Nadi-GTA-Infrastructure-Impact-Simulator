// V2.7a — the non-completions sentence, extracted VERBATIM from RunCard so the run document and
// the run card compose the identical line (one source; the RunCard toHaveText pins ride it).
//
// INVARIANT (V2.2c, user-confirmed; V2.4b extended to every surface): the split NEVER renders
// without the backlog-attribution parenthetical — the insertion backlog is STRUCTURAL (the V2.1b
// shortfall), not closure-caused, and the labels stay causally NEUTRAL ("not inserted").
// Per-mode and skip-zero (mirrors report.py): never hardcode cars.

export function nonCompletionsLine(
  nc: Record<string, number> | null | undefined,
  split: Record<string, { entered_not_finished: number; not_inserted: number }> | null | undefined,
  backlog: Record<string, { baseline: number; scenario: number }> | null | undefined,
): string | null {
  const ncTotal = nc ? Object.values(nc).reduce((a, b) => a + b, 0) : null;
  const splitParts = split
    ? Object.entries(split)
        .filter(([, b]) => b.entered_not_finished + b.not_inserted > 0)
        .map(([m, b]) => {
          const bits = [
            b.entered_not_finished > 0 ? `${b.entered_not_finished} stranded en route` : null,
            b.not_inserted > 0 ? `${b.not_inserted} not inserted` : null,
          ].filter(Boolean);
          return `${m}: ${bits.join(', ')}`;
        })
    : [];
  // Backlog sums SCOPED to the modes the split actually names (review-caught: an all-modes sum
  // could silently include a mode whose split is zero — the report's per-mode discipline).
  const namedModes = new Set(
    split
      ? Object.entries(split)
          .filter(([, b]) => b.entered_not_finished + b.not_inserted > 0)
          .map(([m]) => m)
      : [],
  );
  const blEntries = backlog ? Object.entries(backlog).filter(([m]) => namedModes.has(m)) : [];
  const blSums = blEntries.length
    ? blEntries.reduce<[number, number]>((acc, [, b]) => [acc[0] + b.baseline, acc[1] + b.scenario], [0, 0])
    : null;
  return ncTotal != null && ncTotal > 0
    ? splitParts.length
      ? `${ncTotal} travelers did not complete — ${splitParts.join('; ')}${
          blSums
            ? ` (insertion backlog affects baseline too: ${blSums[0]} baseline vs ${blSums[1]} scenario)`
            : ''
        }`
      : `${ncTotal} travelers did not complete under the change`
    : null;
}
