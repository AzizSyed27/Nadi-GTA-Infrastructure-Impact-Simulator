"""V2.1 Step b — CALIBRATED AM-PEAK DEMAND build (counts -> routeSampler -> validated routes).

Turns the V2.1a inventory's 126 fully-covered TMC intersections into SUMO demand: maps each count's
compass approaches onto the net's junction edges, emits routeSampler count files (8x900s intervals,
t=0 == 07:00), generates route candidates, and orchestrates routeSampler. The n_appr compass
convention is EMPIRICALLY GATED before anything is built on it (`verify-convention` — hard-fails,
including a rotation test proving the chosen orientation beats 90/180/270 alternatives).

Class handling: cars+truck+bus are MERGED per movement (the pipeline's mode taxonomy is car/bike/ped;
stated in provenance). Bike counts anchor approach-level edgeData (no turn resolution — coarser,
stated). Ped counts anchor a corridor-total walk scale (order-of-magnitude, NO GEH claim).

    python python/src/demand_calibration.py verify-convention   # M1 gate — run FIRST
    python python/src/demand_calibration.py emit-counts         # M2: turn counts + bike edgeData + provenance
    python python/src/demand_calibration.py candidates          # M3: randomTrips candidate pools
    python python/src/demand_calibration.py sample              # M3: routeSampler passes -> calibrated routes
    python python/src/demand_calibration.py probe               # M4: plain-sumo measure run
    python python/src/demand_calibration.py full                # verify -> emit -> candidates -> sample

Bulky intermediates live under %LOCALAPPDATA%/nadi-demand/ (OneDrive-safe); tracked outputs are
python/scenario/calibrated/ (routes+cfg) and data/demand/ (count files + provenance).
"""

from __future__ import annotations

import argparse
import glob
import json
import math
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from xml.sax.saxutils import quoteattr

import run_sim  # wires SUMO_HOME/tools so sumolib imports; exposes NET / ROOT / SUMO_HOME
import sumolib
from count_inventory import ATTRIBUTION, DATASET_URLS, _edge_bearing

ROOT = run_sim.ROOT
INVENTORY_GLOB = str(ROOT / "data" / "counts" / "counts-inventory-*.json")
BINS_CACHE = Path(os.environ.get("LOCALAPPDATA") or os.environ.get("TMP") or ".") / "nadi-counts"
LOCAL = Path(os.environ.get("LOCALAPPDATA") or os.environ.get("TMP") or ".") / "nadi-demand"
DATA_DEMAND = ROOT / "data" / "demand"
CAL_DIR = ROOT / "python" / "scenario" / "calibrated"
TOOLS = run_sim.SUMO_HOME / "tools"

# Sim-time convention: t=0 == 07:00. Eight 15-min intervals cover the counted AM peak.
AM_START_MIN = 7 * 60          # minutes since midnight of the first bin
N_INTERVALS = 8
INTERVAL_S = 900
WINDOW_S = N_INTERVALS * INTERVAL_S  # 7200

APPROACHES = ("n", "e", "s", "w")
TURNS = ("l", "t", "r")
_QUADRANT_CENTER = {"n": 0.0, "e": 90.0, "s": 180.0, "w": 270.0}
VEHICLE_CLASSES = ("cars", "truck", "bus")  # merged per movement — stated in provenance


# --------------------------------------------------------------------------------------
# pure compass / classification helpers (unit-tested, no net)
# --------------------------------------------------------------------------------------

def signed_delta(bearing: float, reference: float) -> float:
    """Signed smallest angle from reference to bearing in [-180, 180); positive = clockwise."""
    return (bearing - reference + 180.0) % 360.0 - 180.0


def compass_quadrant(bearing: float) -> str:
    """n/e/s/w quadrant (±45°) of a compass bearing."""
    for q, center in _QUADRANT_CENTER.items():
        if abs(signed_delta(bearing, center)) <= 45.0:
            return q
    return "n"  # unreachable — quadrants tile the circle


