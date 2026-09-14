// V2.7d C3 — STREET NAMES on the client. PURE: no React, no deck, no window; every input is the
// network export (`network.json` v2 — the ONE runtime name source on both sides of the boundary).
//
// The two `describeEdge` forms are the TS twin of python's `street_names.describe_edge`, pinned as
// literals in street-names.spec.ts (the lockstep of the compact-time pin): NAME-PLUS-ID, never
// name-instead-of-id — the id stays the falsifiable reference — and id-only when unnamed, which is
// byte-identical to the pre-V2.7d wording so every unnamed fixture renders as before.
//
// The voice card's origin→destination line (C3b) follows the V2.7b rule "only if derivable from the
// network — otherwise trim the line": `nearestEdge` finds the nearest edge OF ANY KIND within
// `OD_THRESHOLD_M` of a trajectory endpoint; if that edge is unnamed the line is omitted. Skipping
// unnamed edges to reach a named one would put a traveller on a street they were not on.
//
// Cross streets (`crossStreets`) walk same-name chains: the car-only import removed the pedestrian
// cross edges, so SUMO split many streets at nodes where no other-named edge remains (2,506 of
// 4,487 named edges resolve both ends at their own nodes; the walk lifts that to 2,963, one end for
// 1,027, neither for 497 — probed 2026-09-13). The degrade ladder is between / near / nothing.

import type { NetworkEdge } from './network';
import type { LonLat } from './types';

export type EdgeLookup = Record<string, NetworkEdge>;

/** The nearest-edge threshold for a trajectory endpoint, metres, inclusive. */
export const OD_THRESHOLD_M = 25;

export function nameOf(lookup: EdgeLookup, id: string): string | null {
  return lookup[id]?.name ?? null;
}

/** `Markham Road (edge -1288863201)` / `edge -1288863201` — the python forms, byte for byte. */
export function edgeLabel(name: string | null, id: string): string {
  return name ? `${name} (edge ${id})` : `edge ${id}`;
}

export function describeEdge(lookup: EdgeLookup, id: string): string {
  return edgeLabel(nameOf(lookup, id), id);
}

/** `from A to B` / `along A` / null when either end did not resolve (the card omits the line). */
export function odLine(origin: string | null, dest: string | null): string | null {
  if (!origin || !dest) return null;
  return origin === dest ? `along ${origin}` : `from ${origin} to ${dest}`;
}

// ---- nearest edge (a coarse grid over segments; local equirectangular metres) ------------------

const M_PER_DEG = 111_195;
const CELL_M = 100;

export interface EdgeGrid {
  cells: Map<string, { edge: NetworkEdge; a: LonLat; b: LonLat }[]>;
  kx: number; // metres per degree of longitude at the grid's latitude
}

function cellKey(xm: number, ym: number): string {
  return `${Math.floor(xm / CELL_M)}:${Math.floor(ym / CELL_M)}`;
}

/** Register every segment of every edge in each 100 m cell its bounding box touches. */
export function buildEdgeGrid(edges: NetworkEdge[]): EdgeGrid {
  const lat0 = edges.length ? edges[0].geometry[0][1] : 43.75;
  const kx = M_PER_DEG * Math.cos((lat0 * Math.PI) / 180);
  const cells = new Map<string, { edge: NetworkEdge; a: LonLat; b: LonLat }[]>();
  for (const edge of edges) {
    const g = edge.geometry;
    for (let i = 0; i < g.length - 1; i++) {
      const a = g[i];
      const b = g[i + 1];
      const x0 = Math.min(a[0], b[0]) * kx;
      const x1 = Math.max(a[0], b[0]) * kx;
      const y0 = Math.min(a[1], b[1]) * M_PER_DEG;
      const y1 = Math.max(a[1], b[1]) * M_PER_DEG;
      for (let cx = Math.floor(x0 / CELL_M); cx <= Math.floor(x1 / CELL_M); cx++) {
        for (let cy = Math.floor(y0 / CELL_M); cy <= Math.floor(y1 / CELL_M); cy++) {
          const k = `${cx}:${cy}`;
          const list = cells.get(k);
          if (list) list.push({ edge, a, b });
          else cells.set(k, [{ edge, a, b }]);
        }
      }
    }
  }
  return { cells, kx };
}

