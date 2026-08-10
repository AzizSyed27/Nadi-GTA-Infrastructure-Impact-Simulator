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
- `python/` — simulation + agents. SUMO via TraCI (the libsumo wheel is absent on this box — TraCI
  fallback; see the sumo-env memory), FastAPI, the sampler, OASIS/CAMEL, LightRAG.
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
- Python: base miniconda (3.13), ruff (format + lint), pyright (types), pytest. Windows-native dev.
  OASIS alone runs in the separate `oasis` conda env (3.11) — see the OASIS gotchas below.
- TS: eslint, tsc (types), Playwright e2e. NO vitest; prettier is deliberately unconfigured — the
  format hook's prettier leg is armed-but-configless (V2.3a ops note): seeding the npx cache makes
  it rewrite edited web files to prettier defaults. Keep prettier out of the npx cache or land a
  real config first.
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
  **BASELINE SHIFT (2026-07-31):** the guard TIGHTENED (V2.3b follow-up — the clause-bounded
  `_strip_disclaimers` re-check in `audit_prose`; disclaimer-paired claims no longer skip) — a modestly higher
  corrected-on-retry count on the NEXT report regen is expected from the guard change, not model drift;
  compare against a post-change baseline before reading it as a flag.
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
Contract **v0.9.0**. Phases 0–5 and V2.0–V2.2 are COMPLETE: the ✏️ editor fronts the whole pipeline
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
to the untouched poll. **V2.3b (persona interviews) is COMPLETE**: every voice is interviewable in character
via `POST /api/interview` — grounding built SERVER-side from that ONE agent's own records (ids on the wire,
never facts; sibling inferred voices disambiguated by agents[] index), every answer passes the live honesty
guard (audit_prose + verdict rule; retry-once → in-character refusal), inferred voices disclose their basis,
and the whole thing is EPHEMERAL (session transcripts only, nothing written). **V2.3c (the institutions
speak) is COMPLETE — contract v0.9.0**: `grounding:"mandate"` agents carry a SOURCED published mandate
(verbatim, byte-identity-pinned — never LLM-touched) + citations of this run's computed facts with the
honesty sentences riding; the roster (TFS / TDSB / Transportation Services) is FACTS-GATED (no facts →
no voice, all-zero payloads are not standing, the section says why it's empty), voices are DETERMINISTIC
(zero LLM calls), excluded from cascades, rendered as a pinned mandate-lens feed block + grounding cards +
a code-rendered report subsection under verify_facts REQUIRED-iff enforcement, and interviewable third-
person-only with operational-claim refusal; the pinned Playwright run is STRUCTURALLY guarded against
artifact-rewriting enriches. **V2.3d (the graph split-view) is COMPLETE — V2.3 IS CLOSED**: 🕸 Graphs
renders the project's two graphs side by side, visibly two graphs (OASIS "who influences whom" vs
GraphRAG "what the report's chat agent knows"; the one-liner says they differ on purpose) — positions
precomputed server-side (`graph_export.py`, read-only by design, networkx spring seed 42, per-component
shelf packing), sidecar `contract/runs/graphs-<ts>.json` + `web/public/<run_id>-graphs.json` refreshed
half-wise by the discourse/report enriches (soft-fail → backfill CLI), influence connectors DASHED and
separate from follow edges (only ~6% coincide — the exposure note says so), exclusion rings surface
withheld-posts METADATA (rules on hover, never content), entity staleness legible three ways
(fresh / stale note / unknowable), referendum guard extended (uniform node size, group-not-stance
colors, GRAPHS_BANNED), per-panel labeled degradation naming enrich + backfill, and the coverage gap
attributed honestly (institutional exclusion ≠ sibling-dedup). **V2.4a (the draft basket) is
COMPLETE**: apply INVERTS to add-then-run — every palette apply + the zone macro ADD members to a
session-only draft, DraftPanel lists them with draft-time blockers (client mirror of the shared
reason strings, D2's stable set only), one Run submits (1 member no-tag = today's exact wire shape,
regression-pinned). **V2.4b (the closure composite) is COMPLETE**: composite members = the four
windowable types (per-member rejection matrix both layers; allowlist serializer), and the two
dormant honesty paths are PRODUCTION-EXERCISED — the scorecard composite-null note (both-counts
wording) fired on a live 2-lane_closure run, and the detour's multi-member exclusion ran CLEAN on a
live 3-member mixed run (doorstep station unreachable, worst reachable +29.1 s; `modified_edges` +
`destination_anchor` + the arbitrariness `anchor_note` logged + verify-pinned; TFS spoke the
composite citation). Suites: **429 pytest + 69 Playwright**. Open threads: **V2.4c–d**
(clone-and-tweak + run identity, closeout) + **V2.5 network styling** + `BACKLOG.md` (bbox
expansion, rung-2 detour — now with a live datapoint, student demand, mandate re-verification,
disjoint-window span honesty — now UI-reachable).

**Phase 1 — COMPLETE (contract v0.2.0).** Two-run baseline-vs-scenario harness on one corridor edge,
per-vehicle outcome join, ~12 persona agents pinned to winner/loser travelers, provider-agnostic LLM
reactions voiced as INDIVIDUAL anticipated reactions, played back as sentiment-colored dots + a
click-through panel + a comment feed keyed to each traveler's worst moment.

**Phase 2 — COMPLETE (contract v0.3.0).** The per-STAKEHOLDER scorecard (7 groups × travel_time /
safety / access) with per-cell honesty metadata (`confidence` + `note`), safety surrogates + conflict
events ("near-miss events observed in this run", never "danger added"), ~212 voices across three
grounding kinds (vehicle-pinned, person-pinned, INFERRED community). ScorecardPanel renders safety as
±magnitude with NO direction; CommentFeed at 212; scorecard→feed join; the hard REFERENDUM GUARD (no
stance tallies / sentiment averages / vote counters). `web/lib/personaGroups.ts` maps persona id →
group/mode/label client-side.

**Phase 3 — COMPLETE.** 3.1 `report.py`: a deterministic 5-section skeleton — the LLM fills ONLY
marked narrative slots, ALL numbers code-rendered; `audit_prose` honesty audit (no digits / safety
direction / tally / crash words — retry once, else fail loudly) + a code-rendered fact check; writes
`contract/runs/report-<ts>.{md,json}` + the committed `web/public/latest-report.*` GLOBAL singleton
(see the Report + agent spine run-command gotcha). 3.2 `report_agent.py` + `server.py`: a per-run
LightRAG index (~230 docs at `%LOCALAPPDATA%`, DeepSeek + local MiniLM dim-384 pinned in
`embedding_meta.json`); `GET /api/report` + `POST /api/chat` retrieve via `aquery_data` then run a
guarded generation reusing the SAME `report.audit_prose` (retry → caveat-only fallback). Digit-free,
cited, honest refusals. This is GraphRAG memory, NOT the OASIS social graph.

