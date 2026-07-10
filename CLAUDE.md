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
  schema without bumping its version and updating BOTH sides.
  - **Guard mode = ask:** a PreToolUse hook (`.claude/hooks/guard.py`) raises an approval prompt on
    Write/Edit/MultiEdit to `contract/` (and `.env`) — make deliberate contract changes through the Write/Edit
    tool and approve in the moment (schema verified against the Claude Code hooks docs). **Verified live
    (2026-07-10 probe):** a Write to `contract/__guard_probe__.txt` is NOT hard-blocked (the old exit-2 path is
    retired) — it routes through the `ask` decision, whose prompt reads *"<name> is under contract/ — the FROZEN
    Python<->TS trajectory contract. Approve ONLY for a deliberate contract change: bump schema_version and mirror
    BOTH python/ and web/. Editing via Write/Edit is the correct path now — do NOT route contract writes through
    Bash/Python (that bypasses this guard)."*
  - **Known limitation:** Bash/runtime writes to `contract/` bypass the hook (its matcher only covers
    Write/Edit/MultiEdit) — conventionally BANNED, policed by plan review.

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
  **Layer default: Groq** (`openai/gpt-oss-20b`) — free tier + strict structured JSON. Select via env
  `PROVIDER` / `MODEL`; key from `.env` (e.g. `GROQ_API_KEY`, `GEMINI_API_KEY`). **The report + agent pipeline
  (`report.py`, `server.py`) PINS DeepSeek** (longer prompts, ~13 slot calls, prefix caching) — it defaults to
  `deepseek` when `PROVIDER` is unset, so `DEEPSEEK_API_KEY` must be in `python/.env`. Generation temperature is
  per-call: `report._call` uses 0.3 (deterministic facts); `reactions.py` keeps 0.8 (persona variety). Gemini's
  free tier is tiny (flash = 20 req/day) and flash-lite is often 503. No model id hardcoded from memory —
  confirm via docs-researcher.
