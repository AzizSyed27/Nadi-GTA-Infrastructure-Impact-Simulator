"""Phase 1 backend: a baseline-vs-scenario two-run harness with a per-vehicle outcome join.

Runs the SAME demand (``corridor.sumocfg``) twice via the Phase-0 extractor (``run_sim.simulate``):
  1. BASELINE   — untouched network.
  2. SCENARIO   — a parameterized infrastructure change applied at sim start (only ``speed_limit``
                  is implemented; the dispatch in ``run_sim.apply_change`` is left open for more).
Each run emits both a trajectory artifact (``contract/runs/<run_id>.json``, the scenario one carries
``meta.scenario``; ``agents`` stays EMPTY — the persona/LLM layer is a later step) and a SUMO
``--tripinfo-output`` file. We then JOIN the two tripinfo files by vehicle id and, for every vehicle
that COMPLETES IN BOTH runs, compute the baseline-vs-scenario outcome. Vehicles that finish in only
one run are counted and reported, never silently dropped.

Phase 2.2 adds a MULTI-MODAL path (``--change-type bike_lane``, the new default): cars + bikes +
pedestrians on ``corridor.multimodal.sumocfg`` with a dynamic rerouting device enabled IDENTICALLY in
both runs, and a ``bike_lane`` change that converts one curbside car lane to bicycle-only at sim start.
Outcomes are joined PER MODE from two sources (vehicle ``<tripinfo>`` + person ``<personinfo>``); cars'
adaptation is measured by diffing each car's final route (``--vehroute-output``) between runs. Output is
a per-mode ``outcomes-<ts>.json`` sidecar + provisional (UNVALIDATED) ``multimodal-*`` trajectory files —
the contract is deliberately untouched (that is Step 2.3).

With rerouting on, a vehicle may take different paths across runs (that IS the signal); the join is still
by id (same traveler, same OD), and symmetry — identical rerouting + seed, change only in scenario —
isolates the lane effect. The Phase-1 ``speed_limit`` path (cars-only, static routes) is preserved.

Run as a script:
    python python/src/scenario_harness.py                                   # bike_lane, auto-pick edge+lane
    python python/src/scenario_harness.py --target-edge E123 --target-lane 1
    python python/src/scenario_harness.py --change-type speed_limit --speed-mps 5.0   # Phase-1 path
"""

from __future__ import annotations

import argparse
import json
import statistics
import xml.etree.ElementTree as ET
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

# Importing run_sim wires SUMO's tools onto sys.path and binds `conn` (libsumo/TraCI). We reuse its
# extractor, change dispatch, artifact builder, and resolved paths rather than re-implementing them.
import run_sim  # also puts SUMO_HOME/tools on sys.path, so `sumolib` imports below
import sumolib
import trajectory_io
from contract_models import Change, Conflict, Meta, Person, Scenario, TrajectoryArtifact, Vehicle

ROUTES = run_sim.ROOT / "python" / "scenario" / "corridor.rou.xml"
BIKE_ROUTES = run_sim.ROOT / "python" / "scenario" / "corridor.bike.rou.xml"
PED_ROUTES = run_sim.ROOT / "python" / "scenario" / "corridor.ped.rou.xml"
MULTIMODAL_CFG = run_sim.ROOT / "python" / "scenario" / "corridor.multimodal.sumocfg"
RUNS_DIR = trajectory_io.RUNS_DIR

DEFAULT_SPEED_MPS = 8.33  # 30 km/h

# Multi-modal runs need a higher ceiling than the cars-only MAX_T: peds finish ~4040s (2.1b), and the
# bike-lane change can add detour/congestion. The loop exits as soon as the sim drains; this is a guard.
MULTIMODAL_MAX_T = 7200.0
# Symmetric rerouting config — IDENTICAL in baseline and scenario so only the lane permission differs.
# (No --device.rerouting.threads / --weights.random-factor: both are documented nondeterminism sources.)
# --seed is passed separately (simulate_multimodal) so a robustness sweep can vary it per pair.
REROUTING_ARGS = [
    "--device.rerouting.probability", "1",
    "--device.rerouting.period", "60",
    "--device.rerouting.adaptation-interval", "10",
]
DEFAULT_SEED = 42

# ---- Safety surrogate (SSM) config — CONFLICT THRESHOLDS. A conflict is defined relative to these. ----
# SUMO SSM device is VEHICLE-VEHICLE ONLY (it ignores persons) — ped conflicts are computed post-hoc
# (crossing-anchored PET, see compute_ped_conflicts). SSM is a passive observer: it does not change
# trajectories, so baseline vs scenario stay comparable under the same seed. Same SSM config in BOTH runs.
SSM_MEASURES = "TTC PET DRAC"
SSM_TTC_THRESHOLD = 3.0  # s  — time-to-collision below this = conflict (SUMO default)
SSM_PET_THRESHOLD = 2.0  # s  — post-encroachment-time below this = conflict (SUMO default)
SSM_DRAC_THRESHOLD = 3.0  # m/s² — deceleration-to-avoid-crash ABOVE this = conflict (SUMO default)
# (SSM CLI args are built in simulate_multimodal so the thresholds can be overridden for a robustness sweep.)
# Pedestrian-vehicle PET (post-hoc): the SSM device can't see persons. PET < this = crossing conflict.
PED_PET_THRESHOLD = 5.0  # s  — encounter (Fu et al. 2016); < 1.2 s is "critical"
PED_GRID_M = 4.0  # spatial pre-filter cell size (m) — ONLY prunes candidate pairs, never defines a conflict


def pick_busy_edge(rou_path: Path, net_path: Path) -> tuple[str, int, float]:
    """Return the (edge_id, traversal_count, length_m) with the most VEHICLE-DISTANCE on it.

    Ranking by ``traversals x edge_length`` (not raw frequency) targets a long, busy arterial where
    a speed cut actually adds travel time — a short connector is traversed by many routes but cleared
    in seconds regardless of its limit, so slowing it produces no real spread.
    """
    counts: Counter[str] = Counter()
    root = ET.parse(rou_path).getroot()
    for route in root.iter("route"):
        counts.update((route.get("edges") or "").split())
    if not counts:
        raise RuntimeError(f"no <route edges=...> found in {rou_path}")

    net = sumolib.net.readNet(str(net_path))

    def vehicle_distance(edge_id: str) -> float:
        return counts[edge_id] * (net.getEdge(edge_id).getLength() if net.hasEdge(edge_id) else 0.0)

    edge = max(counts, key=vehicle_distance)
    return edge, counts[edge], net.getEdge(edge).getLength()


def count_demand(rou_path: Path) -> int:
    """Total vehicles defined in the route file (the full demand)."""
    root = ET.parse(rou_path).getroot()
    return sum(1 for _ in root.iter("vehicle"))


def parse_tripinfo(path: Path) -> dict[str, dict[str, float]]:
    """Parse a SUMO tripinfo file into {vehicle_id: {duration, timeLoss, depart, arrival}} (seconds).

    Only vehicles that ARRIVED appear (we leave --tripinfo-output.write-unfinished off), so a vehicle
    absent from this dict did not complete the run.
    """
    out: dict[str, dict[str, float]] = {}
    root = ET.parse(path).getroot()
    for ti in root.iter("tripinfo"):
        out[ti.get("id")] = {
            "duration": float(ti.get("duration")),
            "timeLoss": float(ti.get("timeLoss")),
            "depart": float(ti.get("depart")),
            "arrival": float(ti.get("arrival")),
        }
    return out


