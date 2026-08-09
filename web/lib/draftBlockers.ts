import type { ChangeWindow, EdgeEligibility, SimChange } from '@/lib/api';

/**
 * V2.4a — draft-time blockers: the client mirror of python/src/change_scheduler.py's shared
 * rejection predicates, so a planner sees "this draft can't run and why" BEFORE submitting.
 * Every string here is a client copy of a shared constant (the EditPanel D1-sentence convention:
 * comment naming the Python source, Playwright-pinned verbatim); the server 400 with the same
 * words stays the backstop. The mirror covers ONLY D2's stable predicate set — the transitional
 * V2.2d composite rules (REASON_COMPOSITE_MEMBER, REASON_COMPOSITE_SETTLED) are deliberately NOT
 * mirrored: V2.4b lifts them, and until then a mixed multi-member draft submits and renders the
 * server's 400 verbatim in the DraftPanel (the existing detail-verbatim convention).
 */

// client copy of change_scheduler.REASON_SETTLED_SEVERED (python/src/change_scheduler.py:39-42)
export const REASON_SETTLED_SEVERED =
  'closures can strand trips that start or end on the closed road; equilibrium assignment ' +
  'cannot honestly settle a severed network — use day-one response';

/** The member's window, or null — new_road/bike_lane can never carry one. */
export function memberWindow(c: SimChange): ChangeWindow | null {
  return 'window' in c && c.window != null ? c.window : null;
}

/** Any windowed member ⇒ the D1 day-one lock holds at draft level (not only while a palette is open). */
export function hasWindowedMember(members: SimChange[]): boolean {
  return members.some((c) => memberWindow(c) !== null);
}

/**
 * Does this member sever the network? road_closure always; lane_closure only when it closes EVERY
 * car lane of its edge (the server's closes_all_car_lanes check). Missing eligibility metadata →
 * false: the client stays conservative and lets the server 400 decide. incident never severs here —
 * it is always windowed, so the D1 lock already forbids settled.
 */
export function severs(c: SimChange, eligById: Record<string, EdgeEligibility>): boolean {
  if (c.type === 'road_closure') return true;
  if (c.type !== 'lane_closure') return false;
  const car = eligById[c.target_edge]?.car_lane_indices;
  if (!car || car.length === 0) return false;
  return car.every((idx) => c.target_lanes.includes(idx));
}

// TS port of change_scheduler.lifo_conflict_reason (python/src/change_scheduler.py:116-140).
// Phase constants from :281 — revert sorts BEFORE apply at an equal timestamp; that tie-break is
// what makes windows touching at end == start LEGAL (the phased-closure shape, pinned Python-side
// at t=499/500/501 in test_change_scheduler.py). Crossing uses the stack replay, never a >=
// comparison — a false blocker here is uncatchable by the server backstop (the draft would never
// be submitted).
const PHASE_REVERT = 0;
const PHASE_APPLY = 1;

/**
 * PURE per-edge LIFO well-formedness on the RAW windows (windowed members only): replay the event
 * sequence with a stack; every revert must pop its own apply. Crossing same-edge windows cannot be
 * reverted correctly (LIFO revert restores captured state); nested/disjoint/touching are legal.
 * The returned string mirrors the Python f-string with its !r single-quoted edge id.
 */
export function lifoConflictReason(members: SimChange[]): string | null {
  const raw: [number, number, number, number][] = []; // [t, phase, order, idx]
  members.forEach((c, i) => {
    const w = memberWindow(c);
    if (w === null) return; // unwindowed members never enter the replay (:124-125)
    raw.push([w.start_s, PHASE_APPLY, i, i]);
    raw.push([w.end_s, PHASE_REVERT, -i, i]);
  });
  raw.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  const stacks: Record<string, number[]> = {};
  for (const [, phase, , idx] of raw) {
    const edge = (members[idx] as { target_edge: string }).target_edge;
    const st = (stacks[edge] ??= []);
    if (phase === PHASE_APPLY) {
      st.push(idx);
    } else if (st.length === 0 || st[st.length - 1] !== idx) {
      return (
        `windows on the same edge ('${edge}') must be disjoint or nested — crossing ` +
        `windows cannot be reverted correctly (LIFO revert restores captured state)`
      );
    } else {
      st.pop();
    }
  }
  return null;
}

/**
 * The draft's blockers, ordered, each reason at most once. `assignment` is the EFFECTIVE one
 * (after the D1 lock), so settled here means the user genuinely selected it on an unwindowed
 * draft. An empty array ⇔ the Run button is live.
 */
export function deriveBlockers(
  members: SimChange[],
  assignment: 'day_one' | 'settled',
  eligById: Record<string, EdgeEligibility>,
): string[] {
  const out: string[] = [];
  if (assignment === 'settled' && members.some((c) => severs(c, eligById))) {
    out.push(REASON_SETTLED_SEVERED);
  }
  const lifo = lifoConflictReason(members);
  if (lifo !== null) out.push(lifo);
  return out;
}
