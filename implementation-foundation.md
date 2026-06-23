# Implementation Foundation — Stack, Tooling & Claude Code Workflow
*Companion to the architecture plan. That doc is the **what/why** (the three-layer architecture, the phases, the locked decisions). This is the **how**: the concrete stack, the Claude Code setup, and the build order. It assumes the phases and decisions from that doc.*
*Tooling state verified June 2026 — re-verify versions/flags at install; the agent/LLM corner moves monthly.*

---

## 1. The tech stack

Organized by the three layers plus cross-cutting concerns. One-line rationale each; forks called out.

### Layer 1 — Physics (SUMO)

| Concern | Choice | Notes |
|---|---|---|
| Simulator | **SUMO** | Locked. Cars/bikes/peds/transit/signals, OSM import. |
| Control binding | **libsumo** for the headless run loop; **TraCI** for dev/debug | libsumo is the in-process Python binding — far faster than the TraCI socket. Use TraCI when you need the GUI or to attach mid-run. |
| Network prep | `osmWebWizard` → `netconvert`; `netedit` to inspect; `sumolib` to parse | `netconvert` *infers* connections, right-of-way, and junction logic from nodes+edges, so you never hand-author turn movements. This is what makes the Phase-4 editor tractable. |
| OSM wrangling | **OSMnx** (Python) | Pulling/cleaning OSM and graph work outside SUMO's own tools. |
| Demand | Toronto **TTS** for OD → `od2trips`/`duarouter` (or `randomTrips` to bootstrap) | Activity-based demand is a later refinement. |
| Trajectory output | SUMO **FCD output** (`--fcd-output`) | Per-step vehicle position/speed. Raw feed for *both* deck.gl rendering and the safety surrogates. |
| Safety surrogates | **SSAM**-style conflict analysis (TTC/PET), or compute from FCD | Surrogates, **not** crash prediction. Hard-braking, near-miss, gridlock, blocked-junction. |

### Layer 2 — Social / agents

| Concern | Choice | Notes |
|---|---|---|
| Social engine | **OASIS** (camel-ai, Apache-2.0, on PyPI, built on CAMEL) | Built for LLM agents posting + opinion spreading at scale (env server + recommender + time engine, ~21-action space, evolving memory). This is the feed + propagation. |
| Fallback / companion | **CAMEL** `RolePlaying` / `Workforce` / `ChatAgent`+`CriticAgent` | If OASIS's social-media framing is heavier than a phase needs, drop to a lighter CAMEL deliberation loop. Decide after a spike. |
| LLM strategy | **Anthropic**, tiered: **Haiku** for bulk agent reactions, **Sonnet** for deliberation/critique, **Opus** for report synthesis | The budget/frontier split. Reachable via CAMEL's `ModelFactory`. Batch aggressively. |
| The sampler | **Custom Python** (not reuse) | Picks representative travelers from FCD outcomes — across personas *and* winners/losers — and pins each to a dot. The loose-coupling core. |

### Layer 3 — Visualization

| Concern | Choice | Notes |
|---|---|---|
| App framework | **Next.js + React + TypeScript** | Your stack. |
| WebGL layers | **deck.gl** — `TripsLayer` (animated dots), `PathLayer`/`GeoJsonLayer` (network), `ScatterplotLayer` (conflict points / instrumented agents) | TripsLayer is purpose-built for animated trajectories; pipes from FCD. |
| Base map | **MapLibre GL JS** (open-source, no token) via deck.gl's MapLibre integration | Avoids a paid Mapbox dependency. |
| Editor | **deck.gl editable layers** (`@deck.gl-community/editable-layers`, the nebula.gl successor) | Draw/bend geometry. *Verify the current package name when you wire it.* |
| Playback | Frontend animation over the trajectory artifact + timeline scrubber; comments keyed to sim-time | Implements playback (not stream-live). |

### Cross-cutting

