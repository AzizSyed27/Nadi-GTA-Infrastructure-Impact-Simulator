// Typed client for the Phase 5.1 job-runner backend (FastAPI on :8000). Every call resolves to an
// ApiResult so callers handle backend-down / 409-locked inline instead of try/catch scattering. Mirrors
// python/src/server.py request+response shapes. CORS is enabled server-side; per-run artifacts are served
// statically from web/public/<run_id>.json (the switcher + refresh fetch those directly, not via this client).

export const API_BASE = 'http://localhost:8000';

/** A snap target from GET /api/junctions (existing SUMO junction). */
export interface Junction {
  id: string;
  lon: number;
  lat: number;
  type: string;
  n_in: number;
  n_out: number;
}

/**
 * V2.0b: GET /api/edges now serves ELIGIBILITY METADATA ONLY (no geometry — that lives in web/public/network.json).
 * The frontend joins this by id onto the rendered network geometry.
 */
export interface EdgeEligibility {
  id: string;
  car_lane_count: number;
  eligible_bike_lane: boolean;
  eligibility_reason: string; // the backend's words (shown as the greyed tooltip when ineligible)
}

/**
 * A selected corridor edge for the edit-an-edge palette — the MERGED shape the palette reads: geometry + speed
 * from the network export, joined with the eligibility metadata from /api/edges. Built client-side in MapView.
 */
export interface Edge extends EdgeEligibility {
  geometry: [number, number][]; // [lon,lat] polyline (from network.json)
  speed_mps: number; // from network.json
}

/** The edits the editor POSTs. Discriminated by `type`; mirrors server.py SimChange dispatch. */
export interface NewRoadChange {
  type: 'new_road';
  from_junction: string;
  to_junction: string;
  lanes: number;
  speed_mps: number;
  bidirectional: boolean;
  description?: string;
}
export interface SpeedLimitChange {
  type: 'speed_limit';
  target_edge: string;
  value_mps: number;
  description?: string;
}
export interface BikeLaneChange {
  type: 'bike_lane';
  target_edge: string;
  target_lane?: number;
  description?: string;
}
/** V2.2a: an active window in sim-seconds — apply at start_s, revert at end_s (windowed + settled
 * is rejected 400: temporary events have no equilibrium). */
export interface ChangeWindow {
  start_s: number;
  end_s: number;
}
export interface LaneClosureChange {
  type: 'lane_closure';
  target_edge: string;
  target_lanes: number[]; // CAR-lane indices; validated against the edge server-side
  window?: ChangeWindow;
  description?: string;
}
export interface RoadClosureChange {
  type: 'road_closure';
  target_edge: string;
  window?: ChangeWindow;
  description?: string;
}
/** V2.2b: a windowed CAPACITY event (blocked lanes and/or edge speed × factor) — never a crash
 * simulation. window is REQUIRED; position_m is accepted + stored but unused this rung. */
export interface IncidentChange {
  type: 'incident';
  target_edge: string;
  window: ChangeWindow;
  effect: { blocked?: boolean; speed_factor?: number };
  target_lanes?: number[]; // required when effect.blocked
  position_m?: number;
  description?: string;
}
export type SimChange =
  | NewRoadChange
  | (SpeedLimitChange & { window?: ChangeWindow })
  | BikeLaneChange
  | LaneClosureChange
  | RoadClosureChange
  | IncidentChange;

export type EnrichStage = 'voices' | 'report' | 'discourse';

/** One row from GET /api/runs. */
export interface RunSummary {
  id: string;
  description: string;
  status: string | null;
  stage: string | null;
  started_at: number | null;
}

