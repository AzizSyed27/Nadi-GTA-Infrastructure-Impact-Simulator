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


def test_load_probes_returns_the_four_fire_stations() -> None:
    # 4 of the 5 in-bbox stations: 221 is 381 m from the nearest modeled car edge (boundary-clipped
    # net) and was dropped per the test-driven selection rule — see _dropped in the JSON.
    probes = rp.load_probes()
    assert len(probes) == 4
    labels = " ".join(p["label"] for p in probes)
    for station in ("231", "232", "234", "243"):
        assert f"Station {station}" in labels
    for p in probes:
        assert -80 < p["lon"] < -79 and 43 < p["lat"] < 44
        assert p["represents"] == "fire_station"


def test_load_probes_never_folds_in_underscore_metadata() -> None:
    # _retired (the old corridor-entry origins) and any future _-prefixed top-level key are
    # DOCUMENTATION — the loader reads only the "probes" array, structurally. If this fails, the
    # probe set silently grew with mislabeled origins.
    import json

    raw = json.loads(rp.PROBES_PATH.read_text(encoding="utf-8"))
    assert "_retired" in raw  # history preserved in the file...
    labels = [p["label"] for p in rp.load_probes()]
    assert len(labels) == 4
    for lbl in labels:
        assert "corridor entry" not in lbl  # ...but NEVER loaded


def test_origins_note_carries_the_dispatch_guard() -> None:
    # real station names invite "this is the response time" / "the nearest station responds" —
    # the note must say routes are computed from EVERY station and indicate no dispatch choice.
    note = rp.origins_note()
    assert "Toronto Fire Services station locations" in note
    assert "do not indicate which station would respond" in note
    assert "Toronto Open Data" in note


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
        # station origins commonly yield HONEST zeros (their fastest routes never used the closed
        # stretch) — a zero must carry its explanation, never render as a bare number
        for p in out["probes"]:
            if p["added_s"] == 0.0:
                assert "does not use the changed road" in (p.get("note") or ""), p
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
        assert len(out["probes"]) == 4
        for pr in out["probes"]:
            if pr["added_s"] is None:
                assert pr["note"]  # unreachable is a labeled fact, never silence
            else:
                assert 0 <= pr["added_s"] < 36000  # never a 1e400-scale silent-wrong
                # the stored TRIPLE must be arithmetically self-consistent (a reader recomputes
                # from the rounded values; verify_facts enforces the same — caught live on the
                # Kingston road_closure where raw-vs-rounded straddled a rounding boundary)
                assert pr["added_s"] == round(pr["scenario_s"] - pr["baseline_s"], 1)
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
                assert "stays passable at unchanged free-flow speed" in (pr.get("note") or "")
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


def _speed_limit(edge: str = KINGSTON, mps: float = 8.33) -> Change:
    return Change(type="speed_limit", target_edge=edge, value_mps=mps, description="test limit")


def test_speed_limit_member_shapes_the_scenario_net(nets) -> None:
    # V2.4b: a mixed composite's speed_limit member must reach the during-window net — its edge
    # already enters the exclusion set, so an unapplied slowdown would under-report added_s.
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


def test_main_acceptance_shape_zero_note_branch(nets) -> None:
    """V2.4b pre-acceptance gate: for the acceptance draft's shape (road_closure + speed_limit +
    factor-only incident) ``blocked_only`` is FALSE — an honest zero must speak the
    route-avoidance sentence, never 'stays passable at unchanged free-flow speed' (which would
    be false with a speed_limit member composing)."""
    base, _ = nets
    d_single, _ = rp.destination_edge(base, KINGSTON, modified={KINGSTON})
    changes = [_road_closure(), _speed_limit(edge=d_single), _incident(speed_factor=0.5)]
    out = rp.compute_response_detour(changes)
    for pr in out["probes"]:
        note = pr.get("note") or ""
        assert "stays passable at unchanged free-flow speed" not in note
        if pr.get("added_s") == 0.0:
            assert note == ("the fastest route from this origin does not use the changed road "
                            "under free-flow conditions")


def test_compute_response_detour_end_to_end_payload() -> None:
    out = rp.compute_response_detour([_incident(blocked_lanes=[1, 2])])
    assert out["framing"] == rp.FRAMING and out["lower_bound_note"] == rp.LOWER_BOUND_NOTE
    assert out["destination_edge"] and len(out["probes"]) == 4
    assert out["origins_note"] and "do not indicate which station would respond" in out["origins_note"]
    assert all(pr.get("represents") == "fire_station" for pr in out["probes"])
    for pr in out["probes"]:
        assert pr["label"] and pr["origin_edge"]
        if pr["added_s"] is not None and pr["scenario_s"] is not None:
            assert pr["added_s"] == round(pr["scenario_s"] - pr["baseline_s"], 1)


def test_multi_member_modified_exclusion_and_anchor(nets) -> None:
    """V2.2d: the modified-edge EXCLUSION SET is the union over ALL composite members, and the
    destination stays anchored on changes[0]. PRODUCTION SIBLING since V2.4b: run
    multimodal-scenario-20260810T200300Z (road_closure + speed_limit + incident via the basket) —
    the 3-edge exclusion ran CLEAN on the primary destination branch (0 hops, no fallback, no
    uncomputable note); doorstep Station 231 unreachable, worst reachable +29.1 s."""
    base, _ = nets
    d_single, _ = rp.destination_edge(base, KINGSTON, modified={KINGSTON})
    # a second member claiming the single-member anchor forces a DIFFERENT pick — the union is honored
    d_multi, note = rp.destination_edge(base, KINGSTON, modified={KINGSTON, d_single})
    assert d_multi is not None and d_multi not in (KINGSTON, d_single)
    assert note
    # the full fact on a 2-member list: anchored on changes[0] (KINGSTON), both members excluded
    changes = [_road_closure(),
               Change(type="lane_closure", target_edge=d_single, target_lanes=[0],
                      description="second member on the single-member anchor")]
    out = rp.compute_response_detour(changes)
    assert out["destination_edge"] == d_multi  # changes[0] anchor, union exclusion
    assert len(out["probes"]) == 4
    # V2.4b: the exclusion set + anchor are logged in the payload, and the anchor's
    # order-dependence carries its note VERBATIM whenever >1 member composes.
    assert out["modified_edges"] == sorted({KINGSTON, d_single})
    assert out["destination_anchor"] == KINGSTON
    assert out["anchor_note"] == ("destination anchored to the first change; with multiple "
                                  "modified edges this choice is arbitrary and affects the estimate")
    single = rp.compute_response_detour([_road_closure()])
    assert single["modified_edges"] == [KINGSTON]
    assert single["destination_anchor"] == KINGSTON
    assert "anchor_note" not in single  # a single modified edge has no arbitrary choice to disclose
