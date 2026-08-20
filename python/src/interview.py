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

# V2.6a -- the group-interview ROOM: 3-5 voices answer the same question in sequence, each
# hearing the others' actual words. The room transcript outlives a 1:1 chat (a 5-voice round
# is ~6 turns), so its cap is wider; per-turn truncation stays TURN_MAX_CHARS.
GROUP_MIN_AGENTS = 3
GROUP_MAX_AGENTS = 5
ROOM_TRANSCRIPT_MAX_TURNS = 24


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


# V2.3c — the institutional (mandate) interview constitution: NOT role-play. These are REAL
# organizations — the answers present a mandate-lens reading by this tool, never the institution
# speaking. First person is forbidden (the _FIRST_PERSON guard backs this up).
INSTITUTION_CONSTITUTION = (
    "You are presenting how a REAL institution's PUBLISHED mandate reads against facts computed by a "
    "city-planning preview run. You are NOT the institution and must NEVER speak as it — always third "
    "person ('the mandate prioritizes…', 'read against the mandate, the run computed…'); the words "
    "we/our/us are forbidden. 1-3 plain sentences. HARD RULES you must always follow:\n"
    "  1. Say ONLY two kinds of things: what the published mandate (quoted below, with its source) "
    "prioritizes, and what THIS run computed (the cited facts below). Nothing else exists.\n"
    "  2. NO digits or numbers — give rough amounts in words; the exact figures are shown beside this "
    "chat with their caveats.\n"
    "  3. NEVER make operational claims — dispatch, deployment, staffing, coverage, or response-time "
    "commitments. The tool computed only a FREE-FLOW route estimate (not a dispatch model, a lower "
    "bound); if asked an operational question, refuse and name that limitation.\n"
    "  4. NEVER say the change made things safer or more dangerous; no crash/collision/injury talk — "
    "the run measures surrogate signals only.\n"
    "  5. If asked what the city should do or how many support the change — that is not the mandate's "
    "or this tool's call; say so plainly. Never a verdict, recommendation, or headcount.\n"
    "  6. Do NOT invent specifics not provided.\n\n"
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
    if agent.get("grounding") == "mandate":
        # V2.3c — the mandate branch MUST precede the inferred fallback: the grounding is the sourced
        # mandate + THIS agent's citations verbatim, nothing else (the leakage guarantee holds — one
        # agent's fields only).
        md = agent.get("mandate") or {}
        cites = agent.get("citations") or []
        lines = [
            f"THE INSTITUTION: {md.get('institution', persona.get('label', ''))}.",
            f"PUBLISHED MANDATE (source {md.get('source', 'unknown')}, retrieved "
            f"{md.get('retrieved', 'unknown')}): \"{md.get('mission', '')}\"",
            "",
            "THE FACTS THIS RUN COMPUTED (the ONLY figures that exist — each with the caveats that "
            "must ride along):",
        ]
        for c in cites:
            lines.append(f"- ({c.get('key')}) {c.get('text')}")
            for n in c.get("notes") or []:
                lines.append(f"  - caveat: {n}.")
        return f"{change}\n\n" + "\n".join(lines)
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


_MANDATE_SHAPE = '{"text": "<your answer, 1-3 plain sentences, THIRD person, NO digits>"}'
_SIM_SHAPE = '{"text": "<your answer, 1-3 plain sentences, in character, NO digits>"}'


def build_system(agent: dict, ctx: RunContext) -> str:
    """System prompt: constitution + grounding + reply-shape. Invariant across an interview's turns
    (the transcript rides the user message) → DeepSeek prefix-cache hits. Mandate agents get the
    institutional constitution (third person, mandate+facts only, operational refusal)."""
    if agent.get("grounding") == "mandate":
        return (
            INSTITUTION_CONSTITUTION
            + build_grounding(agent, ctx)
            + "\n\n"
            + report._json_instr(_MANDATE_SHAPE)
        )
    return (
        INTERVIEW_CONSTITUTION
        + build_grounding(agent, ctx)
        + "\n\n"
        + report._json_instr(_SIM_SHAPE)
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
# V2.6a — the ROOM: prompt builders for the group interview. Grounding is UNCHANGED (build_grounding
# — one agent's fields only, the structural leakage guarantee); the room enters as an ADDENDUM to the
# constitution (the base constants are never edited — single-interview prompts stay byte-stable) plus
# a per-speaker flatten of the SHARED transcript. System stays turn-invariant per speaker (prefix
# caching); everything shared rides the user message.
# ===================================================================================================

# Resolves the base constitution's rule-1 tension for a room: the speaker HEARS the other
# participants' quoted words and may respond to them — but knows nothing else about them.
ROOM_ADDENDUM = (
    "THIS IS A GROUP INTERVIEW — several participants answer the same planner in one room, and you "
    "can hear each other. You may respond to what another participant SAID (their quoted words in "
    "the transcript) — agree or disagree from your own experience — but you know NOTHING about them "
    "beyond those words: never count the room's views, never claim agreement or consensus, and "
    "never characterize what the group, the room, or 'everyone' thinks.\n\n"
)
# Third-person variant (no we/our/us — don't model forbidden diction in the prompt itself).
INSTITUTION_ROOM_ADDENDUM = (
    "THIS IS A GROUP SESSION — traveler participants answer in the same room, and their quoted "
    "words appear in the transcript. The mandate-lens reading may acknowledge, in the third person, "
    "what a specific participant said, but must still present ONLY what the published mandate "
    "prioritizes and what this run computed — never count the room's views, never claim consensus, "
    "and never characterize the group's opinion.\n\n"
)


def flatten_room_transcript(transcript: list[dict], ctx: RunContext, self_agent: dict) -> str:
    """The shared room transcript, serialized PER SPEAKER: own turns render as 'You said:', other
    participants as '<label> said:' (label from the SERVER-resolved agent — ids on the wire, never
    labels-as-facts), the interviewer as 'Interviewer:'. Self-detection is by the resolved record's
    object identity, so index-qualified refs mark exactly one sibling. An unresolvable ref (agent
    set drifted under a re-enrich) degrades to a neutral attribution — never an error; the guard
    floors the content either way. Caps: last ROOM_TRANSCRIPT_MAX_TURNS turns, TURN_MAX_CHARS each."""
    turns = [t for t in transcript if (t.get("text") or "").strip()][-ROOM_TRANSCRIPT_MAX_TURNS:]
    if not turns:
        return ""
    lines = []
    for t in turns:
        if t.get("role") == "user":
            prefix = "Interviewer: "
        else:
            a = find_agent(ctx, t["agent_id"], t.get("agent_index")) if t.get("agent_id") else None
            if a is self_agent:
                prefix = "You said: "
            elif a is not None:
                prefix = f"{(a.get('persona') or {}).get('label') or 'Another participant'} said: "
            else:
                prefix = "Another participant said: "
        lines.append(prefix + t["text"][:TURN_MAX_CHARS])
    return "EARLIER IN THIS GROUP INTERVIEW (oldest first):\n" + "\n".join(lines) + "\n\n"


def build_room_user(question: str, transcript: list[dict], ctx: RunContext, self_agent: dict) -> str:
    return (
        flatten_room_transcript(transcript, ctx, self_agent)
        + f"INTERVIEWER'S QUESTION (to the whole room): {question}\n\n"
        "Answer in character, 1-3 plain sentences. You may respond to what other participants "
        "said, but speak only for yourself."
    )


def build_room_system(agent: dict, ctx: RunContext) -> str:
    """build_system's room sibling: constitution + ROOM addendum + the UNCHANGED per-agent grounding
    + reply-shape. Turn-invariant per speaker per room (the shared transcript rides the user
    message) → DeepSeek prefix-cache hits, like build_system."""
    if agent.get("grounding") == "mandate":
        return (
            INSTITUTION_CONSTITUTION
            + INSTITUTION_ROOM_ADDENDUM
            + build_grounding(agent, ctx)
            + "\n\n"
            + report._json_instr(_MANDATE_SHAPE)
        )
    return (
        INTERVIEW_CONSTITUTION
        + ROOM_ADDENDUM
        + build_grounding(agent, ctx)
        + "\n\n"
        + report._json_instr(_SIM_SHAPE)
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


# V2.3c — MANDATE-interview-only rules. _OPERATIONAL = operational claims the tool didn't compute
# (dispatch/deployment/coverage/response-time commitments — the run has only a free-flow route
# estimate). Subjects include the ROSTER LABELS (review-caught: "Toronto Fire Services would
# dispatch…" is the most likely phrasing — the grounding leads with the institution's name — and a
# fixed pronoun list missed it). False positives degrade to the refusal — guard-is-floor.
# _FIRST_PERSON backs the impersonation rule: mandate answers are third person ALWAYS — "we/our/us"
# reads as the real institution speaking — EXCEPT when the words are quoted mandate text (the
# Transportation Services mission itself says "our residents"; the mission is SERVER-loaded, so the
# license can't be client-smuggled).
def _operational_pattern() -> re.Pattern:
    from institutions import load_roster

    labels = "|".join(re.escape(e["label"]) for e in load_roster())
    return re.compile(
        rf"\b(?:we|they|{labels}|the\s+(?:service|department|division|board|city)|"
        r"the\s+fire\s+department|the\s+school\s+board|crews?|units?|trucks?|engines?)\s+"
        r"(?:would|will|could|can|are\s+going\s+to)\s+"
        r"(?:dispatch|deploy|send|respond|arrive|staff|cover|reroute)\b"
        r"|\bresponse\s+times?\s+(?:is|are|was|were|would\s+be|will\s+be)\b"
        r"|\bwithin\s+\w+\s+minutes?\b",
        re.I,
    )


_OPERATIONAL = _operational_pattern()
_FIRST_PERSON = re.compile(r"\b(?:we|our|us)\b", re.I)


def _first_person_violation(text: str, mission: str | None) -> bool:
    """True iff the text uses we/our/us OUTSIDE quoted mandate wording. License = the match's
    two-word window appears verbatim in the (server-loaded) mission — 'serves our residents' quoted
    from the mission is compliant speech; 'our crews' is the institution speaking and flags."""
    lic = (mission or "").lower()
    for m in _FIRST_PERSON.finditer(text):
        window = re.findall(r"[a-z']+", text[m.start():m.start() + 40].lower())[:2]
        if lic and len(window) == 2 and " ".join(window) in lic:
            continue
        return True
    return False


def audit_interview(text: str, grounding: str = "sim", mission: str | None = None) -> list[tuple[str, str]]:
    """report.audit_prose (smuggle-proof since the clause-bounded _strip_disclaimers hoist — a
    compound sentence pairing a disclaimer with a real claim is re-checked on its remainder) + the
    interview-specific verdict rule, applied through the SAME disclaimer strip so a refusal may
    still name the thing it refuses. Mandate interviews additionally get the operational-claim and
    first-person rules (keyed on the SERVER-loaded agent's grounding + mission, never client input).
    Empty = clean."""
    viol = report.audit_prose(text)
    for s in report._sentences(text):
        t = report._strip_disclaimers(s) if report._ALLOW.search(s) else s
        if _VERDICT.search(t):
            viol.append(("verdict", s))
        if grounding == "mandate":
            if _OPERATIONAL.search(t):
                viol.append(("operational", s))
            if _first_person_violation(t, mission):
                viol.append(("first_person", s))
    seen: set[tuple[str, str]] = set()
    out: list[tuple[str, str]] = []
    for v in viol:
        if v not in seen:
            seen.add(v)
            out.append(v)
    return out


# V2.6a -- the ROOM-ONLY cross-participant rule: no room-level counting or characterizing.
# _TALLY structurally misses "most of us agree" (its most-alternation is a fixed noun list),
# "everyone here thinks", and "we all want" -- and bare first-person-plural must STAY legal for
# sim/inferred voices (the household-we pin), so the family is anchored on collective QUANTIFIERS
# ("N of us") and stance verbs after collective subjects, never bare we/our/us. "speaking for" is
# gerund-only ON PURPOSE: the deflection "I can't speak for everyone here" is the GOOD answer the
# room addendum invites, and _ALLOW cannot license it (its verb list lacks "speak"). Accepted
# misses ("everyone seems to agree", possessive "the group's concerns") -- retry + addendum absorb;
# guard-is-floor.
_ROOM_ATTITUDE = (r"(?:agree\w*|disagree\w*|think\w*|thought|feel\w*|felt|want\w*|support\w*|"
                  r"oppos\w*|believ\w*|back(?:s|ed|ing)?\s+(?:it|this|that|the)|welcom\w*|"
                  r"say\w*|said|nodd\w*)")  # back = SUPPORT sense only ("back the plan"), never spatial "went back to"
_CROSS_PARTICIPANT = re.compile(
    # counting the room: quantifier-of-us, unanchored (counting is the core banned form)
    r"\b(?:all|most|many|several|half|none|two|three|four|five|the\s+rest|every\s+one)\s+of\s+us\b"
    # softer collectives only with a stance verb (household/couple texture stays legal)
    rf"|\b(?:some|both)\s+of\s+us\s+(?:\w+\s+)?{_ROOM_ATTITUDE}"
    rf"|\b(?:we|us)\s+(?:all|both)\s+(?:\w+\s+)?{_ROOM_ATTITUDE}"
    # room deixis + stance: "everyone here thinks", "nobody in this room wants"
    rf"|\b(?:everyone|everybody|no\s*one|nobody)\s+(?:here|in\s+th(?:is|e)\s+room|at\s+th(?:is|e)\s+table)\s+(?:\w+\s+){{0,2}}{_ROOM_ATTITUDE}"
    # bare "everyone agrees" (zero-word window -- "ask everyone what they think" stays legal)
    rf"|\b(?:everyone|everybody)\s+{_ROOM_ATTITUDE}"
    # characterizing the collective: "the group agrees", "this room clearly wants"
    rf"|\b(?:the|this)\s+(?:whole\s+)?(?:group|room|panel|table)\s+(?:\w+\s+){{0,2}}{_ROOM_ATTITUDE}"
    rf"|\bthe\s+other(?:s|\s+participants|\s+speakers)?\s+(?:all\s+)?{_ROOM_ATTITUDE}"
    # claiming to speak for the room
    r"|\bspeaking\s+for\s+(?:the\s+(?:group|room|others|table)|everyone|everybody|us\s+all|all\s+of\s+us)\b"
    r"|\bon\s+behalf\s+of\s+(?:the\s+(?:group|room|others)|everyone|everybody|us)\b"
    r"|\bas\s+a\s+(?:group|room)\b",
    re.I,
)


# The V2.6b room-local conjunction-aware strip fork (_ROOM_CLAUSE_BOUNDARY +
# _strip_disclaimers_room) is DELETED: the shared report._CLAUSE_BOUNDARY carries adversative
# conjunctions since the V2.6 follow-up (the baseline decision was made — see the BASELINE SHIFT
# note in CLAUDE.md), so the fork's reason expired. NB the shared set was then NARROWED to
# but|yet (review-caught: though/although/however commonly CONTINUE a disclaimer and
# false-flagged pure hedges) — the room's conjunction pins all use "but" forms and ride the
# shared set; the smuggle residuals are documented at report._CLAUSE_BOUNDARY.


def audit_room_utterance(text: str, grounding: str = "sim", mission: str | None = None) -> list[tuple[str, str]]:
    """The ROOM guard: audit_interview (the full per-speaker set -- mandate speakers keep their
    operational/first-person rules) + the cross-participant rule, through the SAME clause-bounded
    disclaimer strip (conjunction-aware since the V2.6 follow-up) so a refusal may name what it
    refuses while a "(,) but <room claim>" clause is re-checked. Room-only: the single-interview
    path never sees this rule."""
    viol = audit_interview(text, grounding, mission)
    for s in report._sentences(text):
        t = report._strip_disclaimers(s) if report._ALLOW.search(s) else s
        if _CROSS_PARTICIPANT.search(t):
            viol.append(("cross_participant", s))
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
# Third person, digit-free, names the free-flow limitation — the operational-question refusal.
INSTITUTION_REFUSAL = (
    "This tool can only speak to the institution's published mandate and the figures this run "
    "computed — free-flow route estimates, not dispatch or operations. Operational questions "
    "belong to the institution itself."
)


def refusal_for(agent: dict) -> str:
    g = agent.get("grounding", "sim")
    if g == "mandate":
        return INSTITUTION_REFUSAL
    return SIM_REFUSAL if g == "sim" else INFERRED_REFUSAL


# ===================================================================================================
# The guarded answer — the server._guarded_answer shape, persona-voiced (temp 0.8)
# ===================================================================================================


# The room's retry addendum — rides after the mandate extra in the rebuke prompt.
ROOM_RETRY_EXTRA = (" Also: never count or characterize the room's views — no 'most of us', "
                    "'we all', 'everyone here', or what 'the group' thinks; speak only for yourself.")


async def _guarded_generate(client, agent: dict, system: str, user: str,
                            audit_fn=audit_interview, retry_extra: str = "") -> tuple[str, dict]:
    """The ONE guarded loop: generate → audit → retry once quoting violations → refuse in
    character. A live request never hard-crashes: LLM exceptions return the refusal with
    audit.status='error'. `audit_fn` must take (text, grounding, mission) — the single path keeps
    audit_interview, the room passes audit_room_utterance. Every audit dict carries `calls` — the
    generations THIS module issued (1 or 2), not report._call's internal transport retries; the
    per-turn cost label derives from it."""
    grounding = agent.get("grounding", "sim")  # SERVER-loaded, never client input — the guard key
    mission = (agent.get("mandate") or {}).get("mission")  # licenses quoted mandate wording only
    try:
        obj = await report._call(client, system, user, report._TextWire, temperature=0.8)
    except Exception as e:  # noqa: BLE001 — provider SDK errors vary
        return refusal_for(agent), {"status": "error", "detail": str(e)[:140], "calls": 1}
    text = obj["text"].strip()
    if not text:  # a degenerate empty answer must not render as a blank clean bubble
        return refusal_for(agent), {"status": "error", "detail": "empty answer", "calls": 1}
    v1 = audit_fn(text, grounding, mission)
    if not v1:
        return text, {"status": "clean", "violations": [], "calls": 1}

    quoted = "; ".join(f'"{s}" (rule: {r})' for r, s in v1)
    extra = (" For an institutional answer: also no we/our/us (third person only) and no "
             "dispatch/deployment/response-time claims." if grounding == "mandate" else "")
    retry = (
        user + "\n\nYOUR PREVIOUS ANSWER BROKE THE RULES — it contained: " + quoted + ". Rewrite it "
        "in character WITHOUT any of those: no digits, no safer/more-dangerous claims, no vote/tally "
        "words, no crash/injury words, no telling the city what to do." + extra + retry_extra
    )
    caught = [{"rule": r, "sentence": s} for r, s in v1]
    try:
        obj = await report._call(client, system, retry, report._TextWire, temperature=0.8)
    except Exception as e:  # noqa: BLE001
        return refusal_for(agent), {"status": "error", "detail": str(e)[:140], "violations": caught,
                                    "calls": 2}
    text2 = obj["text"].strip()
    if not text2:
        return refusal_for(agent), {"status": "error", "detail": "empty answer", "violations": caught,
                                    "calls": 2}
    v2 = audit_fn(text2, grounding, mission)
    if v2:
        return refusal_for(agent), {
            "status": "failed",
            "violations": caught,
            "still_present": [{"rule": r, "sentence": s} for r, s in v2],
            "calls": 2,
        }
    return text2, {"status": "resolved_on_retry", "violations": caught, "calls": 2}


async def answer(client, ctx: RunContext, agent: dict, question: str,
                 transcript: list[dict]) -> tuple[str, dict]:
    """The single-interview path (V2.3b) — signature and behavior unchanged; since V2.6a a thin
    wrapper over _guarded_generate (the audit dict additively carries `calls`)."""
    return await _guarded_generate(client, agent, build_system(agent, ctx),
                                   build_user(question, transcript))


async def room_answer(client, ctx: RunContext, agent: dict, question: str,
                      transcript: list[dict]) -> tuple[str, dict]:
    """One speaker's guarded answer in a group room (V2.6a). `transcript` is the SHARED room
    transcript, including this-round answers the caller has already appended — refusals ride as
    answers (they are audit-clean by pin), so one speaker refusing never aborts the room."""
    return await _guarded_generate(client, agent, build_room_system(agent, ctx),
                                   build_room_user(question, transcript, ctx, agent),
                                   audit_fn=audit_room_utterance, retry_extra=ROOM_RETRY_EXTRA)
