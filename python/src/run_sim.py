"""Phase 0 backend spine: run the SUMO scenario headless and freeze a trajectory artifact.

Runs ``python/scenario/corridor.sumocfg`` to completion, recording every active vehicle's
GEOGRAPHIC position (lon/lat), speed, and type each step, then writes a versioned artifact to
``contract/runs/<run_id>.json`` (validated against the frozen schema).

CRITICAL: positions are converted from SUMO internal (x,y) to (lon,lat) via
``simulation.convertGeo`` before recording. Skipping that renders the dots in the ocean.

Run as a script:  ``python python/src/run_sim.py``
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# --- paths: resolve everything from the repo root, never from cwd ---
ROOT = Path(__file__).resolve().parents[2]  # python/src/run_sim.py -> python/src -> python -> <root>
SUMO_HOME = Path(os.environ.get("SUMO_HOME", r"C:\Program Files (x86)\Eclipse\Sumo"))
CFG = ROOT / "python" / "scenario" / "corridor.sumocfg"
NET = ROOT / "python" / "scenario" / "corridor.net.xml"
SUMO_BINARY = SUMO_HOME / "bin" / "sumo.exe"

# Make the bundled SUMO python tools importable (traci, sumolib) without a pip install.
sys.path.insert(0, str(SUMO_HOME / "tools"))
# Sibling imports: this file runs as a script, so sys.path[0] is python/src/.
import trajectory_io  # noqa: E402
from contract_models import Meta, TrajectoryArtifact, Vehicle  # noqa: E402

# libsumo-first, TraCI fallback. Both expose the identical .start/.simulationStep/.vehicle/.simulation/.close API.
try:
    import libsumo as conn  # noqa: E402

    BINDING = "libsumo"
except ImportError:
    import traci as conn  # noqa: E402

    BINDING = "traci"

import sumolib  # noqa: E402  (from SUMO_HOME/tools)

MAX_T = 3600.0  # safety ceiling — demand departs to ~897s; all vehicles arrive well before this.


def net_bbox(net_path: Path) -> list[float]:
    """Geographic bounds of the network as [minLon, minLat, maxLon, maxLat] (WGS84)."""
    net = sumolib.net.readNet(str(net_path))
    xmin, ymin, xmax, ymax = net.getBoundary()
    lon0, lat0 = net.convertXY2LonLat(xmin, ymin)
    lon1, lat1 = net.convertXY2LonLat(xmax, ymax)
    return [min(lon0, lon1), min(lat0, lat1), max(lon0, lon1), max(lat0, lat1)]


def run() -> Path:
    if not CFG.is_file():
        raise FileNotFoundError(f"sumocfg not found: {CFG}")
    if not SUMO_BINARY.is_file():
        raise FileNotFoundError(f"sumo binary not found: {SUMO_BINARY} (set SUMO_HOME)")

    bbox = net_bbox(NET)
    min_lon, min_lat, max_lon, max_lat = bbox

    # Override the cfg's end=1000 so vehicles departing near 897s actually finish.
    conn.start([str(SUMO_BINARY), "-c", str(CFG), "--end", str(MAX_T)])
    step_length = conn.simulation.getDeltaT()

    records: dict[str, dict] = {}
    prev_t = -1.0
    try:
        while conn.simulation.getMinExpectedNumber() > 0:
            conn.simulationStep()
            t = conn.simulation.getTime()
            if t <= prev_t or t >= MAX_T:  # anti-hang: time stopped advancing or hit the ceiling
                break
            prev_t = t
            for vid in conn.vehicle.getIDList():
                x, y = conn.vehicle.getPosition(vid)
                lon, lat = conn.simulation.convertGeo(x, y)  # (lon, lat) — the conversion that matters
                rec = records.get(vid)
                if rec is None:
                    rec = records[vid] = {
                        "type": conn.vehicle.getTypeID(vid),
                        "path": [],
                        "timestamps": [],
                        "speeds": [],
                    }
                rec["path"].append([lon, lat])
                rec["timestamps"].append(round(t, 3))
                rec["speeds"].append(round(conn.vehicle.getSpeed(vid), 3))
        sim_end = conn.simulation.getTime()
    finally:
        conn.close()

    if not records:
        raise RuntimeError("No vehicles were recorded — demand/config problem?")

    # --- sample-coordinate-in-bbox sanity check (the ocean guard) ---
    first_id = next(iter(records))
    s_lon, s_lat = records[first_id]["path"][0]
    inside = (min_lon <= s_lon <= max_lon) and (min_lat <= s_lat <= max_lat)
    print(f"[geo-check] bbox = {bbox}")
    print(f"[geo-check] sample vehicle {first_id!r} first point -> lon {s_lon:.5f}, lat {s_lat:.5f}")
    print(f"[geo-check] INSIDE BBOX: {'yes' if inside else 'NO'}")
    if not inside:
        raise RuntimeError(
            f"Sample coordinate ({s_lon},{s_lat}) is OUTSIDE the corridor bbox {bbox}. "
            "Geo-conversion likely failed — refusing to write the artifact."
        )

    run_id = "corridor-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    artifact = TrajectoryArtifact(
        meta=Meta(
            run_id=run_id,
            network=NET.name,
            bbox=bbox,
            sim_start=0.0,
            sim_end=sim_end,
            step_length=step_length,
            created_at=datetime.now(timezone.utc).isoformat(),
        ),
        vehicles=[
            Vehicle(id=vid, type=r["type"], path=r["path"], timestamps=r["timestamps"], speeds=r["speeds"])
            for vid, r in records.items()
        ],
    )

    out_path = trajectory_io.dump_artifact(artifact)  # validates vs schema before writing
    print(f"[run] binding         : {BINDING}")
    print(f"[run] vehicles        : {len(artifact.vehicles)}")
    print(f"[run] sim window      : start={artifact.meta.sim_start}  end={sim_end}  step={step_length}")
    print(f"[run] artifact written: {out_path}")
    return out_path


if __name__ == "__main__":
    run()
