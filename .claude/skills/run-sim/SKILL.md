---
name: run-sim
description: Use whenever (re)generating a SUMO simulation run or trajectory artifact for the Nadi project — i.e. building the corridor network, generating vehicle demand, running the headless sim, or emitting a fresh contract/runs/<run_id>.json. Trigger on "rerun the sim", "regenerate the artifact", "build a new network/run", "new corridor", "make traffic", or any change to the bbox / demand / scenario. Follow this recipe instead of improvising SUMO commands.
---

# run-sim — SUMO run → frozen trajectory artifact

The Phase-0 pipeline: **build network → generate demand → run sim → emit artifact**. Stages 1–2 only
need rerunning when the area or demand changes; **stage 3 alone re-emits a fresh artifact** from the
existing net + routes.

## Environment (Windows, Git Bash, base miniconda python)
SUMO 1.27 is installed but NOT on PATH and `SUMO_HOME` is unset. Set it every session and call exes
by full quoted path:
```bash
export SUMO_HOME="/c/Program Files (x86)/Eclipse/Sumo"
cd "/c/Users/azizs/OneDrive/Desktop/Projects/Personal Projects/Nadi-GTA-Infrastructure-Impact-Simulator"
```
- `sumolib`/`traci` import via `PYTHONPATH="$SUMO_HOME/tools"` (no pip install). libsumo's python wheel
  is NOT installed → `run_sim.py` falls back to TraCI automatically (identical API).
- Outputs are gitignored: `*.net.xml`, `*.osm.xml`, `contract/runs/`. Force-add only if intentional.

## Stage 1 — build the network (only when the bbox/area changes)
bbox is WGS84 `minLon,minLat,maxLon,maxLat`. Current corridor: Scarborough `-79.27,43.74,-79.18,43.79`.
```bash
python "$SUMO_HOME/tools/osmGet.py" --bbox=-79.27,43.74,-79.18,43.79 --output-dir python/scenario --prefix corridor
"$SUMO_HOME/bin/netconvert.exe" \
  --osm-files python/scenario/corridor_bbox.osm.xml \
  --type-files "$SUMO_HOME/data/typemap/osmNetconvert.typ.xml" \
  --output-file python/scenario/corridor.net.xml \
  --proj.utm \
  --keep-edges.by-vclass passenger --remove-edges.by-vclass pedestrian,bicycle \
  --ramps.guess --junctions.join --tls.guess-signals --tls.discard-simple \
  --geometry.remove --roundabouts.guess --osm.elevation false
```
- GOTCHA: pass the bbox as `--bbox=-79.27,...` (with `=`); argparse parses a leading-`-` value as a flag otherwise.
- `--proj.utm` is REQUIRED — it keeps the net geo-referenced (UTM-17). Verify `<location>` has a real
  `projParameter="+proj=utm ..."`, NOT `"!"`. Without it, vehicle positions can't convert to lon/lat.
- Car-only filter (`keep passenger` / `remove pedestrian,bicycle`) is intentional for Phase 0.

## Stage 1b — add pedestrian infrastructure (Phase 2+, only after a stage-1 rebuild)
The stage-1 net is car-only (no sidewalks/crossings). Phase 2 needs pedestrians to walk along + cross
roads. Add the infra by **re-importing the existing net** (NOT regenerating from OSM — re-running OSM
with `--junctions.join`/`--geometry.remove` re-splits edges and breaks the routes). Bicycle access is
already present (SUMO roads permit `bicycle` by default), so this step is pedestrian-only:
```bash
"$SUMO_HOME/bin/netconvert.exe" \
  --sumo-net-file python/scenario/corridor.net.xml \
  --sidewalks.guess --sidewalks.guess.max-speed 19.5 \
  --crossings.guess --walkingareas \
  --output-file python/scenario/corridor.net.new.xml    # then verify, then replace
```
- `--sidewalks.guess.max-speed 19.5` (~70 km/h) so the 60 km/h arterials get sidewalks (default 13.89 skips them).
- Do NOT add `--junctions.join`/`--geometry.remove` (off by default on `-s` reimport — keep them off).
- VERIFY before replacing: `<location>` line unchanged (geo-ref), edge-ID set unchanged (all
  `corridor.rou.xml` edges still present), car-lane counts not dropped, and crossings/walkingareas
  appear as `function="crossing"`/`function="walkingarea"` internal edges (NOT `<crossing>` elements).
- Sidewalks add a lane per edge → lane indices shift but edge-based routes are unaffected. The golden
  test must be **re-baselined** afterward (crossings add pedestrian TLS phases → car timing shifts).

## Stage 2 — generate demand (only when changing traffic volume/seed)
~300 cars departing over 0–900 s (`-p 3.0` = 1 veh / 3 s); validated routes via duarouter.
```bash
python "$SUMO_HOME/tools/randomTrips.py" \
  -n python/scenario/corridor.net.xml \
  -o python/scenario/corridor.trips.xml \
  -r python/scenario/corridor.rou.xml \
  -b 0 -e 900 -p 3.0 \
  --fringe-factor 5 --vehicle-class passenger \
  --min-distance 300 --validate --seed 42
```
Ties together via `python/scenario/corridor.sumocfg` (already committed):
```xml
<configuration>
  <input>
    <net-file value="corridor.net.xml"/>
    <route-files value="corridor.rou.xml"/>
  </input>
  <time>
    <begin value="0"/>
    <end value="1000"/>
  </time>
</configuration>
```

## Stage 3 — run the sim & emit the artifact (the usual entry point)
```bash
python python/src/run_sim.py
```
- Runs `corridor.sumocfg` headless (libsumo→TraCI), records each vehicle's lon/lat + speed per step,
  and writes `contract/runs/corridor-<UTC>.json` (validated against `contract/trajectory_schema.json`).
- It overrides the cfg's `end=1000` with `--end 3600` so all vehicles finish (~sim_end 1829 s) and
  guards against the TraCI end-of-sim hang. It prints a `[geo-check]` line and asserts the sample
  coordinate is inside the corridor bbox (refuses to write if not).
- Expected: `vehicles: 300`, `INSIDE BBOX: yes`, an artifact path under `contract/runs/`.

## Stage 4 — refresh the web playback (optional)
```bash
cp "$(ls -t contract/runs/*.json | head -1)" web/public/run.json
# then: cd web && npm run dev   -> http://localhost:3000
```

## Verify a run
```bash
PYTHONPATH=python/src python -c "import glob,trajectory_io; p=sorted(glob.glob('contract/runs/*.json'))[-1]; a=trajectory_io.load_artifact(p); print(p, a.schema_version, len(a.vehicles), a.meta.sim_end)"
```
Passes jsonschema + pydantic and prints `0.1.0 300 1829.0`. Spot-check a path point is in
Scarborough (lon ≈ -79.2x, lat ≈ 43.7x), not (0,0).
