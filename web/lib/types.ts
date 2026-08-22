// TypeScript half of the frozen trajectory contract.
// Must stay in lockstep with contract/trajectory_schema.json (schema_version 0.10.0).
// v0.10.0 (the V2.6c payload-encoding bump): entities carry EITHER compact {t0, dt} (regular
// cadence; readers materialize via web/lib/compactTime.ts expandTimestamps — the write-time
// check's exact closed form) XOR an explicit timestamps array (teleport-gapped entities keep TRUE
// holes); speeds is DROPPED (its sole consumer moved python-side to the outcomes-sidecar worst_t);
// coords emitted at 6 decimals; Change gains optional via (contract capacity — pipeline refuses it
// until netconvert threading lands). Pre-0.10.0 artifacts keep both index-aligned arrays.
// v0.9.0 (additive over 0.8.0): agents gain the 'mandate' grounding — an INSTITUTIONAL voice with a
// sourced published mandate (mission verbatim, never reworded; retrieved = the freshness signal) +
// citations[] of the run's code-rendered facts with their honesty notes; no pin/outcome/trigger_t;
// sentiment 0 / stance neutral. Forbidden pre-0.9.0.
// v0.8.0 (additive over 0.7.0): scorecard cells gain optional range {min,max,n_seeds,sign_stable} —
// cross-seed robustness (seed 42 canonical: its run IS the artifact; probes contribute only the range;
// sign_stable=false iff the per-seed values strictly straddle zero). Forbidden pre-0.8.0.
// v0.7.0 (additive over 0.6.0): meta.assignment (REQUIRED at 0.7.0 — day-one habits vs settled
// iterated assignment, with convergence stats and the honesty-critical scope: settled iteration covers
// driver route choice only; ped/bike routes stay fixed).
// v0.6.0 (additive over 0.5.0): meta.demand_profile (REQUIRED at 0.6.0 — which demand the run simulated)
// + optional meta.render_sample (vehicles[]/persons[] capped to a stratified render sample; outcomes/
// conflicts/scorecard stay full-population).
// v0.5.0 (additive over 0.4.0): meta.scenario.changes[] (the new authority) + tags[]; Change gains
// window/target_lanes/effect/position_m and the types lane_closure/road_closure/incident. Read the
// change(s) via changesOf(artifact), never `.change` directly. All prior (0.1.0..0.4.0) artifacts stay valid.
// v0.4.0: optional persona.mode/stakeholder + the social{} block. v0.3.0: persons[], conflicts[], scorecard,
// Change.target_lane, agent `grounding` (sim|inferred) + optional person_id.

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
  | 'new_road'
  // v0.5.0+
  | 'lane_closure'
  | 'road_closure'
  | 'incident';

/** v0.5.0+. A time window (sim seconds) a change is active. Absent = active the whole run. */
export interface Window {
  start_s: number;
  end_s: number;
}

/** v0.5.0+. A partial/incident effect on the target: a speed factor and/or a hard block. */
export interface Effect {
  speed_factor?: number;
  blocked?: boolean;
}

/** The proposed infrastructure change. `value_mps` is absent for changes with no scalar (e.g. a signal). */
export interface Change {
  type: ChangeType;
  /** SUMO edge id the change applies to. */
  target_edge: string;
  /** v0.3.0+, optional. Lane index the change applies to (e.g. the car lane converted to a bike lane). */
  target_lane?: number;
  /** v0.5.0+, optional. Lane indices the change applies to (e.g. "close 2 of 4 lanes"). */
  target_lanes?: number[];
  /** Numeric parameter in SI units (e.g. new speed limit in m/s). */
  value_mps?: number;
  /** v0.5.0+, optional. Time window the change is active; absent = whole run. */
  window?: Window;
  /** v0.5.0+, optional. Partial/incident effect on the target. */
  effect?: Effect;
  /** v0.5.0+, optional. Location along target_edge (metres from the edge start), e.g. an incident. */
  position_m?: number;
  description: string;
  /** 5.1: geometry for a new_road (snap to existing junction ids). Optional on the wire; required by the
   *  pipeline for type 'new_road'. For new_road, target_edge is the minted new-edge id. */
  from_junction?: string;
  to_junction?: string;
  lanes?: number;
  speed_mps?: number;
  bidirectional?: boolean;
  /** V2.6d RECORDED DECISION: 'lon,lat' COORDINATE-PAIR strings, NOT junction ids, despite
   *  string[] — 0.10.0 shipped via capacity-only (no producer ever emitted a junction-id via),
   *  so coordinate semantics is the field's FIRST meaning; a 0.11.0 bump to number pairs was
   *  deliberately declined (a full ceremony for one field's type honesty). The SAME decision
   *  comment rides the schema description and contract_models.Change.via (all three mirrors).
   *  Readers parse TOLERANTLY: an item that isn't two finite numbers is skipped (a legacy
   *  junction-id via degrades to the two-junction chord). Via points are shape geometry, not
   *  junctions — nothing can connect mid-curve. */
  via?: string[];
}