def join_outcomes(
    base_tripinfo: Path, scen_tripinfo: Path, total_demand: int
) -> tuple[list[dict], dict]:
    """Join two tripinfo files by vehicle id. Returns (outcomes, population_counts).

    ``outcomes`` has one entry per vehicle that completed in BOTH runs. Sign convention:
    ``delta_seconds = scenario_duration - baseline_duration`` (POSITIVE = loser / slower).
    """
    base = parse_tripinfo(base_tripinfo)
    scen = parse_tripinfo(scen_tripinfo)
    base_ids, scen_ids = set(base), set(scen)
    matched = base_ids & scen_ids

    outcomes: list[dict] = []
    for vid in sorted(matched):
        b, s = base[vid], scen[vid]
        outcomes.append(
            {
                "vehicle_id": vid,
                "baseline_duration": b["duration"],
                "scenario_duration": s["duration"],
                "delta_seconds": round(s["duration"] - b["duration"], 3),
                "baseline_timeloss": b["timeLoss"],
                "scenario_timeloss": s["timeLoss"],
            }
        )

    counts = {
        "total_demand": total_demand,
        "completed_baseline": len(base_ids),
        "completed_scenario": len(scen_ids),
        "matched_both": len(matched),
        "baseline_only": len(base_ids - scen_ids),  # finished baseline, jammed out of scenario
        "scenario_only": len(scen_ids - base_ids),
        "neither": total_demand - len(base_ids | scen_ids),
    }
    return outcomes, counts


# ======================================================================================
# Phase 2.2 — multi-modal harness + bike-lane change (cars + bikes + pedestrians, rerouting)
# ======================================================================================

MODES = ("car", "bicycle", "pedestrian")


def _car_lane_count(net, edge_id: str) -> int:
    return sum(1 for lane in net.getEdge(edge_id).getLanes() if lane.allows("passenger")) if net.hasEdge(edge_id) else 0


def pick_bike_lane_edge(rou_path: Path, net_path: Path, min_car_lanes: int = 2):
    """Busiest (by vehicle-distance) CAR edge that has >= ``min_car_lanes`` car lanes.

    Reuses the same traversal-count ranking as ``pick_busy_edge`` but restricts candidates to edges that
    keep a car path after one lane is converted. Returns (edge_id, count, length_m, net).
    """
    counts: Counter[str] = Counter()
    root = ET.parse(rou_path).getroot()
    for route in root.iter("route"):
        counts.update((route.get("edges") or "").split())
    if not counts:
        raise RuntimeError(f"no <route edges=...> found in {rou_path}")
    net = sumolib.net.readNet(str(net_path))
    candidates = [e for e in counts if _car_lane_count(net, e) >= min_car_lanes]
    if not candidates:
        raise RuntimeError(f"no edge with >= {min_car_lanes} car lanes among the demanded edges")
    edge = max(candidates, key=lambda e: counts[e] * net.getEdge(e).getLength())
    return edge, counts[edge], net.getEdge(edge).getLength(), net


def curbside_car_lane(net, edge_id: str) -> int:
    """Lowest-index car lane = the curbside lane (just inside the sidewalk). Raises if none."""
    car_idx = [i for i, lane in enumerate(net.getEdge(edge_id).getLanes()) if lane.allows("passenger")]
    if not car_idx:
        raise ValueError(f"edge {edge_id!r} has no car lanes")
    return car_idx[0]


def connectivity_check(net, edge_id: str, convert_idx: int) -> set[str]:
    """Downstream CAR edges reachable ONLY via the lane being converted (i.e. severed turns).

    Empty set = every car turn the converted lane served is also served by a remaining car lane, so
    converting it removes no car connectivity. Best-effort: if the sumolib connection API differs,
    returns a sentinel-free empty set and the caller falls back to post-hoc non-completion diagnosis.
    """
    lanes = net.getEdge(edge_id).getLanes()
    car_idx = [i for i, lane in enumerate(lanes) if lane.allows("passenger")]
    remaining = [i for i in car_idx if i != convert_idx]

    def downstream(i: int) -> set[str]:
        out: set[str] = set()
        for c in lanes[i].getOutgoing():  # list of sumolib Connection
            to_lane = c.getToLane()
            if to_lane.allows("passenger"):  # only car-relevant connections
                out.add(to_lane.getEdge().getID())
        return out

    try:
        conv_down = downstream(convert_idx)
        remain_down: set[str] = set().union(*(downstream(i) for i in remaining)) if remaining else set()
        return conv_down - remain_down
    except Exception as exc:  # sumolib API mismatch — degrade gracefully, don't crash the run
        print(f"[connectivity] check unavailable ({exc!r}); will diagnose via non-completion instead")
        return set()


def _record(records: dict, eid: str, mode: str, pos, speed: float, t: float, xy_tracks: dict | None = None) -> None:
    x, y = pos
    lon, lat = run_sim.conn.simulation.convertGeo(x, y)  # (x,y)->(lon,lat); the conversion that matters
    rec = records.get(eid)
    if rec is None:
        rec = records[eid] = {"type": mode, "path": [], "timestamps": [], "speeds": []}
    rec["path"].append([lon, lat])
    rec["timestamps"].append(round(t, 3))
    rec["speeds"].append(round(speed, 3))
    # Raw SUMO x,y (metres) kept only for the post-hoc ped-PET pass — NOT written to the artifact.
    if xy_tracks is not None:
        tr = xy_tracks.get(eid)
        if tr is None:
            tr = xy_tracks[eid] = {"type": mode, "xy": [], "t": []}
        tr["xy"].append((x, y))
        tr["t"].append(t)


def simulate_multimodal(change: Change | None, target_lane: int | None, *, tripinfo_path: Path,
                        vehroute_path: Path, ssm_path: Path, seed: int = DEFAULT_SEED,
                        ssm_thresholds: str | None = None, net_override: Path | None = None):
    """Run corridor.multimodal.sumocfg headless with rerouting + the SSM safety-surrogate device; record
    cars+bikes (vehicles) AND peds (persons, a separate population). If ``change`` is given it is applied
    once at sim start. SSM (observer) + rerouting are IDENTICAL in both runs — only the lane perm differs.

    Two sequential start/close cycles per pair are SAFE on TraCI (fresh subprocess each) but UNSAFE on
    libsumo (global C++ state) — if a libsumo wheel is ever installed, run the two in separate processes.

    Returns (records, sim_end, step, remaining, xy_tracks) — xy_tracks are raw metre coords for the
    post-hoc ped-PET pass (the SSM device can't see pedestrians).
    """
    conn = run_sim.conn
    ssm_th = ssm_thresholds if ssm_thresholds is not None else f"{SSM_TTC_THRESHOLD} {SSM_PET_THRESHOLD} {SSM_DRAC_THRESHOLD}"
    args = [
        str(run_sim.SUMO_BINARY), "-c", str(MULTIMODAL_CFG), "--end", str(MULTIMODAL_MAX_T),
        *(["--net-file", str(net_override)] if net_override is not None else []),  # 5.1: per-run patched net
        "--tripinfo-output", str(tripinfo_path), "--vehroute-output", str(vehroute_path),
        "--device.ssm.file", str(ssm_path),
        "--device.ssm.probability", "1",
        "--device.ssm.measures", SSM_MEASURES,
        "--device.ssm.thresholds", ssm_th,
        *REROUTING_ARGS,
        "--seed", str(seed),
    ]
    conn.start(args)
    if change is not None:
        run_sim.apply_change(change, target_lane=target_lane)  # after start, before stepping -> in force from t=0
    step = conn.simulation.getDeltaT()

    records: dict[str, dict] = {}
    xy_tracks: dict[str, dict] = {}
    prev_t = -1.0
    try:
        while conn.simulation.getMinExpectedNumber() > 0:
            conn.simulationStep()
            t = conn.simulation.getTime()
            if t <= prev_t or t >= MULTIMODAL_MAX_T:  # anti-hang
                break
            prev_t = t
            for vid in conn.vehicle.getIDList():
                mode = "bicycle" if conn.vehicle.getVehicleClass(vid) == "bicycle" else "car"
                _record(records, vid, mode, conn.vehicle.getPosition(vid), conn.vehicle.getSpeed(vid), t, xy_tracks)
            for pid in conn.person.getIDList():  # persons are NEVER in vehicle.getIDList()
                _record(records, pid, "pedestrian", conn.person.getPosition(pid), conn.person.getSpeed(pid), t, xy_tracks)
        sim_end = conn.simulation.getTime()
        remaining = conn.simulation.getMinExpectedNumber()
    finally:
        conn.close()
    if not records:
        raise RuntimeError("No entities recorded — multimodal demand/config problem?")
    return records, sim_end, step, remaining, xy_tracks


