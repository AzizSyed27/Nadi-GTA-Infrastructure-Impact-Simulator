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
from test_change_scheduler import incident, lane_closure, make_conn, road_closure, run_to, speed_limit  # noqa: E402


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


def test_composite_member_reason_names_the_windowable_types() -> None:
    # Anti-drift: the prose reason and WINDOWABLE_TYPES are separate strings — if the tuple ever
    # changes, the reason must change with it.
    for t in cs.WINDOWABLE_TYPES:
        assert t in cs.REASON_COMPOSITE_MEMBER
    for banned in ("bike_lane", "new_road"):
        assert banned in cs.REASON_COMPOSITE_MEMBER  # named as non-composable, with the why


def test_scheduler_composite_mixed_members_one_scheduler_per_member_proofs() -> None:
    # V2.4b: a MIXED windowed membership (road_closure + speed_limit + speed-only incident) rides
    # ONE scheduler; nested same-edge windows are legal; every member gets its own revert proof.
    import pytest

    conn = make_conn()
    before_e, before_f = conn.state_of("E"), conn.state_of("F")
    changes = [road_closure("F", 100.0, 500.0),
               speed_limit("E", 8.33, 200.0, 600.0),
               incident("E", 250.0, 550.0, speed_factor=0.5)]  # nested inside the speed window
    sched = cs.ChangeScheduler(conn, changes, max_t=3600.0)
    sched.start()
    run_to(sched, 300.0)
    assert "passenger" in conn.lane.getDisallowed("F_0")  # road closed
    assert conn.lane.getMaxSpeed("E_1") == pytest.approx(8.33 * 0.5)  # limit applied, then scaled
    run_to(sched, 700.0)
    assert conn.state_of("E") == before_e and conn.state_of("F") == before_f
    events = sched.finalize(700.0)
    assert [e["change_idx"] for e in events] == [0, 1, 2]  # changes[] order preserved
    assert [(e["type"], e["applied_t"], e["reverted_t"]) for e in events] == [
        ("road_closure", 100.0, 500.0), ("speed_limit", 200.0, 600.0), ("incident", 250.0, 550.0)]
    assert all(e["restored_ok"] is True for e in events)
    # the folds see the same mixed membership the scheduler ran
    assert cs.any_invalidates_routes(changes) is True   # the road_closure member
    assert cs.any_capacity_event(changes) is True


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


def _real_edges(n: int, min_car_lanes: int = 1) -> list[str]:
    """Canonical-net edge ids for spec tests — the V2.4b spec loader validates against the net."""
    import network_edit
    import scenario_harness as sh

    net = sh._spec_net()
    out: list[str] = []
    for e in net.getEdges():
        if len(network_edit._car_lane_indices_static(net, e.getID())) >= min_car_lanes:
            out.append(e.getID())
            if len(out) == n:
                return out
    raise AssertionError(f"canonical net lacks {n} edges with >= {min_car_lanes} car lanes")


def test_load_composite_spec_round_trip(tmp_path) -> None:
    import scenario_harness as sh

    e1, e2 = _real_edges(2)
    spec = {"changes": [
        {"type": "speed_limit", "target_edge": e1, "value_mps": 8.33,
         "window": {"start_s": 600.0, "end_s": 1200.0}, "description": f"zone limit on {e1}"},
        {"type": "speed_limit", "target_edge": e2, "value_mps": 8.33,
         "window": {"start_s": 600.0, "end_s": 1200.0}, "description": f"zone limit on {e2}"},
    ], "tags": ["school_zone"]}
    p = tmp_path / "spec.json"
    p.write_text(json.dumps(spec), encoding="utf-8")
    changes, tags = sh.load_composite_spec(p)
    assert [c.target_edge for c in changes] == [e1, e2]
    assert all(c.window is not None for c in changes)
    assert tags == ["school_zone"]


def test_load_composite_spec_rejects_non_composable_types_with_shared_reason(tmp_path) -> None:
    # V2.4b: the member gate is WINDOWABLE_TYPES; bike_lane and new_road stay single-change.
    import pytest
    import scenario_harness as sh

    e1, e2 = _real_edges(2)
    spec = {"changes": [
        {"type": "speed_limit", "target_edge": e1, "value_mps": 8.33, "description": "ok"},
        {"type": "bike_lane", "target_edge": e2, "description": "nope"},
    ]}
    p = tmp_path / "spec.json"
    p.write_text(json.dumps(spec), encoding="utf-8")
    with pytest.raises(SystemExit) as ei:
        sh.load_composite_spec(p)
    assert "composite change 1" in str(ei.value)
    assert cs.REASON_COMPOSITE_MEMBER in str(ei.value)


