// V2.7c — function-level pins for web/lib/roadGeometry.ts (the via-rules.spec idiom: a Playwright
// spec importing the lib directly — there is no vitest). Every number here is a LITERAL, hand-
// computed from the probed net facts (CLAUDE.md V2.7c / python/tests/test_lane_model_invariant.py):
// the exported edge geometry is the lane-bundle CENTRE; `allows.ped` means one 2.0 m sidewalk lane
// at index 0 (the curb side of each directional edge); car lanes are 3.2 m. A tautological pin
// (constant-vs-constant) would not catch drift, so the constants are asserted as numbers.

import { test, expect } from '@playwright/test';
import {
  CHAIN_GAP_M,
  CHAIN_HEADING_DEG,
  CHEVRON_SPACING_PX,
  LANE_M,
  SIDEWALK_M,
  chevronAnchors,
  chevronSizePx,
  deriveRoadRows,
  laneModel,
  metersPerPixel,
  offsetPolyline,
} from '../lib/roadGeometry';
import { positionAtCached, segmentAt } from '../lib/viz';
import type { NetworkEdge } from '../lib/network';
import type { LonLat } from '../lib/types';

const edge = (lanes: number, ped: boolean, oneway = false): NetworkEdge => ({
  id: 'e', geometry: [[-79.25, 43.75], [-79.24, 43.75]], lanes, speed_mps: 13.89, oneway,
  allows: { car: true, bike: true, ped },
});

test('lane widths are the probed net literals', () => {
  expect(LANE_M).toBe(3.2);
  expect(SIDEWALK_M).toBe(2.0);
});

test('laneModel: a sidewalk edge puts the 2.0 m sidewalk at the curb and the car body left of centre', () => {
  // (2 lanes total, 1 car, 1 sidewalk) — 3,021 of the net's 4,570 edges have exactly this shape
  const m = laneModel(edge(2, true));
  expect(m.sidewalk).toBe(1);
  expect(m.carLanes).toBe(1);
  expect(m.carWidthM).toBeCloseTo(3.2, 6);
  expect(m.totalWidthM).toBeCloseTo(5.2, 6);
  // the geometry is the bundle centre; the sidewalk sits on the RIGHT (index 0), so the car body's
  // centre is half a sidewalk to the LEFT of the geometry and the sidewalk's centre is half the car
  // width to the right
  expect(m.bodyOffsetM).toBeCloseTo(-1.0, 6);
  expect(m.sidewalkOffsetM).toBeCloseTo(1.6, 6);
  // the inner edge (the painted centerline's home) is the left boundary of the whole bundle
  expect(m.leftBoundaryOffsetM).toBeCloseTo(-2.6, 6);
  expect(m.arterial).toBe(false); // 1 car lane per direction → the dashed (collector) centerline
  expect(m.laneBoundaryOffsetsM).toEqual([]); // no INTERNAL car-lane boundary with one car lane
});

test('laneModel: a no-sidewalk edge is centred and every lane is a car lane', () => {
  const m = laneModel(edge(2, false));
  expect(m.sidewalk).toBe(0);
  expect(m.carLanes).toBe(2);
  expect(m.totalWidthM).toBeCloseTo(6.4, 6);
  expect(m.bodyOffsetM).toBe(0);
  expect(m.sidewalkOffsetM).toBeNull();
  expect(m.leftBoundaryOffsetM).toBeCloseTo(-3.2, 6);
  expect(m.arterial).toBe(true);
  // one internal boundary, on the geometry itself
  expect(m.laneBoundaryOffsetsM.map((x) => Number(x.toFixed(6)))).toEqual([0]);
});

test('laneModel: internal car-lane boundaries sit at 3.2 m pitch inside the car body', () => {
  // (4 total, 3 car, 1 sidewalk): body 9.6 m centred at −1.0 → spans [−5.8, 3.8]; boundaries at −2.6 and 0.6
  const m = laneModel(edge(4, true));
  expect(m.laneBoundaryOffsetsM.map((x) => Number(x.toFixed(6)))).toEqual([-2.6, 0.6]);
});

