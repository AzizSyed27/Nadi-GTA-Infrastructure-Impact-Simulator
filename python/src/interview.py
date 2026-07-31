"""V2.3b — in-character persona interviews over an enriched run's voices.

EPHEMERAL by construction: this module READS the enriched artifact and writes NOTHING — no artifact
mutation, no sidecars, no run-state. A transcript lives only in the client's session.

Grounding is built SERVER-SIDE from the artifact (the client sends ids, never facts): one agent's
persona (description re-hydrated from personas.json — the wire trims it to {id,label}), its prior
reaction, and — for sim-grounded agents — its own trip record via reactions._sim_suffix. Inferred
agents are interviewable too, with their basis disclosed in-character ("I wasn't simulated directly
— speaking from what the scenario implies for someone like me").

The honesty guard is the FLOOR no matter what the client sends: the question and transcript are
client-supplied free text and could plant digits/tallies/verdict bait for the model to echo — but
``audit_interview`` (report.audit_prose + a narrow verdict pass) runs on EVERY generated answer,
retry-once then an in-character refusal. Referendum deflection lives in BOTH the system prompt and
the guard (report._TALLY + _VERDICT).
"""

from __future__ import annotations

import json
import re
from collections import OrderedDict
from dataclasses import dataclass

import reactions
import report
import trajectory_io
from personas import load_personas

QUESTION_MAX_CHARS = 500
TRANSCRIPT_MAX_TURNS = 8  # last 4 exchanges — cost boundedness; server-side cap is authoritative
TURN_MAX_CHARS = 400


class RunNotFound(Exception):
    """No artifact exists for the run id."""


class RunNotEnriched(Exception):
    """The artifact exists but carries no agents[] — voices haven't been generated."""


# ===================================================================================================
# Run context — a slim per-run extract of the (possibly ~90 MB) artifact, LRU-cached
# ===================================================================================================


@dataclass
class RunContext:
    run_id: str
    mtime_ns: int  # invalidation token: a re-enrich rewrites the artifact → mtime changes → reload
    agents: list[dict]  # raw wire dicts (~212 small objects)
    changes: list[dict]
    demand_profile: str
    tags: list[str] | None


_CACHE: OrderedDict[str, RunContext] = OrderedDict()
_CACHE_CAP = 2


def load_run_context(run_id: str) -> RunContext:
    """Load {agents, changes, demand_profile, tags} for a run from the canonical artifact, dropping the
    trajectory bulk immediately. Raw json.loads on purpose — a full pydantic validate of a 90 MB artifact
    is the expensive part, and the artifact was schema-validated when it was dumped."""
    path = trajectory_io.RUNS_DIR / f"{run_id}.json"
    if not path.is_file():
        raise RunNotFound(run_id)
    st = path.stat()
    hit = _CACHE.get(run_id)
    if hit is not None and hit.mtime_ns == st.st_mtime_ns:
        _CACHE.move_to_end(run_id)
        return hit
    raw = json.loads(path.read_text(encoding="utf-8"))
    meta = raw.get("meta") or {}
    sc = meta.get("scenario") or {}
    # raw-dict changes_of: 0.5.0+ has changes[]; pre-0.5.0 has the single change
    changes = sc.get("changes") or ([sc["change"]] if sc.get("change") else [])
    agents = raw.get("agents") or []
    if not agents:
        # not cached — the voices enrich will rewrite this file
        raise RunNotEnriched(run_id)
    ctx = RunContext(
        run_id=run_id,
        mtime_ns=st.st_mtime_ns,
        agents=agents,
        changes=changes,
        demand_profile=meta.get("demand_profile") or "synthetic_demo",
        tags=sc.get("tags") or None,
    )
    _CACHE[run_id] = ctx
    _CACHE.move_to_end(run_id)
    while len(_CACHE) > _CACHE_CAP:
        _CACHE.popitem(last=False)
    return ctx  # `raw` (the full tree) is garbage from here — only the slim extract is retained


def _wire_id(a: dict) -> str | None:
    return a.get("vehicle_id") or a.get("person_id") or (a.get("persona") or {}).get("id")


def find_agent(ctx: RunContext, agent_id: str, agent_index: int | None = None) -> dict | None:
    """Resolve the client's agent reference — the established convention is
    ``vehicle_id ?? person_id ?? persona.id`` (web/lib/viz.ts agentId).

    INFERRED voices are NOT unique under that convention: the sampler round-robins few inferred
    personas over more records, so several sibling records share one persona.id (with distinct
    reaction comments — review-caught misattribution). The client therefore also sends the record's
    ``agents[]`` INDEX; when it's valid AND its id matches, it picks the exact sibling. An
    invalid/mismatched index falls back to the first-match scan (old clients keep working)."""
    if agent_index is not None and 0 <= agent_index < len(ctx.agents):
        a = ctx.agents[agent_index]
        if _wire_id(a) == agent_id:
            return a
    for a in ctx.agents:
        if _wire_id(a) == agent_id:
            return a
    return None


