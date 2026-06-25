---
name: trajectory-contract
description: Use whenever reading, writing, parsing, validating, or extending the trajectory artifact — the FROZEN Python<->TS data contract for the Nadi project. Triggers on anything touching contract/trajectory_schema.json, contract/runs/*.json, the meta/vehicles shape, lon/lat trajectory data, or either side's (de)serializer. READ THIS BEFORE changing the artifact shape so both worlds stay in sync.
---

# trajectory-contract — the frozen Python<->TS boundary

`contract/` is the single source of truth between `python/` (produces runs) and `web/` (renders them).
The artifact is a SUMO run reduced to per-vehicle GEOGRAPHIC trajectories.

## Cardinal rules
1. **Positions are ALWAYS `[lon, lat]` (WGS84)** — never SUMO internal x/y. (Wrong → dots in the ocean.)
2. **The schema is FROZEN.** Do not change field names/types/shape without **bumping `schema_version`**
   AND updating BOTH sides (Python models + TS types) in the same change. Current: **`0.2.0`**.
   `schema_version` is an **enum `["0.1.0", "0.2.0"]`** — 0.2.0 is what new runs emit; 0.1.0 is still
   accepted for back-compat reads (such artifacts simply omit `meta.scenario` and `agents`).
   **v0.2.0 added, ADDITIVELY:** optional `meta.scenario` (the proposed change vs. a baseline run)
   and an optional top-level `agents` array (sampled stakeholder reactions). `vehicles` is unchanged.
3. `path`, `timestamps`, `speeds` are **index-aligned** per vehicle (same length, same order).
4. `timestamps` are **simulation seconds** (matches deck.gl `currentTime`/`trailLength` units on the web side).
5. `contract/` is **write-guarded by a PreToolUse hook** (`.claude/hooks/guard.py`) — edits via the
   Write/Edit tools are blocked (exit 2). For a deliberate version bump, temporarily disable that hook
   in `.claude/settings.json`, make the change, re-enable. (Runtime writes from Python aren't tool-guarded.)

## Where the (de)serializers live
| World | File | What it does |
|---|---|---|
| Canonical schema | `contract/trajectory_schema.json` | JSON Schema (draft 2020-12). The authority both sides validate against. |
| Python — typed models | `python/src/contract_models.py` | pydantic v2 `Meta` / `Vehicle` / `TrajectoryArtifact` + (v0.2.0) `Scenario` / `Change` / `Agent` / `Persona` / `Outcome` / `Reaction` (+ `SCHEMA_VERSION`). |
| Python — (de)serializer | `python/src/trajectory_io.py` | `validate_artifact(dict)`, `dump_artifact(artifact, path?)` (validates → writes), `load_artifact(path)` (reads → validates → pydantic), `load_schema()`. Validates against the schema file on every read/write. |
| TS — typed mirror | `web/lib/types.ts` | `Meta` / `Vehicle` / `TrajectoryArtifact` + (v0.2.0) `Scenario` / `Change` / `Agent` / `Persona` / `Outcome` / `Reaction` interfaces (compile-time only). |
| TS — loader + validator | `web/lib/loadArtifact.ts` | `loadArtifact(url)`: fetch → **ajv** validate against the imported `contract/trajectory_schema.json` (Ajv2020 for draft 2020-12 + `ajv-formats` for `date-time`) → typed `TrajectoryArtifact`. Same authority as Python → no drift. Throws `ArtifactValidationError`. |
| TS — consumer | `web/components/MapView.tsx` | currently `fetch('/run.json')` → cast (the v0.1.0 spine playback). New 0.2.0 consumers should use `loadArtifact()` instead of a bare cast. |

Artifacts are emitted to `contract/runs/<run_id>.json` (see the `run-sim` skill). `contract/runs/` is gitignored.

## To extend the contract (the only correct procedure)
1. Bump `schema_version` (e.g. `0.1.0` → `0.2.0`) in `contract/trajectory_schema.json`.
2. Mirror the change in `python/src/contract_models.py` AND `web/lib/types.ts` (and any consumer).
3. Update `python/src/trajectory_io.py` only if validation logic changes (it reads the schema file, so
   field changes are picked up automatically).
4. Re-emit a run (`run-sim` skill) and confirm `load_artifact()` still validates.

## Schema reference (schema_version 0.2.0) — keep both worlds consistent with THIS
Top level: `{ schema_version, meta, vehicles }` required; **`agents` optional**. `schema_version`
is `{"enum": ["0.1.0", "0.2.0"]}`.

**`meta`** (required `run_id, network, bbox, sim_start, sim_end, step_length, created_at`):
`bbox` = `[minLon, minLat, maxLon, maxLat]`; `created_at` is a `date-time`. **`meta.scenario` is
OPTIONAL (v0.2.0+)** — the proposed change vs. a baseline run:
```json
"scenario": {
  "baseline_run_id": "string",
  "change": {
    "type": "speed_limit | add_lane | remove_lane | new_signal | bike_lane | new_road",
    "target_edge": "edge_id",
    "value_mps": 8.33,                 // OPTIONAL — omit for changes with no scalar (e.g. a signal)
    "description": "free text"
  }                                     // change requires: type, target_edge, description
}                                       // scenario requires: baseline_run_id, change
```

**`vehicles[]`** (UNCHANGED from v0.1.0; required `id, type, path, timestamps, speeds`):
`path` = ordered `[lon, lat]` points (WGS84); `timestamps` (sim seconds) and `speeds` (m/s) are
index-aligned with `path`.

**`agents[]`** (OPTIONAL, v0.2.0+) — sampled persona reactions pinned to vehicles (NOT one per
vehicle). Each agent requires `vehicle_id, persona, outcome, reaction, trigger_t`:
```json
{
  "vehicle_id": "veh0",                                    // must reference a vehicles[].id
  "persona":  { "id": "time_pressed", "label": "Time-pressed commuter" },
  "outcome":  { "baseline_duration": 1320.0, "scenario_duration": 1860.0, "delta_seconds": 540.0,
                "baseline_timeloss": 110.0, "scenario_timeloss": 640.0 },   // all required, seconds
  "reaction": { "comment": "…", "sentiment": -0.7, "stance": "supportive | neutral | opposed" },
                                                           // sentiment in [-1, 1]
  "trigger_t": 60.0                                        // sim seconds, >= 0
}
```
All objects are `additionalProperties: false`. A hand-authored sample exercising every field lives at
`contract/runs/sample_v0_2_0.json` (and `web/public/sample_v0_2_0.json`). The committed
`contract/trajectory_schema.json` is the authority — this block is a quick reference; if they ever
differ, the file wins.

> Note: the `run-sim` skill's "Verify a run" one-liner prints `0.1.0` for the existing spine
> artifact; once the sim is re-run it will emit `0.2.0` (and the golden test's exact `schema_version`
> match will need a one-time refresh — see `python/tests/test_golden_trajectory.py`).
