# Nadi — GTA Infrastructure Impact Simulator

> Preview the impact of a proposed infrastructure change — a new road, bike lane, signal, or
> lane/speed-limit change — on a Toronto corridor **before** public consultation. Nadi couples a SUMO
> traffic microsimulation with an LLM-driven stakeholder-reaction layer, shown as moving dots on a map
> with a per-stakeholder scorecard and a queryable report.

**Status:** Phase 1 complete · Study corridor: **Scarborough / Pickering / Ajax** · The *simulation* is
bounded to one corridor/neighborhood, even though the framing is "the GTA."

It answers a planner's real question — *who wins, who loses, and what does each objection sound like?* —
as an **anticipation**, never a verdict.

---

## What it does

Give Nadi a corridor and a proposed change (e.g. "drop this segment from 60 to 30 km/h"). It runs the
change through a real traffic simulation, finds who is affected, and lets a handful of representative
travelers *react in character* — then plays the whole thing back on a map.

The pipeline, end to end:

1. **Simulate** — SUMO runs **all** traffic on the corridor as cheap physics (no LLM per vehicle).
2. **Compare** — a two-run baseline-vs-scenario harness applies the parameterized change to one edge
   with identical demand, then **joins outcomes per vehicle** to find winners and losers
   (Δ travel time, Δ delay).
3. **Sample** — a sampler bins travelers (worse / unchanged / better) and pins ~12 **persona agents** to
   a spread of winners and losers, each with a `trigger_t` = the sim-time of their worst moment.
4. **React** — a provider-agnostic LLM layer (Groq by default) voices each sampled traveler as an
   **individual anticipated reaction** grounded strictly in their own numbers — a short first-person
   comment, a sentiment, and a stance.
5. **Replay** — everything is assembled into a versioned trajectory artifact and played back in the
   browser: small grey background dots for ordinary traffic, larger **sentiment-colored** dots for the
   instrumented travelers, a click-through panel with their before/after numbers and comment, and a
   **live comment feed** that pops each reaction as playback crosses that traveler's worst moment.

## Design principles (the guardrails)

These are locked decisions — they're what keep the tool honest:

- **Preview, not verdict.** The agent layer previews *who wins, who loses, and the texture of each
  objection*. It is not a referendum, an oracle, or a recommendation. All user-facing copy frames
  outputs as anticipation.
- **No LLM per simulated vehicle.** SUMO simulates all traffic as physics; only a few sampled persona
  agents reason, each pinned to a specific simulated traveler.
- **Safety = surrogate measures.** Time-to-collision, hard braking, gridlock, blocked junctions —
  computed from trajectories. Nadi **never** claims crash prediction.
- **Per-stakeholder scorecard, not a single ROI.** Outputs are travel time / safety surrogate / access,
  *per group* — not one number.
- **Playback, not stream-live.** Run the physics, run the agent pass batched, then replay with comments
  keyed to sim-time.
- **Reuse libraries.** The custom work is the *glue* (SUMO↔web, edit↔network-regen) — not rebuilding
  what SUMO / deck.gl / OASIS already do.

## Architecture — two worlds, one contract

```
┌─────────────────────────┐        frozen trajectory contract        ┌──────────────────────────┐
│  python/  (simulation)  │  ───►   contract/trajectory_schema.json   ───►   web/  (frontend)     │
│  SUMO · sampler · LLM   │         (JSON Schema + pydantic + TS)      │  Next.js · deck.gl       │
└─────────────────────────┘              v0.2.0, versioned             └──────────────────────────┘
```

- **`python/`** — the simulation + agent layer: SUMO via libsumo/TraCI, the baseline-vs-scenario
  harness, the sampler, and the provider-agnostic LLM reaction layer.
- **`web/`** — a Next.js + React + TypeScript frontend rendering the playback with deck.gl over MapLibre.
- **`contract/`** — the boundary is a **frozen trajectory contract**. Changing its schema means bumping
  the version and updating *both* sides; a hook guards it.

## Repo layout