| Concern | Choice | Notes |
|---|---|---|
| Backend / API | **FastAPI** | Your stack. Orchestrates edit → regen → run → sample+agents → persist → serve. Async. |
| Run orchestration | **Start lean**: FastAPI background tasks + a run-state table. Upgrade: **arq** (async-native) or **Redis+RQ/Celery** | The agent pass is a big batch job, but don't build heavy infra in v0. |
| Relational/spatial data | **PostgreSQL + PostGIS** | Your stack. Run metadata, edits, outcomes, scorecard, comments, geometry. |
| Report retrieval | **LightRAG to start**, **Microsoft GraphRAG** as a targeted upgrade | See note below. |

**The report-retrieval nuance.** Microsoft GraphRAG's community-summarization is the gold standard for *global* questions ("what are the dominant objections, and who echoed them?") — exactly your report agent's job — but indexing is expensive and you'd re-index **every run** (each run is a fresh corpus). LightRAG gives ~70–90% of the quality at a fraction of the cost with cheap incremental indexing. Two things make LightRAG the right v0: the per-run corpus is **small** (hundreds of agents, not thousands of docs), so its weakness on global queries is muted; and the report *generation itself* can often skip RAG — feed structured aggregates + a comment digest straight into a long-context Opus call, and reserve graph retrieval for the **interactive chat-with-report-agent**, where arbitrary cross-corpus questions actually need it. Upgrade to Microsoft GraphRAG only if those interactive global queries underperform.

---

## 2. The frozen contract (the spine of everything)

One artifact decides both the architecture *and* how parallel Claude Code sessions stay out of each other's way. Define it in Phase 0 and freeze it. Rough shape (JSON or parquet, versioned):

- **network snapshot** — the compiled network for this run
- **trajectories** — `[{id, type, t, lon, lat, speed}]` (the FCD stream, the dots)
- **per-traveler outcomes** — `[{id, persona_eligible, baseline_time, scenario_time, mode, route}]` (what each pinned agent reacts to)
- **conflict events** — `[{t, lon, lat, type, severity}]` (the map overlay + "road rage" triggers)
- **scorecard** — per-stakeholder deltas (travel time / safety surrogate / access)

This is the Python↔TypeScript boundary and the coordination point for worktrees. Guard it with a hook (below) so no session silently changes it.

---

## 3. Claude Code setup

Claude Code has three customization layers plus project memory and connectors, and they are **not interchangeable**: **CLAUDE.md** is always-on guidance Claude *may* follow; **hooks** are deterministic enforcement in the harness that fire *every time* regardless of what the model decides; **subagents** isolate noisy work in a separate context window; **skills** are on-demand procedures loaded only when the task calls for them. Map each to this project deliberately.

### CLAUDE.md (project memory)

- **Root `CLAUDE.md`**: the locked architecture decisions *verbatim* as hard guardrails (no LLM per vehicle; surrogate safety not crash prediction; scorecard not single number; preview not oracle; two graphs two jobs; sim bounded to a corridor), the repo map, the frozen-contract path, the "two worlds" rule, build/run commands, and your conventions (conda env, Windows-native).
- **Per-package `CLAUDE.md`**: `python/CLAUDE.md` (SUMO/agent conventions, libsumo gotchas, how to run a sim) and `web/CLAUDE.md` (deck.gl/Next conventions). Claude Code reads CLAUDE.md *up the tree*, so a session started in a subdirectory still inherits the root.
- Treat it as a **living document**: when Claude Code repeats a mistake, write the rule that prevents it in immediately (the "compounding engineering" loop — lessons from review flow back into the file).
- Worktrees share the repo, so every parallel session reads the same root CLAUDE.md automatically.

### Hooks (`.claude/settings.json`, committed so every session inherits them)

Deterministic gates — these fire on every matched tool call, turning "please remember to lint" into a guarantee.

