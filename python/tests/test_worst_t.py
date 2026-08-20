"""V2.6c/D6a — worst_t moves UPSTREAM: the harness stamps it into the outcomes sidecar at record
time (speeds are in memory there), because the sampler is a DETACHED downstream subprocess whose
only other input was the wire speeds — which 0.10.0 drops. The failing-loud backstop
(SpeedsUnavailableError) makes the impossible state (new shape, no worst_t) crash with a NAMED
error, never compute quietly against a missing field (the detached-subprocess silent-failure
class). Stamping iterates the RECORDS dict, so teleport-gapped entities are stamped IDENTICALLY —
the vehicles whose worst moment matters most must never strand on the speeds-needing fallback."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "python" / "src"))

import sampler  # noqa: E402
import scenario_harness  # noqa: E402
from contract_models import Change, Vehicle  # noqa: E402

REG_TS = [float(i) for i in range(8)]
REG_SP = [0.0, 2.0, 3.0, 0.0, 0.0, 0.0, 4.0, 5.0]  # longest stop starts at t=3.0
GAP_TS = [0.0, 1.0, 2.0, 50.0, 51.0, 52.0]  # a teleport hole — the explicit-shape class
GAP_SP = [0.0, 3.0, 0.0, 0.0, 4.0, 5.0]


def _records() -> dict:
    return {
        "veh0": {"type": "car", "path": [[0.0, 0.0]] * 8, "timestamps": list(REG_TS), "speeds": list(REG_SP)},
        "vehgap": {"type": "car", "path": [[0.0, 0.0]] * 6, "timestamps": list(GAP_TS), "speeds": list(GAP_SP)},
        "ped0": {"type": "pedestrian", "path": [[0.0, 0.0]] * 8, "timestamps": list(REG_TS), "speeds": list(REG_SP)},
    }


def test_stamp_worst_t_stamps_every_recorded_entity() -> None:
    buckets = {
        "car": {"outcomes": [{"id": "veh0"}, {"id": "vehgap"}, {"id": "ghost"}]},
        "pedestrian": {"outcomes": [{"id": "ped0"}]},
    }
    scenario_harness.stamp_worst_t(buckets, _records())
    assert buckets["car"]["outcomes"][0]["worst_t"] == sampler.worst_moment(REG_TS, REG_SP)
    # F5: the teleport-shaped vehicle is stamped IDENTICALLY (records-dict iteration is
    # shape-independent by construction — no compact-eligibility branch anywhere near it)
    assert buckets["car"]["outcomes"][1]["worst_t"] == sampler.worst_moment(GAP_TS, GAP_SP)
    assert "worst_t" not in buckets["car"]["outcomes"][2]  # unmatched id: honestly unstamped
    assert buckets["pedestrian"]["outcomes"][0]["worst_t"] == sampler.worst_moment(REG_TS, REG_SP)


def test_worst_t_used_when_present() -> None:
    ent = Vehicle(id="v", type="car", path=[[0.0, 0.0], [0.0, 0.0]], t0=0.0, dt=1.0)
    assert sampler.trigger_time_for({"worst_t": 42.0}, ent) == 42.0


def test_new_shape_without_worst_t_raises_named_error() -> None:
    """F4 — the backstop: a speeds-less entity with no sidecar worst_t must CRASH with the named
    error, never quietly compute a wrong trigger_t against a missing field."""
    ent = Vehicle(id="v", type="car", path=[[0.0, 0.0], [0.0, 0.0]], t0=0.0, dt=1.0)
    with pytest.raises(sampler.SpeedsUnavailableError):
        sampler.trigger_time_for({}, ent)


def test_old_artifact_falls_back_to_wire_speeds() -> None:
    """F6's flip side: the fallback is reached ONLY by genuinely old artifacts — which still carry
    speeds — and reproduces the historical computation exactly."""
    ent = Vehicle(id="v", type="car", path=[[0.0, 0.0]] * 8, timestamps=list(REG_TS), speeds=list(REG_SP))
    assert sampler.trigger_time_for({}, ent) == sampler.worst_moment(REG_TS, REG_SP)


def test_builder_drops_speeds_and_gapped_entity_still_carries_worst_t() -> None:
    """F5/F6 integration: the builder emits speeds-less 0.10.0 entities while the SAME records
    dict, stamped in the same breath, carries worst_t for the gapped vehicle too — the
    'new shape, no speeds, no worst_t' state is impossible by construction."""
    records = _records()
    buckets = {"car": {"outcomes": [{"id": "vehgap"}]}}
    scenario_harness.stamp_worst_t(buckets, records)
    art = scenario_harness.build_multimodal_artifact(
        records, [], run_id="wt-test", baseline_run_id="wt-base",
        changes=[Change(type="speed_limit", target_edge="E1", value_mps=8.33, description="x")],
        bbox=[-1.0, -1.0, 1.0, 1.0], sim_end=60.0, step=1.0)
    assert art.schema_version == "0.10.0"
    gap = next(v for v in art.vehicles if v.id == "vehgap")
    assert gap.speeds is None
    assert gap.timestamps == GAP_TS  # explicit array kept at D6a (compact emission is D6b)
    assert buckets["car"]["outcomes"][0]["worst_t"] == sampler.worst_moment(GAP_TS, GAP_SP)