def approach_quadrant(travel_bearing: float, rotation: float = 0.0) -> str:
    """Which compass leg a vehicle ARRIVES from, given its direction of travel.

    Traveling south (bearing 180) means arriving from the north leg -> 'n'. The TMC convention
    hypothesis (n_appr = the leg on the intersection's north side) is exactly this flip; ``rotation``
    exists only for the verify-convention rotation test.
    """
    return compass_quadrant((travel_bearing + 180.0 + rotation) % 360.0)


def classify_turn(in_bearing: float, out_bearing: float) -> str:
    """'t'hrough / 'r'ight / 'l'eft / 'u'-turn by relative bearing (compass clockwise-positive)."""
    rel = signed_delta(out_bearing, in_bearing)
    if abs(rel) < 45.0:
        return "t"
    if 45.0 <= rel < 135.0:
        return "r"
    if -135.0 < rel <= -45.0:
        return "l"
    return "u"


def interval_index(start_time: str) -> int | None:
    """0..7 interval index for a bin's start_time (ISO datetime), or None outside 07:00-09:00."""
    s = start_time.split("T", 1)[1] if "T" in start_time else start_time
    try:
        h, m = int(s.split(":")[0]), int(s.split(":")[1])
    except (ValueError, IndexError):
        return None
    offset = h * 60 + m - AM_START_MIN
    if not (0 <= offset < N_INTERVALS * 15):
        return None
    return offset // 15


def merged_movements(record: dict) -> dict[str, dict[str, int]]:
    """One raw 15-min bin record -> {approach: {'l'/'t'/'r': merged cars+truck+bus, 'peds', 'bike'}}."""
    out: dict[str, dict[str, int]] = {}
    for a in APPROACHES:
        cell = {t: sum(int(record.get(f"{a}_appr_{c}_{t}") or 0) for c in VEHICLE_CLASSES) for t in TURNS}
        cell["peds"] = int(record.get(f"{a}_appr_peds") or 0)
        cell["bike"] = int(record.get(f"{a}_appr_bike") or 0)
        out[a] = cell
    return out


# --------------------------------------------------------------------------------------
# inventory + bins loading
# --------------------------------------------------------------------------------------

def newest_inventory() -> Path:
    paths = sorted(glob.glob(INVENTORY_GLOB))
    if not paths:
        raise SystemExit("no counts inventory found — run count_inventory.py first (V2.1a)")
    return Path(paths[-1])


def load_supported_locations(inv_path: Path | None = None) -> list[dict]:
    """The calibration input set: matched TMC intersections whose bins fully cover 07:00-09:00.

    Each: {count_id, node_id, name, date (latest covering date), am_peak_start, am_peak_vehicle}.
    """
    path = inv_path or newest_inventory()
    inv = json.loads(path.read_text(encoding="utf-8"))
    locs = []
    for x in inv["locations"]:
        if x["source"] != "TMC" or x["kind"] != "intersection":
            continue
        if not x["match"]["matched"] or not x.get("am_bins", {}).get("covered"):
            continue
        locs.append({
            "count_id": int(x["count_id"]),
            "node_id": x["match"]["id"],
            "name": x["name"],
            "date": sorted(x["am_bins"]["dates"])[-1],
            "am_peak_start": x["time_window"].get("am_peak_start"),
            "am_peak_vehicle": x["time_window"].get("am_peak_vehicle"),
            "lon": x["lon"], "lat": x["lat"],
        })
    if not locs:
        raise SystemExit(f"{path.name}: no AM-peak-supported locations — nothing to calibrate")
    return locs


def load_bins(count_id: int, date: str) -> list[dict]:
    """This count's raw 15-min records for one date, from the V2.1a cache. Fails loudly if absent."""
    path = BINS_CACHE / f"tmc-bins-{count_id}.json"
    if not path.is_file():
        raise SystemExit(f"missing bin cache {path} — rerun count_inventory.py (it probes matched TMCs)")
    records = json.loads(path.read_text(encoding="utf-8"))["records"]
    return [r for r in records if str(r.get("count_date", ""))[:10] == date]


