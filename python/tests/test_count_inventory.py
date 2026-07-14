"""V2.1a — count-inventory helpers: bbox/recency/dedupe purity, the AM-peak window verdict, the offline
cache path, and the net-gated junction/edge matchers. No HTTP in any test."""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "python" / "src"))

try:  # run_sim wires SUMO_HOME/tools onto sys.path so sumolib imports — must precede it (the 4.2 pattern)
    import run_sim  # noqa: E402
    import sumolib  # noqa: E402
    import count_inventory as ci  # noqa: E402
except Exception:  # pragma: no cover — SUMO not on this box
    pytest.skip("SUMO/sumolib unavailable (SUMO_HOME unset)", allow_module_level=True)

BBOX = [-79.276, 43.727, -79.146, 43.794]
NET_GATED = pytest.mark.skipif(not run_sim.NET.is_file(), reason="corridor net unavailable")


# ---------------------------------------------------------------- pure helpers

def test_in_bbox() -> None:
    assert ci.in_bbox(-79.2, 43.75, BBOX)
    assert ci.in_bbox(BBOX[0], BBOX[1], BBOX)  # on-edge counts as inside
    assert not ci.in_bbox(-79.4, 43.75, BBOX)
    assert not ci.in_bbox(-79.2, 43.9, BBOX)
    assert not ci.in_bbox(None, 43.75, BBOX)
    assert not ci.in_bbox(0.0, 0.0, BBOX)  # null-ish coords are never "inside"


def test_recency_class_boundaries() -> None:
    assert ci.recency_class("2020-01-01") == "recent"
    assert ci.recency_class("2019-12-31") == "aging"
    assert ci.recency_class("2015-06-01") == "aging"
    assert ci.recency_class("2014-12-31") == "stale"
    assert ci.recency_class(None) == "unknown"
    assert ci.recency_class("garbage") == "unknown"


def test_dedupe_keeps_newest() -> None:
    rows = [
        {"longitude": -79.2, "latitude": 43.75, "latest_count_date": "2019-01-01"},
        {"longitude": -79.2, "latitude": 43.75, "latest_count_date": "2024-01-01"},
        {"longitude": -79.25, "latitude": 43.76, "latest_count_date": "2013-01-01"},
    ]
    out = ci.dedupe(rows, ci._loc_key, lambda r: r.get("latest_count_date"))
    assert len(out) == 2
    dup = next(r for r in out if r["latest_count_date"] == "2024-01-01")
    assert dup["n_duplicates"] == 1
    solo = next(r for r in out if r["latest_count_date"] == "2013-01-01")
    assert solo["n_duplicates"] == 0


def _bin(day: str, hhmm: str) -> dict:
    return {"count_date": day, "start_time": f"{day}T{hhmm}:00"}


def test_am_peak_verdict_full_window() -> None:
    bins = [_bin("2024-11-02", f"{h:02d}:{m:02d}") for h in (7, 8) for m in (0, 15, 30, 45)]
    v = ci.am_peak_verdict(bins)
    assert v["covered"] and v["slots_present"] == 8 and v["dates"] == ["2024-11-02"]


def test_am_peak_verdict_hours_outside_window() -> None:
    bins = [_bin("2024-11-02", f"{h:02d}:00") for h in range(10, 18)]  # counted 10:00-18:00 only
    v = ci.am_peak_verdict(bins)
    assert not v["covered"] and v["slots_present"] == 0 and v["bins_in_window"] == 0


def test_am_peak_verdict_partial() -> None:
    bins = [_bin("2024-11-02", t) for t in ("07:30", "07:45", "08:00")]
    v = ci.am_peak_verdict(bins)
    assert not v["covered"] and v["slots_present"] == 3 and v["slots_expected"] == 8


def test_am_peak_verdict_never_assembled_across_dates() -> None:
    """Two days that only TOGETHER span 07:00-09:00 do not count as covered — one coherent morning required."""
    bins = ([_bin("2024-11-02", f"07:{m:02d}") for m in (0, 15, 30, 45)]
            + [_bin("2024-11-09", f"08:{m:02d}") for m in (0, 15, 30, 45)])
    v = ci.am_peak_verdict(bins)
    assert not v["covered"] and v["slots_present"] == 4
    assert v["dates"] == ["2024-11-02", "2024-11-09"]


