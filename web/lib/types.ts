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
  /** v0.4.0+. Travel mode this persona speaks for — lets the frontend DERIVE the stakeholder group. */
  mode?: 'car' | 'bicycle' | 'pedestrian' | 'inferred';
  /** v0.4.0+. Stakeholder group this persona voices (mainly inferred personas). */
  stakeholder?: string;
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
 * v0.3.0 agent kinds as an honest discriminated union over `grounding` + which pin is present.
 * The map renders a moving, clickable dot for the two PINNED-sim kinds (they carry a trajectory +
 * outcome + trigger_t); inferred agents have no trip, so no dot (they voice a corridor-wide reaction).
 */
export type SimVehicleAgent = Agent & {
  grounding: 'sim';
  vehicle_id: string;
  outcome: Outcome;
  trigger_t: number;
};
export type SimPersonAgent = Agent & {
  grounding: 'sim';
  person_id: string;
  outcome: Outcome;
  trigger_t: number;
};
/** A sim agent pinned to a real simulated traveler (vehicle OR person) — the clickable-dot kinds. */
export type PinnedSimAgent = SimVehicleAgent | SimPersonAgent;

export function isSimVehicleAgent(a: Agent): a is SimVehicleAgent {
  return a.grounding === 'sim' && a.vehicle_id != null && a.outcome != null && a.trigger_t != null;
}
export function isSimPersonAgent(a: Agent): a is SimPersonAgent {
  return a.grounding === 'sim' && a.person_id != null && a.outcome != null && a.trigger_t != null;
}
/** A pinned sim agent (vehicle- or person-backed): has a trajectory, an outcome and a trigger_t. */
export function isPinnedSim(a: Agent): a is PinnedSimAgent {
  return isSimVehicleAgent(a) || isSimPersonAgent(a);
}

/**
 * DEPRECATED for the render gate (2.6a): the VEHICLE-only narrowing kept from 2.3 for back-compat.
 * The map now renders all pinned-sim agents via `isPinnedSim`; prefer `PinnedSimAgent`.
 */
export type InstrumentedAgent = SimVehicleAgent;

export function isInstrumentedAgent(a: Agent): a is InstrumentedAgent {
  return isSimVehicleAgent(a);
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

/**
 * v0.3.0+. One scorecard cell: a central `value` (POSITIVE = worse) + an optional `affected_share`
 * (fraction of the group adversely affected, 0..1) conveying concentration — a median value near 0
 * with a high share is a concentrated cost, not "no effect".
 */
export interface ScorecardCell {
  value: number | null;
  affected_share?: number | null;
  /** v0.3.0+. Trust flag: 'measured' (from the sim) vs 'low' (heuristic/estimate/not-robust). */
  confidence?: 'measured' | 'low' | null;
  /** v0.3.0+. Free-text caveat (e.g. materiality cutoff or robustness note). */
  note?: string | null;
}

/** v0.3.0+. One stakeholder group's outcome. Uniform sign: POSITIVE = WORSE. null cell = no signal/no trip. */
export interface ScorecardGroup {
  group: string;
  grounding: Grounding;
  travel_time_delta?: ScorecardCell | null;
  safety_delta?: ScorecardCell | null;
  access_delta?: ScorecardCell | null;
}

/** v0.3.0+. Per-STAKEHOLDER outcome summary, NOT a single ROI. `bca` is under-constrained (2.4 defines it). */
export interface Scorecard {
  groups: ScorecardGroup[];
  bca?: Record<string, unknown>;
}

// ---- v0.4.0: the OASIS social-opinion-propagation block (the SECOND graph, NOT the report GraphRAG) ----
// Agent keys use the frontend agentId convention: vehicle_id ?? person_id ?? persona.id (see viz.agentId).

export type Mechanism = 'oasis' | 'neighbor_pass';
export type EdgeKind = 'homophily' | 'geography' | 'cross';
export type SocialAction = 'post' | 'comment' | 'like' | 'repost' | 'follow';
export type ExposedVia = 'follow' | 'recsys';
export type AuditStatus = 'clean' | 'excluded';

/** One social-graph edge (follower `from` -> followee `to`). */
export interface SocialEdge {
  from: string;
  to: string;
  kind: EdgeKind;
}
export interface SocialGraph {
  edges: SocialEdge[];
}

/** One social action in a cascade step. `content` absent for likes; `exposed_via` absent = origin/unprompted. */
export interface SocialEvent {
  agent: string;
  action: SocialAction;
  target_agent?: string;
  target_post?: string;
  content?: string;
  exposed_via?: ExposedVia | null;
  /** 'excluded' = removed from the clean corpus by the immutability/audit guard (kept for provenance). */
  audit_status: AuditStatus;
  /** v0.4.0: when 'excluded', the audit-rule names that excluded it (e.g. 'safety_direction', 'immutability'). */
  excluded_by?: string[];
}
export interface CascadeStep {
  step: number;
  events: SocialEvent[];
}
export interface Cascade {
  cascade_id: string;
  steps: CascadeStep[];
}

export interface TrajectoryPoint {
  step: number;
  stance: Stance;
  sentiment?: number;
}
/** Per-agent opinion movement over cascade steps — the MOVEMENT, not just final state. */
export interface OpinionTrajectory {
  agent: string;
  derived_by?: 'stance_scoring';
  /** v0.4.0: the cascade this trajectory is scored over (absent = the reference cascade). */
  cascade_id?: string;
  points: TrajectoryPoint[];
  shifted?: boolean;
  influenced_by?: string[];
}

export interface ArgumentReach {
  argument: string;
  cascade_id: string;
  reached: number;
  /** v0.4.0: clean posts making this argument. reached/post_count = actions-per-post (volume-confound read). */
  post_count?: number;
}

/** v0.4.0+. Opinion propagation over a social graph (OASIS). A PREVIEW of who shifts whom, never a verdict. */
export interface Social {
  mechanism: Mechanism;
  graph?: SocialGraph;
  cascades?: Cascade[];
  trajectories?: OpinionTrajectory[];
  argument_reach?: ArgumentReach[];
  excluded_count?: number;
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
  /** v0.4.0+, optional. The OASIS opinion-propagation second graph. */
  social?: Social;
}
