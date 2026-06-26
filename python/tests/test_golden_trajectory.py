"""Golden-trajectory regression test for the Phase-0 spine.

Freezes a compact summary of a known-good run as `golden_trajectory.json`, then asserts that the
current artifact still validates against the frozen schema and reproduces that summary (within
tolerance). The pipeline is deterministic (`randomTrips --seed 42` + deterministic SUMO), so a
correct re-run reproduces the golden; a regression in the spine will not.

Run the test:        python -m pytest python/tests -v
Refresh the golden:  python python/tests/test_golden_trajectory.py   (after an INTENTIONAL change)
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
# Make `import trajectory_io` work under both pytest (`pythonpath = python/src`) and direct
# execution (`python python/tests/test_golden_trajectory.py`). Harmless duplicate under pytest.
sys.path.insert(0, str(REPO_ROOT / "python" / "src"))
import trajectory_io  # noqa: E402

RUNS_DIR = REPO_ROOT / "contract" / "runs"
GOLDEN_PATH = Path(__file__).resolve().parent / "golden_trajectory.json"
# Committed, hand-authored v0.2.0 fixture (always present, never skips) — a contract-shape canary.
SAMPLE_PATH = REPO_ROOT / "web" / "public" / "sample_v0_2_0.json"

SAMPLE_TARGET = 20  # ~this many vehicles sampled for the hash
SAMPLE_ROUND = 5  # decimal places for lon/lat in the sampled tuples (~1 m)


def resolve_artifact() -> Path | None:
    """Newest run artifact, or $NADI_RUN_ARTIFACT if set. None if nothing is available."""
    env = os.environ.get("NADI_RUN_ARTIFACT")
    if env:
        return Path(env)
    # Match only real sim runs (run_sim names them "corridor-<UTC>.json"), not hand-authored
    # fixtures like sample_v0_2_0.json that also live in contract/runs/.
    runs = sorted(RUNS_DIR.glob("corridor-*.json"))
    return runs[-1] if runs else None


def compute_summary(artifact: dict) -> dict:
    """Reduce a trajectory artifact to its stable, comparable summary."""
    vehicles = artifact["vehicles"]
    ordered = sorted(vehicles, key=lambda v: v["id"])  # lexicographic, deterministic
    stride = max(1, len(ordered) // SAMPLE_TARGET)
    sample = [
        [v["id"], round(v["path"][0][0], SAMPLE_ROUND), round(v["path"][0][1], SAMPLE_ROUND)]
        for v in ordered[::stride]
    ]
    sample_sha256 = hashlib.sha256(json.dumps(sample, separators=(",", ":")).encode()).hexdigest()
    meta = artifact["meta"]
    return {
        "schema_version": artifact["schema_version"],
        "vehicle_count": len(vehicles),
        "total_points": sum(len(v["path"]) for v in vehicles),
        "bbox": meta["bbox"],
        "sim_start": meta["sim_start"],
        "sim_end": meta["sim_end"],
        "step_length": meta["step_length"],
        "sample_sha256": sample_sha256,
    }


def test_golden_trajectory() -> None:
    art_path = resolve_artifact()
    if art_path is None or not art_path.is_file():
        pytest.skip(
            "No artifact in contract/runs/ (it is gitignored). "
            "Run `python python/src/run_sim.py` first, then re-run this test."
        )

    raw = json.loads(art_path.read_text(encoding="utf-8"))

    # (1) The artifact must validate against the frozen JSON Schema. Raises if not.
    trajectory_io.validate_artifact(raw)

    # (2) The summary must match the golden within tolerance.
    assert GOLDEN_PATH.is_file(), f"golden fixture missing: {GOLDEN_PATH}"
    golden = json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))
    summary = compute_summary(raw)

    # exact
    assert summary["schema_version"] == golden["schema_version"]
    assert summary["vehicle_count"] == golden["vehicle_count"]
    assert summary["sim_start"] == golden["sim_start"]
    assert summary["step_length"] == golden["step_length"]
    assert summary["sample_sha256"] == golden["sample_sha256"], (
        "sampled (id, first lon, first lat) hash changed — the spine produced different "
        "trajectories. If this change was intentional, refresh the golden."
    )

    # within tolerance
    for axis, (a, b) in enumerate(zip(summary["bbox"], golden["bbox"])):
        assert abs(a - b) <= 1e-6, f"bbox[{axis}] drifted: {a} vs {b}"
    assert abs(summary["total_points"] - golden["total_points"]) <= 0.02 * golden["total_points"], (
        f"total_points {summary['total_points']} vs golden {golden['total_points']} (>2%)"
    )
    assert abs(summary["sim_end"] - golden["sim_end"]) <= max(60.0, 0.02 * golden["sim_end"]), (
        f"sim_end {summary['sim_end']} vs golden {golden['sim_end']}"
    )


def assert_agents_wellformed(artifact: dict) -> None:
    """Validate a v0.2.0 artifact and check every agent is internally consistent.

    Used by two tests: the committed sample (contract-shape canary) and the newest real scenario run
    (the pipeline guard — exercises the harness→sampler→reactions vehicle_id join + outcome carry-through).
    """
    trajectory_io.validate_artifact(artifact)  # raises if it doesn't satisfy the frozen schema
    assert artifact["schema_version"] == "0.2.0", "expected a v0.2.0 (agents-bearing) artifact"

    meta = artifact["meta"]
    sim_start, sim_end = meta["sim_start"], meta["sim_end"]
    veh_ids = {v["id"] for v in artifact["vehicles"]}
    agents = artifact.get("agents", [])
    assert agents, "expected a non-empty agents array"

    for a in agents:
        vid = a["vehicle_id"]
        assert vid in veh_ids, f"agent vehicle_id {vid!r} not present in vehicles[]"
        tt = a["trigger_t"]
        assert sim_start <= tt <= sim_end, f"agent {vid} trigger_t {tt} outside [{sim_start}, {sim_end}]"
        sentiment = a["reaction"]["sentiment"]
        assert -1.0 <= sentiment <= 1.0, f"agent {vid} sentiment {sentiment} outside [-1, 1]"
        o = a["outcome"]
        # delta is rounded to 3 dp in join_outcomes but the durations are not, so allow float slack.
        expected_delta = o["scenario_duration"] - o["baseline_duration"]
        assert abs(o["delta_seconds"] - expected_delta) < 1e-2, (
            f"agent {vid} outcome math: delta_seconds {o['delta_seconds']} != "
            f"scenario - baseline ({expected_delta})"
        )


def test_v0_2_0_sample_agents() -> None:
    """Contract-shape canary on the committed hand-authored sample (always runs)."""
    assert SAMPLE_PATH.is_file(), f"committed sample fixture missing: {SAMPLE_PATH}"
    artifact = json.loads(SAMPLE_PATH.read_text(encoding="utf-8"))
    assert_agents_wellformed(artifact)


def test_scenario_pipeline_agents() -> None:
    """Pipeline guard on the newest real scenario run (skips if none on disk — runs are gitignored)."""
    runs = sorted(RUNS_DIR.glob("scenario-*.json"))
    if not runs:
        pytest.skip(
            "No scenario-*.json in contract/runs/ (gitignored). "
            "Run the run-scenario pipeline (scenario_harness -> sampler -> reactions) first."
        )
    artifact = json.loads(runs[-1].read_text(encoding="utf-8"))
    assert_agents_wellformed(artifact)


def _write_golden() -> None:
    art_path = resolve_artifact()
    if art_path is None or not art_path.is_file():
        raise SystemExit("No artifact to freeze. Run python/src/run_sim.py first.")
    raw = json.loads(art_path.read_text(encoding="utf-8"))
    trajectory_io.validate_artifact(raw)  # never freeze an invalid artifact
    summary = compute_summary(raw)
    GOLDEN_PATH.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(f"wrote golden from {art_path.name} -> {GOLDEN_PATH}")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    # `python python/tests/test_golden_trajectory.py` (re)generates the golden from the current run.
    _write_golden()
