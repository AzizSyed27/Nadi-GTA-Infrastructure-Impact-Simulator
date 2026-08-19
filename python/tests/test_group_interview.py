"""V2.6a — pure unit coverage for the group-interview ROOM (no server import, no LLM, no HTTP).

The load-bearing invariants: the NEW cross-participant rule catches room-level counting/
characterizing that _TALLY structurally misses ("most of us agree", "everyone here thinks",
"we all want") while staying ROOM-ONLY (audit_interview untouched — every V2.3b/c pin stands),
household-we and the benign persona texture stay legal, and the refusal constants pass the room
guard too (a copy edit must not break it)."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "python" / "src"))

import interview  # noqa: E402
import reactions  # noqa: E402
import report  # noqa: E402

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


def _mandate_agent() -> dict:
    return {
        "persona": {"id": "tfs", "label": "Toronto Fire Services"},
        "reaction": {"comment": "mandate-lens comment", "sentiment": 0.0, "stance": "neutral"},
        "grounding": "mandate",
        "mandate": {"institution": "Toronto Fire Services",
                    "mission": "MISSION_MARKER protecting life and property",
                    "source": "https://example.test/tfs", "retrieved": "2026-08-01"},
        "citations": [{"key": "response_detour", "text": "CITE_MARKER_C a small added amount",
                       "notes": ["free-flow estimates, not dispatch"]}],
    }


def _ctx(agents: list[dict]) -> interview.RunContext:
    return interview.RunContext(run_id="room-run", mtime_ns=0, agents=agents, changes=CHANGES,
                                demand_profile="synthetic_demo", tags=None)

# ===================================================================================================
# The cross-participant rule — room-level counting/characterizing the guard must catch.
# Every form is deliberately _TALLY-INVISIBLE (no majority/consensus/vote vocabulary) — each one
# passing audit_interview but tripping audit_room_utterance proves the new rule earns its keep.
# ===================================================================================================

MUST_TRIP = [
    "Most of us agree the change works.",
    "We all want this.",
    "Everyone here thinks it helps.",
    "Everybody agrees it's an improvement.",
    "The group agrees it's better.",
    "The others all agree with me.",
    "Speaking for the room, we welcome it.",
    "Three of us said the same thing.",
    "As a group we're happy.",
]


@pytest.mark.parametrize("text", MUST_TRIP)
def test_cross_participant_guard_trips(text: str) -> None:
    rules = {r for r, _ in interview.audit_room_utterance(text)}
    assert "cross_participant" in rules, f"room-level claim not caught: {text!r}"


@pytest.mark.parametrize("text", MUST_TRIP)
def test_cross_participant_is_room_only(text: str) -> None:
    """The single-interview guard is UNTOUCHED — none of the room forms yield the new rule there
    (and none trips _TALLY either, which is exactly why the room rule exists)."""
    rules = {r for r, _ in interview.audit_interview(text)}
    assert "cross_participant" not in rules
    assert "tally" not in rules, f"_TALLY already catches {text!r} — drop it from MUST_TRIP"


def test_room_guard_keeps_household_we_and_benign_texture() -> None:
    """Bare first-person-plural stays LEGAL (the household-we pin, verbatim from test_interview),
    as does responding to a named participant and the deflection the room addendum invites."""
    for text in (
        "We would love calmer mornings on our street.",
        "Nobody asked us first, and I want to see how it works before I trust it.",
        "I'd feel calmer walking home in the evening.",
        "A slower street past the shop might mean people actually stop in.",
        "That's the city's call — I can only tell you about my own morning.",
        "I hear what the shop owner said, but my mornings got longer.",
        "I can't speak for everyone here — my own trip got longer.",
        "I can't claim everyone here agrees with me.",
    ):
        assert interview.audit_room_utterance(text) == [], f"benign room texture flagged: {text!r}"
        assert interview.audit_room_utterance(text, "inferred") == [], (
            f"benign room texture flagged for inferred: {text!r}")


def test_room_guard_refusal_constants_clean() -> None:
    # The refusal IS a room utterance (it rides into later speakers' context) — it must pass the
    # room guard under its own grounding, like the single-guard pin at test_interview.py.
    assert interview.audit_room_utterance(interview.SIM_REFUSAL) == []
    assert interview.audit_room_utterance(interview.INFERRED_REFUSAL, "inferred") == []
    assert interview.audit_room_utterance(interview.INSTITUTION_REFUSAL, "mandate", None) == []


def test_room_guard_inherits_full_interview_set() -> None:
    """audit_room_utterance = audit_interview + the room rule: every inherited class still fires,
    and the mandate-only rules stay keyed on the SPEAKER'S grounding (per-speaker keying)."""
    assert "digits" in {r for r, _ in interview.audit_room_utterance("My drive took 12 minutes.")}
    assert "verdict" in {r for r, _ in interview.audit_room_utterance("The city should approve this plan.")}
    assert "tally" in {r for r, _ in interview.audit_room_utterance("Most agents support this change.")}
    operational = "We will send trucks right away."
    mandate_rules = {r for r, _ in interview.audit_room_utterance(operational, "mandate", None)}
    assert {"operational", "first_person"} <= mandate_rules
    sim_rules = {r for r, _ in interview.audit_room_utterance(operational, "sim")}
    assert "operational" not in sim_rules and "first_person" not in sim_rules


