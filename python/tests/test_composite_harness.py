"""V2.2d Phase 1 — the composite (multi-change) harness surfaces. No SUMO run needed.

The contract has carried changes[]/tags since 0.5.0; this suite pins the first REAL producer
support: gate predicates fold over the list, the scheduler runs a multi-change composite
(different edges, independent windows), and build_multimodal_artifact emits changes[] + tags
on the wire (single-change runs stay shape-identical: wrapped list, no tags key).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "python" / "src"))
sys.path.insert(0, str(Path(__file__).parent))  # sibling test helpers (FakeConn)

import change_scheduler as cs  # noqa: E402
from contract_models import Change, Effect, Window  # noqa: E402
from test_change_scheduler import make_conn, run_to, speed_limit  # noqa: E402


def _closure() -> Change:
    return Change(type="lane_closure", target_edge="E1", target_lanes=[1],
                  description="test closure")


def _speed(edge: str = "E1") -> Change:
    return Change(type="speed_limit", target_edge=edge, value_mps=8.33,
                  description=f"test speed limit on {edge}")


def _incident(blocked: bool) -> Change:
    return Change(type="incident", target_edge="E1",
                  target_lanes=[1] if blocked else None,
                  window=Window(start_s=600.0, end_s=1800.0),
                  effect=Effect(blocked=blocked or None,
                                speed_factor=None if blocked else 0.5),
                  description="test incident")


# ------------------------------------------------------------------ gate predicates fold


def test_any_invalidates_routes_folds_with_any() -> None:
    assert cs.any_invalidates_routes([]) is False
    assert cs.any_invalidates_routes([_speed()]) is False
    assert cs.any_invalidates_routes([_speed(), _closure()]) is True
    assert cs.any_invalidates_routes([_incident(blocked=True)]) is True
    # a speed-only incident cannot invalidate a route — route errors stay FATAL there
    assert cs.any_invalidates_routes([_incident(blocked=False)]) is False


def test_any_capacity_event_folds_with_any() -> None:
    assert cs.any_capacity_event([]) is False
    assert cs.any_capacity_event([_speed(), _speed("E2")]) is False
    assert cs.any_capacity_event([_speed(), _closure()]) is True
    # ALL incidents are capacity events (speed-only included) — the V2.2b rule
    assert cs.any_capacity_event([_incident(blocked=False)]) is True


# ------------------------------------------------------------------ composite scheduler run


def test_scheduler_composite_two_windowed_speed_limits_two_edges() -> None:
    # The school-zone shape: N windowed speed_limits on DIFFERENT edges, independent
    # apply/revert, every member's revert proof present and restored_ok.
    conn = make_conn()
    before_e, before_f = conn.state_of("E"), conn.state_of("F")
    changes = [speed_limit("E", 8.33, 100.0, 500.0), speed_limit("F", 5.0, 200.0, 600.0)]
    sched = cs.ChangeScheduler(conn, changes, max_t=3600.0)
    sched.start()
    run_to(sched, 300.0)
    assert conn.lane.getMaxSpeed("E_1") == 8.33 and conn.lane.getMaxSpeed("F_0") == 5.0
    run_to(sched, 700.0)
    assert conn.state_of("E") == before_e and conn.state_of("F") == before_f
    events = sched.finalize(700.0)
    assert len(events) == 2
    by_edge = {e["target_edge"]: e for e in events}
    assert by_edge["E"]["applied_t"] == 100.0 and by_edge["E"]["reverted_t"] == 500.0
    assert by_edge["F"]["applied_t"] == 200.0 and by_edge["F"]["reverted_t"] == 600.0
    assert all(e["restored_ok"] is True for e in events)


# ------------------------------------------------------------------ artifact: changes[] + tags


BBOX = [-79.5, 43.5, -79.0, 44.0]
RECORDS = {"veh0": {"type": "car", "path": [[-79.25, 43.75], [-79.24, 43.75]],
                    "timestamps": [0.0, 1.0], "speeds": [1.0, 1.0]}}


def _windowed_speed(edge: str, start: float, end: float) -> Change:
    return Change(type="speed_limit", target_edge=edge, value_mps=8.33,
                  window=Window(start_s=start, end_s=end),
                  description=f"school-zone limit on {edge}")


def test_build_artifact_composite_with_tags_validates(tmp_path) -> None:
    import scenario_harness as sh
    import trajectory_io

    changes = [_windowed_speed("E1", 600.0, 1200.0), _windowed_speed("E2", 600.0, 1200.0)]
    art = sh.build_multimodal_artifact(
        RECORDS, [], run_id="composite-test", baseline_run_id="baseline-test",
        changes=changes, tags=["school_zone"], target_lane=None,
        bbox=BBOX, sim_end=100.0, step=1.0)
    path = trajectory_io.dump_artifact(art, path=tmp_path / "composite-test.json")  # validates
    raw = json.loads(path.read_text(encoding="utf-8"))
    scen = raw["meta"]["scenario"]
    assert len(scen["changes"]) == 2
    assert scen["tags"] == ["school_zone"]
    assert "change" in scen or True  # 0.5.0+ forbids legacy change — assert absent below
    assert "change" not in scen
    # composite members never get a target_lane stamped on (that is the single-bike_lane path)
    assert all("target_lane" not in c for c in scen["changes"])
    assert all(c["window"] == {"start_s": 600.0, "end_s": 1200.0} for c in scen["changes"])


def test_build_artifact_single_change_wraps_and_omits_tags(tmp_path) -> None:
    # A single-change run through the NEW signature stays shape-identical to pre-d artifacts:
    # changes == [the change], target_lane stamped, and NO tags key on the wire.
    import scenario_harness as sh
    import trajectory_io

    change = Change(type="bike_lane", target_edge="E1",
                    description="test bike lane")
    art = sh.build_multimodal_artifact(
        RECORDS, [], run_id="single-test", baseline_run_id="baseline-test",
        changes=[change], tags=None, target_lane=1,
        bbox=BBOX, sim_end=100.0, step=1.0)
    path = trajectory_io.dump_artifact(art, path=tmp_path / "single-test.json")
    scen = json.loads(path.read_text(encoding="utf-8"))["meta"]["scenario"]
    assert len(scen["changes"]) == 1
    assert scen["changes"][0]["target_lane"] == 1
    assert "tags" not in scen


# ------------------------------------------------------------------ the composite spec handoff


def test_load_composite_spec_round_trip(tmp_path) -> None:
    import scenario_harness as sh

    spec = {"changes": [
        {"type": "speed_limit", "target_edge": "E1", "value_mps": 8.33,
         "window": {"start_s": 600.0, "end_s": 1200.0}, "description": "zone limit on E1"},
        {"type": "speed_limit", "target_edge": "E2", "value_mps": 8.33,
         "window": {"start_s": 600.0, "end_s": 1200.0}, "description": "zone limit on E2"},
    ], "tags": ["school_zone"]}
    p = tmp_path / "spec.json"
    p.write_text(json.dumps(spec), encoding="utf-8")
    changes, tags = sh.load_composite_spec(p)
    assert [c.target_edge for c in changes] == ["E1", "E2"]
    assert all(c.window is not None for c in changes)
    assert tags == ["school_zone"]


def test_load_composite_spec_rejects_non_speed_limit_with_shared_reason(tmp_path) -> None:
    import pytest
    import scenario_harness as sh

    spec = {"changes": [
        {"type": "speed_limit", "target_edge": "E1", "value_mps": 8.33, "description": "ok"},
        {"type": "lane_closure", "target_edge": "E2", "target_lanes": [1], "description": "nope"},
    ]}
    p = tmp_path / "spec.json"
    p.write_text(json.dumps(spec), encoding="utf-8")
    with pytest.raises(SystemExit) as ei:
        sh.load_composite_spec(p)
    assert "composite change 1" in str(ei.value)
    assert cs.REASON_COMPOSITE_MEMBER in str(ei.value)


def test_load_composite_spec_rejects_empty_and_invalid(tmp_path) -> None:
    import pytest
    import scenario_harness as sh

    empty = tmp_path / "empty.json"
    empty.write_text(json.dumps({"changes": []}), encoding="utf-8")
    with pytest.raises(SystemExit, match="no changes"):
        sh.load_composite_spec(empty)
    bad = tmp_path / "bad.json"
    bad.write_text(json.dumps({"changes": [{"type": "speed_limit"}]}), encoding="utf-8")
    with pytest.raises(SystemExit, match="change 0 invalid"):
        sh.load_composite_spec(bad)  # pydantic-invalid (missing target_edge/description)


def test_run_composite_settled_rejected_with_shared_reason(tmp_path) -> None:
    import argparse

    import pytest
    import scenario_harness as sh

    spec = tmp_path / "spec.json"
    spec.write_text(json.dumps({"changes": [
        {"type": "speed_limit", "target_edge": "E1", "value_mps": 8.33, "description": "ok"}]}),
        encoding="utf-8")
    args = argparse.Namespace(composite=str(spec), assignment="settled", run_ts=None,
                              demand_profile="synthetic_demo", n_seeds=1)
    with pytest.raises(SystemExit) as ei:
        sh._run_composite(args)
    assert str(ei.value) == cs.REASON_COMPOSITE_SETTLED


# ------------------------------------------------------------------ scorecard access on composites


def test_composite_access_semantics() -> None:
    """Two facts pinned: (1) the composite-null note FIRES when >1 change contributes a heuristic
    to the same group (never silently summed); (2) a SPEED-LIMIT composite (the school zone) has
    no access heuristic at all — access renders absent exactly like a single speed_limit run
    (the zone lens, not the access column, carries the zone's story)."""
    import scorecard

    buckets = {m: {"counts": {"total_demand": 10}, "outcomes": [{"delta_seconds": 1.0}]}
               for m in ("car", "bicycle", "pedestrian")}
    two_bike = [{"type": "bike_lane", "target_edge": "E1"}, {"type": "bike_lane", "target_edge": "E2"}]
    sc = scorecard.compute_scorecard(buckets, [], [], two_bike)
    car = next(g for g in sc.groups if g.group == "car_commuter")
    assert car.access_delta is not None and car.access_delta.value is None
    assert car.access_delta.note == "composite scenario (2 changes) — per-group access not separable yet"

    zone = [{"type": "speed_limit", "target_edge": e, "value_mps": 8.33,
             "window": {"start_s": 600.0, "end_s": 1200.0}} for e in ("E1", "E2", "E3")]
    sc2 = scorecard.compute_scorecard(buckets, [], [], zone)
    assert all(g.access_delta is None for g in sc2.groups)  # same as a single speed_limit run
