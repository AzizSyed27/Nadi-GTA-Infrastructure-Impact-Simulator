"""V2.6c/D6b — the builders route timestamps through encode_trajectory_fields: the write-time
regularity check IS compact_encoding (per-point closed-form comparison within the shared eps),
so regular entities compact to {t0, dt} and teleport-gapped entities keep their TRUE explicit
arrays — lossless by construction, byte-verified through dump/load here."""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "python" / "src"))

import scenario_harness  # noqa: E402
import trajectory_io  # noqa: E402
from contract_models import Change  # noqa: E402

REG_TS = [4.0 + i for i in range(6)]
GAP_TS = [0.0, 1.0, 2.0, 40.0, 41.0, 42.0]
SP = [1.0] * 6


def _records() -> dict:
    return {
        "v_reg": {"type": "car", "path": [[0.0, 0.0]] * 6, "timestamps": list(REG_TS), "speeds": list(SP)},
        "v_gap": {"type": "car", "path": [[0.1, 0.1]] * 6, "timestamps": list(GAP_TS), "speeds": list(SP)},
        "p_reg": {"type": "pedestrian", "path": [[0.2, 0.2]] * 6, "timestamps": list(REG_TS), "speeds": list(SP)},
    }


def _build_and_dump(tmp_path: Path):
    art = scenario_harness.build_multimodal_artifact(
        _records(), [], run_id="d6b-test", baseline_run_id="d6b-base",
        changes=[Change(type="speed_limit", target_edge="E1", value_mps=8.33, description="x")],
        bbox=[-1.0, -1.0, 1.0, 1.0], sim_end=60.0, step=1.0)
    path = trajectory_io.dump_artifact(art, path=tmp_path / "d6b.json")
    return art, json.loads(path.read_text(encoding="utf-8")), trajectory_io.load_artifact(path)


def test_builder_emits_compact_for_regular_entities(tmp_path) -> None:
    _, raw, reloaded = _build_and_dump(tmp_path)
    v = next(x for x in raw["vehicles"] if x["id"] == "v_reg")
    assert v["t0"] == 4.0 and v["dt"] == 1.0
    assert "timestamps" not in v and "speeds" not in v
    p = next(x for x in raw["persons"] if x["id"] == "p_reg")
    assert p["t0"] == 4.0 and p["dt"] == 1.0
    # the reload's uniform view reproduces the record array EXACTLY (closed form, no drift)
    rv = next(x for x in reloaded.vehicles if x.id == "v_reg")
    assert rv.timestamps_of() == REG_TS


def test_builder_keeps_explicit_for_gapped_entities(tmp_path) -> None:
    _, raw, reloaded = _build_and_dump(tmp_path)
    v = next(x for x in raw["vehicles"] if x["id"] == "v_gap")
    assert v["timestamps"] == GAP_TS  # the TRUE hole, untouched
    assert "t0" not in v and "dt" not in v and "speeds" not in v
    rv = next(x for x in reloaded.vehicles if x.id == "v_gap")
    assert rv.timestamps_of() == GAP_TS
    assert [list(pt) for pt in rv.path] == [[0.1, 0.1]] * 6  # coords byte-equal through dump/load


def test_mixed_artifact_point_counts(tmp_path) -> None:
    """The python F3 twin: total path points == total materialized time points == the records'
    true counts — a compact-expansion off-by-one or a dropped tail diverges here."""
    _, _, reloaded = _build_and_dump(tmp_path)
    ents = [*reloaded.vehicles, *reloaded.persons]
    assert sum(len(e.path) for e in ents) == 18
    assert sum(len(e.timestamps_of()) for e in ents) == 18
