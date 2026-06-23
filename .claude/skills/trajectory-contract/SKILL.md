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
   AND updating BOTH sides (Python models + TS types) in the same change. Current: **`0.1.0`**.
3. `path`, `timestamps`, `speeds` are **index-aligned** per vehicle (same length, same order).
4. `timestamps` are **simulation seconds** (matches deck.gl `currentTime`/`trailLength` units on the web side).
5. `contract/` is **write-guarded by a PreToolUse hook** (`.claude/hooks/guard.py`) — edits via the
   Write/Edit tools are blocked (exit 2). For a deliberate version bump, temporarily disable that hook
   in `.claude/settings.json`, make the change, re-enable. (Runtime writes from Python aren't tool-guarded.)

## Where the (de)serializers live
| World | File | What it does |
|---|---|---|
| Canonical schema | `contract/trajectory_schema.json` | JSON Schema (draft 2020-12). The authority both sides validate against. |
| Python — typed models | `python/src/contract_models.py` | pydantic v2 `Meta` / `Vehicle` / `TrajectoryArtifact` (+ `SCHEMA_VERSION`). |
| Python — (de)serializer | `python/src/trajectory_io.py` | `validate_artifact(dict)`, `dump_artifact(artifact, path?)` (validates → writes), `load_artifact(path)` (reads → validates → pydantic), `load_schema()`. Validates against the schema file on every read/write. |
| TS — typed mirror | `web/lib/types.ts` | `Meta` / `Vehicle` / `TrajectoryArtifact` interfaces (compile-time only). |
| TS — consumer | `web/components/MapView.tsx` | `fetch('/run.json')` → cast to `TrajectoryArtifact`. NOTE: no runtime JSON-Schema validation on the TS side yet — if added, validate against the SAME `contract/trajectory_schema.json` (e.g. ajv). |

Artifacts are emitted to `contract/runs/<run_id>.json` (see the `run-sim` skill). `contract/runs/` is gitignored.

## To extend the contract (the only correct procedure)
1. Bump `schema_version` (e.g. `0.1.0` → `0.2.0`) in `contract/trajectory_schema.json`.
2. Mirror the change in `python/src/contract_models.py` AND `web/lib/types.ts` (and any consumer).
3. Update `python/src/trajectory_io.py` only if validation logic changes (it reads the schema file, so
   field changes are picked up automatically).
4. Re-emit a run (`run-sim` skill) and confirm `load_artifact()` still validates.

## v0 schema reference (schema_version 0.1.0) — keep both worlds consistent with THIS
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://nadi.local/contract/trajectory_schema.json",
  "title": "Trajectory Artifact",
  "type": "object",
  "additionalProperties": false,
  "required": ["schema_version", "meta", "vehicles"],
  "properties": {
    "schema_version": { "const": "0.1.0" },
    "meta": {
      "type": "object",
      "additionalProperties": false,
      "required": ["run_id", "network", "bbox", "sim_start", "sim_end", "step_length", "created_at"],
      "properties": {
        "run_id": {"type": "string", "minLength": 1},
        "network": {"type": "string", "minLength": 1},
        "bbox": {"type": "array", "items": {"type": "number"}, "minItems": 4, "maxItems": 4},
        "sim_start": {"type": "number"},
        "sim_end": {"type": "number"},
        "step_length": {"type": "number", "exclusiveMinimum": 0},
        "created_at": {"type": "string", "format": "date-time"}
      }
    },
    "vehicles": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["id", "type", "path", "timestamps", "speeds"],
        "properties": {
          "id": {"type": "string", "minLength": 1},
          "type": {"type": "string", "minLength": 1},
          "path": {"type": "array", "items": {"type": "array", "items": {"type": "number"}, "minItems": 2, "maxItems": 2}},
          "timestamps": {"type": "array", "items": {"type": "number"}},
          "speeds": {"type": "array", "items": {"type": "number"}}
        }
      }
    }
  }
}
```
`bbox` = `[minLon, minLat, maxLon, maxLat]`; `path` = ordered `[lon, lat]` points. The committed
`contract/trajectory_schema.json` is the authority — this block is a quick reference; if they ever
differ, the file wins.
