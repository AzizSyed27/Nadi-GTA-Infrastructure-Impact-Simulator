"""Tests for the Phase-3.2 report agent's DETERMINISTIC pieces (no LLM / LightRAG / network needed).

Covers the corpus builder and the citation-handle mapping — the parts that must be correct BEFORE any
retrieval/generation happens. The honesty audit reused on chat answers is the same ``report.audit_prose``
exercised in test_report.py; here we assert the chat CONSTITUTION carries the rules and the corpus is
grounded + slash-free (LightRAG canonicalizes file_paths to the basename, so handles must have no '/').

Run:  python -m pytest python/tests/test_report_agent.py -v
"""

from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "python" / "src"))
import report_agent  # noqa: E402
from contract_models import (  # noqa: E402
    Agent, Change, Meta, Outcome, Persona, Reaction, Scenario, Scorecard, ScorecardCell, ScorecardGroup,
    TrajectoryArtifact, Vehicle,
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
