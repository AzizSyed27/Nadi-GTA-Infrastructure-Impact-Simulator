# Nadi — GTA Infrastructure Impact Simulator

> Preview the impact of a proposed infrastructure change — a new road, bike lane, speed limit,
> lane/road closure, incident, or school zone — on a Toronto corridor **before** public consultation.
> Nadi couples a SUMO traffic microsimulation with an LLM-driven stakeholder-reaction layer, shown as
> moving dots on a map with a per-stakeholder scorecard, a credibility-first report you can query, and
> a simulated public-discourse view.

**Status:** Phases 0–5 and V2.0–V2.2 complete · Trajectory contract **v0.8.0** · Study corridor:
**Scarborough / Pickering / Ajax** · The *simulation* is bounded to one corridor/neighborhood, even
though the framing is "the GTA."

It answers a planner's real question — *who wins, who loses, and what does each objection sound like?* —
as an **anticipation**, never a verdict.

---

## What it does

Open the map, hit **✏️ Edit**, and draw the change: a new road between two junctions, a speed limit or
bike lane on an existing street, a lane or road closure, a timed incident, or a **🏫 school zone** —
several streets dropped to 30 km/h during school hours as one composite scenario. The server runs the
whole pipeline as a staged job and the map fills in as results land.

The pipeline, end to end:

