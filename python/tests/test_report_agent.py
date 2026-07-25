"""Tests for the Phase-3.2 report agent's DETERMINISTIC pieces (no LLM / LightRAG / network needed).

Covers the corpus builder and the citation-handle mapping — the parts that must be correct BEFORE any
retrieval/generation happens. The honesty audit reused on chat answers is the same ``report.audit_prose``
exercised in test_report.py; here we assert the chat CONSTITUTION carries the rules and the corpus is
grounded + slash-free (LightRAG canonicalizes file_paths to the basename, so handles must have no '/').

Run:  python -m pytest python/tests/test_report_agent.py -v
"""

from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "python" / "src"))
import report_agent  # noqa: E402
from contract_models import (  # noqa: E402
    Agent, ArgumentReach, Cascade, CascadeStep, Change, Meta, OpinionTrajectory, Outcome, Persona, Reaction,
    Scenario, Scorecard, ScorecardCell, ScorecardGroup, Social, SocialEvent, TrajectoryArtifact,
    TrajectoryPoint, Vehicle,
)


def _artifact() -> TrajectoryArtifact:
    change = Change(type="bike_lane", target_edge="E1", target_lane=1, value_mps=None,
                    description="Converted a car lane to a bike lane")
    meta = Meta(run_id="scen-TEST", network="corridor.net.xml", bbox=[-79.3, 43.7, -79.1, 43.8],
                sim_start=0.0, sim_end=100.0, step_length=1.0, created_at="2026-07-04T00:00:00+00:00",
                scenario=Scenario(baseline_run_id="base-TEST", change=change))
    groups = [
        ScorecardGroup(group="car_commuter", grounding="sim",
                       travel_time_delta=ScorecardCell(value=0.0, affected_share=0.033, confidence="measured",
                                                       note="affected_share = fraction >30s slower"),
                       safety_delta=ScorecardCell(value=6.5, confidence="low", note="sign not stable across seeds"),
                       access_delta=ScorecardCell(value=0.33, confidence="low", note="rule-based estimate")),
        ScorecardGroup(group="business_owner", grounding="inferred", travel_time_delta=None, safety_delta=None,
                       access_delta=ScorecardCell(value=0.5, confidence="low", note="rule-based estimate")),
    ]
    # one sim (car) agent + one inferred (business) voice — real persona ids so mode/stakeholder resolve.
    sim = Agent(persona=Persona(id="time_pressed", label="Time-pressed commuter"),
                reaction=Reaction(comment="That extra time will wreck my morning.", sentiment=-0.8, stance="opposed"),
                grounding="sim", vehicle_id="v42", trigger_t=10.0,
                outcome=Outcome(baseline_duration=100.0, scenario_duration=160.0, delta_seconds=60.0,
                                baseline_timeloss=10.0, scenario_timeloss=40.0))
    inf = Agent(persona=Persona(id="shop_owner", label="Small business owner"),
                reaction=Reaction(comment="This will kill my curbside parking.", sentiment=-0.6, stance="opposed"),
                grounding="inferred")
    return TrajectoryArtifact(schema_version="0.3.0", meta=meta,
                              vehicles=[Vehicle(id="v42", type="car", path=[[-79.2, 43.75], [-79.2, 43.76]],
                                                timestamps=[0.0, 1.0], speeds=[1.0, 1.0])],
                              agents=[sim, inf], conflicts=[],
                              scorecard=Scorecard(groups=groups, bca=None))


def _outcomes() -> dict:
    return {
        "scenario_run_id": "scen-TEST", "baseline_run_id": "base-TEST",
        "connectivity_severed_edges": [], "reroute": {"cars_rerouted": 0, "cars_matched": 300},
        "modes": {m: {"counts": {"total_demand": d}} for m, d in
                  (("car", 300), ("bicycle", 82), ("pedestrian", 129))},
    }


def _corpus():
    return report_agent.build_corpus(_artifact(), _outcomes(), verdict=None)