def interval_counts(bins: list[dict]) -> dict[int, dict[str, dict[str, int]]]:
    """{interval_idx: {approach: {l,t,r,peds,bike}}} summed over a single date's AM-window bins."""
    out: dict[int, dict[str, dict[str, int]]] = {}
    for rec in bins:
        idx = interval_index(str(rec.get("start_time", "")))
        if idx is None:
            continue
        merged = merged_movements(rec)
        slot = out.setdefault(idx, {a: {k: 0 for k in (*TURNS, "peds", "bike")} for a in APPROACHES})
        for a in APPROACHES:
            for k in (*TURNS, "peds", "bike"):
                slot[a][k] += merged[a][k]
    return out


# --------------------------------------------------------------------------------------
# net-side approach mapping
# --------------------------------------------------------------------------------------

def _passenger_edges(edges) -> list:
    return [e for e in edges if e.allows("passenger")]


def approach_edges(net, node_id: str, rotation: float = 0.0) -> dict[str, list]:
    """{n/e/s/w: [incoming passenger edges arriving from that compass leg]}. Cluster nodes are single
    sumolib nodes (junctions.join happened at netconvert); dual carriageways group as a list."""
    node = net.getNode(node_id)
    if node is None:
        raise KeyError(f"junction {node_id!r} not in net")
    out: dict[str, list] = {a: [] for a in APPROACHES}
    for e in _passenger_edges(node.getIncoming()):
        out[approach_quadrant(_edge_bearing(e), rotation)].append(e)
    return out


def exit_edges(net, node_id: str, rotation: float = 0.0) -> dict[str, list]:
    """{n/e/s/w: [outgoing passenger edges LEAVING toward that compass leg]}."""
    node = net.getNode(node_id)
    out: dict[str, list] = {a: [] for a in APPROACHES}
    for e in _passenger_edges(node.getOutgoing()):
        out[compass_quadrant((_edge_bearing(e) + rotation) % 360.0)].append(e)
    return out


def movement_exits(net, node_id: str, in_edge) -> dict[str, list]:
    """{'l'/'t'/'r': [outgoing passenger edges in that band]} for one approach edge (u-turns skipped)."""
    node = net.getNode(node_id)
    in_b = _edge_bearing(in_edge)
    out: dict[str, list] = {t: [] for t in TURNS}
    for e in _passenger_edges(node.getOutgoing()):
        band = classify_turn(in_b, _edge_bearing(e))
        if band in out:
            out[band].append(e)
    return out


# --------------------------------------------------------------------------------------
# the convention gate (M1)
# --------------------------------------------------------------------------------------

def _location_leg_violations(net, loc: dict, totals: dict[str, dict[str, int]],
                             rotation: float) -> tuple[int, int]:
    """(violations, checks) for one location at one rotation: counted flow on legs the NET says are
    impossible. approach counts on a leg with no incoming edge; exit-bound counts toward a leg with
    no outgoing edge. 'Counted flow' threshold: >2% of the location total AND >20 vehicles/2h."""
    appr = approach_edges(net, loc["node_id"], rotation)
    exits = exit_edges(net, loc["node_id"], rotation)
    loc_total = sum(sum(cell[t] for t in TURNS) for cell in totals.values()) or 1
    # counted exit-bound volume toward compass q, derived from movements:
    #   exit_n = s_appr_t + e_appr_r + w_appr_l   (and rotations thereof)
    exit_bound = {}
    ring = {"n": ("s", "e", "w"), "e": ("w", "s", "n"), "s": ("n", "w", "e"), "w": ("e", "n", "s")}
    for q, (thru_from, right_from, left_from) in ring.items():
        exit_bound[q] = totals[thru_from]["t"] + totals[right_from]["r"] + totals[left_from]["l"]

    violations = checks = 0
    for q in APPROACHES:
        counted_in = sum(totals[q][t] for t in TURNS)
        checks += 1
        if not appr[q] and counted_in > max(20, 0.02 * loc_total):
            violations += 1
        checks += 1
        if not exits[q] and exit_bound[q] > max(20, 0.02 * loc_total):
            violations += 1
    return violations, checks