test('laneModel never yields zero car lanes (a defensive floor, not a net fact)', () => {
  expect(laneModel(edge(1, true)).carLanes).toBe(1);
});

test('offsetPolyline: negative is LEFT of travel — an east-bound segment moves north', () => {
  const east: LonLat[] = [[-79.25, 43.75], [-79.24, 43.75]];
  const out = offsetPolyline(east, -5);
  expect(out).toHaveLength(2);
  // 5 m of latitude ≈ 5 / 111,195 deg = 4.4966e-5
  expect(out[0][1] - east[0][1]).toBeCloseTo(4.4966e-5, 8);
  expect(out[1][1] - east[1][1]).toBeCloseTo(4.4966e-5, 8);
  expect(out[0][0]).toBeCloseTo(east[0][0], 9); // no longitudinal drift on a pure east-west segment
  // and +5 moves south by the same amount
  expect(offsetPolyline(east, 5)[0][1] - east[0][1]).toBeCloseTo(-4.4966e-5, 8);
});

test('offsetPolyline keeps the vertex count and miters a right-angle joint', () => {
  // east then north: the joint point of a LEFT offset lands d·√2 along the outer bisector (north-west)
  const bent: LonLat[] = [[-79.25, 43.75], [-79.24, 43.75], [-79.24, 43.76]];
  const out = offsetPolyline(bent, -5);
  expect(out).toHaveLength(3);
  const dLat = (out[1][1] - bent[1][1]) * 111195; // metres north
  const dLon = (out[1][0] - bent[1][0]) * 111195 * Math.cos((43.75 * Math.PI) / 180); // metres east
  expect(dLat).toBeCloseTo(5, 2); // north by d
  expect(dLon).toBeCloseTo(-5, 2); // west by d  (the miter of two perpendicular left offsets)
});

test('offsetPolyline with zero offset is the identity', () => {
  const p: LonLat[] = [[-79.25, 43.75], [-79.24, 43.751], [-79.23, 43.75]];
  expect(offsetPolyline(p, 0)).toEqual(p);
});

test('deriveRoadRows: every edge gets a body; sidewalks only where allows.ped; centerlines split arterial vs collector, two-way only', () => {
  const rows = deriveRoadRows([
    { ...edge(3, true), id: 'art' }, // 2 car lanes + sidewalk, two-way → arterial (solid) centerline
    { ...edge(2, true), id: 'col' }, // 1 car lane + sidewalk, two-way → collector (dashed) centerline
    { ...edge(1, false, true), id: 'one' }, // one-way, no sidewalk → body only
  ]);
  expect(rows.body.map((r) => r.id)).toEqual(['art', 'col', 'one']);
  expect(rows.body.map((r) => r.widthM)).toEqual([6.4, 3.2, 3.2]);
  expect(rows.sidewalk.map((r) => r.id)).toEqual(['art', 'col']);
  expect(rows.sidewalk.every((r) => r.widthM === 2.0)).toBe(true);
  expect(rows.centerline.map((r) => r.id)).toEqual(['art']);
  expect(rows.collectorCenterline.map((r) => r.id)).toEqual(['col']);
  // the sidewalk ribbon sits RIGHT (south of an east-bound edge), the body LEFT of the geometry
  const art = rows.sidewalk[0].path[0][1];
  const bodyLat = rows.body[0].path[0][1];
  expect(art).toBeLessThan(43.75);
  expect(bodyLat).toBeGreaterThan(43.75);
  // and a no-sidewalk edge's body IS its geometry (no offset work, identical points)
  expect(rows.body[2].path).toEqual([[-79.25, 43.75], [-79.24, 43.75]]);
});

