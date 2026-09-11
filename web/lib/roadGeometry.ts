// V2.7c — the road GEOMETRY the transit-map styling derives from network.json. PURE: no React, no
// deck, no window; MapView memoizes `deriveRoadRows` on the network identity so it runs once.
//
// THE LANE MODEL. The wire carries per edge only `lanes` (a COUNT) and `allows{car,bike,ped}` — no
// per-lane table (that is V2.7d's network_export change, BACKLOG). Two facts probed on the canonical
// net make a derivation honest, and python/tests/test_lane_model_invariant.py PINS them so a regen
// that breaks either fails loudly instead of drawing every stripe half a lane off:
//   1. the exported geometry is the lane-bundle CENTRE (edge shape vs the mean of lane shapes:
//      median 0.0 m, p90 0.2 m);
//   2. `allows.ped` ⇔ exactly ONE 2.0 m pedestrian-only sidewalk lane at index 0 — the curb side
//      of each directional edge — on 4,214 of 4,570 edges; car lanes are 3.2 m.
// Stated residuals the rule draws wrong (counts pinned by the same test): 28 edges allow
// pedestrians on a car lane with no sidewalk lane (they get a ribbon they lack); 23 carry one
// extra non-car non-ped lane (drawn 3.2 m); six carry off-width car lanes (drawn 3.2 m).
//
// OFFSETS are signed metres perpendicular to travel: NEGATIVE = LEFT of the direction of travel
// (the road's inner side, where the opposing direction runs), POSITIVE = RIGHT (the curb).

import { bearingDeg, type NetworkEdge } from './network';
import type { LonLat } from './types';

/** Car lane width in the canonical net (6,717 of 6,723 car lanes). */
export const LANE_M = 3.2;
/** Sidewalk lane width in the canonical net (all 4,214 sidewalk lanes). */
export const SIDEWALK_M = 2.0;

/** Metres per degree of latitude (and of longitude at the equator) — the equirectangular scale. */
const M_PER_DEG = 111_195;

export interface LaneModel {
  /** 1 iff the edge carries a sidewalk lane (index 0, the curb side). */
  sidewalk: 0 | 1;
  /** Car lanes = `lanes − sidewalk`, floored at 1 (a defensive floor — no net edge hits it). */
  carLanes: number;
  carWidthM: number;
  /** Car body + sidewalk — the bundle the geometry is the centre of. */
  totalWidthM: number;
  /** Where the car body's centreline sits relative to the geometry. */
  bodyOffsetM: number;
  /** Where the sidewalk's centreline sits; null without a sidewalk. */
  sidewalkOffsetM: number | null;
  /** The bundle's inner (left) edge — the painted centerline's home on a two-way road. */
  leftBoundaryOffsetM: number;
  /** INTERNAL car-lane boundaries (the z ≥ 15 stripes), left to right; empty for one car lane. */
  laneBoundaryOffsetsM: number[];
  /** ≥ 2 car lanes per direction reads as an arterial (solid centerline); 1 as a collector (dashed). */
  arterial: boolean;
}

export function laneModel(e: NetworkEdge): LaneModel {
  const sidewalk: 0 | 1 = e.allows.ped ? 1 : 0;
  const carLanes = Math.max(1, e.lanes - sidewalk);
  const carWidthM = carLanes * LANE_M;
  const sidewalkWidthM = sidewalk * SIDEWALK_M;
  const totalWidthM = carWidthM + sidewalkWidthM;
  const bodyOffsetM = sidewalk ? -sidewalkWidthM / 2 : 0; // never −0 (a seam prints it, a pin sees it)
  const bodyLeft = bodyOffsetM - carWidthM / 2;
  return {
    sidewalk,
    carLanes,
    carWidthM,
    totalWidthM,
    bodyOffsetM,
    sidewalkOffsetM: sidewalk ? carWidthM / 2 : null,
    leftBoundaryOffsetM: -totalWidthM / 2,
    laneBoundaryOffsetsM: Array.from({ length: carLanes - 1 }, (_, k) => bodyLeft + (k + 1) * LANE_M),
    arterial: carLanes >= 2,
  };
}

