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

Reaction text is NOT produced here (Step 2.5b). This sidecar is an INTERMEDIATE handoff, not the
frozen contract artifact — ``agents[]`` can't be written until reactions exist (``Agent.reaction`` is
a required schema field).

Step 2.5a adds the MULTI-MODAL path (``main()`` dispatches on ``"modes" in side``): it samples from BOTH
populations of the v0.3.0 artifact — cars/bikes in ``vehicles[]`` (bucket keys ``car``/``bicycle``, pinned
by ``vehicle_id``) and pedestrians in ``persons[]`` (bucket ``pedestrian``, pinned by ``person_id``) — plus
inferred stakeholder voices (``grounding="inferred"``, no pin/outcome/trigger_t). Personas are matched by
``mode``; cars force-include the top-k worst by delta (the hard-hit tail). Every record is validated as a
``contract_models.Agent`` in-run (the 2.3 grounding invariant) before the sidecar is written. The legacy
Phase-1 flat-outcomes (speed_limit) path is preserved.

Run as a script:
    python python/src/sampler.py                       # newest outcomes-*.json (multi-modal auto-detected)
    python python/src/sampler.py --n-car 120 --n-bike 40 --n-ped 40 --n-inferred 12 --car-tail-k 5
    python python/src/sampler.py --n 20 --unchanged-band 10   # legacy flat outcomes
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import trajectory_io
from contract_models import Agent, Outcome, Persona, Reaction
from personas import PersonaSpec, load_personas, personas_by_mode

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


class SpeedsUnavailableError(RuntimeError):
    """V2.6c — a 0.10.0 artifact carries no wire speeds: trigger_t must come from the outcomes
    sidecar's ``worst_t`` (stamped by the harness whenever it drops speeds). Reaching this error
    means the stamp is missing — fail LOUDLY with a named error; a detached subprocess must never
    quietly compute against a missing field."""


def trigger_time_for(o: dict, ent) -> float:
    """The V2.6c dual-path: the sidecar ``worst_t`` (0.10.0 runs) ?? the legacy wire-speeds
    computation. The fallback's vintage boundary is exact — only genuinely old artifacts reach it,
    and they still carry speeds; a new-shape entity without worst_t raises the named backstop."""
    wt = o.get("worst_t")
    if wt is not None:
        return float(wt)
    if ent.speeds is None:
        raise SpeedsUnavailableError(
            f"entity {ent.id!r}: no wire speeds (0.10.0 artifact) and no worst_t in the outcomes "
            "sidecar — the harness must stamp worst_t whenever it drops speeds")
    return worst_moment(ent.timestamps, ent.speeds)


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
                "trigger_t": trigger_time_for(o, v),
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


# ======================================================================================
# Phase 2.5a — multi-modal sampler (cars + bikes in vehicles[], peds in persons[]) + inferred voices
# ======================================================================================

SIM_MODES = ("car", "bicycle", "pedestrian")
MODE_PIN = {"car": "vehicle_id", "bicycle": "vehicle_id", "pedestrian": "person_id"}
_DUMMY_REACTION = {"comment": "x", "sentiment": 0.0, "stance": "neutral"}  # only for the in-run Agent guard


def _select_mode(bins: dict[str, list[dict]], n: int, tail_k: int) -> dict[str, list[dict]]:
    """Pick up to n outcomes spanning bins. For cars (tail_k>0), ALWAYS force-include the top-k worst by
    delta (the hard-hit tail — the panel's most important voices), then select/space the rest. Returns
    {bin: [outcomes]} with the tail prepended into 'worse'."""
    worse_desc = sorted(bins["worse"], key=lambda o: o["delta_seconds"], reverse=True)
    tail = worse_desc[:tail_k]
    tail_ids = {o["id"] for o in tail}
    rem = {b: [o for o in bins[b] if o["id"] not in tail_ids] for b in BIN_ORDER}
    take = select_counts(rem, max(0, n - len(tail)))
    per_bin: dict[str, list[dict]] = {}
    for b in BIN_ORDER:
        ordered = sorted(rem[b], key=lambda o: (o["delta_seconds"], o["id"]))
        picks = evenly_spaced(ordered, take[b])
        per_bin[b] = (list(tail) + picks) if b == "worse" else picks
    return per_bin


def _interleave(per_bin: dict[str, list[dict]]) -> list[tuple[str, dict]]:
    """Round-robin across bins (worse/unchanged/better) so round-robin persona assignment doesn't track
    the delta sort. Returns [(bin, outcome)]. (Naive persona↔outcome correlation is a Phase-3 refinement.)"""
    from itertools import zip_longest

    seq: list[tuple[str, dict]] = []
    for triple in zip_longest(per_bin["worse"], per_bin["unchanged"], per_bin["better"]):
        for b, o in zip(BIN_ORDER, triple):
            if o is not None:
                seq.append((b, o))
    return seq


