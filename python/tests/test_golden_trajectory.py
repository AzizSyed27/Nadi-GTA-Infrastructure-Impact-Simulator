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
import contract_models  # noqa: E402
import trajectory_io  # noqa: E402
from jsonschema import ValidationError as SchemaValidationError  # noqa: E402
from pydantic import ValidationError as ModelValidationError  # noqa: E402

RUNS_DIR = REPO_ROOT / "contract" / "runs"
GOLDEN_PATH = Path(__file__).resolve().parent / "golden_trajectory.json"
# Committed, hand-authored fixtures (always present, never skip) — contract-shape canaries.
SAMPLE_PATH = REPO_ROOT / "web" / "public" / "sample_v0_2_0.json"
SAMPLE_V3_PATH = REPO_ROOT / "web" / "public" / "sample_v0_3_0.json"

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


# ---------------------------------------------------------------------------
# v0.3.0 contract (additive over v0.2.0). Existing v0.2.0 assertions above are UNCHANGED.
# ---------------------------------------------------------------------------


def test_v0_3_0_sample() -> None:
    """The committed v0.3.0 sample validates (schema + model) and every new structure is well-formed."""
    assert SAMPLE_V3_PATH.is_file(), f"committed v0.3.0 sample missing: {SAMPLE_V3_PATH}"
    raw = json.loads(SAMPLE_V3_PATH.read_text(encoding="utf-8"))

    # (1) schema + (2) model (the model enforces the sim/inferred grounding invariant).
    trajectory_io.validate_artifact(raw)
    trajectory_io.load_artifact(SAMPLE_V3_PATH)
    assert raw["schema_version"] == "0.3.0"

    meta = raw["meta"]
    sim_start, sim_end = meta["sim_start"], meta["sim_end"]
    veh_ids = {v["id"] for v in raw["vehicles"]}
    person_ids = {p["id"] for p in raw.get("persons", [])}

    # agents: grounding invariant + id resolution + trigger_t within the sim window.
    for a in raw.get("agents", []):
        pinned = [x for x in (a.get("vehicle_id"), a.get("person_id")) if x is not None]
        if a["grounding"] == "sim":
            assert len(pinned) == 1, f"sim agent needs exactly one id, got {pinned}"
            assert "outcome" in a and "trigger_t" in a, "sim agent needs outcome + trigger_t"
            assert sim_start <= a["trigger_t"] <= sim_end, "trigger_t outside sim window"
        else:  # inferred
            assert not pinned and "outcome" not in a and "trigger_t" not in a, (
                "inferred agent must have no id/outcome/trigger_t"
            )
        if a.get("vehicle_id") is not None:
            assert a["vehicle_id"] in veh_ids, f"agent vehicle_id {a['vehicle_id']!r} not in vehicles[]"
        if a.get("person_id") is not None:
            assert a["person_id"] in person_ids, f"agent person_id {a['person_id']!r} not in persons[]"

    # conflicts: required fields present + t within the sim window.
    for c in raw.get("conflicts", []):
        assert sim_start <= c["t"] <= sim_end, f"conflict t {c['t']} outside sim window"
        assert isinstance(c["type"], str) and c["type"], "conflict type must be a non-empty string"

    # scorecard: groups well-formed (grounding enum; deltas number-or-null).
    for g in raw.get("scorecard", {}).get("groups", []):
        assert g["grounding"] in ("sim", "inferred")
        for key in ("travel_time_delta", "safety_delta", "access_delta"):
            assert g.get(key) is None or isinstance(g[key], (int, float)), f"{key} must be number or null"


def test_grounding_conditional_bites() -> None:
    """The schema if/then is the SOLE enforcement of grounding — prove it discriminates by version.

    A 0.3.0 artifact whose agent lacks `grounding` must FAIL; the SAME agent under 0.2.0 must PASS.
    Without this, a fail-open conditional silently enforces nothing while every happy-path test stays green.
    """
    base = json.loads(SAMPLE_PATH.read_text(encoding="utf-8"))  # a valid v0.2.0 artifact
    grounding_less_agent = {
        "vehicle_id": base["vehicles"][0]["id"],
        "persona": {"id": "x", "label": "X"},
        "outcome": {
            "baseline_duration": 1.0, "scenario_duration": 2.0, "delta_seconds": 1.0,
            "baseline_timeloss": 0.0, "scenario_timeloss": 0.0,
        },
        "reaction": {"comment": "c", "sentiment": 0.0, "stance": "neutral"},
        "trigger_t": 1.0,
    }
    doc = {"schema_version": "0.3.0", "meta": base["meta"], "vehicles": base["vehicles"], "agents": [grounding_less_agent]}

    with pytest.raises(SchemaValidationError):
        trajectory_io.validate_artifact(doc)  # 0.3.0 REQUIRES grounding

    doc["schema_version"] = "0.2.0"
    trajectory_io.validate_artifact(doc)  # same agent is fine under 0.2.0 (no grounding required)


def test_agent_invariant_enforced() -> None:
    """The pydantic model rejects sim/inferred field-presence violations the schema leaves loose."""
    persona = {"id": "p", "label": "P"}
    reaction = {"comment": "c", "sentiment": 0.0, "stance": "neutral"}
    outcome = {
        "baseline_duration": 1.0, "scenario_duration": 2.0, "delta_seconds": 1.0,
        "baseline_timeloss": 0.0, "scenario_timeloss": 0.0,
    }
    # inferred agent must NOT carry a pin.
    with pytest.raises(ModelValidationError):
        contract_models.Agent(grounding="inferred", vehicle_id="v0", persona=persona, reaction=reaction)
    # sim agent must carry outcome + trigger_t.
    with pytest.raises(ModelValidationError):
        contract_models.Agent(grounding="sim", vehicle_id="v0", persona=persona, reaction=reaction)
    # a well-formed inferred agent (no pin/outcome/trigger_t) is accepted.
    contract_models.Agent(grounding="inferred", persona=persona, reaction=reaction)
    # a well-formed sim agent (one id + outcome + trigger_t) is accepted.
    contract_models.Agent(
        grounding="sim", vehicle_id="v0", outcome=contract_models.Outcome(**outcome),
        trigger_t=1.0, persona=contract_models.Persona(**persona),
        reaction=contract_models.Reaction(**reaction),
    )


def test_scorecard_null_delta_roundtrips() -> None:
    """dump_artifact uses exclude_none — a scorecard group with a null delta must still re-validate
    (null omitted-as-absent is schema-valid, since deltas are optional). Guards the exclude_none trap."""
    raw = json.loads(SAMPLE_V3_PATH.read_text(encoding="utf-8"))
    art = contract_models.TrajectoryArtifact.model_validate(raw)
    assert any(  # the sample already carries null deltas (inferred groups with no trip)
        g.travel_time_delta is None for g in art.scorecard.groups
    ), "expected the sample scorecard to exercise null deltas"
    out = RUNS_DIR / "_rt_scorecard_null.json"
    try:
        trajectory_io.dump_artifact(art, path=out)  # validates against the schema on write
        trajectory_io.validate_artifact(json.loads(out.read_text(encoding="utf-8")))  # and re-validate
    finally:
        out.unlink(missing_ok=True)


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
