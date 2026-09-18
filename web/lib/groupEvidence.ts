// V2.7e C1 — the GROUP EVIDENCE composer: what one scorecard group's doorway actually opens onto.
//
// The run document's 2.4 rows SELECT a group (the ratified canvas, form 1d); one selection renders
// the evidence strip from THIS composer — voices per grounding, the group's three cells WITH their
// confidence and note (the first body-text render of cell notes anywhere in the document; before e
// they were hover titles on the Watch scorecard), and the one agent the "Ask one" door opens on.
// Everything here is read from the ARTIFACT (never the report), so the strip can only ever describe
// the loaded run — the first wrong-run predicate answered by construction.
//
// THE PICK RULE (ratified 2026-09-17): the room seed and the Ask door share ONE stated rule — each
// group's largest-consequence simulated voices first (|scenario − baseline| descending, TIES BY
// ARTIFACT INDEX so the order is total and a synthetic run with many 0.0 deltas seeds in artifact
// order among ties), then inferred voices in artifact order; the room alternates A, B, A, B, A up
// to ROOM_MAX. When one group runs out the alternation backfills from the other and the seed NOTE
// states the actual counts — one derived template, always true (the imbalance rider). A pair whose
// combined supply is under ROOM_MIN gets NO seed, so the CTA never renders as a door that fails.
import type { Agent, ScorecardCell, TrajectoryArtifact } from './types';
import { GROUP_LABEL, groupOfAgent } from './personaGroups';

/** The room's size rule — ONE source (RoomDrawer, MapView and the feed's titles read these). */
export const ROOM_MIN = 3;
export const ROOM_MAX = 5;

export interface CellEvidence {
  key: 'travel' | 'safety' | 'access';
  label: string;
  value: number | null;
  affectedShare: number | null;
  confidence: 'measured' | 'low' | null;
  note: string | null;
}

export interface GroupEvidence {
  gid: string;
  label: string;
  grounding: string | null;
  voices: { sim: number; inferred: number; total: number };
  /** The Ask door's agent — an ELEMENT of artifact.agents (reference identity: the interview
   *  drawer and the room resolve agents by indexOf). Null when the group has no voice. */
  firstAgent: Agent | null;
  cells: CellEvidence[];
}

export interface RoomSeed {
  pairs: { agent: Agent; index: number }[];
  counts: { a: number; b: number };
}

function consequence(a: Agent): number {
  const o = a.outcome;
  if (!o) return 0;
  const d = o.delta_seconds ?? o.scenario_duration - o.baseline_duration;
  return Number.isFinite(d) ? Math.abs(d) : 0;
}

/** Older artifacts (pre-0.3.0) carry no grounding and are treated as sim, like everywhere else. */
function isInferred(a: Agent): boolean {
  return a.grounding === 'inferred';
}

function members(artifact: TrajectoryArtifact, gid: string): { a: Agent; i: number }[] {
  return (artifact.agents ?? [])
    .map((a, i) => ({ a, i }))
    .filter((m) => m.a.grounding !== 'mandate' && groupOfAgent(m.a) === gid);
}

/** The group's voices in PICK ORDER: simulated by |delta| descending (ties by artifact index),
 *  then inferred in artifact index order. Mandate voices belong to no scorecard group. */
export function rankedVoices(artifact: TrajectoryArtifact, gid: string): Agent[] {
  const ms = members(artifact, gid);
  const sims = ms.filter((m) => !isInferred(m.a)).sort((x, y) => consequence(y.a) - consequence(x.a) || x.i - y.i);
  const infs = ms.filter((m) => isInferred(m.a));
  return [...sims, ...infs].map((m) => m.a);
}

function cell(key: CellEvidence['key'], label: string, c: ScorecardCell | null | undefined): CellEvidence {
  return {
    key,
    label,
    value: c?.value ?? null,
    affectedShare: c?.affected_share ?? null,
    confidence: c?.confidence ?? null,
    note: c?.note ?? null,
  };
}

export function groupEvidence(artifact: TrajectoryArtifact, gid: string): GroupEvidence {
  const ms = members(artifact, gid);
  const inferred = ms.filter((m) => isInferred(m.a)).length;
  const sim = ms.length - inferred;
  const g = artifact.scorecard?.groups.find((x) => x.group === gid) ?? null;
  const ranked = rankedVoices(artifact, gid);
  return {
    gid,
    label: GROUP_LABEL[gid] ?? gid,
    grounding: g?.grounding ?? null,
    voices: { sim, inferred, total: ms.length },
    firstAgent: ranked[0] ?? null,
    cells: [
      cell('travel', 'travel', g?.travel_time_delta),
      cell('safety', 'safety', g?.safety_delta),
      cell('access', 'access', g?.access_delta),
    ],
  };
}

/** The two-group room seed, or null when the pair cannot fill a room (supply < ROOM_MIN). */
export function roomSeed(artifact: TrajectoryArtifact, a: string, b: string): RoomSeed | null {
  const ra = rankedVoices(artifact, a);
  const rb = rankedVoices(artifact, b);
  if (ra.length + rb.length < ROOM_MIN) return null;
  const agents = artifact.agents ?? [];
  const pairs: RoomSeed['pairs'] = [];
  let ia = 0;
  let ib = 0;
  let turnA = true;
  while (pairs.length < ROOM_MAX && (ia < ra.length || ib < rb.length)) {
    const takeA = turnA ? ia < ra.length : ib >= rb.length;
    const agent = takeA ? ra[ia++] : rb[ib++];
    pairs.push({ agent, index: agents.indexOf(agent) });
    turnA = !turnA;
  }
  return { pairs, counts: { a: ia, b: ib } };
}

/** The room's seed note — ONE derived template, always true, whatever the balance. */
export function seedNote(labelA: string, nA: number, labelB: string, nB: number): string {
  return `seeded ${nA} from ${labelA}, ${nB} from ${labelB} — most-affected first; add or remove anyone`;
}
