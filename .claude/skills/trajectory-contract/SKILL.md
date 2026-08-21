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
   AND updating BOTH sides (Python models + TS types) in the same change. Current: **`0.10.0`**.
   `schema_version` is an **enum `["0.1.0" … "0.10.0"]`** — 0.10.0 is what new runs emit; older
   versions are accepted for back-compat reads. NB the per-version reference sections BELOW this
   file's fold stop at 0.5.0 and are HISTORICAL — v0.6.0 (demand_profile/render_sample), v0.7.0
   (assignment), v0.8.0 (scorecard cell ranges), v0.9.0 (mandate agents) and v0.10.0 (below) are
   documented in the schema's own top-level description + CLAUDE.md's phase blocks; the committed
   `contract/trajectory_schema.json` is ALWAYS the authority when this doc lags.
   **v0.10.0 (V2.6c, the payload encoding):** per-entity EITHER-shape time series — compact
   `{t0, dt}` when the cadence is exactly regular (write-time-checked against `t0 + i*dt` within
   the shared `COMPACT_DT_EPS`; the reader reconstructs with the SAME closed form —
   `contract_models.expand_timestamps` / `web/lib/compactTime.ts`, lockstep-pinned) XOR the
   explicit `timestamps` array (teleport-gapped entities keep TRUE holes); **`speeds` is DROPPED**
   (the sole consumer, sampler's worst-moment/trigger_t pass, reads the outcomes-sidecar `worst_t`
   stamped by the harness at record time — `SpeedsUnavailableError` is the named backstop);
   coordinates are emitted at 6 decimals (~11 cm, rounded at RECORD time, never in
   dump_artifact); `Change` gains optional `via` (new_road waypoints — CONTRACT CAPACITY only,
   the pipeline refuses it until netconvert threading lands).
   **v0.5.0 added, ADDITIVELY (all optional, no renames):** `meta.scenario.changes[]` — the new change AUTHORITY
   (a scenario may compose several changes) — plus optional `meta.scenario.tags[]`; and `Change` gains
   `window`/`target_lanes`/`effect`/`position_m` and the types `lane_closure`/`road_closure`/`incident`. A 0.5.0
   scenario carries `changes[]` and OMITS the legacy single `change`; pre-0.5.0 keeps `change` (version-gated in
   the schema `allOf`). **Read the change(s) via the ACCESSOR — python `changes_of(artifact)` / TS
   `changesOf(artifact)` — never `.change` directly.** Semantic invariants (window.end>start, incident⇒window,
   lane_closure⇒target_lanes) live in the pydantic models; the schema stays loose. `trajectory_io.dump_artifact`
   also runs `audit_version_gate` (version↔shape self-check). The v0.5.0 producer still applies ONE change,
   emitted as `changes:[change]`; windowed/incident/closure MECHANICS are proven by `sample_v0_5_0.json` only
   (no runtime applier yet — V2.2). The **grounding gate was extended to 0.5.0** (a bump must not drop a prior
   obligation).
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
3. **Pre-0.10.0:** `path`, `timestamps`, `speeds` are **index-aligned** per entity (same length,
   same order). **At 0.10.0:** `speeds` does not exist; `path` is index-aligned with the entity's
   MATERIALIZED time series (the explicit `timestamps` array, or `t0 + i*dt` over
   `path.length` when compact) — readers materialize once via the shared helpers, never per frame.
4. `timestamps` are **simulation seconds** (matches deck.gl `currentTime`/`trailLength` units on the web side).
5. `contract/` is **write-guarded by a PreToolUse hook** (`.claude/hooks/guard.py`) that now **ASKS** — a
   Write/Edit/MultiEdit to `contract/` raises an in-the-moment permission prompt. **The legitimate path is
   simply: use the Write/Edit tool and APPROVE the prompt** (still bump `schema_version` + mirror both sides).
   The old comment-out-`settings.json` dance is **RETIRED** — the hook is always on. **Bash/runtime writes to
   `contract/` are PROHIBITED by convention**: the matcher only covers Write/Edit/MultiEdit, so a Bash+Python
   heredoc slips under the guard — that is a **process violation policed by plan review**, not a clever route.