def test_room_guard_disclaimer_strip_applies() -> None:
    """The clause-bounded strip covers the new rule too: a licensed disclaimer may name what it
    refuses, but a ', but <room claim>' clause is re-checked and dies."""
    rules = {r for r, _ in interview.audit_room_utterance("I can't give a verdict, but most of us agree.")}
    assert "cross_participant" in rules
    assert "verdict" not in rules  # the disclaimer clause itself stays licensed


def test_room_strip_conjunction_cannot_smuggle_consensus() -> None:
    """Review-caught (V2.6a): report's clause boundary is punctuation-only, so a COMMA-LESS 'but'
    let a consensus claim ride a licensed disclaimer to a clean audit. The room's strip treats
    conjunctions as clause boundaries too (room-local — widening the shared boundary would shift
    the report's audit-retry baseline)."""
    for text in (
        "I can't predict crashes but everyone here agrees it's better.",
        "I can't give a verdict but most of us agree it works.",
    ):
        rules = {r for r, _ in interview.audit_room_utterance(text)}
        assert rules == {"cross_participant"}, f"conjunction smuggle survived: {text!r} -> {rules}"
    # the whole-clause license is untouched: no conjunction -> the disclaimer strips whole
    assert interview.audit_room_utterance("I can't claim everyone here agrees with me.") == []


def test_room_guard_spatial_back_is_not_a_stance() -> None:
    """'back' as support ('the others back the plan') trips; spatial 'went back to their cars'
    must not — review-caught false positive on the bare back stem."""
    assert interview.audit_room_utterance("Everyone here went back to their cars after the meeting.") == []
    assert "cross_participant" in {
        r for r, _ in interview.audit_room_utterance("The others all back the plan.")}


# ===================================================================================================
# Room prompt builders — attribution, caps, addenda, byte-stability, the leakage matrix
# ===================================================================================================


def test_room_flatten_attributes_speakers() -> None:
    a = _sim_agent("pa", "Devi, commuter", "vehA", 100.0, 130.0, "own words A")
    b = _sim_agent("pb", "Bao, cyclist", "vehB", 200.0, 230.0, "own words B")
    ctx = _ctx([a, b])
    transcript = [
        {"role": "user", "text": "What changed for you?"},
        {"role": "agent", "text": "Mornings feel slower.", "agent_id": "vehA", "agent_index": 0},
        {"role": "agent", "text": "I like the calmer street.", "agent_id": "vehB", "agent_index": 1},
    ]
    flat_a = interview.flatten_room_transcript(transcript, ctx, a)
    assert flat_a.startswith("EARLIER IN THIS GROUP INTERVIEW (oldest first):")
    assert "Interviewer: What changed for you?" in flat_a
    assert "You said: Mornings feel slower." in flat_a
    assert "Bao, cyclist said: I like the calmer street." in flat_a
    flat_b = interview.flatten_room_transcript(transcript, ctx, b)
    assert "Devi, commuter said: Mornings feel slower." in flat_b
    assert "You said: I like the calmer street." in flat_b