def test_corpus_split_sentence_carries_attribution_parenthetical():
    """V2.2c USER-CONFIRMED INVARIANT, pinned on the CHAT surface too: the non-completions split
    must never render without the backlog attribution parenthetical (not_inserted is causally
    neutral — the insertion backlog is structural, present in baseline runs too)."""
    out = _outcomes()
    out["non_completions"] = {"car": 37, "bicycle": 2, "pedestrian": 0}
    out["non_completions_split"] = {
        "car": {"entered_not_finished": 30, "not_inserted": 7},
        "bicycle": {"entered_not_finished": 2, "not_inserted": 0},
        "pedestrian": {"entered_not_finished": 0, "not_inserted": 0},
    }
    out["insertion_backlog"] = {
        "car": {"baseline": 4100, "scenario": 4180},
        "bicycle": {"baseline": 3, "scenario": 3},
        "pedestrian": {"baseline": 12, "scenario": 12},
    }
    docs = {d["source"]: d["text"] for d in report_agent.build_corpus(_artifact(), out, verdict=None)}
    change_doc = docs["change"]
    assert "30 entered the network and could not finish" in change_doc
    assert "7 did not enter the network" in change_doc
    assert "insertion backlog affects baseline runs too" in change_doc
    assert "4100 had not entered by the baseline run's end vs 4180 in this run" in change_doc
    # zero modes never render a split sentence
    assert "0 pedestrian non-completions" not in change_doc


def test_corpus_shape_and_kinds():
    docs = _corpus()
    kinds = Counter(d["source"].split("__")[0] for d in docs)
    assert kinds["voice"] == 2  # one per agent
    assert kinds["scorecard"] == 7  # always the 7 canonical rows
    assert kinds["limitation"] == 6  # one per caveat
    assert kinds["change"] == 1 and kinds["robustness"] == 1 and kinds["conflicts"] == 1


def test_sources_unique_and_slash_free():
    # LightRAG canonicalizes a file_path to its BASENAME — a '/' would silently truncate the handle.
    srcs = [d["source"] for d in _corpus()]
    assert len(set(srcs)) == len(srcs)
    assert all("/" not in s for s in srcs)


def test_corpus_is_grounded_in_real_facts():
    docs = {d["source"]: d["text"] for d in _corpus()}
    # the verbatim comment rides in its voice doc
    assert "kill my curbside parking" in docs["voice__shop_owner__idx1" if "voice__shop_owner__idx1" in docs
                                             else next(k for k in docs if k.startswith("voice__shop_owner"))]
    # the scorecard doc carries the confidence + verbatim note
    sc = docs["scorecard__car_commuter"]
    assert "MEAS" in sc and "affected_share = fraction >30s slower" in sc
    # safety is rendered as a magnitude, never a direction
    assert "±6.50" in sc


def test_friendly_source_labels():
    assert report_agent.friendly_source("voice__shop_owner__v9") == "Small business owner (voice)"
    assert report_agent.friendly_source("scorecard__car_commuter") == "Car commuters scorecard row"
    assert report_agent.friendly_source("limitation__safety_direction_is_not_established").startswith("Limitation:")
    assert report_agent.friendly_source("change") == "The proposed change"
    assert report_agent.friendly_source("conflicts") == "Near-miss event summary"


def test_embedding_pin_roundtrip_and_mismatch(tmp_path):
    # a freshly-written pin matches the current embedder → no-op
    report_agent.write_embedding_pin(tmp_path)
    assert json.loads((tmp_path / "embedding_meta.json").read_text())["dim"] == report_agent.EMBED_DIM
    report_agent.check_embedding_pin(tmp_path)  # must not raise

    # a missing pin (legacy/fresh index) is graceful — no raise
    report_agent.check_embedding_pin(tmp_path / "nonexistent")

    # a pin built with a DIFFERENT embedder (wrong model AND dim) fails loudly, naming BOTH configs
    other = tmp_path / "other"
    other.mkdir()
    (other / "embedding_meta.json").write_text(json.dumps({"model": "some-other-model", "dim": 768, "backend": "hf"}))
    with pytest.raises(report_agent.EmbeddingPinMismatch) as ei:
        report_agent.check_embedding_pin(other)
    msg = str(ei.value)
    assert "some-other-model" in msg and "768" in msg  # the pinned config
    assert report_agent.EMBED_MODEL in msg and "384" in msg  # the current config


