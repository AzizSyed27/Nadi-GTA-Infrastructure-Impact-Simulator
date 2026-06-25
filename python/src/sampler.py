"""Phase 1 backend: sample instrumented travelers from a scenario's outcome set.

From the matched per-vehicle outcomes of a scenario run (Step 1.2's ``outcomes-<ts>.json``) this:
  1. bins travelers by outcome (got much WORSE / roughly UNCHANGED / got BETTER),
  2. selects N (default 12) travelers SPANNING those bins — guaranteeing a winners-and-losers mix,
     never all one sentiment — and only travelers that COMPLETE in the scenario run (so they have a
     full trajectory),
  3. assigns each a persona (round-robin for now),
  4. computes ``trigger_t`` = the sim-time of each traveler's WORST moment in the scenario run
     (longest stop, else lowest speed) — when their comment will pop in playback,
and writes the instrumented set ``[{vehicle_id, persona, outcome, trigger_t}]`` to a sidecar.

Reaction text is NOT produced here (Step 1.4). This sidecar is an INTERMEDIATE handoff, not the
frozen contract artifact — ``agents[]`` can't be written until reactions exist (``Agent.reaction`` is
a required schema field).

Run as a script:
    python python/src/sampler.py                       # newest outcomes-*.json, N=12
    python python/src/sampler.py --n 20 --unchanged-band 10
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import trajectory_io
from contract_models import Outcome
from personas import PersonaSpec, load_personas

RUNS_DIR = trajectory_io.RUNS_DIR
STOP_EPS = 0.1  # m/s — at or below this a vehicle is "stopped"
DEFAULT_N = 12
DEFAULT_BAND = 5.0  # s — |delta| within this is "roughly unchanged"
BIN_ORDER = ["worse", "unchanged", "better"]
OUTCOME_FIELDS = (
    "baseline_duration",
    "scenario_duration",
    "delta_seconds",
    "baseline_timeloss",
    "scenario_timeloss",
)


def bin_outcomes(outcomes: list[dict], unchanged_band: float) -> dict[str, list[dict]]:
    """Bin travelers by delta_seconds: >+band worse, <-band better, else roughly unchanged."""
    bins: dict[str, list[dict]] = {b: [] for b in BIN_ORDER}
    for o in outcomes:
        d = o["delta_seconds"]
        if d > unchanged_band:
            bins["worse"].append(o)
        elif d < -unchanged_band:
            bins["better"].append(o)
        else:
            bins["unchanged"].append(o)
    return bins


def select_counts(bins: dict[str, list[dict]], n: int) -> dict[str, int]:
    """How many to take per bin: guarantee >=1 worse & >=1 better when available, then balance to n.

    Caps at availability; balances toward equal thirds by always topping up the smallest current
    take that still has spare capacity. Total = min(n, total available).
    """
    avail = {b: len(bins[b]) for b in BIN_ORDER}
    take = {b: 0 for b in BIN_ORDER}
    n = min(n, sum(avail.values()))

    # Guarantee a winners-AND-losers mix: seed >=1 from worse and better if they exist.
    for b in ("worse", "better"):
        if avail[b] > 0 and sum(take.values()) < n:
            take[b] = 1

    # Fill the rest by repeatedly topping up the bin with the smallest current take that has capacity.
    while sum(take.values()) < n:
        cands = [b for b in BIN_ORDER if take[b] < avail[b]]
        if not cands:
            break
        b = min(cands, key=lambda b: (take[b], BIN_ORDER.index(b)))
        take[b] += 1
    return take


def evenly_spaced(items: list[dict], k: int) -> list[dict]:
    """Pick k items spread across a (pre-sorted) list to span its range. Deterministic."""
    m = len(items)
    if k <= 0 or m == 0:
        return []
    if k >= m:
        return list(items)
    if k == 1:
        return [items[m // 2]]
    idxs: list[int] = sorted({round(i * (m - 1) / (k - 1)) for i in range(k)})
    i = 0
    while len(idxs) < k and i < m:  # repair any rounding collisions (only matters for tiny bins)
        if i not in idxs:
            idxs.append(i)
        i += 1
    return [items[j] for j in sorted(idxs)[:k]]


def worst_moment(timestamps: list[float], speeds: list[float], stop_eps: float = STOP_EPS) -> float:
    """Sim-time of a traveler's worst moment: START of the longest stop, else the lowest-speed instant.

    Skips the standing-start / insertion ticks (vehicles depart at speed 0), so trigger_t marks a real
    congestion moment, not t=depart.
    """
    n = len(speeds)
    start = next((i for i in range(n) if speeds[i] > stop_eps), None)
    if start is None:  # degenerate: never moved
        return float(timestamps[n // 2])

    best_len, best_start = 0, -1
    i = start
    while i < n:
        if speeds[i] <= stop_eps:
            j = i
            while j < n and speeds[j] <= stop_eps:
                j += 1
            if j - i > best_len:
                best_len, best_start = j - i, i
            i = j
        else:
            i += 1

    if best_start >= 0:
        return float(timestamps[best_start])
    k = min(range(start, n), key=lambda x: speeds[x])  # never stopped -> slowest moving instant
    return float(timestamps[k])


def newest_outcomes() -> Path:
    files = sorted(RUNS_DIR.glob("outcomes-*.json"))
    if not files:
        raise SystemExit("no outcomes-*.json in contract/runs/ — run scenario_harness.py first")
    return files[-1]


def build_instrumented(
    outcomes_path: Path, n: int, unchanged_band: float
) -> tuple[dict, list[tuple[str, dict]]]:
    """Load inputs, bin, select, assign personas, compute trigger_t. Returns (payload, selected)."""
    side = json.loads(outcomes_path.read_text(encoding="utf-8"))
    scenario_run_id = side["scenario_run_id"]
    baseline_run_id = side["baseline_run_id"]

    artifact = trajectory_io.load_artifact(RUNS_DIR / f"{scenario_run_id}.json")
    veh_map = {v.id: v for v in artifact.vehicles}  # presence == completed in scenario + has trajectory

    outcomes = [o for o in side["outcomes"] if o["vehicle_id"] in veh_map]
    bins = bin_outcomes(outcomes, unchanged_band)
    take = select_counts(bins, n)

    selected: list[tuple[str, dict]] = []
    for b in BIN_ORDER:
        ordered = sorted(bins[b], key=lambda o: (o["delta_seconds"], o["vehicle_id"]))
        for o in evenly_spaced(ordered, take[b]):
            selected.append((b, o))

    personas: list[PersonaSpec] = load_personas()
    records: list[dict] = []
    for i, (_bin, o) in enumerate(selected):
        persona = personas[i % len(personas)]  # Phase 2: assign personas from real mode/attributes
        v = veh_map[o["vehicle_id"]]
        outcome5 = {k: o[k] for k in OUTCOME_FIELDS}
        Outcome.model_validate(outcome5)  # shape guard — must drop straight into Agent.outcome in 1.4
        records.append(
            {
                "vehicle_id": o["vehicle_id"],
                "persona": persona.model_dump(),
                "outcome": outcome5,
                "trigger_t": worst_moment(v.timestamps, v.speeds),
            }
        )

    payload = {
        "scenario_run_id": scenario_run_id,
        "baseline_run_id": baseline_run_id,
        "n_requested": n,
        "n_selected": len(records),
        "unchanged_band": unchanged_band,
        "selected_bin_counts": take,
        "instrumented": records,
    }
    return payload, selected


def _print_report(payload: dict, selected: list[tuple[str, dict]], out_path: Path) -> None:
    counts = payload["selected_bin_counts"]
    print("\n" + "=" * 64)
    print("INSTRUMENTED-TRAVELER SAMPLE")
    print("=" * 64)
    print(f"scenario run      : {payload['scenario_run_id']}")
    print(f"N requested       : {payload['n_requested']}   selected: {payload['n_selected']}")
    print(f"unchanged band    : +/- {payload['unchanged_band']:.1f} s")
    print(f"selected bin spread: worse {counts['worse']} / unchanged {counts['unchanged']} / better {counts['better']}")
    if counts["worse"] == 0 or counts["better"] == 0:
        print("  WARNING: a winners/losers bin was empty for this run — sample is not a full mix.")
    print("-" * 64)
    print("examples (bin, persona, delta_seconds, trigger_t):")
    records = payload["instrumented"]
    # one example from each bin if possible, else first few
    shown, seen_bins = [], set()
    for (b, _o), rec in zip(selected, records):
        if b not in seen_bins:
            shown.append((b, rec))
            seen_bins.add(b)
    for (b, _o), rec in zip(selected, records):
        if len(shown) >= 5:
            break
        if rec not in [r for _, r in shown]:
            shown.append((b, rec))
    for b, rec in shown[:5]:
        print(
            f"  {b:<9} {rec['persona']['id']:<19} "
            f"delta={rec['outcome']['delta_seconds']:>7.1f}s  trigger_t={rec['trigger_t']:>7.1f}s"
        )
    print("=" * 64)
    print(f"instrumented set  : contract/runs/{out_path.name}")
    print(
        "NOTE: trigger_t is the worst moment in the SCENARIO run (longest stop / lowest speed); "
        "that instant may be a routine red light present in the baseline too, so it is not\n"
        "      necessarily change-attributable. Reaction text is added in Step 1.4."
    )


def main() -> None:
    ap = argparse.ArgumentParser(description="Sample instrumented travelers spanning outcome bins.")
    ap.add_argument("--outcomes", default=None, help="outcomes-*.json (default: newest in contract/runs)")
    ap.add_argument("--n", type=int, default=DEFAULT_N, help="number of instrumented travelers")
    ap.add_argument("--unchanged-band", type=float, default=DEFAULT_BAND, help="|delta| <= band is unchanged")
    args = ap.parse_args()

    outcomes_path = Path(args.outcomes) if args.outcomes else newest_outcomes()
    print(f"[in] outcomes: {outcomes_path.name}")

    payload, selected = build_instrumented(outcomes_path, args.n, args.unchanged_band)

    # Pair the instrumented file with its scenario run (idempotent: re-runs overwrite same file).
    ts = payload["scenario_run_id"].split("-", 1)[1]
    out_path = RUNS_DIR / f"instrumented-{ts}.json"
    out_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    _print_report(payload, selected, out_path)


if __name__ == "__main__":
    main()