test('deriveRoadRows: lane stripes are the INTERNAL car-lane boundaries only — never the sidewalk edge', () => {
  const rows = deriveRoadRows([
    { ...edge(4, true), id: 'art' }, // 3 car lanes + sidewalk → 2 internal boundaries at −2.6 and +0.6 m
    { ...edge(2, true), id: 'col' }, // 1 car lane + sidewalk → none (the sidewalk boundary is NOT a lane stripe)
    { ...edge(2, false), id: 'two' }, // 2 car lanes, no sidewalk → 1 boundary ON the geometry
  ]);
  expect(rows.stripes.map((r) => r.id)).toEqual(['art', 'art', 'two']);
  // east-bound: a NEGATIVE (left) offset moves north; −2.6 m and +0.6 m → +2.338e-5 and −5.396e-6 deg lat
  expect(rows.stripes[0].path[0][1] - 43.75).toBeCloseTo(2.6 / 111195, 8);
  expect(rows.stripes[1].path[0][1] - 43.75).toBeCloseTo(-0.6 / 111195, 8);
  expect(rows.stripes[2].path).toEqual([[-79.25, 43.75], [-79.24, 43.75]]); // offset 0 → the geometry itself
});

// ---- chevrons (C3b): constant ON-SCREEN spacing measured along the geometry, phase carried across
// chains of successor edges — the fix for the arrow clustering on curvy streets (V2.0b placed one
// arrow per edge at its middle vertex; SUMO splits a curvy street into many short edges).
// Chains are GEOMETRIC (a successor starts within CHAIN_GAP_M of this edge's end and continues its
// heading within CHAIN_HEADING_DEG), never id-based: base-id chains bridge holes up to 834 m in the
// canonical net and exact endpoint coincidence finds one pair (SUMO edge shapes stop short of
// junctions; median gap 14 m). The junction gap COUNTS toward arc length.

const DEG_PER_M_LON = 1 / (111195 * Math.cos((43.75 * Math.PI) / 180)); // at the fixture latitude
/** An east-bound one-way edge of `lenM` metres starting at `lon0`, at lat 43.75 (+ `dLat`). */
const east = (id: string, lon0: number, lenM: number, dLat = 0, ped = false): NetworkEdge => ({
  id, geometry: [[lon0, 43.75 + dLat], [lon0 + lenM * DEG_PER_M_LON, 43.75 + dLat]], lanes: ped ? 2 : 1,
  speed_mps: 13.89, oneway: true, allows: { car: true, bike: true, ped },
});
const MPP15 = 1.725; // metersPerPixel(15, 43.762) → 160 px = 276 m

test('chevron literals: 160 px spacing; chains need a gap under 30 m AND a heading within 35°', () => {
  expect(CHEVRON_SPACING_PX).toBe(160);
  expect(CHAIN_GAP_M).toBe(30);
  expect(CHAIN_HEADING_DEG).toBe(35);
});

test('chevrons sit every spacing along a straight edge, the first half a spacing in', () => {
  const e = east('e', -79.25, 1000);
  const a = chevronAnchors([e], [e.geometry], MPP15);
  // spacing 276 m → 138, 414, 690, 966 (1,242 > 1,000)
  expect(a).toHaveLength(4);
  expect(a.map((x) => x.id)).toEqual(['e', 'e', 'e', 'e']);
  expect(a[0].position[0]).toBeCloseTo(-79.25 + 138 * DEG_PER_M_LON, 6);
  expect(a[3].position[0]).toBeCloseTo(-79.25 + 966 * DEG_PER_M_LON, 6);
  expect(a[0].bearing).toBeCloseTo(90, 0); // east
  // an edge shorter than half a spacing gets none — a stub does not need a direction mark
  const s = east('s', -79.25, 100);
  expect(chevronAnchors([s], [s.geometry], MPP15)).toHaveLength(0);
});