def _validate_records_as_agents(records: list[dict]) -> None:
    """LOAD-BEARING: construct a throwaway Agent per record (trimmed persona + dummy reaction) to prove
    every record satisfies the frozen grounding invariant (sim ⇒ exactly one id + outcome + trigger_t;
    inferred ⇒ none; mandate ⇒ mandate block + facts, validated structurally — citations are composed
    at reactions time) BEFORE 2.5b builds ~200 real Agents from this sidecar. Raises on any violation."""
    for r in records:
        p = r["persona"]
        if r["grounding"] == "mandate":
            # citations don't exist yet (reactions composes them from the baked facts) — validate the
            # mandate structurally here; the full Agent invariant fires at build_agent time.
            if not r.get("mandate") or not all(
                r["mandate"].get(k) for k in ("institution", "mission", "source", "retrieved")
            ):
                raise ValueError(f"mandate record {p.get('id')!r} missing a complete mandate block")
            if not r.get("facts"):
                raise ValueError(f"mandate record {p.get('id')!r} has no baked facts (no facts -> no voice)")
            continue
        kw: dict = {"grounding": r["grounding"], "persona": Persona(id=p["id"], label=p["label"]),
                    "reaction": Reaction(**_DUMMY_REACTION)}
        if r["grounding"] == "sim":
            if "vehicle_id" in r:
                kw["vehicle_id"] = r["vehicle_id"]
            if "person_id" in r:
                kw["person_id"] = r["person_id"]
            kw["outcome"] = Outcome(**r["outcome"])
            kw["trigger_t"] = r["trigger_t"]
        Agent(**kw)  # pydantic ValidationError if the invariant is violated


def build_instrumented_multimodal(outcomes_path: Path, counts: dict[str, int], unchanged_band: float,
                                  car_tail_k: int) -> dict:
    """Sample instrumented travelers from BOTH populations of the multi-modal v0.3.0 artifact + the
    per-mode outcomes sidecar, plus inferred stakeholder voices. Returns the instrumented payload."""
    side = json.loads(outcomes_path.read_text(encoding="utf-8"))
    scenario_run_id, baseline_run_id = side["scenario_run_id"], side["baseline_run_id"]

    artifact = trajectory_io.load_artifact(RUNS_DIR / f"{scenario_run_id}.json")
    entity = {v.id: v for v in artifact.vehicles}  # cars + bikes
    entity.update({p.id: p for p in artifact.persons})  # peds (distinct id space)
    by_mode = personas_by_mode()

    records: list[dict] = []
    selected_bin_counts: dict[str, dict[str, int]] = {}
    for mode in SIM_MODES:
        outs = [o for o in side["modes"][mode]["outcomes"] if o["id"] in entity]
        bins = bin_outcomes(outs, unchanged_band)  # keys on o["delta_seconds"]
        per_bin = _select_mode(bins, counts[mode], car_tail_k if mode == "car" else 0)
        selected_bin_counts[mode] = {b: len(per_bin[b]) for b in BIN_ORDER}
        pool, pin = by_mode.get(mode, []), MODE_PIN[mode]
        for i, (_b, o) in enumerate(_interleave(per_bin)):  # interleaved → persona doesn't track delta
            persona = pool[i % len(pool)]
            ent = entity[o["id"]]
            outcome5 = {k: o[k] for k in OUTCOME_FIELDS}
            Outcome.model_validate(outcome5)  # shape guard — drops straight into Agent.outcome in 2.5b
            records.append({
                "grounding": "sim", "mode": mode, pin: o["id"],
                "persona": persona.model_dump(), "outcome": outcome5,
                "trigger_t": trigger_time_for(o, ent),
            })

    inferred = by_mode.get("inferred", [])
    for i in range(counts["inferred"]):  # ~12 inferred voices, round-robin (no pin/outcome/trigger_t)
        persona = inferred[i % len(inferred)]
        records.append({
            "grounding": "inferred", "mode": "inferred",
            "persona": persona.model_dump(), "stakeholder": persona.stakeholder,
        })

    # V2.3c — mandate-grounded institutional voices, gated on the sidecar facts THIS run computed
    # (no facts -> no voice; never pads). Appended AFTER inferred — index stability for the
    # client-side agents[] index convention. The relevant sidecar subsets are BAKED into the record
    # (this stage already holds the sidecar; reactions stays sidecar-free and composes the prose).
    import institutions
    for entry, facts in institutions.speaking_institutions(side):
        records.append({
            "grounding": "mandate", "mode": "mandate",
            "persona": {"id": entry["id"], "label": entry["label"]},
            "mandate": dict(entry["mandate"]),  # VERBATIM — never reworded (byte-identity pinned)
            "mission_clause": entry["mission_clause"],
            "cites": list(entry.get("cites", [])),
            "facts": facts,
        })

    _validate_records_as_agents(records)  # fail here, not 200 LLM calls deep in 2.5b
    return {
        "scenario_run_id": scenario_run_id, "baseline_run_id": baseline_run_id,
        "requested": counts, "unchanged_band": unchanged_band,
        "selected_bin_counts": selected_bin_counts, "instrumented": records,
    }