/**
 * A polyline shifted `offsetM` metres perpendicular to travel (negative = left). Same vertex
 * count; interior joints are MITERED (the offset of two perpendicular segments meets d·√2 out
 * along the bisector), capped near reversals so a hairpin cannot throw a vertex kilometres away.
 * Local equirectangular metres about the first vertex — exact enough at corridor scale (a few
 * km, |lat| ≈ 43.8°) for a lane-width shift; the client/server metric gap is the V2.6d residual.
 */
export function offsetPolyline(path: LonLat[], offsetM: number): LonLat[] {
  if (offsetM === 0 || path.length < 2) return path.map((p) => [p[0], p[1]]);
  const lat0 = path[0][1];
  const lon0 = path[0][0];
  const kx = M_PER_DEG * Math.cos((lat0 * Math.PI) / 180);
  const ky = M_PER_DEG;
  const xy = path.map(([lon, lat]) => [(lon - lon0) * kx, (lat - lat0) * ky]);
  // unit RIGHT normals per segment (dir (dx,dy) → right normal (dy,−dx)); zero-length segments
  // inherit the previous direction so duplicate vertices never divide by zero
  const normals: [number, number][] = [];
  let last: [number, number] = [0, 0];
  for (let i = 0; i < xy.length - 1; i++) {
    const dx = xy[i + 1][0] - xy[i][0];
    const dy = xy[i + 1][1] - xy[i][1];
    const len = Math.hypot(dx, dy);
    if (len > 0) last = [dy / len, -dx / len];
    normals.push(last);
  }
  const out: LonLat[] = [];
  for (let i = 0; i < xy.length; i++) {
    let nx: number;
    let ny: number;
    if (i === 0) [nx, ny] = normals[0];
    else if (i === xy.length - 1) [nx, ny] = normals[normals.length - 1];
    else {
      const [ax, ay] = normals[i - 1];
      const [bx, by] = normals[i];
      const dot = ax * bx + ay * by;
      if (1 + dot < 0.1) {
        // near-reversal: the miter would explode — fall back to the incoming normal
        [nx, ny] = [ax, ay];
      } else {
        nx = (ax + bx) / (1 + dot);
        ny = (ay + by) / (1 + dot);
      }
    }
    const x = xy[i][0] + offsetM * nx;
    const y = xy[i][1] + offsetM * ny;
    out.push([lon0 + x / kx, lat0 + y / ky]);
  }
  return out;
}

/** Metres per screen pixel at `zoom` and latitude — deck.gl's and maplibre's 512-px world. */
export function metersPerPixel(zoom: number, latDeg: number): number {
  return (78271.517 * Math.cos((latDeg * Math.PI) / 180)) / Math.pow(2, zoom);
}

// ---------------------------------------------------------------------------------- chevrons (C3b)
// "One chevron per 160 screen-px per direction … measured along on-screen geometry, not per segment."
// V2.0b placed one arrow per one-way edge at its middle vertex; SUMO splits a curvy street into many
// short edges, so curvy streets clustered and long straight ones went bare (the C8b/C11 frames). Here
// the spacing is ARC LENGTH at the current zoom, and the phase carries across CHAINS of successor
// edges so a split street reads as one street. Chains are GEOMETRIC — a successor starts within
// CHAIN_GAP_M of this edge's end and continues its heading within CHAIN_HEADING_DEG — never id-based:
// on the canonical net, base-id chains bridge holes up to 834 m (the bbox clip removed middles) and
// exact endpoint coincidence finds ONE pair (edge shapes stop short of junctions; median gap 14 m).
// The junction gap counts toward arc length. A fork (two candidates in tolerance) or a T-junction
// (heading off) ends the chain. Rendered on ALL edges per direction (each directional edge is a
// direction; the reading recorded in the V2.7c plan, 4b), on each direction's own car body.

/** Screen pixels between chevrons — the brief's number (the mockup's `{{ arrowEvery }}` is a placeholder). */
export const CHEVRON_SPACING_PX = 160;
/** A successor must start within this many metres of the edge's end (junction gaps are ~14 m). */
export const CHAIN_GAP_M = 30;
/** …and continue the heading within this many degrees (a T-junction is 90° off). */
export const CHAIN_HEADING_DEG = 35;

