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
  `deepseek` when `PROVIDER` is unset, so `DEEPSEEK_API_KEY` must be in `python/.env`. **DeepSeek model =
  `deepseek-v4-flash`** (the successor to the retired `deepseek-chat`, gone 2026-07-24). V4 defaults thinking ON,
  so every DeepSeek path force-disables it: the adapter auto-sends `extra_body={"thinking":{"type":"disabled"}}`
  for any `v4` id (`llm_provider`), and the LightRAG (`report_agent`) + CAMEL cascade (`oasis_cascade`) paths pass
  the same via their config — else `temperature` is a no-op and reasoning is billed as output. Generation
  temperature is per-call: `report._call` uses 0.3 (deterministic facts); `reactions.py` keeps 0.8 (persona
  variety). Gemini's free tier is tiny (flash = 20 req/day) and flash-lite is often 503. The server's enrich
  subprocess `setdefault`s `PROVIDER=deepseek` (else `reactions.py` falls to Gemini's quota). No model id
  hardcoded from memory — confirm via docs-researcher. **Audit-retry canary:** the first report generation on
  `deepseek-v4-flash` HELD the baseline — **2 corrected on retry (both `safety_direction` "safer streets"), 0
  unresolved** = no model drift. The report's audit-retry count is the drift signal: a meaningfully higher count
  (or any UNRESOLVED, which fails loudly) on a future model swap is the flag — investigate, don't push through.
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
**CURRENT STATE (the rollup — everything below this box is the per-step historical record):**
Contract **v0.8.0**. Phases 0–5 and V2.0–V2.2 are COMPLETE: the ✏️ editor fronts the whole pipeline
(draw a road / speed / bike lane / lane- & road-closures / incidents / 🏫 school-zone COMPOSITES —
windowed changes apply+revert in-sim with proof logs), demand is synthetic or calibrated AM-peak,
assignment day-one or settled, seeds 1–3 with per-cell ranges; enrich = 212 voices → audited report +
"ask the report" chat → OASIS discourse; ⇄ Compare with the provenance-mismatch guard. The calibrated
school-hours exemplar LANDED (`multimodal-scenario-20260727T180728Z`: zone pair 30-vs-28, no direction
claimed; the corridor SATURATES under calibrated AM peak — 72% delivered by 09:00). V2.2 is closed out and
TAGGED **`v2.2`**: every windowed run renders the WINDOWED-SCOPE DISCLOSURE (run-scoped scorecard vs
window-scoped change — report line + caveat + chat corpus + ScorecardPanel one-liner; unwindowed reports
byte-identical, golden-pinned). **V2.3a (SSE-streamed enrich) is COMPLETE**: enrich jobs stream over
`GET /api/runs/<id>/enrich/stream` (NDJSON events file → SSE; env-gated so CLI enrich stays byte-identical),
voices render incrementally (RunCard live counts + the EditPanel ticker), and a dead stream degrades LABELED
to the untouched poll. Suites: **329 pytest + 38 Playwright**. Open threads: **the rest of V2.3
(`docs/v2.3-plan.md`: in-character persona interviews, mandate-grounded institutional stakeholders that speak
only computed facts, the two graphs visible side by side)**; then V2.5
network styling + `BACKLOG.md` (bbox expansion, rung-2 detour, student demand).

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
  table shows). DeepSeek-default, temp 0.3. NOTE: `latest-report.*` is a committed GLOBAL singleton the specs depend
  on — keep it generated for the pinned run (see the **Report + agent spine** run-command gotcha).
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

**V2.0 Step a — contract v0.5.0 — COMPLETE (frozen, additive; multi-change scenarios).** The artifact is now
**v0.5.0**: `meta.scenario.changes[]` is the new change AUTHORITY (a scenario may compose several changes) + optional
`meta.scenario.tags[]`; `Change` gains `window`/`target_lanes`/`effect`/`position_m` and the types
`lane_closure`/`road_closure`/`incident`. Version-gated in the schema `allOf` (0.5.0 requires `changes[]` + forbids
the legacy `change`; pre-0.5.0 keeps `change`), and the existing grounding gate was extended to 0.5.0. **The
migration mechanic is the ACCESSOR — `changes_of(artifact)` (py) / `changesOf(artifact)` (ts); every consumer reads
the normalized list, never `.change`.** Semantic invariants (window.end>start, incident⇒window,
lane_closure⇒target_lanes) live in the pydantic models; `dump_artifact` also runs `audit_version_gate`
(version↔shape). The producer emits 0.5.0 wrapping its single change as `changes:[change]` (verified by a real run);
windowed/incident/closure MECHANICS are proven by `sample_v0_5_0.json` only — **no runtime applier yet (V2.2)**.

**V2.0 Step b — the NETWORK RENDERER — COMPLETE.** The drawn roads ARE the simulation's roads: `network_export.py`
exports the canonical net to `web/public/network.json` (4,570 edges), rendered as the deck.gl BASE layer in all
modes (stacked casing/fill PathLayers, meter-width by lane count, whisper bike tint, one-way arrows via IconLayer),
with the basemap demoted to CARTO **positron-nolabels**. Consolidated onto that ONE geometry: the change-overlay
resolves `target_edge` from the client network map (no `getEdges`), and edit-mode is a tint over the network joined
to a slimmed **`/api/edges` (eligibility metadata only)** — `network.json` is the single source of road pixels. Not
styled yet (functional-plain; V2.5). No contract change.

**V2.0 is COMPLETE** (Step a contract 0.5.0 + Step b network renderer + report-regeneration housekeeping, all
committed). The open threads it deliberately deferred: **V2.2 — now COMPLETE, Steps a–d below** (the runtime
change-scheduler, closures, incidents + the response-detour fact, the editor palette for all of it, and the
school-zone composite incl. the calibrated exemplar); and **V2.5** — network STYLING over Step b's
functional-plain base, still open. Tiered V2 ideas + standing cleanup live in `BACKLOG.md`.

**V2.1 (a–d) — COMPLETE (calibrated demand, assignment modes, seed robustness, the compare view; the contract is
now v0.8.0).**
- **a — count inventory:** Toronto Open Data TMC sweep → `data/counts/`; 126 AM-peak-supported interior
  intersections (bearing-checked midblock matching; boundary-clipped intersections never match).
