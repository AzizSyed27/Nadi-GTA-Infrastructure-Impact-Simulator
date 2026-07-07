"""Tests for the Phase-4.1 social-content immutability checker (`social_checks.check_immutability`).

Sign convention: delta_seconds POSITIVE = slower. A post claiming the trip got FASTER when the agent got
slower (or vice versa) is a violation; a sign-consistent post is clean; inferred agents (no outcome) and
already-excluded events are skipped.
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "python" / "src"))
import social_checks  # noqa: E402
import trajectory_io  # noqa: E402
from contract_models import (  # noqa: E402
    Agent, Cascade, CascadeStep, Meta, Outcome, Persona, Reaction, Scenario, Change, Social, SocialEvent,
    TrajectoryArtifact, Vehicle,
)

SAMPLE_V4 = REPO_ROOT / "web" / "public" / "sample_v0_4_0.json"


def _artifact(event_content: str, delta_seconds: float, audit_status: str = "clean") -> TrajectoryArtifact:
    """One sim agent 'v1' with the given outcome delta + one social post with the given content/status."""
    meta = Meta(run_id="t", network="n", bbox=[-79.3, 43.7, -79.1, 43.8], sim_start=0.0, sim_end=100.0,
                step_length=1.0, created_at="2026-07-07T00:00:00+00:00",
                scenario=Scenario(baseline_run_id="b", change=Change(type="bike_lane", target_edge="E1",
                                                                     description="x")))
    agent = Agent(grounding="sim", vehicle_id="v1", trigger_t=10.0,
                  persona=Persona(id="time_pressed", label="T"),
                  outcome=Outcome(baseline_duration=100.0, scenario_duration=100.0 + delta_seconds,
                                  delta_seconds=delta_seconds, baseline_timeloss=0.0, scenario_timeloss=0.0),
                  reaction=Reaction(comment="c", sentiment=0.0, stance="neutral"))
    social = Social(mechanism="oasis", cascades=[Cascade(cascade_id="c1", steps=[CascadeStep(step=0, events=[
        SocialEvent(agent="v1", action="post", content=event_content, audit_status=audit_status)])])])
    return TrajectoryArtifact(schema_version="0.4.0", meta=meta,
                             vehicles=[Vehicle(id="v1", type="car", path=[[-79.2, 43.75], [-79.2, 43.76]],
                                               timestamps=[0.0, 1.0], speeds=[1.0, 1.0])],
                             agents=[agent], social=social)


def test_contradicting_post_is_flagged() -> None:
    # got SLOWER (delta +45) but the post claims it got faster → one violation.
    art = _artifact("Great news — my trip got faster after this change!", delta_seconds=45.0)
    viol = social_checks.check_immutability(art)
    assert len(viol) == 1
    assert viol[0]["agent"] == "v1" and viol[0]["claim"] == "faster" and viol[0]["delta_seconds"] == 45.0


def test_reverse_contradiction_is_flagged() -> None:
    # got FASTER (delta -30) but the post claims it took longer → one violation.
    art = _artifact("Ugh, this change added time to my commute.", delta_seconds=-30.0)
    viol = social_checks.check_immutability(art)
    assert len(viol) == 1 and viol[0]["claim"] == "slower"


def test_sign_consistent_post_is_clean() -> None:
    # got slower and says so — no violation.
    art = _artifact("This lane change added a couple of minutes to my drive.", delta_seconds=45.0)
    assert social_checks.check_immutability(art) == []


def test_already_excluded_event_is_skipped() -> None:
    # even a contradicting post is ignored once it's already marked excluded.
    art = _artifact("My trip got faster!", delta_seconds=45.0, audit_status="excluded")
    assert social_checks.check_immutability(art) == []


def test_committed_sample_passes_clean() -> None:
    """The hand-authored v0.4.0 sample is authored sign-consistent — the checker finds nothing."""
    art = trajectory_io.load_artifact(SAMPLE_V4)
    assert social_checks.check_immutability(art) == []
