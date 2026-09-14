// V2.7d C1a — network.json v2 mock helpers for specs that serve a hand-built `/network.json`.
//
// Every spec mock used to write `lanes: N` (a count). The wire now carries the per-lane TABLE plus
// name / from / to / reverse, and `NetworkEdge` makes them REQUIRED so `tsc` finds every mock. These
// helpers build the minimal honest table: `PED` is the 2.0 m curb sidewalk (index 0), `CAR` a 3.2 m
// general lane (bus-permitted, like 6,429 of the net's car lanes). A mock that wants a bus-only or
// bike-only lane writes it literally — map-ladder.spec keeps its whole NET literal on purpose (the
// regen-proof fixture) and does not use these.
import type { NetworkEdge, NetworkLane } from '../../lib/network';

export const PED: NetworkLane = { width_m: 2.0, allows: { car: false, bike: false, ped: true, bus: false } };
export const CAR: NetworkLane = { width_m: 3.2, allows: { car: true, bike: true, ped: false, bus: true } };
export const BUS: NetworkLane = { width_m: 3.2, allows: { car: false, bike: true, ped: false, bus: true } };

/** `n` lanes total; with `ped`, lane 0 is the sidewalk and the other n−1 are car lanes (the net's shape). */
export function laneTable(n: number, ped: boolean): NetworkLane[] {
  if (ped) return [PED, ...Array.from({ length: Math.max(0, n - 1) }, () => CAR)];
  return Array.from({ length: n }, () => CAR);
}

/** A v2 edge from the old count-shaped mock fields; unnamed, unpartnered unless given. */
export function netEdge(e: {
  id: string;
  /** Plain `number[][]` on purpose: untyped route mocks infer their literals that way; cast once here. */
  geometry: number[][];
  lanes: number | NetworkLane[];
  speed_mps: number;
  oneway: boolean;
  allows: { car: boolean; bike: boolean; ped: boolean };
  name?: string | null;
  from?: string;
  to?: string;
  reverse?: string | null;
}): NetworkEdge {
  const table = typeof e.lanes === 'number' ? laneTable(e.lanes, e.allows.ped) : e.lanes;
  return {
    id: e.id,
    geometry: e.geometry as [number, number][],
    lanes: table,
    lane_count: table.length,
    speed_mps: e.speed_mps,
    oneway: e.oneway,
    allows: e.allows,
    name: e.name ?? null,
    from: e.from ?? `${e.id}:a`,
    to: e.to ?? `${e.id}:b`,
    reverse: e.reverse ?? null,
  };
}
