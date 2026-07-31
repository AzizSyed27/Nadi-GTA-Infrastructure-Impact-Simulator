"""V2.3b — pure unit coverage for the interview module (no server import, no LLM, no HTTP).

The load-bearing invariants: the grounding context contains ONLY the interviewed agent's own records
(the LEAKAGE test — another agent's outcome/comment/label in the context is a failure), the guard
trips on every banned pattern class (and the in-character refusal constants pass it), and the run
cache is mtime-invalidated + LRU-bounded."""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "python" / "src"))

import interview  # noqa: E402
import reactions  # noqa: E402
import trajectory_io  # noqa: E402
from personas import load_personas  # noqa: E402

CHANGES = [{"type": "speed_limit", "description": "Speed limit on the corridor lowered", "value_mps": 11.11}]


def _sim_agent(persona_id: str, label: str, vehicle_id: str, base_s: float, scen_s: float,
               comment: str) -> dict:
    return {
        "persona": {"id": persona_id, "label": label},
        "reaction": {"comment": comment, "sentiment": -0.4, "stance": "opposed"},
        "grounding": "sim",
        "vehicle_id": vehicle_id,
        "trigger_t": 100.0,
        "outcome": {
            "baseline_duration": base_s,
            "scenario_duration": scen_s,
            "delta_seconds": scen_s - base_s,
            "baseline_timeloss": 30.0,
            "scenario_timeloss": 90.0,
        },
    }


def _inferred_agent(persona_id: str, label: str, stakeholder: str, comment: str) -> dict:
    return {
        "persona": {"id": persona_id, "label": label},
        "reaction": {"comment": comment, "sentiment": 0.2, "stance": "neutral"},
        "grounding": "inferred",
        "stakeholder": stakeholder,
    }


def _ctx(agents: list[dict]) -> interview.RunContext:
    return interview.RunContext(run_id="test-run", mtime_ns=0, agents=agents, changes=CHANGES,
                                demand_profile="synthetic_demo", tags=None)


# ===================================================================================================
# Grounding content
# ===================================================================================================


def test_sim_grounding_contains_own_records() -> None:
    p = load_personas()[0]  # a REAL roster persona → the description re-hydrates
    agent = _sim_agent(p.id, p.label, "veh7", 240.0, 360.0, "my commute felt longer")
    g = interview.build_grounding(agent, _ctx([agent]))
    assert p.description in g, "persona description must re-hydrate from personas.json"
    assert "HOW IT AFFECTS YOUR USUAL TRIP" in g  # reactions._sim_suffix reused
    assert reactions._fmt_minutes(240.0) in g and reactions._fmt_minutes(360.0) in g
    assert 'you said: "my commute felt longer"' in g
    assert "your stance: opposed" in g
    assert "Speed limit on the corridor lowered" in g  # the mechanical change line


def test_inferred_grounding_discloses_basis_and_has_no_trip() -> None:
    inferred = [p for p in load_personas() if p.mode == "inferred"]
    assert inferred, "roster must carry inferred personas"
    p = inferred[0]
    agent = _inferred_agent(p.id, p.label, p.stakeholder or "taxpayer", "I have questions")
    g = interview.build_grounding(agent, _ctx([agent]))
    assert "NOT simulated directly" in g
    assert "what the scenario implies for someone like" in g
    assert "HOW IT AFFECTS YOUR USUAL TRIP" not in g
    assert interview.persona_description(p.id) == p.description


def test_unknown_persona_id_degrades_to_label_only() -> None:
    agent = _sim_agent("no_such_persona", "Some Label", "veh1", 100.0, 130.0, "hm")
    g = interview.build_grounding(agent, _ctx([agent]))
    assert "Some Label" in g
    assert interview.persona_description("no_such_persona") is None


def test_leakage_grounding_contains_only_the_interviewed_agents_records() -> None:
    """THE leakage pin: build the full prompt for one agent and assert every OTHER agent's
    distinctive comment, label, raw outcome digits AND formatted minute-forms are absent."""
    a = _sim_agent("leak_a", "LEAK_A_LABEL", "vehA", 7777.0, 7897.0, "LEAK_MARKER_A")
    b = _sim_agent("leak_b", "LEAK_B_LABEL", "vehB", 8888.0, 9188.0, "LEAK_MARKER_B")
    c = _inferred_agent("leak_c", "LEAK_C_LABEL", "taxpayer", "LEAK_MARKER_C")
    ctx = interview.RunContext(run_id="leak-run", mtime_ns=0, agents=[a, b, c], changes=CHANGES,
                               demand_profile="synthetic_demo", tags=None)

    full_a = interview.build_system(a, ctx) + interview.build_user("How was your trip?", [])
    assert "LEAK_MARKER_A" in full_a and reactions._fmt_minutes(7777.0) in full_a  # own records present
    for marker in ("LEAK_MARKER_B", "LEAK_B_LABEL", "8888", reactions._fmt_minutes(8888.0),
                   reactions._fmt_minutes(9188.0), "LEAK_MARKER_C", "LEAK_C_LABEL"):
        assert marker not in full_a, f"agent A's context leaked another agent's record: {marker!r}"

    full_c = interview.build_system(c, ctx) + interview.build_user("What would this mean for you?", [])
    assert "LEAK_MARKER_C" in full_c
    for marker in ("LEAK_MARKER_A", "LEAK_A_LABEL", "LEAK_MARKER_B", "LEAK_B_LABEL", "7777", "8888",
                   reactions._fmt_minutes(7777.0), reactions._fmt_minutes(8888.0),
                   "HOW IT AFFECTS YOUR USUAL TRIP"):
        assert marker not in full_c, f"inferred C's context leaked a sim record: {marker!r}"


