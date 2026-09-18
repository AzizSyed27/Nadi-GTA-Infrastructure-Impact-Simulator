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
  - **Guard mode = ask (verified live, 2026-07-10 probe):** a PreToolUse hook (`.claude/hooks/guard.py`)
    routes Write/Edit/MultiEdit under `contract/` (and `.env`) through an `ask` approval (the old exit-2
    hard-block is retired) — make deliberate contract changes via Write/Edit and approve in the moment.
    Prompt: *"<name> is under contract/ — the FROZEN Python<->TS trajectory contract. Approve ONLY for a
    deliberate contract change: bump schema_version and mirror BOTH python/ and web/. Editing via Write/Edit
    is the correct path now — do NOT route contract writes through Bash/Python (that bypasses this guard)."*
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
- Agent LLM layer is PROVIDER-AGNOSTIC behind a thin adapter (`python/src/llm_provider.py`): an
  `LLMClient` Protocol + two adapters — `GeminiAdapter` (google-genai) and `OpenAICompatAdapter` (the
  `openai` SDK on any OpenAI-compatible `base_url`); one `PROVIDER_PRESETS` table (base_url, default_model,
  key_env) covers Groq / DeepSeek / OpenAI / Cerebras / Mistral / Kimi. **Layer default: Groq**
  (`openai/gpt-oss-20b` — free tier + strict structured JSON); select via env `PROVIDER` / `MODEL`, keys in
  `.env` (e.g. `GROQ_API_KEY`, `GEMINI_API_KEY`). **The report + agent pipeline (`report.py`, `server.py`)
  PINS DeepSeek** (longer prompts, ~13 slot calls, prefix caching): defaults to `deepseek` when `PROVIDER`
  is unset → `DEEPSEEK_API_KEY` must be in `python/.env`; the server's enrich subprocess `setdefault`s
  `PROVIDER=deepseek` (else `reactions.py` falls to Gemini's tiny quota — flash = 20 req/day, flash-lite
  often 503). **DeepSeek model = `deepseek-v4-flash`** (successor of `deepseek-chat`, retired 2026-07-24).
  V4 defaults thinking ON, so every DeepSeek path force-disables it — the adapter auto-sends
  `extra_body={"thinking":{"type":"disabled"}}` for any `v4` id (`llm_provider`), and the LightRAG
  (`report_agent`) + CAMEL cascade (`oasis_cascade`) paths pass the same via config — else `temperature` is
  a no-op and reasoning is billed as output. Temperature per-call: `report._call` 0.3 (deterministic facts),
  `reactions.py` 0.8 (persona variety). No model id from memory — confirm via docs-researcher.
  **Audit-retry canary:** the report's corrected-on-retry count is the model-drift signal (a meaningfully
  higher count on a model swap = investigate, don't push through; any UNRESOLVED fails loudly) — the first
  `deepseek-v4-flash` generation HELD the baseline: **2 corrected on retry (both `safety_direction` "safer
  streets"), 0 unresolved**. **BASELINE SHIFTS** (guard tightenings, not drift — compare against a
  post-change baseline; the next regen's count is the new baseline's FIRST READING): **2026-07-31** (V2.3b
  follow-up — the clause-bounded `_strip_disclaimers` re-check in `audit_prose`; disclaimer-paired claims no
  longer skip) and **2026-08-19** (V2.6 follow-up — `_CLAUSE_BOUNDARY` gained the coordinating adversatives
  `but|yet`, closing the comma-less-conjunction smuggle for ALL consumers at once: report slots, chat,
  cascade, interviews, the room). The boundary set is deliberately MINIMAL: and/or are never boundaries (a
  multi-object disclaimer — "cannot predict crashes or their probability" — must stay whole);
  though/although/however excluded too (review-caught: they commonly CONTINUE a disclaimer — "crashes
  however unlikely the probability" false-flagged as crash talk). Every exclusion is pinned
  mutation-effective; the excluded-connector smuggles are the accepted residuals.
- **Windows-native gotchas (LightRAG):** the per-run RAG index lives under `%LOCALAPPDATA%\nadi-report-agent\`,
  NOT the repo — OneDrive sync grabs a handle on fresh `.tmp` files and breaks LightRAG's atomic writes
  (`os.replace` → WinError 5). And LightRAG canonicalizes a doc's `file_path` to its BASENAME, so citation
  handles must be slash-free — we use `__` separators (e.g. `voice__shop_owner__v9`) — **and UNIQUE PER
  DOC**: the same canonicalization makes a repeated handle a `batch_duplicate` that LightRAG SILENTLY
  REFUSES, so a doc whose handle collides never enters the corpus and nothing says so. Found live in
  V2.7b C11 — the cascade-post handle was step-scoped (`social__<agent>__<cascade>__<step>`), an agent
  acting twice in one step is ordinary, and **424 of 1,740 posts never reached the chat corpus**; the
  handle carries the event's position now. (A further 410 were dropped as identical CONTENT under a
  different filename — that one is LightRAG deduplicating, correct, and not a handle bug.)
- **Windows-native gotchas (OASIS/CAMEL):** OASIS runs in a **separate `oasis` conda env (python 3.11)** —
  camel-oasis 0.2.5 pins `<3.12`, so it CANNOT run in base miniconda 3.13. That is a real **two-env boundary**:
  the 4.2 producer must call it as a subprocess / second service, not an in-process import. `import oasis` from
  base fails. Five traps, four from 4.0 and the fifth from V2.7b: (1) `generate_twitter_agent_graph` builds NODES but does NOT wire
  the CSV `following_agentid_list` edges — wire them with `AgentGraph.add_edge` or exposure is recsys-only, not
  graph-driven; (2) run via **`conda run --no-capture-output -n oasis …`** (plain `conda run` buffers stdout and
  re-encodes through cp1252, crashing on agents' non-ASCII text — the run still completes + writes its JSON); (3)
  OASIS scratch (profile CSV + sqlite DB) lives under `%LOCALAPPDATA%\nadi-oasis-spike\`, NOT the OneDrive tree
  (same atomic-write hazard); (4) `cairocffi`'s native libcairo is absent on this box but is viz-only — `import
  oasis` and a full run work without it; (5) the cascade subprocess writes CAMEL logs RELATIVE TO ITS CWD, so
  `oasis-<timestamp>.log` files accumulate in `python/src/log/` inside the repo — against the standing rule that
  scratch lives under `%LOCALAPPDATA%`. Gitignored since V2.7b C11 rather than committed; if the cascade's cwd
  ever moves, the ignore moves with it.
- **V2.4: the DRAFT BASKET is the editing model** (apply ADDS a member, one Run submits; clone-to-
  draft iterates) and **composites are MIXED-TYPE** (members = the four windowable runtime types;
  settled composites stay rejected) — details in the V2.4 blocks below.
- Use Plan Mode for any non-trivial change: present the plan + files to touch, wait for approval.
- Small commits.

## Current phase
**CURRENT STATE (the rollup — everything below this box is the per-step historical record):**
Contract **v0.10.0**. Phases 0–5, V2.0–V2.6, V2.7a and V2.7b are COMPLETE: the four-stage shell
(Build → Watch → Read → Explore) fronts the whole pipeline — Build composes
(draw a road — straight or BENT through via points (V2.6d) — / speed / bike lane / lane- & road-closures /
incidents / 🏫 school-zone COMPOSITES —
windowed changes apply+revert in-sim with proof logs), demand is synthetic or calibrated AM-peak,
assignment day-one or settled, seeds 1–3 with per-cell ranges; enrich = 212 voices → audited report +
"ask the report" chat → OASIS discourse; Compare (Explore · Compare) with the provenance-mismatch
guard. The calibrated
school-hours exemplar LANDED (`multimodal-scenario-20260727T180728Z`: zone pair 30-vs-28, no direction
claimed; the corridor SATURATES under calibrated AM peak — 72% delivered by 09:00). V2.2 is closed out and
TAGGED **`v2.2`**: every windowed run renders the WINDOWED-SCOPE DISCLOSURE (run-scoped scorecard vs
window-scoped change — report line + caveat + chat corpus + ScorecardPanel one-liner; unwindowed reports
byte-identical, golden-pinned). **V2.3 (a–d) CLOSED — contract v0.9.0 at c:** **a** SSE-streamed
enrich (`GET /api/runs/<id>/enrich/stream`; env-gated so CLI enrich stays byte-identical; voices
render incrementally, a dead stream degrades LABELED to the untouched poll) · **b** persona
interviews (`POST /api/interview` — SERVER-built one-agent grounding, ids-never-facts on the
wire, the live honesty guard with retry-once → in-character refusal, EPHEMERAL) · **c** the
INSTITUTIONS SPEAK (`grounding:"mandate"` — verbatim byte-pinned missions, facts-gated roster
TFS / TDSB / Transportation Services, DETERMINISTIC zero-LLM voices, cascade-excluded, never
impersonated; the pinned Playwright run STRUCTURALLY guarded against artifact-rewriting
enriches) · **d** the graph split-view (🕸 the two graphs side by side, server-precomputed
positions; influence connectors DASHED and separate from follow edges — only ~6% coincide, the
exposure note says so; exclusion rings = withheld-post METADATA never content; entity staleness
legible three ways; referendum guard extended with GRAPHS_BANNED).
**V2.4 (a–c) CLOSED, TAGGED `v2.4` (scenario composition — no contract change all phase):** the
DRAFT BASKET is THE editing model (palette applies + the zone macro ADD members, one Run submits;
draft blockers mirror the shared reason strings; the LIFO port boundary-pinned at the Python
pin's own numbers); COMPOSITES ARE MIXED-TYPE (members = the four windowable runtime types;
settled composites stay rejected); ⧉ clone-to-draft iterates any past run (name/note never
copied); both V2.2d dormant honesty paths gained PRODUCTION SIBLINGS (composite-null; the
detour's multi-member exclusion — doorstep Station 231, worst reachable +29.1 s; TFS spoke the
composite citation); runs carry a user name/note in the endpoint-only IDENTITY SIDECAR
(pinned-run guard extended, injection inert end-to-end). The calibrated windowed-closure
composite stays a DEFERRED exemplar (BACKLOG — synthetic acceptance stands).
**V2.5 (a–d) CLOSED, TAGGED `v2.5`:** **a** the disclosure batch (window-coincidence +
disjoint-span clauses + the edge-union pluralization; the institutional chat index PROVEN LIVE;
the singleton-drift forensic finding; the prettier hook leg REMOVED) · **b** rung-2 response
reachability (end-node probing REPLACED the anchor walk; labeled causal states
verify-RECOMPUTED; the added-time-to-reach vocabulary split; live: east end +1.7 s vs west end
+29.1 s, 231's origin-closed CAUSE) · **c** the two-jobs fix (latest.json = a POINTER, enriches
never repoint; DOUBLE acceptance — the 90 MB pointer AND the DELETED pointer both green 76/76) +
the measured frame budget (frame numbers are HEADED numbers — headless measures SwiftShader; the
trails data-identity memo A/B'd 48→74 fps; budgets ≤5 s @90 MB / ≤2 s @~20 MB / playback p95
≥30 fps) · **d** the presentable core (the 43.9 MB static Cloudflare demo build with
DISABLED-WITH-WHY controls + the labeled `artifact-load-error`, SETUP/DEPLOY/requirements docs,
the cold-reader README with the three computed facts' caveats verbatim; suites at close **471
pytest + 79 Playwright**).
**V2.6 (a–d + follow-up) CLOSED, TAGGED `v2.6` — contract v0.10.0 at c:** **a/b** the
group-interview ROOM (`POST /api/group-interview` — 3-5 voices answer SEQUENTIALLY, each hearing
only the others' ACTUAL WORDS; the ROOM-ONLY `cross_participant` guard with per-speaker keying;
refusals are answers, a room never aborts; audit dicts carry `calls`; UI rooms assemble via
trailing ＋ / 👥 buttons, the RATIFIED `speak` transport, the curation note "voices you picked…
not a poll or a sample of opinion" + the never-understating cost pair; the doctored-prefix pins
prove a client transcript can't reach grounding or forge attribution; ephemeral) — the
**follow-up** closed the SHARED disclaimer-strip conjunction hole (`_CLAUSE_BOUNDARY` gained
`but|yet` for EVERY consumer; the V2.6b room fork deleted; the and/or residual pinned as a
decision; the audit-retry BASELINE SHIFT recorded) · **c** the 0.10.0 payload CEREMONY
(per-entity {t0, dt} XOR explicit timestamps with teleport holes kept TRUE, speeds DROPPED for
the stamped `worst_t`, 6-dp coords, `new_road.via` as refused capacity; the full gate ceremony;
the TS dual-path reader normalizes once per entity-array identity; MEASURED: gzip 26.9→7.6 MB
(-72%), nav→render 3.7→1.8 s, frames identical; committed fixtures stay at their vintages).
**THE RESOLVER-FAMILY FIX (2026-08-21):** the twice-fired lexicographic newest-pick bug is DEAD
family-wide — `trajectory_io.newest_ts_named` (digit-first; junk warned by name; junk-only exits
loudly naming the flag; CLI/subprocess-contained severity) backs newest_instrumented /
newest_outcomes / report._resolve / scorecard._resolve / robustness + the golden picks;
`newest_index` is ALIGNMENT-FIRST (latest-report's run → its index; the V2.5a drift class dead
structurally); run_state.list_all orders junk LAST (inventory, never filtered); settle's iteration
dirs sort NUMERICALLY (string-sort took iteration 9 of 0..11 — the V2.1c settled deliverable's
re-verification OPEN in BACKLOG). Both old fix candidates counterexampled (strptime by the SEED1
probe; mtime by OneDrive resync). Suites: **567 pytest + 91 Playwright**.
**V2.6d — the CURVE:** the via capacity CONSUMED — via = `'lon,lat'` coordinate-pair strings in
the existing `list[str]` (RECORDED DECISION at all three mirrors; no bump — 0.10.0 shipped the
field capacity-only, this is its FIRST meaning; a 0.11.0 `list[list[float]]` bump deliberately
declined); the FOUR geometry rules in ONE source with IDENTICAL sentences at POST 400 / harness
SystemExit / `patch_network`; a shape-faithful producer + strict-count readback; click-time-
validated BENDS in the editor (Escape undo; the equirectangular-vs-UTM gap a RATIFIED residual);
playback renders the curve. Accepted live on `multimodal-scenario-20260823T020424Z` (a 3-bend
connector, 4 cars on the new road, 7 rerouted); two earlier honest-zero curves kept as findings
(a curve changes geometry, not demand).
**V2.7a IS COMPLETE (the shell, the landing, the run document — six commits C1–C6, every one
leaving both suites green):** the FOUR-STAGE SHELL (Build → Watch → Read → Explore, one
workflow with derived done-checks) replaced the mode toggle — appearance from the ratified
Claude Design import (Industry DS vendored as `web/app/nadi.css`, Barlow/Barlow Condensed via
next/font; element styles scoped `.nadi-shell`/`.nadi-doc` so carried components are untouched
by construction). READ IS THE RUN DOCUMENT (`RunDocument.tsx`): spec table + 2.4 render from
the ARTIFACT (never the report snapshot); stat callouts from the C1-widened `report_json`
`facts` block (the ~17 markdown-only facts, keys always present, null = honest absence, model
vintage fields JSON-dumped); prose ONLY from the EXISTING audited LLM slots (abstract =
what_tested.framing; 2.4 row sentences = the glosses); payload honesty sentences render
VERBATIM beside their numbers; 2.4 = the ratified three-bucket 1d form (MOVED / DIRECTION
UNCLAIMED / NOT MEASURED, fixed group order never effect size, span-zero bands, single-group
doorway → Watch + feed filter; the two-group room CTA deliberately absent → V2.7e); method
notes numbered with footnote sups (the settled note = the CAVEAT ONLY); the colophon DERIVES
(no test counts) and keeps the fails-the-test-suite sweep sentence. PER-RUN REPORTS: report.py
writes `web/public/<run_id>-report.json` (graphs-sidecar pattern) + `--refresh-facts --run-id`
re-derives code-rendered fields reusing stored LLM prose + audit BYTE-identically (zero LLM;
never the pointer); committed for the pinned + EXAMPLE runs (gitignore-negated, shape+value
pinned incl. the example's +1.7/+29.1/origin-closed literals, mutation-checked); the client
carries a run-id VINTAGE GUARD (labeled `report-mismatch`; 404 → labeled `report-missing`).
THE LANDING: ?run= → localStorage `nadi:lastRun` (validated) → the latest.json pointer →
EXAMPLE_RUN_ID (`…20260814T063253Z`, committed; kicker "EXAMPLE RUN · LOADED READ-ONLY · A
PREVIEW, NOT A VERDICT"; Build = the read-only composition view + "Start a new draft");
default stage READ; the demo build writes its pointer AT the example; the cold-profile walk
PASSED live. Ride-along 6a landed as an INVERSION (a payload-shaped latest.json → the LABELED
error path — deletion alone would have loaded it silently; NEW spec pin). THE RUN LIST
(`RunListPopover`, the ratified §2b): the header run tag expands into the inventory (plain-terms
fingerprint via `/api/runs` passing state-file fields through; CLONE TO DRAFT / OPEN / COMPARE
AS A·B; computing rows show their stage and open in their current state; "viewing" keys on the
run you explicitly OPENED so the landing run keeps its watcher/enrich path; an inventory NEVER
a ranking — framing sentences pinned + a rows-only delta/score sweep); the edit-rail RunSwitcher
retired (Compare keeps both pickers); the runLabel-precedence + XSS-inert pins RELOCATED to the
list rows. THE SINGLETON RETIRED (C5): latest-report.json is a POINTER written by generate()
(`report.served_report_run_id` is the ONE tolerant reader — newest_index alignment, the server
canary, and GET /api/report all ride it; /api/report returns the REPORT'S OWN run id); the
committed payload singletons are DELETED + gitignored (suite ran green with them absent — the
V2.5c double-acceptance form; the 2026-08-13 two-day-red class cannot recur). THE PROTECTED-RUNS
SET: the example joined the pinned run's enrich + identity guards (role-specific refusals, both
language mirrors in one commit; report enrich stays exempt). The C6 ceremony: the example's
report REGENERATED under the full realign ceremony — **the conjunction-baseline canary read
8 clean / 1 corrected / 0 unresolved, IDENTICAL to V2.6c's first reading (no drift)** — index
rebuilt, alignment + pins + discourse.spec re-proven. The sweep CAUGHT a real pre-existing gap:
the code-rendered tail sentence said "the vast majority of cars unaffected" (referendum
vocabulary no old sweep covered) — reworded at both sources (report.py, robustness.py), golden
regenerated deliberately. Sweeps ride **23 of 28** spec files (measured; the FIVE without one are incident / institutions / scorecard-scope / via-rules — geometry strings, overlays and a scope note — plus V2.7b's `edit-guard`, which pins filesystem drift and renders no prose at all; the institutional PANEL's prose is swept where it streams, in act-two). ReportPanel is DELETED; chat lives
at Explore · Chat; shared composers extracted (windowedScope/scopeNoteText, provenance labels,
nonCompletionsLine) so pinned sentences have ONE source across surfaces. **PERF RE-MEASURED (headed, prod, this box — the V2.5c harness + a stage-watch hop since the landing defaults to Read): 90 MB fat-vintage exemplar nav→render 3.77 s (budget ≤5 s; pre-shell 3.72 — no regression), frames p50 8.1 ms/123 fps · p95 16.1 ms/62 fps · 0 longtasks (pre-shell 122/61 — identical; the document panel never subscribes to the rAF clock); pinned ~20 MB run nav→render 1.14 s (budget ≤2 s), 125/63 fps.** Suites: **595 pytest
+ 123 Playwright**.
**THE V2.7a FOLLOW-UP (the landing document's two flags + three smalls — two commits atop C6;
no contract change):** **F1 — the cross-seed sentence derives from THIS run's seeds** (honesty
fix): the example's committed report shipped "checked across seeds 42, 43 and 44 … stable tail"
beside `cross_seed_available: false` — `report._cross_seed_sentence` hardcoded the canonical
tuple in both branches. Now THREE derived shapes: verdict-backed (`v.get("seeds") or
facts["seeds"]` — legacy verdicts lack the key, never KeyError), multi-seed-no-verdict ("no
cross-seed tail range was computed"), single-seed ("Single seed (42) — cross-seed stability of
this tail was not probed for this run" — no "checked" language, no foreign seed digits). Golden
regenerated DELIBERATELY (it now pins the honest single-seed sentence); BOTH committed reports
refreshed via `--refresh-facts` (zero LLM; prose+audit byte-reused); pins mutation-effective
BOTH directions; dead `DEFAULT_SEEDS` deleted; scorecard's CLI print derives; the
`scorecard._SAFETY_NOTE` sibling ("42/43/44" baked into committed single-seed artifacts' cells)
is a recorded BACKLOG ceremony, not fixed here. **F2 — the document's name (the static-demo
identity gap):** `report_json.run.name` is stamped from the identity sidecar at BOTH generate +
refresh (absent key = unnamed) — the static demo's only name carrier; RunDocument title
precedence = live identity → report `run.name` → mechanical; the live name reads `/api/runs`,
NOT `/status` (the SEQUENCED-MOCK lesson: a status fetch consumed a step of seeds.spec's staged
progression — new reads source from statically-mocked endpoints); `EXAMPLE_RUN_NAME` ("Closure
at the fire station's doorstep", `web/lib/demo.ts`) is THE single source (the run-list row + the
one-source spec pin reading the committed report's bytes); the example's name was stamped
through the ONLY sidecar writer (the identity POST) under `NADI_ALLOW_PINNED_ENRICH=1`, then
`--refresh-facts` (report refresh exempt; override restored after) — the documented
PROTECTED-RUN identity-maintenance op; markup-inert pin (the V2.4c convention) + the
`doc-members` no-duplication pin (scoped after a scope-note false positive). Smalls: the Build
banner/legend overlap confirmed fixed by a looked-at screenshot; the LIVE vintage-guard repro
rendered the labeled `report-mismatch` refusal verbatim (bytes restored cmp-identical); the cold
landing re-walked — the ratified title + the single-seed sentence
(`docs-assets/v27b-followup-*.png`). Suites: **601 pytest + 129 Playwright**.
**V2.7b IS COMPLETE — THE RUN EXPERIENCE (two acts over one event stream; C1–C11b; NO contract
change all phase). Through C10b every commit left BOTH suites green; C11b's fix commits shipped on
the targeted specs with the full Playwright gate riding the closeout — where it caught the C11
mount predicate breaking the manual-enrich→playback flow, fixed before this record landed.** a run is legible as **ACT I, the
physics** (the baseline leg playing while the scenario leg computes, four timestamped beats, no
LLM, a held moment that PROVES the cleanup) and **ACT II, the interpretation** (six stage cards
streaming content, never machinery). The governing constraint is structural, not editorial:
**results are complete the moment Act I ends** — `report.py --facts-only` writes the figures with
prose slots ABSENT and no pointer, so the results band appears before any model runs, and
everything after it is skippable, failable and labeled at its honest cost.
**FIVE SERVER PILLARS.** (1) `run_events.py` — ONE NDJSON file per run's whole LIFE (renamed +
widened from enrich_events; truncation and `prune()` moved to BOTH simulate launch sites), SSE
`id:` = absolute line number, `Last-Event-ID` resume, replay-from-0 idempotent — and **the terminal
became STATE-DRIVEN**: end-of-stream is EOF + lock free + run-state terminal, `run_ended` is
CONTENT (it labels HOW a run ended) while `stream_end` is CONTROL. **A replayable log cannot encode
its own end:** with no truncation, a content-terminal would have closed the client's stream after
stage 1, and a skip's terminal would sit INTERIOR to every later replay, permanently. (2) The
LEDGER (`run_ledger.py`, `<run_id>.ledger.json` — the FOURTH file class under STATE_DIR, skipped by
`list_all`, four-class coexistence pinned, ONE writer like the identity sidecar). (3) The STAGE
RUNNER: after a successful simulate the chain continues through six PRESENTED stages under ONE held
lock — presented stages are NOT subprocess boundaries, the runner maps subprocesses onto them via
events; `release(run_id)` became compare-and-clear three commits before skip armed the lock-stealing
window it closes. (4) The EARLY BASELINE EMISSION — a contract-valid 0.10.0 artifact of the baseline
leg the moment that leg ends, REPLACING the old write-only `_write_provisional` dump; synthetic
only, with the calibrated profile's honest second state (its spill is freed by design). (5)
`report.py`: `--facts-only`, the PERSISTED pre-retry draft (so "view the correction" is a record,
not a reconstruction), and per-slot events.
**THE CLIENT IS A PURE FOLD** (`web/lib/runFeed.ts`): `foldEvents(seedFromLedger(ledger), events)` —
a reload mid-run rebuilds the same screen because the experience IS the projection; no React state
holds anything the file doesn't. `useRunFeed` owns the poll AND the stream (lifted out of RunCard,
which mounts only in Build).
**THE BRAKE AND THE FLIP:** a cooperative cancel FILE (subprocess-reachable, which an in-process
flag is not) with four checkpoints, each assembling and writing what landed — never a fabricated
voice to fill the gap; skip routes to Read ON THE BUTTON CLICK, never on the terminal edge (only
the user's own click moves the user); the cost line and the Run button's pre-spend sentence ship in
the SAME commit as `NADI_AUTO_ENRICH`'s default flip, so no commit window exists where pressing Run
auto-spends with no brake and no cost on screen. The Run button's M comes from ONE server function
with TWO callers (`GET /api/projection` pre-run; the ledger at chain start) — the client renders the
number and basis VERBATIM and computes nothing.
**C7 — A PREMISE FALSIFIED, AND THE FIX DELIBERATELY NOT BUILT.** The plan entered C7 calling the
feed isolation "a measured perf fix", on a C3 reading of ~6.3 s of main-thread block across five
voice appends. Measured through the REAL handler (`perf-harness --appends N [--appends-live]`,
headed, prod, the 90 MB exemplar): **0.7 ms p50 per append, 157 ms total across all 212**, and
during live appends at the observed cadence **p95 70 fps against a ≥30 fps budget** — one frame per
second of fps versus the idle control, inside noise. What C3 measured was a gap between two status
polls in a DEV-SERVER Playwright run: the gap was real, the attribution was an inference. So the
FOLD was built (it is what makes reload-reconstruction possible — a reason that never depended on
perf) and the isolation and batching were NOT, per the ratified measurement-gated protocol. The
batching seam is recorded rather than built: batch the artifact MERGE, never the fold, or the
"voices arrive one at a time" pin goes green against the wrong surface.
**THE C6 SPLIT THE COMMIT GRAPH DID NOT TAKE.** C6a (the chain) / C6b (the brake) was decided at
plan time and the code was written in that order, but the diffs interleave inside the same functions
across six shared files, so the graph carries one commit; the boundary survives in the test files
(`test_stage_runner.py` / `test_skip_resume.py`). Recorded rather than absorbed — the C8a/C8b split
that DID hold shared zero files, which is the whole difference.
**C10's LEDGER OF WHAT THE HONESTY PASS FOUND:** the terminal-state hole was **three exit paths**,
not one (the pinned-run refusal and the no-auto-enrich path wrote no state at all — post-flip a
completed run would have sat in the run list as "computing" forever) **plus a `failed→done`
transient** a 1.5 s poll could legitimately observe; closed by a parametrized PROPERTY test over
every exit path asserting terminal state AND a free lock. The cancel file had ONE `clear_cancel`
call site (resume), so a stale flag made the next manual enrich generate ZERO voices and exit 0
reporting "complete" — latent until C10 shipped the button that makes skipping routine. The
**"unreachable" DIRECTION INVERSION**: the mechanism routes station origin → segment end, the
row-level note was already direction-correct, and the aggregating citation inverted it into a claim
that the STATION could not be reached — fixed at three composer sites, and **the committed artifacts
keep the old wording** (citations are composed at enrich time into `agents[].citations`; both
carriers are protected runs), a KNOWN-VINTAGE DIVERGENCE stated here because a reader will meet two
wordings. The border-longhand ESLint ban found **two live instances** of the bug it was written for
(`EdgePalette` `kindActive`, `RunListPopover` `rowViewing`) — and a `:has()` pair selector would have
caught NEITHER, because the dominant idiom spreads the longhand over a shorthand-carrying base so
the two never share an ObjectExpression.
**C11 — THE LIVE ACCEPTANCE FOUND TEN DEFECTS, AND THE CONSENT NUMBER WAS ONE OF THEM.** Run A
(`multimodal-scenario-20260907T225651Z`, synthetic day_one, a windowed closure at the fire station's
doorstep) metered **5,205 model calls**: voices 213 · discourse 2,231 · report 10 · **chat index
2,751** — against a projection of **1,815**. It had counted the cascade agents but not
propagation's own stance SCORING of what they said (701 calls, `score_trajectories`), and counted
the chat index at ZERO when it is the single largest stage. The seeding round is genuinely free (it
posts the verbatim round-0 reactions). Both terms are now MEASURED constants with their derivation
in `_project_interpretation`'s docstring, the basis names all four terms, and a pin asserts the
projection sits ABOVE the measured run — **understating is the one direction a consent number may
never err in, and it had been erring in it since C10a wired it.** The other eight: **Act II never
mounted for the reader who STARTED the run** (a chained run passes THROUGH `done` between the quant
leg and the chain's first stage write; the act keyed on the polled status, which also stopped the
poll, so the interpretation ran invisibly and a reload was the only recovery — it keys on
`sawStream` now, which keeps the ratified live-only property because a reopened finished run opens
no stream); **the poll never restarted** (it does now, on a `stage_start` after a stop, bounded to
one restart per stage key); **a live run reported as `failed — stale`** (`run_state.read`'s
30-minute coercion fired on the chat index at 37 minutes of honest work — staleness is a GUESS about
a process nobody can see, the LOCK is a FACT about one this process owns, so the held lock now
outranks it, scoped to the run holding it); **`applied_ok` was emitted and rendered by nothing** (a
verified apply showed the same neutral dot as an unverified one); **a group's verdict overturned
stages that had already reported** (`enrich:voices` covers three presented stages, so a failed group
end marked a completed personas stage failed — and which reading a reader got depended on whether
the ledger or the stream landed last); **424 of 1,740 cascade posts never entered the chat corpus**
(the doc handle was step-scoped, an agent acting twice in one step collided, and LightRAG refuses
the repeat as `batch_duplicate` — a further 410 were dropped as identical CONTENT under another
filename, which is LightRAG deduplicating and not a defect); **the live cost line had no
denominator** for that same primary-path reader (the ledger's projection is written at chain start,
after the mount-time seed); and **the degraded block printed a provider's authentication dump three
times** in a document whose rule is content and never machinery. And the tenth, found by taking a
skip INTO the discourse stage (where an ordinary skip lands — the loop checkpoint deliberately
never fires on i=0, so cascade 1 always completes): the cancelled scoring pass left `trajectories
= {}` where `Social.trajectories` is a LIST, so **a mid-stage skip lost the whole stage** — the
cascade already generated, audited and PAID FOR never reached the artifact and the stage ended
`failed` with a validation traceback. The brake was dropping the thing it exists to keep. Every
other cancel checkpoint audited for the same class (reactions returns None and filters matched
pairs; report's partials match their declared types).
**DISPOSITION: ALL TEN WERE FIXED IN C11b — none were banked** (verified by re-reading the tree at
the V2.7b closeout, not from the commit messages). **Two residuals ride them, both recorded in
BACKLOG rather than left to be discovered:** the corpus-handle fix is FORWARD-ONLY, so every index
built before it keeps its gap — including the PINNED run's SERVED chat index, measured at **115 of
its 1,355 cascade posts (8%)** dropped by the old step-scoped handle; and the staleness fix is
scoped to the process HOLDING the lock, so a CLI reader or a restarted server still coerces a long
stage to `failed` (the honest answer there — neither can see the lock).
**MEASURED, LIVE (synthetic day_one, no max-t override — the pace no doc recorded before):** quant
(both legs + analysis) **7 m 03 s**, results readable at **7 m 15 s**, then personas 10 s · voices
57 s · discourse **12 m** · report 30 s · chat index **62 m** — 1 h 23 m end to end, of which
everything after 7 m 15 s is optional. The brake: **1.6 s** from a skip's cooperative exit to the
next run starting (≤13.6 s click→next POST accepted, bounded — the poller was already running when
the button was pressed).
**THE MOUNT FIX MOVED TWICE BEFORE IT LANDED, AND THE FULL GATE IS WHY.** The first attempt
replaced Act II's liveness clause (`watchedRunLive`) with "did this session see the stream". It
passed its own pin and broke FIVE brake specs, because the clause it removed was also the UNMOUNT:
with it gone, Act II owns Watch forever and the playback a reader goes to Watch FOR is unreachable
without a run swap. The second attempt ended the act on `run_ended` instead and broke the two
enrich-stream specs the other way. **The predicate was never the bug** — the POLL was. It stopped
at the terminal blip and never restarted, so the status froze and no predicate reading it could
recover. The shipped fix restarts the poll on a `stage_start` arriving after a stop (bounded to one
per stage key) and leaves the ratified predicate exactly as it was. Two lessons paid for here: a
green pin on a changed predicate says nothing about the predicate you did not change, and **the
restart was DEAD CODE for its first three hours** — written as `ev.type` where `RunEvent`'s
discriminator is `ev.event`, the same silent-name shape as C7, and invisible until a pin modelled
the server's ORDERING (chain events arriving AFTER the terminal blip) rather than delivering every
frame at mount, which is what made the restart necessary for the test to pass at all.
**PERF RE-MEASURED (V2.5c harness, headed, prod build, this box; committed fixtures at their own
vintages, so the fat run is comparable to V2.7a's 3.77 s and NOT to V2.6c's re-encoded 1.83 s):**
90 MB fat vintage nav→first-render **3.67 s** (budget ≤5 s; V2.7a read 3.77 s — no regression),
fetch 2.74 s · parse 3.27 s · heap 190 MB · frames p50 13.6 ms/74 fps · p95 14.0 ms/71 fps · 0
longtasks; the pinned ~20 MB run **1.11 s** (budget ≤2 s), 141/71 fps. Act II cannot mount over a
committed artifact (it is live-only by design), so this measures the shipping state for those runs
— the streaming path's cost is C7's direct A/B, which is the honest half to quote for it.
**AND A MEASUREMENT LESSON, PAID FOR IN THREE READINGS:** the first pass read **5.07 / 4.95 / 5.13
s** and looked like a 34% regression against V2.7a. It was the BOX — an API server, a prod server
and a live WebGL browser page running alongside — and the tell was that the growth sat in FETCH
(3.8–4.0 s vs 2.74 s quiet), which is I/O, not the app's own work. Quiet the box before believing a
frontend number, the same family as the headed-vs-SwiftShader rule: the harness measures whatever
the machine is actually doing.
**A REAL OVERLAP THE HARNESS FOUND, which no seam test could have:** its stage-watch hop could not
click Play, because the collapsed document strip — left-anchored, full height — sat squarely over
the playback bar's left end, where the Play button is. The button was present, visible and enabled
the whole time; it was covered. `DocumentPanel` takes a `bottomOffset` now and Watch passes the
bar's clearance.
**THE LESSON LEDGER:** (a) **a pin on the LABEL is not a pin on the THING** — the act-one mock's
ghost `target_edge` matched no network edge, so the outline the caption promised had never once
rendered while its caption assertions stayed green; both empty-map states are now pinned on entity
COUNTS and the ghost on `ghost === 1`. (b) **A replayable log cannot encode its own end** (the
state-driven terminal). (c) **The wrong-run render class and its TWO predicates** — the map asks
*"is anything on screen the wrong run's?"* (`watchedRunNotLoaded`), the narrative asks *"is a run
being simulated in front of me?"* (`actOne`); six instances surfaced in C8b's territory alone, so
every C9 panel answered both AS IT WAS WRITTEN rather than in a sweep at the end, and the same
family produced C11's mount bug. (d) **A pin that cannot fail is worse than no pin** — C11's
denominator test passed with its own fix reverted twice (Playwright runs the LAST-registered route
handler first, so a delay registered before the mock it meant to delay never ran; and the ledger
seed won the race anyway), until it was rebuilt to reproduce the gap BY CONTENT — no projection on
the first ledger read, one on the second, which is the server's own sequence and cannot be raced.
**THE V2.7b CLOSEOUT CLEANUP (five items before V2.7c; `54dc44b` · `3971bca` · `21ba6a5` ·
`319e096` · `a9f1d04` · `cf6a71f`).**
**THE NETWORK-ONLY GATE IS CLOSED BOTH WAYS.** The permanent half is `act-one.spec.ts`'s
failed-fetch case — `baseline_ready` delivers a url and that url 404s — asserting the caption HEAD,
the entity counts through `__nadiRenderStats` and `ghost === 1`; it is mutation-effective BY
CONSTRUCTION, because reverting `entitySource` to the pre-C8b `preview ?? artifact` fails it, which
is the exact bug the state exists to catch. The live half ran on a real run with the baseline
artifact renamed out from under the client (`docs-assets/v27b-c11-network-only-live-probe.png`,
beside the spec's `v27b-c11-network-only-blocked.png`). **Two method facts, recorded so the probe is
not misread later:** the rename waits for `baseline_ready` because that event is POST-write by
construction (`scenario_harness.py:1316-1318` completes the write, THEN emits), so it races no
writer — while `results_ready` could not be the signal at all, since a chain-off run goes terminal
at quant completion and a terminal run opens no stream, leaving no Act I to observe. And the probe
reached the live run **through the run list because that was the only route that attached the feed
that day** — after F3 a plain reload reaches the same state, so the run-list route is a property of
that day's shell, never a property of the state.
**F3 — THE FEED'S RUN IS NOT THE RAIL'S RUN.** `activeRunId` had acquired a second meaning by
accident: the Build rail keys on it (a non-null value swaps the draw card, palettes and DraftPanel
for RunCard — EIGHT spec files depend on that rail), map drawing stops on it
(`drawing = editing && activeRunId == null`), and the run list's "viewing" row keys on it, which
also removes that row's OPEN button. So the feed got its own id — **`feedRunId`** — and every
`setActiveRunId` site pairs a `setFeedRunId`. The landing attaches ONLY from durable evidence that
THIS reader was watching THAT run (`localStorage nadi:watchedRun`, read with a LAZY useState
initializer, because the effect that mirrors the id into storage runs first with the id still null
and would clear the key before the landing could read it — every reload would have looked cold);
liveness is decided from **`/api/runs`, never `/status`** (the sequenced-mock rule), keyed on
**`art.meta.run_id`** and never the pointer alias, whose `default-fixture` id would mount Act I over
a finished run. With nothing remembered the landing does nothing at all, which is what keeps the
ratified silent-404 pin true for the overwhelmingly common cold landing. The root cause it answers:
**a computing run has no artifact yet** (`/<id>.json` 404s until the quant leg ends), so the landing
falls through to the last run actually VIEWED and shows that instead — the events file was durable
the whole time, and only the pointer to it lived in memory.
**TWO CATCHES THE SUITE MADE AND REVIEW WOULD NOT HAVE.** The first working rule attached to
whichever run `/api/runs` reported running, and that HIJACKS — deliberately opening run A while B
computes yanked the map into B's Act I, A's agents blanked, without asking; the act-one suite caught
it as a CONTROL assertion going 1 → 0, the same wrong-run-render class C8b was written to close. And
the act-one fixture's two endpoints described different worlds (`/api/runs` said `running` while
`/status` said `done` for one run), invisible until the landing began consulting the list; both read
one source now, with `/api/runs` deliberately NOT advancing the poll counter.
**One residual banked rather than invented** (BACKLOG): on a FAILED baseline fetch the caption head
is right while the body still falls through to the pending wording, promising playback that will
never land — new reader-facing copy, so it wants ratifying, and the spec pins the head and the
entity counts either way.
Suites at the V2.7b close: 689 pytest + 185 Playwright.
**V2.7c IS COMPLETE — MAP STYLING (the transit-map palette, the zoom ladder, the curved-road restyle;
six commits C1–C5 (C2 split a/b), every one gated on the FULL suites; NO contract change, NO data change —
network.json / golden / artifacts byte-identical after every commit, checked; plan + execution log at
`~/.claude/plans/begin-v2-7c-map-styling-shimmering-kernighan.md`). Suites at close: **693 pytest + 217
Playwright**. THE DESIGN DELTA GATE — CLOSED 2026-09-12: **canvas matches recovery.** It stayed PENDING all
arc (the 0.4 canvas needed `/design-login`, refused twice; the arc shipped on the recovered cleanup-turn text
under the stated rule — recovered-text-wins unless the user re-ratifies from the canvas). After `/design-login`
the canvas was read through `DesignSync get_file` on the design project "Nadi traffic simulation redesign"
(`36ad50f3-…`, the id in `docs-assets/design-v27/README.md`) — NOT the "Industry" design-system project that
`list_projects` returns, which is why the earlier attempts found nothing. Every transcribed value the arc
was reviewed against is in the 0.4 canvas verbatim: the eight palette hexes bound to the same MAP KEY labels,
the 0.7 opacities, z ≥ 15 / z ≥ 16, "one chevron per 160 screen-px per direction" (+ `{{ arrowEvery }}` in
§1b), the on-screen-geometry curve rule, the three ladder paragraphs, the centerline rule (1.4 solid + a
`9 12` dash on #f2f2f3), the draw-preview sentence (in canvas §1e — the recovery labelled it §1d, a label
slip, no value change) and the printed-transit-map intent. The delta table is EMPTY; no ratification stop.
Two recovery-SILENT details recorded for V2.7d (not contradictions): the canvas draws the collector dash
1.1 wide (shipped 1 px, under the 1.4 arterial) and its z ≥ 15 stripe illustration is `14 11` at 1.6 while
shipped stripes are `[4,4]` path-relative at 1 px — mockup geometry, import rule 1. **THE p95 A/B
(2026-09-12, same box, both trees rebuilt and measured in one session, quiet box):** the pre-C2a tree
(`84b934e`) read p95 **14.0 / 14.0 / 13.9 / 14.0 ms** (fat fit / z15.2 / z16.5 ×2) and **14.0 / 14.0 /
13.9** (pinned fit / z15.2 / z16.5); the shipped tree (`8119ad8`) read **14.1 / 14.0 / 14.1** (fat fit /
z16.5 ×2) and **13.9** (pinned z16.5) — IDENTICAL. The 16.0–16.1 ms readings recorded at C2a–C5 were
ENVIRONMENTAL (the 144 Hz display's 8/16 ms quantum on those runs, not the 7/14 one), not styling's cost:
at frame level the restyle costs less than one vsync quantum on both artifacts. The crossing probe read
56 ms on the fat run today (32–39 at C4/C5; still far under the 100 ms selector). THE ARC'S CONFLICTS TABLE (ratified vs shipped, all
recorded): the sidewalk derives from `allows.ped` + a pinned net invariant (no per-lane table on the wire —
V2.7d's); the bus band renders nowhere (no data); the bike band renders for the bike_lane CHANGE only; the
collector centerline dash is a z ≥ 15 rung (z13 stipple, looked-at); the chevron glyph and the mode-icon
floor scale/floor by pixel pitch (looked-at levers inside the rules); the ghost is a dark/light PAIR (the
arc's gate, passed). NO design retreat was taken: readings 4(a) (z15 stripes), 4(b) (two-way chevrons) and
C4's icon rung all shipped as ratified. The BEFORE/AFTER pairs per band: `docs-assets/v27c-before-z*.png`
vs `v27c-after-c4-z*.png` (the final corridor state; C5 changes no corridor pixel), plus the ghost pair,
the icons crop, the draft curve and the V2.6d connector in playback.** **C0 (the
baselines, 2026-09-11):** the design DELTA GATE is PENDING — the 0.4 canvas needs the user's
`/design-login`; the arc runs on the recovered cleanup-turn text (recovered-text-wins unless the user
re-ratifies from the canvas; any delta = a ratification stop). Quiet-box, headed, prod: 90 MB fat
nav→render **3.91 / 3.78 s**, p95 **14.1/14.0 ms (71 fps)**, 0 longtasks; 20 MB pinned **1.13 s**,
p95 14.0 ms — the C11 class. **A measurement fact, paid for at C1: this box's display is 144 Hz, so
p50 is BIMODAL (7.0 or 13.6 ms — one vsync quantum or two) and swings between runs of an identical
tree; p95 is the budget number and it holds at 14.0 ms in every run.** **C1 (the seams + the
byte-identical extraction):** `web/lib/roadLayers.ts` builds today's three base layers as a PURE
function (the graphLayers precedent) and owns the ladder's thresholds (`BAND_LANES_ZOOM` 15 /
`BAND_ICONS_ZOOM` 16, `zoomBand`, `quantizeZoom` 0.25); `web/lib/mapPalette.ts` holds the road
literals (values unchanged); MapView derives a quantized `band` from the map's OWN zoom events
(`<Map onZoom/onMoveEnd>`, first read in `onLoad` right after the synchronous fitBounds — `mapRef` is
null in mount effects until the artifact lands; refs compare before setState; continuous zoom never
enters React state). Seams are SIBLING globals of `__nadiRenderStats` (its whole-object pin forbids
new keys): `__nadiViewport {zoom, band, jumpTo}` (jumpTo late-binds the REAL map through the ref) and
`__nadiRoadLayers {band, zoomQ, layers[{id, visible, count}]}`. `map-ladder.spec.ts` (+5) pins the
band literals both sides of each rung, the landing = far with hand-computed layer counts over a
3-edge fixture net, the rung crossings, render-stats untouched across a crossing, and a real-net
structural smoke. `scripts/map-shots.mjs` (the pixels arc's vehicle: prod, 1600×1000, one frame per
band at a FIXED centre) and `perf-harness --zoom Z --center lon,lat` landed; the BEFORE triple is
committed (`docs-assets/v27c-before-z{13,15_2,16_5}.png`, centre `-79.2274,43.7644` = the example
run's three change edges, t=900) — the z13 frame shows the arrow clustering the arc exists to fix.
Zoom baselines (this tree, identical rendering to C0): fat z15.2 / z16.5 p95 14.0 ms, pinned 13.9 /
13.8 ms. Expected red at C2a and nowhere else: edit.spec's `__nadiArrowCount > 0` (it was). The C1 gate: **693 pytest + 190 Playwright** — the Playwright 190 ran as 138 + 20 + 20 + 12 on ONE unchanged tree because this box's memory watchdog killed two background runs mid-suite ("worker process exited unexpectedly"; 3.1 GB free with the user's Chrome open) — foreground chunks under the 10-minute cap are the working shape here. The pytest pin `test_lane_model_invariant.py` landed in C1 (it hashes nothing the guard covers) and its FIRST RUN found residual 3: six off-width car lanes.
**C2a (the far band, LANDED):** `web/lib/roadGeometry.ts` — the LANE MODEL (`allows.ped` ⇒ one 2.0 m sidewalk at index 0, the rest 3.2 m car lanes; three stated residuals, all pinned by `test_lane_model_invariant.py`), `offsetPolyline` (signed metres, negative = LEFT of travel, mitered), `metersPerPixel` (512-px world), `deriveRoadRows` (body at true car width offset off the sidewalk; the 2.0 m ribbon at the curb; the painted centerline on each two-way direction's inner boundary — solid ARTERIAL (≥2 car lanes) at every zoom, dashed COLLECTOR built at load but `visible` from the lanes band only: **the first C2a z13 frame showed the collector dash dithering every residential street into a stipple** (1.4 px dashes on a 2 px road, two directions at different phases) — a c-side lever, since the design's legend lists styles, not zooms). The transit palette (`mapPalette.ts`: ROADWAY #515459 / SIDEWALK #d2d2d5 / CENTERLINE #f2f2f3 / CHEVRON #96625c / BIKE_BAND #8fae87 / TRAVELER #2f3133) replaced the V2.0b casing/fill/whisper-green; V2.0b's one-arrow-per-one-way-edge RETIRED (the far band is centerline only — the pre-named red, edit.spec:274, replaced by a road-body count over its mock). Perf (final tree): fat 4.23 / 3.80 / 3.69 s at fit / z15.2 / z16.5, p95 16.1 / 16.0 / 15.6 ms; pinned 1.13 s, p95 ≤ 16.0 ms; heap +6 MB. Gate: 31 targeted Playwright + tsc + lint; the FULL gate rides C2b.
**C2b (the legibility pass, LANDED):** THE GHOST GATE PASSED — the ghost is a PAIR over the same items (a dark casing under a dashed light core; the seam's `ghost` stays an item count; act-one untouched): on the #515459 roadway the V2.7b dashed slate vanished into the road it outlined, the pair reads as a HOLLOW outlined road, distinct from every solid road over the dark body and the light ground alike (`docs-assets/v27c-ghost-c8b-act-one.png` + `v27c-ghost-magnified.png` — the crop LOCATED BY PROJECTING the ghost edge through the fitBounds math, because a colour search fails: alpha blending shifts both tones and the light core is nearly the ground colour; `v27c-ghost-network-only-blocked.png` is the network-only Act I frame on the new ground; the historical v27b frames restored from git after the NADI_SHOTS capture). The three light-ground contrast siblings fixed: background travellers → TRAVELER #2f3133 with a 1 px light rim (the design's one-colour rule, made legible on a dark road); trails → light; the Build edge tint's neutral grey → light; the draft hover → the chevron brown (reads on dark road AND light ground). Legend swatches (the change legend, ConflictLegend) read the palette through `css()` — a literal pin (`rgb(250, 190, 40)`) guards the lane_closure swatch; CAP_* tables moved to `mapPalette.ts`; ONE PathStyleExtension instance per module. THE BASEMAP: positron-nolabels stays the ground, its `background` / `water` / landcover+park+landuse fills overridden on load to the design's #f2f2f3 / #d7e1e7 / #e0e7dc (ids probed from the style JSON; guarded per id; the seam's `basemap` field reads the values BACK from the live style and map-ladder pins them). AFTER frames per band: `docs-assets/v27c-after-c2b-z{13,15_2,16_5}.png` beside the C1 BEFORE triple, same centre / zooms / viewport. Perf (headed, prod): fat 4.02 / 3.75 / 3.77 s (the fit reading sits on a 3.1 s fetch), p95 16.1 / 16.1 / 15.7 ms; pinned 1.16 / 1.25 / 1.14 s, p95 16.0 / 14.6 / 8.2 ms — the rimmed dots cost nothing measurable. THE C2 GATE (C2a + C2b): **693 pytest + 202 Playwright**, the 202 in NINE foreground chunks (act-one alone overran the 10-minute cap on a cold dev server and finished in the background at 10.1 min — the memory watchdog spared a single-file run).
**C3 (the lanes band, LANDED — one commit, three sequenced parts):** **C3a** lane stripes — one row per INTERNAL car-lane boundary (never the sidewalk edge), ~2,300 rows on the net, built at load and `visible` from z ≥ 15 (the lazy build the plan sketched buys nothing at that size). **C3b** CHEVRONS at constant on-screen spacing (`roadGeometry.chevronAnchors`): 160 px of ARC LENGTH at the current quantized zoom, phase carried across GEOMETRIC successor chains — a successor starts within 30 m of the edge's end and continues the heading within 35°; a fork or a T-junction ends the chain; the junction gap counts toward arc; unique-claimant merges; chains start from predecessor-less edges in id order (deterministic) — the arrow clustering on curvy streets is gone by construction (V2.0b's one-arrow-per-edge-at-its-middle-vertex is retired). Chains are NEVER id-based: base-id chains bridge 834 m holes on this net and exact endpoint coincidence finds ONE pair (SUMO edge shapes stop ~14 m short of junctions). Rendered on EVERY direction (reading 4b — each directional edge is a direction), on each direction's own car body; the walk runs once per zoom gesture (never per frame) and is skipped at the far band. road-geometry.spec pins the boundaries BOTH sides (29/31 m, 34/36°), the T-junction non-bridge, the fork break, the gap-in-phase case, two-way both directions; map-ladder pins 9 / 21 chevrons over the fixture net at z15.2 / z16.2 (hand-derived from mpp) — a test-helper bug (34° from NORTH, not off the predecessor) was caught by the RED→GREEN cycle, not by the code. **C3c** the BIKE BAND: a scenario's `bike_lane` change renders as the curb-side car lane at TRUE width in #8fae87 from z ≥ 15 (a thin green line below); legend 'bike lane' + the swatch literal; the overlay seam gains `laneBand` while `path` (the vertex pins) is untouched; `allows.bike` on 98 % of edges is mixed traffic and never a band. **LOOKED-AT (the two ratified-vs-data readings):** 4(a) at z15.2 stripes are a fine but legible pattern on 2 px lanes — the pixel-pitch exit NOT taken; 4(b) two-way chevrons read as direction marks, not noise — the one-way-only fallback NOT taken; but the fixed 11 px glyph overflowed a 3 px road, so the glyph SCALES with the lane pixel pitch (`chevronSizePx` = 2.2 × lane px, floored 7 / capped 12; pinned) — a lever inside the rule, not a divergence. Perf (headed, prod): fat 4.19 / 3.82 / 3.72 s (fit on a 3.3 s fetch), p95 16.1 ×3; pinned 1.21 / 1.12 / 1.13 s, p95 16.0 / 16.0 / 15.1 — stripes + chevrons cost nothing at frame level. AFTER triple `v27c-after-c3-z*.png`. Gate: **693 pytest + 202 Playwright** (nine chunks; one load flake — run-identity's rename click timed out at 60 s under memory pressure and the file re-ran 4/4 on the same tree).
**C4 (the icons band, LANDED — THE GATE PASSED, no contingency taken):** from z ≥ 16 travellers are overhead MODE ICONS rotated to heading (`web/lib/modeIcons.ts`: a Canvas2D atlas — car / bicycle / pedestrian masks — handed to deck as a PNG data URL, no binary asset; `viz.segmentAt` gives position AND heading from ONE cached bracket lookup; sizes in metres with a 12 px floor — at a 9 px floor the magnified z16.5 frame showed rounded marks, not cars, and the rung exists so mode reads from the SHAPE; `Pinned` carries `mode` from the join because the agent record has no vehicle type). The swap is a DATA swap, never `visible` (a hidden per-frame layer still regenerates its attributes every tick): the dot layers get EMPTY at z ≥ 16 and three IconLayers get the active arrays; the sibling seam `__nadiTravelers` counts dots vs icons per family and map-ladder pins CONSERVATION — every active traveller drawn once, dots below z16, icons from z16, dots again at the lanes band (the lane switch and the icon switch never share a gesture). Background icons keep the one TRAVELER hue; instrumented icons keep sentiment colour and the trigger-time swell (as size) and stay clickable. **THE GATE (headed, prod, fat 90 MB, both selector measurements):** z16.5 playback p95 **16.1 ms (62 fps)** against ≥ 30; the harness's NEW crossing probe (z15.9 → z16.5 while playing) recorded a longest rAF gap of **32 ms** (pinned 39), 0 longtasks — neither the viewport cull nor the instrumented-only retreat fires, so the conflicts table gains no row. fit 3.85 s / z15.2 3.76 s / z16.5 3.96 s; pinned 1.21 / 1.18 / 1.16 s, p95 ≤ 16.0 ms. Gate: **693 pytest + 202 Playwright** (nine chunks; one load flake — act-two's card click timed out waiting for "stable" mid-stream and the file re-ran 13/13; the same click-timeout class as C3's run-identity flake, both on a box at ~3 GB free).
**C5 (the curved-road restyle + closeout, LANDED):** a DRAWN ROAD is a road, not a schematic line — in playback (`new-road-casing` / `new-road-body` / `new-road-stripes`), in the draft basket (`draft-road-*`) and in the live draw preview (`draw-preview-casing` / `draw-preview` / `draw-preview-stripes`) alike: a #515459 body at `Change.lanes × 3.2` m (`roadGeometry.newRoadRows`; lanes is REQUIRED for new_road — the minted edge's numLanes — a legacy change without it draws ONE lane, stated), white stripes on the internal boundaries from z ≥ 15, under a chevron-brown casing 0.8 m each side as the "proposed" mark (the legend swatch is the same tuple: `rgb(150, 98, 92)`, pinned). The preview uses the form's DEFAULT lane count (`DEFAULT_DRAW_PARAMS`, exported from EditPanel) until B is clicked. The drawn path (A + vias + B) is never replaced — the V2.6d vertex pins hold unmodified; the overlay seam gains `roadBody` + `stripes`, the draft seam `roadBody`. The V2.6d teal/orange idiom is retired (BACKLOG:136 reconciled; the in-source "explicitly deferred" note gone). LOOKED AT: the draft curve in Build (`v27c-after-c5-draft-curve.png`, from edit.spec's curved-draw test under NADI_SHOTS) and the V2.6d acceptance run's 3-bend connector in playback at z15.2 / z16.5 (`v27c-after-c5-curve-z*.png` — the new_road resolver needs the API server's junctions, which the quiet-box rule had stopped; relaunched for the frame). The corridor frames are unchanged by C5 (the example run has no new_road), so the arc's final AFTER triple is C4's. Perf (headed, prod): fat 3.96 / 3.70 / 3.70 s, p95 16.1 ×3, crossing 39 ms; pinned 1.18 / 1.16 / 1.17 s, p95 ≤ 16.0, crossing 32 ms — the new-road layers are empty on both artifacts and cost nothing. Gate: **693 pytest + 217 Playwright** (eight chunks, no flakes).
**V2.7d IS COMPLETE — EDITOR RESTYLE + STREET NAMES + THE PER-LANE TABLE (C0–C10, fifteen commits
`7586d75` · `b7b2ca2` · `52b6eb2` · `581b52e` · `401ec8e` · `f5200ba` · `c4bc214` · `6fdfe4b` ·
`fa35ad2` · `9035dd4` · `7bda28a` · `69ff5d5` · `c8b1a01` · `56c8c87` · `a592f5b`, pushed 2026-09-15,
plus one record-correction commit after the push; NO contract change; the ONE data move is
`web/public/network.json` v2 at C1a — the golden trajectory, the golden report, every fixture,
`contract/` and every committed artifact byte-identical all arc, checked per commit; plan + execution
log at `~/.claude/plans/begin-v2-7c-map-styling-shimmering-kernighan.md`, the file name historical).
Suites at close: **715 pytest — MEASURED at the closeout, 2026-09-15, one full run on `56c8c87`'s
python tree ("715 passed, 14 warnings in 248.49s"), not the C2 figure carried forward — + 255
Playwright** (32 spec files). THE ROLLUP:** the Build stage is
the ratified Map & Build §1c/§1d/§1e — seven change TILES dragged onto a road (pointer capture, a DOM
ghost, `pickObject` at the release point) or armed and clicked; an inline DROP FORM fed by the road's
REAL lane table for BOTH directions, emitting one member per directional edge with the per-direction
consequence SAID before Run; BLOCKER cards carrying the engine sentence verbatim plus the resolution it
offers; refusals in a designed container under the via caption; the whole rail on the design system.
Street names ride the export (`name`, from the tracked OSM extract by way id — the regen was MEASURED
and NOT taken) and reach the draft rows, the drop form, the server's descriptions, the report and chat
corpus (name-plus-id, never name-instead-of-id) and the voice cards (nearest edge within 25 m at both
trip ends, else the line is omitted). The per-lane wire table (`lanes[{width_m, allows{car,bike,ped,
bus}}]`, `reverse`, `from`/`to`) replaced c's sidewalk rule with exact data: the invariant test is
RE-DERIVED over the table (4,214 sidewalks · 28 / 23 / 6 residuals now FACTS the renderer draws right ·
`bus_only_lanes == 23` · the width histogram), and the bus band draws on Midland Avenue's 23 lanes.
**THE CONFLICTS TABLE (ratified vs shipped, every row recorded):** (1) Map & Build §1c SUPERSEDES the
Shell v2 "Step 1/2/3" Build article (ratified 2026-09-13). (2) Both directions' lanes list in one form;
ticks emit ONE `lane_closure` member per directional edge; road closure / speed limit get a
`both-directions` box DEFAULT OFF (the V2.4a single-change wire pin stands) — and the consequence
sentence ("closes northbound only — southbound stays open" / "closes both directions — 2 members") is
a `toHaveText` pin, the ratification's one condition. (3) Name-plus-id, id-only when unnamed (byte-
identical to the pre-arc forms). (4) R1: the reverse partner is EXPORTED (`reverse`), never derived
from the id — 3,186 of 4,192 two-way edges have a partner whose `#k` differs. (5) R2: the table
carries `bus`; c's conflicts row "no bus band — the wire carries no bus data" was FALSE-PREMISED and
is corrected: 23 bus+bike lanes, all on Midland Avenue, drawn from z ≥ 15. (6) R3: cross streets need
a same-name walk (≤ 6 hops, unique successor, never the reverse partner): both ends resolve for
2,963 named edges, one for 1,027, neither for 497 → "between X and Y" / "near X" / omitted. (7) The
SCHOOL ZONE and DRAW A NEW ROAD tiles enter the EXISTING modes (zone-select; the ptA flow). (8) The
od line: nearest edge of ANY kind within 25 m (inclusive) at both trip ends; an unnamed nearest edge
OMITS the line (skipping it would name a street the traveller was not on). (9) RESPONSE renders as a
DAY-ONE button beside the REAL `option-assignment` checkbox in one segmented row, not two pressed-
state buttons — four specs `.check()`/`.uncheck()`/`toBeDisabled()` it; looks, chosen for the spec
API. (10) WINDOW PRESETS (AM PEAK / SCHOOL PM / ALL DAY) are NOT implemented — the form keeps V2.2c's
start + duration minutes; the preset row is a BACKLOG item (derive from the profile, never a literal).
Its SPECIES: a ratified-design element deliberately NOT BUILT — a scope decision, recorded here — which
is a different kind of row from the data-derived divergences around it (rows 5, 6 and 8: what the net
and the walk actually contain decided the shape) and from the spec-API looks divergence (row 9).
(11) The run card has no §-source on the canvas; it wears the same classes by idiom. (12) C0 EXIT B:
the regen drifted, so the canonical net is a FIXED ASSET — the invariant literals were re-verified at
C1a against the v2 export of the UNCHANGED net (4,570 / 4,214 / 28 / 23 / the six off-width ids /
{3.2: 6717, 1.6: 4, 7.0: 2}) — unchanged; checked, recorded as checked. **DEFERRED, with reasons:**
map STREET LABELS (a TextLayer on the perf-gated hot path; the design shows named streets on the map,
the product does not until it lands — e/f, cost stated) and `reactions.py` PROMPT NAMES (a
generation-pipeline change wearing street-names clothing — a V2.7e RATIFICATION item; committed
voices speak edge ids, new voices would speak names: a vocabulary vintage divergence to state when it
lands). **THE RESIDUAL FROM c CLOSED:** both ghost frames were reviewed (`v27c-ghost-c8b-act-one.png`
+ the magnified crop; `v27c-ghost-network-only-blocked.png`) — the ghost reads as a hollow outlined
road distinct from every solid one, the network-only caption head legible on the new ground; as
intended. **PERF (C1b, the only layer-touching commit; headed, prod, quiet box):** fat 3.87 / 3.83 /
3.68 s, p95 16.1 / 16.1 / 16.0 ms, heap 198 MB (+8 — the asset is 1.36 → 2.64 MB raw, 255 → 361 KB
gzip), crossing 32 ms; pinned 1.17 / 1.19 / 1.16 s, p95 ≤ 16.1 — budgets hold. **FRAMES:**
`docs-assets/v27d-after-c1b-z*.png` + `-midland-z*.png` (the bus band), `v27d-c4-drop-form.png`,
`v27d-c6-blocker.png`, `v27d-c8-panel / -drop-form / -blocker / -draw-refusal / -zone / -run-card.png`.
**FOUR METHOD LESSONS PAID FOR** (the fourth by the follow-up): **A PIN THAT MOCKS A PREMISE CANNOT
DETECT THE PREMISE DYING** — the three held-footer pins encoded "no ledger, one `run_ended` line" and
stayed green through C10b while the terminal-edge ledger re-read they never modelled poisoned the
live footer; pin against the REAL emission AND the real durable state, keyed by content, with a
server-side pin on the same literal sequence so the two halves cannot drift apart silently. Then:
a bash heredoc turned a regex's `\b` into a BACKSPACE byte and
mis-encoded the middots in a spec (the reporter printed `/nadi-shell/` with no visible backslashes;
caught by the advisor before GREEN — the heredoc memory, again); **THE STASH-BISECT RULE: a
reproducing red is not the working change's until the committed tree is tried on the SAME server,
then a fresh one — record both rates** (the stash bisect showed run-identity:118 failing 2 of 3 on
HEAD too, and a fresh dev server made it green; a diagnostic copy of the test that sampled the
button's box PASSED, because its own sampling delay masked the race) — the family this rule belongs
to is the STALE-SERVER / SEQUENCED-MOCK class (the V2.7a F2 `/status` extra-consumer trap, the C11
poll-restart hunt, the c-arc load flakes), tests whose outcome depends on what the server and the
mock sequence are doing at the moment of the assertion rather than on the tree; and the act-two:478
/ run-identity:118 pair is now a BACKLOG item under that family name with its mechanism
(Playwright's two-frame stability wait on a card that re-renders under load). **LIVE ACCEPTANCE (C9, against the running API + dev server, the SPEND-FREE
HALF — Run was NOT pressed, because the chain is armed by default and a chained run spends thousands
of model calls):** `__nadiEditEdge('-439600156#2', 'lane_closure')` on the real net opened the drop
form titled "Lawrence Avenue East (edge -439600156#2)" with the between-line "between Burnview
Crescent and McCowan Road · 7 lanes · 4 car lanes this direction · current speed 60 km/h", rows EB
sidewalk / EB general 1 (curb) … 4 / WB sidewalk / WB general 1 (curb) … 3 (the partner is the
EXPORTED `43307631#6` — a different way id, R1 live), one tick per side → "closes eastbound only —
westbound stays open" then "closes both directions — 2 members", Add → two rows "1 lane(s) closed ·
Lawrence Avenue East (edge -439600156#2)" / "(edge 43307631#6)", the overlay counting 2
(`docs-assets/v27d-c9-live-lawrence.png`, `-live-drop-form.png`, `-live-draft.png`). **THE OTHER HALF, DONE AT THE CLOSEOUT (2026-09-15,
spend-controlled):** the API server relaunched with `NADI_AUTO_ENRICH=0` (`/api/projection` read
`armed: false`; the rail's spend note read "Runs the physics. Interpretation is off on this server —
nothing is spent." before Run), a ONE-direction lane closure built through the drop form on the real
edge (`lane-check-1` only → "closes eastbound only — westbound stays open") → run
**`multimodal-scenario-20260915T051601Z`** (synthetic, day-one, 1 seed, permanent; quant 158 + 145 s,
2 cars rerouted, car median +0.0 min, 4 % materially affected). **QUOTED FROM THE SCREEN, the server
description path end to end:** the run card, the map's ScenarioHeader and the run document's H2 all
read **"Closed 1 of 4 car lanes on Lawrence Avenue East (edge -439600156#2)"**
(`docs-assets/v27d-acceptance-run-card.png`, `-build.png`, `-read.png`). Then ONE manual voices enrich
(the user's authorized ~213-call spend; DeepSeek): Act II mounted in Watch during the stream and
**214 of 214 voices** rendered — **198 sim cards carried an od line** ("from Galloway Road to Windover
Drive" on a walk-to-transit commuter; "from Danforth Road to Mid Pines Road"; an "along Brimorton
Drive" case), **2 sim cards OMITTED it** (a "Time-pressed commuter … departs t=469 s" card with no line
— the precondition MEASURED after the fact over the artifact + `network.json` (segment distance to
all 4,570 edges): both omitted cards' DESTINATIONS sit on an UNNAMED nearest edge (`5284713#2` at
0.1 m; `37192025#2` at 1.6 m) beside named origins (Beath Street 1.3 m; Brimley Road 3.1 m), and the
recount reproduces exactly 198 / 2 — the unnamed-nearest-edge branch of conflicts row (8) holding
rather than naming a street the traveller was not on; NOT the "> 25 m from any named edge" cause this
record first inferred), 12 inferred
+ 2 mandate cards never carry one (`v27d-acceptance-voices-od.png`, the live viewport;
`v27d-acceptance-voice-od-card.png`). **The no-line card is DOM-quoted, not framed:** Act II unmounts on
the enrich's done edge (the 1.5 s poll), and the card vanished between the viewport capture and its
element capture; re-mounting needs another enrich (a report enrich, ~13 calls, would do it) — not
spent without asking. Two observations BANKED in BACKLOG with their causes, both V2.7b territory: the
Act II cost line read "model calls: 0" throughout a manual enrich that spent ~213 (FIXED in the
follow-up below — the cause recorded at the time, "the projection is written at chain start only",
was incomplete: the manual POST wrote nothing at all and the client never asked), and Act I's beat-4
held panel ("NO WITHDRAWAL — THIS CHANGE HAS NO WINDOW") re-showed over Act II when Watch was entered
during the manual enrich of an already-finished run (still banked). The server was restored to its
default environment after (`armed: true`); the run sits in the run list unprotected. Report and
discourse were NOT run. **THE V2.7d FOLLOW-UP (2026-09-16, one commit atop the push): three honesty
fixes on consent surfaces, all V2.7b territory, found by d's acceptance — and two of the three
recorded causes were WRONG, which the fix's own exploration found before the fix.** (1) THE COST
LINE: the manual `POST /enrich` wrote nothing to the ledger, `enrichLaunched` re-read none, and the
C11 re-read fires once — so a ~60 s voices enrich showed "model calls: 0" with no denominator and no
basis. Now `_project_stage` (one source with the whole: `_projection_terms` carries the four terms,
`_project_interpretation` keeps its exact `{calls, basis}` shape because the chain unpacks it) is
written into the ledger SYNCHRONOUSLY before the `stage_start` line, the client re-reads it on the
enrich launch and REPLACES a reopened run's whole-chain number, and `COST_TITLE` says a stage's count
lands when it completes. The RATIFIED resting state is `model calls: 0 of ~215` with the basis, then
`47 of ~215` once `stage_usage` lands — the zero is the metered truth (metering happens at process
exit, C6a's fresh-process design), the promise is on screen from the first frame, and a
progress-derived floor was deliberately NOT built (a second client-derived cost model, and
stage-inconsistent: only voices has per-call-shaped events). Pinned by content in enrich-stream.spec
(a reconnect body gated on the test's own signal, never a timer). The per-stage pins found two more
understatements the whole-run pin had hidden inside the index term's margin: the VOICES stage
projected 212 against run A's metered 213 (one audit retry) — fixed by the RATIFIED
`VOICE_RETRY_ALLOWANCE` (1 %, the measured 0.47 % rounded up, floored at one call; voices reads ~215)
— and the DISCOURSE stage projected 2,226 against 2,231, because `CASCADE_SCORING_PER_AGENT` had
been rounded DOWN to 1.0 while its own comment recorded the measured 1.1; it is 1.1 now (the whole
projection: 7,157 → 7,223). (2) THE BUTTON LABELS: `~1¢` / `$` / `$$` were V2.3-era literals under a
comment claiming metered actuals, and the report button ALSO rebuilds the chat index (the largest
term); `GET /api/projection` now serves `stages` (the three buttons partition `calls`, pinned), the
run card renders "~N calls" with the stage basis as its title or NO price at all when the endpoint is
unreachable, `armed` is not consulted (the buttons spend regardless), and the unit is model calls
because no per-call price exists in the repo. (3) THE CHAIN-STATE DISCRIMINATOR: the recorded cause
(the facts-only `results` stage_end) was wrong at the fold level — that event has no stage key and
folds to a no-op. The real poison is `run_ledger.end()` marking never-run stages `skipped`, the C10b
terminal-edge re-read merging them in, and `chainState` counting any non-`pending` status as started;
the three footer pins never saw it because they mocked a null ledger. A stage is started only when
`running`/`done`/`partial`/`failed` now; the hook's inline copy of the check calls `chainState`; the
chain-off pin replays the server's real tail (`cmd_start`, `cmd_end`, `stage_end results`,
`run_ended`) over the real chain-off ledger, keyed by content on the stream having been served, with
test_stage_runner pinning the same literal sequence server-side. Six further observations banked in
BACKLOG with causes (the ledger's accumulate-vs-set divergence, the placeholder overwrite, the
machinery label, the unfulfilled `instrumented=` promise, the legacy-run ledger init, the
stage-field values no pin covers). **One
defect the live frame found that no spec could:** the drop form's two window inputs overflowed the
rail by 8 px through their intrinsic width, growing the rail a horizontal scrollbar — fixed in
`nadi.css` (`min-width: 0` on the window fields, 100 % inputs) and re-measured live (scrollWidth ==
clientWidth). **The per-step record follows.** The
first data-moving arc since V2.7b. **C0 (2026-09-14) — THE DRY-RUN REGEN DECIDED: EXIT B, THE CANONICAL
NET STAYS UNTOUCHED.** Both netconvert stages were re-run into scratch from the tracked extract with the
same netconvert 1.27.0, the Stage-1 recipe verbatim plus `--output.street-names`, and the Stage-1b flags
the net's own header records. The result is NOT the canonical net modulo names: 1,879 diff lines after
stripping the header comment and `name=` attrs; **4,602 normal edges vs 4,570 — 32 normal + 80 internal
edges ADDED, 0 removed, every canonical id survives, the `<location>` line identical, the added ways
present in the extract** (Stage-1b log: 4,246 sidewalks / 3,446 crossings guessed vs the tracked 4,214 /
3,430). The cause is not determinable: the original Stage-1 flags were never recorded (the tracked
`netconvert.log` is a warnings-only stderr capture with no config block; the header records Stage 1b
only). So no copy happened, the golden was not re-run (nothing changed under it), and: **(1) the canonical
net is a FIXED ASSET** — regenerate only for a deliberate geometry change, which re-baselines the golden
AND invalidates the calibration; **(2) street names come from the tracked OSM extract by way id at
`network_export` time** (SUMO edge ids ARE OSM way ids; probed 4,480 / 4,570 resolve, 79 unnamed in OSM,
11 ramp edges by prefix) — the same data `--output.street-names` copies, with zero regen risk; **(3) the
recipe is now marked as non-reproducing in `run-sim/SKILL.md`** (Stage 1b corrected to the header's five
extra flags; the names flag added to both stages — verified 4,521 names survive the re-import with it).
**The golden-red premise the brief carried is corrected on the record:** names never enter the
simulation, so under a name-only regen the golden stays green and that green would have been the proof;
a red golden means geometry moved — the STOP condition, not the arc's expected red. The scratch diff
(`%LOCALAPPDATA%\Temp\nadi-v27d-c0\net.diff`, first 40 lines saved beside it) is the evidence; nothing in
the repo moved except SKILL.md and this record.
**C1a (`b7b2ca2`) — network.json v2:** per edge `lanes: [{width_m, allows{car,bike,ped,bus}}]` (the
PER-LANE TABLE, index 0 = curb), `lane_count`, `name` (the OSM way name by way id — 4,487 named / 83
unnamed; a ramp edge whose way is an unnamed highway link is honestly `null`), `from`/`to` node ids and
`reverse` (the NODE-PAIR partner: 3,186 of 4,192 two-way edges have a partner whose `#k` differs from
the `-id` guess, so the client never derives one; `oneway ⇔ reverse null`, 378). `test_network_export`
proves the table equals the net lane for lane; the lane-model invariant is RE-DERIVED over the table
(the sidewalk property with 4,214; the 28 / 23 / 6 residuals recounted as facts — the 23 are BUS+BIKE
lanes). Asset 1.36 → 2.64 MB raw, gzip 249 → 352 KB. TS `NetworkEdge` fields are REQUIRED; the untyped
route mocks migrated through `tests/support/net.ts`; map-ladder's fixture stays a literal.
**C1b — `laneModel` reads the table; the BUS band (the corrected c row):** lane centres walk from the
curb (total/2 − Σw − w/2), the car BODY spans the outermost car lanes (a bus lane between them lies
inside it and draws its band on top), stripes only between ADJACENT car lanes, six off-width lanes now
at their true 1.6 / 7.0 m, the 28 ped-on-car edges without a ribbon, and `road-bus-band` (#96625c, a
static row per bus-only lane — a thin edge band at the overview, true width from z ≥ 15). **V2.7c's
conflicts row "no bus band — the wire carries no bus data" was FALSE-PREMISED and is corrected: the net
carries 23 bus+bike lanes, all on Midland Avenue, and the band is drawn** (`docs-assets/
v27d-after-c1b-midland-z{15_2,16_5,17_5}.png`, looked at: a muted-red curb lane on the southbound
carriageway only, matching the data). The corridor triple `v27d-after-c1b-z*.png` is identical to c's
after-C4 triple (no bus or off-width lane in that viewport). Perf (headed, prod, quiet box): fat 3.87 /
3.83 / 3.68 s (fit / z15.2 / z16.5), p95 16.1 / 16.1 / 16.0 ms, heap 198 MB (+8 for the larger asset),
crossing 32 ms; pinned 1.17 / 1.19 / 1.16 s, p95 ≤ 16.1, heap 60 MB (+7), crossing 40 ms — every
budget holds. Gates: 705 pytest; tsc/lint; Playwright 222 in seven foreground chunks (act-one and two
others overran the 10-min cap and finished in the background) — 221 green; **`act-two.spec.ts:444`
("no aggregate framing") fails IN-FILE and passes alone (1/1)**: a click on the last stage card waits
for "stable" and never gets it after its 12 siblings; it reproduces on the stale AND a fresh dev server
AND on the PRE-ARC asset + lib (3/3 in-file), so it is NOT this arc's regression — a pre-existing
order-sensitive weakness (it flaked once at c's C4) recorded for BACKLOG at C9. enrich-stream's two
timeouts in a chunk were unrendered-shell load flakes (file re-run 4/4). The stale-server rule bit
once more: the first isolation run of the act-two test failed on the day-old dev server and passed on a
fresh one — restart before acting on a red.
**C2 — the python name resolver and its consumers (no web files):** `street_names.name_of` /
`describe_edge` / `closed_all_lanes_desc` / `report_edge_ref` read names back from `network.json` (the
ONE runtime source on both sides; a missing or damaged asset → id-only, never a raise). **NAME-PLUS-ID,
NEVER NAME-INSTEAD-OF-ID:** `"Markham Road (edge -1288863201)"` in every server description ("Reduced max
speed on …", "Closed 1 of 3 car lanes on …", "Closed all lanes of …", "Speed limit on …", "Bike lane
on …", and the incident tag inside the parenthetical: "… on Markham Road (edge X, incident)"),
`"(Markham Road, edge \`-1288863201\`, lane 1)"` in the report's change lines, `"Target edge X (Markham
Road)"` in the chat corpus. **Every unnamed form is byte-identical to the pre-V2.7d wording**, which is
why `golden_report_unwindowed.md` (edge `E1`) did not move and the fixtures' hand-built descriptions
stand; a red golden here would have meant the format leaked into the unnamed branch — it did not. One
pre-existing pin migrated (`"(incident)"` → `"incident)"`, the tag now rides inside the parenthetical on
a named edge). Suites: **715 pytest** (+10). The committed protected runs keep their old id-only
descriptions (composed at run time into the artifact — a known-vintage divergence, like C10's).
**C3 — the TS name module (`web/lib/streetNames.ts`): draft summaries + THE VOICE-CARD LINE.**
`edgeLabel`/`describeEdge` pin the python forms as literals (the compact-time lockstep idiom);
DraftPanel's member rows read `Road closed · Lawrence Avenue East (edge X)` / `Speed limit 29 km/h ·
edge E_C`. **The V2.7b origin→destination deferral comes home:** a sim voice's card carries
`from Origin Street to Destination Road` (`act-two-voice-od`) when BOTH trajectory endpoints resolve to
a named nearest edge within **25 m** (`OD_THRESHOLD_M`, inclusive; `nearestEdge` measures to the
segment over a 100 m grid); the nearest edge of ANY kind decides — if it is unnamed the line is
OMITTED, because naming the nearest NAMED street instead would put a traveller on a street they were
not on (the invented-geography case the V2.7b rule forbids); the same presence guard as `departs`.
`crossStreets` (for C4's mini-form) walks same-name chains: unique successor, never the reverse
partner, a fork or the hop cap ends it, then between / near / nothing. Gates: street-names 9 +
draft-basket 15 + edit 12; act-two 14/15 (the same pre-existing in-file failure).
**C4a — THE DROP FORM (`web/components/DropForm.tsx`, EdgePalette absorbed and RETIRED) + the lane
rows (`web/lib/laneRows.ts`):** the ratified §1d mini-form — "WHICH LANES — FROM THIS ROAD'S LANE TABLE",
BOTH directions: rows derive from the export's per-lane table for the dropped edge AND its node-pair
partner (the export's `reverse`, merged like the edge), labelled from data only (the compass initial from
the end-to-end bearing, sectors at 45/135/225/315; kind from the table; ordinals for GENERAL lanes only;
"(curb)" on the curbmost non-sidewalk lane: "NB general 1 (curb) · NB general 2 · SB general 1 (curb)");
sidewalk / bus / bike rows listed INERT (text, never an input — the V2.2c picker's input count stays the
car-lane count); closable = the server's `car_lane_indices` ∩ the table's car lanes, a disagreement
rendered disabled with its reason, never a 400 surprise. Ticks across directions add ONE `lane_closure`
member PER directional edge (`addMembers`, one draftSeq bump). **THE RATIFICATION'S CONDITION IS A
PIN:** `drop-direction-note` says the per-direction consequence before Run — "closes northbound only —
southbound stays open" / "closes both directions — 2 members" / "one-way street — eastbound only"
(`toHaveText`, draft-basket.spec). The title is name-plus-id with the cross-street line and the lane
count. `__nadiEditEdge(id, kind?)` is ADDITIVE: no kind opens the ROAD CARD exactly as before (the eight
seam specs ran GREEN untouched — 30 + 34, one edit.spec cold-load flake re-run 12/12), a kind opens the
form pre-set (`drop-form`). Three catches, each resolved on the honest side: the bus row carries no
ordinal (the design's "EB bus (curb)"); the initials derive from the mock's real NORTH-running
geometry, so the pins read NB/SB; and the draft-basket mock's table disagreed with its own server lane
list (E_C: a sidewalk at index 0 vs `car_lane_indices [0]`) — the table EXPOSED it, and the mock now
derives its table from its indices (E_B/E_C become the net's ped-on-car shape).
**C4b — THE SEVEN TILES + the both-directions box.** "Add a change — pick a change, then click the road
it applies to": the ratified §1c seven (`tile-road-closure` / `-lane-closure` / `-speed-limit` /
`-incident` / `-bike-lane` / `-draw-road`, and the SCHOOL ZONE tile carrying the `zone-mode-toggle`
testid — the draw card's old zone button retired). A tile ARMS a kind (`aria-pressed`; the accessible
path — C5 adds the pointer drag): the next road click carries it into the drop form pre-set; adding a
member or cancelling disarms; the zone and draw tiles enter the EXISTING modes (a recorded decision).
`DropKind` = the three events + speed limit + bike lane (the form shows the section its kind names; the
road card shows all). A road closure or a speed limit on a two-way street gets a `both-directions`
checkbox — DEFAULT OFF, so the V2.4a single-change wire pin (`Speed limit on E_A -> 8 m/s`) stands —
and ONE `drop-direction-note` per form says its consequence either way ("closes northbound only —
southbound stays open" / "applies to both directions — 2 members"); ticked, it adds one member per
directional edge (`onSpeedLimits` / `onRoadClosures` → `addMembers`). The client's speed / bike
descriptions read name-plus-id when named and keep the BARE id when unnamed (`clientEdgeRef` — the
server's own unnamed form is `edge X`; the client's stays the bare id on purpose, the pin's form).
Looked at: `docs-assets/v27d-c4-drop-form.png` — the tiles, the name-plus-id title with the lane count,
the both-direction rows with the sidewalks inert, the ticked direction's sentence. (The tiles card
overlaps the loaded run's caption at the rail's top — the pre-existing rail layout; C8's.) Gates:
lane-rows 7 + draft-basket 20 + closure-palette 5 + school-zone 6 = 38; edit + seeds + run-identity +
brake 30 + one rename click-timeout flake (the C3 class; re-run 1/1).
**C5 — DRAG ONTO A ROAD (the ratified §1c/§1d gesture).** POINTER-based, never HTML5 DnD onto the canvas:
pointerdown on a tile captures the pointer, a fixed DOM ghost follows it past a 6 px threshold, and
pointerup past it is a DROP — MapView turns the client pixels into container pixels and asks deck's own
picking (`MapboxOverlay.pickObject` on the `edit-edges` layer, radius 8, the overlay exposed through a
ref assigned in an effect); the form opens for THAT road pre-set to the tile's kind, the drop point is
`unproject`ed and remembered, and the member it adds PINS the tile's icon there (`DraftMember.at` →
`DraftPins`, DOM markers anchored through `MapAnchored`, which subscribes to the map's `move` with its
own state so MapView never re-renders per pan frame; no deck layer added — no perf gate). A drop on no
road says so (`drop-miss`, 1.5 s) and adds nothing; a release within the threshold is the click — ARM.
The `__nadiViewport` seam gains `project(lon, lat)` so the specs aim a REAL `page.mouse` drag at a road's
projected midpoint (at z17 — at the landing zoom a street's two directions share the same pixels and
deck picks the topmost, which the first run showed as the partner's title; the mock's partner now sits
~24 m aside, as real partners do). Gates: draft-basket 23 (+3: the drag opens the form for that road,
the miss, the pin within 12 px of the release) + closure-palette + seeds + school-zone + lane-rows = 43;
edit + brake + run-identity 28 + run-identity's rename test failed IN-CHUNK again (last in a 9.7-min
chunk; alone 4/4) — with act-two:478 it is the order-sensitive pair recorded for BACKLOG at C9.
**C6 — THE BLOCKER CARD with resolution buttons (the ratified §1c "BLOCKER · ENGINE SENTENCE,
VERBATIM").** `draftBlockers` grew a STRUCTURED form beside the V2.4a strings: `lifoConflict` returns
the crossing WITH the member it points at (the top of the per-edge stack when a revert cannot pop its
own apply — the LATER-applied member), and `deriveBlockerCards` yields `{reason, fix, memberIdx}`:
settled + severing → SWITCH TO DAY-ONE (at the first severing member); a LIFO crossing → REMOVE THE
WINDOW on the later member, or REMOVE THE MEMBER when that member is an incident, because an
incident's window is REQUIRED server-side and cannot be the fix — the card says "an incident needs its
window — remove the member instead". `deriveBlockers` is now the cards' reasons in order, so every V2.4a
verbatim pin holds on `.reason` (the sentence stays the change_scheduler literal byte for byte). The
Run button gains "blocked — resolve the conflict on member N to run". Looked at:
`docs-assets/v27d-c6-blocker.png` (an ELEMENT capture of the draft panel — the card sits below the
rail's 720 px fold). Gates: draft-basket 27; brake 13 + closure-palette 5 + school-zone 6 + seeds 2
+ the older basket tests = 43. (A NADI_SHOTS chunk over brake.spec re-captured four historical
`v27b-c10-*` frames — restored from git before the commit; the c-plan's overwrite hazard, again.)
**C7 — §1e: the via caption and the refused-click container.** Mid-draw the card says "VIA {n} OF 8 ·
CLICK A JUNCTION TO END · ESC CANCELS" (n = the bends placed, 8 = `VIA_CAP` — never a literal); a REFUSED
via click renders its server sentence VERBATIM under the same `draw-hint` pin, inside a designed
container ("REFUSED · ENGINE SENTENCE, VERBATIM" + "the click is not added — the drawing stays as it
was; click farther along to continue"); the two GENERIC draw hints keep the plain treatment — they are
guidance, not refusals. Gates: edit 12 + via-rules 9.
**C8a — the rail restyle (looks only; every testid and string frozen, verified by the full gate).** The
rail div carries `.nadi-shell` ITSELF (its pointer-events pair — rail none / each card auto — stays
inline and untouched), and `app/nadi.css` gains the `.ed-*` classes under it (card, kicker, title,
label, hint/warn, segmented control, checkbox row, field/input, tiles + the drag ghost's pressed look,
the engine-sentence container shared by REFUSED and BLOCKER, member rows, the voices ticker); EditPanel's
and DraftPanel's inline style constants are DELETED, not shadowed (the border-longhand grep over the
five editor files returns nothing). The ratified §1c numbering: "01 · RUN OPTIONS" / "02 · ADD A CHANGE"
/ "03 · DRAFT" kickers. **RUN OPTIONS became SEGMENTED CONTROLS with ONE deliberate divergence:**
TRAFFIC is two `aria-pressed` buttons (`option-demand-synthetic` / `option-demand-calibrated`; the
`<select>` is gone — closure-palette.spec's `selectOption` caller migrated in the same commit, no
hidden-select shim; the old option texts survive as the explainer line under the row); RESPONSE keeps
the REAL `option-assignment` checkbox inside its segmented row beside a DAY-ONE button
(`option-assignment-day-one`) — four specs `.check()` / `.uncheck()` / `toBeDisabled()` it and the D1
lock sentence renders verbatim as before, so the settled control is a visible native checkbox, not a
second pressed-state button (a C9 conflicts-table row: looks, chosen for the spec API). The
ScenarioHeader takes a `rightInset` (372 in Build) so the loaded run's caption centres in the space LEFT
of the rail — the C4b frame had shown the rail covering its right end. RED first: the edit.spec
structural pin (shell class on the rail, both kickers, the segmented pair's pressed states, the
checkbox's type) + the migrated closure-palette caller. **A method lesson paid for on the way:** the
spec lines were first written through a bash heredoc, which turned the regex's `\b` into a literal
BACKSPACE byte and mis-encoded the middots — the reporter printed the regex as `/nadi-shell/` with no
visible backslashes; caught by the advisor before GREEN (the `bash-heredoc-backslash-mangling` memory,
again). Frames LOOKED AT against §1c/§1e: `docs-assets/v27d-c8-panel.png` (the run-options segments,
the tiles, the caption clear of the rail), `v27d-c8-blocker.png` (an element capture — the BLOCKER
sentence in the red-bordered container over a square SWITCH TO DAY-ONE), `v27d-c8-draw-refusal.png`
(the REFUSED container under the via caption); the historical `v27d-c6-blocker.png` was re-captured by
its own test's NADI_SHOTS line and restored from git. THE GATE: tsc/lint; **FULL Playwright — 254 ran
in six foreground chunks (60 · 65 · 44 · 48 · act-two 15 · act-one 22; chunks C and D overran the
10-minute cap and finished in the background at 10.0 / 17.0 min, both green)** — 253 green in-chunk
plus the known act-two:478 "no aggregate framing" in-file failure, green alone 1/1 (the pre-existing
order-sensitive weakness recorded at C1b, unchanged in kind). No python or asset change (pytest not
re-run; data neutrality checked — golden / fixtures / contract / artifacts / network.json clean). No perf.
**C8b — the drop form, the zone card and the run card (looks only; file-disjoint from C8a).** The
three remaining editor surfaces drop their inline style constants for the same `.ed-*` / `.btn`
classes (DropForm §1d: kicker "NEW MEMBER · <KIND>", the name-plus-id title, the lane table's inert
sidewalk rows, the window fields, Add as `.btn-primary`; ZonePalette: "NEW MEMBERS · SCHOOL ZONE";
RunCard: the staged rail's dots read the row's `data-state`, enrich buttons and Clone as
`.btn-secondary`, the identity form on `.ed-input`). **One structural change a test can see:** the
road card's Close lanes / Close road / Incident row is a SEGMENTED control — the three
`palette-type-*` buttons carry `aria-pressed` (the C8b RED, `draft-basket.spec`, which also pins the
Add button's `btn-primary` class and captures the §1d frame). A kicker first written onto the run
card ("RUN COMPLETE" over "Run complete") was removed on the looked-at frame — duplication, not
design. Frames: `v27d-c8-drop-form.png` (the mini-form with a ticked direction and its sentence),
`v27d-c8-zone.png`, `v27d-c8-run-card.png` (element captures). The border-longhand grep over all
five editor files: nothing. THE GATE: tsc/lint; **FULL Playwright — 255 ran in six chunks (61 · 65
· 44 · 48 · act-two 15 · act-one 22).** Five in-chunk failures, every one re-run on the SAME tree:
edit:418 (the junctions `waitForResponse` in the setup helper, the C4a cold-load class; the file
13/13 alone), enrich-stream:287 and group-interview:346 (the unrendered-shell / click-stability
class after a reload; alone 4/4 and 2/2), and the two recorded order-sensitive tests —
**run-identity:118 failed 2 of 3 ALONE, and the decisive experiment was the stash: the committed
C8a tree failed 2 of 3 at the same line on the same server**, so it was the box, not C8b; on a
FRESH dev server it passed 2/2 (the seven-hour-old server had hot-reloaded through a stash cycle —
the stale-server memory, again); act-two:478 passed 1 of 2 on the fresh server — the pre-arc
weakness, unchanged in kind, its BACKLOG item written at C9. No python or asset change; no perf.
**V2.7e — SCORECARD DOORWAYS + THE TWO-GROUP ROOM + THE PROMPT-NAMES RATIFICATION (C1 `d6948c5` ·
C2 `16cae9f` · C3 `aad455b` · C4 `e9fd920` · C5 the prompt names — ALL SHIPPED; NO contract change; plan +
execution log at `~/.claude/plans/begin-v2-7e-scorecard-doorways-idempotent-key.md`). THE ROLLUP:**
the run document's 2.4 rows SELECT (the ratified canvas, form 1d: toggle, cap two, oldest dropped)
instead of navigating; the TRAY says what is picked ("pick one group to hear it; two to put them in
a room" when nothing is); ONE selection renders the EVIDENCE STRIP — composed by the pure
`web/lib/groupEvidence.ts` from the ARTIFACT alone: the group's voices per grounding with the HEAR
door (the existing scorecard→feed join, unchanged), the ASK door (the interview drawer on a STATED
pick — the group's most-affected simulated voice, ties by artifact index, else its first inferred
voice; the rule is on the button), the three cells WITH their confidence and note as BODY TEXT (the
first time a cell note is read rather than hovered anywhere in the document), and the sentence that
says what is NOT a door (discourse, chat and graphs carry no per-group view) — a group with no
voice gets a sentence, never a dead button; TWO selections offer "Put {A} + {B} in a conversation →"
(canvas-verbatim), which seeds a FRESH room by the RATIFIED pick rule (alternating A/B up to the
cap, most-affected first) and says its composition in a separate `room-seed-note` ("seeded 3 from
Car commuters, 2 from Cyclists — most-affected first; add or remove anyone" — one derived template,
true in the imbalanced 4 + 1 case too), or, when the pair cannot fill a room, a sentence with the
count. `ROOM_MIN` / `ROOM_MAX` became one source (the drawer's floor and cap, the map view's add
cap, the five "3–5 voices" titles — bytes identical). The feed's filtered empty state distinguishes
"no voices yet — keep playing" from "no voices in this run". **THE CONFLICTS TABLE (ratified vs
shipped):** (1) a row click SELECTS, not navigates — the canvas; the door is the strip's button.
(2) The Ask door opens on ONE agent (interviews are per agent; there is no group interview) — the
pick is the room seed's rule, stated on the button. (3) Explore surfaces are NOT doors — none carries
a group join; said in a sentence rather than faked. (4) The CTA lands with the feed on group A, not
both — the two-group feed filter is DEFERRED (BACKLOG, reason stated). (5) The room's "voices you
picked" curation note keeps its pinned bytes; the seed note is a sibling element. (6) Act I needs no
door: Read shows the not-computed panel (already pinned); the doors are BLOCKED with the reason while
Act II holds Watch (`doorwaysBlocked = actTwo` at the Read mount, always at the Act II report
stage). **THE WRONG-RUN PREDICATES, answered as written:** the strip reads `artifact.agents` /
`artifact.scorecard` (the loaded run by construction) and is disabled under Act II. **THE SETTLED
CONDITION — CHECKED, NOT FIRED:** the figure is **+2.31 s** (README.md:235; the "+22.31 s" carried
in the queue's wording was a typo); no new surface features it — the strip shows the loaded run's
own cells. **THE `_SAFETY_NOTE` CEREMONY — TAKEN at Exit B (C3):** the strip made the example run
READ "seeds 42/43/44" beside its own single-seed caveat, so the note derives now
(`default_safety_note`: single / multi / not-recorded forms; the legacy literal kept and RECOGNISED
by the report's caveat and the earned rewrite, never written); the EXAMPLE run recomputed under
`NADI_ALLOW_PINNED_ENRICH=1` (only its four safety notes changed — every value, share, confidence
and range byte-equal; the other blocks identical) and its report refreshed (zero LLM); the two web
fixtures' notes patched IN PLACE at their vintages — a full regen from their producer modules
re-versions them to 0.10.0, which their vintage pins forbid by design (a method fact, recorded);
`scorecard.main()` refuses a protected run without the env (proven refusing, then run under it);
the PINNED run's recompute BANKED with its cost (imprecise, not false). One pre-existing bug fixed on
the way: the CLI's readback print crashed on a composite-null access cell (after the write).
**LIVE ACCEPTANCE (C4, 2026-09-18, against the running API + dev server — the SPEND-FREE HALF):**
the doorway walk on the V2.7d acceptance run `multimodal-scenario-20260915T051601Z` (214 voices from
d's closeout, single seed). **Its first frame showed the disease C3 cured, on a run computed before
C3:** the strip's safety basis read "sign not stable across seeds 42/43/44" as BODY TEXT while the
caveat one screen below said "This run used a single seed (42)" — the vintage divergence, seen in
one viewport (`docs-assets/v27e-c4-live-strip-legacy-note.png`, kept as the finding). The run is
local, unprotected and uncommitted, so a zero-LLM scorecard recompute is the honest maintenance op:
run, old-vs-new compared — ONLY the four safety notes changed, 214 agents byte-equal — and the strip
then read "single seed (42) — cross-seed sign stability was not probed; magnitude only, directional
claim not supported" in agreement with the caveat (`v27e-c4-live-strip.png`). The HEAR door landed
in Watch with the filter chip "showing: Car commuters", the scorecard's Car commuters row
highlighted and car-commuter voices in the feed (`v27e-c4-live-hear.png`). **Every other pre-C3
run on this box keeps the legacy literal in its cells** — the strip is where a reader now meets it;
the recompute above is the per-run cure (protected runs need the env, and the PINNED run's is
banked). **THE OTHER HALF — NOT YET SPENT:** the omitted-od-line SIMULATED voice card and the
manual-enrich cost line (`model calls: 0 of ~215` then `N of ~215`) need Act II mounted live, which
needs one voices re-enrich of that run (~215 model calls) — confirmed with the user before spending,
and folded into C5's own gate (one enrich serves both), so the record of it rides C5. That re-enrich
REPLACES the acceptance run's quoted voice text (the "from Galloway Road to Windover Drive" cards are
that enrich's, not stable artifacts) while the od line's precondition — the nearest-edge geometry —
survives untouched.
**FRAMES, looked at:** `docs-assets/v27e-c1-tray.png` (the tray + strip on the example: 120
voices, both doors, the basis lines — including the baked note C3 then cured), `v27e-c1-no-voices.png`,
`v27e-c1-blocked.png`, `v27e-c2-room-cta.png`, `v27e-c2-seeded-room.png` (five members alternating
car / bike under the seed note), the three C4 live frames above (`v27e-c4-live-strip-legacy-note`,
`-live-strip`, `-live-hear`; all viewport captures of the real UI against the live backend).
Element captures of the document section and the drawer were
CLIPPED at the panel's scroll fold or never reached "stable" under live re-renders → viewport
captures after `scrollIntoViewIfNeeded`. **GATES:** C1 265 Playwright (five foreground chunks; the
first attempt at chunk 1 was KILLED by the box's memory watchdog while the session idled — restarted
only when the user said so); C2 268; C3 733 pytest (+11) + the eight spec files reading the moved
bytes (run-document, institutions, school-zone, scorecard-scope, app-shell, compare, discourse,
edit — 62 passed in one chunk, no flakes; a python + data commit, the full Playwright suite rides
C4's tree unchanged from C2's). **TWO METHOD FINDINGS:** a component prop declared in the type but not destructured surfaces
only as a runtime `ReferenceError` in the dev log (twice, RunDocument then ReportStage) — read the
dev log after a GREEN as a matter of course; and Act II's stream REPLACES the fixture's agents with
placeholder personas that map to no group, so an Act II pin over a group needs one real persona id
in the streamed body. **PROMPT NAMES — RATIFIED (D-Q3, 2026-09-17), landing as C5 after the closeout
push:** name-plus-id in `reactions.py`'s three id branches (unnamed bytes byte-identical), the
"no street names" framing clause reworded to "beyond those provided", `report._change_phrase` and
the CLI harness descriptions in lockstep, gated by one live voices enrich with a looked-at sample;
the vintage divergence stated beside C10's. The dossier that decided it: the vocabulary was ALREADY
split by change type inside one prompt (speed limits reach the prompt as name-plus-id via the
server description; closures and incidents carry a bare id; bike lanes and new roads carry
neither); 0 of 4,686 committed LLM voices ever said an edge id; two CLI runs whose description
named "Kingston Rd" produced ~2 % of voices naming it naturally under the existing clause.
**C5 — PROMPT NAMES, LANDED AND GATED LIVE (2026-09-18):**
`reactions._road_ref` renders the prompt's road NAME-PLUS-ID when `network.json` names the edge
("1 car lane on Lawrence Avenue East (edge -439600156#2) is closed …") and the pre-C5
`the corridor road (<id>)` BYTE-IDENTICAL when not, at lane_closure / road_closure / all three
incident shapes; **bike_lane gains the name inside its MECHANICAL sentence and never adopts the
description** (a recorded decision against the plan's wording: a CLI description is id-only, so
adopting it would move the unnamed bytes, and the server's is a label — "Bike lane on …" — where a
mechanism belongs); new_road is untouched (no edge, no name); `_SIM_FRAMING` says "no street names
beyond those provided" (the inferred framing and the interview constitution already said "not
provided" — verified, untouched). **`report._road_name` is the id-free twin ON PURPOSE:** the
framing slot's prompt forbids numbers and `audit_prose` forbids digits, and an edge id IS digits —
feeding one would invite an echo, a retry and a false drift reading on the audit-retry canary; the
slot gains the NAME alone ("closed on Lawrence Avenue East"), unnamed byte-identical — and
**DIGIT-FREE BY CONSTRUCTION**: 50 of the net's 4,487 named edges carry digits ("Highway 401
Collector" / "Express", address-style "3939 Lawrence Avenue East"), and with a retry-once-then-
fail-loudly slot audit a digit-bearing name would be a systematic failure source, so such an edge
keeps the fallback (pinned: the phrase says "the corridor road" while the voices' line, which has
no digit rule, says "Highway 401 Collector (edge H1)"). The `speed_limit` branch's
`change.description` passthrough is PRE-EXISTING (name-plus-id, digits and all, since V2.7d C2) and
not this commit's — the four new branches are id-free by construction. **The next report
generation's audit count is the FIRST READING after the framing phrase gained the street** (a
baseline note like 2026-07-31 and 2026-08-19, not a shift to investigate). **The CLI/server
description axis CLOSED:** `scenario_harness.cli_base_desc` through `street_names` — FOUR of the
five forms match the server's composers byte for byte (speed_limit / lane_closure / road_closure /
incident); bike_lane keeps the CLI's own mechanical "Converted lane k of …" sentence, named, where
the server composes the label "Bike lane on …" (unnamed forms byte-identical to the pre-C5 CLI
wording; `--description` still overrides). `test_prompt_names.py` (19 pins over a three-edge
`network.json` in tmp_path — never a skip): both forms per branch as full-string literals copied
from a run of the untouched code, the framing clause, the id-free twin and its digit rule, the CLI
forms, and the interview's inheritance (`build_system` carries the named line; the room rides the
same grounding; the leakage matrix stayed green). Full pytest **752** (733 + 19). No web file
moved (every interview/room spec mocks the backend), so no
Playwright. **THE VOCABULARY VINTAGE DIVERGENCE, stated beside C10's "unreachable" wording:** every
voice generated after C5 hears the street; every voice before heard "the corridor road (<id>)" —
so committed and protected runs, their cascades (seeded from the comments verbatim) and their chat
corpora keep the old vocabulary. Measured loudness on the acceptance run's 200 pre-C5 sim voices:
0 say "Lawrence", 0 say the id, 27 say "corridor" — the divergence is "the corridor road" → the
street name, never id → name. **THE GATE — RUN (2026-09-18, the user's authorized spend; one
voices enrich of `multimodal-scenario-20260915T051601Z` from its run card, DeepSeek, metered 213
calls, ~70 s):** the SAME 200 vehicles re-sampled (deterministic sampler), 0 of 200 comments
identical to before. **The looked-at sample:** 65 of 212 voices name the street ("Losing a lane
on Lawrence adds about a minute and a half to my usual eleven-minute run"; "Losing a car lane on
Lawrence Avenue East adds about 0.3 minutes…"; "one less lane of cars squeezing past me on
Lawrence") against 0 before — far above the ~2 % of the CLI natural experiment, which named the
street only in a description the closure branch never showed; "corridor" fell 27 → 11; **0 say
the id**; and the ONLY street-name token in all 212 comments is "Lawrence Avenue" — no invented
geography under the reworded clause. One wording that LOOKS like invention is not C5's: cautious
cyclists speculating that "closing a car lane means there's finally a protected bike lane" —
12 such comments BEFORE, 14 after, the persona's own prior on a closure, pre-existing and
recorded, not fixed here. **C4's two deferred observations, carried by this enrich:** (a) the
od-line split reproduced by DOM count at +72 s — 214 cards, 198 with an od line — and the two
omitted simulated cards are vehicles 156 (Time-pressed commuter) and 40 (Resident who drives the
corridor), both present in the re-sample, both with a destination on an unnamed nearest edge;
Act II unmounted at the done edge before an element capture landed, the SECOND time a specific
card has been DOM-quoted rather than framed (a product item, BACKLOG). (b) THE COST LINE ON A
RE-ENRICH: the FIRST frame (+3 s) read "model calls: 213 of ~215" with the voices card already
"✓ 213 calls" — the PRIOR enrich's metered count from the ledger, rendered as if this one were
complete (the ratified "0 of ~215" resting state is a first enrich's; a re-enrich seeds from the
ledger row); after completion the ledger's voices row reads **426** (`add_llm_calls` accumulated
213 + 213 while the stream fold sets) with its status still "skipped" — BACKLOG:564's divergence
SEEN LIVE, and the row's status never marked. And the beat-4 held panel ("NO WITHDRAWAL — THIS
CHANGE HAS NO WINDOW") re-showed over Act II on entering Watch during the manual enrich, then
over playback after it — d's banked observation REPRODUCED (`v27e-c5-live-act2-first.png`,
`v27e-c5-live-held-panel-after-enrich.png`, both looked at). The panel beneath it read "Building
the chat index … It is still working" for a stage that was not running (its card said 0 calls) —
banked beside it. The API server's in-process `interview` import needs a restart before a live
interview reflects the line; the voices subprocess read the new `reactions.py` as is (proven by
the sample).
Open threads: **V2.7b F3 SHIPPED (`a9f1d04`)** — a mid-run reload or `?run=` deep link now restores
the run the reader was watching, beats, act, live cost and all · **V2.7c map styling — SHIPPED** (six commits; see the V2.7c box) ·
**V2.7d editor restyle + street names + the per-lane table — SHIPPED** (fifteen commits; see the
V2.7d box — the netconvert regen was measured at C0 and NOT taken: names ride the export from the
tracked OSM extract, the canonical net is a fixed asset) · **V2.7e scorecard doorways + the
two-group room + the prompt names — SHIPPED, C1–C5** (see the V2.7e box; the one V2.7d deferral
still open: map street labels) +
`BACKLOG.md` (bbox expansion, student demand, mandate re-verification, the calibrated composite
exemplar, the settled-basis re-verification, per-window probing at rung 3, the V2.7
legacy-fallback removal, the room's prompt-side sibling-label ambiguity — its UI half closed in
V2.6b, the document humanization CLOSED at V2.7d (street names ride the export — no regen; the clock
half shipped in V2.7b C10b) — the `scorecard._SAFETY_NOTE` recompute ceremony, the V2.7d follow-ons
(map street labels, the window-preset row, the order-sensitive Playwright pair), and the V2.7b follow-ons: the
interpretation's SHAPE as a product decision now that it is metered (the chat index alone is 53%
of a run's spend), per-step cascade events, the two C11 residuals — the FORWARD-ONLY corpus-handle
fix (the pinned run's served index still missing 115 of its 1,355 posts) and the lock-scoped
staleness rule — and the empty-map caption's overpromise on a failed baseline fetch).
**Deployment handoff (2026-08-17):** the static demo bundle is BUILT and smoke-verified at
`v2.5` (`node scripts/build-static-demo.mjs` → `web/out/`, 43.9 MB — untracked build output,
regenerate freely) but **NOT yet deployed** — the Cloudflare Pages click is the user's
(DEPLOY.md has the wrangler commands). When the live `*.pages.dev` URL exists, it replaces the
"deploy in flight" placeholder in README "See it live" — the ONE pending README edit,
deliberately blocked on the deploy. `main` + all five annotated tags (v2.2–v2.5) are pushed to
origin as of this handoff; `v2.6` pushed with the V2.6 closeout (2026-08-23), README refreshed
to the v2.6 vintage the same day (status/counts/contract v0.10.0, the room + curve + payload
rung in History, the stale payload-thinning Open item retired).

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
LightRAG index at `%LOCALAPPDATA%` (DeepSeek + local MiniLM dim-384 pinned in
`embedding_meta.json`; **corpus SIZE is cascade-driven — ~230 docs on a run whose discourse had not been enriched, 1,982 on V2.7b's chained acceptance run, because the chain always runs discourse BEFORE the index and one doc per clean cascade post dominates the corpus**); `GET /api/report` + `POST /api/chat` retrieve via `aquery_data` then run a
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
**V2.2 Steps a+b — the runtime CHANGE-SCHEDULER, closures, incidents, the response detour (no
contract change; the 0.5.0 shapes went live).**
- **Scheduler (`change_scheduler.py`):** windowed changes APPLY at `window.start_s` / REVERT at
  `end_s` in-sim; capture-before-apply per lane, restore via `setDisallowed` ONLY, assert restored
  == captured. SUMO 1.27 permission facts probed live + encoded in the FakeConn (closure idiom =
  `setDisallowed(lane, ["all"])`; `getAllowed()` is ambiguous — never use it for closure checks).
  Same-edge windows must be LIFO-well-formed (crossing rejected at build AND POST/spec-load).
  Unwindowed paths byte-identical; a window past sim end never reverts (disclosed in the proof
  log).
- **Closures + the rejection matrix:** lane_closure (`target_lanes` ⊆ car-lane indices, validated
  at POST and live) + road_closure; `--ignore-route-errors` BOTH legs. Single source
  `assignment_rejection_reason` — IDENTICAL strings at POST (400) and harness (SystemExit):
  settled+windowed(any) and settled+severing rejected (duaIterate halts or silently drops
  unroutable trips). Settled + partial unwindowed lane_closure settles via the extended
  `patch_runtime_net`.
- **Incidents:** a CAPACITY event, never a crash simulation — `effect.blocked` and/or
  `effect.speed_factor` (combinable, one LIFO slot); `position_m` stored, unused (rung-2). TWO
  predicates split honesty: `invalidates_routes` (stranding surfaces; a speed-only incident never
  claims stranding) vs `capacity_event` (detour fact + temporary framing); incident access cell =
  honest null; no crash/collision/accident wording anywhere (test-pinned).
- **Emergency-response detour (`response_probe.py` + `response_probes.json`):** free-flow
  fastest-path seconds (`getOptimalPath(fastest=True)`; NEVER `getShortestPath` — distance-only),
  baseline vs an in-memory during-window net; destination = first downstream junction with an
  ALTERNATE approach; unreachable = threshold (`cost > 1e39`), never float equality. BOTH honesty
  sentences (free-flow-not-dispatch + lower-bound) ride the payload and render wherever the
  numbers do; `verify_facts` enforces them + re-derives added_s; computed ONCE per run
  (seed-independent).
- **Honesty surfaces:** windows render CLOCK TIMES on calibrated (`demand_profiles.fmt_sim_time`),
  sim-seconds on synthetic, everywhere; `window_events` (the REVERT PROOF) + `non_completions`
  ride sidecar/run-state/RunStatus under `verify_facts`. Accepted live: `V22AACC2` lane_closure
  (935/19,804 diverted; revert proof on the live net) + a calibrated incident (917/20,137
  diverted, honest-zero detour with notes, 0 crash words). **Gotcha (hoisted to Run commands):**
  long harness runs launch detached via PowerShell `Start-Process`.

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

**V2.2 Step d — the SCHOOL ZONE (the first REAL multi-change scenario) + the V2.2 CLOSEOUT,
TAGGED `v2.2` (no contract change).**
- **Composites:** the producer is list-native (`changes: list[Change]` + `tags`; unwindowed
  members loop apply+readback, windowed ride ONE ChangeScheduler; single-change runs
  shape-identical). Server: `POST /api/simulate {changes, tags}`; members speed_limit-only this
  step (`REASON_COMPOSITE_MEMBER`), settled+composite rejected; handoff = a
  `contract/runs/state/<run_id>.composite.json` spec file RE-validated by the harness (same reason
  strings). Review-caught BLOCKER fixed + pinned: `run_state.list_all()` must skip
  `*.composite.json` (its `*.json` glob 500'd `GET /api/runs`); the LIFO rule
  (`lifo_conflict_reason`) enforces at POST + spec-load, never mid-SUMO-run.
- **The ZONE LENS (`zone_lens.py`, tag-gated `school_zone`):** ped-vehicle crossing conflicts
  within 25 m of ANY zone edge during the window, counted IDENTICALLY on both FULL conflict lists
  → `zone_facts`. **TWO HONESTY LOCKS (user-locked): `population_note` NAMES the measured
  population** ("pedestrian entities from the … demand — not modeled schoolchildren") **and
  `variation_note` is ALWAYS present** (small-n counts claim no direction) — the pair bypasses
  the CellRange machinery so the caveat rides unconditionally; verify_facts pins both notes
  verbatim. Voices: ONE mechanical preface when tagged; parents react from OWN outcomes; never a
  child voice.
- **Frontend:** 🏫 zone-select mode (`ZonePalette`; D1 lock on entry); the zone TINT is ALWAYS
  visible (a designation, like signage) with the legend rule sentence, while playback time-gating
  covers ANY windowed item; RunCard `zone-chip`. **`changeSetKey` gains `window`, excludes tags**
  (presentation, not physics). Access truth: a speed-limit zone renders access ABSENT like any
  speed_limit run — the zone's story lives in the zone lens. Fixture
  `web/tests/fixtures/school-zone-run.json` is REAL producer output (regen: `python
  python/tests/test_school_zone_fixture.py`).
- **Accepted:** synthetic composite `…0726T235722Z` (3 revert proofs, 0-vs-0 zone pair with all
  notes, 212 voices, audit 0-unresolved). **The calibrated school-hours exemplar
  `multimodal-scenario-20260727T180728Z`** (--end 7200, ~6.5 h wall; selection committed at
  `data/schools/school-zone-exemplar.json` with full Open Data provenance): **zone pair 30 vs
  28** — real calibrated counts, still small-n, the variation note doing its job; the corridor
  GENUINELY SATURATES under calibrated AM peak (inflow > outflow all window; 72% of demand
  delivered by 09:00 — the V2.1b deficit measured directly). **PRECISION: the exemplar proves
  APPLICATION, not revert** (its windows ended at the sim ceiling, disclosed) — revert proofs
  come from the synthetic acceptance + the V2.2a/c live runs; never cite the exemplar as revert
  evidence. A first --end 9000 attempt ABORTED in a queue-spiral drain — the ops lessons (rerun
  shape, pace probing, restore-before-diagnose) hoisted to Run commands. Detour-on-composites
  UNIT-verified only at this step (recorded in BACKLOG; paid in V2.4b).
- **V2.2 CLOSEOUT — the WINDOWED-SCOPE DISCLOSURE:** run-scoped scorecard vs window-scoped
  change, said out loud on EVERY windowed run: **`report.build_scope_disclosure(changes, sim_end,
  profile)` is the SINGLE SOURCE** — Section-2 line + caveat + chat corpus + `verify_facts`
  recompute-and-pin (REQUIRED iff windowed) + the ScorecardPanel scope note all read it, never
  re-derive. Span = `zone_lens.resolve_window`; display bounds CLAMP to [0, sim_end] BOTH sides
  (review-caught: a window may legally end past the ceiling). UNWINDOWED reports render NOTHING
  new — byte-identical, pinned by `python/tests/golden_report_unwindowed.md` (the regen helper
  refuses a windowed source). Disjoint-window span honesty recorded in `BACKLOG.md` (paid in
  V2.5a).

**V2.3 Step a — the SSE-STREAMED ENRICH (streaming is TRANSPORT, not content; no contract change).**
- **Events channel (`python/src/enrich_events.py`):** NDJSON file at
  `%LOCALAPPDATA%\nadi-enrich\<run_id>.events.jsonl`, appended by writers, tailed by the server's SSE
  endpoint — reconnect-safe by construction (SSE `id:` = absolute line NUMBER; replay-from-0 IS the resume
  story). Emission **env-gated** (`NADI_ENRICH_EVENTS`, set only by the server) → CLI enrich byte-identity by
  construction. Reader tolerates a partial trailing line + skips-but-counts corrupt lines. Vocabulary:
  `job_start` (client dedup-reset sentinel) / `cmd_start`/`cmd_end` (per subprocess — gives report/discourse
  live stage labels) / `voices_total` / `voice {index, done, total, agent}` / `job_done`/`job_failed`.
- **POST-TIME ORDERING INVARIANT (test-pinned):** truncate → emit `job_start` → launch subprocess,
  synchronously under the held lock — `job_start` is structurally LINE 0, so client dedup reset and the
  stale-id-past-EOF replay can never misfire. `prune()` (7-day) has its ONE call site there.
- **Byte-identity:** `reactions.build_agent(rec, reaction)` is the SINGLE builder shared by final assembly
  and stream emission; streamed agent = the `dump_artifact` shape (`model_dump(mode="json",
  exclude_none=True, by_alias=True)`), element-for-element two-path pin; proven live (a CLI reactions run
  touched no events file, assembled all 212).
- **Server:** `GET /api/runs/<id>/enrich/stream` (replay-then-tail 0.25 s; `Last-Event-ID` resume, stale-id
  → replay from 0; 15 s heartbeat; ORPHAN GUARD — terminal run-state + free lock + no terminal event →
  synthetic terminal frame; 404 no events file). `GET status` derives `enrich_progress {done,total,label}`
  READ-ONLY from the events tail (set_stage is an unlocked read-merge-write — nothing new written there).
  Poll loop untouched.
- **Frontend:** `web/lib/enrichStream.ts` (typed EventSource wrapper: dedup by lastEventId, reset on
  `job_start`; native auto-reconnect; degrades ONCE on `readyState CLOSED` **or after 3 consecutive failed
  opens** — review catch: an aborted connection retries CONNECTING forever, never reaching CLOSED). RunCard
  "Enriching: voices… 47/212" live (stream counts beat the label; polled `enrich_progress` once degraded), the
  LABELED note "live stream unavailable — updating by poll", `streamEnded` ref kills the job_done→poll-lag
  reopen loop (Playwright-caught). EditPanel voices TICKER (newest-first, cap 6, inferred labeled "community
  perspective", "not a poll"). MapView `handleVoice`: appends streamed agents to the loaded artifact
  (run-id-guarded — hasVoices flips live) + the ticker; `done === 1` marks a NEW JOB — resets dedup and
  REPLACES the voice sets (else a re-enrich streams into a stale seen-set that swallows every voice —
  live-smoke-caught); the done-edge `loadRun` reload stays the authoritative swap. `read_from` hardened
  against truncation-under-a-tail (offset past EOF → replay from 0). Spec GATE ORDER: assert the enriching
  state RENDERED before waiting for it to end (else the wait passes in the pre-first-poll window).
- **Verified:** 18 unit + `enrich-stream.spec.ts` ×4 (incremental render mid-enrich; re-enrich
  fresh-set/no-pile-up; mid-stream disconnect; NETWORK-level failure). Live smoke 212/212 with `cmd_start`
  labels; **real-browser degrade PROVEN**: mid-enrich 404 + reload → real Chrome CLOSED → verbatim note →
  POLLED counts advanced 79→201/212 → note cleared. Report/discourse labels ride the same `cmd_start`
  plumbing.
- **Ops note:** `.claude/hooks/format.py`'s prettier leg was ARMED-BUT-CONFIGLESS — any `npx prettier`
  run seeded the npx cache and the PostToolUse hook then rewrote edited web files to prettier DEFAULTS
  (cost a 231-line accidental reformat once, reverted). REMOVED in V2.5a (item 6 holds the full record,
  incl. the conclusive cache-seeded probe + the activation-lag precision).

**V2.3 Step b — PERSONA INTERVIEWS (ephemeral; no contract change; agents stay a preview).**
- **`POST /api/interview {run_id, agent_id, agent_index?, question, transcript}`** → an in-character answer
  from ONE voice. Grounding built SERVER-SIDE (`python/src/interview.py`) from the artifact — the client
  sends IDS, never facts (spec-pinned: no outcome fields in the POST body): persona re-hydrated from
  `personas.json` (the wire trims to {id,label}), prior reaction quoted ("stay consistent"), sim agents get
  their OWN trip via `reactions._sim_suffix`, inferred agents get `_inferred_context` + the in-character
  basis duty ("I wasn't simulated directly — speaking from what the scenario implies for someone like me").
  `build_grounding` receives ONE agent + run-level context — the structural LEAKAGE guarantee, pinned with
  marker agents (another agent's comment/label/minutes in the context = failure).
- **AGENT IDENTITY (review-caught misattribution):** `vehicle_id ?? person_id ?? persona.id` is NOT unique
  for inferred voices — the sampler round-robins few personas over more records, so siblings share one
  persona.id with distinct comments (real artifact: `longtime_resident` ×3). The client sends the record's
  **agents[] index**; `find_agent` picks the exact sibling when index+id agree, else first-match scan (old
  callers work). Drawer remount key + transcript session index-qualified client-side too.
- **The GUARD is the FLOOR no matter what the client sends:** `audit_interview` = `report.audit_prose`
  VERBATIM (strictly stronger than the asked-for list) + a narrow `_VERDICT` rule (city/council should…,
  approve/reject/scrap, recommend-forms, negated should). The `_ALLOW` disclaimer skip is NOT whole-sentence
  — review-caught: "I can't give a verdict, but the majority should approve it" slipped every check.
  **Follow-up (user-directed): the fix is HOISTED into `report._strip_disclaimers`, guarding audit_prose
  (report slots + chat) AND audit_prose_cascade** — the strip is CLAUSE-bounded (match → next `,;:—–` or
  sentence end), so a multi-object disclaimer ("cannot predict crashes or their probability") stays licensed
  while a ", but <claim>" clause is re-checked (bare-span was a latent interview false positive). Smuggle +
  multi-object pins per consumer in test_report.py/test_interview.py. Retry-once → the in-character refusal
  constants (unit-pinned audit-clean); LLM exceptions/empty → refusal + status "error", never a 500.
  Referendum deflection in BOTH the system prompt (rule 5) and the guard (_TALLY + _VERDICT).
  **Transcript-laundering pin:** planted "You said:" violations echoed by a stub die at the guard (the
  transcript feeds only the prompt).
- **Server:** temp **0.8** through `report._call` (honesty from the guard, not determinism); artifact via an
  mtime-invalidated 2-entry LRU keeping ONLY agents+changes+profile+tags (the 90 MB tree drops; cold load
  via `asyncio.to_thread` so SSE/polls never stall). 400 empty/oversize (cap 500 chars); 404 no
  artifact/agent; 409 unenriched; 503 no key; guard failures are CONTENT (200 + audit status). No one-job
  lock. **Fix in passing:** the server's `_deepseek_client` now sends the v4 thinking-disable `extra_body`
  it had omitted (chat + interviews; without it V4 billed reasoning as output, temperature a no-op).
- **Frontend:** `InterviewDrawer.tsx` (right-rail card) from the AgentPanel 🎤 button (sim) or a community
  row (now a real button — UA-reset ORDER: the `border` shorthand wipes `borderLeft`, the accent after it,
  computed-style-pinned). Per-grounding disclosure lines; labeled guard/error notes (never silent);
  cost-honest "Ask · <1¢" + tooltip (actual ~0.03¢ — never understate). Per-agent transcripts in a MapView
  session ref keyed `agent#<index>`, cleared on run swap. NB in MapView `Map` is the react-map-gl component
  — the transcript store is a plain Record for that reason.
- **Verified:** 36 unit/endpoint tests (leakage, guard classes incl. smuggle/verdict, refusal pins,
  LRU/mtime, siblings, status matrix, laundering, EPHEMERALITY — a POST changes nothing on disk) +
  `interview.spec.ts` ×4 (ids-never-facts payload pin, inferred disclosure, failed-audit refusal + banned
  regexes, per-agent transcripts). Live smoke on the pinned 212-voice run: in character, digit-free,
  multi-turn consistent (~1.8 s second turn — prefix hits); referendum ask → in-character deflection; an
  inferred voice disclosed its basis and refused exact numbers; git tree clean after.

**V2.3 Step c — the INSTITUTIONS SPEAK (contract v0.9.0; mandate-grounded, facts-gated, deterministic;
institutions are NEVER impersonated).**
- **Contract 0.9.0 (additive; full ceremony):** `grounding` gains `"mandate"`; Agent gains optional
  `mandate {institution, mission, source, retrieved}` + `citations [{key, text, notes[]}]`. Invariants: no
  pin/outcome/trigger_t; mandate + non-empty citations REQUIRED; **sentiment 0.0 + stance "neutral"** (the
  referendum guard at the contract layer); sim/inferred may not carry the fields. Gates: A/B/C/E extended,
  NEW pre-0.9.0 forbid gate (range-gate properties idiom), `audit_version_gate` tuples extended INCLUDING
  the literal-`!=` trap at the range forbid (now `not in (…)`, regression-pinned), TS mirror +
  `sample_v0_9_0.json` + negatives both layers. Producer emits 0.9.0; **voices-enrich upgrades a 0.8.0
  artifact to 0.9.0 even when NO institution speaks** (the honest empty-state gates on 0.9.0, must be
  reachable on re-enriched runs); pre-0.8.0 re-enriches stay untouched (mandates on one would exit loudly).
  **The pinned Playwright run `multimodal-scenario-20260702T044134Z` is STRUCTURALLY guarded:** a
  voices/discourse enrich rewrites the artifact and breaks the spec + latest-report anchoring — the server
  403s it (before the no-state 404) and `reactions.py`/`propagation.py` SystemExit before any spend
  (`trajectory_io.PINNED_RUN_ID` / `guard_pinned_enrich`; deliberate re-pin only via
  `NADI_ALLOW_PINNED_ENRICH=1`, named in the refusal). `report` enrich stays allowed — it never touches the
  artifact; the documented maintenance path.
- **The roster (`python/src/institutions.json` + `institutions.py`):** TFS / TDSB / City of Toronto
  Transportation Services (TTC deferred — nothing sim-grounded to stand on). Missions are VERBATIM quotes
  of the live pages (researched 2026-08-01; url + retrieval date in `_provenance`) —
  **byte-identity-pinned roster → artifact (`test_institutions.py`): never templated, truncated, or
  LLM-touched; for a real organization, paraphrase is misrepresentation.** The retrieval date renders
  wherever the mandate renders; re-verification duty in `BACKLOG.md`.
- **Facts gating (`institutions.speaks` — a PURE function of the sidecar, the single gate source):** TFS ⇔
  `response_detour`; TDSB ⇔ `zone_facts`; ops ⇔ diversions > 0 OR non-completions with SIGNAL. Two
  live-acceptance catches, pinned: **presence is not standing** (`_has_signal` refuses purely-zero numeric
  trees; the 0-vs-0 zone pair and honest-zero detour KEEP standing — their payloads carry structural notes)
  and **origin labels derive from the probes' `represents`** (old sidecars carry retired corridor-entry
  probes — calling them "fire stations" would misdescribe the data).
- **Generation DETERMINISTIC (zero LLM calls, stub-pinned):** the sampler bakes sidecar fact subsets into
  mandate records (appended AFTER inferred — index stability); reactions composes citations + the
  third-person mandate-lens comment code-side, streamed through the V2.3a plumbing unchanged. Citations
  LIFT the honesty sentences verbatim from the fact payloads (free-flow/lower-bound framing, origins note,
  zone variation/population/method notes, the backlog attribution parenthetical). Institutions never seed
  OASIS cascades (`propagation.build_nodes` skips + counts) and never enter `slot_synthesis` prompts or
  `voice__` corpus docs (they get `institution__<id>` docs with the disclaimer).
- **Report:** code-rendered `### Institutional perspectives (mandate lens)` subsection (mission verbatim +
  source + retrieved + citations + notes) + the impersonation caveat ("not statements by, from, or on
  behalf of the named organizations"); the honest EMPTY state ("this run computed none for: …") renders
  ONLY on 0.9.0 runs with voices — pre-0.9.0 renders NOTHING (unwindowed golden byte-identical, pinned).
  `verify_facts` enforces the speaking set REQUIRED-IFF BOTH WAYS (TFS present iff response_detour; ABSENT
  on a quiet run), recomputes citation figures with verify-side literals, pins the riding honesty sentences
  + the roster-verbatim mission.
- **Frontend:** pinned "INSTITUTIONAL PERSPECTIVES — MANDATE LENS" feed sub-block (never time-gated;
  mandate agents excluded from dots + the community synthetic clock) + the empty-state line;
  `InstitutionPanel` grounding card (mission + source link + retrieved + citations with notes + disclaimer
  + 🎤); ticker tag "— institutional (mandate lens)"; personaGroups maps institution ids to their own group
  (no scorecard→feed join hits). Interviews: `INSTITUTION_CONSTITUTION` (third person ALWAYS — never
  we/our/us), mandate+citations-only grounding, `INSTITUTION_REFUSAL` naming the free-flow limitation,
  mandate-only guard rules `_OPERATIONAL` + `_FIRST_PERSON` keyed on the SERVER-loaded grounding.
- **Accepted live:** closure `…0725T025409Z` re-enriched → 213 agents, **TFS only** (ops silenced by the
  padding gate), honest-zero citation with both honesty sentences; report audit 9 clean / 0 / 0, singleton
  restored. School-zone `…0726T235722Z` → **TDSB (0-vs-0 + all notes) + ops (2 diverted), TFS ABSENT**.
  Fresh synthetic bike_lane `…0801T070538Z` emitted **0.9.0 from the producer**, 0 diversions → the honest
  empty-state line live; a pre-0.8.0 quiet re-enrich stayed at its version (legacy path). Live TFS
  interview: "how many trucks would you dispatch?" → third-person refusal naming the free-flow limitation.
  Streaming: 214 ticked live incl. institutional ticker rows + feed block + grounding card in the real UI.
- **The NONZERO station-set detour (the closeout loose end):** a windowed road_closure on `-36784353#20`
  (station 231's own origin edge — "the doorstep"; run `…0801T180640Z`) produced the phase's headline on a
  REAL artifact: **"1 of 4 fire stations unreachable during the window; worst of the reachable +29.1 s
  added response-route time (232 +10.2 s; 234 +29.1 s; 243 +2.7 s; unreachable: Fire Station 231 (740
  Markham Rd))"** with all three honesty notes riding — the first run where the 2.2b number, the V2.2d
  station set, and the institutional voice met (earlier live citations spoke honest zeros from retired
  corridor-entry probes). The repro also caught the composer silently DROPPING unreachable rows while
  counting them ("worst of 4" listing 3) — fixed: unreachable origins counted honestly and NAMED (mixed +
  all-unreachable shapes pinned; verify_facts recomputes the unreachable count verify-side).

**V2.3 Step d — the GRAPH SPLIT-VIEW (V2.3 closed; no contract change — the sidecar is off-contract like
the report JSON).**
- **Exporter (`python/src/graph_export.py`, READ-ONLY by design — no pinned guard because it never touches
  the artifact; byte-pin test proves it):** OASIS half from `propagation.build_nodes` (SUMO-free; NEVER
  import build_graph) + the wire `social.graph.edges` + influence pairs from `influenced_by` (nodes-only) +
  per-agent exclusion METADATA `{count, rules}` (content never read into any output) +
  `nx.spring_layout(seed=42)`; entity half from the SERVED chat index's graphml (98 components / 64
  isolates → per-component spring + shelf packing with the honest "packed side by side, not force-laid into
  false adjacency" note; `<SEP>`-multivalued `file_path` split/dedup → `sources[:3]` + `source_count`).
  Sidecar naming `graphs-<ts>.json` NEVER matches the three `multimodal-scenario-*` artifact-discovery
  globs (fnmatch-pinned); web copy needs the `.gitignore` NEGATION for the pinned run (verified with plain
  `git check-ignore` exit 1 — `-v` prints negated matches and reads ambiguous). MERGE: each enrich
  refreshes its half, preserving the other. IDEMPOTENT: identical content preserves `generated_at`
  (byte-identical) — pinned-run index maintenance never dirties the tree. Coverage carries
  `mandate_excluded` so the agents-vs-nodes gap is attributed honestly (institutional exclusion ≠
  sibling-dedup — review-caught misattribution). Entity staleness legible THREE ways (unit-pinned): fresh /
  graphml predates the artifact (verbatim stale note) / mtime missing-or-nonsensical (`index_built_at:
  null` + the unknowable note — a clobbered mtime must never silently render "fresh").
- **Producer wiring (soft-fail both sites):** `propagation.main` after `assemble` refreshes oasis;
  `report_agent.build_index` refreshes entity; failures print the backfill CLI (`python
  python/src/graph_export.py --run-id <id>`, EXPLICIT id — no newest-run default), never re-invite a paid
  enrich. Deferred imports keep dependencies acyclic.
- **Frontend (`GraphSplitView.tsx`; MapView mode `'graphs'`, 🕸 NEVER disabled):** two standalone
  imperative Decks under `OrthographicView({flipY: true})` on plain canvases (construct-once per bounds +
  `setProps`; a `position:relative` sized wrapper REQUIRED — Deck repositions raw canvases; fit zoom =
  log2(min(w/bw, h/bh)) clamped **[-8, 10]** — OASIS spring domain [-1, 1] (fit ≈ 8) vs the entity
  shelf-pack's thousands of units (fit ≈ 0); a [-6, 6] clamp blob-ified OASIS, caught only by the live
  screenshot walk — seam counts can't see zoom). HONESTY RAILS: uniform node radius (degree sizing = a
  visual centrality leaderboard), group/type colors never stance, influence = dashed PathLayer +
  PathStyleExtension DISTINCT from follow-edge LineLayer, exclusion rings + hover "{n} post(s) withheld by
  the honesty audit: {rules}" (never content), `sheetMode = compare || graphs` hides map chrome, per-panel
  empty states name BOTH recovery paths, `stale_note` prominent + `index_built_at` always. Lazy sidecar
  fetch with functional-setter acceptance (an effect-cleanup `cancelled` flag would suppress the refetch
  its own rerun triggers); `loadRun` clears the cache (a just-enriched run refetches instead of a sticky
  404); `activeCascade` membership-checks against loaded data. Seams `__nadiGraphs` (counts mirror) +
  `__nadiGraphsHover` (calls the REAL handlers).
- **Tests:** `test_graph_export.py` ×13 (determinism, read-only byte pin, sentinel-leak, merge both orders,
  packing disjointness, `<SEP>`/truncate, three-branch staleness, naming fnmatch, GRAPHS_BANNED over the
  sidecar text, mandate excluded-and-counted, idempotent byte-equality, phantom-edge filter) +
  `test_graphs_fixture.py` ×3 (OASIS half recompute-EQUALS the committed sidecar; entity presence+sanity —
  the index lives outside the repo; excluded-content sweep) + `graphs.spec.ts` ×8 (headers/one-liner
  verbatim, cascade switch changes connectors while follow edges stay, exclusion hover, empty states ×3
  naming both paths, BANNED/STANCE_TALLY/GRAPHS_BANNED sweep, canvas===2, the pinned NO-ROUTES smoke
  asserting the committed sidecar's EXACT node count at runtime — the silent-never-landed catcher).
- **Accepted live (pinned run):** OASIS 205 nodes / 724 follow edges / 42 exclusion-marked; entity 1328
  nodes / 2378 edges, fresh; cascade c1→c2 flipped connectors 491→554 with follow edges constant;
  exclusion tooltip rules-only; fresh no-sidecar run showed the labeled missing state verbatim. The
  entity-only mixed state is spec-only: non-pinned indexes are ARCHIVED (the newest-index alignment
  practice) and an archived index is correctly NOT "the currently served chat index" — the absent-entity
  verdict on `…0725T030121Z` was honest behavior, not a gap.

**V2.4 Step a — the DRAFT BASKET (frontend-only; no contract change; docs/v2.4-plan.md D1–D2
ratified: apply INVERTS to add-then-run).**
- **The basket (MapView, session-only):** every palette apply + the new_road draw ADD a member
  `{id, change, valid, origin?, path?}` — the `change` object BYTE-IDENTICAL to the old
  fire-on-apply's (descriptions on speed/bike/new_road, none on closures/incidents), submitted BY
  REFERENCE. The zone flow is a MACRO adding N windowed speed_limit members with `origin:'zone'`;
  the school_zone tag DERIVES from origins (removing every zone member honestly drops it). Wire
  rule: tag present → composite POST even 1-member; else 1 member → today's EXACT `{change}`
  (deep-equal regression pin), N → `{changes}`. Success clears the draft; failure renders the
  400/409 VERBATIM in `draft-error`, draft retained for edit-and-retry. Transitional rules
  `REASON_COMPOSITE_MEMBER`/`REASON_COMPOSITE_SETTLED` deliberately NOT mirrored client-side (when
  V2.4b lifted them nothing needed un-mirroring). The draft survives run-switches/draw-another BY
  DESIGN.
- **Blockers (`web/lib/draftBlockers.ts` — D2's STABLE set only, user-ratified):** client copies of
  `REASON_SETTLED_SEVERED` (severs(): road_closure always; lane_closure iff it closes EVERY car
  lane; missing eligibility → conservative false) + a line-faithful TS port of
  `lifo_conflict_reason`. **The boundary is pinned on BOTH sides of the language boundary at the
  Python pin's own numbers** (A[100,500]+B[500,800] @ t=499/500/501): touching end==start is LEGAL
  — a >=-for-> port typo makes a FALSE blocker the server backstop can NEVER catch (the draft never
  submits). `deriveBlockers` takes the EFFECTIVE assignment (post-D1-lock). `windowLocked` = the
  live palette signal OR any windowed MEMBER (why palette unmount cleanup no longer drops a lock
  the draft owns). StrictMode catch: member ids mint OUTSIDE setState updaters (an impure ++ref
  inside one double-increments → d2/d4/d6).
- **DraftPanel (EditPanel rail, mounted last):** mechanical member summaries (RunCard chip
  conventions + `fmtWindowRange`, ratified over server-prose ports), per-member remove (clears
  matching hover + stale error), row hover → map draft-overlay highlight in DARK slate (the review
  screenshot caught white VANISHING on the near-white positron basemap — seam asserts can't see
  pixels); blockers verbatim; Run disabled ONLY while a blocker exists / submitting. The overlay
  resolves `target_edge` via networkLookup (zero fetches; new_road members carry junction coords
  captured at add time).
- **Seams:** `__nadiDraftOverlay` {count, zoneTagged, hoveredId, items} — a SIBLING of
  `__nadiChangeOverlay` (count semantics untouched); `__nadiEligEdges` (the `__nadiNetworkEdges`
  convention) — flake-caught race: an edge pick before `/api/edges` lands snapshots
  `car_lane_indices: []` into the KEYED palette (no re-merge on late arrival), empty lane picker;
  specs gate picks on the seam.
- **Tests (`draft-basket.spec.ts` = 8 function pins + 6 e2e):** strings pinned as LITERALS (never
  constant-vs-constant — tautological pins can't catch drift); mixed 3-member draft (composite
  POST membership `.sort()`ed); single-change deep-equal pin; settled+severed toggles (incl. all-car-lanes lane_closure); LIFO crossing blocked
  + nested/touching legal; zone macro = NO POST until Run; error-verbatim + draft survives
  (re-pinned to the PERMANENT one-job 409 — a mocked transitional 400 would stay green after V2.4b
  deleted its string; pin only permanent shapes). The 4 apply-driving specs (closure-palette, edit,
  seeds, school-zone) each gained ONE `draft-run` click with body assertions byte-identical — that
  IS the pin; closure-palette's 400 assertion moved `palette-error` → `draft-error`. Follow-up
  also CLASSIFIED + resolved the 2 inherited eslint react-hooks errors (graphsSidecar kick-off
  setState → queueMicrotask, the in-file `?compare=` precedent; the interview transcript ref+tick
  hack → a plain state record — the tick papered over a render-time ref read); `npm run lint`
  exits 0. Suites: **419 pytest + 67
  Playwright**.
- **Dormant plumbing (still standing at V2.4 close):** `submitError` is permanently null into the
  palettes/DrawForm (every Run error routes through `draft-error`) — strip when next touched.

**V2.4 Step b — the CLOSURE COMPOSITE runs for real (no contract change; both dormant honesty
paths production-exercised; docs/v2.4-plan.md D2/D3 landed).**
- **The lift:** composite members = `WINDOWABLE_TYPES` exactly — the REPLACED single-source
  `REASON_COMPOSITE_MEMBER` names bike_lane (one shared target_lane threads the pipeline) and
  new_road (regenerated network) as non-composable, anti-drift-pinned against the tuple;
  `REASON_COMPOSITE_SETTLED` STAYS (the settle path hard-asserts len==1). Per-member rejection
  matrix at BOTH layers with shared strings (`change {i}: ` at POST, `composite change {i}: ` at
  spec-load, which reads the net — cached `_spec_net()` — for edge existence/car-lane
  subsets/incident effects; a bad member dies as a clean SystemExit, never a mid-run KeyError).
  **The serializer is a per-type ALLOWLIST** — `model_dump(exclude_none=True)` would leak
  SimChange's non-None new_road defaults, and the old serializer hardcoded the speed_limit shape
  (silently DROPPED target_lanes/effect) — mixed-handoff-pinned. Mixed run description: `"N
  changes on the corridor"`; the school-zone label gains an all-speed_limit guard.
- **Dormant path 1 (scorecard composite-null), production-first:** the note names BOTH counts —
  `"composite scenario — {contributors} of {changes} changes affect this group's access; not
  separable yet"` (user-ratified; "(3 changes)" would overclaim which members were unsummable) —
  FIRED live on `…20260810T201735Z` (2 unwindowed lane_closures via the basket; audit 5 clean).
  Newly-reachable branches pinned: exactly-one-contributor renders the real ordinal + "rule-based
  estimate"; zero-contributor mixed composites take the FIRST `_NULL_WITH_NOTE` member's note
  (order-dependent BY DESIGN, commented + pinned).
- **Dormant path 2 (detour multi-member exclusion), production-first:** run `…20260810T200300Z`
  (road_closure `-36784353#20` 600–1200 + permanent speed_limit `-1288863201` + factor-only
  incident `-1288863202#6` 600–1680) — the destination rule ran CLEAN on its first real 3-edge
  exclusion (primary branch, 0 hops); doorstep Station 231 honestly UNREACHABLE during the window,
  232 +10.2 / 234 +29.1 / 243 +2.7 s. The payload LOGS the estimate's shape: `modified_edges`
  (sorted union), `destination_anchor` (changes[0]), and — iff multi-member — the ORDER-DEPENDENCE
  note (`"destination anchored to the first change; with multiple modified edges this choice is
  arbitrary and affects the estimate"`), verify_facts-pinned conditional on key presence (old
  sidecars legitimately lack them). **speed_limit members now shape the during-window net** (the
  hasattr-guarded SUMO-1.27 `_speed` poke; an unapplied slowdown under-reported added_s);
  `compute_response_detour` applies ALL members. Zero-note PRE-READ verdict held: `blocked_only`
  False → the route-avoidance sentence, TRUE post-fix; the singular "the changed road" on
  multi-edge composites is awkward-not-false → BACKLOG rung-2.
- **Span + chips:** `build_scope_disclosure` needed NO change; the CLIENT reached lockstep —
  `windowedScope` feeds the ScorecardPanel note the differing-windows clause (client copy of
  `zone_lens.span_note`) + the mechanical subject, live: *"measures cover the full run; windowed
  changes active t=600–1680 s (members carry differing windows; these figures use the spanning
  window)"*. RunCard chips are `status.changes`-driven: the window chip SINGLE-change-only
  (member-0 chips misdescribed composites), untagged multi-member runs get the mechanical
  composite chip (`"N changes · active {span}"`), zone-chip precedence kept; **the split's
  backlog-attribution parenthetical now rides the RunCard too** (the V2.2c chip exemption ENDED,
  user-ratified — the invariant holds on every surface). Done-stage run-state keeps `changes`
  when tags are present (the 1-member tagged composite's zone chip died at done — fixed).
- **Acceptance notes:** the ratified draft's "windowed speed limit" adjusted to PERMANENT (the
  EdgePalette's speed_limit is unwindowed BY DESIGN — windowed speed limits are the zone macro's
  shape); the windowed-subset subject rule exercised instead (disclosed). TFS's mixed-composite
  citation: "1 of 4 fire stations unreachable during the window; worst of the reachable +29.1 s…"
  (214 agents, ops on 5 diversions, TDSB absent). Reports regenerated with explicit --run-id;
  singleton RESTORED after each (V2.1 practice). Screenshots `docs-assets/v24b-*.png`. Suites:
  **429 pytest (+10; 1 pre-existing environmental skip) + 69 Playwright (+2)**.

**V2.4 Step c — CLONE-AND-TWEAK + RUN IDENTITY (no contract change; the artifact stays the
simulation record, the workspace lives in a sidecar).**
- **Clone-to-draft (`RunCard` ⧉ → `MapView.cloneToDraft`):** any finished run's `changes[]`
  (`status.changes ?? [status.change]` — single-change runs carry only the singular) REPLACES the
  draft as fresh members (bulk id-mint outside setState — the zone-macro StrictMode idiom);
  `origin:'zone'` reconstructed on every member iff school_zone-tagged (else runDraft's tag
  derivation silently drops the tag); runOptions restore; `setActiveRunId(null)` is LOAD-BEARING
  (DraftPanel gated on !activeRunId). Name/note NEVER copied (D4: a new scenario earns its own).
  Cross-version pinned against the REAL 0.8.0 school-zone fixture. Disclosed limits: cloned
  new_road members get no draft overlay (path captured at add-time only); 400 verbatim inside a
  multi-member draft.
- **Identity (`state/<run_id>.identity.json` — the THIRD file class under list_all's one glob,
  coexistence-pinned):** `run_state.identity/set_identity` — FULL-REPLACE, trim, both-empty
  DELETES the sidecar; exactly ONE writer (`POST /api/runs/<id>/identity`) so it is race-free vs
  the harness's unlocked read-merge-write `set_stage` BY CONSTRUCTION (rename works mid-run;
  state-file purity pinned: set_stage never carries name/note, the sidecar survives state
  rewrites). STATE_DIR reader audit (user fold-in): list_all is the ONLY glob reader; every other
  access exact-path — checked, not assumed. Server: pinned 403 FIRST (sibling
  `PINNED_IDENTITY_REASON`/`pinned_identity_blocked`, same env override, byte-pinned across python
  + the Playwright copy) → 404 → caps on TRIMMED values (`name too long (N > 60 chars)` / `note
  too long (N > 500 chars)`) — SERVER caps are the enforcement (client maxLength convenience);
  markup stored VERBATIM — inert RENDERING is the single deliberate defense, pinned end-to-end on
  BOTH surfaces (RunCard `run-name` + the picker `<option>`) so any future name-rendering surface
  inherits a failing test.
- **Render surfaces:** `runLabel` (RunSwitcher — the one label function for the edit rail + both
  compare pickers) gives the name precedence over the mechanical description, 40-char-truncated;
  name-LESS output BYTE-IDENTICAL (zero ripple, proven by running school-zone/edit/draft-basket
  unmodified). RunCard: `run-name`/`run-note` + the rename affordance (`rename-toggle` →
  name/note inputs → save merges the response into LOCAL status — the poll has stopped on
  terminal runs and would never repaint); errors
  verbatim incl. the pinned 403. CompareView's ProvenanceStrip stays id-canonical (reads the
  artifact).
- **Tests:** `test_run_identity.py` ×8 (sidecar semantics, list + state purity, guard matrix,
  endpoint round-trip/clear/caps-exact/markup-verbatim/403-before-404) + the three-file-classes
  glob regression widened; `run-identity.spec.ts` ×4 (cross-version clone with the tag surviving;
  rename card+picker+reload; pinned refusal byte-compared against the python constant; injection
  inert both surfaces). Live smoke: renamed the V2.4b acceptance run; pinned rename 403'd. Review
  fixes: `identity()` guards non-dict JSON (the read() bug class — one damaged sidecar 500'd the
  whole list, four shapes pinned), mid-run rename TEST-pinned (200 while try_acquire holds), UI
  clear/note-only pinned, DraftPanel's lane summary optional-chained. Suites: **439 pytest + 73
  Playwright**.

**V2.5 Step a — disclosure and wording debts (no contract change; every payload key is
sidecar/off-contract, every sentence lives in existing free-form fields).**
- **Item 1 — the WINDOW-COINCIDENCE DISCLOSURE:** `response_probe.WINDOW_COINCIDENCE_NOTE` +
  `window_coincidence_note(changes)` (single source, `str | None`): fires iff >1 member AND >1
  distinct window among WINDOWED members — one windowed member + permanents is EXACT, while two
  distinct windows + a permanent member DELIBERATELY fires (the two windows alone overstate
  constraint; pinned with its own case). Rides payload → report Section-1 (after anchor_note),
  LIFTS into TFS citation notes (framing stays `notes[0]`), reaches the chat-corpus
  `response_access` doc. verify_facts: recompute-and-compare, ALTERED-or-SPURIOUS fails, ABSENCE
  TOLERATED — review-caught BLOCKER: the gate key `destination_anchor` is unconditional since
  V2.4b, so a V2.4b-vintage sidecar (`…20260810T200300Z`!) enters the gate while legitimately
  lacking the new key — a full REQUIRED-iff made its report unregenerable; the producer pin owns
  the "missing" direction. Keyless payloads render NOTHING new (golden safe). LESSON (joins the
  anchor_note precedent): a REQUIRED-iff gate must key on a marker of the SAME VINTAGE as the
  required key — an older sibling admits every run between the sibling's birth and the key's.
- **Item 2 — the honest-zero note PLURALIZES from the edge union:** noun+verb from
  `len(modified_edges)`, never `len(changes)` — two members can share one edge and the sentence is
  about roads; the divergence shape (2 members, 1 shared edge → singular) has its own pin,
  mutation-checked. `destination_note` strings untouched (rung-2's problem, BACKLOG).
- **Item 3 — the DISJOINT-SPAN CLAUSE:** `zone_lens.DISJOINT_SPAN_CLAUSE` ("the spanning window
  includes periods where no change was active") + `windows_disjoint(changes)` — ALL members
  windowed AND the merged union leaves a gap; a permanent member fills gaps (mixed sets never get
  the clause — it would be false); touching windows contiguous (the LIFO boundary convention).
  Rides INSIDE the differing parenthetical after the pinned span_note substring (the
  scope-disclosure equality recompute covers it with zero new verify code; stripped-clause leg
  pinned); client lockstep = `windowedScope.disjoint` (line-faithful port) → ScorecardPanel.
  Pinned on the exact understatement shape ([0,300]+[1500,1800]). `resolve_window`/zone_facts
  `window_note` deliberately NOT extended (stated non-goal).
- **Item 5 — the PRODUCER-REAL 0.9.0 FIXTURE (hand-mock retired):** the spec's hand-mocked mandate
  agent had ALREADY drifted (its disclaimer matched neither producer string, surviving on a shared
  substring — the predicted failure mode, found paid). Committed `institutions-run.json` = genuine
  0.9.0 via the real deterministic chain (build_multimodal_artifact + compute_scorecard +
  speaking_institutions → compose_citations/compose_reaction → reactions.build_agent; sim/inferred
  PROSE stubbed — structure producer-real, said in the docstring); change set = the SYNERGY shape
  (2-member all-windowed DISJOINT composite whose detour payload carries the item-1 note) so ONE
  fixture exercises items 1+3+5 in the real UI. Companion `institutions-report-section.json` =
  `build_institutional_section` output verbatim; `test_institutions_fixture.py` follows the
  school-zone regen-pin convention (recompute-equals incl. AGENTS; roster byte-pin; regen via
  `python python/tests/test_institutions_fixture.py`). institutions.spec.ts is fixture-driven.
- **Item 6 — the PRETTIER HOOK LEG REMOVED (hazard closed, CONFIRMED LIVE 2026-08-14):** verified
  armed-but-configless (no config/dep anywhere; inert by cache state only); leg deleted, eslint
  keeps the TS leg. The check ran the CONCLUSIVE variant: prettier SEEDED into the npx cache
  (`npx --no-install prettier` resolving — the exact 231-line-reformat precondition), a
  single-quoted probe .ts through the live hook,
  byte-identical after; probe deleted, cache restored as-found. PRECISION: the activation-lag
  caveat covers settings.json REGISTRATIONS only — a registered command (`python format.py`)
  re-executes its current script body every invocation, which is why the check was valid
  same-session.
- Suites: **457 pytest (+18) + 75 Playwright (+2)**; unwindowed golden byte-identical throughout.
- **Item 4 — the institutional chat index PROVEN LIVE (2026-08-13):** built the 235-doc LightRAG
  index for `multimodal-scenario-20260810T200300Z` and proved chat draws on an `institution__` doc
  end to end: *"what does the fire service's mandate say about this closure?"* → mandate substance
  + the unreachable-station fact + "free-flow estimates and not a dispatch model", digit-free,
  audit CLEAN, `sources[0] = "Institutional perspective (tfs, mandate lens)"`; the retrieved
  `institution__tfs` chunk carried the VERBATIM mission, the +29.1 s citation naming Station 231,
  both honesty notes, the impersonation disclaimer. NB the FIRST ask deflected honestly —
  retrieval-grounding solid, generation conservative; the retry answered. Acceptance RESTATED
  before running (chat prose is digit-free and the disclaimer lives in the retrieved doc — never
  injected into prose). Index re-archived after; the pinned run's index restored as the only live
  one.
- **FORENSIC FINDING (user-directed):** the committed latest-report singleton belonged to
  `multimodal-scenario-V22AACCEPT` from commit `0bead19` ("feat: demo run", 2026-08-11) —
  `discourse.spec` was RED ~2 days unnoticed (the divergence landed AFTER the V2.4 closeout's
  73-green claim `953ab00`, honest when made; no full suite ran between). Same failure mode as
  2026-07-13 (`a366328`). LESSON: green-suite claims age only as long as the two singletons
  (committed `latest-report.*`, served index) stay put — any demo/regen touching either must
  re-run `discourse.spec` before landing. Fixed by regenerating for the pinned run (audit 10
  clean / 0 / 0 — no drift flag); `discourse.spec` 4/4.
- **CORRECTION:** `newest_index()` was a LEXICOGRAPHIC name sort, not newest-timestamp —
  `index-V22AACCEPT` outsorts every `index-<ts>` name (`'V' > '2'`); the live proof required
  archiving BOTH previously-live indexes first (Run-commands note fixed).

**V2.5 Step b — RUNG-2 RESPONSE REACHABILITY (end-node probing REPLACED the anchor walk; no
contract change — the payload is sidecar/off-contract; design ratified per-axis before code).**
- **The fact:** per capacity-event member × per segment END NODE × per station — "can you still
  reach addresses ON the changed segment, and from which direction?" cost-to-end = min over ALL
  incoming passenger approaches per net (NO exclusions — the mutated nets encode member state;
  baseline-via-the-segment is real; a reverse partner is just an approach), independent
  best-per-net disclosed by `END_METHOD_NOTE`. `destination_edge()`/anchor keys DELETED — the
  anchor arbitrariness retired BY CONSTRUCTION; shape-split ends EMBRACED (an end whose only
  approach is the closed segment IS unreachable — pinned live on KINGSTON's north end). Ratified
  axes: member gate = `capacity_event` (same predicate, two arities) + `PROBED_MEMBERS_NOTE`
  REQUIRED-iff a member fails it; aggregated citations; promote-on-new-shape verify. `position_m`
  SUPERSEDED at this rung (whole-edge effects; rung 3 gets per-window nets).
- **Labeled states, verify-RECOMPUTED (the label IS the causal fact):** no_approach (boundary
  stub) / baseline-unreachable / window-unreachable / ORIGIN-CLOSED (explicit permission check,
  scenario legs DECLARED not computed — the doorstep station carries its CAUSE, never four bare
  unreachables) / one honest-zero constant. verify_facts recomputes each row's expected state from
  nullness + the change list against VERIFY-SIDE literals; the `members` key is a same-vintage
  marker BY CONSTRUCTION, so end-method/probed-members/coincidence notes are FULL REQUIRED-iff on
  the new shape (absence FAILS) while the legacy branch keeps V2.5a's tolerance untouched.
- **Rollups:** report = per-member heading (type + edge + fmt_window) + ONE line per end,
  per-station figures + causes in the parenthetical; citation = per-member clauses with per-end
  worst-of-reachable + "u of n unreachable", fully-reachable/-unreachable pairs COLLAPSE, capstone
  names ONLY stations unreachable at EVERY probed end (one-end-cut-off = a count, not a name);
  chip = "U of E segment ends unreachable · worst +X s (M segments × S stations)" — ends the
  counted noun (E excludes no_approach/baseline-unreachable; unreachable iff NO station reaches
  it); corpus keeps FULL per-station rows. **VOCABULARY SPLIT: new-shape prose says "added time to
  reach" and NEVER the number-bearing "s added response-route time" — test-pinned per surface;
  old "+29.1 s detour-past-anchor" and new "+X s to reach an end" are DIFFERENT measurements;
  CompareView is the named BACKLOG exposure (cross-shape deltas get "—†" if it ever enters).**
  Legacy `probes` sidecars render byte-identically everywhere (shape-keyed branches; the three
  verbatim Playwright chip pins green unmodified; a shapeless payload → labeled fallback,
  crash-hardened; `_cite_response_detour` raises on neither-key — the false-"could not be
  computed" trap structurally unreachable).
- **Accepted live (`multimodal-scenario-20260814T063253Z` — the doorstep composite rerun):** road
  closure `-36784353#20`: **east end worst of the reachable +1.7 s (via the reverse partner
  `36784353#18`); west end worst +29.1 s** — the old anchor's +10.2/+29.1/+2.7 were the WEST
  end's numbers; the new fact adds the direction answer. **Station 231 carries ORIGIN-CLOSED at
  every end** (was a bare "unreachable"); `probed_members_note` fired (3 modified edges, 2 probed
  members); coincidence note rides (600–1200 vs 600–1680). verify_facts (incl. state-label
  recompute) green on the live sidecar; 214 voices (TFS spoke the aggregated citation with all
  six notes, capstone naming 231); report audit 8 clean / 1 corrected / 0 unresolved; singleton
  RESTORED + discourse.spec green same-arc (the V2.5a lesson). **Analysis cost (measured, the
  V2.5c input):** `compute_response_detour` = **3.0 s net reads (×2, the dominant pre-existing
  cost) + 0.56 s routing = 88 `getOptimalPath` calls** — the routing multiplication is a rounding
  error; the leg is net-read-bound. `wall_clock_s` now records `analysis` + `response_probe`
  permanently (land on the NEXT run — multimodal path only). Screenshots `docs-assets/v25b-*.png`
  — the feed instBlock FITS (fallback lever recorded: worst-end-only per member); chip wraps
  mid-word via the pre-existing `wordBreak: break-all` card style (V2.7 UI territory).
- **Review catch (fixed + pinned):** the members render's no-reachable branch counted
  baseline-null/unmatched rows into "unreachable from all N stations DURING THE WINDOW" — a false
  causal count on mixed ends. The count now uses the same finite-baseline filter the
  capstone/citation recomputes used ("all K stations with a baseline route" when counts diverge);
  the citation's "u of n unreachable" and the chip's end counts are DELIBERATELY cause-neutral
  (the report carries causes); the citation dispatcher's truthy members gate is deliberately
  stricter than the renderers' `is not None` (empty members → ValueError, commented).
- Suites: **470 pytest + 77 Playwright** (+2 chip cases; producer tests rewritten with probed
  real-net literals — compass labels, the shape-split end, the reverse partner, a real
  no-approach stub edge, the doorstep origin-closed case).

**V2.5 Step c — the TWO-JOBS FIX and the FRAME BUDGET (latest.json split + perf measured-first;
the biggest finding was about the MEASUREMENT, not the app).**
- **latest.json is a POINTER, never a payload** (`{"run_id": ...}` via
  `trajectory_io.write_latest_pointer`), written ONLY on quant-run completion — scorecard
  recomputes and propagation enriches no longer touch it (DELIBERATE: an enrich of an old run
  silently stealing the default was the accidental-repoint footgun, H3 of four recorded
  sightings; the payload job was already broken — the voices enrich never rewrote it). MapView
  resolves the pointer → `/<run_id>.json`; a legacy payload-shaped latest.json still works but
  EXPIRES LOUDLY (console.warn + scheduled V2.7 removal in BACKLOG). Python consumers migrated
  (propagation id-read; oasis_spike resolve; test_propagation pins the COMMITTED social run).
  Dead `web/lib/loadArtifact.ts` DELETED (zero importers — client-side ajv NEVER ran; stale
  "client ajv-validates" comments corrected).
- **Spec immunization (`web/tests/support/default-artifact.ts`):** every `goto('/')` spec routes
  the POINTER PAIR (pointer + resolved artifact with the ~500 ms StrictMode floor delay — the
  split alone would only have MOVED the 90 MB fetch); 7 vulnerable specs migrated, 3 full-body
  mockers switched, discourse.spec's independence test REPOINTS (~50 bytes) instead of copying
  20 MB. **The migration made H4 LIVE:** three specs had never needed the warm-reload convention
  because the real 20–90 MB artifact never resolved inside StrictMode's double-mount window — the
  tiny default fixture DOES, and closure-palette:48 crashed maplibre teardown exactly as the H4
  note predicts; the convention is now on every `goto('/')` site. **Reporting lesson
  (self-caught):** `tail -2` on the Playwright summary ATE the "1 failed" line above "N passed" —
  capture the summary BLOCK, not its last lines. **DOUBLE ACCEPTANCE (post-fix), both green:**
  the real pointer aimed at the 90 MB exemplar, then latest.json DELETED entirely (the stronger
  form — anything breaking on missing-X is still coupled).
- **Perf, measured first (`scripts/perf-harness.mjs`, prod build, permanent `nadi:*` marks):**
  the headless 0.36 FPS "catastrophe" was 99.2% native "(program)" time — **SwiftShader: headless
  Chromium's software rasterizer. Frame numbers are HEADED (hardware-GL) numbers or they are
  numbers about the rasterizer** (`--headed` + `--profile`; the sampler is TIME-bounded). HEADED
  TRUTH, 90 MB exemplar: transfer 26.9 MB gz / fetch 2.9 s / parse ~3.4 s / **nav→first-render
  3.9 s** / heap 189 MB / **frames p50 13.6 ms (74 fps), p95 14.1 ms (71 fps), 0 longtasks**.
  Synthetic control: ~1.1 s, 137 fps.
- **The one indicted fix, A/B'd on hardware:** the TripsLayer trails array was rebuilt every
  render (time-invariant contents) → deck re-tessellated per rAF tick; one `useMemo` took the
  exemplar from p50 20.9 ms (48 fps) / p95 27.8 ms (36 fps — grazing the floor) to 74/71 fps.
  **Everything else measured NOT indicted and deliberately NOT built** (the ratified
  measurement-gated protocol): subtree memoization, trajectory thinning, the eager-slim split,
  network simplification — verdicts + levers in BACKLOG for V2.7. The "36 fps playback"
  aspiration RESOLVED (74 fps).
- **BUDGETS (headed, prod build, this box — re-measure at V2.7 checkpoints; no CI gate,
  ratified):** nav→first-artifact-render (the nadi:artifact-rendered mark — a React-commit
  proxy, not a Paint Timing event) ≤ 5 s @90 MB (achieved 3.9 s), ≤ 2 s @~20 MB (~1.1 s);
  scrub/playback p95 ≥ 30 fps at the concurrency peak (71 fps). The contract payload rung (~50%
  wire waste: unused speeds, regular timestamps, 14-decimal coords) measured + BACKLOG'd for the
  0.10.0 ceremony.

**V2.5 Step d — the PRESENTABLE CORE; V2.5 CLOSED and TAGGED `v2.5` (deployment decided, README
rewritten for the cold reader; no contract change all phase).**
- **Deployment ratified (a)+(c), docker + video skipped (shot list committed instead):** a STATIC
  read-only demo for Cloudflare Pages + local-setup docs. Pure client SPA, so `next.config.ts`
  gains ONLY `output: process.env.NEXT_STATIC_EXPORT ? "export" : undefined` (npm run start stays
  for the perf harness). `scripts/build-static-demo.mjs`: export build → prune `out/` to the demo
  set (the pinned triple + `network.json` + `latest-report.*` + the MODERN run
  `multimodal-scenario-20260814T063253Z` — committed via a `.gitignore` negation,
  check-ignore-verified, ~20 MB permanent history RATIFIED) → build-writes `out/latest.json` (the
  pointer never committed) → manifest + a 25 MiB/file Cloudflare guard. Bundle 43.9 MB; smoke on
  the served bundle green (three stops + the compare deep-link).
- **Demo honesty (user fold-ins):** dead controls DISABLED-WITH-WHY — build-time
  `NEXT_PUBLIC_STATIC_DEMO` + single-sourced `web/lib/demo.ts` `DEMO_READONLY_NOTE` ("read-only
  walkthrough of pre-computed runs; editing, chat, and interviews need the local backend (SUMO + a
  model key) — see SETUP.md in the repo") on every gated surface (the ✏️ Edit toggle, chat form,
  🎤 interviews); non-demo builds byte-identical. The README says PLAINLY that demo runs are
  PRE-COMPUTED and REAL. In passing, the landing's ONE unlabeled failure mode got the labeled
  treatment (TDD): `artifact-load-error` early return on !r.ok / bad pointer / bad shape,
  spec-pinned (404 + malformed in discourse.spec).
- **Setup docs:** `python/requirements.txt` (authored from actual imports, pinned from the live
  env; traci/sumolib called out as SUMO_HOME imports, NOT pip), `python/.env.example`, `SETUP.md`
  (SUMO 1.27 named LOAD-BEARING, the two-env oasis boundary, per-layer key table, the fresh-clone
  netconvert note).
- **README rewrite (the discipline applies to the pitch):** cold-90-second-reader structure —
  plain pitch, demo stops, the honesty-architecture thesis (the BANNED sweep counted not
  guessed), three computed facts EACH with riding caveats (the V2.5b per-end fire-station
  sentence verified verbatim against the committed run's TFS citation, "added time to reach"
  vocabulary only; the 30-vs-28 zone pair with variation + population notes; 72%-delivered
  saturation with the GEH-51.8% structural framing), what's-real/what's-not, the two-graphs
  one-liner, pointer-aware architecture diagram. Traps killed: the retired anchor-arbitrariness
  disclosure sold as a feature, the old-vocabulary +29.1 s roadmap line, the stale roadmap.
  Screenshots captured and LOOKED AT; orphan `sample-initial.png` dropped;
  `docs-assets/demo-shot-list.md` = the optional 90-second recording script.
- **Reconciliation:** BACKLOG bullets marked SHIPPED where landed; CLAUDE.md rollup/test counts
  refreshed; `DEPLOY.md` at repo root (docs/ is gitignored): Cloudflare Pages via wrangler or
  connect-repo, the 25 MiB cap, why GitHub Pages project sites fail (root-absolute fetches vs
  basePath) — the deploy click itself is the user's.
- **Review fixes:** the README's "every changed segment" overclaim narrowed to the probed
  capacity-event members (the PROBED_MEMBERS_NOTE duty applies to the pitch too); fastapi/uvicorn
  HOISTED to base `requirements.txt` (server.py fronts the PRIMARY flow — a fresh clone's uvicorn
  hard-failed on the base-only install; agent extras keep RAG-only deps); the ✏️ Edit toggle
  renders VISIBLY disabled in the demo (was attribute-disabled but visually indistinguishable —
  modeBtnDisabled, verified by a looked-at toolbar screenshot) and the InterviewDrawer demo note
  dropped the ERROR styling (a property, not a failure); the STATIC_DEMO gating's
  no-spec-coverage gap RECORDED in BACKLOG (build-time flag → needs a second Playwright project
  over `web/out`; smoke-verified only until then).

**V2.6 Step a — the ROOM, server-side (group interviews; ephemeral like V2.3b, no contract
change; the plan's review blocker fixed + pinned same-arc).**
- **`POST /api/group-interview {run_id, agent_refs[3..5], question, transcript}`** — V2.3b
  id+index addressing; DUPLICATES rejected by RESOLVED-record identity, never ref equality
  (`("veh0", None)` ≡ `("veh0", 0)` is one voice; two same-persona.id SIBLINGS are two legal
  voices); per-ref 404 names the failing position (`agent_refs[i]`); refs count = manual 400 with
  the `3..5` detail; otherwise the single endpoint's matrix (400 empty/oversize q, 404/409, 503
  no key, NO one-job lock, guard failures = 200 + per-speaker audit).
- **Sequential generation in agent_refs order** — each speaker's grounding built independently by
  the UNCHANGED `build_grounding` (the structural leakage guarantee carries over); each answer
  appended to the shared working transcript before the next speaker generates — cross-agent
  content flows ONLY through actual utterances. Leakage matrix pinned at BOTH layers (unit
  prompt-build + endpoint recorded-prompts): B's markers/digits/minute-forms absent from A's
  prompts always, B reaches A only as B's attributed utterance, institution C never gains either
  traveler's records. One speaker's refusal is that speaker's ANSWER and rides into later
  speakers' context — the room never aborts.
- **Transcript wire** — turns `{role, text, agent_id?, agent_index?}`: the SERVER resolves
  attribution ("<label> said:"), detects self by resolved-record OBJECT identity ("You said:"),
  degrades unresolvable refs to "Another participant said:" (never a 400 — membership drifts
  under re-enrich; the guard floors content). Per-speaker flatten, header "EARLIER IN THIS GROUP
  INTERVIEW (oldest first):", `ROOM_TRANSCRIPT_MAX_TURNS = 24` × the same `TURN_MAX_CHARS`.
- **The room guard (`audit_room_utterance`)** = `audit_interview` per utterance with PER-SPEAKER
  keying (a mixed room's mandate speaker keeps operational/first_person while a sim speaker's
  household-we stays legal, endpoint-pinned) + the ROOM-ONLY `_CROSS_PARTICIPANT` family
  (quantifier-of-us / room-deixis+stance / collective-subject+stance / speaking-for; every
  must-trip form deliberately `_TALLY`-INVISIBLE — the gap the rule fills; "back" support-sense
  only, spatial "went back to" review-FP-fixed; "speaking for" gerund-only so "I can't speak for
  everyone here" stays legal). Planted-consensus laundering pinned end-to-end (the echo dies at
  rule `cross_participant`). **Review-caught BLOCKER fixed: the room's disclaimer strip is
  CONJUNCTION-AWARE** — `_ROOM_CLAUSE_BOUNDARY` added `but|though|although|however|yet` to
  report's punctuation-only boundary ("I can't predict crashes but everyone here agrees it's
  better." previously rode the licensed disclaimer CLEAN). ROOM-LOCAL on purpose: widening the
  SHARED strip tightens every consumer and shifts the audit-retry baseline — recorded as a
  BACKLOG decision, not landed as a side effect (resolved in the V2.6 follow-up).
- **The guarded loop EXTRACTED, not duplicated** — `interview._guarded_generate(client, agent,
  system, user, audit_fn, retry_extra)`: `answer()` a thin wrapper (public behavior unchanged),
  `room_answer()` the sibling (`audit_fn=audit_room_utterance` + `ROOM_RETRY_EXTRA`). EVERY audit
  dict now carries **`calls`** (1 clean/error-first, 2 with retry — generations this module
  issued, NOT `report._call`'s transport retries; the adapter's `usage["calls"]` is a
  process-lifetime singleton, unusable per-request). Room response = `{run_id, question,
  answers[{agent_id, agent_index, persona_label, grounding, answer, audit}], llm_calls}` —
  `llm_calls` = the per-turn sum (the V2.6b cost label derives from it); the single endpoint
  inherits `audit.calls` additively (endpoint-pinned).
- **Room constitutions are ADDENDA constants** (`ROOM_ADDENDUM`, `INSTITUTION_ROOM_ADDENDUM`)
  between the UNEDITED base constitution and grounding — single-interview prompts stay
  byte-stable (pinned: `build_system` output equals the pre-refactor literal composition;
  `_SIM_SHAPE`/`_MANDATE_SHAPE` extracted). The institutional addendum licenses acknowledging,
  third person, what a specific participant SAID (content stays mandate+facts only). System
  prompts stay turn-invariant per speaker (prefix caching); everything shared rides the user
  message — this-round answers render inside the room-transcript block before the restated
  question (a separate this-round block is a `build_room_user`-local change if ever wanted).
- **Ephemerality extended** (a full room POST changes nothing under RUNS_DIR; STATE_DIR never
  created). Tests: `test_group_interview.py` ×32 (guard family both directions, FP set incl. the
  conjunction + spatial-back pins, flatten attribution/sibling/caps, addenda, byte-stability, the
  unit leakage matrix) + `test_group_interview_endpoint.py` ×19 (validation matrix, room order +
  calls, recorded-prompt leakage, refusal-doesn't-abort, planted consensus, mixed-room mandate
  keying, attribution, cap, ephemerality, additive `calls`). Suites: **522 pytest + 79
  Playwright** (no web change; full Playwright rerun green).
- **Env findings (this box, 2026-08-19):** ruff and pyright are ABSENT — the format hook's python
  legs (`ruff format` / `ruff check --fix`) soft-fail, and NO ruff config exists, so
  pip-installing ruff would ARM a configless formatter against non-default-formatted code — the
  V2.5a prettier hazard class exactly (verified: `ruff format --check` wants to rewrite
  pre-existing files; ruff uninstalled again, as-found). Types via `npx pyright@1.1.413`:
  interview.py clean; server.py's 8 errors all pre-existing (lines 529-782, the job-runner
  region).

**V2.6 Step b — the ROOM in the UI; V2.6 CLOSED (transport ratified at plan time; no contract
change).**
- **Transport (RATIFIED over streamed NDJSON): optional `speak: int | None` on
  POST /api/group-interview** — the FULL room still validates on every call (count/resolution/
  duplicates; the range 400 is TWO-SIDED and precedes I/O — a bare `< n` would let
  participants[-1] alias the last speaker); the server generates ONLY participants[speak]; the
  no-speak path byte-identical (V2.6a pins green unmodified). Why fetches: EventSource can't
  POST, `req()` has no stream seam, Playwright can't stream `route.fulfill` bodies — per-speaker
  fetches are individually delayable, so sequential rendering is REALLY pinned. **Fold-in A
  pinned both halves (+6 pytest):** the client-assembled prefix is conversational context ONLY —
  a doctored prefix (fabricated institution-attributed turn, ghost ref, consensus bait) cannot
  reach grounding (system = speaker k's own records), cannot forge attribution (labels
  refs-RESOLVED server-side), and its bait still dies at the room guard.
- **Assembly**: every feed row kind restructured into a flex wrapper (keys on wrappers, inner
  buttons flex:1, the border-shorthand-before-longhand accent ordering PRESERVED —
  computed-style pins green) with a trailing ＋; AgentPanel/InstitutionPanel gained 👥 "Add to
  conversation". MapView stores {agent, index} PAIRS resolved ONCE at add time by REFERENCE
  (`artifact.agents.indexOf` — a copied object breaks to -1; an id-scan would misattribute
  siblings); dup/cap checks INSIDE the setRoomPairs updater (StrictMode double-invoke a no-op —
  identity intrinsic, no minted ids). Min-3 blocker + cap-5 note, both explained in the drawer
  ("each answer is a separate guarded model call").
- **RoomDrawer** (rail card, last playback sibling): per-participant grounding via the exported
  `GROUNDING_SENTENCES` (single source — InterviewDrawer refactored onto it, byte-identity held
  under the existing toHaveText pins); sibling label collisions get a UI-ONLY "(a)/(b)" suffix
  (the BACKLOG item's UI half CLOSED; prompt-side ambiguity deferred); speaker-labeled turns;
  per-answer guard/error notes verbatim; **fold-in B: the "…thinking" row sits on the CURRENT
  speaker — never a global spinner**; a failed speak-call fails THAT SLOT (rows 0..k-1 stand,
  transport error verbatim, Retry resumes from k with the same prefix, "skip the rest of this
  round" keeps the honest partial round). **Review catch (D3, reader-facing): the curation note
  renders in the drawer — "voices you picked, answering one at a time — a conversation preview,
  not a poll or a sample of opinion"** — structural no-tallying wasn't enough said out loud on
  the surface most likely to be screenshotted as a verdict panel.
- **The round machine**: RoomRound SNAPSHOTS the roster at Ask (mid-round add/remove can't shift
  refs); `roomEpoch` orphans in-flight loops on run swap (checked after EVERY await); **review
  catch: a SYNCHRONOUS `roomLoopActive` ref gates Ask/Retry** (React state commits async —
  key-repeat/dblclick double-fired before the 'thinking' commit; dblclick-pinned), freed only by
  the OWNING loop's epoch-conditional finally or by loadRun. Wire truth spec-pinned: turns
  {role, text, agent_id?, agent_index?} — labels NEVER ride; the current question rides its own
  field, entering the transcript only as next-round history. Fix-in-passing:
  `InterviewResp.grounding` gained 'mandate' (api.ts:333, stale since V2.3c).
- **Cost honesty**: estimate "1 question · N voices · ~N×<1¢" + a title naming that retries can
  exceed it; post-round actuals "this round: K model calls" from summed llm_calls **with the
  transit-loss hedge title (review catch: a mid-flight failure may have spent server-side — the
  count never claims completeness)**; dismissed rounds render partial actuals.
- **Ephemerality**: room stores join the loadRun clear; run-swap AND reload kill the session
  (spec-pinned); no client-side persistence surface.
- **Specs (+9 → 88 across 18 files)**: `group-interview.spec.ts` — assembly/blockers/grounding +
  the curation note; sequential render (a delayed speak-1 mock holds the round); the wire pin
  (sorted keys incl. speak, the speak sequence, full-room refs every call, ids-never-facts);
  planted-consensus refusal + per-speaker guard note; institution third-person attributed;
  failed-slot dblclick-Retry; Dismiss partial round; "(a)/(b)" + index-disambiguated sibling
  refs; run-swap + reload ephemerality. The referendum sweep rides 6 of 9 via `sweepRoom`.
  Fixture = `institutions-run.json` BYTES (the drift lesson — the mandate record never
  re-authored) + ONE hand-authored inferred sibling of agents[1].
- **The looked-at gate (`docs-assets/v26b-*.png`)**: ＋ buttons clean beside intact accents; the
  drawer thread tightened 260→200 px — at 260 the question form sat below the right-rail's
  scroll fold (the seam-tests-can't-see-pixels class). NB 3 first-run failures were the
  DEV-SERVER HOT-RELOAD RACE (sources edited while the suite ran against `npm run dev`; all
  green standalone): don't edit web/ sources while a suite runs against the dev server.
  Suites: **528 pytest + 88 Playwright**.

**V2.6 follow-up — the SHARED disclaimer-strip conjunction hole CLOSED (user-ratified baseline
decision; code diff = report.py + interview.py + two test files, no contract change).**
- `report._CLAUSE_BOUNDARY` gained the COORDINATING adversatives (`\b(?:but|yet)\b`, re.I) beside
  the punctuation set — the comma-less "but <claim>" form is re-checked like its comma'd sibling
  in EVERY consumer at once (audit_prose = report slots + chat; audit_prose_cascade;
  audit_interview's verdict/operational legs; the room). RED-proven first: "I can't give a verdict
  but the majority should approve it." audited CLEAN pre-fix at both pinned call sites.
- **The boundary set is deliberately MINIMAL — every exclusion is a pinned decision, not a gap.**
  and/or NEVER (a multi-object disclaimer — "cannot predict crashes or their probability", pinned
  clean since V2.3b — must stay whole or its tail re-enters the crash check);
  though/although/however NEVER — **the review CAUGHT the five-word draft reintroducing the very
  false-positive class the fix's own comment forbade**: as subordinators/conjunctive adverbs they
  commonly CONTINUE a disclaimer ("crashes however unlikely the probability" tripped crash —
  verified live). The review also caught the original and-pin being mutation-INEFFECTIVE (two
  independently-licensed clauses); replaced with the true analog "crashes and their likelihood".
  Every exclusion carries a mutation-effective pin (test_report.py) — the set can neither shrink
  nor grow by drift. Accepted residuals: smuggles joined by and/or/though/although/however
  (retry + prompt rules absorb).
- **The V2.6b room fork is DELETED** (`_ROOM_CLAUSE_BOUNDARY` + `_strip_disclaimers_room`):
  byte-identity confirmed BEFORE deletion, then the shared set narrowed (the room's conjunction
  pins all use "but" forms and ride the shared set unmodified); `audit_room_utterance` reads
  `report._strip_disclaimers` again (one strip, one source).
- Pins PER CALL SITE (the V2.3b hoist precedent — each consumer proven to route through the fix):
  report but/yet-tally + but-crash + cascade/tally (test_report.py), interview/verdict
  (test_interview.py). The audit-retry **BASELINE SHIFT (2026-08-19)** recorded beside the
  2026-07-31 precedent in the provider block; NO paid regen run (precedent-consistent).
  Playwright deliberately NOT run: zero web/ changes — every room spec mocks the backend, a suite
  run would add no evidence. Suites: **530 pytest + 88 Playwright**.

**V2.6 Step c — the 0.10.0 CEREMONY (contract v0.10.0; the V2.5c payload rung PAID; seven
commits C1–C7, every one leaving the full suite green).**
- **The encoding (D6, ratified):** per-entity EITHER-shape timestamps — compact `{t0, dt}` iff
  the write-time regularity check passes (the check IS `contract_models.compact_encoding`:
  per-point closed-form `t0 + i*dt` within `COMPACT_DT_EPS = 1e-6`, never accumulation),
  explicit arrays for teleport-gapped entities (measured 2–10 per calibrated run, gaps 3–216 s —
  TRUE holes kept, lossless by construction); **speeds DROPPED** — the V2.5c "read by no
  renderer" claim was TS-true but python-FALSE (`sampler.worst_moment` computed trigger_t in a
  detached subprocess): the harness now stamps `worst_t` into the outcomes sidecar at record
  time (`stamp_worst_t` before BOTH quant paths' sidecar writes; fires in the same breath speeds
  drop, so new-shape-without-worst_t is impossible by construction) and the sampler's
  `trigger_time_for` falls back to wire speeds ONLY for genuinely old artifacts, raising the
  NAMED `SpeedsUnavailableError` otherwise; **coords 6-dp (~11 cm) at RECORD time** (_record /
  SpillRecorder._flush / run_sim — never dump_artifact: the committed samples' byte-roundtrips);
  ped-PET/SSM keep raw metres.
- **The gate ceremony:** schema enum + description; gates A/B/C/E EXTENDED; NEW gate J
  (pre-0.10.0 re-imposes timestamps+speeds required + forbids t0/dt — in the SAME edit as the
  base required-relaxation) + gate K (0.10.0: speeds:false + per-entity oneOf XOR);
  `audit_version_gate` forward tuples + a raw-dict shape gate keyed on the single-sourced
  `COMPACT_TRAJECTORY_VERSIONS`; MANDATE_VERSIONS gains 0.10.0 BOTH sides (the reactions upgrade
  ladder unchanged — pinned MUTATION-EFFECTIVELY: the test asserts the 0.10.0 alternative FAILS
  validation); `sample_v0_10_0.json` + negatives both layers + pin-relax on the 0.9.0 template;
  literal pins (`expand_timestamps(4.0, 1.0, 3) == [4.0, 5.0, 6.0]` — the shared-inverse-bug
  breaker) + gap positions (start/middle/end) + the cross-language lockstep pin (a pytest reads
  `web/lib/compactTime.ts` and pins the eps literal + formula).
- **The TS dual-path reader:** types.ts makes timestamps/speeds OPTIONAL (tsc forces every
  consumer through `viz.materializeTimestamps` — identity pass-through for explicit,
  materialization for compact), normalization memo'd PER ENTITY-ARRAY IDENTITY — **review catch:
  keyed on `[artifact]` it would re-allocate every compact array on each V2.3a streamed voice
  (setArtifact-spread per voice; the V2.5c trails-identity class)** — split onto
  `artifact?.vehicles/persons`; `__nadiRenderStats` (NEW seam) publishes true point counts under
  both shapes + a literal-anchored expansion sample; `compact-run.json` producer-real
  (regen-pinned) with mid-gap + tail-gap entities; specs pin the seam constants hand-written.
- **new_road.via = CONTRACT CAPACITY, REFUSED at runtime** (POST 400 + validate_new_road; an
  ignored via would emit an artifact that lies about simulated geometry; `SimChange` is
  extra-ignore so via had to be ADDED to the request model for the 400 to be reachable;
  threading BACKLOG'd). Schema-loose like its five 5.1 siblings.
- **Acceptance (live):** fresh run_sim (300/300 compact, 3.35 MB) → golden refreshed (same
  146,269 points; the 5-dp digest transparent to 6-dp coords); full E2E — harness (worst_t
  stamped 511/511) → sampler consumed worst_t (no fallback) → DeepSeek voices (213 agents incl.
  a LIVE mandate voice at 0.10.0) → report **audit 8 clean / 1 corrected / 0 unresolved — the
  conjunction baseline's FIRST READING, no uptick vs V2.5b's 8/1/0** → singleton restored →
  HEADED browser smoke green (511 compact joined, path==ts counts;
  `docs-assets/v26c-live-smoke.png` looked at). NB headless sad-tabbed under SwiftShader AFTER
  the join — headed passed in 5.9 s (the rasterizer lesson extends to renderer crashes: real-run
  render questions are HEADED questions).
- **MEASURED (V2.5c harness, headed, prod, the 90 MB exemplar):** raw 90.5→40.7 MB (-55.0%),
  **gzip 26.9→7.6 MB (-71.8%)**, fetch 2.7→1.1 s, parse 3.3→1.4 s, **nav→first-render
  3.72→1.83 s** (clears even the ~20 MB-class ≤2 s budget), heap 189→90 MB, frames IDENTICAL
  (p50 8.2 ms/122 fps, p95 16.4 ms/61 fps, 0 longtasks), join 2→7 ms (the normalizer's cost,
  visible where the plan wanted it). The re-encode measures BYTES only; correctness lives in the
  literal-anchored tests. Committed-demo datum: 20.08→9.03 MB (55.1%). 1589/10 compact/explicit.
- **Incidents (both handled + recorded):** `newest_instrumented()`'s lexicographic sort FIRED
  during acceptance (instrumented-V22AACCEPT outsorted the fresh ts name; the stale-roster
  enrich burned the Groq day cap; untracked scratch only; the rerun used explicit
  `--instrumented`; the fix candidate BACKLOG'd beside `newest_index()` — the same bug twice,
  later killed by the resolver-family fix). Suites: **556 pytest + 91 Playwright**. The
  trajectory-contract SKILL.md refreshed (was stale at "Current: 0.5.0"; cardinal rule 3 turned
  actively false by this bump; the recipe documents the REAL ceremony).

**V2.6 Step d — the CURVE drawn, run, and rendered; V2.6 CLOSED and TAGGED `v2.6` (no contract
bump — the 0.10.0 via capacity consumed; six commits C1–C6 + a review-catch commit).**
- **Via encoding (ratified):** `'lon,lat'` coord-pair strings in the existing `via: list[str]` —
  the schema SHAPE untouched (array of string, the 5.1 schema-loose pattern), the RECORDED
  DECISION riding ALL THREE mirrors (schema field description + `contract_models.Change.via` +
  `web/lib/types.ts`; the user hold: a type that lies slightly is kept honest by the comment at
  every surface a reader might hit first). `parse_via_item` STRICT (exactly two finite floats,
  lon first; three-float / non-numeric / NaN pinned; the lat-lon SWAP class caught downstream by
  bbox containment), field-validated at construction (NB `Change` has no `validate_assignment` —
  tests construct via kwargs).
- **The four geometry rules, ONE source:** `network_edit.new_road_via_reason(from, to, via, net)`
  — junction existence → `VIA_CAP=8` → per-point bbox (BEFORE distances, so a swap gets the
  study-area sentence) → `MIN_SEGMENT_M=10` along `[from,*via,to]` → proper self-intersection
  (strict orientation products; shared endpoints/collinear touches are NOT crossings). IDENTICAL
  sentences at POST 400 (parse first, then rules against the lazily-cached `canonical_net()`),
  harness `SystemExit` (BEFORE the try/run-state — `except Exception` can't catch a SystemExit),
  and `patch_network` ValueError (the direct-caller backstop). The bbox rule earns the design: an
  exterior waypoint would widen the net boundary and die as a mid-run gauntlet AssertionError —
  it becomes a sentence before netconvert ever runs.
- **Producer:** `_write_edg_xml(…, shapes)` emits `shape="x,y x,y …"` ([from-node coord, *via →
  `convertLonLat2XY`, to-node coord], reverse edge reversed) — NO `length` attr (netconvert sums
  the shape: simulated distance IS the drawn geometry), NO `spreadType`; via-less output
  `.edg.xml` BYTE-identical (pinned). **The empirical probe ran BEFORE code locked** (scratch, real net): a
  plain-XML shape survives `--sumo-net-file` re-import UNSHIFTED (geo-ref + convBoundary
  byte-identical), netconvert prunes NOTHING (an exactly-collinear point survives), the readback
  centerline sits half a road-width right (spreadType-right — today's chords share it) → the
  SHAPE-FAITHFUL readback asserts the strict point COUNT (`len(via)+2`), never positions.
  `--via=` is the =form everywhere (a 'lon,lat' value starts with '-': the reverse-edge argparse
  class). Harness/server/network_edit CLIs all take it.
- **Editor:** empty-map clicks mid-draw add BENDS; `web/lib/viaRules.ts` mirrors the server's
  literals + rule order (`via-rules.spec.ts` pins them as strings with the Python matrix's
  structural cases, incl. the 8th-via-LEGAL boundary — a >=-for-> port typo makes a false client
  blocker the server backstop can never catch); a refused click shows the server's sentence as
  the drawHint and adds nothing; the closing segment checked at the B click AND the mid-form B
  replacement. **The equirectangular-vs-UTM threshold gap is a RATIFIED residual** (recorded at
  the top of viaRules.ts): within centimetres of a threshold a client-accepted click can still
  400 at Run with draft-error verbatim — tightening the client would reject valid clicks to
  dodge a rare, handled rejection. Working line = PathLayer `[A, …vias, tip]` (orange idiom;
  V2.7 restyle deferred); Escape pops the last bend, bare Escape cancels (the app's first
  keyboard surface; `undo-bend` mirrors it); via rides the wire as 6-dp strings while the
  straight road's `{change}` stays byte-identical (toEqual-pinned); `changeSetKey` projects via
  (BACKLOG paid); the draft overlay renders the bent captured path; playback resolves
  `[a, …parseVia(via), b]` (tolerant: a legacy junction-id via degrades to the chord). new_road
  stays composite-EXCLUDED.
- **Spec lesson (caught live):** `__nadiEdit` re-registers only after a React commit —
  back-to-back seam clicks run a stale closure and are silently swallowed; every via spec gates
  each click on its UI reflection (the canonical draw test's convention). The headed acceptance
  driver needed the same gate live.
- **Acceptance (`multimodal-scenario-20260823T020424Z`, synthetic, real UI against the live
  backend):** 3-bend connector 8721888314→11747314439 (the 5.1 demo pair): both minted edges
  5-point shapes, length == polyline (953.7 / 960.1 m), length/chord 1.0505/1.0507, **4 cars on
  the new road**, 7 rerouted; `docs-assets/v26d-curved-draw.png` + `v26d-curved-playback.png`
  looked at. **Two honest-zero curves preceded it, kept as findings** (BACKLOG): the 6-bend trace
  of winding `25372703#0` (8-point shape, length/chord 4.2 — parallels the street it follows, no
  trip benefits) and a 3-bend shortcut on the ×11 far-NW detour pair (sumolib: fastest path takes
  the curve 59.6 s vs 277 s canonical, reverse canonically unreachable — but the synthetic demo
  has no trips through that pocket). Even straight demo roads draw 0–5 riders on synthetic
  demand; a curve changes geometry, not demand — pick the pair with demand first, bend second.
  Screenshot navigation went closed-loop (find the polyline's own pixels, drag centroid to
  center, zoom) after geographic screen math drifted twice — seams can't see pixels, and neither
  can arithmetic.
- **Review catches (folded in):** boundary pins both languages (8 vias LEGAL); the straight
  road's wire shape toEqual-pinned; the schema's TOP-LEVEL version-history line no longer
  contradicts the field's own description; `junction_missing_reason` single-sourced; DraftPanel
  pluralizes like EditPanel; the Escape handler calls `onUndoBend`. Suites: **575 pytest + 106
  Playwright**.

## Run commands
SUMO: `export SUMO_HOME="/c/Program Files (x86)/Eclipse/Sumo"` (not on PATH). Python = base miniconda.
- **Editor / job-runner (Phase 5 — the PRIMARY flow; the server FRONTS the pipeline):**
  ```bash
  cd python/src && uvicorn server:app --port 8000  # API: /api/junctions /api/edges /api/simulate /api/projection
  #   /api/runs[/<id>/status|/enrich|/events|/ledger|/skip|/resume|/identity] /api/report /api/chat /api/interview
  cd web && npm run dev                            # http://localhost:3000 → the Build stage (V2.7a shell)
  python python/src/demo_road_select.py            # pick a high-detour demo road (prints from/to junction ids)
  ```
  The server SUBPROCESS-launches `scenario_harness.py` (quant, staged run-state) then — **since
  V2.7b, AUTOMATICALLY, under the same held lock** — chains the interpretation:
  `sampler`/`reactions`(voices + institutions)/`propagation`/`report`/`report_agent`.
  **`NADI_AUTO_ENRICH=0` in the SERVER's environment is the off switch** (any of `0/false/no/off/
  n/none/disabled`; unset = ON since C10b), and it turns the chain off completely — the run stops
  at quant completion and the three manual enrich buttons return. The chain is REFUSED per stage
  for protected runs. **A chained run spends thousands of model calls** — `GET /api/projection`
  serves the pre-run estimate the Run button renders verbatim, and **Stop interpretation**
  (`POST …/skip`, a cancel FILE the subprocesses can see) keeps whatever landed; `POST …/resume`
  runs the rest against the sealed run and can change no number. No manual `ARTIFACT_URL` edits — the frontend
  resolves `/latest.json` (V2.5c: a `{"run_id"}` POINTER, never a payload — written ONLY on quant completion;
  enriches and CLI recomputes deliberately do NOT repoint the default) then fetches `/<run_id>.json` (or
  `/?run=<id>` directly); each run's artifact is copied to `web/public/<run_id>.json`. One job at a time.
  Run identity (user name/note) lives in the `contract/runs/state/<run_id>.identity.json` SIDECAR —
  endpoint-only writer, never the state file or the artifact; **FOUR file classes** coexist under
  `run_state.list_all`'s glob (state / `.composite.json` / `.identity.json` / `.ledger.json` — the
  V2.7b interpretation ledger, whose single writer is the stage runner; see the V2.4c and V2.7b
  blocks). `list_all` skips every non-state class and the coexistence is pinned across all four.
- **V2.1 run options** (harness flags = `/api/simulate` fields = the run form): `--demand-profile
  {synthetic_demo,calibrated_am_peak}`, `--assignment {day_one,settled}`, `--n-seeds {1,2,3}` (flags appended only
  for non-defaults — the default cmd stays byte-stable, unit-pinned in `test_server_cmd.py`). **V2.2a/b/c closures + incidents
  (since V2.2c the edit palette — the Build stage since V2.7a — drives all of this — lane picker / close road / incident + window inputs):**
  `--change-type {lane_closure,road_closure,incident}` + `--target-lanes 1,2`
  (csv, car-lane indices) + `--window-start/--window-end` (sim-seconds, both-or-neither; windowable: speed_limit
  + closures + incident) + incident effects `--blocked` / `--speed-factor 0.5` / `--position-m` (stored, unused).
  Incident REQUIRES a window; windowed/severing settled combos are rejected with the shared reason strings.
  **V2.6d curved roads:** a new_road takes repeatable `--via=-79.229276,43.772793` waypoints (the =form — a
  'lon,lat' value starts with '-'; ≤8, ≥10 m apart, inside the study area, non-self-crossing — the same four
  sentences at the POST 400 and the harness SystemExit; the Build stage adds bends with empty-map clicks mid-draw).
  **V2.2d composites (the 🏫 school-zone palette flow):** `POST /api/simulate {changes:[...], tags:["school_zone"]}`
  → the server writes `contract/runs/state/<run_id>.composite.json` and hands off via `--composite=<spec>`
  (V2.4b: members may be any of the four windowable types; settled+composite rejected; the harness
  re-validates against the net). Zone-edge
  selection for the exemplar: `python python/src/school_zone_select.py` → `data/schools/`. Compare two finished
  runs at `http://localhost:3000/?run=<A>&compare=<B>` (or Explore · Compare) — pure frontend, only needs
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
  The frontend resolves the `web/public/latest.json` POINTER (written by
  `trajectory_io.write_latest_pointer`, quant completion only — see the editor bullet above) or
  open `/?run=<id>` directly; no manual URL edits anywhere.
- **Report + agent spine** (Phase 3; extra deps in `python/requirements-agent.txt`; DeepSeek default,
  `DEEPSEEK_API_KEY` in `python/.env`):
  ```bash
  python python/src/report.py                      # 5-section report (md+json) -> web/public/latest-report.*
  python python/src/report_agent.py                # build the per-run LightRAG index (under %LOCALAPPDATA%)
  cd python/src && uvicorn server:app --port 8000  # agent backend: GET /api/report, POST /api/chat
  ```
  **V2.7a: reports are PER-RUN; the singleton is RETIRED.** Every report generation (and
  `--refresh-facts --run-id <id>`, the zero-LLM code-fields refresh) writes
  `web/public/<run_id>-report.json` — the Read stage's RunDocument resolves it by the run id it
  already holds, behind a run-id VINTAGE GUARD (another run's report renders the labeled
  `report-mismatch`, never silently). `web/public/latest-report.json` is a server-side POINTER
  (`{"run_id"}`) written by generate() — NEVER committed (gitignored, the latest.json symmetry);
  the payload singletons are deleted. `report.served_report_run_id` is the ONE reader
  (report_agent alignment + the server lifespan canary + `GET /api/report`, which serves the
  pointer's run's stored report and returns the REPORT'S OWN run id); a pre-V2.7a payload shape
  is tolerated LOUDLY (scheduled removal — BACKLOG). `report_agent.newest_index()` stays
  ALIGNMENT-FIRST off the pointer (the resolver-family fix); fallback = the digit-first newest
  timestamp-named index DIR with junk names warned. The committed per-run reports for the PINNED
  and EXAMPLE runs are singleton-class: shape+value pytest pins + the run-document runtime pin
  cover them, and both runs sit in the PROTECTED-RUNS set (`trajectory_io` — enrich + identity
  guards with role-specific refusals; report enrich stays exempt as the maintenance path).
  Verification report-regens for the pinned/example runs REPLACE the committed per-run copy
  deliberately (commit the new bytes; the pins recompute from sidecars) — there is no singleton
  left to restore. Since the follow-up, `report_json.run.name` is stamped from the identity
  sidecar at generate + refresh (the static demo's only name carrier; the example's single
  source is `web/lib/demo.ts` `EXAMPLE_RUN_NAME` — naming a PROTECTED run goes through the
  identity endpoint under `NADI_ALLOW_PINNED_ENRICH=1`, then a `--refresh-facts`), and the
  cross-seed tail sentence derives from the run's OWN seeds (a single-seed report says
  "not probed", never "checked").
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
- **Frontend:** `cd web && npm run dev`  → http://localhost:3000  (lands on the run document
  (Read stage); chat = Explore · Chat)
- **Perf harness (V2.5c budgets):** `node scripts/perf-harness.mjs --headed` against a prod build
  (`npm run build && npm run start`) — frame numbers are HEADED numbers (headless measures
  SwiftShader); budgets live in the V2.5c block, re-measure at V2.7 checkpoints. **QUIET THE BOX
  FIRST, and read the fetch/parse/render SPLIT before believing a regression** (V2.7b C11): the same
  build read 5.07 / 4.95 / 5.13 s on the 90 MB artifact with an API server, a prod server and a live
  WebGL page alongside — an apparent 34% regression — and 3.665 / 3.675 s with those stopped. The
  tell was that the whole growth sat in FETCH (3.8–4.0 s busy vs 2.74 s quiet), which is I/O and not
  the app's work. Sibling of the SwiftShader rule: the harness measures whatever the machine is
  doing, so a frontend number from a busy box is a number about the box. NB the harness's own
  stage-watch hop is a real UI check — it caught the collapsed document strip covering the playback
  bar's Play button, which every seam test passed straight through (the button was present, visible
  and enabled; it was covered).
- **Map shots + zoom-band perf (V2.7c):** `node scripts/map-shots.mjs --tag <before|after|…>
  --center -79.2274,43.7644 --t 900` (prod build, headed, 1600×1000) writes one frame per zoom band
  (`docs-assets/v27c-<tag>-z{13,15_2,16_5}.png`) at a FIXED centre through the `__nadiViewport`
  seam's jumpTo — before/after pairs are the same viewport by construction. The harness takes
  `--zoom Z --center lon,lat` to sample the frame window inside a stated band; every layer-touching
  commit re-measures fitBounds + z15.2 + z16.5 on both artifacts. p50 on this box is bimodal (144 Hz
  display: 7.0 or 13.6 ms) — read p95.
- **Static demo build (V2.5d):** `node scripts/build-static-demo.mjs` → `web/out/` pruned to the
  demo set (43.9 MB; every file <25 MiB) — deploy per `DEPLOY.md`.
- **Tests:** `python -m pytest python/tests` (752 tests — sections: golden spine; contract
  0.6.0–0.9.0; seed-range/report honesty invariants; the unwindowed-report golden; V2.3a
  enrich-events/builder/SSE; V2.3b interview grounding/guard/endpoint; V2.3c institutions
  roster/gating/composition/verify; V2.3d graph-export/fixture; V2.4b
  composite-matrix/probe/scorecard; V2.4c identity; V2.5a disclosure/fixture; V2.5b
  members-probe/report/citation; V2.5c pointer; V2.6a/b group-interview room/endpoint/speak; the
  V2.6 follow-up conjunction pins; V2.6c 0.10.0 ceremony/compact/worst_t/coord; resolver-family;
  V2.6d via parse/geometry-rules/shape-producer/POST+harness; V2.7a
  per-run-report/refresh-facts/committed-pin + the protected-runs matrix + the latest-report
  pointer-reader shapes; the V2.7 follow-up cross-seed-sentence/name-stamp pins; V2.7b
  run-events/ledger/stage-runner/skip-resume/terminal-state (the exit-path PROPERTY test) +
  act-one beats + facts-only + the persisted draft + the event-vocabulary, bucket-label,
  display-label and projection lockstep pins + C11's live finds — the cancelled-discourse assembly
  shape, the corpus handle collision, the held-lock-vs-stale rule and the projection floor; V2.7d
  network-export v2 + the lane invariant RE-DERIVED over the wire table + the street-name resolver
  and its server / scheduler / report / corpus consumers — unnamed forms byte-identical, the golden
  report untouched; V2.7e's derived safety note, its recognisers over both prefixes, the earned
  rewrite over a derived prefix, the caveat coupling both ways and the protected-run recompute
  guard; C5's prompt-names pins — both forms per branch as literals, the framing clause, the
  report's id-free and digit-free twin, the CLI forms, the interview inheritance) and
  `cd web && npx playwright test`
  (268 tests across 33 spec files incl. the V2.7e `group-evidence` (the composer, the pick rule with
  ties, the room seed's balanced / imbalanced / under-three cases) pure spec and the run-document /
  act-two / group-interview doorway pins — selection, the tray, the strip's honest states, the
  blocked doors, the CTA and the seeded room; the V2.7d `lane-rows` (compass initials at the sector
  boundaries, the table's rows both directions, closable = server list ∩ table, one member per
  directional edge, the direction sentences) and `street-names` (the name-plus-id lockstep forms,
  nearest edge at 25.0 in / 25.001 out, the od line, the cross-street walk with fork stop) specs plus
  the drop-form / tiles / real-mouse drag / blocker-card / draw-caption / rail-restyle pins riding
  draft-basket and edit, the V2.7c `map-ladder` (zoom bands, per-band layer counts,
  the travellers' dots↔icons conservation, the new_road / bike_lane rungs, the basemap read-back) and
  `road-geometry` (pure pins: lane model, offsets, chevron chains, `segmentAt`) specs, seeds, compare, school-zone, scorecard-scope, enrich-stream,
  interview, institutions, graphs, draft-basket, composite-runcard, run-identity, group-interview,
  compact-run, via-rules, the V2.7a run-document/run-list/app-shell (the landing matrix + ride-along 6a + the follow-up title-precedence/one-source-name/no-duplication pins) specs, the V2.6d curved-draw/refused-clicks/Escape/playback-curve pins, the V2.5b ends
  rendering, the V2.5c/d pointer-independence + labeled-landing pins, and the V2.7b
  act-one/act-two/run-feed/brake specs — the beat ledger + the earned ticks, the six stage cards,
  the file-wins swap, the pass-through-`done` mount, the cost line's denominator and the
  stopped/degraded blocks), plus **`edit-guard.spec.ts`** — the detection half of the suite-edit
  guard. The full Playwright suite runs **~45–50 minutes single-worker** on this box (act-one and
  act-two are the slow files at ~7 min each) — budget for it, and prefer per-file runs while
  iterating. **A SUITE WHOSE SOURCES CHANGE MID-RUN NOW FAILS**: `globalSetup`/`globalTeardown`
  (`tests/support/edit-guard.ts`) hash every file under `web/{app,components,lib,tests}` plus the
  config and package.json, and a drift throws with each file named — proven by a run where 13 tests
  passed and the run still exited 1. **Two placements were tried and both were silently INERT before
  this one worked, so neither is to be "simplified" back:** a REPORTER (disabled the moment anyone
  passes `--reporter=line`, which REPLACES the config's reporter list) and `globalSetup`'s documented
  returned teardown (never called on this install — proven with a probe), which is why the teardown
  is its own file, `tests/support/edit-guard-teardown.ts`, wired as `globalTeardown`. And it hashes
  CONTENT, not mtimes, because OneDrive moves mtimes here without a content edit. `NADI_ALLOW_SUITE_EDITS=1`
  bypasses it for the deliberate case and says so in the output. **Dev-only Playwright
  hazard:** a TINY fixture artifact can resolve inside React StrictMode's double-mount window and fatally crash
  maplibre teardown (the dev overlay eats the app) — specs delay fixture routes ~500 ms + warm-reload once
  (documented in `compare.spec.ts`); production builds and real artifact sizes never hit it.
