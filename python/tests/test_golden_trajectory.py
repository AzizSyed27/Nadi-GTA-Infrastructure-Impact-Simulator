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
SAMPLE_V4_PATH = REPO_ROOT / "web" / "public" / "sample_v0_4_0.json"
SAMPLE_V5_PATH = REPO_ROOT / "web" / "public" / "sample_v0_5_0.json"
SAMPLE_V6_PATH = REPO_ROOT / "web" / "public" / "sample_v0_6_0.json"

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


def assert_agents_wellformed(artifact: dict, expected_version: str | None = None) -> None:
    """Validate an agents-bearing artifact and check every agent is internally consistent.

    Used by two tests: the committed sample (contract-shape canary — pins its version) and the newest real
    scenario run (the pipeline guard — exercises the harness→sampler→reactions vehicle_id join + outcome
    carry-through; its version is whatever the producer currently emits, so it is not pinned here).
    """
    trajectory_io.validate_artifact(artifact)  # raises if it doesn't satisfy the frozen schema
    if expected_version is not None:
        assert artifact["schema_version"] == expected_version, f"expected a v{expected_version} artifact"

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
    assert_agents_wellformed(artifact, expected_version="0.2.0")


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

    # scorecard: groups well-formed (grounding enum; deltas are null OR an enriched cell {value, affected_share}).
    for g in raw.get("scorecard", {}).get("groups", []):
        assert g["grounding"] in ("sim", "inferred")
        for key in ("travel_time_delta", "safety_delta", "access_delta"):
            cell = g.get(key)
            if cell is None:
                continue
            assert isinstance(cell, dict), f"{key} must be null or a cell object"
            assert cell.get("value") is None or isinstance(cell["value"], (int, float)), f"{key}.value must be number|null"
            share = cell.get("affected_share")
            assert share is None or (0.0 <= share <= 1.0), f"{key}.affected_share must be in [0,1] or null"
            # v0.3.0 (2.5): optional trust flag + free-text caveat.
            conf = cell.get("confidence")
            assert conf in (None, "measured", "low"), f"{key}.confidence must be measured|low|null"
            assert "note" not in cell or isinstance(cell["note"], str), f"{key}.note must be a string when present"