def test_room_flatten_unresolvable_ref_degrades_to_neutral() -> None:
    """A ref the artifact no longer resolves (membership drift after a re-enrich) degrades to a
    neutral attribution — never an exception, never a 400; the guard floors the content."""
    a = _sim_agent("pa", "Devi, commuter", "vehA", 100.0, 130.0, "own words A")
    ctx = _ctx([a])
    transcript = [
        {"role": "agent", "text": "Ghost words.", "agent_id": "ghost", "agent_index": 7},
        {"role": "agent", "text": "Anonymous words."},
    ]
    flat = interview.flatten_room_transcript(transcript, ctx, a)
    assert "Another participant said: Ghost words." in flat
    assert "Another participant said: Anonymous words." in flat


def test_room_flatten_resolves_sibling_by_index() -> None:
    """Sibling inferred voices share one persona.id — self-detection is by the RESOLVED record's
    object identity, so an index-qualified ref marks exactly one sibling's turns as 'You said:'."""
    sib0 = _inferred_agent("taxpayer_voice", "Omar, taxpayer", "taxpayer", "first sibling words")
    sib1 = _inferred_agent("taxpayer_voice", "Omar, taxpayer", "taxpayer", "SIBLING wants receipts")
    ctx = _ctx([sib0, sib1])
    transcript = [{"role": "agent", "text": "My taxes, my ask.", "agent_id": "taxpayer_voice",
                   "agent_index": 1}]
    assert "You said: My taxes, my ask." in interview.flatten_room_transcript(transcript, ctx, sib1)
    assert "Omar, taxpayer said: My taxes, my ask." in interview.flatten_room_transcript(transcript, ctx, sib0)
    # id-only ref resolves to the FIRST sibling (the find_agent fallback) — self only for sib0
    id_only = [{"role": "agent", "text": "Receipts, please.", "agent_id": "taxpayer_voice"}]
    assert "You said: Receipts, please." in interview.flatten_room_transcript(id_only, ctx, sib0)
    assert "Omar, taxpayer said: Receipts, please." in interview.flatten_room_transcript(id_only, ctx, sib1)


def test_room_flatten_cap_and_truncation() -> None:
    a = _sim_agent("pa", "Devi, commuter", "vehA", 100.0, 130.0, "own words A")
    ctx = _ctx([a])
    transcript = [{"role": "user", "text": f"turn number {i:03d}"} for i in range(30)]
    flat = interview.flatten_room_transcript(transcript, ctx, a)
    assert "turn number 005" not in flat  # 30 - 24 = first 6 dropped
    assert "turn number 006" in flat and "turn number 029" in flat
    long = [{"role": "agent", "text": "z" * 1000, "agent_id": "vehA", "agent_index": 0}]
    flat2 = interview.flatten_room_transcript(long, ctx, a)
    assert "z" * interview.TURN_MAX_CHARS in flat2
    assert "z" * (interview.TURN_MAX_CHARS + 1) not in flat2
    assert interview.flatten_room_transcript([], ctx, a) == ""


def test_room_system_is_constitution_plus_addendum_plus_grounding() -> None:
    a = _sim_agent("pa", "Devi, commuter", "vehA", 100.0, 130.0, "own words A")
    inf = _inferred_agent("pb", "Omar, taxpayer", "taxpayer", "show me")
    for agent in (a, inf):
        sys_prompt = interview.build_room_system(agent, _ctx([agent]))
        assert interview.INTERVIEW_CONSTITUTION in sys_prompt  # the base is KEPT, never edited
        assert interview.ROOM_ADDENDUM in sys_prompt
        assert "Speed limit on the corridor lowered" in sys_prompt  # grounding present


def test_room_system_mandate_gets_institution_addendum() -> None:
    c = _mandate_agent()
    sys_c = interview.build_room_system(c, _ctx([c]))
    assert interview.INSTITUTION_CONSTITUTION in sys_c
    assert interview.INSTITUTION_ROOM_ADDENDUM in sys_c
    assert interview.ROOM_ADDENDUM not in sys_c
    assert "THIRD person" in sys_c  # the mandate reply shape
    assert "MISSION_MARKER" in sys_c  # mandate grounding present


