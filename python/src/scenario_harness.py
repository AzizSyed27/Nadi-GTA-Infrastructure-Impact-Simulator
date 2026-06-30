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
from contract_models import Change, Scenario

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
REROUTING_ARGS = [
    "--device.rerouting.probability", "1",
    "--device.rerouting.period", "60",
    "--device.rerouting.adaptation-interval", "10",
    "--seed", "42",
]


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


def _record(records: dict, eid: str, mode: str, pos, speed: float, t: float) -> None:
    lon, lat = run_sim.conn.simulation.convertGeo(pos[0], pos[1])  # (x,y)->(lon,lat); the conversion that matters
    rec = records.get(eid)
    if rec is None:
        rec = records[eid] = {"type": mode, "path": [], "timestamps": [], "speeds": []}
    rec["path"].append([lon, lat])
    rec["timestamps"].append(round(t, 3))
    rec["speeds"].append(round(speed, 3))


def simulate_multimodal(change: Change | None, target_lane: int | None, *, tripinfo_path: Path, vehroute_path: Path):
    """Run corridor.multimodal.sumocfg headless with rerouting; record cars+bikes (vehicles) AND peds
    (persons, a separate population). If ``change`` is given it is applied once at sim start.

    Two sequential start/close cycles per pair are SAFE on TraCI (fresh subprocess each) but UNSAFE on
    libsumo (global C++ state) — if a libsumo wheel is ever installed, run the two in separate processes.
    """
    conn = run_sim.conn
    args = [
        str(run_sim.SUMO_BINARY), "-c", str(MULTIMODAL_CFG), "--end", str(MULTIMODAL_MAX_T),
        "--tripinfo-output", str(tripinfo_path), "--vehroute-output", str(vehroute_path),
        *REROUTING_ARGS,
    ]
    conn.start(args)
    if change is not None:
        run_sim.apply_change(change, target_lane=target_lane)  # after start, before stepping -> in force from t=0
    step = conn.simulation.getDeltaT()

    records: dict[str, dict] = {}
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
                _record(records, vid, mode, conn.vehicle.getPosition(vid), conn.vehicle.getSpeed(vid), t)
            for pid in conn.person.getIDList():  # persons are NEVER in vehicle.getIDList()
                _record(records, pid, "pedestrian", conn.person.getPosition(pid), conn.person.getSpeed(pid), t)
        sim_end = conn.simulation.getTime()
        remaining = conn.simulation.getMinExpectedNumber()
    finally:
        conn.close()
    if not records:
        raise RuntimeError("No entities recorded — multimodal demand/config problem?")
    return records, sim_end, step, remaining


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