/**
 * The scenario a run represents, vs. a baseline run. Absent for plain baseline runs.
 * v0.5.0: `changes` is the authority (a scenario may compose several changes); pre-0.5.0 artifacts carry the
 * single legacy `change`. Read the normalized list via `changesOf(artifact)`, never `.change` directly.
 */
export interface Scenario {
  /** run_id of the baseline (no-change) run this scenario is compared against. */
  baseline_run_id: string;
  /** Legacy single change (pre-0.5.0). Absent for 0.5.0 (use `changes`). */
  change?: Change;
  /** v0.5.0+. The list of changes this scenario composes — the new authority. */
  changes?: Change[];
  /** v0.5.0+. Free-text scenario tags (e.g. "school_zone"). */
  tags?: string[];
}

/** v0.6.0+. Which demand the run simulated: the small randomTrips demo set vs the count-calibrated AM peak. */
export type DemandProfile = 'synthetic_demo' | 'calibrated_am_peak';

/**
 * v0.6.0+, optional. Present ONLY when vehicles[]/persons[] are capped to a stratified render sample;
 * outcomes/conflicts/scorecard stay full-population. Drives the "rendering 1 in N of X travelers" framing.
 */
export interface RenderSample {
  strategy: 'outcome_stratified';
  rendered_vehicles: number;
  total_vehicles: number;
  rendered_persons: number;
  total_persons: number;
}

/**
 * v0.7.0+. The traffic-assignment mode this run represents. day_one = today's route habits (other
 * fields null). settled = iterated assignment until travel times stabilized. scope 'cars_only' is the
 * honesty disclosure: only DRIVER route choice is iterated — ped/bike routes stay fixed, so their rows
 * reflect unadapted behavior even in a settled run.
 */
export interface Assignment {
  mode: 'day_one' | 'settled';
  scope?: 'cars_only' | null;
  iterations?: number | null;
  relative_deviation?: number | null;
  converged?: boolean | null;
  engine?: 'duaIterate_meso' | null;
}

export interface Meta {
  run_id: string;
  network: string;
  bbox: BBox;
  sim_start: number;
  sim_end: number;
  step_length: number;
  created_at: string;
  /** v0.6.0: REQUIRED at 0.6.0 (forbidden before) — optional here so older artifacts stay typed. */
  demand_profile?: DemandProfile;
  /** v0.7.0: REQUIRED at 0.7.0 (forbidden before) — optional here so older artifacts stay typed. */
  assignment?: Assignment;
  /** v0.6.0+, optional (capped artifacts only). */
  render_sample?: RenderSample;
  /** v0.2.0+, optional. */
  scenario?: Scenario;
}

export interface Vehicle {
  id: string;
  /** Free string: "car" or (v0.3.0+) "bicycle". */
  type: string;
  /** Ordered [lon, lat] points; index-aligned with the entity's time series. 6-dp from v0.10.0. */
  path: LonLat[];
  /** Simulation time (s) per point. REQUIRED pre-0.10.0; at v0.10.0 the EXPLICIT shape (XOR with
   *  {t0, dt}). OPTIONAL here so tsc forces every consumer through the normalizer
   *  (viz.materializeTimestamps) — the compile-time twin of failing-loud. */
  timestamps?: number[];
  /** Speed (m/s) per point. Pre-0.10.0 only — DROPPED at v0.10.0 (read by no renderer). */
  speeds?: number[];
  /** v0.10.0 compact: sim time (s) of path[0]; pairs with dt. */
  t0?: number;
  /** v0.10.0 compact: the regular step (s); pairs with t0. */
  dt?: number;
}