function segmentDistanceM(p: LonLat, a: LonLat, b: LonLat, kx: number): number {
  const px = p[0] * kx;
  const py = p[1] * M_PER_DEG;
  const ax = a[0] * kx;
  const ay = a[1] * M_PER_DEG;
  const bx = b[0] * kx;
  const by = b[1] * M_PER_DEG;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** The nearest edge of ANY kind within `thresholdM` (inclusive) of `p`, or null. */
export function nearestEdge(p: LonLat, grid: EdgeGrid, thresholdM = OD_THRESHOLD_M): { edge: NetworkEdge; distM: number } | null {
  const xm = p[0] * grid.kx;
  const ym = p[1] * M_PER_DEG;
  const cx = Math.floor(xm / CELL_M);
  const cy = Math.floor(ym / CELL_M);
  const reach = Math.ceil(thresholdM / CELL_M);
  let best: { edge: NetworkEdge; distM: number } | null = null;
  for (let i = -reach; i <= reach; i++) {
    for (let j = -reach; j <= reach; j++) {
      const list = grid.cells.get(`${cx + i}:${cy + j}`);
      if (!list) continue;
      for (const s of list) {
        const d = segmentDistanceM(p, s.a, s.b, grid.kx);
        if (d <= thresholdM + 1e-9 && (best === null || d < best.distM)) best = { edge: s.edge, distM: d };
      }
    }
  }
  void cellKey; // (kept for symmetry with buildEdgeGrid's key form)
  return best;
}

// ---- cross streets ----------------------------------------------------------------------------

export interface NodeIndex {
  /** edges leaving a node */
  out: Map<string, NetworkEdge[]>;
  /** edges arriving at a node */
  inn: Map<string, NetworkEdge[]>;
}

export function buildNodeIndex(edges: NetworkEdge[]): NodeIndex {
  const out = new Map<string, NetworkEdge[]>();
  const inn = new Map<string, NetworkEdge[]>();
  for (const e of edges) {
    (out.get(e.from) ?? out.set(e.from, []).get(e.from)!).push(e);
    (inn.get(e.to) ?? inn.set(e.to, []).get(e.to)!).push(e);
  }
  return { out, inn };
}

function otherNamedAt(node: string, edge: NetworkEdge, index: NodeIndex): string | null {
  const names = new Set<string>();
  for (const list of [index.out.get(node) ?? [], index.inn.get(node) ?? []]) {
    for (const e of list) {
      if (e.id === edge.id || e.id === edge.reverse) continue;
      if (e.name && e.name !== edge.name) names.add(e.name);
    }
  }
  if (names.size === 0) return null;
  return [...names].sort()[0]; // deterministic: alphabetical when several cross streets meet here
}

/** The unique same-named continuation of `edge` through `node` in the given direction, or null on a
 *  fork, a dead end, or when the only candidate is the reverse partner. */
function sameNameNext(node: string, edge: NetworkEdge, index: NodeIndex, forward: boolean): NetworkEdge | null {
  const list = (forward ? index.out.get(node) : index.inn.get(node)) ?? [];
  const cands = list.filter((e) => e.id !== edge.id && e.id !== edge.reverse && e.name === edge.name);
  return cands.length === 1 ? cands[0] : null;
}

function resolveEnd(edge: NetworkEdge, index: NodeIndex, forward: boolean, maxHops: number): string | null {
  let cur = edge;
  for (let hop = 0; hop <= maxHops; hop++) {
    const node = forward ? cur.to : cur.from;
    const hit = otherNamedAt(node, cur, index);
    if (hit) return hit;
    if (hop === maxHops) return null;
    const next = sameNameNext(node, cur, index, forward);
    if (!next) return null;
    cur = next;
  }
  return null;
}

/** The cross streets at each end of `edge`: at its own nodes, else along the same-name chain. */
export function crossStreets(edge: NetworkEdge, _lookup: EdgeLookup, index: NodeIndex, maxHops = 6): { from: string | null; to: string | null } {
  if (!edge.name) return { from: null, to: null };
  return { from: resolveEnd(edge, index, false, maxHops), to: resolveEnd(edge, index, true, maxHops) };
}

/** `between A and B` (alphabetical) / `near A` / null. */
export function betweenLine(cs: { from: string | null; to: string | null }): string | null {
  const both = [cs.from, cs.to].filter((x): x is string => !!x);
  if (both.length === 2) {
    const [a, b] = [...both].sort();
    return a === b ? `near ${a}` : `between ${a} and ${b}`;
  }
  if (both.length === 1) return `near ${both[0]}`;
  return null;
}