def parse_personinfo(path: Path) -> dict[str, dict[str, float]]:
    """Parse <personinfo>/<walk> entries -> {ped_id: {duration, timeLoss, depart, arrival}} (seconds).

    Lives in the SAME file as <tripinfo> (one --tripinfo-output emits both). Only arrived persons appear
    (write-unfinished off), so absence = did not complete. Multiple walk stages are summed (our v0 peds
    have a single walk).
    """
    out: dict[str, dict[str, float]] = {}
    root = ET.parse(path).getroot()
    for pi in root.iter("personinfo"):
        walks = list(pi.iter("walk"))
        if not walks:
            continue
        out[pi.get("id")] = {
            "duration": sum(float(w.get("duration", 0.0)) for w in walks),
            "timeLoss": sum(float(w.get("timeLoss", 0.0)) for w in walks),
            "depart": float(walks[0].get("depart", pi.get("depart", 0.0))),
            "arrival": float(walks[-1].get("arrival", 0.0)),
        }
    return out


def _join_mode(base: dict, scen: dict, total_demand: int) -> dict:
    """Join one mode's baseline vs scenario maps by id over completers-in-both. Sign: delta = scen-base."""
    base_ids, scen_ids = set(base), set(scen)
    matched = base_ids & scen_ids
    outcomes = [
        {
            "id": vid,
            "baseline_duration": base[vid]["duration"],
            "scenario_duration": scen[vid]["duration"],
            "delta_seconds": round(scen[vid]["duration"] - base[vid]["duration"], 3),
            "baseline_timeloss": base[vid]["timeLoss"],
            "scenario_timeloss": scen[vid]["timeLoss"],
        }
        for vid in sorted(matched)
    ]
    counts = {
        "total_demand": total_demand,
        "completed_baseline": len(base_ids),
        "completed_scenario": len(scen_ids),
        "matched_both": len(matched),
        "baseline_only": len(base_ids - scen_ids),
        "scenario_only": len(scen_ids - base_ids),
        "neither": total_demand - len(base_ids | scen_ids),
    }
    return {"counts": counts, "outcomes": outcomes}


def join_per_mode(base_tripinfo: Path, scen_tripinfo: Path, demand: dict[str, int]) -> dict:
    """Per-mode join. Cars vs bikes split by id prefix (bike* = bike) since <tripinfo> has no vClass;
    pedestrians come from <personinfo> in the same file."""
    def split_vehicles(ti: dict) -> tuple[dict, dict]:
        car = {k: v for k, v in ti.items() if not k.startswith("bike")}
        bike = {k: v for k, v in ti.items() if k.startswith("bike")}
        return car, bike

    base_v, scen_v = parse_tripinfo(base_tripinfo), parse_tripinfo(scen_tripinfo)
    base_car, base_bike = split_vehicles(base_v)
    scen_car, scen_bike = split_vehicles(scen_v)
    base_ped, scen_ped = parse_personinfo(base_tripinfo), parse_personinfo(scen_tripinfo)
    return {
        "car": _join_mode(base_car, scen_car, demand["car"]),
        "bicycle": _join_mode(base_bike, scen_bike, demand["bicycle"]),
        "pedestrian": _join_mode(base_ped, scen_ped, demand["pedestrian"]),
    }


def parse_final_routes(vehroute_path: Path) -> dict[str, str]:
    """{vehicle_id: final taken edge sequence}. With rerouting, the LAST <route> per vehicle is the
    actually-driven path (earlier <route replacedOnEdge=...> entries are superseded plans)."""
    out: dict[str, str] = {}
    root = ET.parse(vehroute_path).getroot()
    for veh in root.iter("vehicle"):
        routes = list(veh.iter("route"))
        if routes:
            out[veh.get("id")] = routes[-1].get("edges") or ""
    return out


def reroute_count(base_vehroute: Path, scen_vehroute: Path, car_ids: list[str]) -> tuple[int, int]:
    """Among matched cars, how many took a DIFFERENT path in scenario vs baseline (the adaptation signal)."""
    base, scen = parse_final_routes(base_vehroute), parse_final_routes(scen_vehroute)
    matched = [vid for vid in car_ids if vid in base and vid in scen]
    rerouted = sum(1 for vid in matched if base[vid] != scen[vid])
    return rerouted, len(matched)


def count_on_new_edges(scen_vehroute: Path, new_edge_ids: list[str]) -> int:
    """THE new_road number: how many vehicles' final (driven) scenario route traverses a minted new edge."""
    new = set(new_edge_ids)
    return sum(1 for edges in parse_final_routes(scen_vehroute).values() if new & set(edges.split()))


# ======================================================================================
# Phase 2.4a — safety-SURROGATE conflicts (near-misses, NEVER crash predictions)
# ======================================================================================

# SUMO SSM numeric encounter-type codes -> the frozen contract conflicts[] enum. (Following = rear-end,
# merging = lane-change-like, crossing = right-of-way at a junction.) See SSM_Device docs.
_SSM_TYPE = {
    2: "rear_end", 3: "rear_end", 18: "rear_end",  # FOLLOWING_*
    5: "lane_change", 6: "lane_change", 7: "lane_change", 8: "lane_change", 19: "lane_change",  # MERGING_*
    9: "crossing", 10: "crossing", 11: "crossing", 12: "crossing", 13: "crossing",
    14: "crossing", 15: "crossing", 16: "crossing", 17: "crossing",  # CROSSING_* / *_LEFT_CONFLICT_AREA
    111: "crossing",  # COLLISION (should not occur; classify defensively)
}


def _classify_ssm_type(type_codes: str | None) -> str:
    """Map an SSM `type=`/`typeSpan` value (may be several space-separated codes) to the contract enum.
    Take the most severe class present: crossing > lane_change > rear_end > other."""
    order = {"crossing": 3, "lane_change": 2, "rear_end": 1, "other": 0}
    best = "other"
    for tok in (type_codes or "").split():
        try:
            cls = _SSM_TYPE.get(int(float(tok)), "other")
        except ValueError:
            cls = "other"
        if order[cls] > order[best]:
            best = cls
    return best


def _clamp01(x: float) -> float:
    return 0.0 if x < 0.0 else 1.0 if x > 1.0 else x


def _in_bbox(bbox: list[float], lon: float, lat: float) -> bool:
    return bbox[0] <= lon <= bbox[2] and bbox[1] <= lat <= bbox[3]


def _ssm_float(v: str | None) -> float | None:
    """SSM writes value="NA" when a measure isn't computable for a conflict — treat as missing."""
    if v is None or v in ("", "NA"):
        return None
    try:
        return float(v)
    except ValueError:
        return None


def _parse_xy(pos: str | None) -> tuple[float, float] | None:
    if not pos or pos == "NA":
        return None
    first = pos.split()[0]  # a Span may list many; take the first sample
    x, y = first.split(",")
    return float(x), float(y)