/**
 * The chevron glyph's on-screen size: 2.2 × the lane pixel pitch, floored at 7 px and capped at
 * 12 px. A fixed 11 px glyph overflowed a 3 px road at z15.2 (looked-at, C3); at deep zooms a
 * road-sized mark would read as a hero. Data-derived from the same metres-per-pixel as the spacing.
 */
export function chevronSizePx(metersPerPx: number): number {
  return Math.max(7, Math.min(12, (LANE_M / metersPerPx) * 2.2));
}

export interface ChevronAnchor {
  id: string;
  position: LonLat;
  /** Map bearing of travel at the anchor, degrees clockwise from north. */
  bearing: number;
}

function distM(a: LonLat, b: LonLat): number {
  const kx = M_PER_DEG * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  return Math.hypot((b[0] - a[0]) * kx, (b[1] - a[1]) * M_PER_DEG);
}
function headingDelta(a: number, b: number): number {
  const d = Math.abs(((b - a + 540) % 360) - 180);
  return d;
}
/** The point `d` metres along `path` and the bearing of the segment it lands on. */
function along(path: LonLat[], d: number): { position: LonLat; bearing: number } {
  let s = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = distM(path[i], path[i + 1]);
    if (seg === 0) continue;
    if (s + seg >= d) {
      const f = (d - s) / seg;
      return {
        position: [path[i][0] + (path[i + 1][0] - path[i][0]) * f, path[i][1] + (path[i + 1][1] - path[i][1]) * f],
        bearing: bearingDeg(path[i], path[i + 1]),
      };
    }
    s += seg;
  }
  const n = path.length;
  return { position: path[n - 1], bearing: bearingDeg(path[n - 2], path[n - 1]) };
}

/**
 * Chevron anchors for `edges` at `metersPerPixel`, one per `spacingPx` screen pixels of arc.
 * `paths[i]` is the polyline the chevrons ride (the car body of `edges[i]` — same vertex count as the
 * geometry, shifted off the sidewalk). Pure and deterministic: chains start from predecessor-less
 * edges in id order, so the same net at the same zoom always yields the same anchors.
 */
export function chevronAnchors(
  edges: NetworkEdge[],
  paths: LonLat[][],
  metersPerPx: number,
  spacingPx = CHEVRON_SPACING_PX,
): ChevronAnchor[] {
  const n = edges.length;
  if (n === 0 || paths.length !== n) return [];
  const spacing = spacingPx * metersPerPx;
  const info = paths.map((p) => {
    let len = 0;
    for (let i = 0; i < p.length - 1; i++) len += distM(p[i], p[i + 1]);
    return {
      start: p[0], end: p[p.length - 1], len,
      bStart: p.length > 1 ? bearingDeg(p[0], p[1]) : 0,
      bEnd: p.length > 1 ? bearingDeg(p[p.length - 2], p[p.length - 1]) : 0,
    };
  });
  // successor search through a coarse spatial hash of edge STARTS (cells ~100 m; the 30 m gap never
  // crosses more than one cell boundary, so the 3×3 neighbourhood is exhaustive)
  const cellOf = (p: LonLat) => `${Math.floor(p[0] * 1000)}:${Math.floor(p[1] * 1000)}`;
  const byCell = new globalThis.Map<string, number[]>();
  for (let j = 0; j < n; j++) {
    const k = cellOf(info[j].start);
    const arr = byCell.get(k);
    if (arr) arr.push(j);
    else byCell.set(k, [j]);
  }
  const succ = new Int32Array(n).fill(-1);
  const gapTo = new Float64Array(n);
  const hasPred = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (paths[i].length < 2) continue;
    const e = info[i].end;
    const cx = Math.floor(e[0] * 1000);
    const cy = Math.floor(e[1] * 1000);
    let found = -1;
    let ambiguous = false;
    let foundGap = 0;
    for (let dx = -1; dx <= 1 && !ambiguous; dx++) {
      for (let dy = -1; dy <= 1 && !ambiguous; dy++) {
        const cand = byCell.get(`${cx + dx}:${cy + dy}`);
        if (!cand) continue;
        for (const j of cand) {
          if (j === i || paths[j].length < 2) continue;
          const gap = distM(e, info[j].start);
          if (gap >= CHAIN_GAP_M) continue;
          if (headingDelta(info[i].bEnd, info[j].bStart) >= CHAIN_HEADING_DEG) continue;
          if (found >= 0) {
            ambiguous = true;
            break;
          }
          found = j;
          foundGap = gap;
        }
      }
    }
    if (found >= 0 && !ambiguous) {
      succ[i] = found;
      gapTo[i] = foundGap;
    }
  }
  // a successor claimed by two predecessors is a MERGE — only one chain may carry phase into it, so
  // the first claimant (in id order) keeps it and the other chain ends
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => (edges[a].id < edges[b].id ? -1 : edges[a].id > edges[b].id ? 1 : 0));
  for (const i of order) {
    const j = succ[i];
    if (j < 0) continue;
    if (hasPred[j]) succ[i] = -1;
    else hasPred[j] = 1;
  }
  const visited = new Uint8Array(n);
  const out: ChevronAnchor[] = [];
  const walk = (startIdx: number) => {
    let s = 0;
    let nextAt = spacing / 2;
    let i = startIdx;
    while (i >= 0 && !visited[i]) {
      visited[i] = 1;
      const { len } = info[i];
      while (nextAt < s + len) {
        const a = along(paths[i], nextAt - s);
        out.push({ id: edges[i].id, position: a.position, bearing: a.bearing });
        nextAt += spacing;
      }
      const j = succ[i];
      s += len + (j >= 0 ? gapTo[i] : 0);
      i = j;
    }
  };
  for (const i of order) if (!hasPred[i] && !visited[i]) walk(i);
  for (const i of order) if (!visited[i]) walk(i); // pure cycles (a loop road) — start anywhere, in id order
  return out;
}

