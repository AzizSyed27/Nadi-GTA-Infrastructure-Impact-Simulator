"""V2.6c — the committed 0.10.0 MIXED-SHAPE fixture (web/tests/fixtures/compact-run.json) is REAL
producer output: built through contract_models + compact_encoding + dump_artifact (the seeds-run /
school-zone regen-pin convention — recompute-equals, so drift from the producer chain fails here,
never silently in a Playwright mock). Regen: `python python/tests/test_compact_fixture.py`.

The fixture is the Playwright dual-path reader's subject: 2 compact vehicles + 1 explicit
teleport-gapped vehicle, 1 compact person + 1 explicit TAIL-gapped person (the boundary case a
tail-dropping reader bug hides in), one sim agent pinned to a compact vehicle."""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "python" / "src"))

import contract_models  # noqa: E402
import trajectory_io  # noqa: E402
from contract_models import (  # noqa: E402
    Agent,
    Assignment,
    Change,
    Meta,
    Outcome,
    Persona,
    Reaction,
    Scenario,
    Scorecard,
    ScorecardCell,
    ScorecardGroup,
    TrajectoryArtifact,
    Vehicle,
    Person,
    encode_trajectory_fields,
)

FIXTURE_PATH = REPO / "web" / "tests" / "fixtures" / "compact-run.json"

# The gap shapes: mid-gap (a teleport hole inside the series) and TAIL-gap (the 594-pt-tail class).
V_GAP_TS = [0.0, 1.0, 2.0, 40.0, 41.0]
P_TAILGAP_TS = [0.0, 1.0, 2.0, 300.0]


def _entity_kwargs(timestamps: list[float]) -> dict:
    """Route through the REAL encoder — the fixture is producer-real, never hand-shaped."""
    return encode_trajectory_fields(timestamps, 1.0)


def build_fixture() -> TrajectoryArtifact:
    def pts(n: int, lon0: float = -79.266, lat0: float = 43.742) -> list[list[float]]:
        return [[round(lon0 + 0.0002 * i, 6), round(lat0 + 0.0001 * i, 6)] for i in range(n)]

    vehicles = [
        # t0=4, dt=1, 6 points — the spec's literal-anchored expansion sample: [4, 5, 6, 7, 8]
        Vehicle(id="v_compact_a", type="car", path=pts(6), **_entity_kwargs([4.0 + i for i in range(6)])),
        Vehicle(id="v_compact_b", type="bicycle", path=pts(4, -79.264), **_entity_kwargs([10.0 + i for i in range(4)])),
        Vehicle(id="v_gap", type="car", path=pts(5, -79.262), **_entity_kwargs(V_GAP_TS)),
    ]
    persons = [
        Person(id="p_compact", type="pedestrian", path=pts(5, -79.265, 43.7415),
               **_entity_kwargs([0.0 + i for i in range(5)])),
        Person(id="p_tailgap", type="pedestrian", path=pts(4, -79.263, 43.7413),
               **_entity_kwargs(P_TAILGAP_TS)),
    ]
    agents = [
        Agent(grounding="sim", vehicle_id="v_compact_a", trigger_t=6.0,
              persona=Persona(id="time_pressed", label="Time-pressed commuter"),
              outcome=Outcome(baseline_duration=240.0, scenario_duration=300.0, delta_seconds=60.0,
                              baseline_timeloss=20.0, scenario_timeloss=80.0),
              reaction=Reaction(comment="The drive felt a touch slower through the corridor.",
                                sentiment=-0.3, stance="opposed")),
        Agent(grounding="inferred",
              persona=Persona(id="longtime_resident", label="Long-time corridor resident"),
              reaction=Reaction(comment="Quieter mornings would suit this stretch.",
                                sentiment=0.2, stance="neutral")),
    ]
    return TrajectoryArtifact(
        schema_version="0.10.0",
        meta=Meta(run_id="compact-fixture", network="corridor.net.xml",
                  bbox=[-79.3, 43.7, -79.2, 43.8], sim_start=0.0, sim_end=1800.0, step_length=1.0,
                  created_at="2026-08-20T00:00:00Z", demand_profile="synthetic_demo",
                  assignment=Assignment(mode="day_one"),
                  scenario=Scenario(baseline_run_id="compact-fixture-baseline", changes=[
                      Change(type="speed_limit", target_edge="E1", value_mps=8.33,
                             description="Speed limit lowered on E1")])),
        vehicles=vehicles,
        persons=persons,
        agents=agents,
        scorecard=Scorecard(groups=[
            ScorecardGroup(group="car_commuter", grounding="sim",
                           travel_time_delta=ScorecardCell(value=60.0, affected_share=0.5,
                                                           confidence="measured"))]),
    )


def _generated_bytes() -> str:
    art = build_fixture()
    tmp = trajectory_io.RUNS_DIR / "_compact_fixture_tmp.json"
    tmp.parent.mkdir(parents=True, exist_ok=True)
    try:
        trajectory_io.dump_artifact(art, path=tmp)  # validates BOTH layers on the way out
        return tmp.read_text(encoding="utf-8")
    finally:
        tmp.unlink(missing_ok=True)


def test_committed_fixture_is_regenerated_producer_output() -> None:
    """The drift pin: committed bytes == the producer chain's output (regen via __main__)."""
    assert FIXTURE_PATH.is_file(), f"missing committed fixture: {FIXTURE_PATH}"
    assert FIXTURE_PATH.read_text(encoding="utf-8") == _generated_bytes()


def test_fixture_shapes_are_mixed_and_true() -> None:
    """Both shapes present; the encoder made the SHAPE decision (compact iff regular); the gapped
    entities keep their true holes."""
    raw = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    trajectory_io.validate_artifact(raw)
    trajectory_io.audit_version_gate(raw)
    by_id = {v["id"]: v for v in raw["vehicles"]} | {p["id"]: p for p in raw["persons"]}
    assert by_id["v_compact_a"]["t0"] == 4.0 and by_id["v_compact_a"]["dt"] == 1.0
    assert "timestamps" not in by_id["v_compact_a"] and "speeds" not in by_id["v_compact_a"]
    assert by_id["v_gap"]["timestamps"] == V_GAP_TS  # the mid-gap hole, untouched
    assert by_id["p_tailgap"]["timestamps"] == P_TAILGAP_TS  # the tail-gap hole, untouched
    assert by_id["p_compact"]["t0"] == 0.0 and by_id["p_compact"]["dt"] == 1.0


def test_fixture_point_counts_both_shapes() -> None:
    """The F3 ground truth the Playwright seam asserts against: per-population path points equal
    materialized time points — computed here INDEPENDENTLY of the TS normalizer."""
    art = trajectory_io.load_artifact(FIXTURE_PATH)
    veh_path = sum(len(v.path) for v in art.vehicles)
    veh_ts = sum(len(v.timestamps_of()) for v in art.vehicles)
    per_path = sum(len(p.path) for p in art.persons)
    per_ts = sum(len(p.timestamps_of()) for p in art.persons)
    assert veh_path == veh_ts == 15  # 6 + 4 + 5
    assert per_path == per_ts == 9  # 5 + 4


if __name__ == "__main__":
    FIXTURE_PATH.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE_PATH.write_text(_generated_bytes(), encoding="utf-8")
    print(f"wrote {FIXTURE_PATH}")
