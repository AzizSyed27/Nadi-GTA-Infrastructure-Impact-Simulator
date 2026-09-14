// V2.7d C4a — the mini-form's LANE ROWS, pure (the via-rules.spec idiom — no vitest).
//
// The ratified drop form lists BOTH directions' lanes "from this road's lane table" — "EB general 1 /
// EB general 2 / EB bus (curb) / WB …" — and the user's ratification carried ONE condition: the
// per-direction consequence is SAID before Run (ticking EB only closes eastbound only), because the
// gap between "the street" and "one direction of the street" is where planner intent and sim input
// silently diverge. `directionNote` is that sentence; C4a's draft-basket test pins it with toHaveText.
//
// Labels derive from data only: the compass initial from the edge's end-to-end bearing (sectors at
// 45 / 135 / 225 / 315), the kind from the lane table (car → general, bus-only → bus, bike-only →
// bike, ped-only → sidewalk — listed inert, never closable), the ordinal per kind from the curb
// (index 0), "(curb)" on the curbmost NON-sidewalk lane. Closable = the SUMO index is in the server's
// `car_lane_indices` AND the table says the lane allows cars — both must agree.
import { test, expect } from '@playwright/test';
import { applyNote, compassInitial, directionNote, emitLaneClosures, laneRowsFor } from '../lib/laneRows';
import type { NetworkEdge } from '../lib/network';
import { BUS, CAR, PED, netEdge } from './support/net';

const eastbound = (id: string, lanes: NetworkEdge['lanes'], extra: Partial<NetworkEdge> = {}): NetworkEdge =>
  netEdge({ id, geometry: [[-79.25, 43.75], [-79.24, 43.75]], lanes, speed_mps: 13.89, oneway: false,
    allows: { car: true, bike: true, ped: lanes.some((l) => l.allows.ped) }, ...extra });
const westbound = (id: string, lanes: NetworkEdge['lanes'], extra: Partial<NetworkEdge> = {}): NetworkEdge =>
  netEdge({ id, geometry: [[-79.24, 43.7501], [-79.25, 43.7501]], lanes, speed_mps: 13.89, oneway: false,
    allows: { car: true, bike: true, ped: lanes.some((l) => l.allows.ped) }, ...extra });

test('compassInitial: 90° sectors with boundaries at 45 / 135 / 225 / 315, pinned both sides of one', () => {
  expect(compassInitial(0)).toBe('N');
  expect(compassInitial(44.9)).toBe('N');
  expect(compassInitial(45)).toBe('E');
  expect(compassInitial(90)).toBe('E');
  expect(compassInitial(134.9)).toBe('E');
  expect(compassInitial(135)).toBe('S');
  expect(compassInitial(224.9)).toBe('S');
  expect(compassInitial(225)).toBe('W');
  expect(compassInitial(314.9)).toBe('W');
  expect(compassInitial(315)).toBe('N');
  expect(compassInitial(359.9)).toBe('N');
});

test('laneRowsFor: a two-way pair lists the dropped edge then its partner, sidewalks inert, curb marked', () => {
  const eb = eastbound('E_A', [PED, CAR, CAR], { reverse: '-E_A' });
  const wb = westbound('-E_A', [PED, CAR], { reverse: 'E_A' });
  const rows = laneRowsFor(eb, wb, { primary: [1, 2], partner: [1] });
  expect(rows.map((r) => r.label)).toEqual(['EB sidewalk', 'EB general 1 (curb)', 'EB general 2', 'WB sidewalk', 'WB general 1 (curb)']);
  expect(rows.map((r) => r.closable)).toEqual([false, true, true, false, true]);
  expect(rows.map((r) => r.side)).toEqual(['primary', 'primary', 'primary', 'partner', 'partner']);
  expect(rows.map((r) => r.sumoIndex)).toEqual([0, 1, 2, 0, 1]);
});

