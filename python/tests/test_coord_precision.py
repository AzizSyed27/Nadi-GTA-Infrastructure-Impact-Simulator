"""V2.6c/D6c — 6-decimal coordinates (~11 cm) applied at RECORD time in the writers (_record /
SpillRecorder._flush / run_sim's loop), NEVER in dump_artifact: the committed older samples must
keep round-tripping byte-identically. Literal anchors on both tests (the shared-blind-spot rule:
round(x, COORD_DECIMALS) asserted against hand-written values, not against another round call)."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from types import SimpleNamespace

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "python" / "src"))

import run_sim  # noqa: E402
import scenario_harness  # noqa: E402


def test_record_rounds_coords_to_6dp(monkeypatch) -> None:
    monkeypatch.setattr(run_sim, "conn", SimpleNamespace(
        simulation=SimpleNamespace(convertGeo=lambda x, y: (x / 3.0, y / 7.0))))
    records: dict = {}
    scenario_harness._record(records, "veh0", "car", (1.0, 1.0), 5.0, 0.0)
    lon, lat = records["veh0"]["path"][0]
    assert lon == 0.333333 and lat == 0.142857  # hand-written 6-dp literals


def test_spill_flush_rounds_coords_to_6dp(tmp_path: Path) -> None:
    rec = scenario_harness.SpillRecorder(tmp_path / "s.jsonl",
                                         convert=lambda x, y: (x / 3.0, y / 7.0))
    rec.record("veh0", "car", 1.0, 1.0, 5.0, 0.0)
    rec.record("veh0", "car", 2.0, 2.0, 5.0, 1.0)
    rec.finalize()  # flushes actives through the same _flush path
    line = json.loads((tmp_path / "s.jsonl").read_text(encoding="utf-8").splitlines()[0])
    assert line["path"][0] == [0.333333, 0.142857]
    assert line["path"][1] == [0.666667, 0.285714]
