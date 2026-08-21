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
  format hook's prettier leg was REMOVED in V2.5a (hazard CLOSED: it was armed-but-configless and
  one npx-cache seeding away from rewriting edited web files to prettier defaults). eslint owns
  the TS leg. Don't re-add a prettier leg without landing a real config first.
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
  **BASELINE SHIFT (2026-08-19):** the guard TIGHTENED again (the V2.6 follow-up — `_CLAUSE_BOUNDARY` gained
  the coordinating adversatives `but|yet`, closing the comma-less-conjunction smuggle for ALL consumers at
  once: report slots, chat, cascade, interviews, the room) — a modest corrected-on-retry uptick on the next
  natural regen is EXPECTED from the guard change, not model drift; **the next regen's count is the new
  baseline's FIRST READING, not a deviation from the old one.** The boundary set is deliberately MINIMAL:
  and/or are never boundaries (a multi-object disclaimer — "cannot predict crashes or their probability" —
  must stay whole), and though/although/however are excluded too (review-caught on a five-word draft: they
  commonly CONTINUE a disclaimer — "crashes however unlikely the probability" false-flagged as crash talk).
  Every exclusion is pinned mutation-effective; the excluded-connector smuggles are the accepted residuals.
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
- **V2.4: the DRAFT BASKET is the editing model** (apply ADDS a member, one Run submits; clone-to-
  draft iterates) and **composites are MIXED-TYPE** (members = the four windowable runtime types;
  settled composites stay rejected) — details in the V2.4 blocks below.
- Use Plan Mode for any non-trivial change: present the plan + files to touch, wait for approval.
- Small commits.