test('a chain of short segments carries the phase across 14 m junction gaps (the clustering fix)', () => {
  // three 100 m segments with 14 m gaps: 100 + 14 + 100 + 14 + 100 = 328 m of arc → one chevron at
  // 138 m, i.e. 24 m into the SECOND segment; unchained, every segment is bare (100 < 138)
  const s1 = east('s#0', -79.25, 100);
  const s2 = east('s#1', -79.25 + 114 * DEG_PER_M_LON, 100);
  const s3 = east('s#2', -79.25 + 228 * DEG_PER_M_LON, 100);
  const a = chevronAnchors([s1, s2, s3], [s1.geometry, s2.geometry, s3.geometry], MPP15);
  expect(a).toHaveLength(1);
  expect(a[0].id).toBe('s#1');
  expect(a[0].position[0]).toBeCloseTo(-79.25 + 138 * DEG_PER_M_LON, 6);
  // chain order is geometric — the same three segments in a different array order chain the same way
  const b = chevronAnchors([s3, s1, s2], [s3.geometry, s1.geometry, s2.geometry], MPP15);
  expect(b.map((x) => [x.id, Number(x.position[0].toFixed(6))])).toEqual(a.map((x) => [x.id, Number(x.position[0].toFixed(6))]));
});

test('the chain rule boundaries: 29 m chains and 31 m does not; 34° chains and 36° does not', () => {
  const s1 = east('a', -79.25, 100);
  const near = east('b', -79.25 + 129 * DEG_PER_M_LON, 100); // gap 29 m → chained → 229 m of arc → 1 chevron
  const far = east('c', -79.25 + 131 * DEG_PER_M_LON, 100); // gap 31 m → NOT chained → both bare
  expect(chevronAnchors([s1, near], [s1.geometry, near.geometry], MPP15)).toHaveLength(1);
  expect(chevronAnchors([s1, far], [s1.geometry, far.geometry], MPP15)).toHaveLength(0);
  // heading: a 100 m successor turning by 34° / 36° from due east, starting 14 m past the end of s1
  const turn = (id: string, deg: number): NetworkEdge => {
    // a heading of (90 − deg) from north = `deg` degrees left of the east-bound predecessor;
    // in math-angle terms (ccw from east) that is simply `deg`
    const rad = (deg * Math.PI) / 180;
    const lon0 = -79.25 + 114 * DEG_PER_M_LON;
    return { id, geometry: [[lon0, 43.75], [lon0 + 100 * Math.cos(rad) * DEG_PER_M_LON, 43.75 + (100 * Math.sin(rad)) / 111195]],
      lanes: 1, speed_mps: 13.89, oneway: true, allows: { car: true, bike: true, ped: false } };
  };
  expect(chevronAnchors([s1, turn('t34', 34)], [s1.geometry, turn('t34', 34).geometry], MPP15)).toHaveLength(1);
  expect(chevronAnchors([s1, turn('t36', 36)], [s1.geometry, turn('t36', 36).geometry], MPP15)).toHaveLength(0);
});

test('a T-junction never bridges into the cross street, and a fork breaks the chain', () => {
  const s1 = east('a', -79.25, 100);
  const lonEnd = -79.25 + 114 * DEG_PER_M_LON;
  const cross: NetworkEdge = { // starts 14 m past s1's end, heads NORTH (90° off)
    id: 'x', geometry: [[lonEnd, 43.75], [lonEnd, 43.75 + 100 / 111195]], lanes: 1, speed_mps: 13.89, oneway: true,
    allows: { car: true, bike: true, ped: false },
  };
  expect(chevronAnchors([s1, cross], [s1.geometry, cross.geometry], MPP15)).toHaveLength(0);
  // two in-tolerance successors (a fork): ambiguous → the chain ends at s1; each fork arm is its own
  // 100 m stub → nothing anywhere
  const f1 = east('f1', lonEnd, 100, 0);
  const f2 = east('f2', lonEnd, 100, 3 / 111195);
  expect(chevronAnchors([s1, f1, f2], [s1.geometry, f1.geometry, f2.geometry], MPP15)).toHaveLength(0);
});

