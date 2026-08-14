"""V2.5b — rung-2 response REACHABILITY: per-member END-NODE probing (free-flow routing, not a
dispatch simulation). The old single-anchor walk (destination_edge) is RETIRED — every capacity
member's segment ends are probed per station, per net; the anchor arbitrariness is gone by
construction, not disclosed.

Runs against the REAL canonical corridor net (module-scoped fixture, read once; every mutating
test undoes its mutation so the shared instances stay pristine). Net literals below were PROBED
live once and encoded (the fakes-encode-probed-reality convention):
  - KINGSTON 42140001: from=cluster_32458166_32458168_433592702 ("south end", dy=+198.9 dominant)
    to=12196373244 ("north end") — and the to-node's ONLY passenger approach is 42140001 ITSELF,
    so a full closure makes the north end genuinely unreachable (the embraced shape-split end).
  - DOORSTEP -36784353#20: from=427659366 ("east end", dx=-74.5 dominant) to=427658710 ("west
    end"); reverse partner 36784353#18 approaches the east end (one-way-closed two-way street).
  - NO_APPROACH_EDGE 1285153762: its from-node has zero incoming passenger edges (boundary stub).
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "python" / "src"))

import response_probe as rp  # noqa: E402
from contract_models import Change, Effect, Window  # noqa: E402

KINGSTON = "42140001"          # the V2.2a acceptance arterial (car lanes [1,2,3]; lane 0 sidewalk)
DOORSTEP = "-36784353#20"      # Station 231's own origin edge (the V2.4b doorstep closure)
INCIDENT_EDGE = "-1288863202#6"
SPEED_EDGE = "-1288863201"
NO_APPROACH_EDGE = "1285153762"  # from-node has no incoming passenger edge (probed live)


def _road_closure(edge: str = KINGSTON, window: Window | None = None) -> Change:
    return Change(type="road_closure", target_edge=edge, window=window,
                  description="test road closure")


def _speed_limit(edge: str = KINGSTON, mps: float = 8.33) -> Change:
    return Change(type="speed_limit", target_edge=edge, value_mps=mps, description="test limit")


def _incident(edge: str = INCIDENT_EDGE, speed_factor: float | None = None,
              blocked_lanes: list[int] | None = None,
              window: Window | None = None) -> Change:
    return Change(type="incident", target_edge=edge, target_lanes=blocked_lanes,
                  window=window or Window(start_s=600.0, end_s=1800.0),
                  effect=Effect(blocked=True if blocked_lanes else None, speed_factor=speed_factor),
                  description="test incident")


@pytest.fixture(scope="module")
def nets():
    import run_sim
    import sumolib

    base = sumolib.net.readNet(str(run_sim.NET))
    scen = sumolib.net.readNet(str(run_sim.NET))
    return base, scen


def _compute(nets, changes: list[Change]) -> dict:
    """members_from_nets on the shared fixture nets with apply+undo (keeps instances pristine);
    the production read-fresh path is covered once by the end-to-end test below."""
    base, scen = nets
    undos = [rp.apply_to_net(scen, c) for c in changes]
    try:
        return rp.members_from_nets(base, scen, changes, rp.load_probes())
    finally:
        for u in reversed(undos):
            u()


# ------------------------------------------------------------------ probes + framing (unchanged)


def test_load_probes_returns_the_four_fire_stations() -> None:
    probes = rp.load_probes()
    assert len(probes) == 4
    labels = " ".join(p["label"] for p in probes)
    for station in ("231", "232", "234", "243"):
        assert f"Station {station}" in labels
    for p in probes:
        assert -80 < p["lon"] < -79 and 43 < p["lat"] < 44
        assert p["represents"] == "fire_station"


def test_load_probes_never_folds_in_underscore_metadata() -> None:
    import json

    raw = json.loads(rp.PROBES_PATH.read_text(encoding="utf-8"))
    assert "_retired" in raw
    labels = [p["label"] for p in rp.load_probes()]
    assert len(labels) == 4
    for lbl in labels:
        assert "corridor entry" not in lbl


def test_origins_note_carries_the_dispatch_guard() -> None:
    note = rp.origins_note()
    assert "Toronto Fire Services station locations" in note
    assert "do not indicate which station would respond" in note
    assert "Toronto Open Data" in note


def test_sentinel_detection_is_threshold_not_equality() -> None:
    class _StubNet:
        def __init__(self, ret):
            self._ret = ret

        def getOptimalPath(self, *a, **k):
            return self._ret

    assert rp._route_seconds(_StubNet((None, 1e400)), "o", "d") is None
    assert rp._route_seconds(_StubNet((("e",), 1e300)), "o", "d") is None
    assert rp._route_seconds(_StubNet((("e",), 245.7)), "o", "d") == 245.7


def test_origins_resolve_and_route_positive(nets) -> None:
    base, _ = nets
    for p in rp.load_probes():
        edge = rp.origin_edge(base, p["lon"], p["lat"])
        assert edge is not None and edge.allows("passenger")
    origin = rp.origin_edge(base, rp.load_probes()[0]["lon"], rp.load_probes()[0]["lat"])
    t = rp._route_seconds(base, origin, base.getEdge(KINGSTON))
    assert t is not None and t > 0


# ------------------------------------------------------------------ net mutation (unchanged)


def test_speed_factor_slows_the_route(nets) -> None:
    base, scen = nets
    probes = rp.load_probes()
    origin = rp.origin_edge(base, probes[0]["lon"], probes[0]["lat"])
    base_t = rp._route_seconds(base, origin, base.getEdge(KINGSTON))
    undo = rp.apply_to_net(scen, _incident(edge=KINGSTON, speed_factor=0.25))
    try:
        # routing TO the slowed edge itself: getOptimalPath's cost INCLUDES the destination
        # edge's traversal (v1_27_0 finalizeCost: includeFromToCost adds the from edge and
        # removes nothing when toPos is None — source-verified), so the slowdown must show.
        scen_t = rp._route_seconds(scen, scen.getEdge(origin.getID()), scen.getEdge(KINGSTON))
        assert scen.getEdge(KINGSTON).getSpeed() == pytest.approx(base.getEdge(KINGSTON).getSpeed() * 0.25)
        assert scen_t is not None and base_t is not None and scen_t > base_t
    finally:
        undo()
    assert scen.getEdge(KINGSTON).getSpeed() == pytest.approx(base.getEdge(KINGSTON).getSpeed())


def test_speed_guard_fails_production_when_attr_vanishes(nets, monkeypatch) -> None:
    _, scen = nets
    edge = scen.getEdge(KINGSTON)
    monkeypatch.delattr(edge, "_speed")
    with pytest.raises(RuntimeError, match="SUMO 1.27|version"):
        rp.apply_to_net(scen, _incident(edge=KINGSTON, speed_factor=0.5))


def test_speed_limit_member_shapes_the_scenario_net(nets) -> None:
    base, scen = nets
    undo = rp.apply_to_net(scen, _speed_limit(mps=5.0))
    try:
        assert scen.getEdge(KINGSTON).getSpeed() == pytest.approx(5.0)
    finally:
        undo()
    assert scen.getEdge(KINGSTON).getSpeed() == pytest.approx(base.getEdge(KINGSTON).getSpeed())


def test_speed_limit_guard_fails_loudly_when_attr_vanishes(nets, monkeypatch) -> None:
    _, scen = nets
    monkeypatch.delattr(scen.getEdge(KINGSTON), "_speed")
    with pytest.raises(RuntimeError, match="SUMO 1.27|version"):
        rp.apply_to_net(scen, _speed_limit())


# ------------------------------------------------------------------ V2.5a coincidence (unchanged)


def _windowed_road_closure(start: float, end: float, edge: str = KINGSTON) -> Change:
    return Change(type="road_closure", target_edge=edge,
                  window=Window(start_s=start, end_s=end), description="windowed closure")


def test_window_coincidence_note_fires_iff_windows_differ() -> None:
    w_a, w_b = _windowed_road_closure(600.0, 1200.0), _windowed_road_closure(600.0, 1800.0)
    permanent = _road_closure()
    assert rp.window_coincidence_note([w_a]) is None
    assert rp.window_coincidence_note([permanent, permanent]) is None
    assert rp.window_coincidence_note([w_a, permanent]) is None
    assert rp.window_coincidence_note([w_a, _windowed_road_closure(600.0, 1200.0)]) is None
    assert rp.window_coincidence_note([w_a, w_b]) == rp.WINDOW_COINCIDENCE_NOTE
    # DELIBERATE firing shape: two distinct windows + a permanent member → still fires (the two
    # distinct windows alone overstate constraint) — explicit choice, pinned.
    assert rp.window_coincidence_note([w_a, w_b, permanent]) == rp.WINDOW_COINCIDENCE_NOTE


# ------------------------------------------------------------------ V2.5b end entries


def test_end_entries_compass_labels_on_real_edges(nets) -> None:
    base, _ = nets
    # KINGSTON runs dominantly south→north (probed: dx=+157.9, dy=+198.9)
    assert rp.end_entries(base.getEdge(KINGSTON)) == [
        ("cluster_32458166_32458168_433592702", "south end"),
        ("12196373244", "north end"),
    ]
    # the doorstep edge runs dominantly east→west (probed: dx=-74.5, dy=-29.4)
    assert rp.end_entries(base.getEdge(DOORSTEP)) == [
        ("427659366", "east end"),
        ("427658710", "west end"),
    ]


class _StubNode:
    def __init__(self, nid, coord):
        self._id, self._coord = nid, coord

    def getID(self):
        return self._id

    def getCoord(self):
        return self._coord


class _StubEdge:
    def __init__(self, f, t):
        self._f, self._t = f, t

    def getFromNode(self):
        return self._f

    def getToNode(self):
        return self._t


def test_end_entries_loop_and_degenerate() -> None:
    n = _StubNode("J1", (0.0, 0.0))
    assert rp.end_entries(_StubEdge(n, n)) == [("J1", "both ends (loop segment)")]
    # chord under DEGENERATE_DIST_M (a U-shaped segment): neutral labels ordered by node id
    a, b = _StubNode("J9", (0.0, 0.0)), _StubNode("J2", (3.0, 1.0))
    assert rp.end_entries(_StubEdge(a, b)) == [("J9", "end B"), ("J2", "end A")]
    # exact diagonal tie |dx| == |dy| → the east/west branch wins (documented determinism)
    c, d = _StubNode("J3", (0.0, 0.0)), _StubNode("J4", (100.0, 100.0))
    assert rp.end_entries(_StubEdge(c, d)) == [("J3", "west end"), ("J4", "east end")]


def test_cost_to_end_is_min_over_approaches_tie_by_id() -> None:
    costs = {"A1": 30.0, "A2": 10.0, "A3": 10.0}

    class _Approach:
        def __init__(self, aid):
            self._id = aid

        def getID(self):
            return self._id

        def allows(self, v):
            return True

    class _Node:
        def getIncoming(self):
            return [_Approach("A3"), _Approach("A1"), _Approach("A2")]  # deliberately unsorted

    class _Net:
        def getOptimalPath(self, frm, to, fastest=True, vClass=None):
            return (("e",), costs[to.getID()])

    got = rp._cost_to_end(_Net(), object(), _Node())
    assert got == 10.0  # min; A2 (lowest id among the 10.0 tie) is the winner by sorted iteration


# ------------------------------------------------------------------ V2.5b members payload


def test_member_gate_and_probed_members_note(nets) -> None:
    # the acceptance triple: closure + permanent speed_limit + speed-factor incident
    triple = [_road_closure(DOORSTEP, Window(start_s=600.0, end_s=1200.0)),
              _speed_limit(SPEED_EDGE),
              _incident(speed_factor=0.5, window=Window(start_s=600.0, end_s=1680.0))]
    out = _compute(nets, triple)
    assert [m["edge"] for m in out["members"]] == [DOORSTEP, INCIDENT_EDGE]  # change order, gated
    assert [m["type"] for m in out["members"]] == ["road_closure", "incident"]
    assert out["members"][0]["window"] == {"start_s": 600.0, "end_s": 1200.0}
    assert out["probed_members_note"] == rp.PROBED_MEMBERS_NOTE  # the speed_limit gap is named
    assert out["window_coincidence_note"] == rp.WINDOW_COINCIDENCE_NOTE  # 600-1200 vs 600-1680
    single = _compute(nets, [_road_closure(DOORSTEP)])
    assert "probed_members_note" not in single  # every member probed → nothing to name


def test_closure_embraces_the_shape_split_end(nets) -> None:
    """KINGSTON's north end's ONLY passenger approach is KINGSTON itself (probed live). Under a
    full closure that end genuinely IS unreachable — the old anchor walk existed to dodge these
    nodes; the new fact embraces them. Baseline stays finite BECAUSE arriving via the segment
    itself is a real approach (the no-exclusions semantic)."""
    out = _compute(nets, [_road_closure(KINGSTON)])
    north = out["members"][0]["ends"][1]
    assert north["label"] == "north end"
    assert "status" not in north  # an approach EXISTS (the segment itself) — this is not no_approach
    for row in north["probes"]:
        assert row["baseline_s"] is not None  # reachable in baseline via KINGSTON itself
        assert row["scenario_s"] is None
        assert row["note"] == rp.END_UNREACHABLE_NOTE


def test_reverse_partner_keeps_the_east_end_reachable(nets) -> None:
    """One-way-closed two-way street: the doorstep edge's reverse partner (36784353#18) is simply
    an incoming approach at the east end — no special code, the net encodes it."""
    out = _compute(nets, [_road_closure(DOORSTEP)])
    east = out["members"][0]["ends"][0]
    assert east["label"] == "east end"
    reachable = [r for r in east["probes"] if r["scenario_s"] is not None]
    assert reachable, "east end should stay reachable via the reverse partner / other approaches"


def test_origin_closed_note_on_the_doorstep(nets) -> None:
    """Station 231's origin edge IS the closed edge — its rows carry a CAUSE, never four bare
    unreachables (explicit permission check on the scenario net, not sentinel inference)."""
    out = _compute(nets, [_road_closure(DOORSTEP)])
    o231 = next(o for o in out["origins"] if "231" in o["label"])
    assert o231["origin_edge"] == DOORSTEP
    assert o231["note"] == rp.ORIGIN_CLOSED_NOTE
    assert all("note" not in o or o["note"] != rp.ORIGIN_CLOSED_NOTE
               for o in out["origins"] if "231" not in o["label"])
    for end in out["members"][0]["ends"]:
        row = next(r for r in end["probes"] if "231" in r["label"])
        assert row["scenario_s"] is None
        assert row["note"] == rp.ORIGIN_CLOSED_NOTE


def test_no_approach_end_is_a_labeled_state(nets) -> None:
    out = _compute(nets, [_road_closure(NO_APPROACH_EDGE)])
    from_end = out["members"][0]["ends"][0]
    assert from_end["status"] == "no_approach"
    assert from_end["note"] == rp.NO_APPROACH_NOTE
    assert "probes" not in from_end  # four identical null rows would be noise, not information


def test_honest_zero_rows_carry_the_constant(nets) -> None:
    # a speed-factor incident far from most stations' fastest approaches yields zero rows
    out = _compute(nets, [_incident(speed_factor=0.5)])
    zeros = [r for m in out["members"] for e in m["ends"] for r in e.get("probes", [])
             if r.get("added_s") == 0.0]
    assert zeros, "shape assumption broken: expected at least one honest-zero row"
    for r in zeros:
        assert r["note"] == rp.HONEST_ZERO_END_NOTE


def test_rounding_self_consistency_and_determinism(nets) -> None:
    triple = [_road_closure(DOORSTEP, Window(start_s=600.0, end_s=1200.0)),
              _speed_limit(SPEED_EDGE),
              _incident(speed_factor=0.5, window=Window(start_s=600.0, end_s=1680.0))]
    out = _compute(nets, triple)
    for m in out["members"]:
        for e in m["ends"]:
            for r in e.get("probes", []):
                if r.get("added_s") is not None:
                    assert r["added_s"] == round(r["scenario_s"] - r["baseline_s"], 1)
                    assert 0 <= r["added_s"] < 36000
    assert out == _compute(nets, triple)  # deterministic end to end


def test_anti_resurrection_and_riding_notes(nets) -> None:
    """New payloads carry NONE of the retired anchor-walk keys — retirement is the point; the
    honesty sentences (framing / lower-bound / end-method / origins) ride every payload."""
    out = _compute(nets, [_road_closure(DOORSTEP)])
    for retired in ("destination_edge", "destination_note", "destination_anchor",
                    "anchor_note", "probes"):
        assert retired not in out, retired
    assert out["framing"] == rp.FRAMING
    assert out["lower_bound_note"] == rp.LOWER_BOUND_NOTE
    assert out["end_method_note"] == rp.END_METHOD_NOTE
    assert "do not indicate which station would respond" in out["origins_note"]
    assert out["modified_edges"] == [DOORSTEP]


def test_compute_response_detour_end_to_end_members_payload() -> None:
    # the production path: fresh net reads, all members applied to one scenario instance
    out = rp.compute_response_detour([_incident(blocked_lanes=[1, 2], edge=KINGSTON)])
    assert out["framing"] == rp.FRAMING and out["lower_bound_note"] == rp.LOWER_BOUND_NOTE
    assert out["end_method_note"] == rp.END_METHOD_NOTE
    assert len(out["origins"]) == 4
    assert all(o.get("represents") == "fire_station" for o in out["origins"])
    assert [m["edge"] for m in out["members"]] == [KINGSTON]
    for e in out["members"][0]["ends"]:
        assert e["label"] in ("north end", "south end")
        for r in e["probes"]:
            assert r["label"]
            if r.get("added_s") is not None:
                assert r["added_s"] == round(r["scenario_s"] - r["baseline_s"], 1)
