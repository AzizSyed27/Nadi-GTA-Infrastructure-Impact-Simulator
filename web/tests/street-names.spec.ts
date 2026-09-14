// V2.7d C3 — the TS street-name module: pure-function pins (the via-rules.spec idiom — no vitest).
//
// `describeEdge` is the TS twin of python's `street_names.describe_edge` and pins the SAME two
// forms as literals (the python<->TS lockstep of the compact-time pin): name-plus-id, never
// name-instead-of-id, id-only when unnamed. `nearestEdge` + `odLine` carry the voice card's
// origin→destination rule the V2.7b brief ratified: only if derivable from the network — the
// nearest edge of ANY kind within the threshold; if that edge is unnamed the line is OMITTED
// (naming the nearest NAMED street instead would put a traveller on a street they were not on).
// `crossStreets` walks same-name chains because the car-only net split streets where the
// pedestrian cross edges were removed (2,506 of 4,487 named edges resolve both ends at their own
// nodes; the walk lifts that to 2,963 — probed on the canonical net, 2026-09-13).
import { test, expect } from '@playwright/test';
import {
  OD_THRESHOLD_M,
  betweenLine,
  buildEdgeGrid,
  buildNodeIndex,
  crossStreets,
  describeEdge,
  nameOf,
  nearestEdge,
  odLine,
} from '../lib/streetNames';
import type { NetworkEdge } from '../lib/network';
import { CAR, PED, netEdge } from './support/net';

const M_PER_DEG_LAT = 111_195;
const DEG_PER_M_LON = 1 / (M_PER_DEG_LAT * Math.cos((43.75 * Math.PI) / 180));

/** An east-bound edge from (lon0, lat) of lenM metres. */
const east = (id: string, lon0: number, lenM: number, lat: number, name: string | null, extra: Partial<NetworkEdge> = {}): NetworkEdge =>
  netEdge({ id, geometry: [[lon0, lat], [lon0 + lenM * DEG_PER_M_LON, lat]], lanes: [PED, CAR], speed_mps: 13.89, oneway: true,
    allows: { car: true, bike: true, ped: true }, name, ...extra });

const lookupOf = (edges: NetworkEdge[]) => Object.fromEntries(edges.map((e) => [e.id, e]));

test('describeEdge pins the python forms as literals: name-plus-id, id-only when unnamed', () => {
  const lookup = lookupOf([east('-1288863201', -79.25, 100, 43.75, 'Markham Road'), east('E1', -79.24, 100, 43.75, null)]);
  expect(nameOf(lookup, '-1288863201')).toBe('Markham Road');
  expect(nameOf(lookup, 'E1')).toBeNull();
  expect(nameOf(lookup, 'absent')).toBeNull();
  expect(describeEdge(lookup, '-1288863201')).toBe('Markham Road (edge -1288863201)');
  expect(describeEdge(lookup, 'E1')).toBe('edge E1');
  expect(describeEdge(lookup, 'absent')).toBe('edge absent'); // an id the network does not carry — never a throw
});

test('OD_THRESHOLD_M is the stated 25 m, inclusive', () => {
  expect(OD_THRESHOLD_M).toBe(25);
  const e = east('a', -79.25, 200, 43.75, 'A Street');
  const grid = buildEdgeGrid([e]);
  const midLon = -79.25 + 100 * DEG_PER_M_LON;
  expect(nearestEdge([midLon, 43.75 + 25.0 / M_PER_DEG_LAT], grid)?.edge.id).toBe('a'); // exactly 25.0 m north
  expect(nearestEdge([midLon, 43.75 + 25.001 / M_PER_DEG_LAT], grid)).toBeNull(); // 1 mm past it
  expect(nearestEdge([midLon, 43.75 + 25.0 / M_PER_DEG_LAT], grid)?.distM).toBeCloseTo(25.0, 2);
});

test('nearestEdge picks the nearest edge of ANY kind — an unnamed one wins over a farther named one', () => {
  // the honesty rule: the traveller was on the unnamed street; naming the one 20 m away would invent geography
  const unnamed = east('u', -79.25, 200, 43.75, null);
  const named = east('n', -79.25, 200, 43.75 + 20 / M_PER_DEG_LAT, 'Named Street');
  const grid = buildEdgeGrid([unnamed, named]);
  const p: [number, number] = [-79.25 + 100 * DEG_PER_M_LON, 43.75 + 5 / M_PER_DEG_LAT]; // 5 m from u, 15 m from n
  const hit = nearestEdge(p, grid);
  expect(hit?.edge.id).toBe('u');
  expect(odLine(hit?.edge.name ?? null, 'Named Street')).toBeNull(); // → the card omits the line
});

