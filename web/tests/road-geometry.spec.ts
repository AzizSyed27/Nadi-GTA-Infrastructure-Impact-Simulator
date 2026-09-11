// V2.7c — function-level pins for web/lib/roadGeometry.ts (the via-rules.spec idiom: a Playwright
// spec importing the lib directly — there is no vitest). Every number here is a LITERAL, hand-
// computed from the probed net facts (CLAUDE.md V2.7c / python/tests/test_lane_model_invariant.py):
// the exported edge geometry is the lane-bundle CENTRE; `allows.ped` means one 2.0 m sidewalk lane
// at index 0 (the curb side of each directional edge); car lanes are 3.2 m. A tautological pin
// (constant-vs-constant) would not catch drift, so the constants are asserted as numbers.

import { test, expect } from '@playwright/test';
import {
  LANE_M,
  SIDEWALK_M,
  deriveRoadRows,
  laneModel,
  metersPerPixel,
  offsetPolyline,
} from '../lib/roadGeometry';
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

test('metersPerPixel uses the 512-px world (deck.gl and maplibre), not the 256-tile constant', () => {
  // 78271.517 · cos(43.762°) / 2^15 — at the corridor latitude one 3.2 m lane is 1.85 px at z15
  expect(metersPerPixel(15, 43.762)).toBeCloseTo(1.7254, 3);
  expect(metersPerPixel(16, 43.762)).toBeCloseTo(0.8627, 3);
  expect(metersPerPixel(0, 0)).toBeCloseTo(78271.517, 2);
});