def parse_ssm(ssm_path: Path, net, bbox: list[float], ttc_th: float = SSM_TTC_THRESHOLD,
              pet_th: float = SSM_PET_THRESHOLD, drac_th: float = SSM_DRAC_THRESHOLD) -> list[dict]:
    """Parse a SUMO SSM device file into contract conflict dicts (vehicle-vehicle only).

    Dedupe symmetric logs (ego/foe swap) on frozenset({ego,foe}) + rounded begin. Positions are SUMO
    x,y -> converted to lon/lat via the net (NOT --device.ssm.geo). Ocean-guard: points outside the
    corridor bbox are dropped + counted (a conversion smell). Severity is normalized to [0,1], higher =
    worse, from whichever measure(s) breached: TTC/PET below threshold, DRAC above threshold.

    The thresholds are parameters (default = the 2.4 config) so a robustness sweep can RE-THRESHOLD the
    SAME keep+severity logic — the conflict definition never forks. NOTE: an SSM log only CONTAINS
    conflicts that breached the thresholds it was LOGGED with, so re-thresholding is exact only DOWNWARD
    from the logged values (log permissively to sweep upward).
    """
    if not ssm_path.is_file():
        return []
    root = ET.parse(ssm_path).getroot()
    seen: set = set()
    out: list[dict] = []
    dropped = 0
    for c in root.iter("conflict"):
        ego, foe, begin = c.get("ego"), c.get("foe"), c.get("begin")
        key = (frozenset((ego, foe)), round(float(begin), 1) if begin else None)
        if key in seen:
            continue
        seen.add(key)

        min_ttc = c.find("minTTC")
        pet = c.find("PET")
        max_drac = c.find("maxDRAC")

        ttc_val = _ssm_float(min_ttc.get("value")) if min_ttc is not None else None
        pet_val = _ssm_float(pet.get("value")) if pet is not None else None
        drac_val = _ssm_float(max_drac.get("value")) if max_drac is not None else None

        # severity: max over the measures that actually breached (each in [0,1], higher = worse).
        sevs = []
        if ttc_val is not None and ttc_val < ttc_th:
            sevs.append(_clamp01(1.0 - ttc_val / ttc_th))
        if pet_val is not None and pet_val < pet_th:
            sevs.append(_clamp01(1.0 - pet_val / pet_th))
        if drac_val is not None and drac_val > drac_th:
            sevs.append(_clamp01((drac_val - drac_th) / drac_th))
        if not sevs:
            continue  # no measure breached its threshold on the extreme record — not a conflict
        severity = max(sevs)

        # position + time from the governing (most severe) record — prefer the breaching measure.
        rec = min_ttc if (ttc_val is not None and ttc_val < ttc_th) else (pet if pet_val is not None else max_drac)
        xy = _parse_xy(rec.get("position") if rec is not None else None)
        if xy is None:
            continue
        lon, lat = net.convertXY2LonLat(xy[0], xy[1])
        if not _in_bbox(bbox, lon, lat):
            dropped += 1
            continue
        t = (_ssm_float(rec.get("time")) if rec is not None else None) or float(begin or 0.0)
        conflict = {
            "t": round(t, 3), "lon": lon, "lat": lat,
            "type": _classify_ssm_type(rec.get("type") if rec is not None else None),
            "severity": round(severity, 3),
            "entities": [e for e in (ego, foe) if e],
        }
        if ttc_val is not None:
            conflict["ttc"] = round(ttc_val, 3)
        if pet_val is not None:
            conflict["pet"] = round(pet_val, 3)
        out.append(conflict)
    if dropped:
        print(f"[ssm] WARNING: dropped {dropped} conflict point(s) outside bbox (geo-conversion smell)")
    return out


def _segment_pet(p0, p1, tp0, tp1, q0, q1, tq0, tq1):
    """If ped segment p0->p1 and vehicle segment q0->q1 intersect transversally, return
    (ix, iy, |t_ped - t_veh|) at the intersection point; else None. Times interpolated along each segment."""
    r = (p1[0] - p0[0], p1[1] - p0[1])
    s = (q1[0] - q0[0], q1[1] - q0[1])
    denom = r[0] * s[1] - r[1] * s[0]
    if abs(denom) < 1e-12:
        return None  # parallel / collinear — no transversal crossing (kills the parallel-sidewalk case)
    qp = (q0[0] - p0[0], q0[1] - p0[1])
    u = (qp[0] * s[1] - qp[1] * s[0]) / denom  # param along ped segment
    v = (qp[0] * r[1] - qp[1] * r[0]) / denom  # param along vehicle segment
    if not (0.0 <= u <= 1.0 and 0.0 <= v <= 1.0):
        return None
    ix, iy = p0[0] + u * r[0], p0[1] + u * r[1]
    t_ped = tp0 + u * (tp1 - tp0)
    t_veh = tq0 + v * (tq1 - tq0)
    return ix, iy, abs(t_ped - t_veh)


