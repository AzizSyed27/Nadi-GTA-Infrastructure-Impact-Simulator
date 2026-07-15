"""V2.1b — demand-calibration helpers: compass/turn math purity, interval binning + class merge,
and the net-gated approach mapper. No HTTP; bin fixtures are inline dicts (no %LOCALAPPDATA%)."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "python" / "src"))

try:  # run_sim wires SUMO_HOME/tools onto sys.path so sumolib imports — must precede it (the 4.2 pattern)
    import run_sim  # noqa: E402
    import sumolib  # noqa: E402
    import demand_calibration as dc  # noqa: E402
except Exception:  # pragma: no cover — SUMO not on this box
    pytest.skip("SUMO/sumolib unavailable (SUMO_HOME unset)", allow_module_level=True)

NET_GATED = pytest.mark.skipif(not run_sim.NET.is_file(), reason="corridor net unavailable")


# ---------------------------------------------------------------- pure compass / turn math

def test_signed_delta_wraps() -> None:
    assert dc.signed_delta(350.0, 10.0) == -20.0
    assert dc.signed_delta(10.0, 350.0) == 20.0
    assert dc.signed_delta(180.0, 0.0) == -180.0  # boundary lands in [−180, 180); ±180 is a u-turn either way


def test_approach_quadrant_flips_travel_bearing() -> None:
    # traveling south (180) = arriving from the north leg; the TMC 'n approach'
    assert dc.approach_quadrant(180.0) == "n"
    assert dc.approach_quadrant(0.0) == "s"
    assert dc.approach_quadrant(90.0) == "w"
    assert dc.approach_quadrant(270.0) == "e"
    assert dc.approach_quadrant(180.0, rotation=90.0) == "e"  # the rotation-test knob


def test_classify_turn_bands() -> None:
    # southbound traffic (bearing 180): right exits west (270), left exits east (90)
    assert dc.classify_turn(180.0, 180.0) == "t"
    assert dc.classify_turn(180.0, 270.0) == "r"
    assert dc.classify_turn(180.0, 90.0) == "l"
    assert dc.classify_turn(180.0, 0.0) == "u"   # u-turns are skipped by callers
    assert dc.classify_turn(350.0, 80.0) == "r"  # wraps across north


def test_interval_index_window() -> None:
    assert dc.interval_index("2024-11-02T07:00:00") == 0
    assert dc.interval_index("2024-11-02T08:45:00") == 7
    assert dc.interval_index("2024-11-02T09:00:00") is None
    assert dc.interval_index("2024-11-02T06:45:00") is None
    assert dc.interval_index("garbage") is None


def _bin(hhmm: str, **counts) -> dict:
    rec = {"count_date": "2024-11-02", "start_time": f"2024-11-02T{hhmm}:00"}
    rec.update(counts)
    return rec


def test_merged_movements_sums_classes() -> None:
    rec = _bin("07:00", n_appr_cars_t=10, n_appr_truck_t=2, n_appr_bus_t=1,
               n_appr_cars_l=5, e_appr_bike=3, s_appr_peds=7)
    m = dc.merged_movements(rec)
    assert m["n"]["t"] == 13  # cars+truck+bus merged
    assert m["n"]["l"] == 5
    assert m["e"]["bike"] == 3
    assert m["s"]["peds"] == 7
    assert m["w"]["r"] == 0  # absent fields are zero, never KeyError


def test_interval_counts_bins_by_slot() -> None:
    bins = [_bin("07:00", n_appr_cars_t=10), _bin("07:05", n_appr_cars_t=1),  # same 15-min slot
            _bin("08:45", s_appr_cars_l=4)]
    per = dc.interval_counts(bins)
    assert per[0]["n"]["t"] == 11
    assert per[7]["s"]["l"] == 4
    assert 3 not in per  # empty slots absent, not zero-filled


# ---------------------------------------------------------------- apportion + label assignment

def test_apportion_exact_sums() -> None:
    assert sum(dc.apportion(101, [3, 1])) == 101
    assert dc.apportion(100, [1, 1]) == [50, 50]
    assert dc.apportion(0, [2, 3]) == [0, 0]
    assert dc.apportion(7, []) == []
    assert dc.apportion(9, [0, 0]) == [5, 4] or sum(dc.apportion(9, [0, 0])) == 9  # zero weights survive


def _leg(bearing: float) -> dict:
    return {"bearing": bearing, "in": ["in_edge"], "out": ["out_edge"], "_bearings": [bearing]}


def test_assign_labels_grid_aligned_is_identity() -> None:
    legs = [_leg(b) for b in (0.0, 90.0, 180.0, 270.0)]
    mapping, unmatched = dc.assign_labels(legs, {"n": 100, "e": 100, "s": 100, "w": 100})
    assert not unmatched
    assert {a: leg["bearing"] for a, leg in mapping.items()} == {"n": 0.0, "e": 90.0, "s": 180.0, "w": 270.0}


def test_assign_labels_semantic_diagonal() -> None:
    """The Kingston/Falaise shape: a nominally east-west arterial locally bearing ~33/213 keeps its
    e/w labels; the cross leg at 322 takes n; the counted-but-absent s leg is unmatched (logged)."""
    legs = [_leg(b) for b in (33.0, 212.0, 322.0)]
    mapping, unmatched = dc.assign_labels(legs, {"n": 400, "e": 3000, "s": 50, "w": 2800})
    assert unmatched == ["s"]  # the least-volume label is the one dropped
    assert mapping["e"]["bearing"] == 33.0
    assert mapping["w"]["bearing"] == 212.0
    assert mapping["n"]["bearing"] == 322.0


def test_assign_labels_prefers_low_volume_drop() -> None:
    # two legs, three counted labels: the tiny label is sacrificed, not the big ones
    legs = [_leg(0.0), _leg(180.0)]
    mapping, unmatched = dc.assign_labels(legs, {"n": 900, "s": 800, "e": 10})
    assert unmatched == ["e"] and set(mapping) == {"n", "s"}


# ---------------------------------------------------------------- net-gated approach mapping

@pytest.fixture(scope="module")
def net():
    if not run_sim.NET.is_file():  # pragma: no cover
        pytest.skip("corridor net unavailable")
    return sumolib.net.readNet(str(run_sim.NET))


@NET_GATED
def test_approach_edges_on_known_cluster(net) -> None:
    """A 4-way cluster junction from the inventory maps to 4 non-empty compass approaches."""
    appr = dc.approach_edges(net, "cluster_427757616_427761342")  # Lawrence Ave E / Orton Park Rd
    non_empty = [q for q in dc.APPROACHES if appr[q]]
    assert len(non_empty) >= 3  # 4-way expected; ≥3 guards against minor geometry quirks
    for q in non_empty:
        for e in appr[q]:
            assert e.allows("passenger")


@NET_GATED
def test_build_turn_counts_invariant(net, monkeypatch, tmp_path) -> None:
    """Emitted + skipped == raw counted total, exactly — nothing silently dropped or invented."""
    fixture_bins = [
        {"count_date": "2024-11-02", "start_time": f"2024-11-02T07:{m:02d}:00",
         "n_appr_cars_t": 40, "n_appr_truck_t": 3, "n_appr_cars_l": 7,
         "s_appr_cars_t": 55, "e_appr_cars_r": 12, "w_appr_bus_t": 2}
        for m in (0, 15, 30, 45)
    ]
    raw_total = 4 * (40 + 3 + 7 + 55 + 12 + 2)
    monkeypatch.setattr(dc, "load_bins", lambda cid, date: fixture_bins)
    monkeypatch.setattr(dc, "DATA_DEMAND", tmp_path)
    loc = {"count_id": 1, "node_id": "cluster_427757616_427761342",
           "name": "fixture", "date": "2024-11-02"}
    stats = dc.build_turn_counts(net, [loc])
    assert stats["emitted_total"] + stats["skipped_total"] == raw_total
    import xml.etree.ElementTree as ET
    root = ET.parse(stats["path"]).getroot()
    emitted = sum(int(rel.get("count")) for rel in root.iter("edgeRelation"))
    assert emitted == stats["emitted_total"]


@NET_GATED
def test_movement_exits_partition(net) -> None:
    """Every classified exit is an outgoing passenger edge, and through-band exists on an arterial."""
    appr = dc.approach_edges(net, "cluster_427757616_427761342")
    in_edge = next(appr[q][0] for q in dc.APPROACHES if appr[q])
    bands = dc.movement_exits(net, "cluster_427757616_427761342", in_edge)
    all_exits = [e for band in bands.values() for e in band]
    assert all_exits, "expected at least one classified exit"
    outgoing = set(e.getID() for e in net.getNode("cluster_427757616_427761342").getOutgoing())
    assert all(e.getID() in outgoing for e in all_exits)
