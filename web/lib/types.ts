// TypeScript half of the frozen trajectory contract.
// Must stay in lockstep with contract/trajectory_schema.json (schema_version 0.1.0).

/** [minLon, minLat, maxLon, maxLat] in WGS84. */
export type BBox = [number, number, number, number];

/** A single geographic point: [lon, lat] in WGS84. */
export type LonLat = [number, number];

export interface Meta {
  run_id: string;
  network: string;
  bbox: BBox;
  sim_start: number;
  sim_end: number;
  step_length: number;
  created_at: string;
}

export interface Vehicle {
  id: string;
  type: string;
  /** Ordered [lon, lat] points; index-aligned with timestamps and speeds. */
  path: LonLat[];
  /** Simulation time (s) per point. */
  timestamps: number[];
  /** Speed (m/s) per point. */
  speeds: number[];
}

export interface TrajectoryArtifact {
  schema_version: string;
  meta: Meta;
  vehicles: Vehicle[];
}