def test_multimodal_artifact_valid() -> None:
    """Pipeline guard on the newest REAL multimodal v0.3.0 artifact. Skips if none on disk (gitignored).
    Validates schema + model, conflicts[] well-formed, and (post-2.4b) the 7-group scorecard."""
    runs = sorted(RUNS_DIR.glob("multimodal-scenario-*.json"))
    if not runs:
        pytest.skip("No multimodal-scenario-*.json in contract/runs/ — run scenario_harness.py first.")
    art = trajectory_io.load_artifact(runs[-1])  # schema + model round-trip (also enforces the agent invariant)
    # Produced by scenario_harness. Historically 0.3.0 (bumped to 0.4.0 by social); current producers emit
    # the current SCHEMA_VERSION — keep the accepted set open-ended forward (pin the SHAPE, not the version).
    assert art.schema_version in ("0.3.0", "0.4.0", "0.5.0", "0.6.0")
    if art.social is not None:
        assert art.schema_version in ("0.4.0", "0.5.0", "0.6.0"), "an artifact carrying a social{} block must be v0.4.0+"
    assert art.vehicles and art.persons, "expected multi-modal vehicles + persons"
    veh_ids = {v.id for v in art.vehicles}
    ped_ids = {p.id for p in art.persons}
    s0, s1 = art.meta.sim_start, art.meta.sim_end
    # v0.6.0: a CAPPED artifact (meta.render_sample present) keeps FULL-POPULATION conflicts while
    # vehicles[]/persons[] hold only the render sample — conflict entities may legitimately not be
    # rendered. The strict membership invariant applies only to uncapped artifacts.
    capped = getattr(art.meta, "render_sample", None) is not None
    for c in art.conflicts:
        assert s0 <= c.t <= s1, f"conflict t {c.t} outside sim window"
        assert c.type in ("rear_end", "crossing", "lane_change", "other")
        assert 0.0 <= c.severity <= 1.0
        if not capped:
            for e in c.entities or []:
                assert e in veh_ids or e in ped_ids, f"conflict entity {e!r} not in vehicles/persons"

    # 2.5b: agents[] are wired by the (generative) reaction step. Validate WHEN present (a fresh run may
    # not have them yet). The model already enforced the grounding invariant on load; here we additionally
    # check that sim pins resolve into vehicles/persons and inferred agents carry no pin.
    for a in art.agents:
        if a.grounding == "sim":
            pins = [x for x in (a.vehicle_id, a.person_id) if x is not None]
            assert len(pins) == 1 and (pins[0] in veh_ids or pins[0] in ped_ids), f"sim agent pin {pins} unresolved"
            assert a.outcome is not None and a.trigger_t is not None and s0 <= a.trigger_t <= s1
        else:
            assert not any((a.vehicle_id, a.person_id, a.outcome, a.trigger_t)), "inferred agent must carry no pin/outcome/trigger_t"

    # 2.4b: the scorecard is injected. 7 groups, valid grounding, well-formed enriched cells.
    assert art.scorecard is not None, "2.4b injects the scorecard"
    groups = art.scorecard.groups
    assert len(groups) == 7, f"expected 7 stakeholder groups, got {len(groups)}"
    for g in groups:
        assert g.grounding in ("sim", "inferred")
        for cell in (g.travel_time_delta, g.safety_delta, g.access_delta):
            if cell is None:
                continue
            assert cell.value is None or isinstance(cell.value, (int, float))
            assert cell.affected_share is None or (0.0 <= cell.affected_share <= 1.0)
    # sim groups carry a measured travel_time cell; inferred groups do not.
    by = {g.group: g for g in groups}
    assert by["car_commuter"].travel_time_delta is not None and by["car_commuter"].travel_time_delta.affected_share is not None
    assert by["local_resident"].travel_time_delta is None
    # 2.5 close-out — the honesty labeling landed: travel_time cells are MEASURED, safety cells are LOW
    # (the seed-flip caveat), and every cell carries a confidence flag.
    for g in groups:
        for cell in (g.travel_time_delta, g.safety_delta, g.access_delta):
            if cell is not None:
                assert cell.confidence in ("measured", "low"), f"{g.group} cell missing confidence flag"
    for grp in ("car_commuter", "cyclist", "pedestrian"):
        assert by[grp].travel_time_delta.confidence == "measured", f"{grp} travel_time should be measured"
        assert by[grp].safety_delta is not None and by[grp].safety_delta.confidence == "low", f"{grp} safety should be low"
    assert by["local_resident"].safety_delta.confidence == "low"


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


def test_scorecard_cells_roundtrip() -> None:
    """dump_artifact uses exclude_none — both a null delta AND an enriched cell {value, affected_share}
    must survive dump→re-validate. Null omitted-as-absent is schema-valid (cells optional); an enriched
    cell must serialize with its share intact. Guards the exclude_none trap for the enriched shape."""
    raw = json.loads(SAMPLE_V3_PATH.read_text(encoding="utf-8"))
    art = contract_models.TrajectoryArtifact.model_validate(raw)
    groups = {g.group: g for g in art.scorecard.groups}
    assert groups["local_resident"].travel_time_delta is None, "expected a null delta (inferred, no trip)"
    car_tt = groups["car_commuter"].travel_time_delta
    assert car_tt is not None and car_tt.affected_share is not None, "expected an enriched cell with a share"
    out = RUNS_DIR / "_rt_scorecard_cells.json"
    try:
        trajectory_io.dump_artifact(art, path=out)  # validates against the schema on write
        reloaded = trajectory_io.load_artifact(out)  # and re-validate + model round-trip
    finally:
        out.unlink(missing_ok=True)
    rt_car = {g.group: g for g in reloaded.scorecard.groups}["car_commuter"].travel_time_delta
    assert rt_car.affected_share == car_tt.affected_share, "affected_share must survive the round-trip"
    # 2.5: confidence + note are the newest optional cell fields — they must survive exclude_none too.
    assert rt_car.confidence == car_tt.confidence, "confidence must survive the round-trip"
    assert rt_car.note == car_tt.note, "note must survive the round-trip"


# ---------------------------------------------------------------------------
# v0.4.0 contract (additive over v0.3.0): optional persona.mode/stakeholder + the social{} block.
# Existing v0.2.0/v0.3.0 tests above are UNCHANGED and still run against the (now-bumped) schema — that IS
# the back-compat proof: the enum keeps older artifacts valid.
# ---------------------------------------------------------------------------