**Phase 4 — COMPLETE (contract v0.4.0; the OASIS social graph — the SECOND graph, NOT GraphRAG).**
4.0 spike verdict GO (native Windows in the dedicated `oasis` env; graph-driven propagation confirmed
via `AgentGraph.add_edge`; ≈ $1.16 for a 212-agent × 5-step full cascade; evidence
`contract/runs/oasis-spike-<ts>.json`). 4.1 contract v0.4.0 additive: persona `mode`/`stakeholder` +
the top-level `social{}` block + `social_checks.py` immutability checker (post↔outcome
sign-consistency). 4.2–4.4: the producer emits a real `social{}` block (per-event `audit_status`);
the frontend derives group/mode from the artifact and renders the referendum-guarded cascade
discourse view (no tallies/charts). Agents still preview, never a verdict.

**Phase 5 — COMPLETE (the EDITOR; the verifier becomes the USER).** `python/src/server.py` FastAPI
job-runner FRONTS the whole quant pipeline: draw a **new_road** (netconvert patch + sumolib safety
gauntlet + SUMO load-probe; `--tls.rebuild`) OR edit an edge (**speed_limit** / **bike_lane**,
single-source eligibility) via the map palette → a STAGED run (`regen→baseline→scenario→analysis→
done`; runtime changes skip `regen`) → enrich (voices / report / discourse) → run switcher + `?run=`
deep-links + the change overlay. ONE subprocess-isolated job at a time; run-state under
`contract/runs/state/`. 5.3 walk support: `demo_road_select.py` (detour-factor ranking), honest
new_road change semantics. Deferred ideas + cleanup live in `BACKLOG.md`.

**V2.0 — COMPLETE (contract v0.5.0 + the network renderer).** a: `meta.scenario.changes[]` is the
change AUTHORITY (a scenario may compose several changes; + optional `tags[]`); `Change` gains
`window`/`target_lanes`/`effect`/`position_m` + the closure/incident types; version-gated in the
schema `allOf`. **The migration mechanic is the ACCESSOR — `changes_of(artifact)` (py) /
`changesOf(artifact)` (ts); every consumer reads the normalized list, never `.change`.** Semantic
invariants live in the pydantic models; `dump_artifact` runs `audit_version_gate` (version↔shape).
b: the drawn roads ARE the simulation's roads — `network_export.py` exports the canonical net to
`web/public/network.json` (4,570 edges), the deck.gl BASE layer in all modes (basemap = CARTO
positron-nolabels); `/api/edges` serves eligibility METADATA only; `network.json` is the single
source of road pixels. Functional-plain styling deferred to V2.5.

**V2.1 (a–d) — COMPLETE (contract v0.6.0→v0.8.0; calibrated demand, assignment modes, seed
robustness, the compare view).**
- **a:** Toronto Open Data TMC sweep → `data/counts/` (126 AM-peak-supported interior intersections).
- **b (v0.6.0):** routeSampler-calibrated 07:00–09:00 demand (~67k travelers;
  `python/scenario/calibrated/`; provenance in `data/demand/`). GEH<5 accepted at **51.8% of 421
  links** — the 85% textbook target is structurally unreachable boundary-clipped;
  scenario-vs-baseline stays like-for-like. `meta.demand_profile` REQUIRED + `meta.render_sample`
  (calibrated artifacts cap RENDER to an outcome-stratified sample; outcomes/scorecard stay
  full-population). Calibrated-scale recording = `SpillRecorder`. Registry `demand_profiles.py`
  (synthetic stays byte-identical).
- **c (v0.7.0):** `--assignment settled` = duaIterate MESO iterations CARS ONLY per leg, then the
  micro pair on settled routes (`settle.py`; runtime changes get the patched net PLUS the TraCI
  apply, VERIFIED by readback). `meta.assignment` REQUIRED; settled ⇒ `scope:"cars_only"` ON THE
  WIRE (scope limitations ride the artifact, never a docstring). Deliverable: Kingston Rd 40 km/h
  day-one **+5.05 s** vs settled **+2.31 s** — adaptation absorbs ~half the shock.
- **d (v0.8.0):** `--n-seeds 3` probe pairs after the canonical pair. **Seed 42 IS the artifact**;
  probes contribute ONLY per-cell `range {min, max, n_seeds, sign_stable}` — no cross-seed central
  aggregate; settled probes REUSE the canonical settled routes (basis disclosed). HONESTY
  GENERALIZED: ANY sign-unstable cell renders ±magnitude everywhere (map / report / chat via the
  same helpers). `web/tests/fixtures/seeds-run.json` is REAL 0.8.0 aggregator output, drift-pinned.
  FINDING (3-seed calibrated batch): only the CYCLIST safety sign flips across seeds at calibrated
  congestion, while synthetic demand flips ALL safety signs; travel medians are seed-robust.
- **d-ii — ⇄ Compare (pure frontend):** two SLIM sides ({meta, scorecard} only), per-side provenance
  strips + the **PROVENANCE-MISMATCH GUARD** (assignment/demand/MECHANICAL change set/seed evidence;
  amber lines that inform, never block). Per-cell Δ renders ONLY where direction is claimable on
  BOTH sides; **SAFETY NEVER gets delta arithmetic**; the refused **"—†"** is glanceably distinct
  from plain-— absence. No aggregates / winner / recommendation, ever.
**V2.2 Steps a+b — the runtime CHANGE-SCHEDULER, closures, incidents, the response detour — COMPLETE
(no contract change; the 0.5.0 shapes went live).**
- **Scheduler (`change_scheduler.py`):** windowed changes APPLY at `window.start_s` / REVERT at
  `end_s` in-sim. Capture-before-apply per lane; restore via `setDisallowed` ONLY, assert restored ==
  captured. SUMO 1.27 permission facts probed live + encoded in the FakeConn (closure idiom =
  `setDisallowed(lane, ["all"])`; `getAllowed()` is ambiguous — never use it for closure checks).
  Same-edge windows must be LIFO-well-formed (crossing rejected at build AND at POST/spec-load).
  Unwindowed paths byte-identical; a window past sim end never reverts (disclosed in the proof log).
- **Closures + the rejection matrix:** lane_closure (`target_lanes` ⊆ car-lane indices, validated at
  POST and live) + road_closure; `--ignore-route-errors` on BOTH legs. Single source
  `assignment_rejection_reason` — IDENTICAL strings at POST (400) and harness (SystemExit):
  settled+windowed(any) and settled+severing rejected (duaIterate halts or silently drops unroutable
  trips). Settled + partial unwindowed lane_closure settles via the extended `patch_runtime_net`.