/** The run-state JSON from GET /api/runs/<id>/status (superset; fields depend on stage reached). */
export interface RunStatus {
  run_id: string;
  stage: string;
  status: string;
  detail?: string;
  started_at?: number;
  updated_at?: number;
  description?: string;
  change?: { type?: string; target_edge?: string; [k: string]: unknown };
  cars_on_new_road?: number;
  cars_rerouted?: number;
  car_median_delta_s?: number | null; // runtime changes: median car delay (s); 0-reroute reads as "absorbed as delay"
  car_affected_share?: number | null; // fraction of cars materially (>30s) slower
  demand_profile?: string; // V2.1b: which demand the run simulates (synthetic_demo | calibrated_am_peak)
  wall_clock_s?: { baseline?: number; scenario?: number }; // V2.1b: per-run sim wall-clock (V2.1c inputs)
  assignment?: string; // V2.1c: day_one | settled (drives the settling stages on the rail)
  settle_stats?: unknown; // V2.1c: per-leg convergence stats on the terminal state
  n_seeds?: number; // V2.1d: 1 (default) or 3 — the robustness-probe ladder (drives the seeds chip)
  // V2.2a (closure runs only): completed in baseline but not under the closure, per mode — the
  // first-class non-completion fact; and the scheduler's window-revert proof log.
  non_completions?: Record<string, number>;
  window_events?: unknown[];
  // V2.2b (capacity runs: closures + incidents): the emergency-response detour fact — free-flow
  // routing estimate; both honesty sentences ride the payload and must render with the numbers.
  response_detour?: {
    framing: string;
    lower_bound_note: string;
    destination_edge: string | null;
    destination_note?: string;
    probes: {
      label: string;
      origin_edge: string | null;
      baseline_s: number | null;
      scenario_s: number | null;
      added_s: number | null;
      note?: string;
    }[];
  };
}

/** Uniform result: ok with a value, or a friendly error (status set for HTTP failures like 409). */
export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: string; status?: number };

async function req<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const r = await fetch(`${API_BASE}${path}`, init);
    if (!r.ok) {
      // FastAPI errors carry {detail}. Surface it (e.g. the 409 one-job-lock message) verbatim.
      let detail = `HTTP ${r.status}`;
      try {
        const body = await r.json();
        if (body?.detail) detail = String(body.detail);
      } catch {
        /* non-JSON body — keep the status line */
      }
      return { ok: false, error: detail, status: r.status };
    }
    return { ok: true, value: (await r.json()) as T };
  } catch {
    // Network-level failure = the backend isn't running. Callers show a "start the server" affordance.
    return { ok: false, error: 'backend unreachable — start it with `uvicorn server:app --port 8000`' };
  }
}

/** GET /api/junctions?bbox=minLon,minLat,maxLon,maxLat — snap targets in the viewport. */
export function getJunctions(bbox?: [number, number, number, number]): Promise<ApiResult<{ junctions: Junction[]; count: number }>> {
  const q = bbox ? `?bbox=${bbox.join(',')}` : '';
  return req(`/api/junctions${q}`);
}

/** GET /api/edges — V2.0b: eligibility METADATA for every edge (no geometry; joined by id to network.json). */
export function getEdges(): Promise<ApiResult<{ edges: EdgeEligibility[]; count: number }>> {
  return req(`/api/edges`);
}

/** V2.1b/c/d run options riding beside the change: demand + assignment + the robustness-seed count. */
export interface RunOptions {
  demand_profile?: 'synthetic_demo' | 'calibrated_am_peak';
  assignment?: 'day_one' | 'settled';
  n_seeds?: 1 | 3;
}

/** POST /api/simulate — launch an edit run (new_road | speed_limit | bike_lane). 409 if a job is already active. */
export function postSimulate(change: SimChange, options?: RunOptions): Promise<ApiResult<{ run_id: string }>> {
  return req(`/api/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ change, ...options }),
  });
}

/** GET /api/runs — every run the runner knows about (newest first). */
export function getRuns(): Promise<ApiResult<{ runs: RunSummary[] }>> {
  return req(`/api/runs`);
}

/** GET /api/runs/<id>/status — the staged run-state. */
export function getRunStatus(runId: string): Promise<ApiResult<RunStatus>> {
  return req(`/api/runs/${encodeURIComponent(runId)}/status`);
}

/** POST /api/runs/<id>/enrich — run voices | report | discourse against a completed run. 409 if locked. */
export function postEnrich(runId: string, stage: EnrichStage): Promise<ApiResult<{ run_id: string; stage: string }>> {
  return req(`/api/runs/${encodeURIComponent(runId)}/enrich`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stage }),
  });
}