test('laneRowsFor: a curb bus lane reads "bus (curb)" and is NOT closable; the general lanes count from it', () => {
  const eb = eastbound('B', [BUS, CAR, CAR], { oneway: true, reverse: null });
  const rows = laneRowsFor(eb, null, { primary: [1, 2], partner: [] });
  expect(rows.map((r) => r.label)).toEqual(['EB bus (curb)', 'EB general 1', 'EB general 2']);
  expect(rows.map((r) => r.closable)).toEqual([false, true, true]);
});

test('laneRowsFor: a car lane the server does not list as closable renders disabled with the reason', () => {
  const eb = eastbound('E_A', [PED, CAR, CAR]);
  const rows = laneRowsFor(eb, null, { primary: [1], partner: [] }); // the server lists only lane 1
  expect(rows[2].closable).toBe(false);
  expect(rows[2].reason).toBe("not closable on the server's lane list");
  expect(rows[1].closable).toBe(true);
});

test('emitLaneClosures: ticks on each side become ONE member per directional edge, lanes sorted, same window', () => {
  const eb = eastbound('E_A', [PED, CAR, CAR], { reverse: '-E_A' });
  const wb = westbound('-E_A', [PED, CAR], { reverse: 'E_A' });
  const w = { start_s: 600, end_s: 1200 };
  expect(emitLaneClosures(eb, wb, { primary: [2, 1], partner: [1] }, w)).toEqual([
    { type: 'lane_closure', target_edge: 'E_A', target_lanes: [1, 2], window: w },
    { type: 'lane_closure', target_edge: '-E_A', target_lanes: [1], window: w },
  ]);
  expect(emitLaneClosures(eb, wb, { primary: [1], partner: [] }, null)).toEqual([
    { type: 'lane_closure', target_edge: 'E_A', target_lanes: [1] },
  ]);
  expect(emitLaneClosures(eb, wb, { primary: [], partner: [] }, null)).toEqual([]);
});

test('directionNote: the ratified sentence — the partial tick on a two-way street is SAID', () => {
  const eb = eastbound('E_A', [PED, CAR, CAR], { reverse: '-E_A' });
  const wb = westbound('-E_A', [PED, CAR], { reverse: 'E_A' });
  expect(directionNote(eb, wb, { primary: [1], partner: [] })).toBe('closes eastbound only — westbound stays open');
  expect(directionNote(eb, wb, { primary: [], partner: [1] })).toBe('closes westbound only — eastbound stays open');
  expect(directionNote(eb, wb, { primary: [1], partner: [1] })).toBe('closes both directions — 2 members');
  expect(directionNote(eb, wb, { primary: [], partner: [] })).toBeNull();
  const one = eastbound('B', [CAR], { oneway: true, reverse: null });
  expect(directionNote(one, null, { primary: [0], partner: [] })).toBe('one-way street — eastbound only');
  expect(directionNote(one, null, { primary: [], partner: [] })).toBe('one-way street — eastbound only');
});

test('applyNote (C4b): the both-directions checkbox on a road closure / speed limit says its consequence too', () => {
  const eb = eastbound('E_A', [PED, CAR, CAR], { reverse: '-E_A' });
  const wb = westbound('-E_A', [PED, CAR], { reverse: 'E_A' });
  expect(applyNote(eb, wb, false, 'closes')).toBe('closes eastbound only — westbound stays open');
  expect(applyNote(eb, wb, true, 'closes')).toBe('closes both directions — 2 members');
  expect(applyNote(eb, wb, false, 'applies')).toBe('applies to eastbound only — westbound unchanged');
  expect(applyNote(eb, wb, true, 'applies')).toBe('applies to both directions — 2 members');
  const one = eastbound('B', [CAR], { oneway: true, reverse: null });
  expect(applyNote(one, null, false, 'closes')).toBe('one-way street — eastbound only');
  expect(applyNote(one, null, true, 'applies')).toBe('one-way street — eastbound only');
});