export interface RoadRow {
  id: string;
  path: LonLat[];
  widthM: number;
}
export interface CenterlineRow {
  id: string;
  path: LonLat[];
}
export interface RoadRows {
  models: LaneModel[];
  /** Every edge: the car body at its true width, centred on the car lanes. */
  body: RoadRow[];
  /** Sidewalk edges only: the 2.0 m ribbon at the curb. */
  sidewalk: RoadRow[];
  /** Two-way ARTERIAL directions (≥ 2 car lanes): the solid painted line on the inner boundary, every zoom. */
  centerline: CenterlineRow[];
  /** Two-way COLLECTOR directions (1 car lane): the dashed line — built once, shown from the lanes band
   *  (at the overview a 1.4 px dash on a 2 px road dithers to noise; looked-at catch, C2a). A one-way
   *  road has no opposing direction to paint against and gets neither. */
  collectorCenterline: CenterlineRow[];
  /** The z ≥ 15 lane striping: one row per INTERNAL car-lane boundary (never the sidewalk edge, never
   *  the outer edges). ~2,300 rows on the canonical net — built at load, shown from the lanes band. */
  stripes: CenterlineRow[];
}

/** Everything the far band draws, derived once from the network (memoize on the edges' identity). */
export function deriveRoadRows(edges: NetworkEdge[]): RoadRows {
  const models: LaneModel[] = [];
  const body: RoadRow[] = [];
  const sidewalk: RoadRow[] = [];
  const centerline: CenterlineRow[] = [];
  const collectorCenterline: CenterlineRow[] = [];
  const stripes: CenterlineRow[] = [];
  for (const e of edges) {
    const m = laneModel(e);
    models.push(m);
    body.push({ id: e.id, path: offsetPolyline(e.geometry, m.bodyOffsetM), widthM: m.carWidthM });
    if (m.sidewalkOffsetM !== null) {
      sidewalk.push({ id: e.id, path: offsetPolyline(e.geometry, m.sidewalkOffsetM), widthM: SIDEWALK_M });
    }
    if (!e.oneway) {
      const row = { id: e.id, path: offsetPolyline(e.geometry, m.leftBoundaryOffsetM) };
      (m.arterial ? centerline : collectorCenterline).push(row);
    }
    for (const off of m.laneBoundaryOffsetsM) {
      stripes.push({ id: e.id, path: offsetPolyline(e.geometry, off) });
    }
  }
  return { models, body, sidewalk, centerline, collectorCenterline, stripes };
}