- **Windows-native gotchas (LightRAG):** the per-run RAG index lives under `%LOCALAPPDATA%\nadi-report-agent\`,
  NOT the repo — OneDrive sync grabs a handle on fresh `.tmp` files and breaks LightRAG's atomic writes
  (`os.replace` → WinError 5). And LightRAG canonicalizes a doc's `file_path` to its BASENAME, so citation
  handles must be slash-free — we use `__` separators (e.g. `voice__shop_owner__v9`).
- **Windows-native gotchas (OASIS/CAMEL):** OASIS runs in a **separate `oasis` conda env (python 3.11)** —
  camel-oasis 0.2.5 pins `<3.12`, so it CANNOT run in base miniconda 3.13. That is a real **two-env boundary**:
  the 4.2 producer must call it as a subprocess / second service, not an in-process import. `import oasis` from
  base fails. Four traps that cost time in 4.0: (1) `generate_twitter_agent_graph` builds NODES but does NOT wire
  the CSV `following_agentid_list` edges — wire them with `AgentGraph.add_edge` or exposure is recsys-only, not
  graph-driven; (2) run via **`conda run --no-capture-output -n oasis …`** (plain `conda run` buffers stdout and
  re-encodes through cp1252, crashing on agents' non-ASCII text — the run still completes + writes its JSON); (3)
  OASIS scratch (profile CSV + sqlite DB) lives under `%LOCALAPPDATA%\nadi-oasis-spike\`, NOT the OneDrive tree
  (same atomic-write hazard); (4) `cairocffi`'s native libcairo is absent on this box but is viz-only — `import
  oasis` and a full run work without it.
- Use Plan Mode for any non-trivial change: present the plan + files to touch, wait for approval.
- Small commits.

## Current phase
**Phase 1 — COMPLETE.** On top of the Phase-0 spine: a two-run baseline-vs-scenario harness (apply a
parameterized change, e.g. a speed limit, to one corridor edge), a per-vehicle outcome join, a sampler
that pins ~12 persona agents to winner/loser travelers, an LLM reaction layer (provider-agnostic,
Groq default) that voices each as an INDIVIDUAL anticipated reaction, all assembled into a v0.2.0
artifact and played back on the map with sentiment-colored instrumented dots, a click-through panel,
and a live comment feed keyed to each traveler's worst moment.

**Phase 2 — COMPLETE.** The artifact is **v0.3.0** (contract bumped, both sides): a per-STAKEHOLDER **scorecard**
(7 groups × travel_time / safety / access) with per-cell honesty metadata — `confidence` (`measured`/`low`) + a
`note` — plus safety surrogates and conflict events; the agent pass scaled to ~212 voices across three grounding
kinds (vehicle-pinned, person-pinned, INFERRED community voices with no trajectory). Frontend renders it end to
end: the discriminated agent union + background peds + time-synced conflict pulses ("near-miss events observed in
this run", never "danger added"); a collapsible **ScorecardPanel** (load-bearing confidence badges, **safety as
`±magnitude` with NO direction**, notes/seed-caveat); a **CommentFeed at 212** (sim voices at `trigger_t` +
inferred community voices on a render-time synthetic clock); the **scorecard→feed join** + reverse `flyTo`; and a
hard **REFERENDUM GUARD** (no stance tallies / sentiment averages / vote counters). `web/lib/personaGroups.ts`
maps persona id → group/mode/label client-side (runtime `agent.persona` is `{id,label}` only).

**Phase 3 — COMPLETE.** A credibility-first report + an interactive agent over it.
- **3.1 report (`report.py`):** a deterministic 5-section skeleton where the LLM fills ONLY marked narrative
  slots; ALL numbers are code-rendered. A post-generation **honesty audit** (`audit_prose`: no digits / no safety
  direction / no vote-tally / no crash words — retry once, else fail loudly) + a **code-rendered fact check**
  (guards our own numbers) + safety as `±magnitude`. Writes `contract/runs/report-<ts>.{md,json}` +
  `web/public/latest-report.*`. Sparse inferred rows get a deterministic gloss (the LLM can't deny a magnitude the
  table shows). DeepSeek-default, temp 0.3.
- **3.2 interactive agent (`report_agent.py` + `server.py`):** a per-run **LightRAG** index over ~230 corpus docs
  (one per voice + scorecard rows + change + robustness + caveats + conflict summary) at `%LOCALAPPDATA%`, LLM
  bound to DeepSeek + **local MiniLM embeddings** (dim 384, pinned in `embedding_meta.json`). A minimal FastAPI
  backend — `GET /api/report`, `POST /api/chat` — retrieves via `aquery_data` (native `file_path` citations) then
  runs a **guarded generation reusing the SAME `report.audit_prose`** (retry → caveat-only fallback). Answers are
  digit-free, cite sources, and refuse honestly ("did it get safer?" → the caveat). A chat panel lives in the
  Report view. The two graphs stay distinct: this is GraphRAG memory, NOT the OASIS social graph.

**v0.4.0 riders (LANDED in the contract at Step 4.1 — additive over v0.3.0):**
- Persona gained optional `mode` / `stakeholder` on the wire, so `web/lib/personaGroups.ts` can become
  *derivation* from the artifact (the frontend swap lands in 4.3) instead of a hand-maintained duplicate.
- The optional top-level **`social{}` block** (OASIS opinion propagation: graph edges, cascades of events,
  per-agent opinion trajectories, argument reach) — the SECOND graph, distinct from the report GraphRAG. A
  deterministic immutability checker (`social_checks.py`) guards post↔outcome sign-consistency.

**Phase 4 — COMPLETE (the OASIS social graph — the SECOND graph, NOT GraphRAG; agents still preview).**
- **4.0 OASIS spike — COMPLETE (verdict: GO).** `python/src/oasis_spike.py` proved all five exit criteria + a
  propagation check on real personas: installs/runs native Windows in a dedicated **`oasis` conda env (python
  3.11; camel-oasis 0.2.5 pins <3.12)**; DeepSeek bound via CAMEL `ModelFactory` (`ModelPlatformType.DEEPSEEK`);
  grounded 2.5b reactions as seed posts; per-agent opinion trajectory extractable from the OASIS sqlite `trace`
  table; **graph-driven propagation confirmed** (follow edges wired via `AgentGraph.add_edge`); cost ≈ **$1.16**
  for a 212-agent × 5-step full cascade (~$0.12 at activation 0.1). Evidence: `contract/runs/oasis-spike-<ts>.json`.
- **4.1 contract v0.4.0 — COMPLETE (frozen, additive).** persona `mode`/`stakeholder` + the top-level `social{}`
  block (see the v0.4.0-riders note above); both serializers mirrored + `sample_v0_4_0.json` + negative tests +
  `social_checks.py` immutability checker (post↔outcome sign-consistency); 38 pytest green; guard restored.

- **4.2 producer / 4.3 frontend / 4.4 refinement — COMPLETE.** The producer emits a real `social{}` block
  (immutability guard → per-event `audit_status`); the frontend derives group/mode from the artifact and renders
  the cascade discourse view (referendum-guarded — no tallies/charts); 4.4 tuned the cascade `safety_direction`
  echo-exclusion. Agents still preview, never a verdict.

**Phase 5 — the EDITOR + closing the loop (the human draws the change; the verifier becomes the USER).**
- **5.1 edit pipeline / 5.2 editor UI / 5.2b edit-an-edge / 5.2c bugfixes — COMPLETE.** A FastAPI job-runner
  (`python/src/server.py`) now FRONTS the whole quant pipeline. Draw a **new_road** (netconvert patch + the
  sumolib safety gauntlet + a SUMO load-probe; `--tls.rebuild` so signalized junctions don't reject) OR edit an
  existing edge (**speed_limit** / **bike_lane**, single-source eligibility in `run_sim.bike_lane_reason`) via the
  map palette → a STAGED run (`regen→baseline→scenario→analysis→done`; runtime changes skip `regen`) → scorecard +
  reroute count → enrich (voices / report / discourse) → a run switcher + `?run=` deep-links + a client-fetched
  change-visibility overlay. ONE job at a time (subprocess-isolated, in-process lock; run-state under
  `contract/runs/state/`).
- **5.3 — the product WALK (the verifier is the USER, not the suite).** Support built: demo-road ranking
  (`python/src/demo_road_select.py`, detour-factor), honest new_road change semantics (voices + report), the
  change overlay. Deferred V2 ideas + known cleanup live in `BACKLOG.md`.

## Run commands
SUMO: `export SUMO_HOME="/c/Program Files (x86)/Eclipse/Sumo"` (not on PATH). Python = base miniconda.
- **Editor / job-runner (Phase 5 — the PRIMARY flow; the server FRONTS the pipeline):**
  ```bash
  cd python/src && uvicorn server:app --port 8000  # API: /api/junctions /api/edges /api/simulate /api/runs[/<id>/status|/enrich] /api/report /api/chat
  cd web && npm run dev                            # http://localhost:3000 → open the ✏️ Edit toggle
  python python/src/demo_road_select.py            # pick a high-detour demo road (prints from/to junction ids)
  ```
  The server SUBPROCESS-launches `scenario_harness.py` (quant, staged run-state) then, on enrich,
  `sampler`/`reactions`/`report`/`report_agent`/`propagation`. No manual `ARTIFACT_URL` edits — the frontend loads
  `/latest.json` (or `/?run=<id>`); each run's artifact is copied to `web/public/<run_id>.json`. One job at a time.
- **Baseline run + artifact:** `python python/src/run_sim.py`  (see the `run-sim` skill)
- **Full scenario pipeline** (see the `run-scenario` skill):
  ```bash
  python python/src/scenario_harness.py            # baseline + scenario runs + outcome join
  python python/src/sampler.py                     # sample instrumented travelers
  PROVIDER=groq python python/src/reactions.py     # LLM reactions -> v0.2.0 artifact (GROQ_API_KEY in .env)
  ```
  Then point `web/components/MapView.tsx` `ARTIFACT_URL` at the new `/scenario-<ts>.json`.
- **Report + agent spine** (Phase 3; extra deps in `python/requirements-agent.txt`; DeepSeek default,
  `DEEPSEEK_API_KEY` in `python/.env`):
  ```bash
  python python/src/report.py                      # 5-section report (md+json) -> web/public/latest-report.*
  python python/src/report_agent.py                # build the per-run LightRAG index (under %LOCALAPPDATA%)
  cd python/src && uvicorn server:app --port 8000  # agent backend: GET /api/report, POST /api/chat
  ```
- **OASIS social spike** (Phase 4.0; the `oasis` conda env — python 3.11, camel-oasis 0.2.5, NOT base):
  ```bash
  conda run --no-capture-output -n oasis python python/src/oasis_spike.py   # -> contract/runs/oasis-spike-<ts>.json
  ```
- **Frontend:** `cd web && npm run dev`  → http://localhost:3000  (open 📄 Report → "Ask the report")
- **Tests:** `python -m pytest python/tests` (golden spine + agent/report honesty invariants)