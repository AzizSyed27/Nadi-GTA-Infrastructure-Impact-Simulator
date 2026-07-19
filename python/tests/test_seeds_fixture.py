"""V2.1d — the Playwright seeds fixture must BE a real artifact (fixture flip == real flip).

seeds.spec.ts renders web/tests/fixtures/seeds-run.json through the normal loadArtifact ->
ScorecardPanel -> ScoreCell path; these tests make a fixture-only cosmetic impossible: the committed
JSON must validate against the frozen schema + version gates, and its scorecard must EQUAL what the
real scorecard.attach_ranges produces from the same hand-written per-seed values. Drift fails here.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "python" / "src"))

import trajectory_io  # noqa: E402
from contract_models import Scorecard, ScorecardCell, ScorecardGroup  # noqa: E402
from scorecard import _SAFETY_NOTE, attach_ranges  # noqa: E402

FIXTURE = REPO / "web" / "tests" / "fixtures" / "seeds-run.json"


def _card(travel_car, safety_car, travel_cyc, safety_cyc, travel_ped, safety_ped) -> Scorecard:
    def tc(v, share):
        return ScorecardCell(value=v, affected_share=share, confidence="measured",
                             note="affected_share = fraction of this group's travelers >30s slower")

    def sc_(v):
        return ScorecardCell(value=v, confidence="low", note=_SAFETY_NOTE)

    return Scorecard(groups=[
        ScorecardGroup(group="car_commuter", grounding="sim", travel_time_delta=tc(travel_car, 0.18),
                       safety_delta=sc_(safety_car),
                       access_delta=ScorecardCell(value=0.33, confidence="low", note="rule-based estimate")),
        ScorecardGroup(group="cyclist", grounding="sim", travel_time_delta=tc(travel_cyc, 0.19),
                       safety_delta=sc_(safety_cyc),
                       access_delta=ScorecardCell(value=-1.0, confidence="low", note="rule-based estimate")),
        ScorecardGroup(group="pedestrian", grounding="sim", travel_time_delta=tc(travel_ped, 0.03),
                       safety_delta=sc_(safety_ped), access_delta=None),
        ScorecardGroup(group="local_resident", grounding="inferred", safety_delta=sc_(safety_car)),
        ScorecardGroup(group="business_owner", grounding="inferred",
                       access_delta=ScorecardCell(value=0.5, confidence="low", note="rule-based estimate")),
        ScorecardGroup(group="accessibility", grounding="inferred"),
        ScorecardGroup(group="transit_riders", grounding="inferred"),
    ])


def _expected_scorecard() -> Scorecard:
    # THE per-seed values the fixture was generated from (car travel STABLE 1.8..2.9 — the
    # "+1.8 to +2.9s" render case; cyclist travel UNSTABLE -1.4..5.1; safety UNSTABLE — the V1 flip).
    canonical = _card(2.1, 0.2, 2.3, -0.1, 0.0, 0.8)
    probes = [_card(1.8, -1.2, -1.4, 0.3, 0.1, 0.5), _card(2.9, 2.4, 5.1, -0.5, 0.4, 1.1)]
    attach_ranges(canonical, probes, [42, 43, 44])
    return canonical


def test_fixture_is_a_valid_artifact() -> None:
    assert FIXTURE.is_file(), f"committed seeds fixture missing: {FIXTURE}"
    raw = json.loads(FIXTURE.read_text(encoding="utf-8"))
    trajectory_io.validate_artifact(raw)
    trajectory_io.audit_version_gate(raw)
    assert raw["schema_version"] == "0.8.0"


def test_fixture_scorecard_equals_real_attach_ranges_output() -> None:
    art = trajectory_io.load_artifact(FIXTURE)
    expected = _expected_scorecard()
    assert art.scorecard.model_dump(exclude_none=True) == expected.model_dump(exclude_none=True), (
        "the fixture's scorecard drifted from the real attach_ranges output — regenerate it from "
        "these per-seed values, never hand-edit")


def test_fixture_exercises_both_render_branches() -> None:
    art = trajectory_io.load_artifact(FIXTURE)
    car = next(g for g in art.scorecard.groups if g.group == "car_commuter")
    cyc = next(g for g in art.scorecard.groups if g.group == "cyclist")
    assert car.travel_time_delta.range.sign_stable is True    # the "+1.8 to +2.9s" stable case
    assert cyc.travel_time_delta.range.sign_stable is False   # the unstable-TRAVEL neutrality case
    assert car.safety_delta.range.sign_stable is False        # the V1 safety flip
    assert car.access_delta.range is None                     # access never ranged