- **b — calibrated AM-peak demand + contract v0.6.0:** routeSampler-calibrated 07:00–09:00 demand (~67k cars +
  bikes/peds; `python/scenario/calibrated/`; provenance + diagnosis in `data/demand/`). GEH<5 accepted at **51.8%
  of 421 links** — the 85% textbook target is structurally unreachable on this boundary-clipped corridor;
  scenario-vs-baseline stays like-for-like (the comparison-validity chip says so in the UI). v0.6.0:
  `meta.demand_profile` REQUIRED (forbidden pre-0.6.0) + optional `meta.render_sample` — calibrated artifacts cap
  RENDER to an outcome-stratified sample (vehicles 800 / persons 800 / conflicts severity-stratified 5,000;
  ~70 MB artifact) while outcomes/conflict-deltas/scorecard stay full-population. Calibrated-scale recording =
  `SpillRecorder` (TraCI-subscription batched, flush-on-departure spill, streaming ped-PET, INVALID-teleport
  sentinel guards — index positions, never unpack). Registry: `python/src/demand_profiles.py`
  (`synthetic_demo` | `calibrated_am_peak`; synthetic stays byte-identical to pre-V2.1b).
- **c — day-one vs settled + contract v0.7.0:** `--assignment settled` runs duaIterate MESO iterations (CARS
  ONLY — meso can't see bikes/peds) per leg, then the normal micro pair on the settled routes
  (`python/src/settle.py`; runtime changes get a netconvert-patched net via `network_edit.patch_runtime_net` PLUS
  the TraCI apply, VERIFIED by a runtime readback assert; new_road stays single-expression). v0.7.0:
  `meta.assignment` REQUIRED — `{mode, scope, iterations, relative_deviation, converged, engine}`; settled ⇒
  `scope:"cars_only"` ON THE WIRE (ped/bike rows are UNadapted even in a settled run — scope limitations ride the
  artifact, never a docstring). Deliverable pair (Kingston Rd 40 km/h, calibrated bounded peak hour): day-one car
  mean **+5.05 s** vs settled **+2.31 s** — adaptation absorbs ~half the shock; both settles converged 4/12
  iterations (~7 min/leg). duaIterate gotchas: it already passes `--time-to-teleport`/`--no-step-log` (re-passing
  = hard "already set" error); pass `--no-gzip` or the per-iteration routes come back gzipped; one bounded
  calibrated meso iteration ≈ 27 s.
- **d part i — seeds as a run option + contract v0.8.0:** `--n-seeds 3` runs cheap probe pairs at seeds 43/44
  after the canonical pair. **Seed 42 IS the artifact** (trajectories/outcomes/cell values); probes contribute
  ONLY the per-cell `range {min, max, n_seeds, sign_stable}` (the V1 robustness convention made native — no
  cross-seed central aggregate). sign_stable = strict straddle (min<0<max); access never ranged (deterministic
  heuristic); the safety note is EARNED per-run (flips/consistent across the actual seeds); settled probes REUSE
  the canonical settled routes — that basis is disclosed on the artifact (sidecar `seeds.basis` + ranged-cell
  notes + report methodology). HONESTY GENERALIZED: ANY sign-unstable cell renders ±magnitude — no signed form
  anywhere (map `ScoreCell`, report `render_cell`/`cell_valence`, and the chat corpus all flow through the same
  helpers); SIGN? badge + range sub-lines. `web/tests/fixtures/seeds-run.json` is a REAL 0.8.0 artifact generated
  by the actual aggregator — `test_seeds_fixture.py` fails on drift.
- **d part ii — the COMPARISON VIEW (pure frontend):** a 4th map mode (⇄ Compare; `?run=A&compare=B` deep link).
  Two SLIM sides ({meta, scorecard} only — 74 MB artifacts never retained twice; `web/lib/compare.ts` +
  `web/components/CompareView.tsx`). Per-side provenance strips (demand / assignment / seeds — "seeds unknown
  (pre-0.8.0 run)" for old artifacts) are INDEPENDENT of the **PROVENANCE-MISMATCH GUARD** (assignment.mode/scope,
  demand_profile, MECHANICAL change set — descriptions excluded — and seed evidence; prominent amber lines that
  inform, never block). Per-cell Δ (B−A) renders ONLY where direction is claimable on BOTH sides; **SAFETY NEVER
  gets delta arithmetic** and sign-unstable cells refuse too — the refused **"—†"** (amber + legend) is glanceably
  distinct from plain-— absence. No aggregates / winner / recommendation, ever (referendum guard extended;
  `web/tests/compare.spec.ts`).
**V2.2 Step a — the runtime CHANGE-SCHEDULER + closures — COMPLETE (no contract change; the 0.5.0 shapes went live).**
- **Scheduler (`python/src/change_scheduler.py`):** windowed changes APPLY at `window.start_s` and REVERT at
  `end_s` inside the `simulate_multimodal` step loop. Capture-before-apply per lane; restore via `setDisallowed`
  ONLY and assert restored == captured at revert. **SUMO 1.27 permission facts (probed live, encoded in the
  FakeConn):** `setAllowed(lane, [])` CLOSES a lane (the old run_sim comment was wrong — fixed) and `getAllowed()`
  reads `()` for BOTH fully-open and fully-closed, so closure checks/restores go through `getDisallowed`/
  `setDisallowed` (exact bitmask round-trip); `setDisallowed(lane, ["all"])` is the closure idiom (getDisallowed
  then returns the EXPANDED 33-class list, never the literal "all"). Same-edge windows must be LIFO-well-formed
  (disjoint — boundary-touching legal, revert fires before apply at an equal tick — or nested container-first;
  crossing rejected at build). Unwindowed paths stay byte-identical; seed probes rerun the scheduler for free;
  window past sim end never reverts (disclosed in the proof log). Windowed speed_limit supported; incident's
  Effect applier is **V2.2b**.
- **Closures:** `lane_closure` (`target_lanes` ⊆ car-lane indices, validated at POST vs `car_lane_indices` on the
  server edge cache AND live at apply — where already-fully-closed lanes count as valid targets: the SETTLED
  double-expression runs the micro leg on the runtime-patched net and the TraCI re-apply must stay idempotent) +
  `road_closure` (all lanes). Closure pairs run `--ignore-route-errors` on BOTH legs (symmetric; no-op baseline);
  rerouting device (already on) diverts proactively. **D1 + severing matrix** — single source
  `change_scheduler.assignment_rejection_reason`, IDENTICAL strings at POST (400) and harness (SystemExit):
  settled+windowed(any) and settled+road_closure / settled+lane_closure-closing-all-car-lanes rejected
  (duaIterate on a severed net, from source: default HALTS the iteration loop on the first unroutable trip;
  `--continue-on-unbuild` silently drops those trips every iteration). Settled + partial unwindowed lane_closure
  settles via the extended `patch_runtime_net` (per-lane `disallow="all"`, not-severed gauntlet) — verified live.
- **Honesty surfaces:** windows render CLOCK TIMES on calibrated (t=0 == 07:00; `demand_profiles.fmt_sim_time`/
  `fmt_window`) and sim-seconds on synthetic — in reactions (`_change_line` mechanical closure branches +
  time-scoped `_inferred_context` closure framing), report ("What was tested" bullets + the **closure block**:
  window-revert proof line, diverted count, per-mode non-completions), run-state descriptions, and the chat
  corpus. Closure runs surface `window_events` (the scheduler's REVERT PROOF: applied_t/reverted_t/restored_ok)
  + `non_completions` (per-mode `baseline_only` — the existing 2.2 accounting surfaced by name) in the outcomes
  sidecar + run-state done extras + `RunStatus`; `verify_facts` guards both. Scorecard access: lane_closure →
  car_commuter +0.5 low ("rule-based estimate; applies during the closure window" when windowed — a 30-min
  closure never renders identically to a permanent one); road_closure → honest null "road severed/closed —
  access heuristic not meaningful". Report caveats add temporary-event (windowed) + stranding (road_closure).
- **Accepted live:** calibrated bounded day-one Kingston Rd lane_closure (`V22AACC2`, 2 of 3 car lanes,
  07:10–07:40): revert proof verified on the live net; **935/19,804 cars diverted; non-completions 759 car /
  2 bike / 5 ped**; artifact validates at 0.8.0; audit passed (1 corrected on retry, 0 unresolved). Plus
  synthetic windowed lane_closure + road_closure smokes, API e2e (rejections exact + closure extras on
  status), settled partial closure end-to-end. **Gotcha:** launch LONG harness runs detached via PowerShell
  `Start-Process` — a subagent-shell's job object killed the first acceptance attempt after the baseline leg
  (same class as the server-detach rule; the harness dies silently with run-state stuck "running").

**V2.2 Step b — INCIDENTS + the response-detour fact — COMPLETE (no contract change; incident shapes went live).**
- **Incident applier:** `incident` joined `WINDOWABLE_TYPES` — a CAPACITY event, never a crash simulation:
  `effect.blocked` closes `target_lanes` for the window; `effect.speed_factor` scales EVERY lane's speed from the
  captured values (readback per lane); both combinable — one capture, one LIFO slot, the shared revert restores
  permissions + per-lane speeds. `position_m` accepted + stored, UNUSED this rung (rung-2 along-edge refinement).
  Pure `incident_rejection_reason` (8-row matrix, exact strings shared POST/CLI); settled+incident auto-rejects
  via the windowed rule. TWO predicates split honesty: `invalidates_routes` (closures + blocked incidents →
  `--ignore-route-errors` + `non_completions`; a speed-only incident never claims stranding) vs `capacity_event`
  (closures + ALL incidents → the detour fact + temporary-event surfaces). Access cell = honest null + note
  "temporary incident — access heuristic not meaningful" (user-ratified: access is STRUCTURAL; travel-time + the
  detour fact carry the incident's story). No surface uses crash/collision/accident wording (test-pinned).
- **Emergency-response detour (`python/src/response_probe.py` + `response_probes.json`):** for capacity runs,
  free-flow fastest-path seconds (`getOptimalPath(fastest=True)` — cost IS free-flow time; NEVER
  `getShortestPath`, distance-only) from the 2 inventory-flagged corridor-entry probes (boundary_clipped TMC
  records; DATA-not-code JSON) to a deterministic destination at the **first downstream junction with an
  ALTERNATE approach** (walking past pass-through shape-split nodes — anchoring near-side or at a 1-in/1-out
  node makes the fact identically-zero/unreachable), baseline vs an in-memory during-window net
  (`Lane.setPermissions(())` for closures/blocked; the **SUMO-1.27-pinned `edge._speed` poke** for speed_factor —
  guarded IN the production path: a vanished attr raises naming the pin, never a quietly-unmodified speed).
  Unreachable = `path is None or cost > 1e39` (threshold, never float equality). BOTH honesty sentences ride the
  payload and render wherever the numbers do (report block, RunCard chip, chat corpus; `verify_facts` enforces
  them + re-derives added_s): the FRAMING ("free-flow routing, not a dispatch model") and the LOWER-BOUND note
  ("does not include congestion the incident induces — a lower bound"). Partial blocks honestly render +0 s with
  the stays-passable note; full closures produce real numbers (Kingston Rd road_closure: +48.7 s from the Markham
  entry, test-pinned). Computed ONCE per run (seed-independent static routing), sidecar + run-state
  `response_detour` + `RunStatus`.
- **Accepted live:** calibrated bounded day-one Kingston Rd incident (2 of 3 car lanes blocked 07:10–07:30):
  revert proof verified; **957 car non-completions, 917/20,137 diverted, 17.8% materially affected**; detour
  honest-zero (partial block) with notes; 61/212 voices react to the blockage with temporary framing, 0 crash
  words; report audit passed (2 retry-corrected, 0 unresolved). Suites: pytest + 18 Playwright specs green.

**V2.2 Step c — closures + incidents in the EDITOR — COMPLETE (no contract change).**
- **Palette (`EdgePalette.tsx`):** Close lanes (a picker over the edge's REAL `car_lane_indices` — now shipped
  through `/api/edges`; sidewalk never offered), Close road, Incident (blocked lanes and/or slowdown %; window
  REQUIRED). Window inputs = start + duration MINUTES → sim-seconds on the wire; the resolved range renders as
  clock times on calibrated ("07:10–07:30") and an input-unit echo on synthetic ("10–30 min"). Any windowed
  draft LOCKS the assignment toggle to day-one with the exact D1 sentence shown (`assignment-locked-reason`;
  client copy of `REASON_WINDOWED_SETTLED` — the server 400 stays the backstop; submit forces day_one
  belt-and-braces). NO client descriptions — the server composes the canonical clock-time description.
- **Per-type overlays (`MapView.tsx`; first `@deck.gl/extensions` use):** capacity changes leave the amber
  legacy overlay — lane_closure = amber hazard stripes over dark casing (PathStyleExtension dash [4,3]),
  road_closure = dense red barring [1.5,1.5], incident = amber-red dashes + a dot-'!' marker (TextLayer glyph,
  zero binary assets) + a window BADGE ("07:24–07:42"; TextLayer with a STATIC characterSet — the en-dash is
  outside deck's default ASCII set, and a data-derived charset goes empty when the item is inactive and breaks
  the font atlas). **PLAYBACK TIME-TRUTH:** windowed overlays render ONLY within their window during playback
  (the conflict-pulses CPU-filter-on-t pattern); other modes always show them. Legend gains `legend-item-*`
  rows ("N lane(s) closed · range" — the denominator is never derived from network.json's TOTAL lanes). Test
  seam `window.__nadiChangeOverlay` (per-item active flags); specs SEEK by scrubbing the Timeline slider (the
  app's own pause-and-seek path — a raw setState seek loses races against the Timeline's rAF loop).
- **RunCard:** `window-chip` ("2 lane(s) closed 07:15–09:00", clock per profile via `web/lib/simTime.ts` — the
  client mirror of `demand_profiles.fmt_sim_time`, keep in lockstep) + a `non-completions` line for capacity runs.
- **Non-completions SPLIT (Prelim B):** scenario+baseline departed-ids (zero extra TraCI calls in the recorder
  branch; guarded adds in legacy) partition `baseline_only` into `entered_not_finished` vs the causally-NEUTRAL
  **`not_inserted`** — plus `insertion_backlog` {baseline, scenario} per mode. **INVARIANT (user-confirmed): the
  split never renders without the attribution parenthetical** ("insertion backlog affects baseline runs too:
  {B} vs {S}") — the backlog is STRUCTURAL (the V2.1b shortfall), not closure-caused; a three-way route-invalid
  bucket was checked and rejected with evidence (0 discard warnings in both real calibrated closure logs — the
  rerouting device fixes routes PRE-insertion, so --ignore-route-errors discards ~never fire). Sidecar +
  run-state + RunStatus + report (verify_facts: split sums + backlog recompute) + chat corpus.
- **Probe set (V2.2d prelim):** the origins are now **4 REAL Toronto Fire Services stations** (231 Markham Rd /
  232 Midland / 234 Coronation / 243 Sheppard — Toronto Open Data `fire-station-locations`, structured
  `_provenance` incl. retrieval date + the both-license-facts note; Station 221 dropped: 381 m from the nearest
  modeled car edge on the boundary-clipped net, documented in `_dropped`; the corridor-entry origins retired to
  `_retired`, which `load_probes` structurally never reads). `origins_note` ships in the payload and renders in
  report + chat: "…routes are computed from every station and **do not indicate which station would respond**"
  (real station names must never read as dispatch estimates). The RunCard chip labels its statistic: "worst of
  {N} stations: +{max} s". Every honest zero carries its explanation ("the fastest route from this origin does
  not use the changed road"). Sanity: closing Markham Rd at station 231's doorstep fires +10.2/+29.1/+2.7 s
  from the other three + unreachable from 231 — the computation is alive on the station set.
- **Prelim A CLOSED — the nonzero detour rendered live end-to-end:** a palette-driven windowed road_closure on
  Kingston Rd (`multimodal-scenario-20260725T030121Z`, synthetic — the detour is free-flow static routing,
  demand-independent): Markham entry **57.0 → 105.7 s = +48.7 s** (matches the test pin), Ellesmere honest 0,
  report block renders nonzero with BOTH honesty sentences. Live smoke: a palette-driven windowed lane_closure
  ran to done through the real API; chips + playback appear/disappear verified in the real UI.
- Suites: 247 pytest + 26 Playwright green (3 new spec files; the maplibre StrictMode warm-reload convention
  applies to any spec deep-linking a tiny fixture).

**V2.2 Step d — the SCHOOL ZONE: the first REAL multi-change scenario — COMPLETE (no contract change).**
- **Composite mechanics (producer):** `simulate_multimodal`/`run_pair_multimodal`/`run_quant_runtime` are
  list-native (`changes: list[Change]`, `tags`); unwindowed members loop apply+readback, windowed members ride
  ONE ChangeScheduler; every gate folds with `change_scheduler.any_invalidates_routes`/`any_capacity_event`;
  `build_multimodal_artifact(changes, tags)` emits `changes[]` (+`tags` when set) — single-change runs wrap
  `[change]` and stay shape-identical (target_lane stamped only on a lone change). `window_events` was ALREADY
  outside the invalidates_routes gate (the planned hoist was a no-op) — windowed speed_limits carry revert
  proofs. Sidecar/run-state gain `changes`+`tags` (`change`=changes[0] kept for back-compat readers).
- **Server flow:** `POST /api/simulate {changes:[...], tags:[...]}` (xor `change`); members are
  **speed_limit-only this step** (`REASON_COMPOSITE_MEMBER`; bike_lane is structurally non-composable — no
  per-member target_lane) and **settled+composite is rejected** (`REASON_COMPOSITE_SETTLED` — the settle
  runtime path double-expresses exactly one change); handoff = a spec file
  `contract/runs/state/<run_id>.composite.json` + `--composite=<path>` (runtime run-state emission — the
  single-change CLI stays byte-untouched); the harness RE-validates via `load_composite_spec` (same reason
  strings, SystemExit). Server fills member descriptions (contract-required) + the run description
  ("School zone: 30 km/h on 3 streets, …").
- **The ZONE LENS (`python/src/zone_lens.py`, tag-gated `school_zone`):** ped-vehicle crossing conflicts within
  **25 m of ANY zone edge** (never nearest-edge∈zone) during the window (inclusive), counted IDENTICALLY on
  both FULL conflict lists → `zone_facts` {pair, window(+span-fallback note — soft, never a mid-run assert),
  method/population/variation notes}. **TWO HONESTY LOCKS (user-locked):** `population_note` NAMES the measured
  population per profile ("pedestrian entities from the … demand — not modeled schoolchildren; student demand
  deferred", see BACKLOG) and **`variation_note` is ALWAYS present** ("single-seed counts; at these small event
  counts the difference … does not establish a direction") — the pair bypasses the scorecard's
  CellRange/sign_stable machinery entirely, so the caveat rides the numbers unconditionally. Report: a
  no-valence code-rendered pair with the variation sentence IMMEDIATELY after (verify_facts pins sidecar
  equality + both notes verbatim); caveats + chat corpus doc `zone__school_zone__facts` carry all notes.
- **Voices:** ONE mechanical preface when tagged ("These changes together form a proposed school zone: lower
  speed limits on {n} streets {range}") — untagged prompts byte-identical; parents (existing personas) react
  from their OWN outcomes; never a child voice (measured + advocated, never ventriloquized).
- **Frontend:** 🏫 zone-select mode (edge clicks ACCUMULATE, click-again removes; `ZonePalette` — 30 km/h
  default, window REQUIRED, the D1 lock engages on entry); the **zone TINT is ALWAYS visible** (a designation,
  like signage) while **playback time-gating now covers ANY windowed item** (windowed speed_limits
  appear/disappear at their window; unwindowed legacy pixel-identical); the legend zone row SAYS the rule:
  *"school zone (designation, always shown) — reduced limits apply during the window"* (else yellow-at-t=0
  reads as a bug); RunCard `zone-chip` ("School zone · 3 streets · {range}", suppresses the duplicate
  window-chip). **`changeSetKey` gains `window`** (same edges/speeds at different HOURS is a real provenance
  difference; unwindowed serializes undefined → old keys unchanged) and **excludes tags** (presentation, not
  physics — documented in compare.ts).
- **Access truth:** speed_limit has NO access heuristic, so a zone composite renders access ABSENT exactly like
  a single speed_limit run (the composite-null note fires only when >1 change contributes a heuristic to one
  group — pinned at unit level with a 2×bike_lane composite; the plan's "composite-null fires" acceptance item
  was based on a wrong recon assumption and is corrected here). The zone's story lives in the zone lens.
- **Response detour on composites:** UNIT-verified only (multi-member `modified` union + changes[0] anchor) — a
  speed-limit composite is correctly NOT a capacity event, so the fact doesn't compute on a zone run; the
  coverage gap (needs a multi-change CLOSURE flow, which no palette produces) is recorded in BACKLOG, not
  assumed closed.
- **Fixture:** `web/tests/fixtures/school-zone-run.json` — REAL producer output (build_multimodal_artifact +
  compute_scorecard, real canonical edge ids so the network join resolves), pinned by
  `test_school_zone_fixture.py` (regen: `python python/tests/test_school_zone_fixture.py`); `school-zone.spec.ts`
  (6 tests: palette POST, tint+legend verbatim, windowed-legacy scrub gating both ways, zone-chip, compare
  mismatch/twin-silent/window-shifted).
- **Accepted live (synthetic, `multimodal-scenario-20260726T235722Z`):** the palette-shaped composite POST
  (Kingston Rd 42140001 + 2 adjacent edges, 30 km/h, window 600–1200) ran to done through the real server —
  3 per-member revert proofs all `restored_ok`, zone_facts pair (0 vs 0 — exactly the small-n case) with all
  three notes verbatim on run-state==sidecar, response_detour/non_completions correctly ABSENT; voices 212
  (62 parent-persona, own-outcome-grounded); report enumerates 3 changes + the zone block with the variation
  sentence ADJACENT to the pair + both zone caveats, audit 0-unresolved (4 safety-direction corrected on
  retry — a slow-traffic scenario invites them; singleton restored after). **Code review caught a real
  BLOCKER, fixed + regression-pinned:** the composite spec file in `contract/runs/state/` was swept up by
  `run_state.list_all()`'s `*.json` glob and 500'd `GET /api/runs` for EVERY run (reproduced live) —
  `list_all` now skips `*.composite.json` and `read()` refuses run_id-less JSON; the scheduler's LIFO rule is
  now the pure `change_scheduler.lifo_conflict_reason`, ALSO enforced at POST (400) + spec load (SystemExit)
  so same-edge crossing windows die at the API, never mid-SUMO-run (nested stays legal). Suites: 300 pytest +
  32 Playwright green.
- **The calibrated school-hours exemplar — ATTEMPTED 2026-07-27, ABORTED (pace collapse); rerun needs a
  reshaped ceiling.** Selection landed and is committed (`python/src/school_zone_select.py` →
  `data/schools/school-zone-exemplar.json`): 4 cluster schools (ST BARBARA / TECUMSEH / CORNELL JR /
  GOLF ROAD — School Locations - All Types, package `1a714b5c-64c0-4cdf-9739-0086f80fb3ee`, resource
  `02ef7447-54d9-4aa7-b76d-8ef8138ac546`, license "License not specified", last_refreshed 2026-05-27) bind to
  **3 deduped edges** (`36795944#0`, `36795936#0`, `-36795988#6` — Tecumseh + Golf Road share a street; the
  floor counts EDGES, never schools; a "CORNELL INTERNATIONAL ACADEMY" name-collision was dropped +
  documented). Run `multimodal-scenario-20260727T032219Z` (30 km/h ×3, window 3600–7200 = 08:00–09:00 —
  "the portion of the documented TDSB drop-off band that falls within the calibrated demand period" — the
  7200–9000 tail was to drain, never measured; WMI `--end 9000` gate passed): the window applied at 3600 and
  reverted at 7200 IN-SIM, but **a sim-TIME ceiling does not bound WALL-CLOCK** — baseline leg 6.2 h (4× the
  bounded-3600 precedent), scenario leg entered a queue-spiral drain (~1 sim-s/min at sim-t 7369, decelerating,
  ETA ~27 h) and was aborted at 13 h; state honestly `failed` with the reason; server restored unbounded
  (launch-shell env proven clean). **Rerun shape when reattempted: `NADI_MAX_T_OVERRIDE=7200`** — measure the
  full zone window, skip the un-drainable tail (the tail was never a measured claim; non-completions honesty
  already covers the trips still in-network at the ceiling). **PACE-CURVE PROBE (2026-07-27, plain headless
  sumo, calibrated baseline, --end 7200, seed 42, rerouting on, no TraCI/SSM/recording): the plain leg completes
  in 37 min** — the COST curve does not death-spiral inside 7200 (knee at t≈1000 as demand ramps; trough 1.5
  sim-s/s at t 4000–5000; RECOVERS to 2.3–3.0 by 5000–7200, the default-300s teleports acting as a pressure
  valve — 980 cumulative, accelerating). The POPULATION curve never flattens: inflow exceeds outflow the whole
  window (insertions ~530–600/min vs arrivals ~440–500/min), on-network climbs monotonically to 11,789 at
  t=7140 (+6,293 insertion backlog; 49,095/67,808 loaded delivered = 72% by 09:00) — GENUINE SATURATION, the
  V2.1b compound-delivery deficit measured directly (arrivals hold; not a collapse/localized failure). 37 min
  is a FLOOR (no TraCI/recording/SSM); the aborted run's own legs give harness overhead ≈8–9× → a trimmed
  --end 7200 harness pair projects to ~11–12 h (baseline 0–7200 ≈5 h, scenario ≈5.75 h, + analysis) —
  overnight-feasible and BOUNDED (the ceiling ends at the window; the drain-spiral regime is never entered).
  Probe evidence: `%LOCALAPPDATA%\nadi-demand\pace-probe\`.
- **The trimmed exemplar LANDED — `multimodal-scenario-20260727T180728Z` (calibrated, --end 7200, day-one,
  seed 42; ~6.5 h wall: baseline 3.8 h, scenario ~6 h — the scenario tail decayed 82→2 sim-s/min through the
  saturated window but the ceiling bounds it).** The zone: 30 km/h on the 3 selected streets, window 3600–7200;
  **the modeled window covers 08:00–09:00, the portion of the documented TDSB drop-off band that falls within
  the calibrated demand period.** All three `window_events`: applied at 3600; never reverted with the DISCLOSED
  note (window end == sim ceiling — the honest shape, not a failure; the report renders it verbatim).
  **PRECISION: the exemplar proves APPLICATION, not revert** — its three window events ended at the sim
  ceiling; the revert proofs (restored == captured) come from the synthetic V2.2d acceptance and the V2.2a/c
  live runs. Never cite the calibrated exemplar as revert evidence.
  **zone_facts pair: 30 baseline vs 28 scenario** ped-vehicle crossing conflicts on zone streets during the
  window — real calibrated counts (vs synthetic's 0-vs-0), still small-n: the always-present variation note is
  doing exactly its job (a 2-event difference claims no direction), and the per-run judgment is NOT to say more
  than the caveat allows. population_note names "pedestrian entities from the TMC-anchored calibrated demand".
  Headlines: 2,660/61,192 cars diverted, car median +0.0 s, 13.8% materially affected; artifact 90.4 MB,
  validates at 0.8.0 (changes[3] + tags; render sample 799/61,192 vehicles + 800/5,076 persons). Voices: 212
  (38 parent-persona, own-outcome-grounded). Report `report-20260727T180728Z`: 3 changes enumerated, the zone
  pair with the adjacent variation sentence, audit **8 clean / 1 corrected / 0 unresolved** (no drift);
  singleton restored after; server relaunched unbounded FIRST (restore-before-diagnose), launch shell proven
  clean, 0 override prints. Ops lessons encoded: monitors key on HARNESS
  PROCESS liveness, never run-state age (stages are silent for a whole leg); sample sim-pace from the tripinfo
  tail before trusting any ETA; override-restore runs STRUCTURALLY FIRST on return, before diagnosis,
  whatever the outcome. **Calibrated wall-clock does not extrapolate in EITHER direction** — four data points:
  the 6 h unbounded wedge; C6's 27 s/iter meso surprise; the ~27 h pace-collapse ETA at --end 9000; 6.5 h
  actual vs 11–12 h projected at --end 7200. The pace probe gave a trustworthy LOWER BOUND; the overhead
  multiplier derived from a DIFFERENT-SHAPED run did not. Probe the shape you will actually run; treat
  cross-shape multipliers as guesses.

- **V2.2 CLOSEOUT — the WINDOWED-SCOPE DISCLOSURE + the `v2.2` tag.** The gap (spotted on the exemplar): zone
  facts are window-scoped but SCORECARD measures are RUN-scoped — "car median +0.0 s" / "13.8% materially
  affected" cover 07:00–09:00 while the zone was active only 08:00–09:00, and nothing said which period each
  covers; a run-scoped number reads as the change's cost DILUTED by an hour in which nothing was different.
  General fix for EVERY windowed change (V2.2a/b/c/d): **`report.build_scope_disclosure(changes, sim_end,
  profile)` is the SINGLE SOURCE** — the Section-2 line adjacent to the scorecard table, the caveat, the
  chat-corpus scorecard rows, and the `verify_facts` recompute-and-pin (REQUIRED iff any change is windowed;
  the variation_note enforcement level) all read it, never re-derive it. Span = `zone_lens.resolve_window`
  (the ONE span convention; differing member windows disclose via the shared `zone_lens.span_note(subject)`
  refactor — `SPAN_WINDOW_NOTE` byte-identical); the dilution tail names only the flanks that EXIST (the
  exemplar shape, window end == sim ceiling → "diluted by the period before it"); a MIXED windowed+permanent
  set reads "the windowed change was active …" (fixture-only today — no palette composes it; TEST-pinned so
  the future multi-change closure flow inherits it correct). UNWINDOWED runs render NOTHING new — pinned
  byte-identical by `python/tests/golden_report_unwindowed.md` (captured PRE-feature; the regen helper
  structurally refuses a windowed source artifact). Web: the ScorecardPanel one-line scope note ("measures
  cover the full run; change active {range}" via `fmtWindowRange`; `scorecard-scope-note`); RunCard
  deliberately unchanged (chip-dense). Exemplar report REGENERATED with the disclosure ("(07:00–09:00); the
  changes were active from 08:00 to 09:00 of it … diluted by the period before it"), audit 7 clean / 2
  corrected on retry / 0 unresolved (both safety_direction — the canary class; no drift); singleton restored.
  Also fixed, PRE-EXISTING (stash-proven, not a regression): edit.spec's two default-5s `mode-edit` waits →
  20 s ('/' loads the real ~90 MB `latest.json` since the exemplar landed). Review caught the UNCLAMPED span
  end — a window may legally end past the sim ceiling, and the sentence would have claimed activity outside
  the period it just defined (verify_facts recomputes via the same function, so it ships silently): display
  bounds now clamp to [0, sim_end] on BOTH sides (report + `windowedSpan`), regression-pinned. Disjoint-window
  span honesty (API-only reachable) recorded in `BACKLOG.md`. Suites: 311 pytest + 34 Playwright green.
- **Batch exemplar (overnight):** calibrated bounded day-one 3-seed run `multimodal-scenario-20260720T010417Z` —
  3.81 h total, 70 MB artifact. FINDING: at calibrated congestion only the CYCLIST safety sign flips across seeds;
  car/ped/resident safety magnitudes vary up to ~6× but HOLD sign — while synthetic demand flips ALL safety signs
  (V1 reproduced natively in `…20260719T042917Z`); travel medians are seed-robust ([0,0] ranges).

**V2.3 Step a — the SSE-STREAMED ENRICH — COMPLETE (streaming is TRANSPORT, not content; no contract change).**
- **Events channel (`python/src/enrich_events.py`):** an NDJSON file at `%LOCALAPPDATA%\nadi-enrich\<run_id>.events.jsonl`
  appended by writers, tailed by the server's SSE endpoint — reconnect-safe by construction (SSE `id:` = absolute
  line NUMBER; no seq field, no cross-process counter; replay-from-0 IS the resume story). Emission is
  **env-gated** (`NADI_ENRICH_EVENTS`, set only by the server) → CLI enrich byte-identity by construction. Reader
  tolerates a partial trailing line + skips-but-counts corrupt lines (linenos stay aligned). Vocabulary: `job_start`
  (the client dedup-reset sentinel) / `cmd_start`/`cmd_end` (server-written per subprocess — this alone gives
  report/discourse live stage labels) / `voices_total` / `voice {index, done, total, agent}` / `job_done`/`job_failed`.
- **POST-TIME ORDERING INVARIANT (test-pinned):** truncate → emit `job_start` → launch subprocess, synchronously in
  the POST handler under the held lock — `job_start` is structurally LINE 0 of every fresh file, so the client's
  dedup reset and the stale-id-past-EOF replay can never misfire. `prune()` (7-day) has its ONE call site there.
- **Byte-identity mechanic:** `reactions.build_agent(rec, reaction)` extracted as the SINGLE builder — final
  assembly and stream emission share it; the streamed agent is `model_dump(mode="json", exclude_none=True,
  by_alias=True)` (the `dump_artifact` shape); pinned by an element-for-element two-path test. Proven live: a CLI
  reactions run touched no events file (mtime+linecount unchanged) and assembled all 212 agents.
- **Server:** `GET /api/runs/<id>/enrich/stream` (StreamingResponse; replay-then-tail at 0.25 s; `Last-Event-ID`
  resume, stale-id → replay from 0; 15 s ping heartbeat; ORPHAN GUARD — run-state terminal + lock free but no
  terminal event → synthetic terminal frame, a stream never heartbeats a dead job forever; 404 when no events file).
  `GET status` derives `enrich_progress {done,total,label}` READ-ONLY from the events tail during `enrich:*`
  (run_state's set_stage is an unlocked read-merge-write — nothing new is ever written there). Poll loop untouched.
- **Frontend:** `web/lib/enrichStream.ts` (typed EventSource wrapper: dedup by lastEventId, reset on `job_start`;
  native auto-reconnect is the resume path; `readyState CLOSED` → onDegrade ONCE). RunCard: "Enriching: voices…
  47/212" live (stream counts beat the label; polled `enrich_progress` once degraded), the LABELED degrade note
  "live stream unavailable — updating by poll", `streamEnded` ref kills the job_done→poll-lag reopen loop
  (Playwright-caught). EditPanel: the voices TICKER (newest-first, cap 6, inferred labeled "community
  perspective", "not a poll"). MapView `handleVoice`: appends the streamed agent to the loaded artifact (run-id
  guarded — hasVoices flips live, the feed grows) + the ticker list; `done === 1` marks a NEW JOB — resets the
  index dedup and REPLACES the voice sets (a re-enrich otherwise streams into a stale seen-set that swallows every
  voice — live-smoke-caught); the done-edge `loadRun` reload stays the authoritative swap (clears the ticker).
- **Verified:** unit 18 (events 8 + builder 3 + endpoint 7) in the 329; `enrich-stream.spec.ts` ×4 (incremental
  render while status still enriching; re-enrich fresh-set/no-pile-up; mid-stream disconnect degrades uncorrupted;
  NETWORK-level failure degrades too — review-caught: an aborted connection retries CONNECTING forever and never
  reaches CLOSED, so the wrapper now degrades after 3 consecutive failed opens, else stale counts paint unlabeled.
  Review also hardened `read_from` against truncation-under-a-tail (offset past EOF → replay from 0). Spec GATE
  ORDER: assert the enriching state RENDERED before waiting for it to end, else the wait passes in the
  pre-first-poll window and the panel assertion runs mid-enrich). Live smoke: 212/212 counts ticked, ticker rows,
  `cmd_start` labels ("sampling travelers"), done-edge swap clean. **Real-browser degrade PROVEN** (the fold-in-#3
  check): mid-enrich 404 on the stream route + reload → real Chrome EventSource gave up (CLOSED) → verbatim note →
  POLLED counts advanced 79→201/212 → poll finished the job → note cleared, voices ✓. Report/discourse live labels
  ride the same `cmd_start` plumbing (voices-proven; no live report enrich — the latest-report singleton + cost).
- **Ops note:** `.claude/hooks/format.py`'s prettier leg is ARMED-BUT-CONFIGLESS — any `npx prettier` run seeds the
  npx cache and the PostToolUse hook then rewrites edited web files to prettier DEFAULTS (no repo config exists;
  cost a 231-line accidental reformat, reverted). Keep prettier out of the npx cache, or land a real config.

## Run commands
SUMO: `export SUMO_HOME="/c/Program Files (x86)/Eclipse/Sumo"` (not on PATH). Python = base miniconda.
- **Editor / job-runner (Phase 5 — the PRIMARY flow; the server FRONTS the pipeline):**
  ```bash
  cd python/src && uvicorn server:app --port 8000  # API: /api/junctions /api/edges /api/simulate /api/runs[/<id>/status|/enrich|/enrich/stream] /api/report /api/chat
  cd web && npm run dev                            # http://localhost:3000 → open the ✏️ Edit toggle
  python python/src/demo_road_select.py            # pick a high-detour demo road (prints from/to junction ids)
  ```
  The server SUBPROCESS-launches `scenario_harness.py` (quant, staged run-state) then, on enrich,
  `sampler`/`reactions`/`report`/`report_agent`/`propagation`. No manual `ARTIFACT_URL` edits — the frontend loads
  `/latest.json` (or `/?run=<id>`); each run's artifact is copied to `web/public/<run_id>.json`. One job at a time.
- **V2.1 run options** (harness flags = `/api/simulate` fields = the run form): `--demand-profile
  {synthetic_demo,calibrated_am_peak}`, `--assignment {day_one,settled}`, `--n-seeds {1,2,3}` (flags appended only
  for non-defaults — the default cmd stays byte-stable, unit-pinned in `test_server_cmd.py`). **V2.2a/b/c closures + incidents
  (since V2.2c the ✏️ Edit palette drives all of this — lane picker / close road / incident + window inputs):**
  `--change-type {lane_closure,road_closure,incident}` + `--target-lanes 1,2`
  (csv, car-lane indices) + `--window-start/--window-end` (sim-seconds, both-or-neither; windowable: speed_limit
  + closures + incident) + incident effects `--blocked` / `--speed-factor 0.5` / `--position-m` (stored, unused).
  Incident REQUIRES a window; windowed/severing settled combos are rejected with the shared reason strings.
  **V2.2d composites (the 🏫 school-zone palette flow):** `POST /api/simulate {changes:[...], tags:["school_zone"]}`
  → the server writes `contract/runs/state/<run_id>.composite.json` and hands off via `--composite=<spec>`
  (speed_limit-only members this step; settled+composite rejected; the harness re-validates). Zone-edge
  selection for the exemplar: `python python/src/school_zone_select.py` → `data/schools/`. Compare two finished
  runs at `http://localhost:3000/?run=<A>&compare=<B>` (or the ⇄ Compare toggle) — pure frontend, only needs
  `/api/runs` for the pickers.
- **Bounded-calibrated convention (V2.1):** calibrated runs are bounded to the peak hour by launching the SERVER
  with `NADI_MAX_T_OVERRIDE=3600` in its environment (the harness subprocess inherits it). **HARD-GATE every
  bounded launch**: check the live `sumo.exe` command line carries `--end 3600` (WMI `Win32_Process`) — server-env-
  set and subprocess-inherited are different facts, and unbounded calibrated is the multi-hour-per-leg wedge
  regime. **The default server state is NO override** — a bounded server silently truncates synthetic runs; after
  calibrated work, ALWAYS relaunch without it (the `[demand-profiles] NADI_MAX_T_OVERRIDE` print must be absent),
  unconditionally on the run's outcome. Long-run guards: keep-awake scripts at
  `%LOCALAPPDATA%\nadi-demand\keepawake{,-8h}.ps1` (user-approved; auto-sleep mid-leg once cost a day); detach the
  server via PowerShell `Start-Process` (bash-detached children die with the shell's job object). Scratch:
  `%LOCALAPPDATA%\nadi-demand\` holds the calibrated spill jsonls (`runs/`), settle workdirs (`settle/`) and server
  logs — OneDrive-safe like the other scratch roots.
- **Baseline run + artifact:** `python python/src/run_sim.py`  (see the `run-sim` skill)
- **Network export (V2.0b — the base road layer):** `python python/src/network_export.py` → `web/public/network.json`
  (every normal edge: `{id, geometry, lanes, speed_mps, oneway, allows{car,bike,ped}}`; prints the oneway fraction
  as a sanity check). The frontend renders THIS as the base roads (deck.gl), so `/api/edges` now serves eligibility
  METADATA only. **RERUN whenever the canonical `python/scenario/corridor.net.xml` changes — `network.json` and the
  golden trajectory (`python/tests/golden_trajectory.json`) go STALE TOGETHER** (both derive from the canonical
  net; refresh them alongside any netconvert/regen).
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
  **GOTCHA — `latest-report.*` is a COMMITTED, GLOBAL singleton.** `ReportPanel` reads `/latest-report.json`
  (`REPORT_URL`) **regardless of the loaded `?run=` artifact** — the report view is NOT per-run. The Playwright
  specs pin the 212-agent social run `multimodal-scenario-20260702T044134Z` via `?run=`, so `web/public/latest-report.*`
  **must be generated FOR that run** or `discourse.spec`'s `report-discourse` assertion fails (report view ↔ pinned
  artifact diverge — a later run's report silently overwrites it). Regenerate with the EXPLICIT run-id — never let
  `_resolve` pick the newest: `python python/src/report.py --run-id multimodal-scenario-20260702T044134Z`.
  `report_agent.newest_index()` likewise picks the **newest-timestamp** index (not the report's run); with several
  runs' indexes under `%LOCALAPPDATA%\nadi-report-agent\`, the server may serve a different run's chat than the
  report view (it warns "index run != report run") — rebuild/keep only the pinned run's index to align the chat.
  V2.1 practice: non-pinned indexes are ARCHIVED (reversibly) at `%LOCALAPPDATA%\nadi-report-agent\archive\`, and
  after any verification report-regen, restore the singleton via `git checkout -- web/public/latest-report.*`.
- **OASIS social spike** (Phase 4.0; the `oasis` conda env — python 3.11, camel-oasis 0.2.5, NOT base):
  ```bash
  conda run --no-capture-output -n oasis python python/src/oasis_spike.py   # -> contract/runs/oasis-spike-<ts>.json
  ```
- **Frontend:** `cd web && npm run dev`  → http://localhost:3000  (open 📄 Report → "Ask the report")
- **Tests:** `python -m pytest python/tests` (328 tests: golden spine + contract 0.6.0–0.8.0 sections +
  seed-range/report honesty invariants + the unwindowed-report golden + the V2.3a enrich-events/builder/SSE
  sections) and `cd web && npx playwright test`
  (38 tests across 11 spec files incl. seeds, compare, school-zone, scorecard-scope, enrich-stream). **Dev-only Playwright
  hazard:** a TINY fixture artifact can resolve inside React StrictMode's double-mount window and fatally crash
  maplibre teardown (the dev overlay eats the app) — specs delay fixture routes ~500 ms + warm-reload once
  (documented in `compare.spec.ts`); production builds and real artifact sizes never hit it.