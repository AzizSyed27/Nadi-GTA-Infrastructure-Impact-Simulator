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
    sc = scorecard.compute_scorecard(empty, [], [], {"type": "new_road", "target_edge": "nr_A_B"})
    g = {x.group: x for x in sc.groups}
    assert g["car_commuter"].access_delta.value == -0.5, "drivers gain access on a new_road (negative)"
    assert g["business_owner"].access_delta.value is None, "non-car groups: null magnitude..."
    assert "no access heuristic" in g["business_owner"].access_delta.note, "...WITH an honest note"
    # firewall: the bike_lane heuristic is untouched (NOT reused for new_road)
    sc2 = scorecard.compute_scorecard(empty, [], [], {"type": "bike_lane", "target_edge": "E1"})
    assert {x.group: x for x in sc2.groups}["car_commuter"].access_delta.value == 0.33


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


def test_list_junctions_returns_geo_targets() -> None:
    js = network_edit.list_junctions()
    assert js and all("id" in j and "lon" in j and "lat" in j for j in js[:5])
    assert all(-80 < j["lon"] < -78 and 43 < j["lat"] < 44 for j in js[:20]), "junctions in the GTA corridor"
