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

import type { NetworkEdge } from './network';
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
}

/** Everything the far band draws, derived once from the network (memoize on the edges' identity). */
export function deriveRoadRows(edges: NetworkEdge[]): RoadRows {
  const models: LaneModel[] = [];
  const body: RoadRow[] = [];
  const sidewalk: RoadRow[] = [];
  const centerline: CenterlineRow[] = [];
  const collectorCenterline: CenterlineRow[] = [];
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
  }
  return { models, body, sidewalk, centerline, collectorCenterline };
}
