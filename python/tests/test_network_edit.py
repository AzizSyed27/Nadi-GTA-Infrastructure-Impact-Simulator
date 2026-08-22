"""Phase 5.1 — the new_road edit pipeline: pipeline-level geometry validation, edge minting, the netconvert
patch + safety gauntlet (canonical-untouched / additive / edge-count-delta / geo-ref / connectivity), and the
new_road scorecard access heuristic. SUMO-gated (the whole module needs sumolib + the canonical net)."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "python" / "src"))

try:  # run_sim wires SUMO_HOME/tools onto sys.path so sumolib imports — must precede it (the 4.2 pattern)
    import run_sim  # noqa: E402
    import sumolib  # noqa: E402
    import network_edit  # noqa: E402
    import scorecard  # noqa: E402
except Exception:  # pragma: no cover — SUMO not on this box
    pytest.skip("SUMO/sumolib unavailable (SUMO_HOME unset)", allow_module_level=True)
from contract_models import Change  # noqa: E402

pytestmark = pytest.mark.skipif(not run_sim.NET.is_file(), reason="corridor net unavailable")

# a junction pair verified to connect on the canonical net (used for the live-patch gauntlet test).
_A, _B = "266262655", "427757562"


def _new_road(**kw) -> Change:
    base = dict(type="new_road", target_edge="nr_A_B", from_junction="A", to_junction="B", lanes=1,
                speed_mps=13.9, description="x")
    base.update(kw)
    return Change(**base)


def _canon_net():
    return sumolib.net.readNet(str(run_sim.NET))


def _via_str(net, x: float, y: float) -> str:
    lon, lat = net.convertXY2LonLat(x, y)
    return f"{lon:.6f},{lat:.6f}"


def test_new_road_via_reason_matrix() -> None:
    """V2.6d — the four geometry rules, ONE source (`new_road_via_reason`), the SAME sentence at
    POST 400 / harness SystemExit / patch_network ValueError. Coordinates are derived from the
    real junction coords at test time (regen-proof). Check order pinned by construction: the
    lat/lon-SWAP case is caught by bbox containment (never a confusing distance sentence)."""
    import math
    net = _canon_net()
    if _A not in {n.getID() for n in net.getNodes()}:
        pytest.skip("known junction pair absent (net regenerated)")
    ax, ay = net.getNode(_A).getCoord()
    bx, by = net.getNode(_B).getCoord()
    dx, dy = bx - ax, by - ay
    ln = math.hypot(dx, dy)
    ux, uy = dx / ln, dy / ln          # along A->B
    px, py = -dy / ln, dx / ln         # perpendicular

    reason = network_edit.new_road_via_reason

    # unknown junction -> patch_network's own sentence, reused verbatim
    r = reason("NOPE", _B, [_via_str(net, ax + 100 * ux, ay + 100 * uy)], net)
    assert r == "junction 'NOPE' is not in the canonical net — pick an existing junction id"

    # cap: 9 points spaced along the line (each far apart; only the count trips)
    nine = [_via_str(net, ax + f * dx, ay + f * dy) for f in
            (0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9)]
    assert reason(_A, _B, nine, net) == "a new road takes at most 8 via points (got 9)"
    # THE BOUNDARY (review catch): exactly 8 vias is LEGAL — a >=-for-> mutant makes a FALSE
    # blocker the server backstop can never catch (the cross-language boundary-pin rule)
    assert reason(_A, _B, nine[:8], net) is None

    # bbox containment: a point far west of the study area
    assert reason(_A, _B, ["-80.5,43.75"], net) == "via point 1 is outside the study area"

    # the lat/lon SWAP class: a legitimate interior point, coordinates transposed
    mid_lon, mid_lat = net.convertXY2LonLat(ax + 0.5 * dx, ay + 0.5 * dy)
    swapped = f"{mid_lat:.6f},{mid_lon:.6f}"
    assert reason(_A, _B, [swapped], net) == "via point 1 is outside the study area"

    # min-segment: a via ~3 m from the from-node -> segment 1 is short
    r = reason(_A, _B, [_via_str(net, ax + 3 * ux, ay + 3 * uy)], net)
    assert r is not None and "must be at least 10 m apart" in r and "segment 1 is 3" in r

    # self-intersection: the bowtie — segment 1 (A->v1) properly crosses segment 3 (v2->B)
    v1 = _via_str(net, ax + 0.8 * dx + 500 * px, ay + 0.8 * dy + 500 * py)
    v2 = _via_str(net, ax + 0.2 * dx + 500 * px, ay + 0.2 * dy + 500 * py)
    assert reason(_A, _B, [v1, v2], net) == "the road crosses itself (segment 1 intersects segment 3)"

    # a valid gentle curve -> None
    ok = _via_str(net, ax + 0.5 * dx + 60 * px, ay + 0.5 * dy + 60 * py)
    assert reason(_A, _B, [ok], net) is None


def test_proper_crossing_pure() -> None:
    """The crossing predicate is PROPER (strict interiors): shared endpoints and collinear
    touches are NOT crossings — mutation-effective against a >=-style orientation test."""
    x = network_edit._proper_crossing
    assert x((0, 0), (10, 10), (0, 10), (10, 0)) is True       # clean crossing
    assert x((0, 0), (10, 0), (10, 0), (20, 10)) is False      # shared endpoint
    assert x((0, 0), (10, 0), (5, 0), (15, 0)) is False        # collinear overlap — not proper
    assert x((0, 0), (10, 0), (5, 5), (15, 5)) is False        # disjoint


def test_write_edg_xml_via_less_byte_pin(tmp_path: Path) -> None:
    """The no-regression pin: WITHOUT via, the .edg.xml is BYTE-IDENTICAL to today's output
    (a via-less new_road must not change behavior in any way)."""
    p = tmp_path / "x.edg.xml"
    network_edit._write_edg_xml(_new_road(bidirectional=True, lanes=2, speed_mps=20.0),
                                ["nr_A_B", "nr_B_A"], p)
    expected = (
        "<edges>\n"
        '  <edge id="nr_A_B" from="A" to="B" numLanes="2" speed="20.000" allow="passenger"/>\n'
        '  <edge id="nr_B_A" from="B" to="A" numLanes="2" speed="20.000" allow="passenger"/>\n'
        "</edges>\n"
    )
    assert p.read_text(encoding="utf-8") == expected


def test_write_edg_xml_with_shapes(tmp_path: Path) -> None:
    """With shapes, each edge gains ONLY a shape attribute (reverse = the reversed polyline,
    pinned at the writer — the readback centerlines sit on opposite sides by spreadType)."""
    p = tmp_path / "x.edg.xml"
    shapes = ["1.00,2.00 3.00,4.00 5.00,6.00", "5.00,6.00 3.00,4.00 1.00,2.00"]
    network_edit._write_edg_xml(_new_road(bidirectional=True, lanes=2, speed_mps=20.0),
                                ["nr_A_B", "nr_B_A"], p, shapes)
    expected = (
        "<edges>\n"
        '  <edge id="nr_A_B" from="A" to="B" numLanes="2" speed="20.000" allow="passenger" '
        'shape="1.00,2.00 3.00,4.00 5.00,6.00"/>\n'
        '  <edge id="nr_B_A" from="B" to="A" numLanes="2" speed="20.000" allow="passenger" '
        'shape="5.00,6.00 3.00,4.00 1.00,2.00"/>\n'
        "</edges>\n"
    )
    assert p.read_text(encoding="utf-8") == expected


def test_patch_curved_road_shape_and_length() -> None:
    """The LIVE curved patch (netconvert ~10s): one via ~400 m off the midpoint. Pins the whole
    point of V2.6d — edge length derives from the POLYLINE, not the chord — plus the probe's
    verdicts: 3 shape points survive (no pruning) and the gauntlet stays green under a shape.
    Chord = SHAPE endpoints (never node coords — SUMO trims ~13.5 m per end at junctions)."""
    import math
    net = _canon_net()
    if _A not in {n.getID() for n in net.getNodes()}:
        pytest.skip("known junction pair absent (net regenerated)")
    ax, ay = net.getNode(_A).getCoord()
    bx, by = net.getNode(_B).getCoord()
    dx, dy = bx - ax, by - ay
    ln = math.hypot(dx, dy)
    via = _via_str(net, (ax + bx) / 2 - dy / ln * 400, (ay + by) / 2 + dx / ln * 400)
    change = _new_road(target_edge=f"nr_{_A}_{_B}", from_junction=_A, to_junction=_B,
                       bidirectional=True, lanes=2, speed_mps=20.0, via=[via],
                       description="pytest curve")
    out_path, edge_ids, stats = network_edit.patch_network(change, "pytest-curve")
    try:
        assert stats["geo_ref_identical"]
        pn = sumolib.net.readNet(str(out_path))
        lengths = []
        for eid in edge_ids:
            e = pn.getEdge(eid)
            sh = e.getShape()
            assert len(sh) == 3, "SHAPE-FAITHFUL: one via -> exactly 3 shape points (probe: no pruning)"
            chord = math.dist(sh[0], sh[-1])
            poly = sum(math.dist(sh[i], sh[i + 1]) for i in range(len(sh) - 1))
            assert e.getLength() / chord > 1.02, "the whole point: a curve's length exceeds its chord"
            assert abs(e.getLength() - poly) / e.getLength() < 0.01, "length derives from the polyline"
            lengths.append(e.getLength())
        assert abs(lengths[0] - lengths[1]) / lengths[0] < 0.01, "reverse edge rides the same curve"
    finally:
        for suffix in (".net.xml", ".edg.xml", ".con.xml", ".loadprobe.log"):
            (out_path.parent / f"pytest-curve{suffix}").unlink(missing_ok=True)


def test_validate_new_road_requires_geometry() -> None:
    """Pipeline-level (NOT schema) negative: a new_road missing geometry fails network_edit validation."""
    network_edit.validate_new_road(_new_road())  # complete geometry -> no raise
    with pytest.raises(ValueError, match="geometry"):
        network_edit.validate_new_road(Change(type="new_road", target_edge="nr_A_B", description="x"))


def test_minted_edge_ids() -> None:
    assert network_edit.minted_edge_ids(_new_road()) == ["nr_A_B"]
    assert network_edit.minted_edge_ids(_new_road(bidirectional=True)) == ["nr_A_B", "nr_B_A"]


def test_scorecard_new_road_access_and_bike_lane_firewall() -> None:
    empty = {"car": {"outcomes": [{"id": "1", "delta_seconds": -1.0}]}, "bicycle": {"outcomes": []},
             "pedestrian": {"outcomes": []}}
    # v0.5.0: compute_scorecard takes the change LIST (a single-change scenario is a list of one).
    sc = scorecard.compute_scorecard(empty, [], [], [{"type": "new_road", "target_edge": "nr_A_B"}])
    g = {x.group: x for x in sc.groups}
    assert g["car_commuter"].access_delta.value == -0.5, "drivers gain access on a new_road (negative)"
    assert g["business_owner"].access_delta.value is None, "non-car groups: null magnitude..."
    assert "no access heuristic" in g["business_owner"].access_delta.note, "...WITH an honest note"
    # firewall: the bike_lane heuristic is untouched (NOT reused for new_road)
    sc2 = scorecard.compute_scorecard(empty, [], [], [{"type": "bike_lane", "target_edge": "E1"}])
    assert {x.group: x for x in sc2.groups}["car_commuter"].access_delta.value == 0.33


def test_scorecard_composite_access_is_honest_null() -> None:
    """v0.5.0 composite: when >1 change each contribute a car_commuter access heuristic, don't silently sum —
    emit a null magnitude WITH a note (per-group access not separable across composed changes)."""
    empty = {"car": {"outcomes": [{"id": "1", "delta_seconds": -1.0}]}, "bicycle": {"outcomes": []},
             "pedestrian": {"outcomes": []}}
    # both new_road (car_commuter -0.5) and bike_lane (car_commuter +0.33) touch car_commuter access.
    sc = scorecard.compute_scorecard(
        empty, [], [], [{"type": "new_road", "target_edge": "nr_A_B"}, {"type": "bike_lane", "target_edge": "E1"}]
    )
    cell = {x.group: x for x in sc.groups}["car_commuter"].access_delta
    assert cell.value is None, "composite must NOT silently sum overlapping heuristics"
    assert "composite scenario — 2 of 2 changes affect this group's access" in cell.note, \
        "...and must say WHY (honest null-with-note, contributors vs scenario size)"


def test_patch_gauntlet_canonical_untouched_and_additive() -> None:
    """Live netconvert patch + the full gauntlet on a real junction pair. Runs netconvert (~10s)."""
    if _A not in {n.getID() for n in sumolib.net.readNet(str(run_sim.NET)).getNodes()}:
        pytest.skip("known junction pair absent (net regenerated) — regen would need a fresh pair")
    change = _new_road(target_edge=f"nr_{_A}_{_B}", from_junction=_A, to_junction=_B, bidirectional=True,
                       speed_mps=20.0, lanes=2, description="pytest gauntlet")
    before = (run_sim.NET.stat().st_mtime_ns, run_sim.NET.stat().st_size)
    out_path, edge_ids, stats = network_edit.patch_network(change, "pytest-gauntlet")
    try:
        after = (run_sim.NET.stat().st_mtime_ns, run_sim.NET.stat().st_size)
        assert before == after, "CANONICAL-UNTOUCHED: corridor.net.xml must not change"
        assert out_path.resolve() != run_sim.NET.resolve()
        assert stats["geo_ref_identical"]
        assert stats["patched_edges"] - stats["canonical_edges"] == 2, "exactly the 2 new (bidirectional) edges"
        assert edge_ids == [f"nr_{_A}_{_B}", f"nr_{_B}_{_A}"]
        # CONNECTIVITY was asserted inside the gauntlet; re-confirm the new edges are routable here.
        pn = sumolib.net.readNet(str(out_path))
        for eid in edge_ids:
            e = pn.getEdge(eid)
            assert e.getIncoming() and e.getOutgoing(), f"{eid} must be routable (in+out)"
    finally:
        for name in ("pytest-gauntlet.net.xml", "pytest-gauntlet.edg.xml", "pytest-gauntlet.con.xml"):
            (out_path.parent / name).unlink(missing_ok=True)


def test_patch_signalized_junction_pair_passes_sumo_load_probe() -> None:
    """Regression: a new_road onto a TRAFFIC-LIGHT junction (252423218) used to pass the sumolib gauntlet but be
    REJECTED by SUMO's loader ('Invalid linkIndex') — `--tls.rebuild` + the SUMO load probe now make it valid.
    Runs netconvert + a SUMO load probe (~15s). patch_network raises if the probe fails, so success == valid."""
    a, b = "252423218", "427761305"
    net = sumolib.net.readNet(str(run_sim.NET))
    ids = {n.getID() for n in net.getNodes()}
    if not (a in ids and b in ids):
        pytest.skip("known TLS junction pair absent (net regenerated)")
    if net.getNode(a).getType() != "traffic_light":
        pytest.skip(f"junction {a} is no longer traffic_light — the TLS-rebuild path isn't exercised")
    change = _new_road(target_edge=f"nr_{a}_{b}", from_junction=a, to_junction=b, bidirectional=True,
                       speed_mps=13.9, lanes=2, description="pytest tls-rebuild")
    out_path, edge_ids, stats = network_edit.patch_network(change, "pytest-tls")  # raises if SUMO rejects the net
    try:
        assert stats["patched_edges"] - stats["canonical_edges"] == 2
        assert stats["geo_ref_identical"] and out_path.is_file()
    finally:
        for name in ("pytest-tls.net.xml", "pytest-tls.edg.xml", "pytest-tls.con.xml", "pytest-tls.loadprobe.log"):
            (out_path.parent / name).unlink(missing_ok=True)


def test_sumo_load_probe_rejects_an_invalid_net(tmp_path) -> None:
    """The gauntlet's SUMO load probe must REJECT (raise) a net SUMO can't load — the check that sumolib's
    lenient read can't make. A malformed net-file stands in for the TLS-linkIndex class of failure."""
    bad = tmp_path / "bad.net.xml"
    bad.write_text("<net><junction id='x'/></net>", encoding="utf-8")  # not a loadable SUMO net
    with pytest.raises(AssertionError, match="rejected by SUMO"):
        network_edit._sumo_load_probe(bad)