def test_v0_4_0_sample() -> None:
    """The committed v0.4.0 sample validates (schema + model) and every new structure is well-formed."""
    assert SAMPLE_V4_PATH.is_file(), f"committed v0.4.0 sample missing: {SAMPLE_V4_PATH}"
    raw = json.loads(SAMPLE_V4_PATH.read_text(encoding="utf-8"))
    trajectory_io.validate_artifact(raw)  # (1) schema
    art = trajectory_io.load_artifact(SAMPLE_V4_PATH)  # (2) model (enforces the grounding invariant too)
    assert raw["schema_version"] == "0.4.0"

    # persona riders present.
    assert any(a.persona.mode is not None for a in art.agents), "expected persona.mode on some agents"
    assert any(a.persona.stakeholder is not None for a in art.agents), "expected persona.stakeholder on some agents"

    social = art.social
    assert social is not None and social.mechanism == "oasis"
    assert len(social.cascades) == 2, "sample exercises 2 cascades"
    assert {e.kind for e in social.graph.edges} == {"homophily", "geography", "cross"}, "all 3 edge kinds"
    assert any(t.shifted for t in social.trajectories), "expected at least one shifted trajectory"
    # exposure covers both a follow edge and the recommender.
    vias = {ev.exposed_via for c in social.cascades for s in c.steps for ev in s.events}
    assert "follow" in vias and "recsys" in vias, "expected both follow and recsys exposure"


def test_v0_4_0_excluded_count_matches() -> None:
    """Cross-field invariant a consumer will assume: social.excluded_count == #events marked 'excluded'."""
    art = trajectory_io.load_artifact(SAMPLE_V4_PATH)
    excluded = sum(1 for c in art.social.cascades for s in c.steps for e in s.events if e.audit_status == "excluded")
    assert excluded == 1, "sample has exactly one excluded event"
    assert art.social.excluded_count == excluded, "excluded_count must match the excluded events"


def test_v0_4_0_out_of_enum_stance_rejected() -> None:
    """NEGATIVE: a trajectory point with an out-of-enum stance must fail schema validation."""
    raw = json.loads(SAMPLE_V4_PATH.read_text(encoding="utf-8"))
    raw["social"]["trajectories"][0]["points"][0]["stance"] = "wishy-washy"  # not in the enum
    with pytest.raises(SchemaValidationError):
        trajectory_io.validate_artifact(raw)


def test_v0_4_0_additive_fields_exercised() -> None:
    """The 4.2 additive touch: trajectories carry cascade_id, excluded events carry excluded_by[rule]."""
    art = trajectory_io.load_artifact(SAMPLE_V4_PATH)
    assert any(t.cascade_id for t in art.social.trajectories), "expected cascade_id on a trajectory"
    excluded = [e for c in art.social.cascades for s in c.steps for e in s.events if e.audit_status == "excluded"]
    assert excluded and all(e.excluded_by for e in excluded), "excluded events must name the rule(s) in excluded_by"
    assert all(isinstance(r, str) and r for e in excluded for r in e.excluded_by)


def test_v0_4_0_excluded_by_must_be_string_array() -> None:
    """NEGATIVE: excluded_by must be an array of strings, not a bare string."""
    raw = json.loads(SAMPLE_V4_PATH.read_text(encoding="utf-8"))
    for c in raw["social"]["cascades"]:
        for s in c["steps"]:
            for e in s["events"]:
                if e.get("audit_status") == "excluded":
                    e["excluded_by"] = "immutability"  # WRONG: string, not [string]
    with pytest.raises(SchemaValidationError):
        trajectory_io.validate_artifact(raw)


def test_v0_4_0_semantic_roundtrip() -> None:
    """load -> dump -> reload: the parsed dicts are EQUAL and the dump re-validates (incl. the `from` alias)."""
    src = json.loads(SAMPLE_V4_PATH.read_text(encoding="utf-8"))
    art = trajectory_io.load_artifact(SAMPLE_V4_PATH)
    out = RUNS_DIR / "_rt_v0_4_0.json"
    try:
        trajectory_io.dump_artifact(art, path=out)  # validates on write
        redumped = json.loads(out.read_text(encoding="utf-8"))
        trajectory_io.load_artifact(out)  # re-validate + model round-trip
    finally:
        out.unlink(missing_ok=True)
    assert redumped["social"]["graph"]["edges"][0].get("from"), "the `from` alias must serialize as 'from'"
    assert src == redumped, "semantic round-trip must be equal"