## Current phase
**CURRENT STATE (the rollup — everything below this box is the per-step historical record):**
Contract **v0.10.0**. Phases 0–5 and V2.0–V2.5 are COMPLETE: the ✏️ editor fronts the whole pipeline
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
attributed honestly (institutional exclusion ≠ sibling-dedup). **V2.4 IS CLOSED and TAGGED
`v2.4` (scenario composition — no contract change all phase):** the DRAFT BASKET is THE editing
model — every palette apply + the zone macro ADD members to a session-only draft, one Run submits
(single-change wire shape regression-pinned; draft-time blockers mirror the shared reason strings,
the LIFO port boundary-pinned at the Python pin's own t=499/500/501 numbers), and ⧉ clone-to-draft
iterates any past run (cross-version, zone-tag reconstructed, name/note never copied). COMPOSITES
ARE MIXED-TYPE: members = the four windowable runtime types, per-member rejection matrix at POST +
net-grounded spec-load, a per-type allowlist serializer; settled composites stay rejected. Both
V2.2d-era dormant honesty paths have PRODUCTION SIBLINGS: composite-null (unit pins
test_composite_harness/test_network_edit ↔ live run `…20260810T201735Z`, the both-counts note in
scorecard + report) and the detour's multi-member exclusion (unit pin test_response_probe ↔ live
run `…20260810T200300Z` — clean primary-branch destination on the 3-edge union, doorstep Station
231 unreachable, worst reachable +29.1 s; `modified_edges` + `destination_anchor` + the
arbitrariness `anchor_note` logged, rendered in the report, verify-pinned; TFS spoke the composite
citation). Runs carry an optional user name/note in the IDENTITY SIDECAR
(`state/<id>.identity.json`, endpoint-only writer — race-free vs the harness's unlocked set_stage
BY CONSTRUCTION, rename-mid-run test-pinned) with the pinned-run guard extended to identity writes
and injection inertness pinned end-to-end; names render on RunCards + every runLabel picker, ids
stay canonical everywhere else. The calibrated windowed-closure composite is a DEFERRED exemplar
candidate (BACKLOG — synthetic acceptance stands). **V2.5a IS CLOSED (the disclosure batch):**
window-coincidence disclosure on the detour (single-sourced, REQUIRED-iff, riding report + TFS
citations + corpus), the honest-zero note pluralizes from the edge union, the disjoint-span clause
rides the scope disclosure both sides, the institutional chat index PROVEN LIVE (+ the
singleton-drift forensic finding — see the V2.5a block), the producer-real 0.9.0 institutions
fixture retired the drifted hand-mock, and the prettier hook leg is REMOVED (hazard closed).
**V2.5b IS CLOSED (rung-2 response reachability):** end-node probing REPLACED the anchor walk —
per capacity member × per segment end × per station, min-over-approaches per net, labeled causal
states verify-RECOMPUTED (origin-closed / window-unreachable / baseline-unreachable /
no-approach / honest-zero), aggregated citations + the ends-counting chip, legacy sidecars
byte-identical via shape-keyed branches, the vocabulary split pinning the cross-vintage
incomparability, accepted live on the doorstep-composite rerun (east end +1.7 s vs west end
+29.1 s — the direction answer; 231's origin-closed CAUSE). Suites: **470 pytest + 77 Playwright**.
**V2.5c IS CLOSED (the two-jobs fix + the frame budget):** latest.json is a POINTER only (written
on quant completion only — enriches never repoint; the accidental-repoint footgun class closed),
every spec routes its own pointer pair (DOUBLE acceptance: the 90 MB pointer AND the DELETED
pointer both leave the suite green 76/76), and perf is measured-first with budgets — the headless
0.36 FPS "catastrophe" unmasked as SwiftShader (frame numbers are HEADED numbers or they measure
the rasterizer), the one indicted fix (trails data-identity memo) A/B'd 48→74 fps on the 90 MB
exemplar, everything else measured NOT-indicted and deliberately unbuilt. Budgets (headed, prod):
nav→first-artifact-render ≤5 s @90 MB (3.9 achieved), ≤2 s @~20 MB (1.1); playback p95 ≥30 fps (71 achieved).
**V2.5d IS CLOSED (the presentable core) — V2.5 IS CLOSED and TAGGED `v2.5`:** a STATIC read-only
demo build (`output:'export'` behind `NEXT_STATIC_EXPORT`; `scripts/build-static-demo.mjs` prunes
to a 43.9 MB bundle — the pinned triple + the committed modern run
`multimodal-scenario-20260814T063253Z`, every file <25 MiB for Cloudflare Pages; dead controls
render DISABLED-WITH-WHY via the single-sourced `DEMO_READONLY_NOTE`, never clickable-then-failing;
the landing page's one unlabeled failure became the labeled `artifact-load-error`, spec-pinned on
404 + malformed shapes), stranger-facing setup docs (SETUP.md + python/requirements.txt +
.env.example), the README rewritten for the cold 90-second reader (pre-computed AND real said
plainly; the three computed facts carry their riding caveats verbatim; the fire-station fact
speaks ONLY the V2.5b per-end vocabulary, verified against the committed run's TFS citation),
curated screenshots looked at before commit, and DEPLOY.md (the CF click is the user's).
Suites: **471 pytest + 79 Playwright**.
**V2.6a IS COMPLETE (the group-interview ROOM, server-side):** `POST /api/group-interview` — 3-5
voices answer one question SEQUENTIALLY in refs order, each hearing the others' ACTUAL WORDS only
(grounding per speaker via the UNCHANGED builder — the leakage matrix pinned at both layers;
institutions never gain traveler records); the ROOM-ONLY `cross_participant` guard rule with
per-speaker keying + a CONJUNCTION-AWARE disclaimer strip (review catch — a comma-less "but
everyone here agrees" rode the licensed disclaimer clean); refusals are answers, a room never
aborts; every audit dict now carries `calls` (the V2.6b cost-label input). Ephemeral, no contract
change. Suites: **522 pytest + 79 Playwright**. **V2.6b IS COMPLETE (the room in the UI — V2.6 IS
CLOSED):** rooms assemble from trailing ＋ buttons on every feed row kind + 👥 panel buttons
({agent, index} pairs resolved ONCE by reference); the RoomDrawer rail card shows per-participant
grounding sentences (the shared `GROUNDING_SENTENCES` export), a speaker-labeled thread with
per-answer guard notes, the D3 curation note ("voices you picked… not a poll or a sample of
opinion"), and the never-understating cost pair (estimate + hedged actuals); transport = the
RATIFIED `speak` param (per-speaker sequential fetches — answers render as each resolves, the
thinking row on the CURRENT speaker, a failed slot retries without killing the room, a
synchronous ref gate kills double-POSTs); the doctored-prefix pins prove the client-assembled
transcript can't reach grounding or forge attribution. Suites: **528 pytest + 88 Playwright**.
**The V2.6 FOLLOW-UP closed the SHARED disclaimer-strip conjunction hole** (user-ratified baseline
decision): `_CLAUSE_BOUNDARY` carries the adversative conjunctions for every consumer, the V2.6b
room fork is DELETED (byte-identity confirmed first; room tests green unmodified), per-call-site
pins landed, the and/or residual is pinned as a decision, and the audit-retry BASELINE SHIFT is
recorded beside the 2026-07-31 precedent. Suites: **530 pytest + 88 Playwright**.
**V2.6c IS COMPLETE (the 0.10.0 CEREMONY — the payload rung PAID):** per-entity EITHER-shape
timestamps ({t0, dt} XOR explicit — teleport holes kept TRUE), speeds DROPPED (worst_t rides the
outcomes sidecar; SpeedsUnavailableError is the named backstop), 6-dp coords at record time,
new_road.via as refused contract capacity; the full gate ceremony (A/B/C/E extended, NEW J/K,
audit tuples, samples + negatives both layers, pin-relax); the TS reader normalizes ONCE per
entity-array identity (__nadiRenderStats counts both shapes; the memo keyed off [artifact] was a
review catch — the voice stream would have re-allocated every compact array per voice). MEASURED
on the 90 MB exemplar (headed): gzip 26.9→7.6 MB (-72%), parse 3.3→1.4 s, nav→render 3.7→1.8 s,
heap 189→90 MB, frames identical. Live acceptance end-to-end incl. a mandate voice at 0.10.0;
golden refreshed; committed fixtures stay at their vintages (the back-compat proof). Suites:
**556 pytest + 91 Playwright**.
**THE RESOLVER-FAMILY FIX (2026-08-21):** the twice-fired lexicographic newest-pick bug is DEAD
family-wide — `trajectory_io.newest_ts_named` (digit-first; junk warned by name; junk-only exits
loudly naming the flag; CLI/subprocess-contained severity) backs newest_instrumented /
newest_outcomes / report._resolve / scorecard._resolve / robustness + the golden picks;
`newest_index` is ALIGNMENT-FIRST (latest-report's run → its index; the V2.5a drift class dead
structurally); run_state.list_all orders junk LAST (inventory, never filtered); settle's
iteration dirs sort NUMERICALLY (string-sort took iteration 9 of 0..11 — the V2.1c settled
deliverable's re-verification decision is OPEN in BACKLOG). Both old fix candidates were
counterexampled (strptime by the SEED1 probe; mtime by OneDrive resync). Suites: **567 pytest +
91 Playwright**.
Open threads: **V2.7 network styling** + `BACKLOG.md` (bbox expansion, student demand, mandate
re-verification, the calibrated composite exemplar, the settled-basis re-verification, per-window
probing at rung 3, the V2.7 legacy-fallback removal, new_road.via runtime threading, the room's
prompt-side sibling-label ambiguity — its UI half closed in V2.6b).
**Deployment handoff (2026-08-17):** the static demo bundle is BUILT and smoke-verified at
`v2.5` (`node scripts/build-static-demo.mjs` → `web/out/`, 43.9 MB — untracked build output,
regenerate freely) but **NOT yet deployed** — the Cloudflare Pages click is the user's
(DEPLOY.md has the wrangler commands). When the live `*.pages.dev` URL exists, it replaces the
"deploy in flight" placeholder in README "See it live" — the ONE pending README edit,
deliberately blocked on the deploy. `main` + all five annotated tags (v2.2–v2.5) are pushed to
origin as of this handoff.

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
source of road pixels. Functional-plain styling deferred to V2.7.

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
  day-one **+5.05 s** vs settled **+2.31 s** — adaptation absorbs ~half the shock. **(NB 2026-08-21:
  the settled BASIS is under re-verification — the pre-fix iteration sort took iteration 9 of 0..11,
  not the last; see BACKLOG's settled-basis entry. The direction of the finding is not in doubt.)**
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
- **Ops note (hazard CLOSED in V2.5a, removal CONFIRMED LIVE 2026-08-14):** `.claude/hooks/format.py`'s prettier
  leg was ARMED-BUT-CONFIGLESS — any `npx prettier` run seeded the npx cache and the PostToolUse hook then rewrote
  edited web files to prettier DEFAULTS (no repo config exists; cost a 231-line accidental reformat, reverted).
  The leg is REMOVED (eslint stays), proven by the cache-seeded probe check (seed → divergent single-quoted .ts
  through the live hook → byte-identical → cache restored). NB the activation-lag caveat covers settings.json
  REGISTRATIONS only; a registered command's script body is re-read every invocation.

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
  second-sharp half as page-less function tests); zone macro = NO POST until Run; error-verbatim +
  draft survives (re-pinned to the PERMANENT one-job 409 in the follow-up — a mocked transitional
  400 would have stayed green after V2.4b deleted its string). The 4 apply-driving specs (closure-palette, edit, seeds, school-zone) each gained
  ONE `draft-run` click with body assertions byte-identical — that IS the pin; closure-palette's
  400 assertion moved `palette-error` → `draft-error`. Suites: **419 pytest (untouched) + 67
  Playwright**. Follow-up (user-directed, landed): the error-verbatim case pins the PERMANENT
  one-job 409 template, not the transitional REASON_COMPOSITE_MEMBER (a mocked error stays green
  after its server string dies — pin only permanent shapes); the 2 inherited eslint react-hooks
  errors were CLASSIFIED and resolved (graphsSidecar kick-off setState → queueMicrotask, the
  in-file `?compare=` precedent; the interview transcript ref+tick hack → a plain state record —
  the manual re-render tick was papering over a render-time ref read). `npm run lint` exits 0.
- **Dormant plumbing (still standing at V2.4 close):** `submitError` is permanently null into the
  palettes/DrawForm (every Run error routes through `draft-error`) — strip whenever these files
  are next touched.

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

**V2.4 Step c — CLONE-AND-TWEAK + RUN IDENTITY — COMPLETE (no contract change; the artifact stays
the simulation record, the workspace lives in a sidecar).**
- **Clone-to-draft (`RunCard` ⧉ → `MapView.cloneToDraft`):** any finished run's `changes[]`
  (`status.changes ?? [status.change]` — single-change runs carry only the singular) REPLACES the
  draft as fresh members (bulk id-mint outside setState — the zone-macro StrictMode idiom);
  `origin:'zone'` is reconstructed on every member iff the run is school_zone-tagged (without it
  runDraft's tag derivation silently drops the tag → description branch + zone lens change);
  runOptions (demand/assignment/seeds) restore; `setActiveRunId(null)` is LOAD-BEARING (the
  DraftPanel is gated on !activeRunId). Name/note are NEVER copied (D4: a new scenario earns its
  own). Cross-version pinned against the REAL 0.8.0 school-zone fixture. Disclosed limits: cloned
  new_road members get no draft overlay (path captured at add-time only) and 400 verbatim inside a
  multi-member draft.
- **Identity (`state/<run_id>.identity.json` — the THIRD file class under list_all's one glob,
  coexistence-pinned):** `run_state.identity/set_identity` — FULL-REPLACE, trim, both-empty
  DELETES the sidecar; exactly ONE writer (`POST /api/runs/<id>/identity`) so it is race-free
  against the harness's unlocked read-merge-write `set_stage` BY CONSTRUCTION (rename works
  mid-run; state-file purity pinned: set_stage never carries name/note, the sidecar survives state
  rewrites). STATE_DIR reader audit (user fold-in): list_all is the ONLY glob reader; every other
  access is exact-path — checked, not assumed. Server: pinned 403 FIRST (sibling
  `PINNED_IDENTITY_REASON`/`pinned_identity_blocked`, same env override, byte-pinned across
  python + the Playwright copy) → 404 → caps on TRIMMED values (`name too long (N > 60 chars)` /
  `note too long (N > 500 chars)`) — the SERVER caps are the enforcement (client maxLength is
  convenience); markup stored VERBATIM — inert RENDERING is the single deliberate defense,
  pinned end-to-end on BOTH surfaces (RunCard `run-name` + the picker `<option>`) so any future
  name-rendering surface inherits a failing test.
- **Render surfaces:** `runLabel` (RunSwitcher — the one label function for the edit rail + both
  compare pickers) gives the name precedence over the mechanical description, 40-char-truncated;
  name-LESS output is BYTE-IDENTICAL (zero ripple, proven by running school-zone/edit/draft-basket
  unmodified). RunCard: `run-name`/`run-note` + the rename affordance (`rename-toggle` →
  name/note inputs → save merges the response into LOCAL status — the poll has stopped on
  terminal runs and would never repaint otherwise); errors verbatim incl. the pinned 403.
  CompareView's ProvenanceStrip stays id-canonical (it reads the artifact).
- **Tests:** `test_run_identity.py` ×8 (sidecar semantics, list purity + state purity, guard
  matrix + reason surfaces, endpoint round-trip/clear/caps-exact/markup-verbatim/403-before-404)
  + the three-file-classes glob regression widened; `run-identity.spec.ts` ×4 (cross-version
  clone → edited POST differs with the tag surviving; rename card+picker+reload; pinned refusal
  verbatim — byte-compared against the python constant; injection inert on both surfaces). Live
  smoke: renamed the V2.4b acceptance run (sidecar appeared, list+status merged, state file
  clean), pinned rename 403'd. Review fixes folded in: `identity()` guards non-dict JSON (the
  read() bug class — one damaged sidecar 500'd the whole list, four shapes pinned), the mid-run
  rename claim is TEST-pinned (200 while try_acquire holds), UI clear/note-only cases pinned,
  DraftPanel's lane summary optional-chained. Suites: **439 pytest + 73 Playwright**.

**V2.5 Step a — disclosure and wording debts — COMPLETE (no contract change; every payload key is
sidecar/off-contract and every sentence lives in existing free-form fields).**
- **Item 1 — the WINDOW-COINCIDENCE DISCLOSURE:** `response_probe.WINDOW_COINCIDENCE_NOTE` +
  `window_coincidence_note(changes)` (single source, `str | None`): fires iff >1 member AND >1
  distinct window among WINDOWED members — one windowed member + permanents is EXACT (every member
  genuinely active during the one window), while two distinct windows + a permanent member
  DELIBERATELY fires (the two windows alone overstate constraint; pinned with its own case so the
  choice is explicit). Rides the payload → report Section-1 (after anchor_note), LIFTS into TFS
  citation notes (framing stays `notes[0]` — compose_comment rides it), reaches the chat-corpus
  `response_access` doc. verify_facts: recompute-and-compare, ALTERED-or-SPURIOUS fails, ABSENCE
  TOLERATED — review-caught BLOCKER fixed: the gate key `destination_anchor` is unconditional
  since V2.4b, so a V2.4b-vintage sidecar (the acceptance run `…20260810T200300Z`!) enters the
  gate while legitimately lacking the new key, and a full REQUIRED-iff made its report
  unregenerable; with no same-vintage marker to gate on, the producer pin (the note is emitted
  unconditionally when owed) owns the "missing" direction. Vintage shape verify-passes,
  test-pinned; + the citation-riding check ("must ride the citation"). Keyless payloads render
  NOTHING new anywhere (golden safe). LESSON (joins the anchor_note precedent): a REQUIRED-iff
  gate must key on a marker of the SAME VINTAGE as the required key — an older sibling admits
  every run between the sibling's birth and the key's.
- **Item 2 — the honest-zero note PLURALIZES from the edge union:** noun+verb from
  `len(modified_edges)`, never `len(changes)` — two members can share one edge and the sentence is
  about roads; the divergence shape (2 members, 1 shared edge → singular) has its own pin,
  mutation-checked against a member-count-driven variant. `destination_note` strings untouched
  (rung-2's problem, BACKLOG).
- **Item 3 — the DISJOINT-SPAN CLAUSE:** `zone_lens.DISJOINT_SPAN_CLAUSE` ("the spanning window
  includes periods where no change was active") + `windows_disjoint(changes)` — ALL members
  windowed AND the merged union leaves a gap; a permanent member fills gaps (mixed sets never get
  the clause — it would be false); touching windows contiguous (the LIFO boundary convention).
  Rides INSIDE the differing parenthetical after the pinned span_note substring, so the
  scope-disclosure equality recompute covers it with zero new verify code (stripped-clause leg
  pinned); client lockstep = `windowedScope.disjoint` (line-faithful port) → ScorecardPanel.
  Pinned on the exact understatement shape ([0,300]+[1500,1800]: span covers the run, dilution
  sentence suppressed). Span convention unchanged; `resolve_window`/zone_facts `window_note`
  deliberately NOT extended (stated non-goal — disjoint zone runs only craftable via clone-edit).
- **Item 5 — the PRODUCER-REAL 0.9.0 FIXTURE (hand-mock retired):** the spec's hand-mocked mandate
  agent had ALREADY drifted (its report-section disclaimer matched neither producer string,
  surviving on a shared substring — the predicted failure mode, found paid). Committed
  `institutions-run.json` = genuine 0.9.0 via the real deterministic chain
  (build_multimodal_artifact + compute_scorecard + speaking_institutions →
  compose_citations/compose_reaction → reactions.build_agent; sim/inferred PROSE stubbed —
  structure producer-real, said in the docstring), change set = the SYNERGY shape (2-member
  all-windowed DISJOINT composite whose detour payload carries the item-1 note) so ONE fixture
  exercises items 1+3+5 in the real UI. Companion `institutions-report-section.json` =
  `build_institutional_section` output verbatim; `test_institutions_fixture.py` is the school-zone
  regen-pin convention (recompute-equals incl. AGENTS — every reaction deterministic; roster
  byte-pin; the synergy invariant; companion recompute; regen via
  `python python/tests/test_institutions_fixture.py`). institutions.spec.ts is fixture-driven:
  empty state = a mechanical mandate filter, report splice = the companion.
- **Item 6 — the PRETTIER HOOK LEG is REMOVED (hazard closed, CONFIRMED LIVE 2026-08-14):**
  verified armed-but-configless (no config/dep anywhere, prettier absent from the npx cache —
  inert by cache state only); the leg deleted per "prettier is deliberately unconfigured", eslint
  keeps the TS leg, both hazard notes rewritten. The deliberate check ran the CONCLUSIVE variant:
  prettier SEEDED into the npx cache (`npx --no-install prettier` resolving — the exact 231-line-
  reformat precondition), a single-quoted probe .ts written through the live hook, byte-identical
  after → no reformat; probe deleted, cache entry removed (as-found). PRECISION on the reload
  caveat: it applies to settings.json REGISTRATIONS only — the registered command
  (`python format.py`) re-executes the current script body every invocation, so script-body edits
  are live immediately; that is why the check was valid same-session, not deferred to b.
- Suites: **457 pytest (+18) + 75 Playwright (+2)**; unwindowed golden byte-identical throughout.
- **Item 4 — the institutional chat index PROVEN LIVE (2026-08-13, the V2.3c deferral paid):**
  built the 235-doc LightRAG index for the V2.4b closure composite
  `multimodal-scenario-20260810T200300Z` and proved chat draws on an `institution__` doc end to
  end: *"what does the fire service's mandate say about this closure?"* → the answer recited the
  mandate substance + the unreachable-station fact + "free-flow estimates and not a dispatch
  model", digit-free, audit CLEAN, `sources[0] = "Institutional perspective (tfs, mandate lens)"`;
  the retrieved `institution__tfs` chunk (read-only `aquery_data` dump) carried the VERBATIM
  mission, the +29.1 s citation naming unreachable Station 231, both honesty notes, and the
  impersonation disclaimer. NB the FIRST ask deflected honestly ("This run doesn't answer that,"
  correct sources, audit clean) — retrieval-grounding is solid, generation is conservative; the
  retry produced the substantive answer. Acceptance was RESTATED before running (the original
  "answer cites the mandate + facts with the disclaimer" is unachievable by construction: chat
  prose is digit-free and the disclaimer lives in the retrieved doc, never injected into prose).
  Index re-archived after the proof; the pinned run's index restored as the only live one.
- **FORENSIC FINDING (user-directed, its own record):** the committed latest-report singleton
  belonged to `multimodal-scenario-V22AACCEPT` from commit `0bead19` ("feat: demo run",
  2026-08-11) until today — `discourse.spec` was RED ~2 days and nobody noticed, because the
  divergence landed AFTER the V2.4 closeout's 73-green claim (`953ab00`, honest when made) and no
  full suite ran in between (only a README edit). Same failure mode as 2026-07-13 (`a366328`
  "regenerate the stale latest-report.json so discourse.spec goes green"). LESSON: green-suite
  claims age only as long as the two singletons (committed `latest-report.*`, served index) stay
  put — any demo/regen touching either must re-run `discourse.spec` before landing. Fixed by
  regenerating the singleton for the pinned run (audit 10 clean / 0 corrected / 0 unresolved — no
  drift flag); `discourse.spec` 4/4 green.
- **CORRECTION:** `newest_index()` is a LEXICOGRAPHIC name sort, not newest-timestamp —
  `index-V22AACCEPT` outsorts every `index-<ts>` name (`'V' > '2'`), which is exactly why the live
  proof required archiving BOTH previously-live indexes first (Run-commands note fixed).

**V2.5 Step b — RUNG-2 RESPONSE REACHABILITY — COMPLETE (end-node probing REPLACED the anchor
walk; no contract change — the payload is sidecar/off-contract; design ratified per-axis before
implementation).**
- **The fact:** per capacity-event member × per segment END NODE × per station — "can you still
  reach addresses ON the changed segment, and from which direction?" cost-to-end = min over ALL
  incoming passenger approaches per net (NO exclusions — the mutated nets encode member state;
  baseline-via-the-segment is real; a reverse partner is just an approach), independent
  best-per-net disclosed by `END_METHOD_NOTE`. `destination_edge()`/anchor keys DELETED — the
  anchor arbitrariness is retired BY CONSTRUCTION (anchor_note's duty fulfilled by probing every
  member); shape-split ends EMBRACED (an end whose only approach is the closed segment IS
  unreachable — that's the answer, pinned live on KINGSTON's north end). Ratified axes: member
  gate = `capacity_event` (same predicate as the whole-fact gate, two arities) +
  `PROBED_MEMBERS_NOTE` REQUIRED-iff a member fails it; aggregated citations; promote-on-new-shape
  verify. `position_m` SUPERSEDED at this rung (whole-edge effects; rung 3 with per-window nets).
- **Labeled states, verify-RECOMPUTED (the fold-in: the label IS the causal fact):** no_approach
  (boundary stub, no probe rows) / baseline-unreachable / window-unreachable / ORIGIN-CLOSED
  (explicit permission check, scenario legs DECLARED not computed — the doorstep station carries
  its CAUSE, never four bare unreachables) / one honest-zero constant. verify_facts recomputes
  each row's expected state from nullness + the change list against VERIFY-SIDE literals
  (origin-closed both-ways-partial — road_closure targets required, modified-edge sanity, the
  all-car-lanes case producer-test-owned); the `members` key is a same-vintage marker BY
  CONSTRUCTION, so end-method/probed-members/coincidence notes are FULL REQUIRED-iff on the new
  shape (absence FAILS) while the legacy branch keeps V2.5a's tolerance untouched.
- **Rollups:** report = per-member heading (type + edge + fmt_window window) + ONE line per end,
  per-station figures + causes in the parenthetical; citation = per-member clauses with per-end
  worst-of-reachable + "u of n unreachable", fully-reachable/-unreachable pairs COLLAPSE, capstone
  names ONLY stations unreachable at EVERY probed end (one-end-cut-off = a count, not a name);
  chip = "U of E segment ends unreachable · worst +X s (M segments × S stations)" with ends the
  counted noun (E excludes no_approach/baseline-unreachable ends; unreachable iff NO station
  reaches it); corpus keeps FULL per-station rows. **VOCABULARY SPLIT (fold-in): new-shape prose
  says "added time to reach" and NEVER the number-bearing "s added response-route time" —
  test-pinned per surface (FRAMING's generic methodology wording deliberately shared); old
  "+29.1 s detour-past-anchor" and new "+X s to reach an end" are DIFFERENT measurements;
  CompareView is the named BACKLOG exposure (slim sides, no detour today; cross-shape deltas get
  "—†" if it ever enters).** Legacy `probes` sidecars render byte-identically everywhere
  (shape-keyed branches; the three verbatim Playwright chip pins stay green unmodified; a
  shapeless payload → labeled fallback, crash-hardened; `_cite_response_detour` raises on
  neither-key — the false-"could not be computed" trap is structurally unreachable).
- **Accepted live (`multimodal-scenario-20260814T063253Z` — the doorstep composite rerun):** the
  phase's target sentence on a real run — road closure `-36784353#20`: **east end worst of the
  reachable +1.7 s (via the reverse partner `36784353#18`); west end worst +29.1 s** — the old
  anchor's +10.2/+29.1/+2.7 turn out to have been the WEST end's numbers, and the new fact adds
  the direction answer the old one couldn't give; **Station 231 carries the ORIGIN-CLOSED cause
  at every end** (was: a bare "unreachable"); the incident's ends probed with honest small
  numbers + zero-notes; `probed_members_note` fired (3 modified edges, 2 probed members);
  coincidence note rides (600–1200 vs 600–1680). verify_facts (incl. state-label recompute)
  green on the live sidecar; 214 voices (TFS spoke the aggregated citation with all six notes,
  capstone naming 231); report audit 8 clean / 1 corrected / 0 unresolved; singleton RESTORED +
  discourse.spec green same-arc (the V2.5a lesson). **Analysis-cost input for V2.5c (measured,
  follow-up):** on the acceptance change set, `compute_response_detour` = **3.0 s net reads (×2,
  the dominant, pre-existing cost) + 0.56 s routing = 88 `getOptimalPath` calls** (2 members ×
  4 ends × 16 station rows × 2 nets × approach candidates) — the V2.5b routing multiplication is
  a rounding error; the leg is net-read-bound. The harness now records it permanently:
  `wall_clock_s` gains `analysis` (whole stage) + `response_probe` (evidence-only fields, land
  on the NEXT run — the multimodal path only). Screenshots `docs-assets/v25b-*.png` — the feed
  instBlock FITS
  (the citation-length acceptance check; fallback lever recorded: worst-end-only per member);
  chip wraps mid-word via the pre-existing `wordBreak: break-all` card style (V2.7 UI territory).
- **Review catch (fixed + pinned):** the members render's no-reachable branch counted
  baseline-null/unmatched rows into "unreachable from all N stations DURING THE WINDOW" — a
  false causal count on mixed ends (reachable via the origin-unmatched path; the live acceptance
  payload happened not to ship it). The count now uses the same finite-baseline filter the
  capstone/citation recomputes already used ("all K stations with a baseline route" when the
  counts diverge); the citation's "u of n unreachable" and the chip's end counts are
  DELIBERATELY cause-neutral (no "during the window" claim — the report carries causes), and the
  citation dispatcher's truthy members gate is deliberately stricter than the renderers'
  `is not None` (empty members → ValueError, commented).
- Suites: **470 pytest + 77 Playwright** (+2 chip cases; producer tests rewritten with probed
  real-net literals — compass labels, the shape-split end, the reverse partner, a real
  no-approach stub edge, the doorstep origin-closed case).

**V2.5 Step c — the TWO-JOBS FIX and the FRAME BUDGET — COMPLETE (latest.json split + perf
measured-first; the biggest finding was about the MEASUREMENT, not the app).**
- **latest.json is a POINTER, never a payload** (`{"run_id": ...}` via
  `trajectory_io.write_latest_pointer`), written ONLY on quant-run completion — scorecard
  recomputes and propagation enriches no longer touch it (DELIBERATE change: an enrich/recompute
  of an old run silently stealing the default was the accidental-repoint footgun, H3 of the four
  recorded sightings; the payload job was also already broken — the voices enrich never rewrote
  it). MapView resolves the pointer → `/<run_id>.json`; a legacy payload-shaped latest.json still
  works but EXPIRES LOUDLY (console.warn + the scheduled V2.7 removal in BACKLOG). Python
  consumers migrated (propagation id-read; oasis_spike resolve; test_propagation pins the
  COMMITTED social run). Dead `web/lib/loadArtifact.ts` DELETED (zero importers — client-side
  ajv NEVER ran; the stale "client ajv-validates" comments corrected).
- **Spec immunization (`web/tests/support/default-artifact.ts`):** every `goto('/')` spec routes
  the POINTER PAIR (pointer + resolved artifact with the ~500 ms StrictMode floor delay — the
  split alone would only have MOVED the 90 MB fetch); 7 formerly-vulnerable specs migrated, 3
  full-body mockers switched, discourse.spec's independence test REPOINTS (~50 bytes) instead of
  copying 20 MB. **The migration made H4 LIVE:** three specs (closure-palette, edit ×5 sites,
  seeds ×2) had never needed the warm-reload convention because the real 20–90 MB artifact never
  resolved inside StrictMode's double-mount window — the tiny default fixture DOES, and
  closure-palette:48 crashed maplibre teardown exactly as CLAUDE.md's H4 note predicts. The
  convention is now on every `goto('/')` site. **Reporting lesson (self-caught):** the first
  acceptance pass was mis-read as green — `tail -2` on the Playwright summary ATE the "1 failed"
  line above "N passed"; verification output must be captured to the summary BLOCK, not its last
  lines. **DOUBLE ACCEPTANCE (post-fix), both green:** the real pointer aimed at the 90 MB
  exemplar, then latest.json DELETED entirely (the stronger form — anything breaking on
  missing-X is still coupled).
- **Perf, measured first (`scripts/perf-harness.mjs`, prod build, permanent `nadi:*` marks):**
  the headless baseline showed 0.36 FPS "catastrophe" — the CPU profile was 99.2% native
  "(program)" time, which unmasked it as **SwiftShader: headless Chromium's software rasterizer.
  Frame numbers are HEADED (hardware-GL) numbers or they are numbers about the rasterizer** (the
  harness has `--headed` + `--profile`; the sampler is TIME-bounded — a frame-count sampler
  takes minutes at pathological rates). HEADED TRUTH on the 90 MB exemplar: transfer 26.9 MB gz /
  fetch 2.9 s / parse ~3.4 s / **nav→first-render 3.9 s** / heap 189 MB / **frames p50 13.6 ms
  (74 fps), p95 14.1 ms (71 fps), 0 longtasks**. Synthetic control: first-render ~1.1 s, 137 fps.
- **The one indicted fix, A/B'd on hardware:** the TripsLayer trails array was rebuilt every
  render (time-invariant contents) → deck re-tessellated per rAF tick; one `useMemo` took the
  exemplar from p50 20.9 ms (48 fps) / p95 27.8 ms (36 fps — grazing the floor) to 74/71 fps.
  **Everything else measured NOT indicted and deliberately NOT built** (the ratified
  measurement-gated protocol): subtree memoization, trajectory thinning (+ its proof
  seam/disclosure), the eager-slim split, network simplification — verdicts + the two levers
  recorded in BACKLOG for V2.7. BACKLOG's "36 fps playback" aspiration RESOLVED (74 fps).
- **BUDGETS (headed, prod build, this box — re-measure with the harness at V2.7 checkpoints; no
  CI gate, ratified):** nav→first-artifact-render (the nadi:artifact-rendered mark — a React-commit proxy, not a Paint Timing event) ≤ 5 s on a 90 MB artifact (achieved 3.9 s), ≤ 2 s on a
  ~20 MB run (achieved ~1.1 s); scrub/playback p95 ≥ 30 fps at the concurrency peak (achieved
  71 fps). The contract payload rung (~50% wire waste: unused speeds, regular timestamps,
  14-decimal coords) is measured + BACKLOG'd for the 0.10.0 ceremony.

**V2.5 Step d — the PRESENTABLE CORE — COMPLETE; V2.5 CLOSED and TAGGED `v2.5` (deployment
decided, README rewritten for the cold reader, reconciliation; no contract change all phase).**
- **Deployment ratified (a)+(c), docker skipped, video skipped (shot list committed instead):**
  a STATIC read-only demo for Cloudflare Pages + local-setup docs. The app is a pure client SPA,
  so `next.config.ts` gains ONLY `output: process.env.NEXT_STATIC_EXPORT ? "export" : undefined`
  (npm run start stays intact for the perf harness). `scripts/build-static-demo.mjs`: export
  build → prune `out/` to the demo set (the pinned triple + `network.json` + `latest-report.*` +
  the MODERN run `multimodal-scenario-20260814T063253Z` — committed via a `.gitignore` negation,
  check-ignore-verified, ~20 MB permanent history RATIFIED) → build-writes `out/latest.json`
  (the pointer is never committed) → manifest + a 25 MiB/file Cloudflare guard. Bundle: 43.9 MB.
  Smoke on the served bundle: all three walkthrough stops + the compare deep-link green.
- **Demo honesty (user fold-ins, both landed):** dead controls are DISABLED-WITH-WHY — a
  build-time `NEXT_PUBLIC_STATIC_DEMO` flag + single-sourced `web/lib/demo.ts` `DEMO_READONLY_NOTE`
  ("read-only walkthrough of pre-computed runs; editing, chat, and interviews need the local
  backend (SUMO + a model key) — see SETUP.md in the repo") rendered by every gated surface (the
  ✏️ Edit toggle, chat form, 🎤 interviews); non-demo builds byte-identical. And the README says
  PLAINLY that demo runs are PRE-COMPUTED and REAL (nothing simulates in the browser; actual SUMO
  runs on calibrated Toronto data). In passing, the landing page's ONE unlabeled failure mode got
  the labeled treatment (TDD): `artifact-load-error` early return on !r.ok / bad pointer / bad
  shape, spec-pinned (404 + malformed cases in discourse.spec).
- **Setup docs:** `python/requirements.txt` (authored from actual imports, pinned from the live
  env; traci/sumolib called out as SUMO_HOME imports, NOT pip), `python/.env.example` (per-key
  role lines), `SETUP.md` (SUMO 1.27 named LOAD-BEARING, the two-env oasis boundary, per-layer
  key table, the fresh-clone netconvert note hoisted from the old README).
- **README rewrite (the discipline applies to the pitch):** cold-90-second-reader structure —
  plain pitch, demo stops, the honesty-architecture thesis (the referendum guard named as
  TEST-enforced: the BANNED sweep rides 14 of 17 specs, counted not guessed), three computed
  facts EACH with riding caveats (the V2.5b per-end fire-station sentence verified verbatim
  against the committed run's TFS citation, "added time to reach" vocabulary only; the 30-vs-28
  zone pair with variation + population notes quoted; 72%-delivered saturation with the GEH-51.8%
  structural framing), what's-real/what's-not, the two-graphs one-liner, pointer-aware
  architecture diagram. Traps killed: the retired anchor-arbitrariness disclosure sold as a
  feature, the old-vocabulary +29.1 s roadmap line, the stale roadmap. Screenshots: fresh hero +
  school-zone frame captured and LOOKED AT (the zone pair itself rides as quoted text — its
  numbers render in the run's report, not the committed singleton; deliberate, avoids singleton
  churn); orphan `sample-initial.png` dropped; `docs-assets/demo-shot-list.md` = the optional
  90-second recording script.
- **Reconciliation:** BACKLOG — compare bullet marked SHIPPED (V2.1d), tier-1/windowed-shape
  intro rewritten SHIPPED (tiers 2/3 stay), rung-2 heading LANDED→SHIPPED, the EOF fragment
  removed. CLAUDE.md — rollup lead V2.0–V2.5, styling deferral → V2.7 (2 sites), the
  ARTIFACT_URL contradiction replaced with pointer semantics, test counts 471/79, perf-harness +
  demo-build Run-commands lines. `DEPLOY.md` at repo root (docs/ is gitignored): Cloudflare
  Pages via wrangler or connect-repo, the 25 MiB cap, why GitHub Pages project sites fail
  (root-absolute fetches vs basePath) — the deploy click itself is the user's.
- **Review fixes (folded in):** the README's "every changed segment" overclaim narrowed to the
  probed capacity-event members (the PROBED_MEMBERS_NOTE duty applies to the pitch too);
  fastapi/uvicorn HOISTED to base `requirements.txt` (server.py fronts the PRIMARY flow — a fresh
  clone's step-6 uvicorn hard-failed on the base-only install; the agent extras keep RAG-only
  deps); the ✏️ Edit toggle now renders VISIBLY disabled in the demo (it was attribute-disabled
  but visually indistinguishable — modeBtnDisabled applied, verified by a looked-at toolbar
  screenshot on the rebuilt served bundle) and the InterviewDrawer demo note dropped the ERROR
  styling (a property, not a failure); the STATIC_DEMO gating's no-spec-coverage gap is RECORDED
  in BACKLOG (build-time flag → needs a second Playwright project over `web/out`; smoke-verified
  only until then).

**V2.6 Step a — the ROOM, server-side — COMPLETE (group interviews; ephemeral like V2.3b, no
contract change; the plan's review blocker fixed + pinned same-arc).**
- **`POST /api/group-interview {run_id, agent_refs[3..5], question, transcript}`** — refs use the
  V2.3b id+index addressing; DUPLICATES rejected by RESOLVED-record identity, never ref equality
  (`("veh0", None)` ≡ `("veh0", 0)` is one voice; two same-persona.id SIBLINGS are two legal
  voices); per-ref 404 names the failing position (`agent_refs[i]`); refs count = manual 400 with
  the `3..5` detail; otherwise the single endpoint's exact matrix (400 empty/oversize q, 404/409
  on load, 503 no key, NO one-job lock, guard failures = 200 + per-speaker audit).
- **Sequential generation in agent_refs order** — each speaker's grounding is built independently
  by the UNCHANGED `build_grounding` (the structural leakage guarantee carries over verbatim);
  each answer is appended to the shared working transcript before the next speaker generates, so
  cross-agent content flows ONLY through actual utterances. The leakage matrix is pinned at BOTH
  layers (unit prompt-build + endpoint recorded-prompts): B's markers/digits/minute-forms absent
  from A's prompts always, B reaches A only as B's attributed utterance, institution C never gains
  either traveler's records (mandate grounding stays mission+citations). One speaker's refusal is
  that speaker's ANSWER (audit-clean by pin) and rides into later speakers' context — the room
  never aborts.
- **Transcript wire** — turns `{role, text, agent_id?, agent_index?}`: the SERVER resolves
  attribution ("<label> said:"), detects self by resolved-record OBJECT identity ("You said:" —
  index-qualified refs mark exactly one sibling), and degrades unresolvable refs to "Another
  participant said:" (never a 400 — membership drifts under re-enrich; the guard floors content).
  Per-speaker flatten, header "EARLIER IN THIS GROUP INTERVIEW (oldest first):",
  `ROOM_TRANSCRIPT_MAX_TURNS = 24` × the same `TURN_MAX_CHARS`.
- **The room guard (`audit_room_utterance`)** = `audit_interview` per utterance with PER-SPEAKER
  keying (a mixed room's mandate speaker keeps operational/first_person while a sim speaker's
  household-we stays legal, endpoint-pinned) + the ROOM-ONLY `_CROSS_PARTICIPANT` family
  (quantifier-of-us / room-deixis+stance / collective-subject+stance / speaking-for; every
  must-trip form is deliberately `_TALLY`-INVISIBLE — the gap the rule exists to fill; "back" is
  support-sense only, spatial "went back to" review-FP-fixed; "speaking for" is gerund-only so the
  GOOD deflection "I can't speak for everyone here" stays legal). Planted-consensus laundering
  pinned end-to-end (the echo dies at the guard with rule `cross_participant`). **Review-caught
  BLOCKER fixed: the room's disclaimer strip is CONJUNCTION-AWARE** — `_ROOM_CLAUSE_BOUNDARY` adds
  `but|though|although|however|yet` to report's punctuation-only boundary, because "I can't predict
  crashes but everyone here agrees it's better." previously rode the licensed disclaimer to a CLEAN
  audit. ROOM-LOCAL on purpose: the SHARED strip's identical hole (verdict/tally/crash smuggling
  via comma-less conjunctions in report slots / chat / single interviews / the room's inherited
  legs) is a recorded BACKLOG decision — widening it tightens every consumer and shifts the
  audit-retry baseline (the V2.5a precedent), so it must not land as a side effect.
- **The guarded loop is EXTRACTED, not duplicated** — `interview._guarded_generate(client, agent,
  system, user, audit_fn, retry_extra)`: `answer()` is a thin wrapper (public signature + behavior
  unchanged), `room_answer()` the sibling (`audit_fn=audit_room_utterance` + `ROOM_RETRY_EXTRA`).
  EVERY audit dict now carries **`calls`** (1 clean/error-first, 2 with retry — generations this
  module issued, NOT `report._call`'s internal transport retries; the adapter's `usage["calls"]`
  is a process-lifetime singleton, unusable per-request). Room response = `{run_id, question,
  answers[{agent_id, agent_index, persona_label, grounding, answer, audit}], llm_calls}` with
  `llm_calls` = the per-turn sum — the V2.6b client cost label derives from it; the single
  endpoint inherits `audit.calls` additively (endpoint-pinned).
- **Room constitutions are ADDENDA constants** (`ROOM_ADDENDUM`, `INSTITUTION_ROOM_ADDENDUM`)
  between the UNEDITED base constitution and grounding — single-interview prompts stay byte-stable
  (pinned: no room material in `build_system`, whose output equals the pre-refactor literal
  composition; `_SIM_SHAPE`/`_MANDATE_SHAPE` extracted). The institutional addendum licenses
  acknowledging, third person, what a specific participant SAID while content stays mandate+facts
  only. System prompts stay turn-invariant per speaker (prefix caching); everything shared rides
  the user message — this-round answers render inside the room-transcript block before the
  restated question (the literal "appended before the next agent generates" reading; a separate
  this-round block is a `build_room_user`-local change if ever wanted).
- **Ephemerality extended** (a full room POST changes nothing under RUNS_DIR, STATE_DIR never
  created). Tests: `test_group_interview.py` ×32 (guard family both directions, FP set incl. the
  conjunction + spatial-back pins, flatten attribution/sibling/caps, addenda, byte-stability, the
  unit leakage matrix) + `test_group_interview_endpoint.py` ×19 (validation matrix, room order +
  calls, recorded-prompt leakage, refusal-doesn't-abort, planted consensus, mixed-room mandate
  keying, self/neutral attribution, cap, ephemerality, the single endpoint's additive `calls`).
  Suites: **522 pytest + 79 Playwright** (no web change; full Playwright rerun green).
- **Env findings (this box, 2026-08-19):** ruff and pyright are ABSENT (not pip-installed, not on
  PATH) — the format hook's python legs (`ruff format` / `ruff check --fix`) currently soft-fail,
  and NO ruff config exists in the repo, so pip-installing ruff would ARM a configless formatter
  against non-default-formatted code — the V2.5a prettier hazard class exactly (verified: `ruff
  format --check` wants to rewrite pre-existing files; ruff was uninstalled again, as-found).
  Types were checked via `npx pyright@1.1.413`: interview.py clean; server.py's 8 errors are all
  pre-existing (lines 529-782, the job-runner region), none in the V2.6a additions.

**V2.6 Step b — the ROOM in the UI — COMPLETE; V2.6 CLOSED (transport ratified at plan time;
no contract change).**
- **Transport (RATIFIED over streamed NDJSON): optional `speak: int | None` on
  POST /api/group-interview** — the FULL room still validates on every call (count/resolution/
  duplicates; the range 400 is TWO-SIDED and precedes I/O — a bare `< n` would let
  participants[-1] alias the last speaker); the server generates ONLY participants[speak]; the
  envelope is unchanged and the no-speak path byte-identical (the V2.6a pins green unmodified).
  Why fetches: EventSource can't POST, `req()` has no stream seam (zero ReadableStream consumers
  in web/), and Playwright can't stream `route.fulfill` bodies — per-speaker fetches are
  individually delayable, so sequential rendering is REALLY pinned, not assumed. **Fold-in A
  pinned both halves (+6 pytest):** the client-assembled prefix is conversational context ONLY —
  a doctored prefix (a fabricated institution-attributed turn, a ghost ref, consensus bait)
  cannot reach grounding (system = speaker k's own records), cannot forge attribution (labels
  are refs-RESOLVED server-side, never client text), and its bait still dies at the room guard.
- **Assembly**: every feed row kind restructured into a flex wrapper (keys moved to wrappers,
  inner buttons flex:1, the border-shorthand-before-longhand accent ordering PRESERVED —
  computed-style pins green) with a trailing ＋; AgentPanel/InstitutionPanel gained 👥 "Add to
  conversation". MapView stores {agent, index} PAIRS resolved ONCE at add time by REFERENCE
  (`artifact.agents.indexOf` — a copied object breaks to -1 and an id-scan would misattribute
  siblings); dup/cap checks live INSIDE the setRoomPairs updater (StrictMode double-invoke is a
  no-op — identity is intrinsic, no minted ids). Min-3 blocker + cap-5 note, both explained in
  the drawer ("each answer is a separate guarded model call").
- **RoomDrawer** (rail card, last playback sibling): per-participant grounding lines via the
  exported `GROUNDING_SENTENCES` (single source — InterviewDrawer refactored onto it,
  byte-identity held under the existing toHaveText pins); sibling label collisions get a UI-ONLY
  "(a)/(b)" suffix (the BACKLOG item's UI half CLOSED; the prompt-side attribution ambiguity
  stays deferred); speaker-labeled turns; per-answer guard/error notes (the existing sentences
  verbatim); **fold-in B: the "…thinking" row sits on the CURRENT speaker — never a global
  spinner**; a failed speak-call fails THAT SLOT (rows 0..k-1 stand, the transport error renders
  verbatim, Retry resumes from k with the same prefix, "skip the rest of this round" keeps the
  honest partial round and re-enables the box). **Review catch (D3, reader-facing): the curation
  note renders in the drawer — "voices you picked, answering one at a time — a conversation
  preview, not a poll or a sample of opinion"** — structural no-tallying wasn't enough said out
  loud on the surface most likely to be screenshotted as a verdict panel.
- **The round machine**: RoomRound SNAPSHOTS the roster at Ask (mid-round add/remove can't shift
  refs); `roomEpoch` orphans in-flight loops on run swap (checked after EVERY await — stale
  answers can't resurrect into a fresh session); **review catch: a SYNCHRONOUS `roomLoopActive`
  ref gates Ask/Retry** (React state commits async — key-repeat/dblclick double-fired before the
  'thinking' commit; dblclick-pinned: no double-POSTed slot), freed only by the OWNING loop's
  epoch-conditional finally or by loadRun. Wire truth spec-pinned: turns
  {role, text, agent_id?, agent_index?} — labels NEVER ride; the current question rides its own
  field and enters the transcript only as next-round history. Fix-in-passing:
  `InterviewResp.grounding` gained 'mandate' (api.ts:333, stale since V2.3c).
- **Cost honesty**: the estimate line "1 question · N voices · ~N×<1¢" + a title naming that
  retries can exceed it; post-round actuals "this round: K model calls" from summed llm_calls
  **with the transit-loss hedge title (review catch: a request that fails mid-flight may have
  spent server-side — the count never claims completeness)**; dismissed rounds render their
  partial actuals.
- **Ephemerality**: the room stores join the loadRun clear; run-swap AND reload kill the session
  (spec-pinned); no persistence surface exists client-side.
- **Specs (+9 → 88 across 18 files)**: `group-interview.spec.ts` — assembly/blockers/grounding
  sentences + the curation note; sequential render (a delayed speak-1 mock holds the round:
  answer 0 visible while row 1 thinks); the wire pin (sorted keys incl. speak, the speak
  sequence, full-room refs on every call, transcript tails with wire keys only,
  ids-never-facts); planted-consensus refusal + the per-speaker guard note; institution
  third-person attributed; failed-slot dblclick-Retry; Dismiss partial round; add/remove +
  "(a)/(b)" + index-disambiguated sibling refs; run-swap + reload ephemerality. The referendum
  sweep (BANNED/STANCE_TALLY) rides 6 of 9 via the `sweepRoom` helper. Fixture =
  `institutions-run.json` BYTES (the drift lesson — the mandate record is never re-authored) +
  ONE hand-authored inferred sibling of agents[1].
- **The looked-at gate (`docs-assets/v26b-*.png`)**: feed ＋ buttons render clean beside intact
  accents; the drawer thread was tightened 260→200 px — at 260 the question form sat below the
  right-rail's scroll fold (exactly the seam-tests-can't-see-pixels class). NB the first full
  Playwright run had 3 failures that were the DEV-SERVER HOT-RELOAD RACE (source files edited
  while the background suite ran against `npm run dev` — all three green standalone on a quiet
  server): don't edit web/ sources while a suite runs against the dev server.
  Suites: **528 pytest + 88 Playwright**.

**V2.6 follow-up — the SHARED disclaimer-strip conjunction hole CLOSED (the user-ratified
baseline decision; code diff = report.py + interview.py + two test files, no contract change).**
- `report._CLAUSE_BOUNDARY` gained the COORDINATING adversatives (`\b(?:but|yet)\b`, re.I)
  beside the punctuation set — the comma-less "but <claim>" form is re-checked like its comma'd
  sibling in EVERY consumer at once (audit_prose = report slots + chat; audit_prose_cascade;
  audit_interview's verdict/operational legs; the room). RED-proven first: "I can't give a
  verdict but the majority should approve it." audited CLEAN pre-fix at both pinned call sites.
- **The boundary set is deliberately MINIMAL — every exclusion is a pinned decision, not a
  gap.** and/or NEVER: a multi-object disclaimer ("cannot predict crashes or their probability",
  pinned clean since V2.3b) must stay whole or its tail re-enters the crash check.
  though/although/however NEVER — **the review CAUGHT the five-word draft reintroducing the very
  false-positive class the fix's own comment forbade**: as subordinators/conjunctive adverbs they
  commonly CONTINUE a disclaimer ("cannot predict crashes however unlikely the probability" /
  "though not their probability" tripped crash — verified live, old-vs-new). The review also
  caught the original and-pin being mutation-INEFFECTIVE (two independently-licensed clauses);
  replaced with the true analog "crashes and their likelihood", which flips under an and/or
  mutation. Every exclusion now carries a mutation-effective pin (test_report.py) — the set can
  neither shrink nor grow by drift. Accepted residuals: smuggles joined by
  and/or/though/although/however (retry + prompt rules absorb).
- **The V2.6b room fork is DELETED** (`_ROOM_CLAUSE_BOUNDARY` + `_strip_disclaimers_room`):
  byte-identity with the then-five-word shared boundary was confirmed BEFORE deletion, then the
  shared set was narrowed (the room's conjunction pins all use "but" forms and ride the shared
  set unmodified); `audit_room_utterance` reads `report._strip_disclaimers` again (one strip,
  one source).
- Pins are PER CALL SITE (the V2.3b hoist precedent — each consumer proven to route through the
  fix, never just the helper in isolation): report but/yet-tally + but-crash + cascade/tally
  (test_report.py) and interview/verdict (test_interview.py).
- The audit-retry **BASELINE SHIFT (2026-08-19)** is recorded beside the 2026-07-31 precedent in
  the provider block: the next natural regen's corrected-on-retry count is the new baseline's
  FIRST READING, not drift. NO paid regen was run (precedent-consistent; a validation regen +
  singleton restore + discourse.spec stays available on request).
- Playwright deliberately NOT run: zero web/ changes — the guard is server-side and every room
  spec mocks the backend, so a suite run would add no evidence. Suites: **530 pytest + 88
  Playwright**.

**V2.6 Step c — the 0.10.0 CEREMONY — COMPLETE (contract v0.10.0; the V2.5c payload rung PAID;
seven commits C1–C7, every one leaving the full suite green).**
- **The encoding (D6, ratified with two exploration-driven revisions):** per-entity EITHER-shape
  timestamps — compact `{t0, dt}` iff the write-time regularity check passes (the check IS
  `contract_models.compact_encoding`: per-point closed-form `t0 + i*dt` comparison within
  `COMPACT_DT_EPS = 1e-6`, never accumulation), explicit arrays for teleport-gapped entities
  (measured 2–10 per calibrated run, gaps 3–216 s — TRUE holes kept, lossless by construction);
  **speeds DROPPED** — the V2.5c "read by no renderer" claim was TS-true but python-FALSE
  (`sampler.worst_moment` computed trigger_t in a detached subprocess): the harness now stamps
  `worst_t` into the outcomes sidecar at record time (`stamp_worst_t` before BOTH quant paths'
  sidecar writes; records-dict iteration = gapped entities stamped identically; fires in the same
  breath speeds drop, so new-shape-without-worst_t is impossible by construction) and the sampler's
  `trigger_time_for` falls back to wire speeds ONLY for genuinely old artifacts, raising the NAMED
  `SpeedsUnavailableError` otherwise; **coords 6-dp (~11 cm) at RECORD time** (_record /
  SpillRecorder._flush / run_sim — never dump_artifact: the committed samples' byte-roundtrips);
  ped-PET/SSM keep raw metres, untouched.
- **The gate ceremony:** schema enum + description; obligation gates A/B/C/E EXTENDED; NEW gate J
  (pre-0.10.0 re-imposes timestamps+speeds required + forbids t0/dt — lands in the SAME edit as
  the base required-relaxation) + gate K (0.10.0: speeds:false + per-entity oneOf XOR);
  `audit_version_gate` forward tuples + a raw-dict shape gate keyed on the single-sourced
  `COMPACT_TRAJECTORY_VERSIONS`; MANDATE_VERSIONS gains 0.10.0 BOTH sides (the reactions upgrade
  ladder needs NO change — pinned MUTATION-EFFECTIVELY: the test asserts the 0.10.0 alternative
  FAILS validation, not just the version string); `sample_v0_10_0.json` + negatives both layers +
  pin-relax on the 0.9.0 template; the literal pins
  (`expand_timestamps(4.0, 1.0, 3) == [4.0, 5.0, 6.0]` — the shared-inverse-bug breaker) + F2 gap
  positions (start/middle/end) + the F1 cross-language lockstep pin (a pytest reads
  `web/lib/compactTime.ts` and pins the eps literal + formula).
- **The TS dual-path reader:** types.ts makes timestamps/speeds OPTIONAL (tsc forces every
  consumer through `viz.materializeTimestamps` — identity pass-through for explicit entities, one
  materialization for compact), normalization memo'd PER ENTITY-ARRAY IDENTITY — **review catch:
  keyed on `[artifact]` it would re-allocate every compact array on each V2.3a streamed voice
  (setArtifact-spread per voice; the V2.5c trails-identity class)** — split into its own memo on
  `artifact?.vehicles/persons`; `__nadiRenderStats` (NEW seam) publishes true point counts under
  both shapes + a literal-anchored expansion sample; `compact-run.json` is producer-real
  (regen-pinned) with mid-gap + tail-gap entities; specs pin the seam constants hand-written.
- **new_road.via = CONTRACT CAPACITY, REFUSED at runtime** (POST 400 + validate_new_road; an
  ignored via would emit an artifact that lies about simulated geometry; `SimChange` is
  extra-ignore so via had to be ADDED to the request model for the 400 to be reachable; threading
  BACKLOG'd). Schema-loose like its five 5.1 siblings.
- **Acceptance (live):** fresh run_sim (300/300 compact, 3.35 MB) → golden refreshed (same
  146,269 points; the 5-dp digest is transparent to 6-dp coords); full E2E — harness (worst_t
  stamped 511/511 outcomes) → sampler consumed worst_t (no fallback fired) → DeepSeek voices (213
  agents incl. a LIVE mandate voice at 0.10.0) → report **audit 8 clean / 1 corrected / 0
  unresolved — the conjunction baseline's FIRST READING, no uptick vs V2.5b's 8/1/0** → singleton
  restored → HEADED browser smoke green (511 compact joined, path==ts counts, feed + institutions
  live; `docs-assets/v26c-live-smoke.png` looked at). NB headless sad-tabbed under SwiftShader
  AFTER the join — headed passed in 5.9 s (the V2.5c rasterizer lesson now extends to renderer
  crashes: real-run render questions are HEADED questions).
- **MEASURED (the numbers that justified the rung; V2.5c harness, headed, prod, the local 90 MB
  exemplar):** raw 90.5→40.7 MB (-55.0%), **gzip transfer 26.9→7.6 MB (-71.8%)**, fetch
  2.7→1.1 s, parse 3.3→1.4 s, **nav→first-render 3.72→1.83 s** (the 90 MB run now clears even the
  ~20 MB-class ≤2 s budget), heap 189→90 MB, frames IDENTICAL (p50 8.2 ms/122 fps, p95
  16.4 ms/61 fps, 0 longtasks), join 2→7 ms (the normalizer's cost, visible where the plan wanted
  it). The re-encode measures BYTES only; correctness lives in the literal-anchored test set.
  Committed-demo datum: 20.08→9.03 MB (55.1%). 1589/10 compact/explicit on the exemplar.
- **Incidents (both handled + recorded):** `newest_instrumented()`'s lexicographic sort — the
  recorded live-ammunition class — FIRED during acceptance (instrumented-V22AACCEPT outsorted the
  fresh ts name; the stale-roster enrich burned the Groq day cap; untracked scratch only; the
  rerun used the explicit `--instrumented`; the one-line fix candidate is BACKLOG'd beside
  `newest_index()` — the same bug twice). Suites: **556 pytest + 91 Playwright**. The
  trajectory-contract SKILL.md is refreshed (was stale at "Current: 0.5.0"; cardinal rule 3 was
  turned actively false by this bump; the recipe now documents the REAL ceremony).

## Run commands
SUMO: `export SUMO_HOME="/c/Program Files (x86)/Eclipse/Sumo"` (not on PATH). Python = base miniconda.
- **Editor / job-runner (Phase 5 — the PRIMARY flow; the server FRONTS the pipeline):**
  ```bash
  cd python/src && uvicorn server:app --port 8000  # API: /api/junctions /api/edges /api/simulate /api/runs[/<id>/status|/enrich|/enrich/stream|/identity] /api/report /api/chat /api/interview
  cd web && npm run dev                            # http://localhost:3000 → open the ✏️ Edit toggle
  python python/src/demo_road_select.py            # pick a high-detour demo road (prints from/to junction ids)
  ```
  The server SUBPROCESS-launches `scenario_harness.py` (quant, staged run-state) then, on enrich,
  `sampler`/`reactions`/`report`/`report_agent`/`propagation`. No manual `ARTIFACT_URL` edits — the frontend
  resolves `/latest.json` (V2.5c: a `{"run_id"}` POINTER, never a payload — written ONLY on quant completion;
  enriches and CLI recomputes deliberately do NOT repoint the default) then fetches `/<run_id>.json` (or
  `/?run=<id>` directly); each run's artifact is copied to `web/public/<run_id>.json`. One job at a time.
  Run identity (user name/note) lives in the `contract/runs/state/<run_id>.identity.json` SIDECAR —
  endpoint-only writer, never the state file or the artifact; three file classes coexist under
  `run_state.list_all`'s glob (state / `.composite.json` / `.identity.json` — see the V2.4c block).
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
  The frontend resolves `web/public/latest.json` — since V2.5c a `{"run_id"}` POINTER written only
  on quant completion (`trajectory_io.write_latest_pointer`) — or open `/?run=<id>` directly; no
  manual URL edits anywhere.
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
  `report_agent.newest_index()` resolves **ALIGNMENT-FIRST since the resolver-family fix (2026-08-21)**: the
  served `latest-report.json`'s run id → its `index-<ts>` dir when present (chat and report align by
  construction); fallback = the digit-first newest timestamp-named index DIR with junk names warned by name
  (the old lexicographic name sort served `index-V22AACCEPT` for two silent days — that class is dead).
  The lifespan "index run != report run" warning is the backstop canary now; archiving other indexes at
  `%LOCALAPPDATA%\nadi-report-agent\archive\` remains good tidiness but is no longer load-bearing for alignment.
  After any verification report-regen, restore the singleton via `git checkout -- web/public/latest-report.*`.
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
- **Perf harness (V2.5c budgets):** `node scripts/perf-harness.mjs --headed` against a prod build
  (`npm run build && npm run start`) — frame numbers are HEADED numbers (headless measures
  SwiftShader); budgets live in the V2.5c block, re-measure at V2.7 checkpoints.
- **Static demo build (V2.5d):** `node scripts/build-static-demo.mjs` → `web/out/` pruned to the
  demo set (43.9 MB; every file <25 MiB) — deploy per `DEPLOY.md`.
- **Tests:** `python -m pytest python/tests` (567 tests: golden spine + contract
  0.6.0–0.9.0 sections + seed-range/report honesty invariants + the unwindowed-report golden + the V2.3a
  enrich-events/builder/SSE sections + the V2.3b interview grounding/guard/endpoint sections + the V2.3c
  institutions roster/gating/composition/verify sections + the V2.3d graph-export/fixture sections + the
  V2.4b composite-matrix/probe/scorecard sections + the V2.4c identity sections + the V2.5a
  disclosure/fixture sections + the V2.5b members-probe/report/citation sections + the V2.5c pointer
  sections + the V2.6a/b group-interview room/endpoint/speak sections + the V2.6 follow-up
  conjunction pins + the V2.6c 0.10.0 ceremony/compact/worst_t/coord sections + the
  resolver-family sections) and
  `cd web && npx playwright test`
  (91 tests across 19 spec files incl. seeds, compare, school-zone, scorecard-scope, enrich-stream,
  interview, institutions, graphs, draft-basket, composite-runcard, run-identity, group-interview,
  compact-run, the V2.5b ends rendering, the V2.5c/d pointer-independence + labeled-landing pins). **Dev-only Playwright
  hazard:** a TINY fixture artifact can resolve inside React StrictMode's double-mount window and fatally crash
  maplibre teardown (the dev overlay eats the app) — specs delay fixture routes ~500 ms + warm-reload once
  (documented in `compare.spec.ts`); production builds and real artifact sizes never hit it.
