# GTA Infrastructure Impact Simulator

A tool for city planners to PREVIEW the impact of a proposed infrastructure change
(new road, bike lane, signal, lane/limit change) on a Toronto corridor, before public
consultation. It couples a SUMO traffic microsimulation with an LLM-driven
stakeholder-reaction layer, shown as moving dots on a map with a per-stakeholder
scorecard and a queryable report. Study area: Scarborough / Pickering / Ajax.

## Locked decisions — HARD CONSTRAINTS. Do not violate, do not "improve" past them.
- NO LLM per simulated vehicle. SUMO simulates ALL traffic as cheap physics. Only a few
  hundred sampled "persona" agents reason, each pinned to a specific simulated traveler.
- Safety = SURROGATE measures (time-to-collision, hard braking, gridlock, blocked
  junctions) computed from trajectories. NEVER claim crash prediction.
- Output is a per-STAKEHOLDER scorecard (travel time / safety surrogate / access, per
  group), NOT a single ROI number.
- The agent layer is a stakeholder-reaction PREVIEW (who wins, who loses, the texture of
  each objection), NOT a referendum or oracle. All user-facing copy frames outputs as
  anticipation, never verdict.
- TWO graphs, two jobs: the social graph (OASIS, opinion propagation) is NOT GraphRAG.
  LightRAG/GraphRAG is the report agent's memory over the run corpus. Never conflate them.
- The SIMULATION is bounded to one corridor/neighborhood, even though the framing is "the GTA."
- Playback, not stream-live: run the physics, run the agent pass batched, then replay with
  comments keyed to sim-time.
- Reuse libraries; the custom work is the GLUE (SUMO<->web, edit<->network-regen). Don't
  rebuild what SUMO / deck.gl / OASIS already do.

## Architecture (two worlds, one contract)
- `python/` — simulation + (later) agents. SUMO via libsumo, FastAPI, the sampler, OASIS/CAMEL, LightRAG.
- `web/`    — Next.js + React + TS frontend. deck.gl + MapLibre.
- The boundary is the FROZEN TRAJECTORY CONTRACT in `contract/`. Do NOT change the contract
  schema without bumping its version and updating BOTH sides. A hook blocks edits to it.

## Conventions
- Python: conda env `gta-sim`, ruff (format + lint), pyright (types), pytest. Windows-native dev.
- TS: prettier + eslint, tsc (types), vitest.
- Before writing code against any external/fast-moving library (libsumo, deck.gl, MapLibre,
  OASIS, LightRAG, FastAPI features), use the docs-researcher subagent / Context7 FIRST to
  confirm the CURRENT API. Do not write integration code from memory.
- Use Plan Mode for any non-trivial change: present the plan + files to touch, wait for approval.
- Small commits.

## Current phase
Phase 0 — spine spike. Real Toronto corridor → SUMO run → frozen trajectory artifact →
moving dots on a MapLibre map with a timeline scrubber. No edits, no agents. Single session,
serialized — do NOT parallelize Phase 0.

## Run commands
(filled in as they're created)