```
python/
  src/
    run_sim.py            # Phase-0 spine: SUMO run → trajectory artifact
    scenario_harness.py   # baseline + scenario runs + per-vehicle outcome join
    sampler.py            # bin outcomes, pin ~12 persona travelers, find each worst moment
    personas.py / .json   # car-commuter persona archetypes (data + loader)
    reactions.py          # LLM reactions → assembled v0.2.0 artifact
    llm_provider.py       # provider-agnostic adapters (Groq default; Gemini; OpenAI-compatible)
    contract_models.py    # pydantic models for the trajectory contract
    trajectory_io.py      # load / validate / dump artifacts against the schema
  tests/                  # golden-spine + v0.2.0 agent-invariant tests
contract/
  trajectory_schema.json  # the frozen contract (v0.2.0)
  runs/                   # generated artifacts (gitignored)
web/
  components/             # MapView, Timeline, ScenarioHeader, AgentPanel, CommentFeed
  lib/                    # types, artifact loader, viz helpers
.claude/skills/           # run-sim · run-scenario · add-persona · trajectory-contract
docs/                     # phase plans
```

## Quickstart

**Prerequisites**
- [SUMO](https://eclipse.dev/sumo/) 1.27 (set `SUMO_HOME`; it is not added to PATH on Windows)
- Python (miniconda) with `pydantic`, `jsonschema`, `openai` / `google-genai`, `python-dotenv`
- Node.js (for the `web/` frontend)
- An LLM key in `.env` (default `GROQ_API_KEY` — Groq's free tier; `.env` is gitignored)

```bash
# SUMO isn't on PATH — point at it per session
export SUMO_HOME="/c/Program Files (x86)/Eclipse/Sumo"
```

**Run the full scenario pipeline** (see the `run-scenario` skill for details):

```bash
python python/src/scenario_harness.py            # baseline + scenario runs + outcome join
python python/src/sampler.py                     # sample instrumented travelers
PROVIDER=groq python python/src/reactions.py     # LLM reactions → v0.2.0 artifact (GROQ_API_KEY in .env)
```

Point `web/components/MapView.tsx`'s `ARTIFACT_URL` at the new `/scenario-<ts>.json`, then:

```bash
cd web && npm run dev                            # → http://localhost:3000
```

A plain no-change baseline run is `python python/src/run_sim.py` (see the `run-sim` skill).

**Tests**

```bash
python -m pytest python/tests                    # golden spine + v0.2.0 agent invariants
```

## Roadmap

- **Phase 0 — ✅ Spine.** Real Toronto corridor → SUMO run → frozen trajectory artifact → moving dots on
  a MapLibre map with a timeline scrubber.
- **Phase 1 — ✅ Scenario + agents + reactive map.** Baseline-vs-scenario harness, per-vehicle outcome
  join, ~12 persona agents voiced as individual anticipated reactions, played back with
  sentiment-colored dots, a click-through panel, and a live comment feed.
- **Phase 2 — ◻️ Scorecard + social layer** *(planning — see `docs/phase-2-plan.md`)*: multi-modal
  travelers (cyclists, pedestrians), a safety-surrogate conflict-point layer, a per-stakeholder
  scorecard, hundreds of agents, and finally OASIS opinion propagation (agents influencing each other).
- **Later** — a GraphRAG report agent (queryable memory over a run), and a structural network editor
  (draw a change, regenerate the network).

## Tech stack

SUMO (libsumo/TraCI) · FastAPI *(planned)* · provider-agnostic LLM layer (Groq / Gemini /
OpenAI-compatible) · Next.js · React · TypeScript · deck.gl · MapLibre. Two graphs are planned and kept
distinct: a social graph (OASIS, opinion propagation) and GraphRAG (the report agent's memory) — never
conflated.

---

*Nadi is a stakeholder-reaction **preview**: it anticipates who wins, who loses, and the texture of each
objection. It is not a referendum, a recommendation, or a crash predictor, and its simulation is bounded
to a single corridor.*