- **Incidents:** a CAPACITY event, never a crash simulation — `effect.blocked` and/or
  `effect.speed_factor` (combinable, one LIFO slot); `position_m` stored, unused (rung-2). TWO
  predicates split honesty: `invalidates_routes` (stranding surfaces; a speed-only incident never
  claims stranding) vs `capacity_event` (detour fact + temporary framing). Incident access cell =
  honest null. No crash/collision/accident wording anywhere (test-pinned).
- **Emergency-response detour (`response_probe.py` + `response_probes.json`):** free-flow
  fastest-path seconds (`getOptimalPath(fastest=True)`; NEVER `getShortestPath` — distance-only)
  baseline vs an in-memory during-window net; destination = first downstream junction with an
  ALTERNATE approach; unreachable = threshold (`cost > 1e39`), never float equality. BOTH honesty
  sentences (free-flow-not-dispatch framing + lower-bound) ride the payload and render wherever the
  numbers do; `verify_facts` enforces them + re-derives added_s. Computed ONCE per run
  (seed-independent).
- **Honesty surfaces:** windows render CLOCK TIMES on calibrated (`demand_profiles.fmt_sim_time`)
  and sim-seconds on synthetic, everywhere (voices, report closure block, run-state, chat corpus);
  `window_events` (the REVERT PROOF) + `non_completions` ride sidecar/run-state/RunStatus under
  `verify_facts`. Accepted live: `V22AACC2` lane_closure (935/19,804 diverted; revert proof on the
  live net) + a calibrated incident (917/20,137 diverted, honest-zero detour with notes, 0 crash
  words). **Gotcha (hoisted to Run commands):** long harness runs launch detached via PowerShell
  `Start-Process`.

**V2.2 Step c — closures + incidents in the EDITOR — COMPLETE (no contract change).**
- **Palette (`EdgePalette.tsx`):** Close lanes (picker over REAL `car_lane_indices`), Close road,
  Incident (blocked lanes and/or slowdown %; window REQUIRED; inputs in minutes → sim-seconds on the
  wire). Any windowed draft LOCKS assignment to day-one with the exact D1 sentence (server 400 stays
  the backstop). NO client descriptions — the server composes the canonical clock-time description.