# ===================================================================================================
# The guard
# ===================================================================================================


@pytest.mark.parametrize(
    ("text", "rule"),
    [
        ("My drive took 12 minutes this morning.", "digits"),
        ("The street feels safer now with the lower limit.", "safety_direction"),
        ("Most agents support this change.", "tally"),
        ("The majority would back it in a referendum.", "tally"),
        ("There would be fewer collisions on that stretch.", "crash"),
        ("The city should approve this plan.", "verdict"),
        ("This proposal should be rejected outright.", "verdict"),
        ("It is the right choice for the city.", "verdict"),
    ],
)
def test_guard_trips_on_planted_violations(text: str, rule: str) -> None:
    rules = {r for r, _ in interview.audit_interview(text)}
    assert rule in rules


def test_guard_passes_benign_persona_texture() -> None:
    for text in (
        "Nobody asked us first, and I want to see how it works before I trust it.",
        "I'd feel calmer walking home in the evening.",
        "A slower street past the shop might mean people actually stop in.",
        "That's the city's call — I can only tell you about my own morning.",
    ):
        assert interview.audit_interview(text) == [], f"benign texture flagged: {text!r}"


def test_guard_allowlist_lets_a_refusal_name_what_it_refuses() -> None:
    assert interview.audit_interview("I can't give you a verdict on that.") == []


def test_refusal_constants_audit_clean() -> None:
    # A copy edit must not silently break the guard — the fallbacks MUST pass it.
    assert interview.audit_interview(interview.SIM_REFUSAL) == []
    assert interview.audit_interview(interview.INFERRED_REFUSAL) == []
    sim = _sim_agent("x", "X", "v", 1.0, 2.0, "c")
    inf = _inferred_agent("y", "Y", "taxpayer", "c")
    assert interview.refusal_for(sim) == interview.SIM_REFUSAL
    assert interview.refusal_for(inf) == interview.INFERRED_REFUSAL


# ===================================================================================================
# Transcript flattening
# ===================================================================================================


def test_transcript_cap_keeps_last_turns_and_truncates() -> None:
    transcript = [{"role": "user", "text": f"question {chr(65 + i)}"} for i in range(12)]
    flat = interview.flatten_transcript(transcript)
    assert "question A" not in flat and "question D" not in flat  # first 4 dropped (12 - 8)
    assert "question E" in flat and "question L" in flat
    long = [{"role": "agent", "text": "z" * 1000}]
    flat2 = interview.flatten_transcript(long)
    assert "z" * interview.TURN_MAX_CHARS in flat2
    assert "z" * (interview.TURN_MAX_CHARS + 1) not in flat2
    assert flat2.startswith("EARLIER IN THIS INTERVIEW")
    assert "You said: " in flat2
    assert interview.flatten_transcript([]) == ""


# ===================================================================================================
# Run-context cache
# ===================================================================================================


def _write_artifact(path: Path, agents: list[dict]) -> None:
    art = {"meta": {"demand_profile": "synthetic_demo", "scenario": {"changes": CHANGES}}, "agents": agents}
    path.write_text(json.dumps(art), encoding="utf-8")


@pytest.fixture()
def runs_dir(tmp_path: Path, monkeypatch) -> Path:
    monkeypatch.setattr(trajectory_io, "RUNS_DIR", tmp_path)
    interview._CACHE.clear()
    yield tmp_path
    interview._CACHE.clear()


def test_cache_missing_and_unenriched(runs_dir: Path) -> None:
    with pytest.raises(interview.RunNotFound):
        interview.load_run_context("nope")
    _write_artifact(runs_dir / "empty.json", [])
    with pytest.raises(interview.RunNotEnriched):
        interview.load_run_context("empty")
    assert "empty" not in interview._CACHE  # not cached — enrich will rewrite the file


def test_cache_mtime_invalidation(runs_dir: Path) -> None:
    p = runs_dir / "r1.json"
    _write_artifact(p, [_sim_agent("a", "A", "veh1", 10.0, 20.0, "first")])
    ctx1 = interview.load_run_context("r1")
    assert ctx1.agents[0]["reaction"]["comment"] == "first"
    assert interview.load_run_context("r1") is ctx1  # cache hit, same object
    _write_artifact(p, [_sim_agent("a", "A", "veh1", 10.0, 20.0, "second")])
    os.utime(p, ns=(time.time_ns(), ctx1.mtime_ns + 1_000_000))  # force a distinct mtime
    ctx2 = interview.load_run_context("r1")
    assert ctx2.agents[0]["reaction"]["comment"] == "second"


def test_cache_lru_cap(runs_dir: Path) -> None:
    for name in ("r1", "r2", "r3"):
        _write_artifact(runs_dir / f"{name}.json", [_sim_agent("a", "A", "veh1", 10.0, 20.0, name)])
        interview.load_run_context(name)
    assert set(interview._CACHE) == {"r2", "r3"}  # cap 2 — oldest evicted


def test_find_agent_resolution() -> None:
    veh = _sim_agent("pa", "A", "veh9", 10.0, 20.0, "c")
    per = dict(_sim_agent("pb", "B", "", 10.0, 20.0, "c"))
    del per["vehicle_id"]
    per["person_id"] = "ped3"
    inf = _inferred_agent("pc", "C", "taxpayer", "c")
    ctx = _ctx([veh, per, inf])
    assert interview.find_agent(ctx, "veh9") is veh
    assert interview.find_agent(ctx, "ped3") is per
    assert interview.find_agent(ctx, "pc") is inf
    assert interview.find_agent(ctx, "missing") is None
