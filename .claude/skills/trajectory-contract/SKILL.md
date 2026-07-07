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
   AND updating BOTH sides (Python models + TS types) in the same change. Current: **`0.4.0`**.
   `schema_version` is an **enum `["0.1.0", "0.2.0", "0.3.0", "0.4.0"]`** — 0.4.0 is what new runs emit; older
   versions are accepted for back-compat reads (they simply omit the newer optional structures).
   **v0.4.0 added, ADDITIVELY (all optional, no renames):** optional `persona.mode`
   (`car|bicycle|pedestrian|inferred`) + `persona.stakeholder` (so the frontend can DERIVE the group), and an
   optional top-level **`social`** block — the OASIS opinion-propagation SECOND graph (graph edges,
   cascades of events, per-agent opinion trajectories, argument reach). A PREVIEW, never a verdict; distinct
   from the report agent's GraphRAG. Agent keys use the frontend agentId convention
   (`vehicle_id ?? person_id ?? persona.id`). A `SocialEdge`'s `from` is a Python keyword → stored as `from_`
   with a wire alias; `dump_artifact` uses `by_alias=True`. Every v0.3.0 artifact stays valid. A deterministic
   IMMUTABILITY checker (`python/src/social_checks.py`) guards that a post never claims a trip direction that
   contradicts the agent's measured `delta_seconds` sign.
   **v0.2.0 added, ADDITIVELY:** optional `meta.scenario` + optional top-level `agents`.
   **v0.3.0 added, ADDITIVELY (all optional, no renames):** top-level `persons[]` (pedestrian
   trajectories, same per-entity shape as `vehicles`), `conflicts[]` (safety SURROGATES — never crash
   prediction), `scorecard` (per-STAKEHOLDER outcome, NOT a single ROI); `meta.scenario.change.target_lane`;
   and an agent **`grounding`** discriminator (`"sim"` | `"inferred"`) with `person_id` — so `vehicle_id`,
   `person_id`, `outcome`, `trigger_t` are now all OPTIONAL on an agent. `vehicles` is unchanged; every
   v0.1.0/v0.2.0 artifact stays valid.
   - **`grounding` is enforced by a schema `if/then`** (required when `schema_version` is `"0.3.0"` or
     `"0.4.0"`), so old grounding-less agents keep validating. The **sim/inferred field-presence invariant** (sim ⇒
     exactly one of vehicle_id/person_id + outcome + trigger_t; inferred ⇒ none) is enforced in the MODEL,
     not the schema. The pydantic `Agent` defaults `grounding="sim"` so v0.2.0 agents still model-load.
   - **Uniform scorecard sign: POSITIVE = WORSE for the group.** Group deltas are optional & nullable
     (`null`/absent = no signal / no trip). New structures are deliberately under-constrained (2.4 tightens).
