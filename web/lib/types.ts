// TypeScript half of the frozen trajectory contract.
// Must stay in lockstep with contract/trajectory_schema.json (schema_version 0.3.0).
// v0.3.0 (additive over 0.2.0): optional persons[], conflicts[], scorecard; Change.target_lane;
// agent `grounding` (sim|inferred) + optional person_id (vehicle_id/outcome/trigger_t now optional).
// vehicles[] unchanged. All prior (0.1.0/0.2.0) artifacts stay valid.

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
  /** v0.3.0+, optional. Lane index the change applies to (e.g. the car lane converted to a bike lane). */
  target_lane?: number;
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
  /** Free string: "car" or (v0.3.0+) "bicycle". */
  type: string;
  /** Ordered [lon, lat] points; index-aligned with timestamps and speeds. */
  path: LonLat[];
  /** Simulation time (s) per point. */
  timestamps: number[];
  /** Speed (m/s) per point. */
  speeds: number[];
}

/** v0.3.0+. A pedestrian trajectory — same per-entity shape as Vehicle, distinct population. */
export interface Person {
  id: string;
  /** Free string; pedestrians use "pedestrian". */
  type: string;
  path: LonLat[];
  timestamps: number[];
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

export type Grounding = 'sim' | 'inferred';

/**
 * A sampled stakeholder agent (NOT one per traveler). `grounding` (v0.3.0+) discriminates:
 *  - 'sim':      pinned to a simulated traveler — exactly one of vehicle_id/person_id, plus outcome + trigger_t.
 *  - 'inferred': no simulated trip (resident/business) — no pin, no outcome, no trigger_t.
 */
export interface Agent {
  persona: Persona;
  reaction: Reaction;
  /** v0.3.0+. Required for 0.3.0 artifacts (older artifacts are treated as 'sim'). */
  grounding: Grounding;
  /** id of the vehicle (in vehicles[]) a sim-grounded agent is pinned to. */
  vehicle_id?: string;
  /** v0.3.0+. id of the person (in persons[]) a sim-grounded pedestrian agent is pinned to. */
  person_id?: string;
  outcome?: Outcome;
  /** Sim time (s) the reaction is keyed to during playback. */
  trigger_t?: number;
}

/**
 * A sim-grounded agent pinned to a VEHICLE — the shape the current map playback renders
 * (vehicle_id + outcome + trigger_t all guaranteed). Narrow an `Agent` with `isInstrumentedAgent`.
 * (Pedestrian-pinned sim agents and inferred agents are handled by later steps, not the map yet.)
 */
export type InstrumentedAgent = Agent & {
  vehicle_id: string;
  outcome: Outcome;
  trigger_t: number;
};

export function isInstrumentedAgent(a: Agent): a is InstrumentedAgent {
  return a.vehicle_id != null && a.outcome != null && a.trigger_t != null;
}

/** v0.3.0+. A safety-SURROGATE event (never a crash prediction). Under-constrained; 2.4 tightens. */
export interface Conflict {
  /** Simulation time (s) of the conflict. */
  t: number;
  lon: number;
  lat: number;
  /** e.g. "ttc", "hard_braking", "blocked_junction". */
  type: string;
  /** Surrogate magnitude; higher = worse. */
  severity: number;
  ttc?: number;
  pet?: number;
  entities?: string[];
}

/** v0.3.0+. One stakeholder group's outcome. Uniform sign: POSITIVE = WORSE. null = no signal/no trip. */
export interface ScorecardGroup {
  group: string;
  grounding: Grounding;
  travel_time_delta?: number | null;
  safety_delta?: number | null;
  access_delta?: number | null;
}

/** v0.3.0+. Per-STAKEHOLDER outcome summary, NOT a single ROI. `bca` is under-constrained (2.4 defines it). */
export interface Scorecard {
  groups: ScorecardGroup[];
  bca?: Record<string, unknown>;
}

export interface TrajectoryArtifact {
  schema_version: string;
  meta: Meta;
  vehicles: Vehicle[];
  /** v0.3.0+, optional. */
  persons?: Person[];
  /** v0.2.0+, optional. */
  agents?: Agent[];
  /** v0.3.0+, optional. */
  conflicts?: Conflict[];
  /** v0.3.0+, optional. */
  scorecard?: Scorecard;
}