def _seg_cells(x0: float, y0: float, x1: float, y1: float) -> set:
    """The ~PED_GRID_M cells a segment passes through (sampled), so an intersecting ped/veh segment
    pair is guaranteed to share an indexed cell — the grid can then localize the O(n²) segment test."""
    length = ((x1 - x0) ** 2 + (y1 - y0) ** 2) ** 0.5
    n = max(1, int(length / (PED_GRID_M * 0.5)) + 1)
    return {(int((x0 + k / n * (x1 - x0)) // PED_GRID_M), int((y0 + k / n * (y1 - y0)) // PED_GRID_M))
            for k in range(n + 1)}


def compute_ped_conflicts(xy_tracks: dict, net, bbox: list[float]) -> list[dict]:
    """Post-hoc pedestrian-vehicle conflicts (the SSM device can't see persons).

    CROSSING-ANCHORED PET, not cell co-location: a conflict requires the ped and vehicle polylines to
    actually INTERSECT (a real crossing), with PET = |t_ped - t_veh| at that point. Parallel sidewalks
    never intersect (no false positive); a waiting ped's crossing point is timestamped when it truly
    steps out. The ~4 m grid ONLY localizes the segment test (index vehicle segments by cell; test a ped
    segment against just the vehicle segments sharing a cell) — it never defines a conflict. One min-PET
    conflict per (ped, vehicle) pair; flagged when PET < PED_PET_THRESHOLD.
    """
    from collections import defaultdict

    peds = {i: tr for i, tr in xy_tracks.items() if tr["type"] == "pedestrian"}
    vehs = {i: tr for i, tr in xy_tracks.items() if tr["type"] in ("car", "bicycle")}
    if not peds or not vehs:
        return []

    # Index every vehicle segment by the cells it rasterizes through.
    veh_by_cell: dict = defaultdict(list)  # cell -> [(vid, seg_index)]
    for vid, tr in vehs.items():
        xy = tr["xy"]
        for j in range(len(xy) - 1):
            for c in _seg_cells(xy[j][0], xy[j][1], xy[j + 1][0], xy[j + 1][1]):
                veh_by_cell[c].append((vid, j))

    best: dict = {}  # (pid, vid) -> (pet, ix, iy, t) — min PET per pair (dedupe)
    for pid, ptr in peds.items():
        pxy, pt = ptr["xy"], ptr["t"]
        for i in range(len(pxy) - 1):
            cand: set = set()
            for c in _seg_cells(pxy[i][0], pxy[i][1], pxy[i + 1][0], pxy[i + 1][1]):
                cand.update(veh_by_cell.get(c, ()))
            for vid, j in cand:
                vxy, vt = vehs[vid]["xy"], vehs[vid]["t"]
                hit = _segment_pet(pxy[i], pxy[i + 1], pt[i], pt[i + 1],
                                   vxy[j], vxy[j + 1], vt[j], vt[j + 1])
                if hit is None:
                    continue
                key = (pid, vid)
                if key not in best or hit[2] < best[key][0]:
                    best[key] = (hit[2], hit[0], hit[1], min(pt[i], vt[j]))

    conflicts: list[dict] = []
    for (pid, vid), (pet, ix, iy, t) in best.items():
        if pet >= PED_PET_THRESHOLD:
            continue
        lon, lat = net.convertXY2LonLat(ix, iy)
        if not _in_bbox(bbox, lon, lat):
            continue
        conflicts.append({
            "t": round(t, 3), "lon": lon, "lat": lat, "type": "crossing",
            "severity": round(_clamp01(1.0 - pet / PED_PET_THRESHOLD), 3),
            "pet": round(pet, 3), "entities": [pid, vid],
        })
    return conflicts


def build_multimodal_artifact(records: dict, conflicts: list[dict], *, run_id: str, baseline_run_id: str,
                              change: Change, target_lane: int, bbox: list[float], sim_end: float,
                              step: float, scenario_network_name: str | None = None) -> TrajectoryArtifact:
    """Assemble the FIRST real v0.3.0 artifact from multi-modal trajectories + scenario conflicts.
    scorecard stays None (2.4b), agents stays [] (2.6). Ocean-guards a sample vehicle position."""
    vehicles = [
        Vehicle(id=vid, type=r["type"], path=r["path"], timestamps=r["timestamps"], speeds=r["speeds"])
        for vid, r in records.items() if r["type"] in ("car", "bicycle")
    ]
    persons = [
        Person(id=pid, type=r["type"], path=r["path"], timestamps=r["timestamps"], speeds=r["speeds"])
        for pid, r in records.items() if r["type"] == "pedestrian"
    ]
    if not vehicles:
        raise RuntimeError("no vehicles recorded — cannot build artifact")

    # ocean-guard: a sample vehicle's first point must be in-bbox (geo-conversion sanity).
    s_lon, s_lat = vehicles[0].path[0]
    print(f"[geo-check] sample vehicle {vehicles[0].id!r} first point -> lon {s_lon:.5f}, lat {s_lat:.5f}")
    if not _in_bbox(bbox, s_lon, s_lat):
        raise RuntimeError(f"sample coord ({s_lon},{s_lat}) OUTSIDE bbox {bbox} — refusing to write")

    change = change.model_copy(update={"target_lane": target_lane})
    return TrajectoryArtifact(
        schema_version="0.3.0",
        meta=Meta(
            run_id=run_id, network=scenario_network_name or run_sim.NET.name, bbox=bbox, sim_start=0.0, sim_end=sim_end,
            step_length=step, created_at=datetime.now(timezone.utc).isoformat(),
            scenario=Scenario(baseline_run_id=baseline_run_id, change=change),
        ),
        vehicles=vehicles,
        persons=persons,
        conflicts=[Conflict(**c) for c in conflicts],
        scorecard=None,
        agents=[],
    )


def _write_provisional(path: Path, *, run_id: str, role: str, change: Change | None, target_lane: int | None,
                       bbox: list[float], sim_end: float, step: float, records: dict) -> None:
    """Provisional (UNVALIDATED) per-entity trajectory capture for 2.3/2.6 to formalize. Same per-entity
    shape as the v0.2.0 vehicles, with type in {car, bicycle, pedestrian}. NOT a contract artifact."""
    by_mode = Counter(r["type"] for r in records.values())
    path.write_text(
        json.dumps(
            {
                "provisional": True,
                "run_id": run_id,
                "role": role,
                "network": run_sim.NET.name,
                "bbox": bbox,
                "sim_start": 0.0,
                "sim_end": sim_end,
                "step_length": step,
                "change": (change.model_dump(exclude_none=True) | {"target_lane": target_lane}) if change else None,
                "counts_by_mode": dict(by_mode),
                "entities": [{"id": eid, **rec} for eid, rec in records.items()],
            },
        ),
        encoding="utf-8",
    )


def run_pair_multimodal(change: Change, target_lane: int, net, *, ts: str | None = None,
                        scenario_net_path: Path | None = None, on_stage=None) -> dict:
    """Baseline (no change) then scenario, SAME multimodal demand + IDENTICAL rerouting + SSM. For a runtime
    change (bike_lane/speed_limit) both runs share the canonical net and the change is applied in-sim. For a
    GEOMETRY change (new_road) the SCENARIO run uses ``scenario_net_path`` (the patched net) with NO runtime
    edit — the net IS the change; baseline stays canonical. ``ts`` may be supplied so the job runner can track
    a known run id. Returns the scenario trajectories + per-run conflicts for the caller to promote."""
    bbox = run_sim.net_bbox(run_sim.NET)  # canonical geo-ref; the patched net is geo-identical (gauntlet proved it)
    ts = ts or datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    base_id, scen_id = f"multimodal-baseline-{ts}", f"multimodal-scenario-{ts}"
    paths = {
        "base_ti": RUNS_DIR / f"{base_id}.tripinfo.xml", "scen_ti": RUNS_DIR / f"{scen_id}.tripinfo.xml",
        "base_vr": RUNS_DIR / f"{base_id}.vehroute.xml", "scen_vr": RUNS_DIR / f"{scen_id}.vehroute.xml",
        "base_ssm": RUNS_DIR / f"{base_id}.ssm.xml", "scen_ssm": RUNS_DIR / f"{scen_id}.ssm.xml",
    }
    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    # scenario conflicts resolve edges against the SCENARIO net (the new edge exists only there).
    scen_net = sumolib.net.readNet(str(scenario_net_path)) if scenario_net_path is not None else net

    if on_stage:
        on_stage("baseline")
    print(f"\n=== BASELINE run ({base_id}) — no change, rerouting + SSM ON ===")
    recs_b, end_b, step_b, rem_b, xy_b = simulate_multimodal(
        None, None, tripinfo_path=paths["base_ti"], vehroute_path=paths["base_vr"], ssm_path=paths["base_ssm"])
    _write_provisional(RUNS_DIR / f"{base_id}.json", run_id=base_id, role="baseline", change=None,
                       target_lane=None, bbox=bbox, sim_end=end_b, step=step_b, records=recs_b)
    conf_b = {"ssm": parse_ssm(paths["base_ssm"], net, bbox), "ped": compute_ped_conflicts(xy_b, net, bbox)}
    print(f"[baseline] sim_end={end_b:.0f}s remaining={rem_b}  entities={len(recs_b)}  "
          f"conflicts: {len(conf_b['ssm'])} veh + {len(conf_b['ped'])} ped")

    if on_stage:
        on_stage("scenario")
    print(f"\n=== SCENARIO run ({scen_id}) — {change.description}, rerouting + SSM ON ===")
    if scenario_net_path is not None:  # new_road: the net IS the change (no runtime apply_change)
        recs_s, end_s, step_s, rem_s, xy_s = simulate_multimodal(
            None, None, tripinfo_path=paths["scen_ti"], vehroute_path=paths["scen_vr"],
            ssm_path=paths["scen_ssm"], net_override=scenario_net_path)
    else:
        recs_s, end_s, step_s, rem_s, xy_s = simulate_multimodal(
            change, target_lane, tripinfo_path=paths["scen_ti"], vehroute_path=paths["scen_vr"],
            ssm_path=paths["scen_ssm"])
    conf_s = {"ssm": parse_ssm(paths["scen_ssm"], scen_net, bbox), "ped": compute_ped_conflicts(xy_s, scen_net, bbox)}
    print(f"[scenario] sim_end={end_s:.0f}s remaining={rem_s}  entities={len(recs_s)}  "
          f"conflicts: {len(conf_s['ssm'])} veh + {len(conf_s['ped'])} ped")

    return {
        "ts": ts, "base_id": base_id, "scen_id": scen_id, **paths,
        "recs_s": recs_s, "bbox": bbox, "sim_end_s": end_s, "step_s": step_s,
        "conf_b": conf_b, "conf_s": conf_s,
    }


def count_persons(rou_path: Path) -> int:
    return sum(1 for _ in ET.parse(rou_path).getroot().iter("person"))


def _print_multimodal_report(change: Change, target_lane: int, severed: set[str], buckets: dict,
                             rerouted: int, reroute_matched: int) -> None:
    print("\n" + "=" * 70)
    print("MULTI-MODAL OUTCOME REPORT — baseline vs bike-lane scenario")
    print("=" * 70)
    print(f"change        : {change.type} on edge {change.target_edge!r}, lane {target_lane} -> bicycle-only")
    print(f"description   : {change.description}")
    print(f"connectivity  : {'OK (no car turns severed)' if not severed else f'SEVERED car turns to {sorted(severed)}'}")
    print("-" * 70)
    for mode in MODES:
        c = buckets[mode]["counts"]
        outs = buckets[mode]["outcomes"]
        print(f"[{mode}] demand {c['total_demand']} | matched_both {c['matched_both']} | "
              f"baseline_only {c['baseline_only']} | scenario_only {c['scenario_only']} | neither {c['neither']}")
        if outs:
            deltas = sorted(o["delta_seconds"] for o in outs)
            losers = sum(1 for d in deltas if d > 0.5)
            share = 100.0 * losers / len(deltas)
            print(f"        delta_seconds (scen-base, +=worse): min {deltas[0]:.1f} / median "
                  f"{statistics.median(deltas):.1f} / max {deltas[-1]:.1f} | losers(>0.5s) {losers} ({share:.0f}%)")
        else:
            print("        no completers-in-both — no deltas")
    print("-" * 70)
    car_matched = buckets["car"]["counts"]["matched_both"]
    print(f"CARS REROUTED : {rerouted} / {reroute_matched} matched cars took a different path "
          f"({(100.0 * rerouted / reroute_matched) if reroute_matched else 0:.0f}%) — the adaptation signal")
    print("NOTE          : bike & ped deltas are reported for completeness; their REAL signal (safety/")
    print("                access) comes later — small time deltas are NOT those groups' outcome.")
    print("=" * 70)


def _dist_point_to_polyline(px: float, py: float, shape: list) -> float:
    """Min distance (m) from (px,py) to a polyline of (x,y) points."""
    best = float("inf")
    for (ax, ay), (bx, by) in zip(shape, shape[1:]):
        dx, dy = bx - ax, by - ay
        seg2 = dx * dx + dy * dy
        u = 0.0 if seg2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / seg2))
        cx, cy = ax + u * dx, ay + u * dy
        best = min(best, ((px - cx) ** 2 + (py - cy) ** 2) ** 0.5)
    return best