def test_v0_2_0_and_v0_3_0_still_validate_under_v0_4_0_schema() -> None:
    """Explicit back-compat: older samples validate against the bumped schema (the enum keeps them)."""
    trajectory_io.validate_artifact(json.loads(SAMPLE_PATH.read_text(encoding="utf-8")))
    trajectory_io.validate_artifact(json.loads(SAMPLE_V3_PATH.read_text(encoding="utf-8")))


# ---------------------------------------------------------------------------
# v0.5.0 contract (additive over v0.4.0): meta.scenario.changes[] (the new authority) + tags[]; Change gains
# window/target_lanes/effect/position_m and the types lane_closure/road_closure/incident. All v0.2.0..v0.4.0
# tests above are UNCHANGED and still run against the (now-bumped) schema — that IS the back-compat proof.
# ---------------------------------------------------------------------------


def _v5_raw() -> dict:
    return json.loads(SAMPLE_V5_PATH.read_text(encoding="utf-8"))


def test_v0_5_0_sample() -> None:
    """The committed v0.5.0 sample validates (schema + model) and every new structure is well-formed."""
    assert SAMPLE_V5_PATH.is_file(), f"committed v0.5.0 sample missing: {SAMPLE_V5_PATH}"
    raw = _v5_raw()
    trajectory_io.validate_artifact(raw)  # (1) schema
    art = trajectory_io.load_artifact(SAMPLE_V5_PATH)  # (2) model (window/incident/lane_closure invariants)
    assert raw["schema_version"] == "0.5.0"

    sc = art.meta.scenario
    assert sc is not None and sc.change is None, "a 0.5.0 scenario uses changes[], not the legacy change"
    assert sc.tags == ["school_zone"], "scenario tags must be present"
    assert [c.type for c in sc.changes] == ["lane_closure", "incident", "speed_limit"], "composite changes"

    lane_closure = sc.changes[0]
    assert lane_closure.target_lanes == [2, 3] and lane_closure.window is not None
    incident = sc.changes[1]
    assert incident.window is not None and incident.window.end_s > incident.window.start_s
    assert incident.effect is not None and incident.position_m == 120.0


def test_older_samples_validate_under_v0_5_0_schema() -> None:
    """Explicit back-compat: every older sample (0.2.0/0.3.0/0.4.0) validates against the bumped 0.5.0 schema,
    AND an artifact carrying the legacy single `change` still validates (pre-0.5.0 gate requires it)."""
    for p in (SAMPLE_PATH, SAMPLE_V3_PATH, SAMPLE_V4_PATH):
        trajectory_io.validate_artifact(json.loads(p.read_text(encoding="utf-8")))
    # the v0.4.0 sample carries meta.scenario.change (legacy) — untouched.
    assert "change" in json.loads(SAMPLE_V4_PATH.read_text(encoding="utf-8"))["meta"]["scenario"]


def test_changes_of_accessor() -> None:
    """The migration accessor normalizes either shape to a list: 0.5.0 changes[], 0.4.0 [change], baseline []."""
    art5 = trajectory_io.load_artifact(SAMPLE_V5_PATH)
    assert len(contract_models.changes_of(art5)) == 3
    art4 = trajectory_io.load_artifact(SAMPLE_V4_PATH)
    ch4 = contract_models.changes_of(art4)
    assert len(ch4) == 1 and ch4[0] is art4.meta.scenario.change, "0.4.0 wraps the legacy change as [change]"
    # a baseline artifact (no scenario) → []
    baseline = json.loads(SAMPLE_V4_PATH.read_text(encoding="utf-8"))
    baseline["meta"].pop("scenario")
    assert contract_models.changes_of(contract_models.TrajectoryArtifact.model_validate(baseline)) == []


def test_v0_5_0_missing_changes_fails() -> None:
    """NEGATIVE: a 0.5.0 artifact whose scenario omits changes[] fails schema validation (version gate)."""
    raw = _v5_raw()
    raw["meta"]["scenario"].pop("changes")
    with pytest.raises(SchemaValidationError):
        trajectory_io.validate_artifact(raw)


