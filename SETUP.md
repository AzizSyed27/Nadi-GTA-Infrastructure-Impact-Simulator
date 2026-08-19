# Setting up Nadi locally

The [static demo](README.md#see-it-live) is a read-only walkthrough of pre-computed runs. This
page is for running the tool yourself — drawing changes, running simulations, generating voices
and reports. The stack is Windows-native (that's where it's developed and tested); the pieces:


| Piece | What it unlocks | Required? |
|---|---|---|
| SUMO 1.27 | everything — the traffic physics | yes |
| Python 3.13 (conda base) + `requirements.txt` | the quant pipeline + tests | yes |
| Node 20+ / `npm install` in `web/` | the map frontend | yes |
| `requirements-agent.txt` + a DeepSeek key | the report, "Ask the report", interviews | optional |
| A Groq key | the 212 persona voices | optional |
| The `oasis` conda env (Python 3.11) | the social-discourse cascade view | optional |

## 1. SUMO 1.27 (the version is load-bearing)

Install **SUMO 1.27** from the Eclipse SUMO Windows installer to its default location
(`C:\Program Files (x86)\Eclipse\Sumo`) or set `SUMO_HOME` to wherever you put it.

Why exactly 1.27: the closure scheduler encodes lane-permission behavior probed live against
this version (`change_scheduler.py` documents the facts; a different SUMO may change
`setDisallowed` semantics silently). The python side imports `traci`/`sumolib` from
`SUMO_HOME/tools` — they are NOT pip packages here.

```bash
# git-bash form; PowerShell: $env:SUMO_HOME = 'C:\Program Files (x86)\Eclipse\Sumo'
export SUMO_HOME="/c/Program Files (x86)/Eclipse/Sumo"
```

## 2. Python (conda base, 3.13)

```bash
conda create -n base-nadi python=3.13   # or use your base env
pip install -r python/requirements.txt
python -m pytest python/tests           # the suite runs with no keys and no LLM calls
```

## 3. Frontend

```bash
cd web
npm install
npx playwright install chromium         # only if you want to run the e2e specs
```

## 4. Keys (optional, per layer)

```bash
cp python/.env.example python/.env      # then fill in what you have
```

Each key unlocks one enrich layer — the quant pipeline (simulate → scorecard) needs none.
See the comments in `.env.example` for which provider drives what.

## 5. The `oasis` env (optional — the discourse cascade)

`camel-oasis 0.2.5` pins Python `<3.12`, so it lives in its OWN env and is invoked as a
subprocess — never imported from base:

```bash
conda create -n oasis python=3.11
conda run -n oasis pip install camel-oasis==0.2.5
# always invoke with --no-capture-output (plain `conda run` buffers stdout through cp1252
# and crashes on non-ASCII agent text):
conda run --no-capture-output -n oasis python python/src/oasis_spike.py
```

## 6. Run it

```bash
# terminal 1 — the API/job server (fronts the whole pipeline)
cd python/src && uvicorn server:app --port 8000

# terminal 2 — the frontend
cd web && npm run dev          # http://localhost:3000 → open the ✏️ Edit toggle
```

Draw a change on the map, hit Run, watch the staged pipeline (baseline → scenario → analysis),
then enrich the finished run (voices → report → discourse) from its run card.

Notes for a fresh clone: the repo ships two complete pre-computed runs (the pinned 212-voice
social run and a modern institutional run) — the map loads one immediately, before you ever run
SUMO. Built SUMO networks (`*.net.xml`) are gitignored: before anything *simulates*, regenerate
`python/scenario/corridor.net.xml` with `netconvert` from the tracked OSM extract
(`python/scenario/corridor_bbox.osm.xml`), then rerun `python python/src/network_export.py` so
the web base layer matches. Larger exemplars referenced in the docs (the 90 MB calibrated school-zone run) are not in
the repo; regenerate them with the pipeline if you need them. Scratch/index directories live
under `%LOCALAPPDATA%` (`nadi-report-agent`, `nadi-oasis-spike`, `nadi-demand`, `nadi-enrich`)
— deliberately outside any OneDrive-synced tree.
