"""V2.1b M7 — render-sample stratification invariants + the demand-profile registry. Pure (no SUMO run,
no HTTP); imports go through the run_sim wiring only because sibling modules need sumolib present."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "python" / "src"))

try:
    import run_sim  # noqa: F401,E402 — wires SUMO tools; sampler imports trajectory_io
    import demand_profiles  # noqa: E402
    import render_sample as rs  # noqa: E402
except Exception:  # pragma: no cover — SUMO not on this box
    pytest.skip("SUMO/sumolib unavailable (SUMO_HOME unset)", allow_module_level=True)


def _outcomes(prefix: str, deltas: list[float]) -> list[dict]:
    return [{"id": f"{prefix}{i}", "delta_seconds": d} for i, d in enumerate(deltas)]


def _buckets(cars: list[float], bikes: list[float], peds: list[float]) -> dict:
    return {"car": {"outcomes": _outcomes("veh", cars)},
            "bicycle": {"outcomes": _outcomes("bike", bikes)},
            "pedestrian": {"outcomes": _outcomes("ped", peds)}}


def test_small_population_never_capped() -> None:
    b = _buckets([1.0, -2.0, 10.0], [0.5], [3.0, -3.0])
    ids = rs.build_render_sample(b, cap_vehicles=1500, cap_persons=800)
    assert ids == {"veh0", "veh1", "veh2", "bike0", "ped0", "ped1"}


def test_cap_honored_and_tails_guaranteed() -> None:
    cars = [float(d) for d in range(-300, 300)]  # 600 cars, deltas -300..299
    b = _buckets(cars, [1.0] * 20, [0.0] * 50)
    ids = rs.build_render_sample(b, cap_vehicles=120, cap_persons=30)
    veh = {i for i in ids if i.startswith("veh")}
    ped = {i for i in ids if i.startswith("ped")}
    bike = {i for i in ids if i.startswith("bike")}
    assert len(veh) <= 120 and len(ped) <= 30
    assert bike == {f"bike{i}" for i in range(20)}, "few bikes are never crowded out"
    # extreme tails: the k worst (largest delta) and k best (smallest) cars are ALWAYS rendered
    by_delta = sorted(_outcomes("veh", cars), key=lambda o: (o["delta_seconds"], o["id"]))
    for o in by_delta[: rs.TAIL_K]:
        assert o["id"] in veh, "best-tail car missing from the render sample"
    for o in by_delta[-rs.TAIL_K:]:
        assert o["id"] in veh, "worst-tail car missing from the render sample"


def test_deterministic() -> None:
    b = _buckets([float(d) for d in range(-100, 100)], [1.0] * 5, [0.0] * 10)
    assert rs.build_render_sample(b, 60, 8) == rs.build_render_sample(b, 60, 8)


def test_profiles_registry() -> None:
    p = demand_profiles.get_profile("synthetic_demo")
    assert p.max_t == 7200.0 and p.render_cap_vehicles is None and p.spill is False
    with pytest.raises(KeyError):
        demand_profiles.get_profile("nope")
    cal = demand_profiles.PROFILES["calibrated_am_peak"]
    assert cal.spill is True and cal.render_cap_vehicles and cal.max_t == 10800.0