def _print_report_multimodal(payload: dict, out_path: Path) -> None:
    by_mode = personas_by_mode()
    recs = payload["instrumented"]
    print("\n" + "=" * 74)
    print("INSTRUMENTED MULTI-MODAL SAMPLE")
    print("=" * 74)
    print(f"scenario run : {payload['scenario_run_id']}   requested: {payload['requested']}")
    mand = [r for r in recs if r.get("grounding") == "mandate"]
    if mand:
        print(f"institutional (mandate-grounded, facts-gated): {len(mand)} — "
              + ", ".join(r["persona"]["id"] for r in mand))
    print("roster (16 personas):")
    for m in ("car", "bicycle", "pedestrian", "inferred"):
        print(f"  {m:11}: " + ", ".join(p.label for p in by_mode.get(m, [])))
    print("-" * 74)
    print("realized mode x outcome-bin counts (sign band ±{:.0f}s; empty bike/ped 'worse' expected — "
          "their time deltas are ~0):".format(payload["unchanged_band"]))
    print(f"  {'mode':<12} {'worse':>6} {'unchanged':>10} {'better':>7} {'total':>6}")
    for mode in SIM_MODES:
        c = payload["selected_bin_counts"][mode]
        tot = c["worse"] + c["unchanged"] + c["better"]
        flag = "  (worse empty — expected)" if c["worse"] == 0 and mode != "car" else ""
        if mode == "car" and c["worse"] == 0:
            flag = "  WARNING: car worse bin empty (unexpected)"
        print(f"  {mode:<12} {c['worse']:>6} {c['unchanged']:>10} {c['better']:>7} {tot:>6}{flag}")
    n_inf = sum(1 for r in recs if r["grounding"] == "inferred")
    print(f"  {'inferred':<12} {'—':>6} {'—':>10} {'—':>7} {n_inf:>6}")
    print("-" * 74)
    print("examples — one sim per mode + 2 inferred:")
    for mode in SIM_MODES:
        r = next((x for x in recs if x.get("mode") == mode), None)
        if r:
            pid = r.get("vehicle_id") or r.get("person_id")
            print(f"  [{mode:<10}] {r['persona']['id']:<19} pin={pid:<8} "
                  f"delta={r['outcome']['delta_seconds']:>7.1f}s  trigger_t={r['trigger_t']:>7.1f}s")
    for r in [x for x in recs if x["grounding"] == "inferred"][:2]:
        print(f"  [inferred  ] {r['persona']['id']:<19} stakeholder={r['stakeholder']}  (no pin/outcome/trigger_t)")
    print("=" * 74)
    print(f"instrumented set : contract/runs/{out_path.name}   (feeds 2.5b reactions -> ~{len(recs)} agents)")


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
    ap.add_argument("--unchanged-band", type=float, default=DEFAULT_BAND, help="|delta| <= band is unchanged")
    ap.add_argument("--n", type=int, default=DEFAULT_N, help="legacy (flat outcomes) sample size")
    # multi-modal per-mode counts:
    ap.add_argument("--n-car", type=int, default=120)
    ap.add_argument("--n-bike", type=int, default=40)
    ap.add_argument("--n-ped", type=int, default=40)
    ap.add_argument("--n-inferred", type=int, default=12)
    ap.add_argument("--car-tail-k", type=int, default=5, help="force-include the top-k worst drivers by delta")
    args = ap.parse_args()

    outcomes_path = Path(args.outcomes) if args.outcomes else newest_outcomes()
    print(f"[in] outcomes: {outcomes_path.name}")
    side = json.loads(outcomes_path.read_text(encoding="utf-8"))

    if "modes" in side:  # Phase-2 multi-modal outcomes sidecar
        counts = {"car": args.n_car, "bicycle": args.n_bike, "pedestrian": args.n_ped, "inferred": args.n_inferred}
        payload = build_instrumented_multimodal(outcomes_path, counts, args.unchanged_band, args.car_tail_k)
        ts = payload["scenario_run_id"].split("-")[-1]
        out_path = RUNS_DIR / f"instrumented-{ts}.json"
        out_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        _print_report_multimodal(payload, out_path)
        return

    # Legacy Phase-1 flat-outcomes path (speed_limit harness) — unchanged.
    payload, selected = build_instrumented(outcomes_path, args.n, args.unchanged_band)
    ts = payload["scenario_run_id"].split("-", 1)[1]
    out_path = RUNS_DIR / f"instrumented-{ts}.json"
    out_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    _print_report(payload, selected, out_path)


if __name__ == "__main__":
    main()