## Where the (de)serializers live
| World | File | What it does |
|---|---|---|
| Canonical schema | `contract/trajectory_schema.json` | JSON Schema (draft 2020-12). The authority both sides validate against. |
| Python — typed models | `python/src/contract_models.py` | pydantic v2 `Meta` / `Vehicle` / `TrajectoryArtifact` + (v0.2.0) `Scenario` / `Change` / `Agent` / `Persona` / `Outcome` / `Reaction` + (v0.3.0) `Person` / `Conflict` / `ScorecardGroup` / `Scorecard` (+ `SCHEMA_VERSION`). `Agent` carries a `@model_validator` for the sim/inferred invariant. |
| Python — (de)serializer | `python/src/trajectory_io.py` | `validate_artifact(dict)`, `dump_artifact(artifact, path?)` (validates → writes), `load_artifact(path)` (reads → validates → pydantic), `load_schema()`. Validates against the schema file on every read/write. |
| TS — typed mirror | `web/lib/types.ts` | `Meta` / `Vehicle` / `TrajectoryArtifact` + (v0.2.0) `Scenario` / `Change` / `Agent` / `Persona` / `Outcome` / `Reaction` + (v0.3.0) `Person` / `Conflict` / `ScorecardGroup` / `Scorecard` / `Grounding` interfaces + the `InstrumentedAgent` narrowing helper (compile-time only). |
| TS — consumer | `web/components/MapView.tsx` | resolves the `/latest.json` POINTER (V2.5c) or `?run=` → `fetch('/<run_id>.json')` → typed cast. There is deliberately NO client-side schema validation (the ajv loader `web/lib/loadArtifact.ts` was deleted in V2.5c — zero importers, and browser ajv on multi-MB artifacts is multi-second jank); validation lives Python-side in `trajectory_io` on every write/read. |

Artifacts are emitted to `contract/runs/<run_id>.json` (see the `run-sim` skill). `contract/runs/` is gitignored.

## To extend the contract — THE FULL CEREMONY (what 0.9.0 and 0.10.0 actually performed)
0. Make every `contract/` edit through the **Write/Edit tool** and **approve the guard's ask prompt** — never
   through Bash/Python (that bypasses the guard and is a banned process violation, per cardinal rule 5).
1. Bump the `schema_version` enum + the top-level description prose in `contract/trajectory_schema.json`.
2. **Audit EVERY existing `allOf` gate**: obligation gates ("vX+ requires …") gain the new version in
   their `if.enum` + a "$comment EXTENDED for …" note; forbid gates (pre-vX) stay FROZEN. Add a NEW
   pre-<new> forbid gate for whatever the bump introduces (the `properties:false` idiom — null-safe;
   `required: ["schema_version"]` inside `if` is load-bearing).
3. Mirror in `python/src/contract_models.py` (SCHEMA_VERSION, the Literal union, models, the
   version-set constants — MANDATE_VERSIONS / COMPACT_TRAJECTORY_VERSIONS extend on EVERY bump; a
   literal `== "0.x.0"` at a consumer is the enum-plus-gates trap) AND `web/lib/types.ts` (types,
   the TS version-set mirrors, the header changelog).
4. Extend `trajectory_io.audit_version_gate` — every forward tuple + every `not in (…)` forbid
   (never a literal `!=` — the regression-pinned bump trap) + any new shape gate.
5. Author `web/public/sample_v0_<new>.json` (0.6.0+ samples live in web/public ONLY) exercising the
   new fields AND carrying prior-version features (the carry pins).
6. Tests on the established template block in `python/tests/test_golden_trajectory.py`: the positive
   sample test, **negatives BOTH layers** (schema + audit) for mis-versioned shapes in BOTH
   directions, semantics negatives, the prior-obligation audit, the dump/reload roundtrip; append
   the new sample to the back-compat ladder + relax the open-ended producer tuples (pin-relax).
7. Producer emits the new version NOW; committed fixtures/pinned runs STAY at their vintages (they
   ARE the back-compat proof — do not regen).
8. One REAL-run acceptance end-to-end (produce → enrich → report → browser), suites fully green.
9. Update THIS skill doc's "Current:" + cardinal rules if the bump changed them (0.10.0 did).
10. Record the bump in CLAUDE.md (block + rollup) and strike/append BACKLOG.

## Schema reference (schema_version 0.5.0) — keep both worlds consistent with THIS
Top level: `{ schema_version, meta, vehicles }` required; **`persons`, `agents`, `conflicts`, `scorecard`,
`social` all optional**. `schema_version` is `{"enum": ["0.1.0", "0.2.0", "0.3.0", "0.4.0", "0.5.0"]}`.

**v0.5.0 additions (additive; `changes[]` is the new AUTHORITY — read via `changes_of`/`changesOf`):**
```json
"meta": { "scenario": {
  "baseline_run_id": "...",
  "changes": [ { "type": "lane_closure", "target_edge": "E1", "target_lanes": [2,3],
                 "window": {"start_s": 0, "end_s": 3600} },
               { "type": "incident", "target_edge": "E1", "window": {"start_s": 600, "end_s": 1200},
                 "effect": {"speed_factor": 0.3, "blocked": false}, "position_m": 120 },
               { "type": "speed_limit", "target_edge": "E1", "value_mps": 8.33, "description": "..." } ],
  "tags": ["school_zone"]
} }
// 0.5.0 REQUIRES scenario.changes[] and FORBIDS the legacy scenario.change (version-gated in allOf); pre-0.5.0
// requires the single change. Change.type adds lane_closure/road_closure/incident; Change gains
// window/target_lanes/effect/position_m (all optional). window.end>start, incident⇒window,
// lane_closure⇒target_lanes are pydantic-only. Sample: contract/runs/sample_v0_5_0.json (+ web/public/).
```

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