def _print_conflict_report(net, target_edge: str, conf_b: dict, conf_s: dict, near_m: float = 50.0) -> None:
    print("\n" + "=" * 70)
    print("SAFETY-SURROGATE CONFLICTS — baseline vs scenario (near-misses, NOT crash predictions)")
    print("=" * 70)
    print(f"thresholds    : veh TTC<{SSM_TTC_THRESHOLD}s, PET<{SSM_PET_THRESHOLD}s, DRAC>{SSM_DRAC_THRESHOLD}m/s²  |  "
          f"ped PET<{PED_PET_THRESHOLD}s (crossing-anchored)")
    for label, conf in (("baseline", conf_b), ("scenario", conf_s)):
        allc = conf["ssm"] + conf["ped"]
        by_type = Counter(c["type"] for c in allc)
        print(f"[{label}] total {len(allc)}  = {len(conf['ssm'])} veh-veh (SSM) + {len(conf['ped'])} ped-veh (PET) | "
              f"by type: {dict(by_type)}")
    # clustering of SCENARIO conflicts relative to the changed edge (in metres).
    try:
        shape = net.getEdge(target_edge).getShape()
        near = far = 0
        for c in conf_s["ssm"] + conf_s["ped"]:
            x, y = net.convertLonLat2XY(c["lon"], c["lat"])
            if _dist_point_to_polyline(x, y, shape) <= near_m:
                near += 1
            else:
                far += 1
        print(f"[scenario] clustering vs changed edge {target_edge!r}: {near} within {near_m:.0f} m, {far} elsewhere")
    except Exception as exc:  # convertLonLat2XY / shape unavailable — skip distance, keep type breakdown
        print(f"[scenario] clustering unavailable ({exc!r})")
    print("CAVEAT        : rerouting shifts EXPOSURE (who is where), so a raw baseline-vs-scenario count")
    print("                delta is not a pure safety effect — 2.4b computes per-group deltas.")
    print("=" * 70)


def run_pair(change: Change) -> dict:
    """Run baseline then scenario with the SAME demand; emit both artifacts + tripinfo files."""
    bbox = run_sim.net_bbox(run_sim.NET)
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    base_id = f"baseline-{ts}"
    scen_id = f"scenario-{ts}"
    base_tripinfo = RUNS_DIR / f"{base_id}.tripinfo.xml"
    scen_tripinfo = RUNS_DIR / f"{scen_id}.tripinfo.xml"
    RUNS_DIR.mkdir(parents=True, exist_ok=True)

    print(f"\n=== BASELINE run ({base_id}) — no change ===")
    recs, end, step = run_sim.simulate(change=None, tripinfo_path=base_tripinfo)
    base_art = run_sim.build_artifact(
        recs, end, step, run_id=base_id, network=run_sim.NET.name, bbox=bbox
    )
    trajectory_io.dump_artifact(base_art)

    print(f"\n=== SCENARIO run ({scen_id}) — {change.description} ===")
    recs2, end2, step2 = run_sim.simulate(change=change, tripinfo_path=scen_tripinfo)
    scenario = Scenario(baseline_run_id=base_id, change=change)
    scen_art = run_sim.build_artifact(
        recs2, end2, step2, run_id=scen_id, network=run_sim.NET.name, bbox=bbox, scenario=scenario
    )
    trajectory_io.dump_artifact(scen_art)  # agents stays []

    return {
        "ts": ts,
        "base_id": base_id,
        "scen_id": scen_id,
        "base_tripinfo": base_tripinfo,
        "scen_tripinfo": scen_tripinfo,
    }


def _print_report(change: Change, counts: dict, outcomes: list[dict], side_name: str) -> None:
    print("\n" + "=" * 64)
    print("OUTCOME REPORT — baseline vs scenario")
    print("=" * 64)
    print(f"change            : {change.type} on edge {change.target_edge!r}")
    print(f"new max speed     : {change.value_mps:.2f} m/s ({change.value_mps * 3.6:.1f} km/h)")
    print(f"description       : {change.description}")
    print("-" * 64)
    print(f"total demand      : {counts['total_demand']}")
    print(f"completed both    : {counts['matched_both']}   (matched set used for deltas)")
    print(f"baseline-only     : {counts['baseline_only']}   (finished baseline, NOT scenario)")
    print(f"scenario-only     : {counts['scenario_only']}   (finished scenario, NOT baseline)")
    print(f"completed neither : {counts['neither']}")
    print("-" * 64)
    if outcomes:
        deltas = sorted(o["delta_seconds"] for o in outcomes)
        losers = sum(1 for d in deltas if d > 0)
        winners = sum(1 for d in deltas if d < 0)
        unchanged = sum(1 for d in deltas if d == 0)
        print("delta_seconds (scenario - baseline; POSITIVE = slower/loser):")
        print(f"  min / median / max : {deltas[0]:.1f} / {statistics.median(deltas):.1f} / {deltas[-1]:.1f}")
        print(f"  mean               : {statistics.fmean(deltas):.1f}")
        print(f"  losers / unchanged / winners : {losers} / {unchanged} / {winners}")
    else:
        print("no vehicles completed in BOTH runs — cannot compute deltas")
    print("=" * 64)
    print(f"outcomes side-file: contract/runs/{side_name}")


