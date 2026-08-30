import { fmtWindowRange } from '@/lib/simTime';

// V2.7a — hoisted verbatim from MapView (the scope note is now rendered by BOTH the Watch
// rail's ScorecardPanel and the Read stage's RunDocument; one derivation, two surfaces).
// V2.2 closeout / V2.4b: the windowed-scope summary for the ScorecardPanel note, or null when
// nothing is windowed. Windowed members only — a permanent member neither narrows nor widens the
// span — and DISPLAY bounds clamp to [0, sim_end] (a window may legally end past the sim ceiling;
// the line must never claim activity outside the run). `differing` (>1 distinct window pair) and
// the windowed-vs-total counts drive the note's span clause + mechanical subject. `disjoint`
// (V2.5a, line-faithful port of zone_lens.windows_disjoint) is true iff ALL members are windowed
// AND the merged window union leaves a gap strictly inside the span — a permanent member fills
// every gap; touching windows (end === start) are contiguous. Lockstep with the Python
// convention: report.build_scope_disclosure over zone_lens.resolve_window.
export function windowedScope(
  changes: { window?: { start_s: number; end_s: number } | null }[],
  simEnd: number,
): {
  span: { start_s: number; end_s: number };
  differing: boolean;
  disjoint: boolean;
  windowedCount: number;
  total: number;
} | null {
  const ws = changes.flatMap((c) => (c.window ? [c.window] : []));
  if (!ws.length) return null;
  let disjoint = false;
  if (ws.length === changes.length && ws.length >= 2) {
    const sorted = [...ws].sort((a, b) => a.start_s - b.start_s || a.end_s - b.end_s);
    let end = sorted[0].end_s;
    for (const w of sorted.slice(1)) {
      if (w.start_s > end) {
        disjoint = true;
        break;
      }
      end = Math.max(end, w.end_s);
    }
  }
  return {
    span: {
      start_s: Math.max(Math.min(...ws.map((w) => w.start_s)), 0),
      end_s: Math.min(Math.max(...ws.map((w) => w.end_s)), simEnd),
    },
    differing: new Set(ws.map((w) => `${w.start_s}:${w.end_s}`)).size > 1,
    disjoint,
    windowedCount: ws.length,
    total: changes.length,
  };
}

export type WindowedScope = NonNullable<ReturnType<typeof windowedScope>>;

/** The scope-disclosure sentence — extracted VERBATIM from ScorecardPanel's JSX so the Watch
 *  rail and the Read document render the byte-same pinned strings (client copy of
 *  zone_lens.span_note + DISJOINT_SPAN_CLAUSE; keep in lockstep with python/src/zone_lens.py). */
export function scopeNoteText(scope: WindowedScope, profile: string | undefined): string {
  const noun =
    scope.windowedCount < scope.total
      ? scope.windowedCount === 1
        ? 'windowed change'
        : 'windowed changes'
      : scope.total === 1
        ? 'change'
        : 'changes';
  return `measures cover the full run; ${noun} active ${fmtWindowRange(scope.span, profile)}${
    scope.differing
      ? ' (members carry differing windows; these figures use the spanning window' +
        (scope.disjoint ? '; the spanning window includes periods where no change was active' : '') +
        ')'
      : ''
  }`;
}