def verify_convention(net, locs: list[dict], sample_n: int = 20) -> dict:
    """The empirical n_appr gate. Three checks over a deterministic sample of locations, plus a
    ROTATION test: the 0° orientation must strictly minimize impossible-leg violations vs 90/180/270.
    Returns the evidence dict; raises SystemExit on FAIL."""
    picks = sorted(locs, key=lambda x: x["count_id"])[:: max(1, len(locs) // sample_n)][:sample_n]

    rotation_viols = {rot: 0 for rot in (0.0, 90.0, 180.0, 270.0)}
    totals_checks: list[dict] = []
    exit_missing_major = 0
    major_movements = 0

    for loc in picks:
        bins = load_bins(loc["count_id"], loc["date"])
        per_interval = interval_counts(bins)
        totals = {a: {k: sum(per_interval[i][a][k] for i in per_interval) for k in (*TURNS, "peds", "bike")}
                  for a in APPROACHES}

        # (a) totals reconciliation vs the city's own am_peak_vehicle (peak HOUR = 4 consecutive bins)
        anchor = loc.get("am_peak_vehicle")
        peak_start = str(loc.get("am_peak_start") or "")
        if anchor and peak_start[:10] == loc["date"]:
            idx0 = interval_index(peak_start)
            if idx0 is not None and idx0 <= N_INTERVALS - 4:
                hour = sum(sum(per_interval.get(i, {a: {t: 0 for t in TURNS} for a in APPROACHES})[a][t]
                               for a in APPROACHES for t in TURNS) for i in range(idx0, idx0 + 4))
                rel_err = abs(hour - anchor) / anchor if anchor else 0.0
                totals_checks.append({"name": loc["name"], "ours": hour, "city": anchor,
                                      "rel_err": round(rel_err, 4)})

        # (b) impossible-leg violations at each rotation — the decisive compass test
        for rot in rotation_viols:
            v, _ = _location_leg_violations(net, loc, totals, rot)
            rotation_viols[rot] += v

        # (c) exit-consistency: major counted movements (>=50 veh/2h) must have an exit edge in-band
        appr = approach_edges(net, loc["node_id"])
        for a in APPROACHES:
            if not appr[a]:
                continue
            bands = movement_exits(net, loc["node_id"], appr[a][0])
            for t in TURNS:
                if totals[a][t] >= 50:
                    major_movements += 1
                    if not bands[t]:
                        exit_missing_major += 1

    ok_totals = [c for c in totals_checks if c["rel_err"] <= 0.05]
    evidence = {
        "sampled_locations": len(picks),
        "totals_checks": totals_checks,
        "totals_within_5pct": f"{len(ok_totals)}/{len(totals_checks)}",
        "rotation_violations": {f"{int(k)}deg": v for k, v in rotation_viols.items()},
        "major_movements_missing_exit": f"{exit_missing_major}/{major_movements}",
    }

    passed = (
        (not totals_checks or len(ok_totals) >= 0.8 * len(totals_checks))
        and rotation_viols[0.0] < min(v for r, v in rotation_viols.items() if r != 0.0)
        and (major_movements == 0 or exit_missing_major <= 0.1 * major_movements)
    )
    evidence["verdict"] = "PASS" if passed else "FAIL"
    print(json.dumps(evidence, indent=2))
    if not passed:
        raise SystemExit("verify-convention FAIL — do NOT build demand on this mapping; "
                         "inspect the evidence above (rotation table = compass orientation; "
                         "totals = bin linkage; missing exits = L/T/R banding)")
    return evidence


# --------------------------------------------------------------------------------------
# CLI (subcommands grow with M2-M4)
# --------------------------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser(description="V2.1b calibrated AM-peak demand build.")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("verify-convention", help="M1 gate: empirically verify the n_appr compass mapping")
    args = ap.parse_args()

    net = sumolib.net.readNet(str(run_sim.NET))
    locs = load_supported_locations()
    if args.cmd == "verify-convention":
        verify_convention(net, locs)


if __name__ == "__main__":
    main()
