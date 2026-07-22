"""V2.2a — the change-scheduler suite (FakeConn, no SUMO).

FakeConn FIDELITY (probed against the LIVE SUMO 1.27 binary on the canonical corridor net,
scratchpad probe 2026-07-21 — encode reality, don't trust research prose):
  - permissions are ONE bitmask; getAllowed/getDisallowed are two views of it.
  - after ``setDisallowed(lane, ["all"])``: getDisallowed returns the EXPANDED 33-class list
    (literal "all" is NOT in it; "passenger" IS) and getAllowed returns ``()`` — the SAME shape
    a fully-open (SVCAll) lane's getAllowed gives in 1.27, so closure detection MUST use
    getDisallowed, never getAllowed.
  - ``setDisallowed(lane, captured_disallowed)`` round-trips the exact (allowed, disallowed)
    pair on both car lanes and sidewalks (P3/P4 probes: restore ok True).
  - ``setAllowed(lane, [])`` CLOSES a lane (parses to permissions 0) — the restore path must
    NEVER call setAllowed (asserted below via the FakeConn call log).
  - ``edge.setMaxSpeed`` hits ALL lanes; per-lane restore needs lane.get/setMaxSpeed.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "python" / "src"))

import change_scheduler as cs  # noqa: E402
from contract_models import Change, Window  # noqa: E402

# The 33-class universe getDisallowed expands to after a ["all"] close (probe P2; 'ignoring'
# is a permission bit but never appears in the getter lists).
UNIVERSE = (
    "private", "emergency", "authority", "army", "vip", "pedestrian", "passenger", "hov",
    "taxi", "bus", "coach", "delivery", "truck", "trailer", "motorcycle", "moped", "evehicle",
    "bicycle", "tram", "rail_urban", "rail", "rail_electric", "rail_fast", "ship", "container",
    "cable_car", "subway", "aircraft", "wheelchair", "scooter", "drone", "custom1", "custom2",
)

# Realistic per-lane masks lifted from the probe's P0 samples.
CAR_LANE_ALLOWED = (
    "private", "emergency", "authority", "army", "vip", "passenger", "hov", "taxi", "bus",
    "coach", "delivery", "truck", "trailer", "motorcycle", "moped", "bicycle", "evehicle",
    "custom1", "custom2",
)
SIDEWALK_ALLOWED = ("pedestrian",)
BUS_BIKE_ALLOWED = ("bus", "bicycle")


class _FakeLane:
    def __init__(self, allowed: tuple[str, ...] | None, speed: float):
        # allowed=None models the theoretical SVCAll (netconvert-default fully-open) lane.
        self.svc_all = allowed is None
        self.allowed = set(UNIVERSE) if allowed is None else set(allowed)
        self.speed = speed


class FakeConn:
    """Dict-backed conn facade modeling the probed 1.27 permission semantics."""

    def __init__(self, edges: dict[str, list[_FakeLane]]):
        self._edges = edges
        self.calls: list[tuple] = []  # (method, args...) — ordering + never-setAllowed asserts

        outer = self

        class _LaneDomain:
            def _lane(self, lane_id: str) -> _FakeLane:
                edge, idx = lane_id.rsplit("_", 1)
                return outer._edges[edge][int(idx)]

            def getAllowed(self, lane_id):
                ln = self._lane(lane_id)
                if ln.svc_all:
                    return ()  # the 1.27 quirk: SVCAll reads back as empty
                return tuple(c for c in UNIVERSE if c in ln.allowed)

            def getDisallowed(self, lane_id):
                ln = self._lane(lane_id)
                if ln.svc_all:
                    return ()
                return tuple(c for c in UNIVERSE if c not in ln.allowed)

            def setAllowed(self, lane_id, classes):
                outer.calls.append(("setAllowed", lane_id, tuple(classes)))
                ln = self._lane(lane_id)
                if "all" in classes:
                    ln.svc_all, ln.allowed = True, set(UNIVERSE)
                else:  # NOTE: [] -> permissions 0 (CLOSED) — the probed 1.27 semantic
                    ln.svc_all, ln.allowed = False, set(classes)

            def setDisallowed(self, lane_id, classes):
                outer.calls.append(("setDisallowed", lane_id, tuple(classes)))
                ln = self._lane(lane_id)
                if "all" in classes:
                    ln.svc_all, ln.allowed = False, set()
                elif not classes:
                    ln.svc_all, ln.allowed = True, set(UNIVERSE)  # disallow nothing == SVCAll
                else:
                    ln.svc_all, ln.allowed = False, set(UNIVERSE) - set(classes)

            def getMaxSpeed(self, lane_id):
                return self._lane(lane_id).speed

            def setMaxSpeed(self, lane_id, speed):
                outer.calls.append(("lane.setMaxSpeed", lane_id, speed))
                self._lane(lane_id).speed = speed

        class _EdgeDomain:
            def getLaneNumber(self, edge_id):
                return len(outer._edges[edge_id])

            def getIDList(self):
                return tuple(outer._edges)

            def setMaxSpeed(self, edge_id, speed):
                outer.calls.append(("edge.setMaxSpeed", edge_id, speed))
                for ln in outer._edges[edge_id]:
                    ln.speed = speed

        self.lane = _LaneDomain()
        self.edge = _EdgeDomain()

    def state_of(self, edge_id: str) -> list[tuple[tuple, tuple, float]]:
        return [
            (self.lane.getAllowed(f"{edge_id}_{i}"), self.lane.getDisallowed(f"{edge_id}_{i}"),
             self.lane.getMaxSpeed(f"{edge_id}_{i}"))
            for i in range(self.edge.getLaneNumber(edge_id))
        ]


def make_conn() -> FakeConn:
    """Edge E: sidewalk + two car lanes (heterogeneous, realistic); edge F: one car lane."""
    return FakeConn({
        "E": [_FakeLane(SIDEWALK_ALLOWED, 5.0), _FakeLane(CAR_LANE_ALLOWED, 13.89),
              _FakeLane(BUS_BIKE_ALLOWED, 11.0)],
        "F": [_FakeLane(CAR_LANE_ALLOWED, 13.89)],
    })


def lane_closure(edge: str, lanes: list[int], start: float | None = None,
                 end: float | None = None) -> Change:
    return Change(type="lane_closure", target_edge=edge, target_lanes=lanes,
                  window=Window(start_s=start, end_s=end) if start is not None else None,
                  description="test lane closure")


def road_closure(edge: str, start: float | None = None, end: float | None = None) -> Change:
    return Change(type="road_closure", target_edge=edge,
                  window=Window(start_s=start, end_s=end) if start is not None else None,
                  description="test road closure")


def speed_limit(edge: str, mps: float, start: float | None = None,
                end: float | None = None) -> Change:
    return Change(type="speed_limit", target_edge=edge, value_mps=mps,
                  window=Window(start_s=start, end_s=end) if start is not None else None,
                  description="test speed limit")


def run_to(sched: cs.ChangeScheduler, t_end: float, step: float = 1.0) -> None:
    t = step
    while t <= t_end:
        sched.tick(t)
        t += step


# ---------------------------------------------------------------- primitives + round trips

def test_lane_closure_round_trip_restores_exact_state() -> None:
    conn = make_conn()
    before = conn.state_of("E")
    sched = cs.ChangeScheduler(conn, [lane_closure("E", [1], 100.0, 500.0)], max_t=3600.0)
    sched.start()
    run_to(sched, 200.0)
    assert "passenger" in conn.lane.getDisallowed("E_1")  # closed during the window
    assert conn.lane.getAllowed("E_1") == ()
    assert conn.state_of("E")[0] == before[0]  # sidewalk untouched
    run_to(sched, 600.0)
    assert conn.state_of("E") == before  # exact restore
    events = sched.finalize(600.0)
    assert len(events) == 1 and events[0]["restored_ok"] is True
    assert events[0]["applied_t"] == 100.0 and events[0]["reverted_t"] == 500.0


def test_restore_never_calls_setAllowed_and_open_lane_stays_open() -> None:
    # The 1.27 trap: a fully-open lane captures getAllowed()==(); replaying that through
    # setAllowed would CLOSE it. The scheduler must restore via setDisallowed only.
    conn = FakeConn({"G": [_FakeLane(None, 13.89), _FakeLane(CAR_LANE_ALLOWED, 13.89)]})
    before = conn.state_of("G")
    assert before[0][0] == () and before[0][1] == ()  # SVCAll reads back all-empty
    sched = cs.ChangeScheduler(conn, [road_closure("G", 100.0, 500.0)], max_t=3600.0)
    sched.start()
    run_to(sched, 600.0)
    assert conn.state_of("G") == before
    assert all(c[0] != "setAllowed" for c in conn.calls), "restore must never call setAllowed"


def test_road_closure_closes_every_lane_and_restores_heterogeneous_masks() -> None:
    conn = make_conn()
    before = conn.state_of("E")
    sched = cs.ChangeScheduler(conn, [road_closure("E", 100.0, 500.0)], max_t=3600.0)
    sched.start()
    run_to(sched, 200.0)
    for i in range(3):
        assert "passenger" in conn.lane.getDisallowed(f"E_{i}")
    run_to(sched, 600.0)
    assert conn.state_of("E") == before  # sidewalk back to ped-only, bus lane to bus+bike


def test_windowed_speed_limit_restores_per_lane_speeds() -> None:
    conn = make_conn()  # E lane speeds are heterogeneous: 5.0 / 13.89 / 11.0
    before = conn.state_of("E")
    sched = cs.ChangeScheduler(conn, [speed_limit("E", 8.33, 100.0, 500.0)], max_t=3600.0)
    sched.start()
    run_to(sched, 200.0)
    assert [s for _, _, s in conn.state_of("E")] == [8.33, 8.33, 8.33]  # edge-level apply
    run_to(sched, 600.0)
    assert conn.state_of("E") == before  # per-lane speeds restored, not one edge value


# ---------------------------------------------------------------- composites (LIFO)

def test_nested_composite_unwinds_through_intermediate_state() -> None:
    conn = make_conn()
    original = conn.state_of("E")
    changes = [lane_closure("E", [1], 100.0, 900.0), lane_closure("E", [1, 2], 300.0, 600.0)]
    sched = cs.ChangeScheduler(conn, changes, max_t=3600.0)
    sched.start()
    run_to(sched, 200.0)
    a_applied = conn.state_of("E")  # A only
    assert "passenger" in conn.lane.getDisallowed("E_1")
    run_to(sched, 400.0)  # B applied on top (captures the A-applied intermediate)
    assert "bus" in conn.lane.getDisallowed("E_2")
    run_to(sched, 700.0)  # B reverted -> back to the A-applied intermediate, NOT original
    assert conn.state_of("E") == a_applied
    run_to(sched, 1000.0)  # A reverted -> original
    assert conn.state_of("E") == original
    events = sched.finalize(1000.0)
    assert all(e["restored_ok"] for e in events)


def test_adjacent_windows_compose_via_revert_before_apply() -> None:
    # A[100,500] + B[500,800] on ONE edge is the realistic phased-closure shape: LEGAL
    # (disjoint, boundary-touching). At t=500 A's revert fires BEFORE B's apply, so B
    # captures the restored state. State verified at 499 / 500 / 501.
    conn = make_conn()
    original = conn.state_of("E")
    changes = [lane_closure("E", [1], 100.0, 500.0), lane_closure("E", [2], 500.0, 800.0)]
    sched = cs.ChangeScheduler(conn, changes, max_t=3600.0)  # must NOT raise
    sched.start()
    run_to(sched, 499.0)
    assert "passenger" in conn.lane.getDisallowed("E_1")   # t=499: A active
    assert "bus" not in conn.lane.getDisallowed("E_2")
    sched.tick(500.0)                                       # t=500: A reverts, then B applies
    assert conn.state_of("E")[1] == original[1]
    assert "bus" in conn.lane.getDisallowed("E_2")
    sched.tick(501.0)                                       # t=501: only B active
    assert conn.state_of("E")[1] == original[1]
    assert "bus" in conn.lane.getDisallowed("E_2")
    for t in (600.0, 700.0, 800.0, 900.0):
        sched.tick(t)
    assert conn.state_of("E") == original
    ev = sched.finalize(900.0)
    assert [e["restored_ok"] for e in ev] == [True, True]


def test_same_tick_applies_in_changes_order_reverts_in_reverse() -> None:
    conn = make_conn()
    original = conn.state_of("E")
    # identical windows: apply idx0 then idx1; revert idx1 then idx0 (LIFO)
    changes = [lane_closure("E", [1], 100.0, 500.0), road_closure("E", 100.0, 500.0)]
    sched = cs.ChangeScheduler(conn, changes, max_t=3600.0)
    sched.start()
    sched.tick(100.0)
    set_calls = [c for c in conn.calls if c[0] == "setDisallowed" and c[2] == ("all",)]
    assert set_calls[0][1] == "E_1", "idx0 (lane_closure) must apply first"
    conn.calls.clear()
    sched.tick(500.0)
    assert conn.state_of("E") == original
    ev = sched.finalize(600.0)
    assert all(e["restored_ok"] for e in ev)


def test_crossing_windows_same_edge_rejected() -> None:
    changes = [lane_closure("E", [1], 100.0, 500.0), lane_closure("E", [2], 200.0, 800.0)]
    with pytest.raises(ValueError, match="disjoint or nested"):
        cs.ChangeScheduler(make_conn(), changes, max_t=3600.0)


def test_same_start_container_second_rejected() -> None:
    # A[100,500] then B[100,800] in changes[] order: B (the container) would apply AFTER the
    # contained A but revert after it too — A's revert at 500 would clobber B. LIFO-invalid.
    changes = [lane_closure("E", [1], 100.0, 500.0), lane_closure("E", [2], 100.0, 800.0)]
    with pytest.raises(ValueError, match="disjoint or nested"):
        cs.ChangeScheduler(make_conn(), changes, max_t=3600.0)


def test_crossing_windows_on_different_edges_allowed() -> None:
    changes = [lane_closure("E", [1], 100.0, 500.0), lane_closure("F", [0], 200.0, 800.0)]
    cs.ChangeScheduler(make_conn(), changes, max_t=3600.0)  # no raise


# ---------------------------------------------------------------- clipping + proof log

def test_window_end_beyond_ceiling_never_reverts_with_note() -> None:
    conn = make_conn()
    sched = cs.ChangeScheduler(conn, [lane_closure("E", [1], 100.0, 7200.0)], max_t=3600.0)
    sched.start()
    run_to(sched, 300.0)
    assert "passenger" in conn.lane.getDisallowed("E_1")
    events = sched.finalize(3600.0)
    assert events[0]["applied_t"] == 100.0 and events[0]["reverted_t"] is None
    assert "never reverted" in events[0]["note"]


def test_window_start_beyond_ceiling_never_applies() -> None:
    conn = make_conn()
    before = conn.state_of("E")
    sched = cs.ChangeScheduler(conn, [lane_closure("E", [1], 4000.0, 5000.0)], max_t=3600.0)
    sched.start()
    run_to(sched, 300.0)
    assert conn.state_of("E") == before
    events = sched.finalize(3600.0)
    assert events[0]["applied_t"] is None and "never applied" in events[0]["note"]


def test_start_at_or_below_zero_applies_in_start() -> None:
    conn = make_conn()
    sched = cs.ChangeScheduler(conn, [lane_closure("E", [1], 0.0, 500.0)], max_t=3600.0)
    sched.start()  # in force from the first step, before any tick
    assert "passenger" in conn.lane.getDisallowed("E_1")


def test_proof_log_shape() -> None:
    conn = make_conn()
    sched = cs.ChangeScheduler(conn, [lane_closure("E", [1], 100.0, 500.0)], max_t=3600.0)
    sched.start()
    run_to(sched, 600.0)
    (e,) = sched.finalize(600.0)
    assert e["change_idx"] == 0 and e["type"] == "lane_closure" and e["target_edge"] == "E"
    assert e["window"] == {"start_s": 100.0, "end_s": 500.0}


def test_unwindowed_changes_are_partitioned_not_scheduled() -> None:
    conn = make_conn()
    ch = lane_closure("E", [1])  # no window
    sched = cs.ChangeScheduler(conn, [ch], max_t=3600.0)
    assert sched.unwindowed == [ch]
    sched.start()
    assert "passenger" not in conn.lane.getDisallowed("E_1")  # caller applies it, not us
    assert sched.finalize(3600.0) == []


def test_windowed_unsupported_type_rejected_at_build() -> None:
    ch = Change(type="bike_lane", target_edge="E", window=Window(start_s=10.0, end_s=20.0),
                description="windowed bike lane")
    with pytest.raises(ValueError, match="windowed 'bike_lane'"):
        cs.ChangeScheduler(make_conn(), [ch], max_t=3600.0)


# ---------------------------------------------------------------- the revert assert is real

class LossyConn(FakeConn):
    """A conn whose restore path is silently broken (setDisallowed drops one class)."""

    def __init__(self, edges):
        super().__init__(edges)
        real = self.lane.setDisallowed

        def lossy(lane_id, classes):
            if classes and "all" not in classes:
                classes = [c for c in classes if c != "tram"]  # silent drift
            real(lane_id, classes)

        self.lane.setDisallowed = lossy


def test_tampered_restore_trips_the_assert() -> None:
    conn = LossyConn({"E": [_FakeLane(CAR_LANE_ALLOWED, 13.89)]})
    sched = cs.ChangeScheduler(conn, [lane_closure("E", [0], 100.0, 500.0)], max_t=3600.0)
    sched.start()
    run_to(sched, 200.0)
    with pytest.raises(AssertionError, match="E_0"):
        run_to(sched, 600.0)


# ---------------------------------------------------------------- pure validators

def test_validate_target_lanes_matrix() -> None:
    car = [1, 2]
    assert cs.validate_target_lanes([1], car, "E") is None
    assert cs.validate_target_lanes([1, 2], car, "E") is None
    for bad in (None, []):
        assert "target_lanes" in cs.validate_target_lanes(bad, car, "E")
    assert "duplicate" in cs.validate_target_lanes([1, 1], car, "E")
    reason = cs.validate_target_lanes([0], car, "E")  # 0 is the sidewalk here
    assert "car lane" in reason and "E" in reason


def test_assignment_rejection_matrix() -> None:
    f = cs.assignment_rejection_reason
    # day_one: everything allowed
    assert f("day_one", "road_closure", True, True) is None
    assert f("day_one", "lane_closure", True, True) is None
    # settled + windowed (any type) -> D1
    assert f("settled", "speed_limit", True, False) == cs.REASON_WINDOWED_SETTLED
    assert f("settled", "lane_closure", True, False) == cs.REASON_WINDOWED_SETTLED
    # settled + severing closures
    assert f("settled", "road_closure", False, True) == cs.REASON_SETTLED_SEVERED
    assert f("settled", "lane_closure", False, True) == cs.REASON_SETTLED_SEVERED
    # settled + partial unwindowed lane_closure: allowed
    assert f("settled", "lane_closure", False, False) is None
    # settled + the existing runtime types, unwindowed: allowed
    assert f("settled", "speed_limit", False, False) is None
    assert f("settled", "bike_lane", False, False) is None