/** v0.3.0+. A pedestrian trajectory — same per-entity shape as Vehicle, distinct population. */
export interface Person {
  id: string;
  /** Free string; pedestrians use "pedestrian". */
  type: string;
  path: LonLat[];
  timestamps?: number[];
  speeds?: number[];
  t0?: number;
  dt?: number;
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

export type Grounding = 'sim' | 'inferred' | 'mandate';

/** Versions that may carry mandate-grounded agents (v0.9.0+). EXTEND on every future bump — a
 * literal `=== '0.9.0'` at a consumer silently disables the institutional surfaces the moment the
 * producer moves past 0.9.0 (the enum-plus-gates trap; python mirror: contract_models.MANDATE_VERSIONS). */
export const MANDATE_VERSIONS: readonly string[] = ['0.9.0', '0.10.0'];

/**
 * v0.9.0+. An institution's PUBLISHED mandate, quoted verbatim from a sourced page — never reworded
 * anywhere in the pipeline. `retrieved` is the reader's freshness signal and renders with the mandate.
 */
export interface Mandate {
  institution: string;
  mission: string;
  source: string;
  retrieved: string;
}

/** v0.9.0+. One computed fact a mandate voice cites (text = code-rendered; notes = verbatim honesty sentences). */
export interface Citation {
  key: string;
  text: string;
  notes?: string[];
}

/**
 * A sampled stakeholder agent (NOT one per traveler). `grounding` (v0.3.0+) discriminates:
 *  - 'sim':      pinned to a simulated traveler — exactly one of vehicle_id/person_id, plus outcome + trigger_t.
 *  - 'inferred': no simulated trip (resident/business) — no pin, no outcome, no trigger_t.
 *  - 'mandate':  (v0.9.0+) an institutional voice — sourced published mandate + citations of this run's
 *                computed facts; no pin/outcome/trigger_t; sentiment 0 / stance neutral.
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
  /** v0.9.0+. Mandate agents only. */
  mandate?: Mandate;
  /** v0.9.0+. Mandate agents only (non-empty). */
  citations?: Citation[];
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

/** v0.9.0+. A mandate-grounded institutional voice (sourced mandate + citations; no dot, no trip). */
export type MandateAgent = Agent & {
  grounding: 'mandate';
  mandate: Mandate;
  citations: Citation[];
};
export function isMandateAgent(a: Agent): a is MandateAgent {
  return a.grounding === 'mandate' && a.mandate != null && a.citations != null;
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
 * v0.8.0+. Cross-seed robustness for one cell: [min, max] over the per-seed cell values (seed-42
 * canonical INCLUDED — its run IS the artifact; probes contribute only this range). sign_stable =
 * false iff the per-seed values STRICTLY straddle zero (a zero endpoint does not flip it). There is
 * deliberately NO cross-seed central aggregate. sign_stable exists ONLY here — always access it via
 * `cell.range?.sign_stable === false` so rangeless cells are structurally stable-by-absence.
 */
export interface CellRange {
  min: number;
  max: number;
  n_seeds: number;
  sign_stable: boolean;
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
  /** v0.8.0+. Cross-seed range; absent on single-seed runs (they render exactly as before). */
  range?: CellRange | null;
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

/**
 * v0.5.0 accessor (the migration mechanic, mirrors Python `changes_of`). Normalizes a scenario's change(s)
 * to a list: `changes` if present, else `[change]`, else `[]` (baseline runs / no scenario). Every consumer
 * reads changes via this — never `.change` directly — so a single-change artifact flows through as a list of one.
 */
export function changesOf(artifact: TrajectoryArtifact): Change[] {
  const sc = artifact.meta.scenario;
  if (!sc) return [];
  if (sc.changes) return sc.changes;
  if (sc.change) return [sc.change];
  return [];
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