test('nearestEdge measures to the SEGMENT, not to the vertices', () => {
  const e = east('a', -79.25, 1000, 43.75, 'A Street'); // 1 km, two vertices
  const grid = buildEdgeGrid([e]);
  const p: [number, number] = [-79.25 + 500 * DEG_PER_M_LON, 43.75 + 10 / M_PER_DEG_LAT]; // 500 m along, 10 m off
  expect(nearestEdge(p, grid)?.distM).toBeCloseTo(10, 1);
});

test('odLine: both named → from/to; the same street → along; either missing → null', () => {
  expect(odLine('Markham Road', 'Lawrence Avenue East')).toBe('from Markham Road to Lawrence Avenue East');
  expect(odLine('Markham Road', 'Markham Road')).toBe('along Markham Road');
  expect(odLine('Markham Road', null)).toBeNull();
  expect(odLine(null, 'Markham Road')).toBeNull();
  expect(odLine(null, null)).toBeNull();
});

/** A 5-edge hand net for the cross-street walk (node ids are the edges' from/to):
 *  m1 → m2 → m3 are 'Main Street' chained through nodes n1..n4; 'Cross A' meets n1, 'Cross B' meets n4;
 *  n2 and n3 have NO other-named edge (the car-only net's split points). */
function mainNet() {
  const m1 = east('m1', -79.25, 100, 43.75, 'Main Street', { from: 'n1', to: 'n2' });
  const m2 = east('m2', -79.25 + 100 * DEG_PER_M_LON, 100, 43.75, 'Main Street', { from: 'n2', to: 'n3' });
  const m3 = east('m3', -79.25 + 200 * DEG_PER_M_LON, 100, 43.75, 'Main Street', { from: 'n3', to: 'n4' });
  const a = east('a', -79.26, 100, 43.75, 'Cross A', { from: 'n0', to: 'n1' });
  const b = east('b', -79.25 + 300 * DEG_PER_M_LON, 100, 43.75, 'Cross B', { from: 'n4', to: 'n5' });
  return [m1, m2, m3, a, b];
}

test('crossStreets: other-named edges at the end nodes resolve at 0 hops', () => {
  const edges = mainNet();
  const cs = crossStreets(edges[0], lookupOf(edges), buildNodeIndex(edges), 6); // m1: n1 has Cross A; n2 has none → walk to n4
  expect(cs).toEqual({ from: 'Cross A', to: 'Cross B' });
  expect(betweenLine(cs)).toBe('between Cross A and Cross B');
});

test('crossStreets: the same-name walk follows the unique successor across unnamed split nodes', () => {
  const edges = mainNet();
  const cs = crossStreets(edges[1], lookupOf(edges), buildNodeIndex(edges), 6); // m2: n2 → back to n1 (Cross A), n3 → forward to n4 (Cross B)
  expect(cs).toEqual({ from: 'Cross A', to: 'Cross B' });
});

test('crossStreets: a fork ends the walk; one end resolved renders "near"; none renders nothing', () => {
  const edges = mainNet();
  // a second 'Main Street' successor at n3 makes the forward walk from m2 ambiguous → forward unresolved
  const fork = east('m3b', -79.25 + 200 * DEG_PER_M_LON, 100, 43.75 + 30 / M_PER_DEG_LAT, 'Main Street', { from: 'n3', to: 'n6' });
  const all = [...edges, fork];
  const cs = crossStreets(edges[1], lookupOf(all), buildNodeIndex(all), 6);
  expect(cs).toEqual({ from: 'Cross A', to: null });
  expect(betweenLine(cs)).toBe('near Cross A');
  expect(betweenLine({ from: null, to: null })).toBeNull();
});

test('crossStreets never walks the reverse partner or past the hop cap', () => {
  const m1 = east('m1', -79.25, 100, 43.75, 'Main Street', { from: 'n1', to: 'n2', reverse: '-m1', oneway: false });
  const r1 = east('-m1', -79.25, 100, 43.75, 'Main Street', { from: 'n2', to: 'n1', reverse: 'm1', oneway: false });
  const edges = [m1, r1];
  // the only edges at either node are the pair itself — the walk must not bounce between them
  expect(crossStreets(m1, lookupOf(edges), buildNodeIndex(edges), 6)).toEqual({ from: null, to: null });
  // a 3-hop chain with the cap at 2 stays unresolved at the far end
  const chain = mainNet();
  expect(crossStreets(chain[0], lookupOf(chain), buildNodeIndex(chain), 1)).toEqual({ from: 'Cross A', to: null });
});
