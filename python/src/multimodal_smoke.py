"""Phase 2 multi-modal smoke check.

Runs ``python/scenario/corridor.multimodal.sumocfg`` headless via ``conn`` (libsumo->TraCI) and
confirms all THREE modes route and complete: cars + bikes are vehicles (split by vClass), pedestrians
are SUMO persons (``conn.person.*``). Also runs the ocean-guard PER MODE — a sample geo-position from
each mode must land inside the corridor bbox.

This is a verification harness for the 2.1b multi-modal foundation; it does NOT write a contract
artifact and does not touch run_sim.py / the golden / the scenario pipeline.

Run:  python python/src/multimodal_smoke.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SUMO_HOME = Path(os.environ.get("SUMO_HOME", r"C:\Program Files (x86)\Eclipse\Sumo"))
CFG = ROOT / "python" / "scenario" / "corridor.multimodal.sumocfg"
NET = ROOT / "python" / "scenario" / "corridor.net.xml"
SUMO_BINARY = SUMO_HOME / "bin" / "sumo.exe"

sys.path.insert(0, str(SUMO_HOME / "tools"))

# libsumo-first, TraCI fallback (same pattern as run_sim.py).
try:
    import libsumo as conn  # noqa: E402

    BINDING = "libsumo"
except ImportError:
    import traci as conn  # noqa: E402

    BINDING = "traci"

import sumolib  # noqa: E402

MAX_T = 6000.0  # safety ceiling; the loop exits as soon as the sim drains (~4000s for the longest walks)
# Expected demand (cars unchanged; bikes/peds generated this step). Used only for the seen-vs-expected report.
EXPECTED = {"car": 300, "bike": 82, "ped": 129}


def net_bbox(net_path: Path) -> list[float]:
    net = sumolib.net.readNet(str(net_path))
    xmin, ymin, xmax, ymax = net.getBoundary()
    lon0, lat0 = net.convertXY2LonLat(xmin, ymin)
    lon1, lat1 = net.convertXY2LonLat(xmax, ymax)
    return [min(lon0, lon1), min(lat0, lat1), max(lon0, lon1), max(lat0, lat1)]


def _inside(bbox: list[float], lon: float, lat: float) -> bool:
    return bbox[0] <= lon <= bbox[2] and bbox[1] <= lat <= bbox[3]


def main() -> int:
    bbox = net_bbox(NET)
    if not CFG.is_file():
        raise FileNotFoundError(f"cfg not found: {CFG}")

    conn.start([str(SUMO_BINARY), "-c", str(CFG), "--end", str(MAX_T)])

    seen = {"car": set(), "bike": set(), "ped": set()}
    max_conc = {"car": 0, "bike": 0, "ped": 0}
    sample: dict[str, tuple[str, float, float]] = {}  # mode -> (id, lon, lat) of first sighting
    teleports = 0
    prev_t = -1.0

    try:
        while conn.simulation.getMinExpectedNumber() > 0:
            conn.simulationStep()
            t = conn.simulation.getTime()
            if t <= prev_t or t >= MAX_T:  # anti-hang
                break
            prev_t = t

            conc = {"car": 0, "bike": 0, "ped": 0}
            for vid in conn.vehicle.getIDList():
                mode = "bike" if conn.vehicle.getVehicleClass(vid) == "bicycle" else "car"
                seen[mode].add(vid)
                conc[mode] += 1
                if mode not in sample:
                    x, y = conn.vehicle.getPosition(vid)
                    lon, lat = conn.simulation.convertGeo(x, y)
                    sample[mode] = (vid, lon, lat)
            for pid in conn.person.getIDList():
                seen["ped"].add(pid)
                conc["ped"] += 1
                if "ped" not in sample:
                    x, y = conn.person.getPosition(pid)
                    lon, lat = conn.simulation.convertGeo(x, y)
                    sample["ped"] = (pid, lon, lat)

            for m in conc:
                max_conc[m] = max(max_conc[m], conc[m])
            try:
                teleports += conn.simulation.getStartingTeleportNumber()
            except Exception:
                pass

        sim_end = conn.simulation.getTime()
        remaining = conn.simulation.getMinExpectedNumber()
    finally:
        conn.close()

    # ---- report ----
    print(f"[multimodal] binding: {BINDING}  cfg: {CFG.name}")
    print(f"[multimodal] sim_end={sim_end:.1f}s  remaining(expected) at stop={remaining}  teleports={teleports}")
    print(f"[multimodal] bbox = {bbox}")
    ok = True
    for mode in ("car", "bike", "ped"):
        n = len(seen[mode])
        s = sample.get(mode)
        if s is None:
            print(f"  {mode:4s}: seen 0 / expected {EXPECTED[mode]}  -> NO AGENTS (FAIL)")
            ok = False
            continue
        sid, lon, lat = s
        ins = _inside(bbox, lon, lat)
        print(
            f"  {mode:4s}: seen {n:3d} / expected {EXPECTED[mode]:3d}  max_concurrent {max_conc[mode]:3d}  "
            f"| sample {sid!r} -> lon {lon:.5f}, lat {lat:.5f}  INSIDE BBOX: {'yes' if ins else 'NO'}"
        )
        if not ins or n == 0:
            ok = False

    completed = remaining == 0
    print(f"[multimodal] all modes present + in-bbox: {'yes' if ok else 'NO'}  | fully drained (all complete): {'yes' if completed else 'NO'}")
    if not (ok and completed):
        print("[multimodal] RESULT: FAIL")
        return 1
    print("[multimodal] RESULT: PASS — cars + bikes + pedestrians route, complete, and land in-corridor.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