def _run_speed_limit(args) -> None:
    """5.2b: STAGED, multimodal speed_limit (runtime change → NO regen), via ``run_quant_runtime`` so the job
    runner + RunCard work exactly like new_road. (Upgraded from the Phase-1 cars-only path so the scorecard is
    uniform; the legacy cars-only ``run_pair``/``join_outcomes``/``_print_report`` + sampler flat-branch are now
    vestigial — noted for later deletion, NOT removed here.)"""
    import run_state

    if args.target_edge:
        target_edge = args.target_edge
        print(f"[edge] using provided target edge {target_edge!r}")
    else:
        target_edge, n, length_m = pick_busy_edge(ROUTES, run_sim.NET)
        print(f"[edge] auto-picked highest vehicle-distance edge {target_edge!r} ({n} routes, {length_m:.0f} m)")
    kmh = args.speed_mps * 3.6
    change = Change(type="speed_limit", target_edge=target_edge, value_mps=args.speed_mps,
                    description=args.description or f"Reduced max speed on edge {target_edge} to {kmh:.0f} km/h")
    ts = getattr(args, "run_ts", None) or datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_id = f"multimodal-scenario-{ts}"
    try:
        run_state.set_stage(run_id, "baseline", change.description,  # records change.type for the RunCard
                            description=change.description, change=change.model_dump(exclude_none=True))
        res = run_quant_runtime(change, ts, None)
        print(f"\n[speed_limit] DONE — {res['scen_id']}; cars rerouted {res['cars_rerouted']}, "
              f"car median delta {res['car_median_delta_s']}s")
    except Exception as e:  # noqa: BLE001 — surface a failed state (the job runner reads it) then re-raise
        run_state.set_stage(run_id, "failed", str(e)[:300])
        raise


def _run_bike_lane(args) -> None:
    """5.2b: STAGED multimodal bike-lane (runtime change → NO regen), via ``run_quant_runtime`` — job-runner ready.
    Eligibility is gated by the SINGLE-SOURCE ``edge_bike_eligibility`` (same rule the live apply_change enforces)."""
    import network_edit
    import run_state

    if args.target_edge:
        target_edge = args.target_edge
        net = sumolib.net.readNet(str(run_sim.NET))
        print(f"[edge] using provided target edge {target_edge!r} ({_car_lane_count(net, target_edge)} car lanes)")
    else:
        target_edge, n, length_m, net = pick_bike_lane_edge(ROUTES, run_sim.NET, min_car_lanes=2)
        print(f"[edge] auto-picked busiest >=2-car-lane edge {target_edge!r} ({n} routes, {length_m:.0f} m)")
    eligible, reason = network_edit.edge_bike_eligibility(net, target_edge)
    if not eligible:
        raise SystemExit(f"[bike_lane] ineligible edge {target_edge!r}: {reason}")
    target_lane = args.target_lane if args.target_lane is not None else curbside_car_lane(net, target_edge)
    severed = connectivity_check(net, target_edge, target_lane)
    print(f"[lane] converting lane {target_lane} (curbside car lane) -> bicycle-only; "
          f"connectivity: {'OK' if not severed else f'SEVERS car turns to {sorted(severed)}'}")
    change = Change(type="bike_lane", target_edge=target_edge, target_lane=target_lane,
                    description=args.description or f"Converted lane {target_lane} of edge {target_edge} to a bicycle-only lane")
    ts = getattr(args, "run_ts", None) or datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_id = f"multimodal-scenario-{ts}"
    try:
        run_state.set_stage(run_id, "baseline", change.description,
                            description=change.description, change=change.model_dump(exclude_none=True))
        res = run_quant_runtime(change, ts, target_lane, severed=severed)
        print(f"\n[bike_lane] DONE — {res['scen_id']}; cars rerouted {res['cars_rerouted']}, "
              f"car median delta {res['car_median_delta_s']}s; severed={res['severed']}")
    except Exception as e:  # noqa: BLE001
        run_state.set_stage(run_id, "failed", str(e)[:300])
        raise


def run_quant(change: Change, ts: str, scenario_net_path: Path, new_edge_ids: list[str]) -> tuple[str, int]:
    """Shared new_road QUANT pipeline (CLI + server): baseline (canonical) + scenario (patched net) + per-mode
    outcomes + conflicts + reroute + scorecard, all under a KNOWN ts. Writes the v0.3.0 artifact, sidecars,
    and latest.json. Returns (scenario_run_id, cars_on_new_road). No LLM, no enrich."""
    import scorecard
    import run_state

    run_id = f"multimodal-scenario-{ts}"
    net = sumolib.net.readNet(str(run_sim.NET))  # canonical (baseline)
    ids = run_pair_multimodal(change, None, net, ts=ts, scenario_net_path=scenario_net_path,
                              on_stage=lambda s: run_state.set_stage(run_id, s))

    demand = {"car": count_demand(ROUTES), "bicycle": count_demand(BIKE_ROUTES), "pedestrian": count_persons(PED_ROUTES)}
    buckets = join_per_mode(ids["base_ti"], ids["scen_ti"], demand)
    run_state.set_stage(run_id, "analysis", "joining outcomes + conflicts + scorecard")
    car_ids = [o["id"] for o in buckets["car"]["outcomes"]]
    rerouted, reroute_matched = reroute_count(ids["base_vr"], ids["scen_vr"], car_ids)
    on_new = count_on_new_edges(ids["scen_vr"], new_edge_ids)  # THE number

    conflicts_s = ids["conf_s"]["ssm"] + ids["conf_s"]["ped"]
    artifact = build_multimodal_artifact(
        ids["recs_s"], conflicts_s, run_id=ids["scen_id"], baseline_run_id=ids["base_id"], change=change,
        target_lane=None, bbox=ids["bbox"], sim_end=ids["sim_end_s"], step=ids["step_s"],
        scenario_network_name=scenario_net_path.name)
    art_path = trajectory_io.dump_artifact(artifact, path=RUNS_DIR / f"{ids['scen_id']}.json")  # validates

    (RUNS_DIR / f"conflicts-baseline-{ids['ts']}.json").write_text(
        json.dumps({"baseline_run_id": ids["base_id"], "conflicts": ids["conf_b"]["ssm"] + ids["conf_b"]["ped"]}, indent=2),
        encoding="utf-8")
    (RUNS_DIR / f"outcomes-{ids['ts']}.json").write_text(json.dumps({
        "scenario_run_id": ids["scen_id"], "baseline_run_id": ids["base_id"],
        "change": change.model_dump(exclude_none=True), "connectivity_severed_edges": [],
        "reroute": {"cars_rerouted": rerouted, "cars_matched": reroute_matched, "cars_on_new_road": on_new},
        "modes": buckets}, indent=2), encoding="utf-8")

    # scorecard inject + latest.json (reuse scorecard.compute_scorecard; scenario conflicts on the patched net).
    sc = scorecard.compute_scorecard(buckets, ids["conf_b"]["ssm"] + ids["conf_b"]["ped"], conflicts_s,
                                     change.model_dump(exclude_none=True))
    art2 = trajectory_io.load_artifact(art_path)
    art2.scorecard = sc
    trajectory_io.dump_artifact(art2, path=art_path)
    trajectory_io.load_artifact(art_path)  # round-trip proof
    web = run_sim.ROOT / "web" / "public"
    (web / art_path.name).write_text(art_path.read_text(encoding="utf-8"), encoding="utf-8")
    (web / "latest.json").write_text(art_path.read_text(encoding="utf-8"), encoding="utf-8")
    run_state.set_stage(run_id, "done", f"cars_on_new_road={on_new}", scenario_run_id=ids["scen_id"],
                        cars_on_new_road=on_new, cars_rerouted=rerouted)
    print(f"[run_quant] {ids['scen_id']} — cars_on_new_road={on_new} (rerouted {rerouted}/{reroute_matched}); "
          f"scorecard injected; latest.json updated")
    return ids["scen_id"], on_new


