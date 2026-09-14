// V2.7d C4a — the drop form's LANE ROWS. PURE: derives the ratified "EB general 1 / EB bus (curb) /
// WB general 1" rows from the network export's per-lane table (index 0 = curb) and the server's
// closable set (`/api/edges` car_lane_indices), for the dropped edge AND its node-pair partner; emits
// one `lane_closure` member per directional edge; and composes the per-direction sentence the user's
// ratification made a condition of the both-directions form: ticking EB only closes eastbound only,
// and the form SAYS so before Run (the gap between "the street" and "one direction of the street" is
// where planner intent and sim input silently diverge). lane-rows.spec.ts pins every literal.

import { bearingDeg, type NetworkEdge } from './network';
import type { ChangeWindow, SimChange } from './api';

export type Compass = 'N' | 'E' | 'S' | 'W';

/** 90° sectors with boundaries at 45 / 135 / 225 / 315 (a bearing of exactly 45 is E). */
export function compassInitial(bearing: number): Compass {
  const b = ((bearing % 360) + 360) % 360;
  if (b >= 315 || b < 45) return 'N';
  if (b < 135) return 'E';
  if (b < 225) return 'S';
  return 'W';
}

const DIR_WORD: Record<Compass, string> = { N: 'northbound', E: 'eastbound', S: 'southbound', W: 'westbound' };

export function edgeDirection(e: NetworkEdge): Compass {
  const g = e.geometry;
  return compassInitial(bearingDeg(g[0], g[g.length - 1]));
}

export type LaneKind = 'general' | 'bus' | 'bike' | 'sidewalk' | 'other';

export interface LaneRow {
  side: 'primary' | 'partner';
  edgeId: string;
  sumoIndex: number;
  kind: LaneKind;
  /** "EB general 1 (curb)" — direction initial, kind, ordinal per kind from the curb, curb mark. */
  label: string;
  closable: boolean;
  /** Why a car lane is not closable, when it is not (the server's lane list disagrees). */
  reason?: string;
}

export const NOT_ON_SERVER_LIST = "not closable on the server's lane list";

function kindOf(l: NetworkEdge['lanes'][number]): LaneKind {
  const a = l.allows;
  if (a.car) return 'general';
  if (a.bus) return 'bus';
  if (a.bike) return 'bike';
  if (a.ped) return 'sidewalk';
  return 'other';
}

function rowsForEdge(e: NetworkEdge, side: 'primary' | 'partner', closableIdx: number[]): LaneRow[] {
  const dir = edgeDirection(e);
  const counts: Partial<Record<LaneKind, number>> = {};
  const curbIdx = e.lanes.findIndex((l) => kindOf(l) !== 'sidewalk'); // the curbmost NON-sidewalk lane
  return e.lanes.map((l, i) => {
    const kind = kindOf(l);
    // only GENERAL lanes are numbered ("general 1", "general 2"); a bus / bike lane reads as itself
    const ordinal = kind === 'general' ? ` ${(counts[kind] = (counts[kind] ?? 0) + 1)}` : '';
    const curb = i === curbIdx ? ' (curb)' : '';
    const onList = closableIdx.includes(i);
    const closable = kind === 'general' && onList;
    return {
      side, edgeId: e.id, sumoIndex: i, kind,
      label: `${dir}B ${kind}${ordinal}${curb}`,
      closable,
      ...(kind === 'general' && !onList ? { reason: NOT_ON_SERVER_LIST } : {}),
    };
  });
}

/** The dropped edge's rows, then its partner's (when it resolves). */
export function laneRowsFor(
  edge: NetworkEdge,
  partner: NetworkEdge | null,
  closable: { primary: number[]; partner: number[] },
): LaneRow[] {
  const rows = rowsForEdge(edge, 'primary', closable.primary);
  return partner ? [...rows, ...rowsForEdge(partner, 'partner', closable.partner)] : rows;
}

export interface LaneSelection {
  primary: number[];
  partner: number[];
}

/** One `lane_closure` member per directional edge that has a tick; lanes sorted; the same window on each. */
export function emitLaneClosures(
  edge: NetworkEdge,
  partner: NetworkEdge | null,
  sel: LaneSelection,
  window: ChangeWindow | null,
): SimChange[] {
  const out: SimChange[] = [];
  const mk = (target_edge: string, lanes: number[]): SimChange => ({
    type: 'lane_closure', target_edge, target_lanes: [...lanes].sort((a, b) => a - b), ...(window ? { window } : {}),
  });
  if (sel.primary.length) out.push(mk(edge.id, sel.primary));
  if (partner && sel.partner.length) out.push(mk(partner.id, sel.partner));
  return out;
}

/** The both-directions checkbox's sentence for a road closure (`closes`) or a speed limit (`applies`). */
export function applyNote(edge: NetworkEdge, partner: NetworkEdge | null, both: boolean, verb: 'closes' | 'applies'): string {
  const p = DIR_WORD[edgeDirection(edge)];
  if (!partner) return `one-way street — ${p} only`;
  const q = DIR_WORD[edgeDirection(partner)];
  if (verb === 'closes') return both ? 'closes both directions — 2 members' : `closes ${p} only — ${q} stays open`;
  return both ? 'applies to both directions — 2 members' : `applies to ${p} only — ${q} unchanged`;
}

/** THE RATIFIED SENTENCE — said before Run. Null only when nothing is ticked on a two-way street. */
export function directionNote(edge: NetworkEdge, partner: NetworkEdge | null, sel: LaneSelection): string | null {
  const p = DIR_WORD[edgeDirection(edge)];
  if (!partner) return `one-way street — ${p} only`;
  const q = DIR_WORD[edgeDirection(partner)];
  const a = sel.primary.length > 0;
  const b = sel.partner.length > 0;
  if (a && b) return 'closes both directions — 2 members';
  if (a) return `closes ${p} only — ${q} stays open`;
  if (b) return `closes ${q} only — ${p} stays open`;
  return null;
}