def test_bearing_compatible_wraps() -> None:
    assert ci.bearing_compatible(350.0, 0.0)  # 10 deg apart across the wrap
    assert not ci.bearing_compatible(180.0, 0.0)


def test_fetch_uses_cache_without_http(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(ci, "CACHE", tmp_path)
    monkeypatch.setattr(ci, "_http_get", lambda params: pytest.fail("cache hit must not touch HTTP"))
    blob = {"resource_id": ci.RESOURCES["tmc_recent"], "retrieved_at": "2026-07-14T00:00:00Z",
            "total": 1, "records": [{"latest_count_id": 1}]}
    (tmp_path / "tmc_recent.json").write_text(json.dumps(blob), encoding="utf-8")
    records, retrieved_at = ci.fetch_resource("tmc_recent")
    assert records == [{"latest_count_id": 1}]
    assert retrieved_at == "2026-07-14T00:00:00Z"


def test_render_markdown_smoke_zero_locations() -> None:
    inv = {
        "generated_at": "2026-07-14T00:00:00Z", "attribution": ci.ATTRIBUTION,
        "sources": {"TMC": {"package": ci.TMC_PACKAGE, "url": ci.DATASET_URLS["TMC"],
                            "resources": {"tmc_recent": "x"}},
                    "SVC": {"package": ci.SVC_PACKAGE, "url": ci.DATASET_URLS["SVC"],
                            "resources": {"svc_recent": "y"}}},
        "retrieved_at": {"tmc_recent": "2026-07-14T00:00:00Z"},
        "bbox": BBOX,
        "thresholds": {"junction_m": 30.0, "edge_m": 45.0, "report_radius_m": 150.0},
        "rollup": {"TMC": {"in_bbox": 0, "matched": 0, "recency": {}, "match_dist_histogram": {}},
                   "SVC": {"in_bbox": 0, "matched": 0, "recency": {}, "match_dist_histogram": {}},
                   "tmc_intersections": 0, "tmc_intersections_matched": 0, "am_peak_supported": 0,
                   "boundary_clipped": 0, "co_located_pairs_lt25m": 0,
                   "null_coords": {"TMC": 0, "SVC": 0}},
        "locations": [],
    }
    md = ci.render_markdown(inv)
    assert ci.ATTRIBUTION in md
    assert ci.DATASET_URLS["TMC"] in md
    assert "AM-peak calibration coverage" in md


# ---------------------------------------------------------------- net-gated matching

@pytest.fixture(scope="module")
def net():
    if not run_sim.NET.is_file():  # pragma: no cover
        pytest.skip("corridor net unavailable")
    return sumolib.net.readNet(str(run_sim.NET))


@NET_GATED
def test_match_junction_self(net) -> None:
    """A real junction's own coordinate matches itself at ~0 m (pinned id from test_network_edit)."""
    node = net.getNode("266262655")
    x, y = node.getCoord()
    jid, dist, ok = ci.match_junction(x, y, ci.junction_index(net), ci.JUNCTION_MATCH_M)
    assert ok and jid == "266262655" and dist is not None and dist < 1.0


@NET_GATED
def test_match_edge_perpendicular_offset(net) -> None:
    """A point ~10 m perpendicular off an edge's midpoint matches that edge or its reverse partner."""
    edge = next(e for e in net.getEdges(withInternal=False)
                if e.allows("passenger") and len(e.getShape()) >= 2 and e.getLength() > 50)
    (x0, y0), (x1, y1) = edge.getShape()[0], edge.getShape()[1]
    mx, my = (x0 + x1) / 2, (y0 + y1) / 2
    seg = math.hypot(x1 - x0, y1 - y0)
    px, py = -(y1 - y0) / seg, (x1 - x0) / seg  # unit perpendicular
    m = ci.match_edge(net, mx + 10 * px, my + 10 * py, ci.EDGE_MATCH_M)
    assert m["matched"]
    assert m["edge_id"] in {edge.getID(), ci._reverse_edge_id(edge)}


@NET_GATED
def test_far_point_unmatched(net) -> None:
    xmin, ymin, _, _ = net.getBoundary()
    jid, dist, ok = ci.match_junction(xmin - 5000, ymin - 5000, ci.junction_index(net), ci.JUNCTION_MATCH_M)
    assert not ok and jid is None and dist is None
    m = ci.match_edge(net, xmin - 5000, ymin - 5000, ci.EDGE_MATCH_M)
    assert not m["matched"] and m["edge_id"] is None