def test_v0_5_0_legacy_change_fails() -> None:
    """NEGATIVE: a 0.5.0 artifact carrying the legacy single `change` fails (the "change absent" gate)."""
    raw = _v5_raw()
    raw["meta"]["scenario"]["change"] = {"type": "speed_limit", "target_edge": "E1", "description": "x"}
    with pytest.raises(SchemaValidationError):
        trajectory_io.validate_artifact(raw)  # `not: {required: [change]}` bites


def test_v0_5_0_sim_agent_missing_grounding_fails() -> None:
    """NEGATIVE: proves the EXISTING grounding gate was extended to 0.5.0 — a sim agent without grounding fails."""
    raw = _v5_raw()
    raw["agents"][0].pop("grounding")  # agents[0] is a sim agent
    with pytest.raises(SchemaValidationError):
        trajectory_io.validate_artifact(raw)


def test_window_end_le_start_fails() -> None:
    """NEGATIVE (model, not schema): window end_s <= start_s. Schema stays loose; pydantic enforces it."""
    raw = _v5_raw()
    w = raw["meta"]["scenario"]["changes"][1]["window"]
    w["end_s"] = w["start_s"]  # end == start
    trajectory_io.validate_artifact(raw)  # schema PASSES (loose)
    with pytest.raises(ModelValidationError):
        contract_models.TrajectoryArtifact.model_validate(raw)  # model FAILS


def test_incident_requires_window() -> None:
    """NEGATIVE (model): an incident change without a window. Schema loose; pydantic enforces incident⇒window."""
    raw = _v5_raw()
    raw["meta"]["scenario"]["changes"][1].pop("window")  # changes[1] is the incident
    trajectory_io.validate_artifact(raw)  # schema PASSES
    with pytest.raises(ModelValidationError):
        contract_models.TrajectoryArtifact.model_validate(raw)


def test_lane_closure_requires_target_lanes() -> None:
    """NEGATIVE (model): a lane_closure without target_lanes. Schema loose; pydantic enforces the invariant."""
    raw = _v5_raw()
    raw["meta"]["scenario"]["changes"][0].pop("target_lanes")  # changes[0] is the lane_closure
    trajectory_io.validate_artifact(raw)  # schema PASSES
    with pytest.raises(ModelValidationError):
        contract_models.TrajectoryArtifact.model_validate(raw)


def test_version_gate_audit() -> None:
    """The dump-time audit (independent of the schema if/then) catches version↔shape mismatches."""
    raw = _v5_raw()
    trajectory_io.audit_version_gate(raw)  # the clean sample passes

    # 0.5.0 carrying a legacy change → raises.
    bad = _v5_raw()
    bad["meta"]["scenario"]["change"] = {"type": "speed_limit", "target_edge": "E1", "description": "x"}
    with pytest.raises(ValueError):
        trajectory_io.audit_version_gate(bad)

    # A 0.4.0 scenario carrying BOTH change and changes is SCHEMA-valid but the audit catches it (independent).
    both = {"schema_version": "0.4.0", "meta": {"scenario": {"baseline_run_id": "b", "change": {}, "changes": [{}]}}}
    with pytest.raises(ValueError):
        trajectory_io.audit_version_gate(both)


def test_dump_rejects_0_5_0_with_legacy_change() -> None:
    """dump_artifact must refuse a 0.5.0 artifact built with the legacy single change (schema gate + audit)."""
    art = trajectory_io.load_artifact(SAMPLE_V5_PATH)
    # force the legacy shape at the current (0.5.0) version.
    art.meta.scenario.changes = None
    art.meta.scenario.change = contract_models.Change(type="speed_limit", target_edge="E1", description="x")
    out = RUNS_DIR / "_rt_v0_5_0_bad.json"
    try:
        with pytest.raises((SchemaValidationError, ValueError)):
            trajectory_io.dump_artifact(art, path=out)
    finally:
        out.unlink(missing_ok=True)