3. `path`, `timestamps`, `speeds` are **index-aligned** per vehicle (same length, same order).
4. `timestamps` are **simulation seconds** (matches deck.gl `currentTime`/`trailLength` units on the web side).
5. `contract/` is **write-guarded by a PreToolUse hook** (`.claude/hooks/guard.py`) — edits via the
   Write/Edit tools are blocked (exit 2). For a deliberate version bump, temporarily disable that hook
   in `.claude/settings.json`, make the change, re-enable. (Runtime writes from Python aren't tool-guarded.)

## Where the (de)serializers live
| World | File | What it does |
|---|---|---|
| Canonical schema | `contract/trajectory_schema.json` | JSON Schema (draft 2020-12). The authority both sides validate against. |
| Python — typed models | `python/src/contract_models.py` | pydantic v2 `Meta` / `Vehicle` / `TrajectoryArtifact` + (v0.2.0) `Scenario` / `Change` / `Agent` / `Persona` / `Outcome` / `Reaction` + (v0.3.0) `Person` / `Conflict` / `ScorecardGroup` / `Scorecard` (+ `SCHEMA_VERSION`). `Agent` carries a `@model_validator` for the sim/inferred invariant. |
| Python — (de)serializer | `python/src/trajectory_io.py` | `validate_artifact(dict)`, `dump_artifact(artifact, path?)` (validates → writes), `load_artifact(path)` (reads → validates → pydantic), `load_schema()`. Validates against the schema file on every read/write. |
| TS — typed mirror | `web/lib/types.ts` | `Meta` / `Vehicle` / `TrajectoryArtifact` + (v0.2.0) `Scenario` / `Change` / `Agent` / `Persona` / `Outcome` / `Reaction` + (v0.3.0) `Person` / `Conflict` / `ScorecardGroup` / `Scorecard` / `Grounding` interfaces + the `InstrumentedAgent` narrowing helper (compile-time only). |
| TS — loader + validator | `web/lib/loadArtifact.ts` | `loadArtifact(url)`: fetch → **ajv** validate against the imported `contract/trajectory_schema.json` (Ajv2020 for draft 2020-12 + `ajv-formats` for `date-time`) → typed `TrajectoryArtifact`. Same authority as Python → no drift. Throws `ArtifactValidationError`. |
| TS — consumer | `web/components/MapView.tsx` | currently `fetch('/run.json')` → cast (the v0.1.0 spine playback). New 0.2.0 consumers should use `loadArtifact()` instead of a bare cast. |

Artifacts are emitted to `contract/runs/<run_id>.json` (see the `run-sim` skill). `contract/runs/` is gitignored.

## To extend the contract (the only correct procedure)
1. Bump `schema_version` (e.g. `0.1.0` → `0.2.0`) in `contract/trajectory_schema.json`.
2. Mirror the change in `python/src/contract_models.py` AND `web/lib/types.ts` (and any consumer).
3. Update `python/src/trajectory_io.py` only if validation logic changes (it reads the schema file, so
   field changes are picked up automatically).
4. Re-emit a run (`run-sim` skill) and confirm `load_artifact()` still validates.

## Schema reference (schema_version 0.4.0) — keep both worlds consistent with THIS
Top level: `{ schema_version, meta, vehicles }` required; **`persons`, `agents`, `conflicts`, `scorecard`,
`social` all optional**. `schema_version` is `{"enum": ["0.1.0", "0.2.0", "0.3.0", "0.4.0"]}`.

**v0.4.0 additions (all optional, additive):**
```json
"persona": { "id": "...", "label": "...", "mode": "car|bicycle|pedestrian|inferred", "stakeholder": "business_owner" },
"social": {
  "mechanism": "oasis",                                  // required; "neighbor_pass" reserved
  "graph": { "edges": [ { "from": "agentId", "to": "agentId", "kind": "homophily|geography|cross" } ] },
  "cascades": [ { "cascade_id": "c1", "steps": [ { "step": 0, "events": [
    { "agent": "agentId", "action": "post|comment|like|repost|follow", "target_agent": "?", "target_post": "?",
      "content": "?", "exposed_via": "follow|recsys|null", "audit_status": "clean|excluded" } ] } ] } ],
  "trajectories": [ { "agent": "agentId", "derived_by": "stance_scoring",
    "points": [ { "step": 0, "stance": "supportive|neutral|opposed", "sentiment": 0.5 } ],
    "shifted": true, "influenced_by": ["agentId"] } ],
  "argument_reach": [ { "argument": "...", "cascade_id": "c1", "reached": 3 } ],
  "excluded_count": 1
}
// social requires mechanism; event requires agent+action+audit_status (content optional — likes carry none).
// A full example lives at contract/runs/sample_v0_4_0.json (+ web/public/). excluded events stay for provenance
// but MUST NOT reach the clean corpus (report_agent.build_corpus filters them).
```

### Schema reference (v0.3.0 additions, still valid):
`schema_version` also accepts `"0.3.0"`.

**v0.3.0 additions (all optional, additive):**
```json
"persons":   [ { "id": "ped0", "type": "pedestrian", "path": [[lon,lat]], "timestamps": [..], "speeds": [..] } ],
"conflicts": [ { "t": 300.0, "lon": .., "lat": .., "type": "ttc|hard_braking|blocked_junction",
                 "severity": 0.85, "ttc": 1.3, "pet": 2.1, "entities": ["bike0","car1"] } ],
                 // required: t, lon, lat, type, severity ; optional: ttc, pet, entities. SURROGATE, never a crash.
"scorecard": { "groups": [ { "group": "drivers", "grounding": "sim|inferred",
                             "travel_time_delta": 14.0, "safety_delta": 0.2, "access_delta": null } ],
               "bca": { } }
               // group requires group+grounding; the 3 deltas optional & nullable. SIGN: positive = WORSE. NOT an ROI.
```
`meta.scenario.change` gains optional **`target_lane`** (integer). `agents[]` gains **`grounding`**
(`"sim"|"inferred"`, required for 0.3.0 via schema if/then) and optional **`person_id`**; a sim agent has
exactly one of `vehicle_id`/`person_id` + `outcome` + `trigger_t`, an inferred agent has NONE of those
(model-enforced). A full example lives at `contract/runs/sample_v0_3_0.json` (+ `web/public/`).

---
### v0.2.0 core (still valid):

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