def test_load_composite_spec_net_validation_names_index(tmp_path) -> None:
    # V2.4b: the spec loader reads the net — bad lane indices and unknown edges die as clean
    # SystemExits naming the member (previously a raw KeyError deep in the run).
    import pytest
    import scenario_harness as sh

    (e1,) = _real_edges(1, min_car_lanes=1)
    bad_lanes = {"changes": [
        {"type": "lane_closure", "target_edge": e1, "target_lanes": [99], "description": "bad"}]}
    p = tmp_path / "s1.json"
    p.write_text(json.dumps(bad_lanes), encoding="utf-8")
    with pytest.raises(SystemExit) as ei:
        sh.load_composite_spec(p)
    assert str(ei.value).startswith("composite change 0: ") and "not car lanes" in str(ei.value)

    unknown = {"changes": [
        {"type": "road_closure", "target_edge": "no_such_edge_xyz", "description": "x"}]}
    p2 = tmp_path / "s2.json"
    p2.write_text(json.dumps(unknown), encoding="utf-8")
    with pytest.raises(SystemExit) as ei2:
        sh.load_composite_spec(p2)
    assert "composite change 0" in str(ei2.value) and "is not in the network" in str(ei2.value)

    # review-caught: the contract model leaves value_mps OPTIONAL, so a hand-written spec missing
    # it must die HERE (clean CLI message), not as a silent probe no-op + a TraCI crash mid-run.
    missing_v = {"changes": [
        {"type": "speed_limit", "target_edge": e1, "description": "no value"}]}
    p3 = tmp_path / "s3.json"
    p3.write_text(json.dumps(missing_v), encoding="utf-8")
    with pytest.raises(SystemExit) as ei3:
        sh.load_composite_spec(p3)
    assert str(ei3.value) == "composite change 0: speed_limit requires target_edge and value_mps"


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

    (e1,) = _real_edges(1)
    spec = tmp_path / "spec.json"
    spec.write_text(json.dumps({"changes": [
        {"type": "speed_limit", "target_edge": e1, "value_mps": 8.33, "description": "ok"}]}),
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
    assert car.access_delta.note == \
        "composite scenario — 2 of 2 changes affect this group's access; not separable yet"

    zone = [{"type": "speed_limit", "target_edge": e, "value_mps": 8.33,
             "window": {"start_s": 600.0, "end_s": 1200.0}} for e in ("E1", "E2", "E3")]
    sc2 = scorecard.compute_scorecard(buckets, [], [], zone)
    assert all(g.access_delta is None for g in sc2.groups)  # same as a single speed_limit run


def test_composite_access_mixed_membership_branches() -> None:
    """V2.4b — the branches mixed composites make reachable: (1) exactly ONE contributing member
    renders a REAL ordinal ('rule-based estimate'; '; applies during the closure window' when the
    closure is windowed); (2) the composite-null note counts CONTRIBUTORS vs SCENARIO size when they
    differ; (3) zero contributors + several _NULL_WITH_NOTE types → the FIRST member's note wins
    (documented order-dependence)."""
    import scorecard

    buckets = {m: {"counts": {"total_demand": 10}, "outcomes": [{"delta_seconds": 1.0}]}
               for m in ("car", "bicycle", "pedestrian")}

    one_contrib = [{"type": "speed_limit", "target_edge": "E1", "value_mps": 8.33},
                   {"type": "speed_limit", "target_edge": "E2", "value_mps": 8.33},
                   {"type": "lane_closure", "target_edge": "E3", "target_lanes": [1],
                    "window": {"start_s": 600.0, "end_s": 1200.0}}]
    sc = scorecard.compute_scorecard(buckets, [], [], one_contrib)
    car = next(g for g in sc.groups if g.group == "car_commuter")
    assert car.access_delta.value == 0.5
    assert car.access_delta.note == "rule-based estimate; applies during the closure window"

    counts_differ = [{"type": "bike_lane", "target_edge": "E1"},
                     {"type": "bike_lane", "target_edge": "E2"},
                     {"type": "speed_limit", "target_edge": "E3", "value_mps": 8.33}]
    sc2 = scorecard.compute_scorecard(buckets, [], [], counts_differ)
    car2 = next(g for g in sc2.groups if g.group == "car_commuter")
    assert car2.access_delta.value is None
    assert car2.access_delta.note == \
        "composite scenario — 2 of 3 changes affect this group's access; not separable yet"

    order_dep = [{"type": "incident", "target_edge": "E1", "effect": {"speed_factor": 0.5},
                  "window": {"start_s": 600.0, "end_s": 1200.0}},
                 {"type": "road_closure", "target_edge": "E2"}]
    sc3 = scorecard.compute_scorecard(buckets, [], [], order_dep)
    cyc = next(g for g in sc3.groups if g.group == "cyclist")
    assert cyc.access_delta.value is None
    assert cyc.access_delta.note == "temporary incident — access heuristic not meaningful"