- **PostToolUse, path-scoped format+lint** on `Write|Edit`: Python → `ruff format` + `ruff check --fix`; TS → `prettier --write` + `eslint --fix`. End with `exit 0` so a formatter crash never blocks the session.
- **PostToolUse type-check**: TS edits → `tsc --noEmit` (scoped); Python → `pyright`/`mypy` on the package.
- **PreToolUse guard (the high-value one)**: block writes to the frozen-contract schema file and to `.env` — exit 2 with a clear reason. Makes "don't touch the contract" structurally impossible to violate.
- **Scoped tests, not the full suite on every edit**: path-map source→test, run just the relevant file; run the full suite on a Stop hook or at pre-commit.
- Keep each hook fast (aim <500ms), pinned, and offline so flakes don't become fake "fix this" signals. Hooks fire for subagent actions too.

### Subagents (`.claude/agents/*.md`, isolated context, model-routed)

Keep the set **small and focused** — a subagent should have one job, a tight description, and limited tools. The point is keeping verbose output out of your main context, not a second generalist. (Cost note: subagent-heavy workflows can use ~7× the tokens of a single thread — use them for isolation and parallel exploration, not everything. Lean on the built-in `Explore`/`Plan` agents too.)

- **`sumo-runner`** (Bash, Read) — runs a sim/network-regen, returns only the summary + artifact path. Keeps SUMO's verbose logs out of the main thread. Route to a cheap model.
- **`test-runner`** (Bash, Read) — runs the suite, returns only failures with messages.
- **`code-reviewer`** (Read, Grep, Glob — read-only) — reviews a diff by severity.
- **`docs-researcher`** (Read + Context7/web) — fetches the *current* external API surface before any integration, returns the relevant interface. The direct antidote to stale-API guessing. Can be a forked `Explore` skill.
- *(optional)* **`deckgl-frontend`** — the viz specialist once the frontend grows.

Subagents can run in their own worktree (`isolation: worktree` in frontmatter) so their edits never collide.

### Skills (`.claude/skills/<name>/SKILL.md`, project-scoped, committed)

Procedures and domain gotchas, loaded only when triggered (so many skills cost ~nothing until used). **Slash commands are now skills** — a skill named `run-sim` gives you `/run-sim`. Make descriptions slightly "pushy," since skills tend to under-trigger.

- **`run-sim`** — the exact recipe: compile network → run SUMO → emit the artifact. Capture it from a clean environment with `/run-skill-generator` so every agent follows the recorded recipe instead of rediscovering it. → `/run-sim`
- **`network-edit`** — the `netconvert` node/edge/regen procedure + right-of-way gotchas (the Phase-4 danger zone). Put heuristics in `references/`.
- **`trajectory-contract`** — the frozen schema + how to read/write it. A reference skill that keeps every agent consistent across both worlds.
- **`scorecard`** — how the per-stakeholder deltas are computed.
- **`add-persona`** — the recipe to define a new persona agent.

### MCP (connectors)

- **Context7** *(you already have this connected)* — pulls up-to-date library docs into context. Use it (or `docs-researcher`) at **every** external-API boundary — deck.gl, OASIS, GraphRAG — because the agent will otherwise confidently reach for an old interface.
- **A Postgres MCP** — let Claude Code introspect the schema and run read queries against the dev DB.
- **A browser/Playwright MCP** — drive and screenshot the deck.gl frontend for testing.

---

## 4. Implementation order & parallelization

The order follows the architecture phases. The governing principle, from how Claude Code parallelism actually works: **worktrees isolate files; subagents and "agent teams" coordinate the work itself; they compose.** Use a worktree only when tasks are genuinely independent — never when session B must read session A's output, and never for a small change.

- **Phases 0–1 (spine + coupling slice): serialize, single session.** A tight vertical integration where every piece depends on the contract being proven. Parallelism here actively hurts — a second session would build against a moving target. Resist the urge to fan out.
- **The moment the contract freezes (end of Phase 0), the two worlds decouple — now worktrees pay off:**
  - one worktree on the **Python side** (sim, sampler, agents)
  - one on the **TypeScript side** (deck.gl viz, editor, playback)
  - They share the repo + root CLAUDE.md + the frozen contract; they never touch each other's files.