- **Per-type overlays (`MapView.tsx`, first `@deck.gl/extensions` use):** hazard-stripe /
  red-barring / incident-marker overlays with **PLAYBACK TIME-TRUTH** (windowed overlays render ONLY
  within their window during playback); TextLayer badges need a STATIC characterSet (the en-dash is
  outside deck's default ASCII set — a data-derived charset breaks the font atlas). Test seam
  `window.__nadiChangeOverlay`; specs SEEK by scrubbing the Timeline slider (a raw setState seek
  races the rAF loop). RunCard window-chip via `web/lib/simTime.ts` (client mirror of
  `demand_profiles.fmt_sim_time` — keep in lockstep).
- **Non-completions SPLIT:** `baseline_only` partitions into `entered_not_finished` vs the
  causally-NEUTRAL `not_inserted` + `insertion_backlog` per mode. **INVARIANT (user-confirmed): the
  split never renders without the attribution parenthetical** — the backlog is STRUCTURAL (the
  V2.1b shortfall), not closure-caused. Sidecar + run-state + RunStatus + report (`verify_facts`
  recomputes) + chat corpus.
- **Probe set:** the detour origins are **4 REAL TFS stations** (Toronto Open Data, `_provenance` +
  retrieval date; drops/retirements documented in `_dropped`/`_retired`, which `load_probes` never
  reads). `origins_note` renders wherever the numbers do ("…do not indicate which station would
  respond"); the RunCard chip labels its statistic ("worst of {N} stations"); every honest zero
  carries its explanation. Prelim A: the nonzero detour live end-to-end (+48.7 s Markham entry,
  matching the test pin) on `…0725T030121Z`.

**V2.2 Step d — the SCHOOL ZONE (the first REAL multi-change scenario) + the V2.2 CLOSEOUT — COMPLETE,
TAGGED `v2.2` (no contract change).**
- **Composites:** the producer is list-native (`changes: list[Change]` + `tags`; unwindowed members
  loop apply+readback, windowed ride ONE ChangeScheduler; single-change runs stay shape-identical).
  Server: `POST /api/simulate {changes, tags}`; members speed_limit-only this step
  (`REASON_COMPOSITE_MEMBER`), settled+composite rejected; handoff = a
  `contract/runs/state/<run_id>.composite.json` spec file RE-validated by the harness (same reason
  strings). Review-caught BLOCKER fixed + pinned: `run_state.list_all()` must skip
  `*.composite.json` (its `*.json` glob 500'd `GET /api/runs`); the LIFO rule
  (`lifo_conflict_reason`) enforces at POST + spec-load, never mid-SUMO-run.
- **The ZONE LENS (`zone_lens.py`, tag-gated `school_zone`):** ped-vehicle crossing conflicts within
  25 m of ANY zone edge during the window, counted IDENTICALLY on both FULL conflict lists →
  `zone_facts`. **TWO HONESTY LOCKS (user-locked): `population_note` NAMES the measured population**
  ("pedestrian entities from the … demand — not modeled schoolchildren") **and `variation_note` is
  ALWAYS present** (small-n counts claim no direction) — the pair bypasses the CellRange machinery,
  so the caveat rides the numbers unconditionally; verify_facts pins both notes verbatim. Voices:
  ONE mechanical preface when tagged; parents react from OWN outcomes; never a child voice.
- **Frontend:** 🏫 zone-select mode (`ZonePalette`; D1 lock on entry); the zone TINT is ALWAYS
  visible (a designation, like signage) with the legend rule sentence, while playback time-gating
  covers ANY windowed item; RunCard `zone-chip`. **`changeSetKey` gains `window`, excludes tags**
  (presentation, not physics). Access truth: a speed-limit zone renders access ABSENT like any
  speed_limit run — the zone's story lives in the zone lens. Fixture
  `web/tests/fixtures/school-zone-run.json` is REAL producer output
  (regen: `python python/tests/test_school_zone_fixture.py`).
- **Accepted:** synthetic composite `…0726T235722Z` (3 revert proofs, 0-vs-0 zone pair with all
  notes, 212 voices, audit 0-unresolved). **The calibrated school-hours exemplar
  `multimodal-scenario-20260727T180728Z`** (--end 7200, ~6.5 h wall; selection committed at
  `data/schools/school-zone-exemplar.json` with full Open Data provenance): **zone pair 30 vs 28**
  — real calibrated counts, still small-n, the variation note doing exactly its job; the corridor
  GENUINELY SATURATES under calibrated AM peak (inflow > outflow all window; 72% of demand delivered
  by 09:00 — the V2.1b deficit measured directly). **PRECISION: the exemplar proves APPLICATION, not
  revert** (its windows ended at the sim ceiling, disclosed) — revert proofs come from the synthetic
  acceptance + the V2.2a/c live runs; never cite the exemplar as revert evidence. A first attempt at
  --end 9000 was ABORTED in a queue-spiral drain — the ops lessons (rerun shape, pace probing,
  restore-before-diagnose) are hoisted to Run commands. Detour-on-composites is UNIT-verified only
  (no palette composes a multi-change closure; recorded in BACKLOG).
- **V2.2 CLOSEOUT — the WINDOWED-SCOPE DISCLOSURE:** run-scoped scorecard vs window-scoped change,
  said out loud on EVERY windowed run: **`report.build_scope_disclosure(changes, sim_end, profile)`
  is the SINGLE SOURCE** — Section-2 line + caveat + chat corpus + `verify_facts` recompute-and-pin
  (REQUIRED iff windowed) + the ScorecardPanel scope note all read it, never re-derive. Span =
  `zone_lens.resolve_window`; display bounds CLAMP to [0, sim_end] on BOTH sides (review-caught: a
  window may legally end past the ceiling). UNWINDOWED reports render NOTHING new — byte-identical,
  pinned by `python/tests/golden_report_unwindowed.md` (the regen helper refuses a windowed source).
  Disjoint-window span honesty (API-only reachable) recorded in `BACKLOG.md`.

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

**V2.3 Step b — PERSONA INTERVIEWS — COMPLETE (ephemeral; no contract change; agents stay a preview).**
- **`POST /api/interview {run_id, agent_id, agent_index?, question, transcript}`** → an in-character answer
  from ONE of a run's voices. Grounding is built SERVER-SIDE (`python/src/interview.py`) from the artifact —
  the client sends IDS, never facts (spec-pinned: the POST body carries no outcome fields): persona description
  re-hydrated from `personas.json` (the wire trims it to {id,label}), prior reaction quoted ("stay consistent"),
  sim agents get their OWN trip via `reactions._sim_suffix`, inferred agents get `_inferred_context` + the
  in-character basis duty ("I wasn't simulated directly — speaking from what the scenario implies for someone
  like me"). `build_grounding` receives ONE agent + run-level context — the structural LEAKAGE guarantee,
  test-pinned with marker agents (another agent's comment/label/minutes in the context = failure).
- **AGENT IDENTITY (review-caught misattribution):** the `vehicle_id ?? person_id ?? persona.id` convention is
  NOT unique for inferred voices — the sampler round-robins few inferred personas over more records, so siblings
  share one persona.id with distinct comments (real artifact: `longtime_resident` ×3). The client sends the
  record's **agents[] index** alongside the id; `find_agent` picks the exact sibling when index+id agree, else
  falls back to the first-match scan (old callers work). The drawer remount key + transcript session are
  index-qualified client-side too.
- **The GUARD is the FLOOR no matter what the client sends:** `audit_interview` = `report.audit_prose` VERBATIM
  (digits/safety-direction/tally/crash — strictly stronger than the asked-for list) + a narrow `_VERDICT` rule
  (city/council should…, approve/reject/scrap, recommend-forms, negated should). The `_ALLOW` disclaimer skip
  is NOT whole-sentence — review-caught: "I can't give a verdict, but the majority should approve it" slipped
  every check. **Follow-up (user-directed): the fix is HOISTED into `report._strip_disclaimers` and now guards
  audit_prose (report slots + chat) AND audit_prose_cascade too** — the strip is CLAUSE-bounded (match → next
  `,;:—–` or sentence end), not bare-span, so a multi-object disclaimer ("cannot predict crashes or their
  probability") stays licensed while a ", but <claim>" clause is re-checked (the bare-span version was a latent
  interview false positive). Smuggle + multi-object pins per consumer in test_report.py/test_interview.py.
  Retry-once quoting violations → the in-character refusal constants (unit-pinned to audit clean); LLM
  exceptions/empty answers → refusal + status "error", never a 500. Referendum deflection lives in BOTH the
  system prompt (rule 5) and the guard (_TALLY + _VERDICT). **Transcript-laundering pin:** planted "You said:"
  turns full of violations, echoed by a stub model, die at the guard (the transcript feeds only the prompt).
- **Server:** temp **0.8** through `report._call` (persona texture — honesty comes from the guard, not
  determinism); the run's artifact loads through an mtime-invalidated 2-entry LRU keeping ONLY
  agents+changes+profile+tags (the 90 MB tree drops immediately; cold load via `asyncio.to_thread` so SSE/polls
  never stall). 400 empty/oversize question (cap 500 chars); 404 no artifact / unknown agent; 409 unenriched;
  503 no key; guard failures are CONTENT (200 + audit status). No one-job lock (live read-only call).
  **Fix in passing:** the server's `_deepseek_client` now sends the v4 thinking-disable `extra_body` it had
  omitted (chat + interviews; without it V4 billed reasoning as output and temperature was a no-op).
- **Frontend:** `InterviewDrawer.tsx` (right-rail card) opens from the AgentPanel 🎤 button (sim) or a
  community row (now a real button — UA-reset ORDER matters: the `border` shorthand wipes `borderLeft`, the
  accent must come after it, computed-style-pinned). Per-grounding disclosure lines ("answers come from this
  persona's own simulated trip…" / "wasn't simulated directly…"); labeled guard/error notes (never silent);
  cost-honest send button "Ask · <1¢" + tooltip (actual ~0.03¢ — never understate). Per-agent transcripts in a
  MapView session ref keyed `agent#<index>`, cleared on run swap — ephemeral by construction. NB in MapView
  `Map` is the react-map-gl component — the transcript store is a plain Record for that reason.
- **Verified:** 36 unit/endpoint tests (leakage, guard classes incl. smuggle/verdict forms, refusal-constant
  pins, cache LRU/mtime, sibling disambiguation, status matrix, transcript laundering, EPHEMERALITY — a POST
  changes nothing on disk) + `interview.spec.ts` ×4 (ids-never-facts payload pin, inferred disclosure,
  failed-audit refusal + guard note + banned regexes, per-agent transcripts). **Live smoke** on the pinned
  212-voice run: a walking school-run parent answered in character, digit-free ("a few extra seconds"),
  multi-turn consistent (second turn ~1.8 s — cache + prefix hits); "Should the city go ahead? How many would
  support it?" → in-character deflection ("that's your call, I can't speak for anyone else"); an inferred voice
  disclosed its basis and refused exact numbers; git tree clean after (nothing written).

**V2.3 Step c — the INSTITUTIONS SPEAK — COMPLETE (contract v0.9.0; mandate-grounded, facts-gated,
deterministic; agents stay a preview and institutions are NEVER impersonated).**
- **Contract 0.9.0 (additive; the full ceremony):** `grounding` gains `"mandate"`; Agent gains optional
  `mandate {institution, mission, source, retrieved}` + `citations [{key, text, notes[]}]`. Model invariants:
  no pin/outcome/trigger_t; mandate + non-empty citations REQUIRED; **sentiment 0.0 + stance "neutral"**
  (institutions recite facts within mandate, never stances — the referendum guard at the contract layer);
  sim/inferred may not carry the fields. Gates: obligation gates A/B/C/E extended, NEW pre-0.9.0 forbid gate
  (the range-gate properties idiom), `audit_version_gate` tuples extended INCLUDING the literal-`!=` trap at
  the range forbid (now `not in (…)`, regression-pinned), TS mirror + `sample_v0_9_0.json` + negatives both
  layers. Producer emits 0.9.0; **voices-enrich upgrades a 0.8.0 artifact to 0.9.0 even when NO institution
  speaks** (the honest empty-state gates on 0.9.0 and must be reachable on re-enriched runs); pre-0.8.0
  re-enriches stay untouched (mandates on one would exit loudly). **The pinned Playwright run
  `multimodal-scenario-20260702T044134Z` is STRUCTURALLY guarded** (V2.3c closeout): a voices/discourse enrich
  rewrites the artifact and breaks the spec + latest-report anchoring hours later — the server 403s it (before
  the no-state 404), and `reactions.py`/`propagation.py` SystemExit before any spend
  (`trajectory_io.PINNED_RUN_ID` / `guard_pinned_enrich`; deliberate re-pin only via
  `NADI_ALLOW_PINNED_ENRICH=1`, named in the refusal). `report` enrich stays allowed — it never touches the
  artifact and is the documented singleton-maintenance path.
- **The roster (`python/src/institutions.json` + `institutions.py`):** TFS / TDSB / City of Toronto
  Transportation Services (TTC deferred — nothing sim-grounded to stand on). Missions are VERBATIM quotes of
  the live pages (researched 2026-08-01, url + retrieval date in `_provenance`) — **byte-identity-pinned
  roster → artifact (`test_institutions.py`): the mission is never templated, truncated, or LLM-touched; for
  a real organization, paraphrase is misrepresentation.** Staleness: the retrieval date renders wherever the
  mandate renders (report, InstitutionPanel, interview grounding); re-verification duty in `BACKLOG.md`.
- **Facts gating (`institutions.speaks` — a PURE function of the sidecar, the single gate source):** TFS ⇔
  `response_detour`; TDSB ⇔ `zone_facts` (school-zone runs); ops ⇔ diversions > 0 OR non-completions with
  SIGNAL. Two live-acceptance catches, both pinned: **presence is not standing** (a closure smoke carries
  all-zero non_completions — `_has_signal` refuses purely-zero numeric trees; the 0-vs-0 zone pair and the
  honest-zero detour KEEP standing — their payloads carry the structural notes), and **origin labels derive
  from the probes' `represents`** (old sidecars carry the retired corridor-entry probes — calling them "fire
  stations" would misdescribe the data).
- **Generation is DETERMINISTIC (zero LLM calls, stub-pinned):** the sampler bakes the sidecar fact subsets
  into mandate records (appended AFTER inferred — index stability); reactions composes citations + the
  third-person mandate-lens comment code-side and streams them through the V2.3a plumbing unchanged.
  Citations LIFT the honesty sentences verbatim from the fact payloads (free-flow/lower-bound framing,
  origins note, zone variation/population/method notes, the backlog attribution parenthetical). Institutions
  never seed OASIS cascades (`propagation.build_nodes` skips + counts) and never enter `slot_synthesis` LLM
  prompts or `voice__` corpus docs (they get `institution__<id>` docs with the disclaimer).
- **Report:** a code-rendered `### Institutional perspectives (mandate lens)` subsection (mission verbatim +
  source + retrieved date + citation lines + notes) + the impersonation caveat ("not statements by, from, or
  on behalf of the named organizations"); the honest EMPTY state ("this run computed none for: …") renders
  ONLY on 0.9.0 runs with voices — pre-0.9.0 renders NOTHING (unwindowed golden byte-identical, test-pinned).
  `verify_facts` enforces the speaking set REQUIRED-IFF BOTH WAYS (TFS present iff response_detour; ABSENT on
  a quiet run), recomputes citation figures with verify-side literals, and pins the riding honesty sentences
  + the roster-verbatim mission.
- **Frontend:** pinned "INSTITUTIONAL PERSPECTIVES — MANDATE LENS" feed sub-block (never time-gated; mandate
  agents excluded from dots + the community synthetic clock) + the empty-state line; `InstitutionPanel`
  grounding card (mission + source link + retrieved + citations with notes + disclaimer + 🎤); ticker tag
  "— institutional (mandate lens)"; ReportPanel renders the JSON section; personaGroups maps institution ids
  to their own group (no scorecard→feed join hits). Interviews: `INSTITUTION_CONSTITUTION` (third person
  ALWAYS — never we/our/us), mandate+citations-only grounding, `INSTITUTION_REFUSAL` naming the free-flow
  limitation, mandate-only guard rules `_OPERATIONAL` + `_FIRST_PERSON` keyed on the SERVER-loaded grounding.
- **Accepted live:** closure run `…0725T025409Z` re-enriched → 213 agents, **TFS only** (ops silenced by the
  padding gate), honest-zero detour citation with both honesty sentences; report regenerated (audit 9 clean /
  0 corrected / 0 unresolved; institutional subsection + caveat; singleton restored). School-zone
  `…0726T235722Z` → **TDSB (0-vs-0 pair + all notes) + ops (2 diverted), TFS ABSENT**. A FRESH synthetic
  bike_lane run (`…0801T070538Z`) emitted **0.9.0 from the producer** (the ceremony's real-run acceptance),
  0 diversions → NO institutions and the honest empty-state line rendered live; a pre-0.8.0 quiet re-enrich
  stayed at its version (legacy path). Live TFS interview: "how many trucks would you dispatch?" →
  third-person refusal naming the free-flow limitation, clean first pass. Streaming: 214 total ticked live,
  institutional rows in the ticker + the pinned feed block + grounding card verified in the real UI.
- **The NONZERO station-set detour, end to end (the closeout loose end):** a windowed road_closure on
  `-36784353#20` (station 231's own origin edge — "the doorstep"; run `…0801T180640Z`) produced the phase's
  headline sentence on a REAL artifact: **"1 of 4 fire stations unreachable during the window; worst of the
  reachable +29.1 s added response-route time (232 +10.2 s; 234 +29.1 s; 243 +2.7 s; unreachable: Fire
  Station 231 (740 Markham Rd))"** with all three honesty notes riding — the first time the 2.2b number, the
  V2.2d station set, and the institutional voice met on one run (every earlier live citation spoke honest
  zeros from retired corridor-entry probes). The repro also caught the composer silently DROPPING unreachable
  rows while counting them ("worst of 4" listing 3) — fixed: unreachable origins are counted honestly and
  NAMED (mixed + all-unreachable shapes pinned; verify_facts recomputes the unreachable count verify-side).

**V2.3 Step d — the GRAPH SPLIT-VIEW — COMPLETE (V2.3 closed; no contract change — the sidecar is
off-contract like the report JSON).**
- **Exporter (`python/src/graph_export.py`, READ-ONLY by design — no pinned guard because it never
  touches the artifact; byte-pin test proves it):** OASIS half from `propagation.build_nodes` (SUMO-free;
  NEVER import build_graph) + the wire `social.graph.edges` + influence pairs from `influenced_by`
  (nodes-only) + per-agent exclusion METADATA `{count, rules}` (content never read into any output) +
  `nx.spring_layout(seed=42)`; entity half from the SERVED chat index's graphml (98 components / 64
  isolates → per-component spring + shelf packing with the honest "packed side by side, not force-laid
  into false adjacency" note; `<SEP>`-multivalued `file_path` split/dedup → `sources[:3]` +
  `source_count`). Sidecar naming `graphs-<ts>.json` NEVER matches the three `multimodal-scenario-*`
  artifact-discovery globs (fnmatch-pinned); web copy needs the `.gitignore` NEGATION for the pinned run
  (verified with plain `git check-ignore` exit 1 — `-v` prints negated matches and reads ambiguous).
  MERGE semantics: each enrich refreshes its half, preserving the other. IDEMPOTENT writes: identical
  content preserves `generated_at` (byte-identical), so pinned-run index maintenance never dirties the
  tree. Coverage carries `mandate_excluded` so the agents-vs-nodes gap is attributed honestly
  (institutions never enter cascades ≠ sibling-dedup — review-caught misattribution). Entity staleness
  legible THREE ways (unit-pinned): fresh (no note) / graphml predates the artifact (verbatim stale
  note) / mtime missing-or-nonsensical (`index_built_at: null` + the unknowable note — a clobbered
  mtime must never silently render "fresh").
- **Producer wiring (soft-fail both sites):** `propagation.main` after `assemble` refreshes oasis;
  `report_agent.build_index` after indexing refreshes entity; failures print the backfill CLI
  (`python python/src/graph_export.py --run-id <id>`, EXPLICIT id — no newest-run default), never
  re-invite a paid enrich. Deferred imports keep graph_export's dependencies acyclic.
- **Frontend (`GraphSplitView.tsx`; MapView mode `'graphs'`, 🕸 NEVER disabled):** two standalone
  imperative Decks under `OrthographicView({flipY: true})` on plain canvases (construct-once per
  bounds + `setProps`; a `position:relative` sized wrapper is REQUIRED — Deck repositions raw
  canvases; fit zoom = log2(min(w/bw, h/bh)) clamped **[-8, 10]** — the OASIS spring domain is
  [-1, 1] (fit ≈ 8) vs the entity shelf-pack's thousands of units (fit ≈ 0); a [-6, 6] clamp
  blob-ified OASIS, caught only by the live screenshot walk — seam counts can't see zoom).
  HONESTY RAILS: uniform node radius (degree sizing = a visual centrality leaderboard), group/type
  colors never stance, influence = dashed PathLayer + PathStyleExtension DISTINCT from follow-edge
  LineLayer, exclusion rings + hover "{n} post(s) withheld by the honesty audit: {rules}" (never
  content), `sheetMode = compare || graphs` hides map chrome, per-panel empty states name BOTH
  recovery paths, `stale_note` renders prominently + `index_built_at` always. Lazy sidecar fetch
  with functional-setter acceptance (an effect-cleanup `cancelled` flag would suppress the refetch
  its own rerun triggers); `loadRun` clears the cache so a just-enriched run refetches instead of
  keeping a sticky 404; `activeCascade` membership-checks against the loaded data. Seams
  `__nadiGraphs` (counts mirror) + `__nadiGraphsHover` (calls the REAL handlers).
- **Tests:** `test_graph_export.py` ×13 (determinism, read-only byte pin, sentinel-leak, merge both
  orders, packing disjointness, `<SEP>`/truncate, three-branch staleness, naming fnmatch, GRAPHS_BANNED
  over the sidecar text, mandate excluded-and-counted, idempotent byte-equality, phantom-edge filter) +
  `test_graphs_fixture.py` ×3 (OASIS half recompute-EQUALS the committed sidecar from the committed
  pinned artifact; entity presence+sanity only — the index lives outside the repo; excluded-content
  sweep) + `graphs.spec.ts` ×8 (headers/one-liner verbatim, cascade switch changes connectors while
  follow edges stay, exclusion hover rules + sentinel absent, empty states ×3 naming both paths,
  BANNED/STANCE_TALLY/GRAPHS_BANNED sweep, canvas===2, and the pinned NO-ROUTES smoke asserting the
  committed sidecar's EXACT node count read at runtime — the silent-never-landed catcher).
- **Accepted live (pinned run):** both graphs rendered (OASIS 205 nodes / 724 follow edges / 42
  exclusion-marked; entity 1328 nodes / 2378 edges, index fresh); cascade c1→c2 flipped connectors
  491→554 with follow edges constant; exclusion tooltip gave rules only; fresh no-sidecar run showed
  the labeled missing state verbatim. The entity-only mixed state is spec-only for now: every
  non-pinned index is ARCHIVED (the newest-index alignment practice), and an archived index is
  correctly NOT "the currently served chat index" — the exporter's absent-entity verdict on run
  `…0725T030121Z` was the honest behavior, not a gap.

**V2.4 Step a — the DRAFT BASKET — COMPLETE (frontend-only; no contract change; docs/v2.4-plan.md
D1–D2 ratified: apply INVERTS to add-then-run).**
- **The basket (MapView, session-only):** every palette apply + the new_road draw ADD a member
  `{id, change, valid, origin?, path?}` — the `change` object is BYTE-IDENTICAL to what the old
  fire-on-apply built (descriptions on speed/bike/new_road, none on closures/incidents), stored and
  later submitted BY REFERENCE. The zone flow is a MACRO adding N windowed speed_limit members with
  `origin:'zone'`; the school_zone tag DERIVES from origins (removing every zone member honestly
  drops it). Run wire rule: tag present → composite POST even 1-member (the server reads tags only
  there); else 1 member → today's EXACT `{change}` (deep-equal regression pin), N → `{changes}`.
  Success clears the draft; failure renders the 400/409 VERBATIM in `draft-error`, draft retained
  for edit-and-retry. Until V2.4b lifts REASON_COMPOSITE_MEMBER, a mixed multi-member draft 400s —
  the ratified interim (transitional rules `REASON_COMPOSITE_MEMBER`/`REASON_COMPOSITE_SETTLED` are
  deliberately NOT mirrored client-side; when b lifts them nothing needs un-mirroring). The draft
  survives run-switches/draw-another BY DESIGN (session state, visible for review before Run).
- **Blockers (`web/lib/draftBlockers.ts` — D2's STABLE set only, user-ratified):** client copies of
  `REASON_SETTLED_SEVERED` (severs(): road_closure always; lane_closure iff it closes EVERY car
  lane; missing eligibility → conservative false) + a line-faithful TS port of
  `lifo_conflict_reason` (phase constants 0/1, revert-before-apply at equal t, unwindowed members
  invisible). **The boundary is pinned on BOTH sides of the language boundary at the Python pin's
  own numbers** (A[100,500]+B[500,800] @ t=499/500/501): touching end==start is LEGAL — a >=-for->
  port typo would make a FALSE blocker the server backstop can NEVER catch (the draft never
  submits). `deriveBlockers` takes the EFFECTIVE assignment (post-D1-lock). `windowLocked` = the
  live palette signal OR any windowed MEMBER — the member term is why the palettes' unmount cleanup
  no longer drops a lock the draft owns. StrictMode catch: member ids mint OUTSIDE setState
  updaters (an impure ++ref inside one double-increments → d2/d4/d6).
- **DraftPanel (EditPanel rail, mounted last):** mechanical member summaries (RunCard chip
  conventions + `fmtWindowRange`, user-ratified over server-prose ports), per-member remove (clears
  matching hover + stale error), row hover → the map draft-overlay highlight in DARK slate — the
  review's screenshot caught the white highlight VANISHING on the near-white positron basemap
  (seam asserts can't see pixels); blockers render verbatim; Run disabled ONLY while a blocker
  exists / submitting. The draft overlay resolves `target_edge` via networkLookup (zero fetches;
  new_road members carry junction coords captured at add time), always active in edit mode.
- **Seams:** `__nadiDraftOverlay` {count, zoneTagged, hoveredId, items} — a SIBLING of
  `__nadiChangeOverlay` (whose count semantics stay untouched); `__nadiEligEdges` (the
  `__nadiNetworkEdges` convention) — flake-caught race: an edge pick before `/api/edges` lands
  snapshots `car_lane_indices: []` into the KEYED palette (no re-merge on late arrival) and the
  lane picker renders empty; specs gate picks on the seam.
- **Tests (`draft-basket.spec.ts` = 8 function pins + 6 e2e):** strings pinned as LITERALS (never
  constant-vs-constant — a tautological pin can't catch drift); mixed 3-member draft (draft-level
  D1 lock after the palette closes, hover seam, remove, composite POST membership `.sort()`ed);
  single-change deep-equal pin; settled+severed toggles (incl. the all-car-lanes lane_closure
  variant); LIFO crossing blocked + nested/touching legal (UI half at minute granularity, the
  second-sharp half as page-less function tests); zone macro = NO POST until Run; 400-verbatim +
  draft survives. The 4 apply-driving specs (closure-palette, edit, seeds, school-zone) each gained
  ONE `draft-run` click with body assertions byte-identical — that IS the pin; closure-palette's
  400 assertion moved `palette-error` → `draft-error`. Suites: **419 pytest (untouched) + 67
  Playwright**. Follow-up (user-directed, landed): the error-verbatim case pins the PERMANENT
  one-job 409 template, not the transitional REASON_COMPOSITE_MEMBER (a mocked error stays green
  after its server string dies — pin only permanent shapes); the 2 inherited eslint react-hooks
  errors were CLASSIFIED and resolved (graphsSidecar kick-off setState → queueMicrotask, the
  in-file `?compare=` precedent; the interview transcript ref+tick hack → a plain state record —
  the manual re-render tick was papering over a render-time ref read). `npm run lint` exits 0.
- **Dormant for V2.4b:** `submitError` is now permanently null into the palettes/DrawForm (every
  Run error routes through `draft-error`) — strip the dead plumbing when b touches these files.

**V2.4 Step b — the CLOSURE COMPOSITE runs for real — COMPLETE (no contract change; both dormant
honesty paths production-exercised; docs/v2.4-plan.md D2/D3 landed).**
- **The lift:** composite members = `WINDOWABLE_TYPES` exactly — the REPLACED single-source
  `REASON_COMPOSITE_MEMBER` names bike_lane (one shared target_lane threads the whole pipeline) and
  new_road (regenerated network) as non-composable, anti-drift-pinned against the tuple;
  `REASON_COMPOSITE_SETTLED` STAYS (the settle path hard-asserts len==1). Per-member rejection
  matrix at BOTH layers with the shared strings (`change {i}: ` at POST, `composite change {i}: `
  at spec-load, which now reads the net — cached `_spec_net()` — for edge existence/car-lane
  subsets/incident effects; a bad member dies as a clean SystemExit, never a mid-run KeyError).
  **The serializer is a per-type ALLOWLIST** — `model_dump(exclude_none=True)` would leak
  SimChange's non-None new_road defaults into every member, and the old serializer hardcoded the
  speed_limit shape (silently DROPPED target_lanes/effect) — mixed-handoff-pinned. Mixed run
  description: `"N changes on the corridor"`; the school-zone label gains an all-speed_limit guard.
- **Dormant path 1 (scorecard composite-null), production-first:** the note names BOTH counts —
  `"composite scenario — {contributors} of {changes} changes affect this group's access; not
  separable yet"` (user-ratified; "(3 changes)" would overclaim which members were unsummable) —
  and FIRED live on run `…20260810T201735Z` (2 unwindowed lane_closures via the basket; scorecard +
  report; audit 5 clean). Newly-reachable branches pinned: exactly-one-contributor renders the real
  ordinal + "rule-based estimate"; zero-contributor mixed composites take the FIRST
  `_NULL_WITH_NOTE` member's note (order-dependent BY DESIGN, commented + pinned).
- **Dormant path 2 (detour multi-member exclusion), production-first:** run `…20260810T200300Z`
  (basket draft: road_closure `-36784353#20` 600–1200 + permanent speed_limit `-1288863201` +
  factor-only incident `-1288863202#6` 600–1680) — the destination rule ran CLEAN on its first
  real 3-edge exclusion (primary branch, 0 hops; no fallback, no uncomputable note); doorstep
  Station 231 honestly UNREACHABLE during the window, 232 +10.2 / 234 +29.1 / 243 +2.7 s. The
  payload now LOGS the estimate's shape: `modified_edges` (sorted union), `destination_anchor`
  (changes[0]) and — iff multi-member — the ORDER-DEPENDENCE note (`"destination anchored to the
  first change; with multiple modified edges this choice is arbitrary and affects the estimate"`),
  all verify_facts-pinned (conditional on key presence — old sidecars legitimately lack them).
  **speed_limit members now shape the during-window net** (same hasattr-guarded SUMO-1.27 `_speed`
  poke; an unapplied slowdown under-reported added_s while its edge sat in the exclusion set);
  `compute_response_detour` applies ALL members. Zero-note PRE-READ verdict held (the user gate):
  the acceptance shape's `blocked_only` is False → the route-avoidance sentence, TRUE post-fix;
  the singular "the changed road" on multi-edge composites is awkward-not-false → BACKLOG rung-2.
- **Span + chips:** `build_scope_disclosure` needed NO change (differing windows + the
  windowed-subset subject were ready); the CLIENT reached lockstep — `windowedScope` feeds the
  ScorecardPanel note the differing-windows clause (client copy of `zone_lens.span_note`) + the
  mechanical subject, live: *"measures cover the full run; windowed changes active t=600–1680 s
  (members carry differing windows; these figures use the spanning window)"*. RunCard chips are
  `status.changes`-driven: the window chip is SINGLE-change-only (member-0 chips misdescribed
  composites), untagged multi-member runs get the mechanical composite chip (`"N changes · active
  {span}"`), zone-chip precedence kept; **the split's backlog-attribution parenthetical now rides
  the RunCard too** (the V2.2c chip exemption ENDED, user-ratified — the invariant holds on every
  surface). Done-stage run-state keeps `changes` when tags are present (the 1-member tagged
  composite's zone chip died at done — fixed in passing).
- **Acceptance notes:** the ratified draft's "windowed speed limit" was adjusted to PERMANENT —
  the EdgePalette's speed_limit is unwindowed BY DESIGN (windowed speed limits are the zone
  macro's tagged shape); the windowed-subset subject rule got exercised instead (disclosed, richer
  coverage). TFS's mixed-composite citation: "1 of 4 fire stations unreachable during the window;
  worst of the reachable +29.1 s…" (214 agents, ops on 5 diversions, TDSB absent). Reports
  regenerated with explicit --run-id; the latest-report singleton RESTORED after each (V2.1
  practice). Screenshots: `docs-assets/v24b-*.png`. Suites: **429 pytest (+10; 1 pre-existing
  environmental skip) + 69 Playwright (+2)**.

## Run commands
SUMO: `export SUMO_HOME="/c/Program Files (x86)/Eclipse/Sumo"` (not on PATH). Python = base miniconda.
- **Editor / job-runner (Phase 5 — the PRIMARY flow; the server FRONTS the pipeline):**
  ```bash
  cd python/src && uvicorn server:app --port 8000  # API: /api/junctions /api/edges /api/simulate /api/runs[/<id>/status|/enrich|/enrich/stream] /api/report /api/chat /api/interview
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
  (V2.4b: members may be any of the four windowable types; settled+composite rejected; the harness
  re-validates against the net). Zone-edge
  selection for the exemplar: `python python/src/school_zone_select.py` → `data/schools/`. Compare two finished
  runs at `http://localhost:3000/?run=<A>&compare=<B>` (or the ⇄ Compare toggle) — pure frontend, only needs
  `/api/runs` for the pickers.
- **Bounded-calibrated convention (V2.1):** calibrated runs are bounded to the peak hour by launching the SERVER
  with `NADI_MAX_T_OVERRIDE=3600` in its environment (the harness subprocess inherits it); the school-window
  exemplar shape is `NADI_MAX_T_OVERRIDE=7200` (measure the full zone window, skip the un-drainable tail —
  --end 9000 entered a queue-spiral drain once). **HARD-GATE every bounded launch**: check the live `sumo.exe`
  command line carries the `--end` (WMI `Win32_Process`) — server-env-set and subprocess-inherited are different
  facts, and unbounded calibrated is the multi-hour-per-leg wedge regime. **The default server state is NO
  override** — a bounded server silently truncates synthetic runs; after calibrated work, ALWAYS relaunch
  without it (the `[demand-profiles] NADI_MAX_T_OVERRIDE` print must be absent), unconditionally on the run's
  outcome — override-restore runs STRUCTURALLY FIRST on return, before diagnosis. **Wall-clock does not
  extrapolate across run shapes** (four data points disagreed): probe the shape you will actually run (plain
  headless sumo pace probe; sample sim-pace from the tripinfo tail before trusting any ETA); monitors key on
  HARNESS PROCESS liveness, never run-state age (stages are silent for a whole leg). duaIterate gotchas: it
  already passes `--time-to-teleport`/`--no-step-log` (re-passing = hard "already set" error); pass `--no-gzip`
  or per-iteration routes come back gzipped; one bounded calibrated meso iteration ≈ 27 s. Long-run guards:
  keep-awake scripts at `%LOCALAPPDATA%\nadi-demand\keepawake{,-8h}.ps1` (user-approved; auto-sleep mid-leg once
  cost a day); detach the server AND long harness runs via PowerShell `Start-Process` (bash/subagent-shell
  children die with the shell's job object — one acceptance run died silently mid-leg that way). Scratch:
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
- **Graphs sidecar backfill (V2.3d):**
  ```bash
  python python/src/graph_export.py --run-id <id> [--half oasis|entity|both]   # EXPLICIT id — no newest-run default
  ```
  Regenerates `contract/runs/graphs-<ts>.json` + `web/public/<run_id>-graphs.json` (read-only over the
  artifact + the SERVED chat index; merge preserves the other half; idempotent — byte-identical on no-op).
  The COMMITTED pinned sidecar (`web/public/multimodal-scenario-20260702T044134Z-graphs.json`, gitignore-
  negated) regenerates with `--half oasis`: its entity half is a frozen snapshot, because non-pinned indexes
  are ARCHIVED and an archived index is correctly NOT "the currently served chat index" (absent entity ≠ a
  bug). The discourse/report enriches refresh their halves automatically (soft-fail → this CLI is the
  recovery path, printed by the failure message and named in the split-view empty states).
- **OASIS social spike** (Phase 4.0; the `oasis` conda env — python 3.11, camel-oasis 0.2.5, NOT base):
  ```bash
  conda run --no-capture-output -n oasis python python/src/oasis_spike.py   # -> contract/runs/oasis-spike-<ts>.json
  ```
- **Frontend:** `cd web && npm run dev`  → http://localhost:3000  (open 📄 Report → "Ask the report")
- **Tests:** `python -m pytest python/tests` (429 tests + 1 environmental skip: golden spine + contract
  0.6.0–0.9.0 sections + seed-range/report honesty invariants + the unwindowed-report golden + the V2.3a
  enrich-events/builder/SSE sections + the V2.3b interview grounding/guard/endpoint sections + the V2.3c
  institutions roster/gating/composition/verify sections + the V2.3d graph-export/fixture sections + the
  V2.4b composite-matrix/probe/scorecard sections) and
  `cd web && npx playwright test`
  (69 tests across 16 spec files incl. seeds, compare, school-zone, scorecard-scope, enrich-stream,
  interview, institutions, graphs, draft-basket, composite-runcard). **Dev-only Playwright
  hazard:** a TINY fixture artifact can resolve inside React StrictMode's double-mount window and fatally crash
  maplibre teardown (the dev overlay eats the app) — specs delay fixture routes ~500 ms + warm-reload once
  (documented in `compare.spec.ts`); production builds and real artifact sizes never hit it.
