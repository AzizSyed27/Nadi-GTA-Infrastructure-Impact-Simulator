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
- Agent LLM layer is PROVIDER-AGNOSTIC behind a thin adapter (`python/src/llm_provider.py`):
  an `LLMClient` Protocol + two adapters — `GeminiAdapter` (google-genai) and `OpenAICompatAdapter`
  (the `openai` SDK pointed at any OpenAI-compatible `base_url`). One `PROVIDER_PRESETS` table
  (base_url, default_model, key_env) covers Groq / DeepSeek / OpenAI / Cerebras / Mistral / Kimi.
  **Recommended default: Groq** (`openai/gpt-oss-20b`) — free tier + strict structured JSON. Select
  via env `PROVIDER` / `MODEL`; key from `.env` (e.g. `GROQ_API_KEY`, `GEMINI_API_KEY`). Gemini's
  free tier is tiny (flash = 20 req/day) and flash-lite is often 503. No model id hardcoded from
  memory — confirm via docs-researcher.
- Use Plan Mode for any non-trivial change: present the plan + files to touch, wait for approval.
- Small commits.

## Current phase
**Phase 1 — COMPLETE.** On top of the Phase-0 spine: a two-run baseline-vs-scenario harness (apply a
parameterized change, e.g. a speed limit, to one corridor edge), a per-vehicle outcome join, a sampler
that pins ~12 persona agents to winner/loser travelers, an LLM reaction layer (provider-agnostic,
Groq default) that voices each as an INDIVIDUAL anticipated reaction, all assembled into a v0.2.0
artifact and played back on the map with sentiment-colored instrumented dots, a click-through panel,
and a live comment feed keyed to each traveler's worst moment.
Next: Phase 2 — social-graph opinion propagation (OASIS) + the report agent's GraphRAG memory (two
distinct graphs; see the locked decisions). Agents still preview, never a verdict.

## Run commands
SUMO: `export SUMO_HOME="/c/Program Files (x86)/Eclipse/Sumo"` (not on PATH). Python = base miniconda.
- **Baseline run + artifact:** `python python/src/run_sim.py`  (see the `run-sim` skill)
- **Full scenario pipeline** (see the `run-scenario` skill):
  ```bash
  python python/src/scenario_harness.py            # baseline + scenario runs + outcome join
  python python/src/sampler.py                     # sample instrumented travelers
  PROVIDER=groq python python/src/reactions.py     # LLM reactions -> v0.2.0 artifact (GROQ_API_KEY in .env)
  ```
  Then point `web/components/MapView.tsx` `ARTIFACT_URL` at the new `/scenario-<ts>.json`.
- **Frontend:** `cd web && npm run dev`  → http://localhost:3000
- **Tests:** `python -m pytest python/tests` (golden spine + v0.2.0 agent invariants)