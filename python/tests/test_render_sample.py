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


def test_max_t_override_env(monkeypatch) -> None:
    monkeypatch.delenv("NADI_MAX_T_OVERRIDE", raising=False)
    assert demand_profiles.get_profile("synthetic_demo").max_t == 7200.0  # absent -> untouched
    monkeypatch.setenv("NADI_MAX_T_OVERRIDE", "3600")
    assert demand_profiles.get_profile("synthetic_demo").max_t == 3600.0
    assert demand_profiles.PROFILES["synthetic_demo"].max_t == 7200.0, "registry itself never mutates"


def test_profiles_registry() -> None:
    p = demand_profiles.get_profile("synthetic_demo")
    assert p.max_t == 7200.0 and p.render_cap_vehicles is None and p.spill is False
    with pytest.raises(KeyError):
        demand_profiles.get_profile("nope")
    cal = demand_profiles.PROFILES["calibrated_am_peak"]
    assert cal.spill is True and cal.render_cap_vehicles and cal.max_t == 10800.0


def _bimodal_conflicts(n: int = 20000) -> list[dict]:
    """A fixture mirroring the Read-2 calibrated TTC distribution: a hard-conflict mode (severity ~0.7)
    and a dominant soft mode near the threshold (severity ~0.15). Seeded RNG — deterministic."""
    import random

    rng = random.Random(7)
    out = []
    for i in range(n):
        if rng.random() < 0.6:
            sev = min(0.999, max(0.0, rng.gauss(0.15, 0.06)))  # soft mode (near-threshold)
        else:
            sev = min(0.999, max(0.0, rng.gauss(0.70, 0.10)))  # hard mode
        out.append({"t": float(i % 3600), "lon": -79.2 + (i % 97) * 1e-4, "lat": 43.75 + (i % 89) * 1e-4,
                    "type": "rear_end", "severity": round(sev, 3), "entities": [f"veh{i}", f"veh{i+1}"]})
    return out


def test_stratify_conflicts_uncapped_identity() -> None:
    conflicts = _bimodal_conflicts(300)
    assert rs.stratify_conflicts(conflicts, None) is conflicts
    assert rs.stratify_conflicts(conflicts, 300) is conflicts
    assert rs.stratify_conflicts(conflicts, 5000) is conflicts  # below cap -> untouched


def test_stratify_conflicts_preserves_band_shape() -> None:
    """THE distribution test: a capped set's severity-band shares match the full set's within ±0.02
    absolute — never truncate/keep-worst-N (that erases the soft-mode mass; Read 2)."""
    full = _bimodal_conflicts(20000)
    cap = 2000
    capped = rs.stratify_conflicts(full, cap)
    assert len(capped) == cap

    def band_shares(cs):
        bands = [0] * 10
        for c in cs:
            bands[min(9, int(c["severity"] * 10))] += 1
        return [b / len(cs) for b in bands]

    # the extreme tail is guaranteed: every one of the top-100 by severity is in the capped set
    top = sorted(full, key=lambda c: (-c["severity"], c["t"], c["lon"], c["lat"]))[:rs.CONFLICT_TAIL_K]
    top_keys = {(c["t"], c["lon"], c["lat"], c["severity"]) for c in top}
    capped_keys = {(c["t"], c["lon"], c["lat"], c["severity"]) for c in capped}
    assert top_keys <= capped_keys, "extreme tail dropped"

    # shape preserved on the PROPORTIONAL portion (the guaranteed tail intentionally over-weights the
    # top band at small caps — compare tail-less capped vs top100-less full, apples to apples)
    full_rest = [c for c in full if (c["t"], c["lon"], c["lat"], c["severity"]) not in top_keys]
    capped_rest = [c for c in capped if (c["t"], c["lon"], c["lat"], c["severity"]) not in top_keys]
    fs, cs_ = band_shares(full_rest), band_shares(capped_rest)
    for i, (a, b) in enumerate(zip(fs, cs_)):
        assert abs(a - b) <= 0.02, f"band {i}: full {a:.3f} vs capped {b:.3f} — shape not preserved"
    # and the OVERALL shape (tail included) stays recognizably bimodal: loose end-to-end bound
    for i, (a, b) in enumerate(zip(band_shares(full), band_shares(capped))):
        assert abs(a - b) <= 0.06, f"band {i}: overall shape drifted (full {a:.3f} vs capped {b:.3f})"

    # deterministic (no RNG in the sampler)
    again = rs.stratify_conflicts(full, cap)
    assert capped == again