# ===================================================================================================
# Prompt build — ONE agent + run-level context, nothing else (the structural leakage guarantee)
# ===================================================================================================

INTERVIEW_CONSTITUTION = (
    "You are role-playing ONE specific Toronto traveler being interviewed by a city planner about a "
    "PROPOSED road change, for a planning preview. Speak in the FIRST PERSON, in character, 1-3 plain "
    "sentences. This is an ANTICIPATED perspective — never a verdict, prediction, or recommendation. "
    "HARD RULES you must always follow:\n"
    "  1. Speak ONLY about your OWN trip and your own perspective. You do not know other travelers, "
    "groups, totals, averages, or the run's overall results — never speak for them.\n"
    "  2. NO digits or numbers in your answer — give rough amounts in words ('about four minutes').\n"
    "  3. NEVER say the change made things safer or more dangerous — you cannot know that.\n"
    "  4. NO crash, accident, collision, or injury talk — you are describing everyday travel.\n"
    "  5. If asked what the city should do, whether the change should go ahead, how people would vote, "
    "or how many support it — deflect IN CHARACTER: that's the city's call and you can only speak to "
    "your own morning. Never give a verdict, a recommendation, or a headcount.\n"
    "  6. Do NOT invent specifics not provided (street names, times, places, events).\n\n"
)


def persona_description(persona_id: str) -> str | None:
    """Re-hydrate the rich persona description (the wire trims persona to {id,label}). None on roster
    drift — the interview degrades to label-only grounding, never a 500."""
    for p in load_personas():
        if p.id == persona_id:
            return p.description
    return None


def build_grounding(agent: dict, ctx: RunContext) -> str:
    """The per-agent grounding block. Receives ONE agent + the run-level change context and touches
    nothing else — no other agent's records can leak into it by construction (test-pinned)."""
    persona = agent.get("persona") or {}
    desc = persona_description(persona.get("id", ""))
    who = f"- {persona.get('label', 'a Toronto traveler')}" + (f": {desc}" if desc else "")
    change = (
        f"THE PROPOSED CHANGE: {reactions._zone_preface(ctx.changes, ctx.tags, ctx.demand_profile)}"
        f"{reactions._changes_line(ctx.changes, ctx.demand_profile)}"
    )
    reaction = agent.get("reaction") or {}
    prior = ""
    if reaction.get("comment"):
        prior = (
            f'Earlier, reacting to this change, you said: "{reaction["comment"]}" '
            f"(your stance: {reaction.get('stance', 'neutral')}). Stay consistent with that person.\n\n"
        )
    if agent.get("grounding", "sim") == "sim" and agent.get("outcome"):
        basis = (
            reactions._sim_suffix(agent["outcome"])  # renders the trip minutes into the PROMPT (guard audits output only)
            + "\n\nIf the interviewer asks for exact figures, give rough amounts in WORDS "
            "('about four minutes'), never digits — the exact numbers are shown beside this chat."
        )
    else:
        stakeholder = agent.get("stakeholder") or persona.get("stakeholder")
        basis = (
            f"{reactions._inferred_context(stakeholder, ctx.changes)}\n\n"
            "IMPORTANT: you were NOT simulated directly — you speak from what the scenario implies for "
            "someone like you. If asked about your trip or your numbers, say so plainly, in your own "
            "voice (for example: \"I wasn't simulated directly — I'm speaking from what the scenario "
            "implies for someone like me\")."
        )
    return f"{change}\n\nYour character:\n{who}\n\n{prior}{basis}"


def build_system(agent: dict, ctx: RunContext) -> str:
    """System prompt: constitution + grounding + reply-shape. Invariant across an interview's turns
    (the transcript rides the user message) → DeepSeek prefix-cache hits."""
    return (
        INTERVIEW_CONSTITUTION
        + build_grounding(agent, ctx)
        + "\n\n"
        + report._json_instr('{"text": "<your answer, 1-3 plain sentences, in character, NO digits>"}')
    )


def flatten_transcript(transcript: list[dict]) -> str:
    """Serialize the (client-held) transcript into the user message — the LLMClient protocol is
    single-turn. Server-side cap: last TRANSCRIPT_MAX_TURNS turns, TURN_MAX_CHARS chars each."""
    turns = [t for t in transcript if (t.get("text") or "").strip()][-TRANSCRIPT_MAX_TURNS:]
    if not turns:
        return ""
    lines = [
        ("Interviewer: " if t.get("role") == "user" else "You said: ") + t["text"][:TURN_MAX_CHARS]
        for t in turns
    ]
    return "EARLIER IN THIS INTERVIEW (oldest first):\n" + "\n".join(lines) + "\n\n"


def build_user(question: str, transcript: list[dict]) -> str:
    return (
        flatten_transcript(transcript)
        + f"INTERVIEWER'S QUESTION: {question}\n\n"
        "Answer in character, 1-3 plain sentences."
    )


# ===================================================================================================
# The guard — report.audit_prose (digits/safety-direction/tally/crash) + a narrow VERDICT pass
# ===================================================================================================