def run_quant_runtime(change: Change, ts: str, target_lane: int | None, severed: set | None = None) -> dict:
    """The RUNTIME twin of ``run_quant`` (speed_limit / bike_lane), shared by the CLI + the job runner. Canonical
    net for BOTH runs (no netconvert → NO regen stage); the change is applied LIVE in the scenario run. Stages:
    baseline → scenario → analysis → done. Writes the v0.3.0 artifact + sidecars + scorecard + web/public +
    latest.json, exactly like ``run_quant``. Returns a dict incl. cars_rerouted + the car-delay summary the
    RunCard shows (so a legitimate 0-reroute reads as 'absorbed as delay', not failure)."""
    import scorecard
    import run_state

    run_id = f"multimodal-scenario-{ts}"
    net = sumolib.net.readNet(str(run_sim.NET))  # canonical for both runs (runtime change, no patch)
    ids = run_pair_multimodal(change, target_lane, net, ts=ts,
                              on_stage=lambda s: run_state.set_stage(run_id, s))  # emits baseline, scenario

    demand = {"car": count_demand(ROUTES), "bicycle": count_demand(BIKE_ROUTES), "pedestrian": count_persons(PED_ROUTES)}
    buckets = join_per_mode(ids["base_ti"], ids["scen_ti"], demand)
    run_state.set_stage(run_id, "analysis", "joining outcomes + conflicts + scorecard")
    car_ids = [o["id"] for o in buckets["car"]["outcomes"]]
    rerouted, reroute_matched = reroute_count(ids["base_vr"], ids["scen_vr"], car_ids)

    conflicts_s = ids["conf_s"]["ssm"] + ids["conf_s"]["ped"]
    artifact = build_multimodal_artifact(
        ids["recs_s"], conflicts_s, run_id=ids["scen_id"], baseline_run_id=ids["base_id"], change=change,
        target_lane=target_lane, bbox=ids["bbox"], sim_end=ids["sim_end_s"], step=ids["step_s"])
    art_path = trajectory_io.dump_artifact(artifact, path=RUNS_DIR / f"{ids['scen_id']}.json")  # validates

    (RUNS_DIR / f"conflicts-baseline-{ids['ts']}.json").write_text(
        json.dumps({"baseline_run_id": ids["base_id"], "conflicts": ids["conf_b"]["ssm"] + ids["conf_b"]["ped"]}, indent=2),
        encoding="utf-8")
    (RUNS_DIR / f"outcomes-{ids['ts']}.json").write_text(json.dumps({
        "scenario_run_id": ids["scen_id"], "baseline_run_id": ids["base_id"],
        "change": change.model_dump(exclude_none=True), "connectivity_severed_edges": sorted(severed or []),
        "reroute": {"cars_rerouted": rerouted, "cars_matched": reroute_matched}, "modes": buckets}, indent=2),
        encoding="utf-8")

    sc = scorecard.compute_scorecard(buckets, ids["conf_b"]["ssm"] + ids["conf_b"]["ped"], conflicts_s,
                                     change.model_dump(exclude_none=True))
    art2 = trajectory_io.load_artifact(art_path)
    art2.scorecard = sc
    trajectory_io.dump_artifact(art2, path=art_path)
    trajectory_io.load_artifact(art_path)  # round-trip proof
    web = run_sim.ROOT / "web" / "public"
    (web / art_path.name).write_text(art_path.read_text(encoding="utf-8"), encoding="utf-8")
    (web / "latest.json").write_text(art_path.read_text(encoding="utf-8"), encoding="utf-8")

    # Car-delay summary for the RunCard (cars often absorb a lane loss as delay, not detour — 2.2 finding).
    car_out = [o["delta_seconds"] for o in buckets["car"]["outcomes"]]
    car_median = round(statistics.median(car_out), 1) if car_out else None
    car_share = round(sum(1 for d in car_out if d > 30) / len(car_out), 3) if car_out else None
    run_state.set_stage(run_id, "done", f"cars_rerouted={rerouted}; car_median_delta_s={car_median}",
                        scenario_run_id=ids["scen_id"], cars_rerouted=rerouted,
                        car_median_delta_s=car_median, car_affected_share=car_share)
    print(f"[run_quant_runtime] {ids['scen_id']} — rerouted {rerouted}/{reroute_matched}; "
          f"car median delta {car_median}s, affected {car_share}; scorecard injected; latest.json updated")
    return {"scen_id": ids["scen_id"], "cars_rerouted": rerouted, "car_median_delta_s": car_median,
            "car_affected_share": car_share, "buckets": buckets, "severed": sorted(severed or [])}


def _run_new_road(args) -> None:
    """5.1 CLI: patch a new_road between two existing junctions, then run the quant pipeline headless. Emits
    run-state (regen/baseline/scenario/analysis/done/failed) so the job runner can track a KNOWN --run-ts."""
    import network_edit
    import run_state

    a, b = args.from_junction, args.to_junction
    if not (a and b):
        raise SystemExit("new_road needs --from-junction and --to-junction")
    change = Change(type="new_road", target_edge=f"nr_{a}_{b}", from_junction=a, to_junction=b,
                    lanes=args.lanes, speed_mps=args.speed_mps, bidirectional=args.bidirectional,
                    description=args.description or f"New road from junction {a} to {b}")
    ts = getattr(args, "run_ts", None) or datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_id = f"multimodal-scenario-{ts}"
    try:
        run_state.set_stage(run_id, "regen", f"patching net: {change.description}",
                            description=change.description, change=change.model_dump(exclude_none=True))
        patched, new_edge_ids, stats = network_edit.patch_network(change, run_id)
        print(f"[new_road] patched net {patched.name} + gauntlet OK: {stats}")
        scen_id, on_new = run_quant(change, ts, patched, new_edge_ids)
        print(f"\n[new_road] DONE — scenario {scen_id}; cars that took the new road: {on_new}")
    except Exception as e:  # noqa: BLE001 — surface a failed state (the job runner reads it) then re-raise
        run_state.set_stage(run_id, "failed", str(e)[:300])
        raise


def main() -> None:
    ap = argparse.ArgumentParser(description="Baseline-vs-scenario SUMO harness (multi-modal bike_lane / speed_limit).")
    ap.add_argument("--change-type", choices=["bike_lane", "speed_limit", "new_road"], default="bike_lane",
                    help="bike_lane = Phase-2 multi-modal (default); speed_limit = Phase-1 cars-only; new_road = 5.1")
    ap.add_argument("--target-edge", default=None, help="SUMO edge id to change (default: auto-pick busiest)")
    ap.add_argument("--target-lane", type=int, default=None, help="lane index to convert (bike_lane; default: curbside car lane)")
    ap.add_argument("--speed-mps", type=float, default=DEFAULT_SPEED_MPS, help="new max speed in m/s (speed_limit)")
    # new_road geometry (5.1)
    ap.add_argument("--from-junction", default=None, help="new_road: existing junction id the road departs")
    ap.add_argument("--to-junction", default=None, help="new_road: existing junction id the road arrives at")
    ap.add_argument("--lanes", type=int, default=1, help="new_road: lanes per direction")
    ap.add_argument("--bidirectional", action="store_true", help="new_road: build both directions")
    ap.add_argument("--description", default=None)
    ap.add_argument("--run-ts", default=None, help="use this timestamp as the run id (the job runner passes it)")
    args = ap.parse_args()
    if args.change_type == "speed_limit":
        _run_speed_limit(args)
    elif args.change_type == "new_road":
        _run_new_road(args)
    else:
        _run_bike_lane(args)


if __name__ == "__main__":
    main()
