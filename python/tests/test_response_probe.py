"""V2.2b — the emergency-response detour fact (free-flow routing, not a dispatch simulation).

Runs against the REAL canonical corridor net (module-scoped fixture, read once; every mutating
test undoes its mutation so the shared instances stay pristine). The speed_factor path pokes the
private sumolib ``Edge._speed`` (SUMO 1.27-pinned) — the guard test proves a vanished attr fails
the PRODUCTION computation loudly, not just a test.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "python" / "src"))

import response_probe as rp  # noqa: E402
from contract_models import Change, Effect, Window  # noqa: E402

KINGSTON = "42140001"  # the V2.2a acceptance arterial (car lanes [1,2,3]; lane 0 sidewalk)


def _lane_closure(lanes: list[int]) -> Change:
    return Change(type="lane_closure", target_edge=KINGSTON, target_lanes=lanes,
                  description="test closure")


def _road_closure() -> Change:
    return Change(type="road_closure", target_edge=KINGSTON, description="test road closure")


def _incident(speed_factor: float | None = None, blocked_lanes: list[int] | None = None) -> Change:
    return Change(type="incident", target_edge=KINGSTON, target_lanes=blocked_lanes,
                  window=Window(start_s=600.0, end_s=1800.0),
                  effect=Effect(blocked=True if blocked_lanes else None, speed_factor=speed_factor),
                  description="test incident")


@pytest.fixture(scope="module")
def nets():
    import run_sim
    import sumolib

    base = sumolib.net.readNet(str(run_sim.NET))
    scen = sumolib.net.readNet(str(run_sim.NET))
    return base, scen


def test_load_probes_returns_the_two_entry_points() -> None:
    probes = rp.load_probes()
    assert len(probes) == 2
    labels = " ".join(p["label"] for p in probes)
    assert "Markham" in labels and "Ellesmere" in labels
    for p in probes:
        assert -80 < p["lon"] < -79 and 43 < p["lat"] < 44


def test_origins_resolve_and_baseline_positive(nets) -> None:
    base, _ = nets
    for p in rp.load_probes():
        edge = rp.origin_edge(base, p["lon"], p["lat"])
        assert edge is not None and edge.allows("passenger")
    dest, note = rp.destination_edge(base, KINGSTON, modified={KINGSTON})
    assert dest is not None and note
    origin = rp.origin_edge(base, rp.load_probes()[0]["lon"], rp.load_probes()[0]["lat"])
    t = rp._route_seconds(base, origin, base.getEdge(dest))
    assert t is not None and t > 0


def test_destination_rule_deterministic_and_excludes_target(nets) -> None:
    base, _ = nets
    d1, n1 = rp.destination_edge(base, KINGSTON, modified={KINGSTON})
    d2, _ = rp.destination_edge(base, KINGSTON, modified={KINGSTON})
    assert d1 == d2  # deterministic
    assert d1 != KINGSTON
    assert "junction" in n1  # the note names the rule
    # The anchor must be a junction with an ALTERNATE approach — Kingston Rd's immediate toNode
    # is a pass-through shape-split (its only approach IS the target), which would degrade every
    # road_closure detour to "unreachable"; the rule walks downstream past those.
    dedge = base.getEdge(d1)
    alt_in = [e for e in dedge.getFromNode().getIncoming()
              if e.allows("passenger") and e.getID() not in (KINGSTON, d1)]
    assert alt_in, "destination anchor has no alternate approach — the walk rule regressed"


def test_road_closure_yields_a_computable_detour_not_unreachable(nets) -> None:
    # With the alternate-approach anchor, a full closure of Kingston Rd must produce a NUMBER
    # (the added seconds around the closed stretch) for at least one probe — not a blanket
    # "unreachable" from a pass-through anchor.
    base, scen = nets
    undo = rp.apply_to_net(scen, _road_closure())
    try:
        out = rp.detour_from_nets(base, scen, [_road_closure()], rp.load_probes())
        added = [p["added_s"] for p in out["probes"] if p["added_s"] is not None]
        assert added, f"no computable detour for any probe: {out['probes']}"
    finally:
        undo()


def test_sentinel_detection_is_threshold_not_equality() -> None:
    class _StubNet:
        def __init__(self, ret):
            self._ret = ret

        def getOptimalPath(self, *a, **k):
            return self._ret

    assert rp._route_seconds(_StubNet((None, 1e400)), "o", "d") is None
    assert rp._route_seconds(_StubNet((("e",), 1e300)), "o", "d") is None  # near-sentinel junk too
    assert rp._route_seconds(_StubNet((("e",), 245.7)), "o", "d") == 245.7


def test_road_closure_detour_and_undo_round_trip(nets) -> None:
    base, scen = nets
    before = {e.getID(): (tuple(ln.getPermissions() for ln in e.getLanes()), e.getSpeed())
              for e in (scen.getEdge(KINGSTON),)}
    undo = rp.apply_to_net(scen, _road_closure())
    try:
        assert not scen.getEdge(KINGSTON).getLanes()[1].allows("passenger")
        out = rp.detour_from_nets(base, scen, [_road_closure()], rp.load_probes())
        assert out["framing"] == rp.FRAMING
        assert out["lower_bound_note"] == rp.LOWER_BOUND_NOTE
        assert len(out["probes"]) == 2
        for pr in out["probes"]:
            if pr["added_s"] is None:
                assert pr["note"]  # unreachable is a labeled fact, never silence
            else:
                assert 0 <= pr["added_s"] < 36000  # never a 1e400-scale silent-wrong
    finally:
        undo()
    after = {e.getID(): (tuple(ln.getPermissions() for ln in e.getLanes()), e.getSpeed())
             for e in (scen.getEdge(KINGSTON),)}
    assert after == before


def test_partial_lane_closure_is_honest_zero_with_note(nets) -> None:
    base, scen = nets
    undo = rp.apply_to_net(scen, _lane_closure([1]))  # 1 of 3 car lanes — edge stays passable
    try:
        out = rp.detour_from_nets(base, scen, [_lane_closure([1])], rp.load_probes())
        for pr in out["probes"]:
            if pr["added_s"] == 0.0:
                assert "passable" in (pr.get("note") or "")
    finally:
        undo()


def test_speed_factor_slows_the_route(nets) -> None:
    base, scen = nets
    probes = rp.load_probes()
    dest_id, _ = rp.destination_edge(base, KINGSTON, modified={KINGSTON})
    origin = rp.origin_edge(base, probes[0]["lon"], probes[0]["lat"])
    base_t = rp._route_seconds(base, origin, base.getEdge(dest_id))
    undo = rp.apply_to_net(scen, _incident(speed_factor=0.25))
    try:
        scen_t = rp._route_seconds(scen, scen.getEdge(origin.getID()), scen.getEdge(dest_id))
        # cost changes ONLY if the baseline fastest path used the slowed edge; assert >= and
        # that the mutation itself took (the edge's routing speed really dropped).
        assert scen.getEdge(KINGSTON).getSpeed() == pytest.approx(base.getEdge(KINGSTON).getSpeed() * 0.25)
        assert scen_t is not None and base_t is not None and scen_t >= base_t
    finally:
        undo()
    assert scen.getEdge(KINGSTON).getSpeed() == pytest.approx(base.getEdge(KINGSTON).getSpeed())


def test_speed_guard_fails_production_when_attr_vanishes(nets, monkeypatch) -> None:
    _, scen = nets
    edge = scen.getEdge(KINGSTON)
    monkeypatch.delattr(edge, "_speed")
    with pytest.raises(RuntimeError, match="SUMO 1.27|version"):
        rp.apply_to_net(scen, _incident(speed_factor=0.5))


def test_compute_response_detour_end_to_end_payload() -> None:
    out = rp.compute_response_detour([_incident(blocked_lanes=[1, 2])])
    assert out["framing"] == rp.FRAMING and out["lower_bound_note"] == rp.LOWER_BOUND_NOTE
    assert out["destination_edge"] and len(out["probes"]) == 2
    for pr in out["probes"]:
        assert pr["label"] and pr["origin_edge"]
        if pr["added_s"] is not None and pr["scenario_s"] is not None:
            assert pr["added_s"] == round(pr["scenario_s"] - pr["baseline_s"], 1)
