"""V2.7d C2 — the RUNTIME street-name resolver: name-plus-id, never name-instead-of-id.

`street_names.name_of` / `describe_edge` / `report_edge_ref` read `web/public/network.json` (the ONE
runtime name source on both sides of the Python<->TS boundary) and degrade to id-only when the edge
is unnamed or the asset is missing — never a raise. The unnamed forms are BYTE-IDENTICAL to the
pre-V2.7d strings, which is what keeps every fixture, golden and spec that renders an `E1`-class id
unchanged: a red `test_report_golden` after C2 means the format leaked into the unnamed branch.

The TS mirror (`web/lib/streetNames.ts`, C3) pins the SAME two `describeEdge` forms as literals — the
python<->TS lockstep of the V2.6c compact-time pin.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
import street_names  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
NETWORK_JSON = ROOT / "web" / "public" / "network.json"
MARKHAM = "-1288863201"  # Markham Road on the canonical net (probed 2026-09-13)

needs_asset = pytest.mark.skipif(not NETWORK_JSON.is_file(), reason="network.json unavailable")


@pytest.fixture(autouse=True)
def _fresh_cache():
    street_names.reset_name_cache()
    yield
    street_names.reset_name_cache()


@needs_asset
def test_name_of_reads_the_export():
    assert street_names.name_of(MARKHAM) == "Markham Road"
    assert street_names.name_of("E1") is None  # a fixture id has no row — None, never a raise


@needs_asset
def test_describe_edge_is_name_plus_id_and_id_only_when_unnamed():
    assert street_names.describe_edge(MARKHAM) == "Markham Road (edge -1288863201)"
    assert street_names.describe_edge("E1") == "edge E1"  # byte-identical to the pre-V2.7d wording


@needs_asset
def test_describe_edge_tail_rides_inside_the_parenthetical():
    # the incident description's "(incident)" tag: unnamed keeps its exact old form
    assert street_names.describe_edge(MARKHAM, tail="incident") == "Markham Road (edge -1288863201, incident)"
    assert street_names.describe_edge("E1", tail="incident") == "edge E1 (incident)"


@needs_asset
def test_report_edge_ref_keeps_the_backticked_id():
    assert street_names.report_edge_ref(MARKHAM) == "Markham Road, edge `-1288863201`"
    assert street_names.report_edge_ref("E1") == "edge `E1`"


def test_missing_asset_degrades_to_id_only(tmp_path, monkeypatch):
    monkeypatch.setattr(street_names, "NETWORK_JSON", tmp_path / "absent.json")
    street_names.reset_name_cache()
    assert street_names.name_of(MARKHAM) is None
    assert street_names.describe_edge(MARKHAM) == "edge -1288863201"
    assert street_names.report_edge_ref(MARKHAM) == "edge `-1288863201`"


def test_a_damaged_asset_degrades_to_id_only(tmp_path, monkeypatch):
    bad = tmp_path / "network.json"
    bad.write_text("{not json", encoding="utf-8")
    monkeypatch.setattr(street_names, "NETWORK_JSON", bad)
    street_names.reset_name_cache()
    assert street_names.name_of(MARKHAM) is None