def test_v0_5_0_semantic_roundtrip() -> None:
    """load -> dump -> reload: the parsed dicts are EQUAL and the dump re-validates + passes the version gate."""
    src = _v5_raw()
    art = trajectory_io.load_artifact(SAMPLE_V5_PATH)
    out = RUNS_DIR / "_rt_v0_5_0.json"
    try:
        trajectory_io.dump_artifact(art, path=out)  # validates + audits on write
        redumped = json.loads(out.read_text(encoding="utf-8"))
        trajectory_io.load_artifact(out)  # re-validate + model round-trip
    finally:
        out.unlink(missing_ok=True)
    assert src == redumped, "semantic round-trip must be equal"


# ---------------------------------------------------------------------------
# v0.6.0 contract (additive over v0.5.0): meta.demand_profile (REQUIRED at 0.6.0, forbidden before) +
# optional meta.render_sample (vehicles[]/persons[] capped to a stratified render sample; outcomes/
# conflicts/scorecard stay full-population). All older tests above run unchanged — the back-compat proof.
# ---------------------------------------------------------------------------


def _v6_raw() -> dict:
    return json.loads(SAMPLE_V6_PATH.read_text(encoding="utf-8"))


def test_v0_6_0_sample() -> None:
    """The committed v0.6.0 sample validates (schema + model + gate) and the new meta fields are typed."""
    assert SAMPLE_V6_PATH.is_file(), f"committed v0.6.0 sample missing: {SAMPLE_V6_PATH}"
    raw = _v6_raw()
    trajectory_io.validate_artifact(raw)
    trajectory_io.audit_version_gate(raw)
    art = trajectory_io.load_artifact(SAMPLE_V6_PATH)
    assert raw["schema_version"] == "0.6.0"
    assert art.meta.demand_profile == "calibrated_am_peak"
    rs = art.meta.render_sample
    assert rs is not None and rs.strategy == "outcome_stratified"
    assert rs.rendered_vehicles <= rs.total_vehicles and rs.rendered_persons <= rs.total_persons


def test_older_samples_validate_under_v0_6_0_schema() -> None:
    """Explicit back-compat: every older sample validates against the bumped 0.6.0 schema."""
    for p in (SAMPLE_PATH, SAMPLE_V3_PATH, SAMPLE_V4_PATH, SAMPLE_V5_PATH):
        trajectory_io.validate_artifact(json.loads(p.read_text(encoding="utf-8")))


def test_v0_6_0_missing_demand_profile_fails() -> None:
    """NEGATIVE: a 0.6.0 artifact without meta.demand_profile fails BOTH the schema gate and the audit."""
    raw = _v6_raw()
    raw["meta"].pop("demand_profile")
    with pytest.raises(SchemaValidationError):
        trajectory_io.validate_artifact(raw)
    with pytest.raises(ValueError):
        trajectory_io.audit_version_gate(raw)


def test_pre_0_6_0_carrying_demand_profile_fails() -> None:
    """NEGATIVE: an older artifact carrying the v0.6.0 meta fields is mis-versioned and fails."""
    raw = _v5_raw()
    raw["meta"]["demand_profile"] = "synthetic_demo"
    with pytest.raises(SchemaValidationError):
        trajectory_io.validate_artifact(raw)
    with pytest.raises(ValueError):
        trajectory_io.audit_version_gate(raw)


def test_render_sample_rendered_exceeds_total_fails() -> None:
    """NEGATIVE (model): rendered > total. Schema stays loose; the pydantic RenderSample enforces it."""
    raw = _v6_raw()
    raw["meta"]["render_sample"]["rendered_vehicles"] = raw["meta"]["render_sample"]["total_vehicles"] + 1
    trajectory_io.validate_artifact(raw)  # schema PASSES (loose)
    with pytest.raises(ModelValidationError):
        contract_models.TrajectoryArtifact.model_validate(raw)


def test_v0_6_0_semantic_roundtrip() -> None:
    """load -> dump -> reload at 0.6.0: dicts EQUAL, dump re-validates + passes the version gate."""
    src = _v6_raw()
    art = trajectory_io.load_artifact(SAMPLE_V6_PATH)
    out = RUNS_DIR / "_rt_v0_6_0.json"
    try:
        trajectory_io.dump_artifact(art, path=out)
        redumped = json.loads(out.read_text(encoding="utf-8"))
        trajectory_io.load_artifact(out)
    finally:
        out.unlink(missing_ok=True)
    assert src == redumped, "semantic round-trip must be equal"


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