def run_pair_multimodal(change: Change, target_lane: int) -> dict:
    """Baseline (no change) then scenario (bike_lane applied), SAME multimodal demand + IDENTICAL
    rerouting. Emits tripinfo + vehroute per run and writes provisional trajectory files."""
    bbox = run_sim.net_bbox(run_sim.NET)  # net is identical across runs; lane perms change only in-sim
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    base_id, scen_id = f"multimodal-baseline-{ts}", f"multimodal-scenario-{ts}"
    paths = {
        "base_ti": RUNS_DIR / f"{base_id}.tripinfo.xml", "scen_ti": RUNS_DIR / f"{scen_id}.tripinfo.xml",
        "base_vr": RUNS_DIR / f"{base_id}.vehroute.xml", "scen_vr": RUNS_DIR / f"{scen_id}.vehroute.xml",
    }
    RUNS_DIR.mkdir(parents=True, exist_ok=True)

    print(f"\n=== BASELINE run ({base_id}) — no change, rerouting ON ===")
    recs_b, end_b, step_b, rem_b = simulate_multimodal(None, None, tripinfo_path=paths["base_ti"], vehroute_path=paths["base_vr"])
    _write_provisional(RUNS_DIR / f"{base_id}.json", run_id=base_id, role="baseline", change=None,
                       target_lane=None, bbox=bbox, sim_end=end_b, step=step_b, records=recs_b)
    print(f"[baseline] sim_end={end_b:.0f}s remaining={rem_b}  entities={len(recs_b)}")

    print(f"\n=== SCENARIO run ({scen_id}) — {change.description}, rerouting ON ===")
    recs_s, end_s, step_s, rem_s = simulate_multimodal(change, target_lane, tripinfo_path=paths["scen_ti"], vehroute_path=paths["scen_vr"])
    _write_provisional(RUNS_DIR / f"{scen_id}.json", run_id=scen_id, role="scenario", change=change,
                       target_lane=target_lane, bbox=bbox, sim_end=end_s, step=step_s, records=recs_s)
    print(f"[scenario] sim_end={end_s:.0f}s remaining={rem_s}  entities={len(recs_s)}")

    return {"ts": ts, "base_id": base_id, "scen_id": scen_id, **{k: v for k, v in paths.items()}}


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
    """Phase-1 path (preserved): cars-only static-route speed_limit harness."""
    if args.target_edge:
        target_edge = args.target_edge
        print(f"[edge] using provided target edge {target_edge!r}")
    else:
        target_edge, n, length_m = pick_busy_edge(ROUTES, run_sim.NET)
        print(
            f"[edge] auto-picked highest vehicle-distance edge {target_edge!r} "
            f"(traversed by {n} routes, {length_m:.0f} m long)"
        )
    kmh = args.speed_mps * 3.6
    change = Change(
        type="speed_limit",
        target_edge=target_edge,
        value_mps=args.speed_mps,
        description=f"Reduced max speed on edge {target_edge} to {kmh:.0f} km/h",
    )
    ids = run_pair(change)
    total_demand = count_demand(ROUTES)
    outcomes, counts = join_outcomes(ids["base_tripinfo"], ids["scen_tripinfo"], total_demand)
    side = RUNS_DIR / f"outcomes-{ids['ts']}.json"
    side.write_text(
        json.dumps(
            {
                "scenario_run_id": ids["scen_id"],
                "baseline_run_id": ids["base_id"],
                "change": change.model_dump(exclude_none=True),
                "counts": counts,
                "outcomes": outcomes,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    _print_report(change, counts, outcomes, side.name)


def _run_bike_lane(args) -> None:
    """Phase-2.2 path: multi-modal harness + bike-lane change with symmetric rerouting."""
    if args.target_edge:
        target_edge = args.target_edge
        net = sumolib.net.readNet(str(run_sim.NET))
        print(f"[edge] using provided target edge {target_edge!r} ({_car_lane_count(net, target_edge)} car lanes)")
    else:
        target_edge, n, length_m, net = pick_bike_lane_edge(ROUTES, run_sim.NET, min_car_lanes=2)
        print(
            f"[edge] auto-picked busiest edge with >=2 car lanes: {target_edge!r} "
            f"(traversed by {n} routes, {length_m:.0f} m, {_car_lane_count(net, target_edge)} car lanes)"
        )
    target_lane = args.target_lane if args.target_lane is not None else curbside_car_lane(net, target_edge)
    severed = connectivity_check(net, target_edge, target_lane)
    print(f"[lane] converting lane {target_lane} (curbside car lane) -> bicycle-only; "
          f"connectivity: {'OK' if not severed else f'SEVERS car turns to {sorted(severed)}'}")

    change = Change(
        type="bike_lane",
        target_edge=target_edge,
        description=f"Converted lane {target_lane} of edge {target_edge} to a bicycle-only lane",
    )
    ids = run_pair_multimodal(change, target_lane)

    demand = {"car": count_demand(ROUTES), "bicycle": count_demand(BIKE_ROUTES), "pedestrian": count_persons(PED_ROUTES)}
    buckets = join_per_mode(ids["base_ti"], ids["scen_ti"], demand)
    car_ids = [o["id"] for o in buckets["car"]["outcomes"]]
    rerouted, reroute_matched = reroute_count(ids["base_vr"], ids["scen_vr"], car_ids)

    # Per-mode outcomes sidecar (extends Phase-1's shape with per-mode buckets). NOT a contract artifact.
    side = RUNS_DIR / f"outcomes-{ids['ts']}.json"
    side.write_text(
        json.dumps(
            {
                "scenario_run_id": ids["scen_id"],
                "baseline_run_id": ids["base_id"],
                "change": change.model_dump(exclude_none=True) | {"target_lane": target_lane},
                "connectivity_severed_edges": sorted(severed),
                "reroute": {"cars_rerouted": rerouted, "cars_matched": reroute_matched},
                "modes": buckets,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    _print_multimodal_report(change, target_lane, severed, buckets, rerouted, reroute_matched)
    print(f"outcomes side-file: contract/runs/{side.name}")


def main() -> None:
    ap = argparse.ArgumentParser(description="Baseline-vs-scenario SUMO harness (multi-modal bike_lane / speed_limit).")
    ap.add_argument("--change-type", choices=["bike_lane", "speed_limit"], default="bike_lane",
                    help="bike_lane = Phase-2 multi-modal (default); speed_limit = Phase-1 cars-only")
    ap.add_argument("--target-edge", default=None, help="SUMO edge id to change (default: auto-pick busiest)")
    ap.add_argument("--target-lane", type=int, default=None, help="lane index to convert (bike_lane; default: curbside car lane)")
    ap.add_argument("--speed-mps", type=float, default=DEFAULT_SPEED_MPS, help="new max speed in m/s (speed_limit)")
    args = ap.parse_args()
    if args.change_type == "speed_limit":
        _run_speed_limit(args)
    else:
        _run_bike_lane(args)


if __name__ == "__main__":
    main()
