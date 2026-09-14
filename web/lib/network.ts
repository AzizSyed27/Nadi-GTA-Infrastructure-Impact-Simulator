// The canonical SUMO network exported by python/src/network_export.py → web/public/network.json.
// This is the BASE road layer (the simulation's actual roads), NOT the frozen trajectory contract — it is a
// derived render asset with a stable shape the map reads. Regenerate it when corridor.net.xml changes.

import type { LonLat } from './types';

/** One SUMO lane's permissions — `bus` because 23 lanes on the net are bus+bike (psv) lanes (V2.7d). */
export interface LaneAllows { car: boolean; bike: boolean; ped: boolean; bus: boolean }
/** One row of the per-lane TABLE (V2.7d): index = SUMO lane index, 0 = the curb. */
export interface NetworkLane { width_m: number; allows: LaneAllows }

export interface NetworkEdge {
  id: string;
  /** Ordered [lon, lat] polyline (WGS84), from-node → to-node. */
  geometry: LonLat[];
  /** The per-lane table (V2.7d) — the exact data `laneModel` reads; replaces V2.7c's sidewalk rule. */
  lanes: NetworkLane[];
  /** `lanes.length`, kept as a number for readers that only want a count. */
  lane_count: number;
  speed_mps: number;
  /** True if there is no reverse-partner edge (derived server-side by node pair). */
  oneway: boolean;
  /** Edge-level OR over the table (car/bike/ped only — the shape every pre-V2.7d reader knows). */
  allows: { car: boolean; bike: boolean; ped: boolean };
  /** The OSM street name, or null when the way is unnamed (V2.7d; from the tracked extract by way id). */
  name: string | null;
  /** Node ids — the cross-street walk starts here. */
  from: string;
  to: string;
  /** The NODE-PAIR partner edge (never derived from the id — 3,186 two-way edges break the `-id` guess). */
  reverse: string | null;
}

export interface NetworkData {
  edges: NetworkEdge[];
}

/** Fetch the exported network. Static asset → cacheable (unlike the frequently-rewritten run artifacts). */
export async function loadNetwork(url = '/network.json'): Promise<NetworkEdge[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`failed to fetch ${url}: ${res.status} ${res.statusText}`);
  const data = (await res.json()) as NetworkData;
  return data.edges ?? [];
}

/** Bearing p1→p2 in degrees, clockwise from north (0..360). */
export function bearingDeg([lon1, lat1]: LonLat, [lon2, lat2]: LonLat): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}
// (V2.0b's one-arrow-per-one-way-edge anchor retired in V2.7c C2a: the far band draws no
// direction marks; chevrons at constant on-screen spacing are the z ≥ 15 rung — roadGeometry.)