test('chevrons ride every direction of a two-way road, on each direction\'s own car body', () => {
  // a sidewalk edge's car body sits 1.0 m LEFT of its geometry; the west-bound partner runs 5 m north
  const eb: NetworkEdge = { ...east('eb', -79.25, 1000, 0, true), oneway: false };
  const wb: NetworkEdge = { ...eb, id: 'wb', geometry: [...eb.geometry].reverse().map(([lon, lat]) => [lon, lat + 5 / 111195]) as [number, number][] };
  const rows = deriveRoadRows([eb, wb]);
  const a = chevronAnchors([eb, wb], rows.body.map((r) => r.path), MPP15);
  expect(a.filter((x) => x.id === 'eb')).toHaveLength(4);
  expect(a.filter((x) => x.id === 'wb')).toHaveLength(4);
  expect(a.find((x) => x.id === 'eb')!.bearing).toBeCloseTo(90, 0);
  expect(a.find((x) => x.id === 'wb')!.bearing).toBeCloseTo(270, 0);
  // the east-bound chevron sits on the car body, 1.0 m north of the geometry (left of east-bound travel)
  expect(a.find((x) => x.id === 'eb')!.position[1] - 43.75).toBeCloseTo(1.0 / 111195, 8);
});

test('the chevron glyph scales with the lane pixel pitch, floored and capped (a looked-at lever, C3)', () => {
  // at z15.2 a 3.2 m lane is 2.13 px → 2.2× = 4.7 px, floored to 7 (an 11 px glyph overflowed a 3 px road);
  // at z16.5 (5.25 px lanes) 11.5 px; a cap of 12 px keeps deep zooms from growing a road-sized mark
  expect(chevronSizePx(1.502)).toBe(7);
  expect(chevronSizePx(0.61)).toBeCloseTo(11.54, 2);
  expect(chevronSizePx(0.3)).toBe(12);
});

// ---- travellers as mode icons (C4): heading comes from the SAME bracket lookup as position ----

test('segmentAt: position matches positionAtCached and the bearing is the segment\'s, clamped at both ends', () => {
  const path: LonLat[] = [[-79.25, 43.75], [-79.24, 43.75], [-79.24, 43.76]]; // east, then north
  const ts = [0, 10, 20];
  const mid = segmentAt(path, ts, 5);
  expect(mid.position).toEqual(positionAtCached(path, ts, 5));
  expect(mid.position[0]).toBeCloseTo(-79.245, 9);
  expect(mid.bearing).toBeCloseTo(90, 0); // east-bound on the first segment
  expect(segmentAt(path, ts, 15).bearing).toBeCloseTo(0, 0); // north-bound on the second
  // before the first sample: parked at the start, facing the first segment; past the last: at the end,
  // facing the last segment (an icon never spins at a trajectory's ends)
  expect(segmentAt(path, ts, -3)).toEqual({ position: [-79.25, 43.75], bearing: segmentAt(path, ts, 1).bearing });
  expect(segmentAt(path, ts, 99).position).toEqual([-79.24, 43.76]);
  expect(segmentAt(path, ts, 99).bearing).toBeCloseTo(0, 0);
  // a one-point trajectory has no heading — 0, never NaN
  expect(segmentAt([[-79.25, 43.75]], [7], 7)).toEqual({ position: [-79.25, 43.75], bearing: 0 });
});

test('metersPerPixel uses the 512-px world (deck.gl and maplibre), not the 256-tile constant', () => {
  // 78271.517 · cos(43.762°) / 2^15 — at the corridor latitude one 3.2 m lane is 1.85 px at z15
  expect(metersPerPixel(15, 43.762)).toBeCloseTo(1.7254, 3);
  expect(metersPerPixel(16, 43.762)).toBeCloseTo(0.8627, 3);
  expect(metersPerPixel(0, 0)).toBeCloseTo(78271.517, 2);
});