# Verdict language = directives at the CITY's decision. Kept narrow so persona grievance texture
# ("nobody asked us first", "I'd feel calmer") never trips it — the retry path absorbs rare misses.
# Review-hardened: negated should ("shouldn't go ahead") + recommend-forms are verdicts too.
_VERDICT = re.compile(
    r"\b(?:the\s+city|council|planners?)\s+should\b"
    r"|\bshould(?:n'?t|\s+not)?\s+(?:be\s+)?(?:approved?|rejected?|scrapped|cancell?ed|built|"
    r"go\s+ahead|proceed)\b"
    r"|\b(?:approve|reject|greenlight|scrap|cancel)\s+(?:this|the)\s+(?:change|plan|proposal|project)\b"
    r"|\bverdict\b|\brecommend\w*\b"
    r"|\b(?:right|wrong|best|better)\s+(?:choice|option|decision|call)\s+for\s+the\s+"
    r"(?:city|corridor|neighbou?rhood)\b",
    re.I,
)


def audit_interview(text: str) -> list[tuple[str, str]]:
    """report.audit_prose + the verdict rule. The _ALLOW skip (a refusal may name the thing it
    refuses) is NOT a whole-sentence pass here: a compound sentence pairing a disclaimer clause with
    a real claim ("I can't give a verdict, but the majority should approve it") would smuggle the
    claim past audit_prose's skip (review-caught) — so allow-listed sentences get their disclaimer
    span STRIPPED and the remainder re-checked against every non-digit rule. Empty = clean."""
    viol = report.audit_prose(text)
    for s in report._sentences(text):
        if report._ALLOW.search(s):
            # re-check what's left once the licensed "can't … verdict/predict/…" span is removed
            remainder = report._ALLOW.sub("", s)
            if report._safety_direction(remainder):
                viol.append(("safety_direction", s))
            if report._TALLY.search(remainder):
                viol.append(("tally", s))
            if report._CRASH.search(remainder):
                viol.append(("crash", s))
            if _VERDICT.search(remainder):
                viol.append(("verdict", s))
        elif _VERDICT.search(s):
            viol.append(("verdict", s))
    seen: set[tuple[str, str]] = set()
    out: list[tuple[str, str]] = []
    for v in viol:
        if v not in seen:
            seen.add(v)
            out.append(v)
    return out


# In-character deterministic fallbacks (retry failed / LLM down). Unit-pinned to audit clean —
# a copy edit must not silently break the guard.
SIM_REFUSAL = (
    "Honestly, I can only speak to my own morning and how the trip felt for me — "
    "ask me about that and I'll tell you straight."
)
INFERRED_REFUSAL = (
    "I can only speak from where I stand — I wasn't one of the measured trips. "
    "Ask me what this would mean for someone like me."
)


def refusal_for(agent: dict) -> str:
    return SIM_REFUSAL if agent.get("grounding", "sim") == "sim" else INFERRED_REFUSAL


# ===================================================================================================
# The guarded answer — the server._guarded_answer shape, persona-voiced (temp 0.8)
# ===================================================================================================


async def answer(client, ctx: RunContext, agent: dict, question: str,
                 transcript: list[dict]) -> tuple[str, dict]:
    """Generate → audit → retry once quoting violations → refuse in character. A live request never
    hard-crashes: LLM exceptions return the refusal with audit.status='error'."""
    system = build_system(agent, ctx)
    user = build_user(question, transcript)
    try:
        obj = await report._call(client, system, user, report._TextWire, temperature=0.8)
    except Exception as e:  # noqa: BLE001 — provider SDK errors vary
        return refusal_for(agent), {"status": "error", "detail": str(e)[:140]}
    text = obj["text"].strip()
    if not text:  # a degenerate empty answer must not render as a blank clean bubble
        return refusal_for(agent), {"status": "error", "detail": "empty answer"}
    v1 = audit_interview(text)
    if not v1:
        return text, {"status": "clean", "violations": []}

    quoted = "; ".join(f'"{s}" (rule: {r})' for r, s in v1)
    retry = (
        user + "\n\nYOUR PREVIOUS ANSWER BROKE THE RULES — it contained: " + quoted + ". Rewrite it "
        "in character WITHOUT any of those: no digits, no safer/more-dangerous claims, no vote/tally "
        "words, no crash/injury words, no telling the city what to do."
    )
    caught = [{"rule": r, "sentence": s} for r, s in v1]
    try:
        obj = await report._call(client, system, retry, report._TextWire, temperature=0.8)
    except Exception as e:  # noqa: BLE001
        return refusal_for(agent), {"status": "error", "detail": str(e)[:140], "violations": caught}
    text2 = obj["text"].strip()
    if not text2:
        return refusal_for(agent), {"status": "error", "detail": "empty answer", "violations": caught}
    v2 = audit_interview(text2)
    if v2:
        return refusal_for(agent), {
            "status": "failed",
            "violations": caught,
            "still_present": [{"rule": r, "sentence": s} for r, s in v2],
        }
    return text2, {"status": "resolved_on_retry", "violations": caught}
