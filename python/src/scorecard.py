"""Phase 2.4b — compute the per-STAKEHOLDER scorecard and inject it into the v0.3.0 artifact.

Post-processes the 2.4a outputs IN PLACE (no re-run): reads the real ``multimodal-scenario-<ts>.json``
artifact (scenario conflicts live in its ``conflicts[]``), the matching ``outcomes-<ts>.json`` (per-mode
travel-time deltas) and ``conflicts-baseline-<ts>.json`` sidecars, computes ``scorecard``, and rewrites
the SAME artifact path (re-validated) + recopies to web/public.

HONESTY (see CLAUDE.md — preview, not verdict):
  - travel_time & safety on SIM groups (car_commuter/cyclist/pedestrian) are MEASURED from the sim.
  - local_resident safety is ESTIMATED (inferred — the corridor-wide conflict change).
  - the ENTIRE access column is a HEURISTIC ESTIMATE for every group (grounding can't flag this
    per-column, so we say it plainly). Coarse ordinals, not false precision.
  - safety_delta is a dimensionless severity-sum delta (a relative aggregate) — NOT a crash count,
    rate, or seconds. bca stays null (no cost model for a runtime lane change).
Uniform sign everywhere: POSITIVE = WORSE for the group. null cell = no signal / not applicable.

Run:  python python/src/scorecard.py            # newest multimodal-scenario run
      python python/src/scorecard.py --run-id multimodal-scenario-20260702T044134Z
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "python" / "src"))
import trajectory_io  # noqa: E402
from contract_models import CellRange, Scorecard, ScorecardCell, ScorecardGroup, changes_of_scenario  # noqa: E402

RUNS_DIR = trajectory_io.RUNS_DIR
WEB_PUBLIC = ROOT / "web" / "public"

# The scorecard's affected_share now uses a MATERIAL cutoff: a traveler >30 s slower is meaningfully hit.
# (The 0.5 s "loser" threshold gave a near-noise 36% for cars that collapsed to ~3% at >30 s — the honest
# concentration story is a small hard-hit tail, majority unaffected. 2.5-close-out re-labels to this.)
MATERIALITY_CUTOFF_S = 30.0
# Robustness caveat baked into the safety cells: the precursor showed every per-group safety-delta sign
# flips across seeds 42/43/44 — the number is a magnitude, NOT a directional claim.
_SAFETY_NOTE = "sign not stable across seeds 42/43/44; directional claim not supported"

# The seven canonical groups: three sim-grounded (have trips) + four inferred (no simulated trip).
SIM_GROUPS = ("car_commuter", "cyclist", "pedestrian")
INFERRED_GROUPS = ("local_resident", "business_owner", "accessibility", "transit_riders")
_MODE_TO_GROUP = {"car": "car_commuter", "bicycle": "cyclist", "pedestrian": "pedestrian"}

# access_delta HEURISTIC per change type (coarse ordinals; POSITIVE = worse access). ESTIMATED, not measured.
# Groups omitted here (and all groups for unmodelled change types) get a null access cell — honest.
_ACCESS_HEURISTIC = {
    "bike_lane": {
        "car_commuter": 0.33,   # loses ~1 of 3 car lanes (lost-lane fraction — the defensible one)
        "cyclist": -1.0,        # gains a protected lane (better)
        "pedestrian": -0.1,     # marginally better (buffer from traffic)
        "business_owner": 0.5,  # loses curbside (coarse ordinal, not precise)
    },
    # 5.1: a new_road adds a route option — drivers gain access (NEGATIVE = better). We do NOT reuse the
    # bike_lane rules (a different change). Every other group is honestly null-with-note (no heuristic yet).
    "new_road": {
        "car_commuter": -0.5,   # a new through-route improves driver connectivity
    },
    # V2.2a: a lane_closure narrows the road for cars (positive = worse). Other groups: no heuristic.
    "lane_closure": {
        "car_commuter": 0.5,    # coarse ordinal — capacity removed on the target edge
    },
}
# change types whose non-heuristic'd groups render a NULL cell WITH the given note (vs an absent cell).
# road_closure: severed/closed — an "access" ordinal for a road that is closed is not meaningful.
_NULL_WITH_NOTE = {
    "new_road": "no access heuristic for this change type yet",
    "road_closure": "road severed/closed — access heuristic not meaningful",
}


def _group_of_entity(eid: str) -> str:
    s = str(eid)
    if s.startswith("ped"):
        return "pedestrian"
    if s.startswith("bike"):
        return "cyclist"
    return "car_commuter"


def _travel_cell(outcomes: list[dict]) -> ScorecardCell | None:
    """MEASURED. Central value = median per-traveler delta; affected_share = fraction MATERIALLY hit
    (>MATERIALITY_CUTOFF_S slower). Median-near-0 + a small material share is the honest concentration
    story — a small hard-hit tail, majority unaffected."""
    deltas = [o["delta_seconds"] for o in outcomes]
    if not deltas:
        return None
    share = sum(1 for d in deltas if d > MATERIALITY_CUTOFF_S) / len(deltas)
    return ScorecardCell(
        value=round(statistics.median(deltas), 3), affected_share=round(share, 3),
        confidence="measured", note=f"affected_share = fraction of this group's travelers >{MATERIALITY_CUTOFF_S:.0f}s slower",
    )


def _severity_sums(conflicts: list[dict]) -> dict[str, float]:
    """Sum of conflict severity per group (a conflict counts for EVERY group it involves — a car-bike
    conflict is a real risk event for both) plus an 'overall' corridor total."""
    agg = {g: 0.0 for g in ("car_commuter", "cyclist", "pedestrian", "overall")}
    for c in conflicts:
        sev = float(c.get("severity", 0.0))
        agg["overall"] += sev
        for g in {_group_of_entity(e) for e in c.get("entities", [])}:
            agg[g] += sev
    return agg


def compute_scorecard(buckets: dict, base_conflicts: list[dict], scen_conflicts: list[dict],
                      changes: list[dict], demand_profile: str = "synthetic_demo",
                      conflict_sample_of: int | None = None) -> Scorecard:
    """Assemble the 7-group scorecard. ``buckets`` = outcomes['modes']; conflicts are lists of dicts.
    ``changes`` is the v0.5.0 change list (a single-change scenario is a list of one → identical output).

    V2.1b: at calibrated demand the safety cells carry a demand-conditional honesty note (Read 2:
    the surrogate is queue-dominated at peak density); ``conflict_sample_of`` (the FULL observed count,
    passed only when the artifact's conflict stream was capped) appends the sample disclosure so the
    map legend's sample count never reads as the population. Synthetic runs are byte-unchanged."""
    # travel_time (MEASURED, sim groups only)
    tt = {g: _travel_cell(buckets.get(mode, {}).get("outcomes", [])) for mode, g in _MODE_TO_GROUP.items()}

    # safety = Δ severity-sum (scenario − baseline). Sim groups MEASURED; local_resident = overall ESTIMATED.
    base_s, scen_s = _severity_sums(base_conflicts), _severity_sums(scen_conflicts)

    safety_note = _SAFETY_NOTE
    if demand_profile == "calibrated_am_peak":
        safety_note += (
            ". At peak density, safety surrogates are dominated by queue interactions; raw conflict "
            "counts are not comparable across demand profiles, and pedestrian conflicts are "
            "proportionally under-represented relative to vehicle car-following events"
        )
        if conflict_sample_of is not None:
            safety_note += (f". Conflict stream in the artifact is a severity-stratified sample of "
                            f"{conflict_sample_of} observed events")

    def safety_cell(key: str) -> ScorecardCell:
        # confidence LOW: the sign flips across seeds (precursor) — a magnitude, not a directional claim.
        return ScorecardCell(value=round(scen_s[key] - base_s[key], 3), confidence="low", note=safety_note)

    def access_cell(group: str) -> ScorecardCell | None:
        # v0.5.0 composite: collect this group's access heuristic across every change in the scenario.
        # confidence LOW: the entire access column is a rule-based heuristic, not measured.
        contrib_changes = [c for c in changes if group in _ACCESS_HEURISTIC.get(c.get("type"), {})]
        if len(contrib_changes) == 1:
            c = contrib_changes[0]
            note = "rule-based estimate"
            # V2.2a time-scoped honesty: a WINDOWED closure's access claim must not render identically
            # to a permanent one — the estimate applies only while the closure is active.
            if c.get("type") in ("lane_closure", "road_closure") and c.get("window"):
                note += "; applies during the closure window"
            return ScorecardCell(value=_ACCESS_HEURISTIC[c["type"]][group], confidence="low", note=note)
        if len(contrib_changes) > 1:  # honest: don't silently sum overlapping heuristics across composed changes
            return ScorecardCell(value=None, confidence="low",
                                 note=f"composite scenario ({len(changes)} changes) — per-group access not separable yet")
        for c in changes:  # null magnitude WITH a per-type note, not silently-absent
            if c.get("type") in _NULL_WITH_NOTE:
                return ScorecardCell(value=None, confidence="low", note=_NULL_WITH_NOTE[c["type"]])
        return None

    groups = [
        ScorecardGroup(group="car_commuter", grounding="sim", travel_time_delta=tt["car_commuter"],
                       safety_delta=safety_cell("car_commuter"), access_delta=access_cell("car_commuter")),
        ScorecardGroup(group="cyclist", grounding="sim", travel_time_delta=tt["cyclist"],
                       safety_delta=safety_cell("cyclist"), access_delta=access_cell("cyclist")),
        ScorecardGroup(group="pedestrian", grounding="sim", travel_time_delta=tt["pedestrian"],
                       safety_delta=safety_cell("pedestrian"), access_delta=access_cell("pedestrian")),
        ScorecardGroup(group="local_resident", grounding="inferred", travel_time_delta=None,
                       safety_delta=safety_cell("overall"), access_delta=access_cell("local_resident")),
        ScorecardGroup(group="business_owner", grounding="inferred", travel_time_delta=None,
                       safety_delta=None, access_delta=access_cell("business_owner")),
        ScorecardGroup(group="accessibility", grounding="inferred", travel_time_delta=None,
                       safety_delta=None, access_delta=access_cell("accessibility")),
        ScorecardGroup(group="transit_riders", grounding="inferred", travel_time_delta=None,
                       safety_delta=None, access_delta=access_cell("transit_riders")),
    ]
    return Scorecard(groups=groups, bca=None)  # bca null for v0 — the distribution is the point


# ---- V2.1d: cross-seed ranges (contract v0.8.0) -------------------------------------------------
# Only these two fields get ranges. Access is a deterministic heuristic — identical across seeds by
# construction, so a [x,x] range would imply MEASURED stability it doesn't have. Excluded on purpose.
RANGED_FIELDS = ("travel_time_delta", "safety_delta")

# The settled-run range-semantics disclosure (the cars_only lesson: scope limitations ride the
# artifact, not a docstring). Appended to every ranged cell's note on a settled run.
_SETTLED_RANGE_NOTE = ("ranges hold the settled routes fixed (simulation stochasticity, "
                       "not assignment seed-sensitivity)")


def _probe_value(probe: Scorecard, group: str, field: str) -> float | None:
    g = next((pg for pg in probe.groups if pg.group == group), None)
    cell = getattr(g, field, None) if g is not None else None
    return cell.value if cell is not None else None


def attach_ranges(canonical: Scorecard, probes: list[Scorecard], seeds: list[int],
                  *, settled: bool = False) -> dict:
    """Attach CellRange to the canonical scorecard's travel/safety cells from probe scorecards.

    The CANONICAL (seed-42) cells' value/affected_share/confidence are NEVER touched — seed 42 IS
    the artifact (V1 robustness convention: no cross-seed central aggregate). Per group x field the
    range spans [canonical] + probe values (all already 3dp-rounded by compute_scorecard, so
    min <= value <= max holds exactly). A probe cell that is None (or value None) is EXCLUDED; if
    fewer than 2 values remain, NO range is attached — we don't claim robustness we didn't measure.
    sign_stable = False iff the values STRICTLY straddle zero (a 0.0 endpoint doesn't flip it).
    ``settled`` appends the fixed-routes semantics disclosure to every ranged cell's note.
    Returns the per-seed provenance dict ({group: {field: {seed: value}}}) for the outcomes sidecar
    (and for ``attach_ranges_from_sidecar`` to rebuild ranges idempotently on recompute)."""
    values: dict[str, dict[str, dict[str, float]]] = {}
    for g in canonical.groups:
        for field in RANGED_FIELDS:
            cell = getattr(g, field)
            if cell is None or cell.value is None:
                continue
            per_seed = {str(seeds[0]): cell.value}
            for seed, probe in zip(seeds[1:], probes):
                pv = _probe_value(probe, g.group, field)
                if pv is not None:
                    per_seed[str(seed)] = pv
            if len(per_seed) < 2:
                continue
            values.setdefault(g.group, {})[field] = per_seed
    _apply_ranges(canonical, values, settled=settled)
    return values


def attach_ranges_from_sidecar(sc: Scorecard, seed_cells: dict, seeds_meta: dict | None) -> None:
    """Rebuild ranges from the outcomes sidecar's stored per-seed values — the recompute path
    (``main()``). Without this, re-running scorecard.py on a multi-seed artifact would silently
    DROP its ranges (the probe tripinfos may be long gone)."""
    _apply_ranges(sc, seed_cells, settled=(seeds_meta or {}).get("basis") == "settled_fixed_routes")


def _apply_ranges(sc: Scorecard, values: dict, *, settled: bool) -> None:
    for g in sc.groups:
        for field, per_seed in (values.get(g.group) or {}).items():
            cell = getattr(g, field, None)
            if cell is None or cell.value is None:
                continue
            vs = list(per_seed.values())
            lo, hi = min(vs), max(vs)
            cell.range = CellRange(min=lo, max=hi, n_seeds=len(vs), sign_stable=not (lo < 0 < hi))
            seed_list = ", ".join(sorted(per_seed, key=int))
            if field == "safety_delta":
                # EARNED note: this run measured its own stability — the V1 clause is replaced by
                # what the seeds actually showed; the calibrated/sample suffixes survive verbatim.
                earned = (
                    f"sign flips across seeds {seed_list} in this run; directional claim not supported"
                    if not cell.range.sign_stable else
                    f"sign consistent across seeds {seed_list} in this run; still reported as "
                    f"magnitude only (a {len(vs)}-seed probe, not proof of direction)"
                )
                old = cell.note or ""
                cell.note = earned + old.removeprefix(_SAFETY_NOTE)
            elif not cell.range.sign_stable:
                appendix = "sign not stable across seeds this run — magnitude only"
                cell.note = f"{cell.note}; {appendix}" if cell.note else appendix
            if settled:
                cell.note = f"{cell.note}; {_SETTLED_RANGE_NOTE}" if cell.note else _SETTLED_RANGE_NOTE


def _resolve(run_id: str | None) -> tuple[Path, str]:
    if run_id:
        art = RUNS_DIR / f"{run_id}.json"
        if not art.is_file():
            raise SystemExit(f"artifact not found: {art}")
    else:
        runs = sorted(RUNS_DIR.glob("multimodal-scenario-*.json"))
        if not runs:
            raise SystemExit("no multimodal-scenario-*.json in contract/runs/ — run scenario_harness.py (2.4a) first.")
        art = runs[-1]
    ts = art.stem.replace("multimodal-scenario-", "")
    return art, ts


def _fmt_cell(cell) -> str:
    if cell is None:
        return "—"
    tag = {"measured": "MEAS", "low": "LOW"}.get(cell.confidence, "?")
    share = f", {cell.affected_share:.0%} affected" if cell.affected_share is not None else ""
    return f"{cell.value:+.2f}{share} [{tag}]"


def main() -> None:
    ap = argparse.ArgumentParser(description="Compute + inject the per-stakeholder scorecard (2.4b).")
    ap.add_argument("--run-id", default=None, help="artifact stem (default: newest multimodal-scenario)")
    args = ap.parse_args()

    art_path, ts = _resolve(args.run_id)
    outcomes = json.loads((RUNS_DIR / f"outcomes-{ts}.json").read_text(encoding="utf-8"))
    baseline = json.loads((RUNS_DIR / f"conflicts-baseline-{ts}.json").read_text(encoding="utf-8"))
    raw_art = json.loads(art_path.read_text(encoding="utf-8"))

    # GUARD: never cross-wire runs — the outcomes sidecar must describe THIS artifact.
    if outcomes.get("scenario_run_id") != raw_art["meta"]["run_id"]:
        raise SystemExit(
            f"run-id mismatch: outcomes.scenario_run_id={outcomes.get('scenario_run_id')!r} != "
            f"artifact.meta.run_id={raw_art['meta']['run_id']!r}"
        )

    # V2.1b: a CAPPED artifact carries a severity-stratified conflict SAMPLE — the full scenario set
    # lives in the conflicts-scenario sidecar (symmetric with conflicts-baseline). Prefer it so the
    # safety deltas stay full-population; older/uncapped runs fall back to the artifact's own list.
    scen_sidecar = RUNS_DIR / f"conflicts-scenario-{ts}.json"
    if scen_sidecar.is_file():
        scen_conflicts = json.loads(scen_sidecar.read_text(encoding="utf-8"))["conflicts"]
    else:
        scen_conflicts = raw_art["conflicts"]
    sample_of = len(scen_conflicts) if len(raw_art["conflicts"]) < len(scen_conflicts) else None

    scorecard = compute_scorecard(
        outcomes["modes"], baseline["conflicts"], scen_conflicts,
        changes_of_scenario(raw_art["meta"]["scenario"]),
        demand_profile=raw_art["meta"].get("demand_profile", "synthetic_demo"),
        conflict_sample_of=sample_of,
    )
    # V2.1d: a multi-seed run's sidecar carries per-seed cell values — re-attach the ranges, else
    # this recompute would silently DROP them (the probe tripinfos may be gone).
    if outcomes.get("seed_cells"):
        attach_ranges_from_sidecar(scorecard, outcomes["seed_cells"], outcomes.get("seeds"))

    # Inject + re-validate (dump_artifact validates against the frozen schema on write).
    artifact = trajectory_io.load_artifact(art_path)
    artifact.scorecard = scorecard
    trajectory_io.dump_artifact(artifact, path=art_path)
    reloaded = trajectory_io.load_artifact(art_path)  # round-trip proof
    (WEB_PUBLIC / art_path.name).write_text(art_path.read_text(encoding="utf-8"), encoding="utf-8")
    # 2.6a: also write a STABLE alias so the frontend can hard-code /latest.json instead of a brittle
    # timestamped filename. scorecard.py is the pipeline's final web/public writer, so latest.json here
    # always mirrors the fully-assembled + scorecard-injected artifact.
    (WEB_PUBLIC / "latest.json").write_text(art_path.read_text(encoding="utf-8"), encoding="utf-8")

    # ---- report ----
    print("=" * 92)
    print(f"PER-STAKEHOLDER SCORECARD — {art_path.name}   (sign: POSITIVE = worse; — = null/N.A.)")
    print(f"  affected_share threshold: traveler > {MATERIALITY_CUTOFF_S:.0f}s slower  |  bca: null (v0)")
    print("-" * 92)
    print(f"  {'group':<15} {'grnd':<9} {'travel_time':<26} {'safety':<16} {'access':<14}")
    for g in reloaded.scorecard.groups:
        print(f"  {g.group:<15} {g.grounding:<9} "
              f"{_fmt_cell(g.travel_time_delta):<26} "
              f"{_fmt_cell(g.safety_delta):<16} "
              f"{_fmt_cell(g.access_delta):<14}")
    print("-" * 92)
    print("  [MEAS] = measured from the sim | [LOW] = low confidence (heuristic / not seed-robust).")
    print("  The ENTIRE access column is a heuristic estimate (all groups). SAFETY signs flip across")
    print("  seeds 42/43/44 — a magnitude, not a directional claim; values are a dimensionless")
    print("  severity-sum delta (a relative aggregate), never a crash count/rate.")
    print("=" * 92)
    car = next(g for g in reloaded.scorecard.groups if g.group == "car_commuter")
    print(f"[car concentration] median {car.travel_time_delta.value:+.1f}s but "
          f"{car.travel_time_delta.affected_share:.0%} adversely affected — a concentrated cost, not 'no effect'.")
    print(f"[artifact] scorecard injected + validated ({len(reloaded.scorecard.groups)} groups) -> "
          f"contract/runs/{art_path.name} (+ web/public copy + web/public/latest.json alias)")


if __name__ == "__main__":
    main()
