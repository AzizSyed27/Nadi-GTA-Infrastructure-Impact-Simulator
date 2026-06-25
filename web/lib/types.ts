// TypeScript half of the frozen trajectory contract.
// Must stay in lockstep with contract/trajectory_schema.json (schema_version 0.2.0).
// v0.2.0 (additive over 0.1.0): optional meta.scenario + optional top-level agents. vehicles unchanged.

/** [minLon, minLat, maxLon, maxLat] in WGS84. */
export type BBox = [number, number, number, number];

/** A single geographic point: [lon, lat] in WGS84. */
export type LonLat = [number, number];

export type ChangeType =
  | 'speed_limit'
  | 'add_lane'
  | 'remove_lane'
  | 'new_signal'
  | 'bike_lane'
  | 'new_road';

/** The proposed infrastructure change. `value_mps` is absent for changes with no scalar (e.g. a signal). */
export interface Change {
  type: ChangeType;
  /** SUMO edge id the change applies to. */
  target_edge: string;
  /** Numeric parameter in SI units (e.g. new speed limit in m/s). */
  value_mps?: number;
  description: string;
}

/** The scenario a run represents, vs. a baseline run. Absent for plain baseline runs. */
export interface Scenario {
  /** run_id of the baseline (no-change) run this scenario is compared against. */
  baseline_run_id: string;
  change: Change;
}

export interface Meta {
  run_id: string;
  network: string;
  bbox: BBox;
  sim_start: number;
  sim_end: number;
  step_length: number;
  created_at: string;
  /** v0.2.0+, optional. */
  scenario?: Scenario;
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

export interface Persona {
  id: string;
  label: string;
}

/** Quantitative baseline-vs-scenario outcome for one traveler (seconds). */
export interface Outcome {
  baseline_duration: number;
  scenario_duration: number;
  delta_seconds: number;
  baseline_timeloss: number;
  scenario_timeloss: number;
}

export type Stance = 'supportive' | 'neutral' | 'opposed';

/** The persona's anticipated reaction — a PREVIEW of texture/objection, never a verdict. */
export interface Reaction {
  comment: string;
  /** Sentiment in [-1, 1]; -1 strongly negative, +1 strongly positive. */
  sentiment: number;
  stance: Stance;
}

/** A sampled persona agent pinned to a specific simulated vehicle (NOT one per vehicle). */
export interface Agent {
  /** id of the vehicle (in vehicles[]) this agent is pinned to. */
  vehicle_id: string;
  persona: Persona;
  outcome: Outcome;
  reaction: Reaction;
  /** Sim time (s) the reaction is keyed to during playback. */
  trigger_t: number;
}

export interface TrajectoryArtifact {
  schema_version: string;
  meta: Meta;
  vehicles: Vehicle[];
  /** v0.2.0+, optional. */
  agents?: Agent[];
}
