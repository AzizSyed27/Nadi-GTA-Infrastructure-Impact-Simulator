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

Routes are static (explicit per-vehicle ``<route edges=...>``, no rerouting device), so the two runs
produce the same vehicles on the same paths differing only in timing — which is what makes the
join-by-id valid.

Run as a script:
    python python/src/scenario_harness.py                      # auto-pick busiest edge, 30 km/h
    python python/src/scenario_harness.py --target-edge E123 --speed-mps 5.0
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
RUNS_DIR = trajectory_io.RUNS_DIR

DEFAULT_SPEED_MPS = 8.33  # 30 km/h


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


def main() -> None:
    ap = argparse.ArgumentParser(description="Baseline-vs-scenario SUMO harness (speed_limit change).")
    ap.add_argument("--target-edge", default=None, help="SUMO edge id to change (default: busiest edge)")
    ap.add_argument("--speed-mps", type=float, default=DEFAULT_SPEED_MPS, help="new max speed in m/s")
    args = ap.parse_args()

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

    # Persist the join as a plain side-output (a handoff for the later sampling/LLM step) — NOT agents[].
    # Named `outcomes-<ts>.json` (NOT `scenario-<ts>.*`) so it never collides with the `scenario-*.json`
    # artifact glob a consumer would use to find run artifacts.
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


if __name__ == "__main__":
    main()