def test_single_interview_prompts_stay_room_free() -> None:
    """The byte-stability pin: single-interview prompts carry NO room material, the single flatten
    header is unchanged, and build_system equals the pre-refactor literal composition exactly (the
    shape-string extraction is invisible)."""
    a = _sim_agent("pa", "Devi, commuter", "vehA", 100.0, 130.0, "own words A")
    c = _mandate_agent()
    ctx_a, ctx_c = _ctx([a]), _ctx([c])
    for agent, ctx in ((a, ctx_a), (c, ctx_c)):
        single = interview.build_system(agent, ctx)
        assert interview.ROOM_ADDENDUM not in single
        assert interview.INSTITUTION_ROOM_ADDENDUM not in single
    assert interview.flatten_transcript([{"role": "user", "text": "q"}]).startswith(
        "EARLIER IN THIS INTERVIEW (oldest first):")
    assert interview.build_system(a, ctx_a) == (
        interview.INTERVIEW_CONSTITUTION + interview.build_grounding(a, ctx_a) + "\n\n"
        + report._json_instr('{"text": "<your answer, 1-3 plain sentences, in character, NO digits>"}'))
    assert interview.build_system(c, ctx_c) == (
        interview.INSTITUTION_CONSTITUTION + interview.build_grounding(c, ctx_c) + "\n\n"
        + report._json_instr('{"text": "<your answer, 1-3 plain sentences, THIRD person, NO digits>"}'))


def test_room_leakage_grounding_matrix() -> None:
    """The spec's leakage matrix, unit level: B's marker outcomes absent from A's prompts ALWAYS;
    B reaches A only as B's actual utterance (attributed); C (institution) never gains either
    agent's records — its grounding stays mission+citations only."""
    a = _sim_agent("leak_a", "LEAK_A_LABEL", "vehA", 7777.0, 7897.0, "LEAK_MARKER_A")
    b = _sim_agent("leak_b", "LEAK_B_LABEL", "vehB", 8888.0, 9188.0, "LEAK_MARKER_B")
    c = _mandate_agent()
    ctx = _ctx([a, b, c])
    q = "How does this feel for the room?"

    full_a = interview.build_room_system(a, ctx) + interview.build_room_user(q, [], ctx, a)
    assert "LEAK_MARKER_A" in full_a and reactions._fmt_minutes(7777.0) in full_a  # own records
    for marker in ("LEAK_MARKER_B", "LEAK_B_LABEL", "8888", reactions._fmt_minutes(8888.0),
                   reactions._fmt_minutes(9188.0), "MISSION_MARKER", "CITE_MARKER_C"):
        assert marker not in full_a, f"A's room prompt leaked another participant's record: {marker!r}"

    utter = "the mornings feel different to me"
    transcript = [{"role": "agent", "text": utter, "agent_id": "vehB", "agent_index": 1}]
    user_a = interview.build_room_user(q, transcript, ctx, a)
    assert f"LEAK_B_LABEL said: {utter}" in user_a  # B's utterance flows — attributed
    for marker in ("LEAK_MARKER_B", "8888", reactions._fmt_minutes(8888.0)):
        assert marker not in user_a, f"B's RECORD leaked beyond B's utterance: {marker!r}"
    assert user_a.count("LEAK_B_LABEL") == 1  # the label appears ONLY as that utterance's attribution

    full_c = interview.build_room_system(c, ctx) + interview.build_room_user(q, transcript, ctx, c)
    assert "MISSION_MARKER" in full_c and "CITE_MARKER_C" in full_c  # own mandate grounding
    for marker in ("LEAK_MARKER_A", "LEAK_A_LABEL", "LEAK_MARKER_B", "7777", "8888",
                   reactions._fmt_minutes(7777.0), reactions._fmt_minutes(8888.0),
                   "HOW IT AFFECTS YOUR USUAL TRIP"):
        assert marker not in full_c, f"institution C gained a traveler's record: {marker!r}"
    assert full_c.count("LEAK_B_LABEL") == 1  # only the attribution of B's actual utterance
