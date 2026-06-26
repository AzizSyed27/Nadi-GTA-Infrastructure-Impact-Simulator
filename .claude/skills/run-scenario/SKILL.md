---
name: run-scenario
description: Use whenever running a full PHASE-1 SCENARIO — applying a proposed infrastructure change and previewing who wins/loses with stakeholder reactions. Trigger on "run a scenario", "apply a change / speed limit", "baseline vs scenario", "regenerate the agents / reactions", "make the agents react", "new scenario artifact", or any baseline-vs-change comparison. This is the end-to-end recipe (baseline → change → scenario → outcome join → sample → LLM reactions → v0.2.0 artifact → frontend). For a plain no-change run use `run-sim` instead.
---

# run-scenario — proposed change → reactions → v0.2.0 artifact

The Phase-1 pipeline: **baseline run → apply a change → scenario run → join outcomes → sample
instrumented travelers → LLM reactions → assemble + validate the v0.2.0 artifact → play it back**.
Each stage writes a sidecar in `contract/runs/` (gitignored) keyed to a shared `<ts>`. Reactions are
generative, so `agents[]` is NOT deterministic; `meta`+`vehicles` are.

This is a stakeholder-reaction **PREVIEW** (who wins, who loses, the texture of each objection), NOT a
referendum, verdict, or recommendation — keep that framing in any copy you touch (CLAUDE.md constraint).

## Environment (Windows, Git Bash, base miniconda python)
SUMO 1.27 is installed but NOT on PATH and `SUMO_HOME` is unset. Set it per session:
```bash
export SUMO_HOME="/c/Program Files (x86)/Eclipse/Sumo"
cd "/c/Users/azizs/OneDrive/Desktop/Projects/Personal Projects/Nadi-GTA-Infrastructure-Impact-Simulator"
```
Network/demand must already exist (`python/scenario/corridor.{net,rou}.xml`) — build them with
`run-sim` stages 1–2 if not. `traci`/`sumolib` import via `PYTHONPATH="$SUMO_HOME/tools"` (run_sim
wires this on import). Deps: `pydantic`, `jsonschema`, `google-genai`, `python-dotenv`, `openai` in base.

## Stage 1 — baseline + scenario runs + outcome join
```bash
python python/src/scenario_harness.py                         # auto-pick busiest edge, 30 km/h
python python/src/scenario_harness.py --target-edge 660176957#0 --speed-mps 8.33
```
- Runs `corridor.sumocfg` twice via the Phase-0 extractor (`run_sim.simulate`) with IDENTICAL demand:
  once untouched (baseline), once with the change applied at sim start (`run_sim.apply_change` →
  `conn.edge.setMaxSpeed`). Only `speed_limit` is implemented; the dispatch is open for more types.
- Emits two artifacts `contract/runs/{baseline,scenario}-<ts>.json` (the scenario one carries
  `meta.scenario`; `agents` empty for now), two `*.tripinfo.xml`, and the per-vehicle outcome join
  `contract/runs/outcomes-<ts>.json`.
- Auto-picks the highest **vehicle-distance** edge (traversals × length) so the change actually bites
  (a short connector wouldn't). Sign convention: `delta_seconds = scenario − baseline` (**+ = slower**).
- Report shows: target edge + before/after speed, matched count, baseline-only/scenario-only/neither
  (non-completion is handled + counted, never silently dropped), and delta min/median/max.
- GOTCHA: routes are static (no rerouting) — that's WHY join-by-vehicle-id is valid. A baseline-vs-
  baseline join is all-zeros (determinism check).

## Stage 2 — sample instrumented travelers
```bash
python python/src/sampler.py                                  # newest outcomes-*.json, N=12
python python/src/sampler.py --n 20 --unchanged-band 10
```
Bins the matched travelers (worse / unchanged / better by `delta` vs `±band`), selects N spanning the
bins (guarantees a winners-AND-losers mix), assigns personas round-robin, computes `trigger_t` = the
START of each traveler's longest stop (their worst moment; skips the depart insertion tick). Writes
`contract/runs/instrumented-<ts>.json` (`{vehicle_id, persona, outcome, trigger_t}`). See `add-persona`.

## Stage 3 — generate reactions + assemble the v0.2.0 artifact
```bash
PROVIDER=groq python python/src/reactions.py                  # newest instrumented-*.json
PROVIDER=groq MAX_CONCURRENCY=2 python python/src/reactions.py
```
- Builds a grounded, sign-correct prompt per traveler (the change semantics + their concrete
  baseline→scenario numbers), fires ~12 concurrent LLM calls, parses defensively (one retry → neutral
  fallback), then assembles the FULL v0.2.0 artifact (meta + scenario.change + all vehicles +
  `agents[]`), validates it against `contract/trajectory_schema.json`, overwrites
  `contract/runs/<scenario_run_id>.json`, and copies it to `web/public/`.
- **Provider:** Groq is the reliable free default (`openai/gpt-oss-20b`, strict JSON → 0 fallbacks;
  free tier 30 RPM / 1000 RPD). Gemini's free tier is tiny (flash = 20/day) and flash-lite 503s — see
  [[llm-provider]]. Key from `.env` (`GROQ_API_KEY`); the loader reads `python/.env` and repo-root `.env`.
- Prints the fallback count + 3 example reactions; reports them as INDIVIDUAL anticipated reactions.

## Stage 4 — play it back in the frontend
Point the map at the new artifact and run the dev server:
```bash
# web/components/MapView.tsx:  const ARTIFACT_URL = '/scenario-<ts>.json';
cp "$(ls -t contract/runs/scenario-*.json | head -1)" web/public/   # if not already copied by stage 3
cd web && npm run dev            # -> http://localhost:3000
```
You'll see: small grey background dots + larger sentiment-colored instrumented dots (red↔amber↔green),
a header naming the change, a side panel on dot-click (persona + before/after + comment), and a live
feed that pops each comment as playback hits that traveler's worst moment.

## Verify a scenario artifact
```bash
PYTHONPATH=python/src python -c "import glob,trajectory_io as t; p=sorted(glob.glob('contract/runs/scenario-*.json'))[-1]; a=t.load_artifact(p); print(p, a.schema_version, len(a.vehicles), 'vehicles', len(a.agents), 'agents', a.meta.scenario.change.type)"
```
Passes jsonschema + pydantic and prints `0.2.0 300 vehicles 12 agents speed_limit`. The golden test
(`python -m pytest python/tests`) also asserts the agents array is well-formed.

## Related
- `run-sim` — builds the network/demand and the plain baseline run this pipeline reuses.
- `add-persona` — the persona set + sampler (Stage 2).
- `trajectory-contract` — the frozen v0.2.0 `agents[]` / `Agent` shape Stage 3 fills.
