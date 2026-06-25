---
name: add-persona
description: Use whenever adding or editing a stakeholder PERSONA archetype, touching python/src/personas.json or the persona set, or sampling/instrumenting travelers for the reaction layer (python/src/sampler.py — the "instrumented set", "trigger_t", winners/losers "persona mix"). Trigger on "add a persona", "new commuter type", "change delay_sensitivity", "sample travelers", "pick instrumented agents", "who reacts". Follow this recipe instead of hand-rolling personas or sampling logic.
---

# add-persona — persona archetypes + instrumented-traveler sampling

The stakeholder-reaction layer is **data-driven personas** plus a **sampler** that pins a few of them
to specific simulated travelers. This skill covers adding personas and running the sampler.

## Hard constraints (from CLAUDE.md — do not violate)
- **NO LLM per vehicle.** SUMO simulates all traffic as cheap physics; only a few hundred SAMPLED
  persona agents reason. This skill is the **SAMPLING** step — it selects who reasons. It does NOT
  call an LLM (reaction text is Step 1.4).
- The agent layer is a stakeholder **PREVIEW** (who wins, who loses, the texture of an objection),
  **not a referendum or oracle**. Keep persona descriptions as anticipation, never verdict.

## Where things live
| File | What it is |
|---|---|
| `python/src/personas.json` | The persona SET as **data** (so Phase 2 can expand/replace without code). |
| `python/src/personas.py` | `PersonaSpec` (pydantic, `extra="forbid"`) + cached `load_personas()`. |
| `python/src/sampler.py` | Binning, selection, `trigger_t`, CLI. Reuses `trajectory_io` + `contract_models.Outcome`. |

**Key distinction — two persona shapes, don't conflate them:**
- `PersonaSpec` (this layer, internal): **rich** — carries `description` (fed to the 1.4 LLM prompt)
  and `delay_sensitivity`.
- `contract_models.Persona` (the frozen contract): **trimmed** `{id, label}` — what actually gets
  written into the artifact's `agents[]` in Step 1.4. See the `trajectory-contract` skill.

## To ADD or edit a persona (the core recipe)
Append an object to the `personas` array in `python/src/personas.json` — **no code change needed**;
`load_personas()` picks it up (file order preserved):
```json
{
  "id": "night_shift",                       // unique, kebab-case
  "label": "Night-shift worker",             // short human label
  "description": "Drives the corridor at odd hours; values predictability over raw speed ...",
  "delay_sensitivity": 0.6                    // float in [0,1]; 1 = a minute lost hurts most
}
```
- All four fields are required and `PersonaSpec` is `extra="forbid"` — a typo'd/extra/missing field
  fails loudly at load. `description` is the temperament/priorities text the LLM prompt will use, so
  write it in that voice. `delay_sensitivity` is the weight Phase 2 will use for attribute-based
  assignment (today's sampler assigns round-robin).

## To SAMPLE instrumented travelers
```bash
python python/src/sampler.py                          # newest outcomes-*.json, N=12, band 5s
python python/src/sampler.py --n 20 --unchanged-band 10
python python/src/sampler.py --outcomes contract/runs/outcomes-<ts>.json
```
What it does:
1. **Inputs** — the newest `contract/runs/outcomes-<ts>.json` (produced by Step 1.2's
   `scenario_harness.py`) and the scenario artifact it names (`scenario-<ts>.json`, loaded +
   validated via `trajectory_io.load_artifact`). Only travelers present in the scenario artifact are
   eligible (they completed the scenario run and have a full trajectory).
2. **Bin** (`bin_outcomes`) by `delta_seconds` vs `±unchanged_band` (default 5 s):
   `> +band` worse, `< −band` better, else roughly unchanged. (Fixed band, not quantiles — a
   near-zero delta is honestly "unchanged".)
3. **Select** N (`select_counts` + `evenly_spaced`): guarantees a winners-AND-losers mix — ≥1 from
   `worse` and ≥1 from `better` when available — then balances toward equal thirds, capped at
   availability. Deterministic (stable sort by `(delta_seconds, vehicle_id)`, evenly-spaced indices).
4. **Assign personas** round-robin over the selection. `# Phase 2: assign from real mode/attributes`.
5. **`trigger_t`** (`worst_moment`) = the START of the traveler's longest contiguous stop
   (`speed ≤ 0.1 m/s`), else the lowest-speed instant. It **skips the standing-start**, so it never
   degenerates to `t=depart` — it marks a real congestion moment, when the comment pops in playback.

## Output
`contract/runs/instrumented-<ts>.json` (idempotently paired to its scenario run), shape:
```json
{ "scenario_run_id": "...", "baseline_run_id": "...", "n_requested": 12, "n_selected": 12,
  "unchanged_band": 5.0, "selected_bin_counts": {"worse":4,"unchanged":4,"better":4},
  "instrumented": [ { "vehicle_id": "...", "persona": { ...PersonaSpec... },
                      "outcome": { ...5 fields... }, "trigger_t": 490.0 } ] }
```
This is an **INTERMEDIATE sidecar, NOT the frozen artifact.** You cannot write `agents[]` yet —
`Agent.reaction` is a required contract field, and reactions don't exist until Step 1.4. The `outcome`
is carried verbatim (shape-guarded against `contract_models.Outcome`) so it drops straight into
`Agent.outcome` later.

## Gotchas
- **Deterministic**: same inputs → byte-identical `instrumented` set. Don't add randomness without a seed.
- **`trigger_t` is the worst moment in the SCENARIO run** — that low-speed instant may be a routine red
  light present in the baseline too, so it is **not necessarily change-attributable**. (Change
  attribution would need a baseline-trajectory diff — not part of this step.)
- The `instrumented-` prefix is deliberate: it must not collide with the `scenario-*.json` /
  `outcomes-*.json` globs consumers use to find run artifacts.

## Related
- `run-sim` — upstream pipeline that produces the runs (and `scenario_harness.py` the outcomes).
- `trajectory-contract` — the frozen `agents[]` / `Agent.persona` shape these personas eventually fill.