def test_excluded_social_events_filtered():
    """v0.4.0: a social event with audit_status='excluded' must NOT reach the clean corpus (test at the
    build_corpus layer). The clean event's content appears; the excluded event's content does not."""
    art = _artifact()
    art.social = Social(mechanism="oasis", cascades=[Cascade(cascade_id="c1", steps=[CascadeStep(step=0, events=[
        SocialEvent(agent="v1", action="post", content="CLEAN_MARKER a calmer street is welcome", audit_status="clean"),
        SocialEvent(agent="v1", action="post", content="EXCLUDED_MARKER this must not leak", audit_status="excluded"),
    ])])])
    docs = report_agent.build_corpus(art, _outcomes(), verdict=None)
    text = " ".join(d["text"] for d in docs)
    assert "CLEAN_MARKER" in text, "clean social content must reach the corpus"
    assert "EXCLUDED_MARKER" not in text, "excluded social content must NOT leak into the clean corpus"


def test_discourse_corpus_docs_are_movement_not_position():
    """v0.4.0 step 4.3: per-cascade engaged-reach + movement docs, divergence + exclusions docs. The movement
    docs MUST be framed movement-not-position (so chat can't launder shifts into a directional verdict), and
    the engaged-reach doc MUST carry the metric definition + the saturation note."""
    art = _artifact()
    art.social = Social(
        mechanism="oasis",
        cascades=[Cascade(cascade_id="c1", steps=[CascadeStep(step=1, events=[
            SocialEvent(agent="v42", action="post", content="I'd rather lose a minute than risk the kids.",
                        audit_status="clean"),
            SocialEvent(agent="v42", action="post", content="claims safer", audit_status="excluded",
                        excluded_by=["safety_direction"]),
        ])])],
        trajectories=[OpinionTrajectory(agent="v42", cascade_id="c1", derived_by="stance_scoring", shifted=True,
                                        points=[TrajectoryPoint(step=0, stance="opposed"),
                                                TrajectoryPoint(step=1, stance="neutral")])],
        argument_reach=[ArgumentReach(argument="delay / slower", cascade_id="c1", reached=40, post_count=20),
                        ArgumentReach(argument="calmer / quieter", cascade_id="c1", reached=30, post_count=8)],
        excluded_count=1)
    docs = {d["source"]: d["text"] for d in report_agent.build_corpus(art, _outcomes(), verdict=None)}

    assert "engaged_reach__c1" in docs and "movement__c1" in docs
    assert "divergence" in docs and "exclusions" in docs
    # engaged-reach doc: metric definition + saturation note.
    er = docs["engaged_reach__c1"].lower()
    assert "acted on" in er and "saturat" in er and "per post" in er
    # movement doc: explicitly movement-not-position (never a vote / cascades diverge).
    mv = docs["movement__c1"].lower()
    assert "movement" in mv and "never a" in mv and ("vote" in mv or "verdict" in mv)
    # exclusions doc: the per-rule breakdown, not the excluded content.
    assert "safety_direction" in docs["exclusions"] and "claims safer" not in docs["exclusions"]
    # friendly labels for the new handles.
    assert report_agent.friendly_source("engaged_reach__c1").startswith("Argument engagement")
    assert report_agent.friendly_source("movement__c1").startswith("Opinion movement")
    assert report_agent.friendly_source("divergence") == "Cascade divergence"
    assert report_agent.friendly_source("exclusions") == "Posts withheld by the guard"


def test_chat_constitution_carries_the_rules():
    # importing server is enough (no network); assert the constitution reuses the report's rules + chat rules.
    import server
    c = server.CHAT_CONSTITUTION.lower()
    assert "surrogate" in c and "never a verdict" in c
    assert "only from the provided context" in c  # answer-only-from-context
    assert "safer or more dangerous" in c  # the safety-direction refusal
    assert "support or oppose" in c  # the census refusal
    # the fallbacks are honest, non-empty disclaimers
    assert "doesn't answer that" in server.THIN_FALLBACK.lower()
    assert "not a verdict" in server.CAVEAT_FALLBACK.lower()