def test_spill_recorder_roundtrip_and_streaming_pet(tmp_path) -> None:
    """SpillRecorder without TraCI: record -> departure flush -> selective read-back, and the streaming
    ped-PET catches a fabricated crossing (vehicle passes the ped's path ~1s later at the same point)."""
    import scenario_harness as sh

    rec = sh.SpillRecorder(tmp_path / "spill.jsonl", convert=lambda x, y: (x / 1000.0, y / 1000.0))
    # the ped WAITS at a signal for 50 steps first — waiting must NOT bloat the cell index (the
    # zero-movement pile-up was the hot-loop that drowned the first calibrated runs)
    for t in range(-50, 0):
        rec.record("ped0", "pedestrian", 50.0, 0.0, 0.0, float(t))
    assert sum(len(v) for v in rec._ped_cells.values()) == 0, "waiting steps must not be indexed"
    # then walks +y through (50, 0..20); a vehicle drives +x through (0..100, 10) crossing at (50,10)
    for i, t in enumerate(range(0, 21)):
        rec.record("ped0", "pedestrian", 50.0, float(i), 1.0, float(t))
    for i, t in enumerate(range(9, 12)):
        rec.record("veh0", "car", (i * 50.0), 10.0, 25.0, float(t))  # x: 0 -> 50 -> 100; crosses at t=~10
    rec.record("bike0", "bicycle", 5.0, 5.0, 4.0, 0.0)
    # veh0 + bike0 depart; after GRACE_S they flush (spill + PET-test); ped0 stays active until finalize
    rec.step_end(30.0, {"ped0"})
    rec.step_end(30.0 + sh.SpillRecorder.GRACE_S, {"ped0"})
    assert rec.spilled == 2
    rec.finalize()
    assert rec.counts == {"pedestrian": 1, "car": 1, "bicycle": 1}

    conflicts = rec.conflicts(_FakeNet(), [-180.0, -90.0, 180.0, 90.0])
    assert len(conflicts) == 1 and conflicts[0]["entities"] == ["ped0", "veh0"]
    assert conflicts[0]["pet"] < sh.PED_PET_THRESHOLD

    # teleport-jump guard: a vehicle "moving" 3 km in one step must not rasterize (the deterministic
    # freeze at the first teleport), and a flushed-then-reappearing id counts once in the population.
    rec2 = sh.SpillRecorder(tmp_path / "spill2.jsonl", convert=lambda x, y: (x, y))
    rec2.record("pedX", "pedestrian", 0.0, 0.0, 1.0, 0.0)
    rec2.record("pedX", "pedestrian", 0.0, 3000.0, 1.0, 1.0)  # jump — re-anchored, not indexed
    assert sum(len(v) for v in rec2._ped_cells.values()) == 0
    rec2.record("vehX", "car", 0.0, 0.0, 20.0, 0.0)
    rec2.record("vehX", "car", 3000.0, 0.0, 20.0, 1.0)  # teleport jump — _pet_test must skip it
    rec2.step_end(20.0, set())
    rec2.record("vehX", "car", 3010.0, 0.0, 20.0, 21.0)  # reappears after the flush
    rec2.finalize()
    assert rec2.counts["car"] == 1, "a teleport re-appearance must not double-count"

    picked = rec.load_records({"veh0"})
    assert set(picked) == {"veh0"} and picked["veh0"]["type"] == "car"
    assert picked["veh0"]["path"][0] == [0.0, 0.01]  # offline converter applied at flush
    everything = rec.load_records(None)
    assert set(everything) == {"ped0", "veh0", "bike0"}


class _FakeNet:
    def convertXY2LonLat(self, x: float, y: float):
        return (x / 1000.0, y / 1000.0)