def test_list_junctions_returns_geo_targets() -> None:
    js = network_edit.list_junctions()
    assert js and all("id" in j and "lon" in j and "lat" in j for j in js[:5])
    assert all(-80 < j["lon"] < -78 and 43 < j["lat"] < 44 for j in js[:20]), "junctions in the GTA corridor"


def test_bike_eligibility_is_single_sourced() -> None:
    """The static pre-check defers to run_sim.bike_lane_reason — the SAME rule the live apply_change enforces
    (5.2b). The rule function: < MIN car lanes -> reason string; >= MIN -> None."""
    assert run_sim.bike_lane_reason([0], "e") is not None
    assert ">= 2 car lanes" in run_sim.bike_lane_reason([0], "e")
    assert run_sim.bike_lane_reason([0, 1], "e") is None
    # the static edge check agrees on real 1-lane / 2-lane edges
    net = sumolib.net.readNet(str(run_sim.NET))
    one = two = None
    for e in net.getEdges(withInternal=False):
        n = len(network_edit._car_lane_indices_static(net, e.getID()))
        if n == 1 and one is None:
            one = e.getID()
        if n >= 2 and two is None:
            two = e.getID()
        if one and two:
            break
    if two:
        assert network_edit.edge_bike_eligibility(net, two) == (True, "eligible")
    if one:
        ok, reason = network_edit.edge_bike_eligibility(net, one)
        assert ok is False and "car lanes" in reason
    assert network_edit.edge_bike_eligibility(net, "no-such-edge")[0] is False


def test_list_edges_shape_and_eligibility() -> None:
    rows = network_edit.list_edges()
    keys = {"id", "geometry", "speed_mps", "car_lane_count", "eligible_bike_lane", "eligibility_reason"}
    assert rows and all(keys <= set(r) for r in rows[:5])
    assert rows[0]["geometry"] and all(-80 < lon < -78 and 43 < lat < 44 for lon, lat in rows[0]["geometry"][:3])
    # eligibility flag is exactly the rule applied to the car-lane count (no drift)
    for r in rows[:80]:
        assert r["eligible_bike_lane"] == (r["car_lane_count"] >= run_sim.MIN_CAR_LANES_FOR_BIKE)
