"""V2.1b — the DEMAND-PROFILE registry: which demand a run simulates, and the run parameters that
follow from it. A tiny standalone module (imported by scenario_harness + server) so neither grows a
cycle. The artifact records the profile in meta.demand_profile (contract v0.6.0, REQUIRED).

synthetic_demo        — the small randomTrips demo set (300 cars / 82 bikes / 129 peds). The default;
                        the golden trajectory + Playwright specs pin its behavior. Never capped, never
                        spilled — byte-identical to pre-V2.1b runs.
calibrated_am_peak    — the count-calibrated 07:00-09:00 demand (t=0 == 07:00; ~67k cars + bikes +
                        peds; provenance in data/demand/). The M4 probe measured ~57M recorded steps
                        (~17 GB as Python lists), so this profile records via the spill path and caps
                        the artifact to an outcome-stratified render sample (meta.render_sample);
                        outcomes/conflicts/scorecard stay full-population.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, replace
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[2]
_SCENARIO = _ROOT / "python" / "scenario"

PROFILE_NAMES = ("synthetic_demo", "calibrated_am_peak")


@dataclass(frozen=True)
class DemandProfile:
    name: str
    cfg: Path                      # the sumocfg SUMO loads (net + route files + ped model)
    car_routes: Path               # demand denominators (count_demand / count_persons read these)
    bike_routes: Path
    ped_routes: Path
    max_t: float                   # sim safety ceiling (the drain loop exits earlier when empty)
    render_cap_vehicles: int | None  # None = never cap (synthetic); int = outcome-stratified cap
    render_cap_persons: int | None
    conflict_cap: int | None       # None = never cap; int = severity-stratified conflict render sample
    spill: bool                    # flush-on-departure recording + streaming ped-PET (M4 gate verdict)


PROFILES: dict[str, DemandProfile] = {
    "synthetic_demo": DemandProfile(
        name="synthetic_demo",
        cfg=_SCENARIO / "corridor.multimodal.sumocfg",
        car_routes=_SCENARIO / "corridor.rou.xml",
        bike_routes=_SCENARIO / "corridor.bike.rou.xml",
        ped_routes=_SCENARIO / "corridor.ped.rou.xml",
        max_t=7200.0,              # == the historical MULTIMODAL_MAX_T; behavior unchanged
        render_cap_vehicles=None,
        render_cap_persons=None,
        conflict_cap=None,
        spill=False,
    ),
    "calibrated_am_peak": DemandProfile(
        name="calibrated_am_peak",
        cfg=_SCENARIO / "calibrated" / "corridor.calibrated.am.sumocfg",
        car_routes=_SCENARIO / "calibrated" / "calibrated.am.rou.xml",
        bike_routes=_SCENARIO / "calibrated" / "calibrated.am.bike.rou.xml",
        ped_routes=_SCENARIO / "calibrated" / "calibrated.am.ped.rou.xml",
        max_t=10800.0,             # 2h demand window + 1h drain
        render_cap_vehicles=800,   # V2.1c carry-over: 1500 -> 800 for a shippable artifact (~50 MB target)
        render_cap_persons=800,
        conflict_cap=5000,         # severity-stratified sample (201k raw events ≈ 100 MB otherwise)
        spill=True,
    ),
}


def get_profile(name: str) -> DemandProfile:
    if name not in PROFILES:
        raise KeyError(f"unknown demand profile {name!r} — known: {sorted(PROFILES)}")
    p = PROFILES[name]
    if not p.cfg.is_file():
        raise FileNotFoundError(
            f"demand profile {name!r}: cfg missing at {p.cfg} — "
            + ("run `python python/src/demand_calibration.py full` to build the calibrated demand"
               if name == "calibrated_am_peak" else "scenario files missing"))
    # Debug/smoke knob: bound the sim ceiling (e.g. 3600 = the 07:00-08:00 peak hour only). The
    # truncation is VISIBLE in the artifact (meta.sim_end) and must be labeled in the run description —
    # a full-fidelity calibrated pair crawls for hours at saturation on this box (V2.1b finding).
    override = os.environ.get("NADI_MAX_T_OVERRIDE")
    if override:
        p = replace(p, max_t=float(override))
        print(f"[demand-profiles] NADI_MAX_T_OVERRIDE={override} -> max_t={p.max_t:.0f}s (bounded run)")
    return p


# V2.2a — sim-time rendering for user-facing prose (reactions / report / run descriptions).
# The 07:00 anchor is a property of the DEMAND PROFILE (calibrated_am_peak: t=0 == 07:00, see the
# module docstring), so the helpers live here — synthetic time has no clock meaning and renders
# as plain sim-seconds.
_CLOCK_ANCHOR_MIN = {"calibrated_am_peak": 7 * 60}  # profile -> minutes-since-midnight at t=0


def fmt_sim_time(t_s: float, profile_name: str) -> str:
    """"07:10" for profiles with a clock anchor (calibrated: t=0 == 07:00); "t=600 s" otherwise."""
    anchor = _CLOCK_ANCHOR_MIN.get(profile_name)
    if anchor is None:
        return f"t={t_s:g} s"
    total_min = anchor + int(t_s // 60)
    return f"{(total_min // 60) % 24:02d}:{total_min % 60:02d}"


def fmt_window(window, profile_name: str) -> str:
    """"from 07:10 to 07:40" (calibrated) / "from t=600 s to t=2400 s" (synthetic).
    Accepts the pydantic Window OR its dict form (artifact consumers hold dicts)."""
    if isinstance(window, dict):
        start, end = window["start_s"], window["end_s"]
    else:
        start, end = window.start_s, window.end_s
    return f"from {fmt_sim_time(start, profile_name)} to {fmt_sim_time(end, profile_name)}"