- **Phase 2 (scorecard + social): parallel feature worktrees** — one for OASIS/social-feed, one for safety-surrogates+scorecard, one for the conflict overlay. Merge to trunk frequently.
- **Phase 3 (report/GraphRAG): mostly sequential** on Phase 2 outputs — do it after the corpus schema is stable, or parallelize only once that schema is frozen too.
- **Phase 4 (editor ladder): rung 1 (snap-to-existing) can run a frontend toy early in parallel; rungs 2–3 (the `netconvert` surgery) are the danger zone — single session, Plan Mode, `docs-researcher` first, NOT parallel.** Subtle correctness the output won't reveal.

### The worktree gotcha that will bite this project specifically

Worktrees do **not** isolate shared *runtime* resources — the **SUMO server/ports, the Postgres dev DB, and env vars are shared**. Two parallel sessions both spinning up SUMO or hitting the same DB will collide. Mitigations:

- per-worktree **port offsets** for the SUMO/dev servers
- a **separate dev DB schema (or instance) per worktree**
- a **`.worktreeinclude`** (gitignore syntax) to copy `.env`/secrets into each new worktree
- **dependencies aren't shared** between worktrees — install per worktree (pnpm's content-addressable store helps JS; use a per-worktree or carefully-shared conda env for Python)
- add **`.claude/worktrees/` to `.gitignore`**

Practical ceiling: **2–4 parallel sessions** before review overhead and rate limits bite. "Agent Teams" (coordinating multiple sessions with shared task lists + messaging) exists but is overkill for a solo v0 — note it as a later option.

---

## 5. Other methods worth building in

- **Research-then-build at every external boundary.** Context7 / `docs-researcher` *first*, then code. The single highest-frequency failure mode for an agent on a fast-moving stack.
- **Plan Mode** before non-trivial changes — mandatory at the two danger spots (`netconvert` right-of-way semantics; any external-API integration).
- **TDD-ish loops** for the bounded plumbing (FCD→GeoJSON, scorecard math, contract serialization): write the test, let Claude Code drive to green. Pairs with the `test-runner` subagent + the scoped-test hook.
- **A golden-trajectory verification harness.** Freeze one known network + scenario + its expected outcome numbers; every change re-runs it and diffs. Catches silent regressions in the physics and the contract — the thing you can't eyeball.
- **Small commits / checkpoint discipline**, especially across worktrees, so merges stay sane and you can bisect.
- **An "honest-framing" review pass.** Since the credibility moat is *preview-not-verdict*, add a `code-reviewer` prompt (or skill) that checks report/scorecard copy hasn't drifted into oracle language.

---

## 6. Week-one starting sequence

1. **Scaffold the monorepo**: `python/`, `web/`, root + per-package `CLAUDE.md` (locked decisions in the root), `.claude/settings.json` (format/lint/typecheck hooks + the contract/`.env` guards), `.gitignore` (+ `.claude/worktrees/`).
2. **Wire Context7 MCP**; create the `docs-researcher`, `sumo-runner`, `test-runner`, `code-reviewer` subagents.
3. **Phase 0, single session**: pick the corridor → `osmWebWizard` → `netconvert` → run SUMO headless via libsumo with `--fcd-output` → write the v0 trajectory artifact (**freeze the schema → `trajectory-contract` skill**) → render it in deck.gl `TripsLayer` + MapLibre with a timeline scrubber.
4. **Capture the run recipe** as the `run-sim` skill (`/run-skill-generator`).
5. **Only after the dot moves on the map end-to-end**: branch into Python/TS worktrees and start Phase 1.

---

*Re-verify when you reach them rather than trust this doc: the deck.gl editable-layers package name, OASIS's current API surface, the GraphRAG/LightRAG landscape, and the specific Claude Code flags/fields (that surface changes monthly).*