1. **Simulate** — SUMO runs **all** traffic (cars, bikes, pedestrians) as cheap physics — no LLM per
   vehicle. Demand is either the synthetic demo set or a **count-calibrated AM peak** (~67k travelers
   anchored to Toronto's traffic-count open data, t=0 == 07:00). Windowed changes apply at their start
   time and revert at their end *inside* the run, with a capture/restore proof log.
2. **Compare** — a baseline-vs-scenario pair with identical demand and seeds; outcomes joined
   per traveler (Δ travel time, Δ delay, non-completions with causally-neutral accounting). Optional:
   **settled assignment** (iterated routes — "after drivers adapt") and **1–3 seeds**, with per-cell
   ranges so a sign that flips across seeds is never rendered as a direction.
3. **Score** — a per-stakeholder **scorecard** (7 groups × travel time / safety / access) with honesty
   metadata on every cell: measured vs low-confidence, safety as ±magnitude only (direction never
   claimed), notes that ride the artifact. Safety comes from **surrogate near-miss measures**
   (TTC/PET/hard-braking + a pedestrian-crossing pass) — never crash prediction. Capacity changes add
   first-class facts: diverted counts, non-completions, and a free-flow **emergency-response detour**
   estimate from four real Toronto Fire Services stations (labeled as routing, never dispatch).
4. **React** — ~212 persona **voices**: vehicle- and pedestrian-pinned agents react to *their own
   measured trip*, plus inferred community voices (business owners, residents) with no trajectory —
   each an individual anticipated reaction, never a poll. A tagged school zone gets one mechanical
   preface; parents advocate from their own outcomes — children are never ventriloquized.
5. **Report & explore** — everything assembles into a versioned artifact and plays back in the
   browser: sentiment-colored dots, a live comment feed keyed to each traveler's worst moment,
   time-true overlays (a windowed closure disappears from the map when it reverts). On top of that:
   a **5-section report** where the LLM fills only narrative slots (all numbers code-rendered, then
   audited: no digits, no safety direction, no vote tallies, no crash words), an **"ask the report"
   chat** over a per-run LightRAG index that cites its sources and refuses honestly, an **OASIS
   discourse view** (opinion cascades over a social graph — illustrative texture, never a forecast),
   and a **⇄ Compare** mode for two runs with a provenance-mismatch guard and delta cells that refuse
   arithmetic wherever a direction isn't claimable.

## Design principles (the guardrails)

These are locked decisions — they're what keep the tool honest:

- **Preview, not verdict.** The agent layer previews *who wins, who loses, and the texture of each
  objection*. It is not a referendum, an oracle, or a recommendation. No stance tallies, no sentiment
  averages, no winner — anywhere.
- **No LLM per simulated vehicle.** SUMO simulates all traffic as physics; only a few hundred sampled
  persona agents reason, each pinned to a specific simulated traveler.
- **Safety = surrogate measures.** Time-to-collision, hard braking, blocked junctions — computed from
  trajectories, rendered as ±magnitude with the direction explicitly not claimed (it flips across
  seeds). Nadi **never** claims crash prediction.
- **Per-stakeholder scorecard, not a single ROI.** Travel time / safety surrogate / access, *per
  group* — not one number.
- **Numbers carry their own caveats.** What a number means rides the artifact (confidence, notes,
  seed ranges, population disclosures like "pedestrian entities from the calibrated demand — not
  modeled schoolchildren"), never just a docstring. Refusals to compute look different from absence.
- **Two graphs, two jobs.** The OASIS social graph (opinion propagation) and the report agent's
  GraphRAG memory are distinct and never conflated.
- **Playback, not stream-live.** Run the physics, run the agent pass batched, then replay.
- **Reuse libraries.** The custom work is the *glue* (SUMO↔web, edit↔network-regen) — not rebuilding
  what SUMO / deck.gl / OASIS / LightRAG already do.

## Architecture — two worlds, one contract

```
┌──────────────────────────────┐      frozen trajectory contract      ┌──────────────────────────┐
│ python/  (simulation+agents) │  ──►  contract/trajectory_schema.json ──►  web/  (frontend)      │
│ SUMO · scorecard · voices ·  │       (JSON Schema + pydantic + TS)   │  Next.js · deck.gl ·     │
│ report+chat · OASIS          │              v0.8.0, versioned        │  MapLibre                │
└──────────────┬───────────────┘                                      └────────────┬─────────────┘
               │            FastAPI job-runner (server.py, :8000)                  │
               └───────  /api/simulate · /api/runs · /api/report · /api/chat ──────┘
```

- **`python/`** — simulation + agents: SUMO via TraCI, the staged harness, scorecard, the
  provider-agnostic LLM layer, the report + LightRAG chat, OASIS propagation (own conda env).
- **`web/`** — Next.js + React + TypeScript; deck.gl over MapLibre renders the exported network
  itself as the base layer (4,570 edges — the drawn roads ARE the simulation's roads).
- **`contract/`** — the boundary is a **frozen trajectory contract**. Changing its schema means
  bumping the version and updating *both* sides; a hook guards it. Since v0.5.0 a scenario is a
  **list of changes** (+ optional tags) — the school zone is the first real composite.

## Repo layout

```
python/src/
  run_sim.py              # Phase-0 spine: SUMO run → trajectory artifact
  scenario_harness.py     # staged baseline+scenario pairs, outcome join, seed probes, CLI
  server.py               # FastAPI job-runner: /api/simulate /runs /edges /report /chat
  change_scheduler.py     # windowed changes: apply/revert in-sim + proof log; closures; incidents
  scorecard.py            # 7-group scorecard + honesty metadata + cross-seed ranges
  sampler.py / personas.py / reactions.py   # pin travelers → voice them (provider-agnostic LLM)
  report.py / report_agent.py               # audited 5-section report + per-run LightRAG chat
  propagation.py          # OASIS discourse cascades (separate `oasis` conda env)
  response_probe.py       # emergency-response detour fact (4 real TFS stations, free-flow routing)
  zone_lens.py            # school-zone ped-vehicle conflict pair (tag-gated, caveats built in)
  network_edit.py / network_export.py       # netconvert patches + the web base-layer export
  demand_profiles.py / demand_calibration.py / settle.py   # demand registry · calibration · settled
  school_zone_select.py   # school→street binding for the zone exemplar (open-data provenance)
contract/                 # trajectory_schema.json (v0.8.0) + gitignored runs/
data/                     # counts / demand / schools — open-data provenance + calibration records
web/
  components/             # MapView, EditPanel+palettes, ScorecardPanel, RunCard, CompareView, …
  lib/                    # types, loaders, compare logic, sim-time formatting
  tests/                  # 32 Playwright tests across 8 specs
python/tests/             # 300 pytest tests (golden spine, contract gates, honesty invariants)
```

## Quickstart

**Prerequisites**
- [SUMO](https://eclipse.dev/sumo/) 1.27 (set `SUMO_HOME`; not on PATH on Windows)
- Python (miniconda): `pydantic`, `jsonschema`, `fastapi`, `uvicorn`, plus `python/requirements-agent.txt`
  for the report/chat spine
- Node.js for `web/`
- Keys in `python/.env` (gitignored): `DEEPSEEK_API_KEY` (report + agent pipeline pins DeepSeek),
  `GROQ_API_KEY` (reaction layer default)

**The primary flow — the editor:**

```bash
export SUMO_HOME="/c/Program Files (x86)/Eclipse/Sumo"   # per session
cd python/src && uvicorn server:app --port 8000           # the job-runner API
cd web && npm run dev                                     # → http://localhost:3000 → ✏️ Edit
```

Draw a change, pick run options (demand profile, day-one vs settled, seeds), Simulate — the RunCard
tracks the staged run; then enrich with voices / report / discourse from the same card. Compare two
finished runs via ⇄ Compare or `/?run=<A>&compare=<B>`.

**Tests**

```bash
python -m pytest python/tests        # 300 tests
cd web && npx playwright test        # 32 tests, 8 specs
```

## Roadmap

- **Phase 0 — ✅ Spine.** Corridor → SUMO → frozen artifact → moving dots + timeline.
- **Phase 1 — ✅ Scenario + agents.** Baseline-vs-scenario, outcome join, ~12 voices, reactive map.
- **Phase 2 — ✅ Scorecard + multimodal.** Bikes/peds, conflicts, the 7-group scorecard, 212 voices.
- **Phase 3 — ✅ Report + chat.** Audited report; per-run LightRAG "ask the report".
- **Phase 4 — ✅ Discourse.** OASIS opinion cascades over the voices (the second graph).
- **Phase 5 — ✅ The editor.** The server fronts the pipeline; draw-a-road + edit-an-edge.
- **V2.0 — ✅** Contract v0.5.0 (multi-change scenarios) + the network itself as the base map layer.
- **V2.1 — ✅** Count-calibrated AM-peak demand, settled assignment, seed ranges, ⇄ Compare.
- **V2.2 — ✅** Windowed changes with in-sim revert proofs, lane/road closures, incidents, the
  response-detour fact, the full editor palette, and the **school zone** — the first real composite,
  accepted synthetically and landed on a calibrated run (zone conflict pair 30-vs-28, direction
  deliberately not claimed at that n).
- **Next** — V2.5 network styling; the bbox-expansion + signal-plan rebuild (`BACKLOG.md`): the pace
  probe measured the boundary-clipped corridor **saturating** under calibrated AM peak (inflow >
  outflow all window; 72% of demand delivered by 09:00) — a larger net is what changes that.

## Tech stack

SUMO 1.27 (TraCI) · FastAPI · provider-agnostic LLM layer (DeepSeek for report/agents, Groq default
for reactions; Gemini/OpenAI-compatible adapters) · LightRAG + local MiniLM embeddings · OASIS/CAMEL
(separate conda env) · Next.js · React · TypeScript · deck.gl · MapLibre. Two graphs, kept distinct:
the OASIS social graph (opinion propagation) and GraphRAG (the report agent's memory).

---

*Nadi is a stakeholder-reaction **preview**: it anticipates who wins, who loses, and the texture of
each objection. It is not a referendum, a recommendation, or a crash predictor, and its simulation is
bounded to a single corridor.*
