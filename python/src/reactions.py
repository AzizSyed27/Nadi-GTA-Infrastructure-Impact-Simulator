"""Phase 2.5b backend: generate stakeholder reactions at scale and wire agents[] into the v0.3.0 artifact.

For each instrumented record (Step 2.5a's ``instrumented-<ts>.json`` — ~200 sim + ~12 inferred) this builds
a grounded, PREFIX-ORDERED prompt (shared framing + mechanical change + JSON instructions FIRST, persona
next, per-agent suffix in the user message — so DeepSeek's automatic prompt cache hits), asks an LLM (via
the provider-agnostic ``llm_provider``; DeepSeek default here, Groq fallback) for ``{comment, sentiment,
stance}``, then SETS ``agents[]`` on the existing 2.4 artifact IN PLACE (preserving vehicles / persons /
conflicts / scorecard) and validates against the frozen schema.

Two prompt families: SIM agents ground in THEIR OWN travel-time outcome (a fact of this run); INFERRED
agents voice a stakeholder perspective from change semantics + the deterministic access heuristic. NO agent
voices any network SAFETY aggregate — the robustness precursor showed every safety-delta sign flips across
seeds (noise). Agents react in ISOLATION (no inter-agent talk — that is later / OASIS). ``agents[]`` is
generative (non-deterministic); ``meta``/``vehicles``/``persons``/``conflicts``/``scorecard`` are not.

Run as a script (needs the provider's key in a .env — e.g. DEEPSEEK_API_KEY):
    PROVIDER=deepseek python python/src/reactions.py       # newest instrumented-*.json
    PROVIDER=groq python python/src/reactions.py --instrumented contract/runs/instrumented-<ts>.json
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import shutil
import sys
from pathlib import Path

from typing import Literal

from pydantic import BaseModel

import run_events
import trajectory_io
from contract_models import (
    MANDATE_VERSIONS, Agent, Citation, Mandate, Outcome, Persona, Reaction, TrajectoryArtifact, changes_of,
)
from llm_provider import LLMClient, get_client


class _ReactionWire(BaseModel):
    """Permissive WIRE schema sent to the LLM as response_schema.

    Deliberately NOT the contract ``Reaction``: that model is ``extra="forbid"`` (→ emits
    ``additionalProperties:false``) with ``sentiment`` bounds (→ ``minimum``/``maximum``), and
    Gemini's response_schema subset rejects both. We let the model fill this loose shape, then clamp
    + validate against the strict ``contract_models.Reaction`` in the caller.
    """

    comment: str
    sentiment: float
    stance: Literal["supportive", "neutral", "opposed"]

RUNS_DIR = trajectory_io.RUNS_DIR
WEB_PUBLIC = trajectory_io._REPO_ROOT / "web" / "public"

# Reply-shape instructions shared by both families. The literal word "json" + the example satisfy
# DeepSeek's json_object requirement (harmless for Groq strict). Kept in the SHARED PREFIX so it caches.
_JSON_INSTRUCTIONS = (
    "Reply with ONLY a json object of exactly this shape, nothing else:\n"
    '{"comment": "<your 1-2 sentence reaction, first person>", '
    '"sentiment": <number from -1.0 (unhappy) to 1.0 (happy)>, '
    '"stance": "supportive" | "neutral" | "opposed"}\n\n'
)

_SIM_FRAMING = (
    "You are role-playing ONE specific Toronto traveler reacting to a PROPOSED road change on a corridor, "
    "for a city-planning preview. Speak in the FIRST PERSON, 1-2 sentences, plain-spoken. This is an "
    "ANTICIPATED reaction (how you'd feel) — NOT a verdict or prediction. Ground your reaction STRICTLY in "
    "the specific numbers about YOUR trip below; do NOT invent specifics (no street names, exact times, "
    "distances, or facts not provided).\n\n"
)

_INFERRED_FRAMING = (
    "You are voicing the PERSPECTIVE of one specific Toronto stakeholder on a PROPOSED road change on a "
    "corridor, for a city-planning preview. This person does NOT make a measured trip on the corridor — they "
    "speak from their standpoint (their street, their business, their community). Speak in the FIRST PERSON, "
    "1-2 sentences, plain-spoken. This is an ANTICIPATED reaction, NOT a verdict or prediction. React from "
    "your PERSPECTIVE and priorities — do NOT recite statistics, and do NOT invent specifics not provided.\n\n"
)

# Per-stakeholder context for inferred agents. Change semantics + ONLY the deterministic, LABELED access
# estimate where it applies. NO safety numbers (the robustness precursor showed every safety-delta sign
# FLIPS across seeds — noise, referenced by no one). NEVER assert calming/safety as fact (the 2.4a line).
_INFERRED_CONTEXT = {
    "business_owner": "What it may mean for you: the change would likely remove some CURBSIDE space on the "
    "corridor where customers stop and park (a rough ESTIMATE, not precisely measured).",
    "accessibility": "What it may mean for you: the change reshapes the curb and crossing environment on the "
    "corridor — consider the standpoint of people with mobility, vision, or hearing disabilities.",
    "local_resident": "You live on this corridor; react from that standpoint.",
    "transit_riders": "You ride the bus along this corridor; react from that standpoint.",
    "taxpayer": "You are a skeptical taxpayer who did not ask for this; react from that standpoint.",
}
# A new_road ADDS a connector — it does NOT remove curbside space or reshape an existing curb. Override the two
# entries that assume a corridor REALLOCATION, so business/accessibility voices aren't grounded in a false premise.
_INFERRED_CONTEXT_NEW_ROAD = {
    "business_owner": "What it may mean for you: a NEW road now connects two nearby junctions — it could change "
    "which traffic passes your door (more, less, or rerouted). It does NOT remove existing curb space.",
    "accessibility": "What it may mean for you: a NEW road is added that — at this stage — carries NO sidewalk. "
    "Consider the standpoint of people with mobility, vision, or hearing disabilities.",
}
# V2.2a — closures REMOVE capacity (temporarily when windowed). Neither the reallocation default nor the
# new_road framing fits; and a WINDOWED closure must not be voiced as a permanent change (time-scoped honesty).
_INFERRED_CONTEXT_CLOSURE = {
    "business_owner": "What it may mean for you: the corridor road (or some of its lanes) is CLOSED for the whole "
    "period simulated — traffic that passed your door is pushed onto other streets, and curb access near the "
    "closure may be blocked.",
    "accessibility": "What it may mean for you: a road/lane closure changes crossings and detour routes on the "
    "corridor — consider the standpoint of people with mobility, vision, or hearing disabilities.",
}
_INFERRED_CONTEXT_CLOSURE_WINDOWED = {
    "business_owner": "What it may mean for you: the corridor road (or some of its lanes) is closed during a "
    "time window (a temporary disruption, like construction) — not a permanent reallocation. Traffic is pushed "
    "onto other streets while the closure is active.",
    "accessibility": "What it may mean for you: during the closure's time window, crossings and detour routes on "
    "the corridor change temporarily — consider the standpoint of people with mobility, vision, or hearing "
    "disabilities.",
}
# V2.2b — an incident is a capacity EVENT (blocked lanes / slowed traffic for a window), never a crash
# simulation and not a permanent change; its own framing so closure wording stays byte-identical.
_INFERRED_CONTEXT_INCIDENT = {
    "business_owner": "What it may mean for you: some of the corridor road's capacity is temporarily blocked or "
    "slowed by an incident — not a permanent change. Traffic shifts to other streets while it lasts, then "
    "returns to normal.",
    "accessibility": "What it may mean for you: while the incident lasts, crossings and routes on the corridor "
    "shift temporarily — not a permanent change; consider the standpoint of people with mobility, vision, or "
    "hearing disabilities.",
}


def _inferred_context(stakeholder: str | None, changes: list[dict]) -> str:
    """Labeled stakeholder context, CONDITIONAL on change type (new_road adds an option; closures remove
    capacity — temporarily when windowed; the others reallocate). Composite (v0.5.0): the special framing
    applies if ANY change in the scenario matches."""
    if any(c.get("type") == "new_road" for c in changes) and stakeholder in _INFERRED_CONTEXT_NEW_ROAD:
        return _INFERRED_CONTEXT_NEW_ROAD[stakeholder]
    if any(c.get("type") == "incident" for c in changes) and stakeholder in _INFERRED_CONTEXT_INCIDENT:
        return _INFERRED_CONTEXT_INCIDENT[stakeholder]
    closures = [c for c in changes if c.get("type") in ("lane_closure", "road_closure")]
    if closures and stakeholder in _INFERRED_CONTEXT_CLOSURE:
        windowed = any(c.get("window") for c in closures)
        return (_INFERRED_CONTEXT_CLOSURE_WINDOWED if windowed else _INFERRED_CONTEXT_CLOSURE)[stakeholder]
    return _INFERRED_CONTEXT.get(stakeholder, "React from your standpoint.")


def _fmt_minutes(seconds: float) -> str:
    return f"{seconds / 60.0:.1f} min"


def _change_line(change: dict, profile: str = "synthetic_demo") -> str:
    """A MECHANICAL description of the change — no asserted benefit (no 'calmer'/'safer'). Cacheable prefix.
    V2.2a: windowed changes render their window — clock times on the calibrated profile (t=0 == 07:00),
    sim-seconds on synthetic (fmt_window)."""
    from demand_profiles import fmt_window

    window_txt = f" {fmt_window(change['window'], profile)}" if change.get("window") else ""
    if change.get("type") == "new_road":
        lanes = change.get("lanes") or 1
        return (f"A new {lanes}-lane road now connects junction {change.get('from_junction')} to junction "
                f"{change.get('to_junction')} — a NEW travel option, not a reallocation of existing lanes; "
                f"it carries no sidewalk at this stage.")
    if change.get("type") == "bike_lane":
        return "One general-traffic (car) lane on the corridor is being converted into a bicycle-only lane."
    if change.get("type") == "lane_closure":
        n = len(change.get("target_lanes") or [])
        lanes_word = "car lanes" if n != 1 else "car lane"
        verb = "are" if n != 1 else "is"
        return (f"{n} {lanes_word} on the corridor road ({change.get('target_edge')}) {verb} "
                f"closed{window_txt}; the road stays open in the remaining lane(s).")
    if change.get("type") == "road_closure":
        return (f"The corridor road ({change.get('target_edge')}) is fully closed{window_txt}; "
                f"traffic must use other streets.")
    if change.get("type") == "incident":
        # a CAPACITY event, never a crash simulation — mechanical, no crash words
        eff = change.get("effect") or {}
        edge = change.get("target_edge")
        parts = []
        lanes = change.get("target_lanes") or []
        if eff.get("blocked") and lanes:
            n = len(lanes)
            parts.append(f"{n} car lane{'s' if n != 1 else ''} on the corridor road ({edge}) "
                         f"{'are' if n != 1 else 'is'} blocked")
        if eff.get("speed_factor") is not None:
            pct = f"{eff['speed_factor'] * 100:.0f}%"
            if parts:
                parts.append(f"and traffic is slowed to {pct} of its normal speed")
            else:
                parts.append(f"Traffic on the corridor road ({edge}) is slowed to {pct} of its normal speed")
        body = " ".join(parts) or f"Capacity on the corridor road ({edge}) is reduced"
        return f"{body}{window_txt} — a temporary incident; capacity is reduced while it is active, then restored."
    desc = change.get("description") or change.get("type", "a road change")
    if change.get("value_mps") is not None:
        desc += f" (new speed limit {change['value_mps'] * 3.6:.0f} km/h)"
    return desc


def _changes_line(changes: list[dict], profile: str = "synthetic_demo") -> str:
    """Mechanical description of the scenario's change(s). A single change renders exactly as before; a
    composite (v0.5.0) is a numbered, mechanical enumeration — no asserted benefit."""
    if len(changes) == 1:
        return _change_line(changes[0], profile)
    parts = "; ".join(f"({i}) {_change_line(c, profile)}" for i, c in enumerate(changes, 1))
    return f"This scenario composes {len(changes)} changes: {parts}"


def _zone_preface(changes: list[dict], tags: list[str] | None, profile: str) -> str:
    """V2.2d: ONE mechanical sentence naming the composite AS a school zone (the agents should react
    to a zone, not to disconnected speed edits) — no asserted benefit, no children. Empty (prompt
    byte-identical) unless the scenario is tagged school_zone. Differing member windows use the
    spanning window — the zone_lens soft rule."""
    if not tags or "school_zone" not in tags:
        return ""
    from demand_profiles import fmt_window

    windows = [c["window"] for c in changes if c.get("window")]
    wtxt = ""
    if windows:
        span = {"start_s": min(w["start_s"] for w in windows), "end_s": max(w["end_s"] for w in windows)}
        wtxt = f" {fmt_window(span, profile)}"
    n = len(changes)
    return (f"These changes together form a proposed school zone: lower speed limits on "
            f"{n} street{'s' if n != 1 else ''}{wtxt}. ")


def shared_prefix(changes: list[dict], grounding: str, profile: str = "synthetic_demo",
                  tags: list[str] | None = None) -> str:
    """The INVARIANT prompt prefix (identical across a family in a run) — placed FIRST so DeepSeek's prefix
    cache hits. Framing + mechanical change(s) + JSON instructions; the per-persona block is appended after."""
    framing = _INFERRED_FRAMING if grounding == "inferred" else _SIM_FRAMING
    return (f"{framing}THE PROPOSED CHANGE: {_zone_preface(changes, tags, profile)}"
            f"{_changes_line(changes, profile)}\n\n{_JSON_INSTRUCTIONS}Your character:\n")


def _sim_suffix(outcome: dict) -> str:
    delta = outcome["delta_seconds"]
    if delta > 5:
        direction = f"about {_fmt_minutes(delta)} SLOWER than before"
    elif delta < -5:
        direction = f"about {_fmt_minutes(-delta)} FASTER than before"
    else:
        direction = "about the same as before"
    delay_delta = outcome["scenario_timeloss"] - outcome["baseline_timeloss"]
    delay_phrase = (
        f"{_fmt_minutes(delay_delta)} more time stuck/delayed"
        if delay_delta > 1
        else (f"{_fmt_minutes(-delay_delta)} less time stuck/delayed" if delay_delta < -1 else "no real change in delay")
    )
    return (
        "HOW IT AFFECTS YOUR USUAL TRIP ON THIS CORRIDOR:\n"
        f"- your travel time was about {_fmt_minutes(outcome['baseline_duration'])}, "
        f"now about {_fmt_minutes(outcome['scenario_duration'])} ({direction})\n"
        f"- {delay_phrase}\n\n"
        "React in character to the change AND how it affects your trip."
    )


def build_prompt(record: dict, changes: list[dict], profile: str = "synthetic_demo",
                 tags: list[str] | None = None) -> tuple[str, str]:
    """Return (system, user). system = shared_prefix + persona (prefix-ordered for caching); user = the
    per-agent suffix (sim: personal outcome; inferred: labeled stakeholder context)."""
    persona = record["persona"]
    grounding = record["grounding"]
    system = shared_prefix(changes, grounding, profile, tags) + f"- {persona['label']}: {persona['description']}"
    if grounding == "sim":
        user = _sim_suffix(record["outcome"])
    else:
        ctx = _inferred_context(record.get("stakeholder") or persona.get("stakeholder"), changes)
        user = f"{ctx}\n\nReact from your perspective to the proposed change."
    return system, user


def _fallback() -> Reaction:
    return Reaction(comment="(no reaction generated)", sentiment=0.0, stance="neutral")


# Transient HTTP-ish codes worth backing off and retrying (overload / rate limit / gateway).
_TRANSIENT_CODES = {408, 409, 429, 500, 502, 503, 504}


def _is_transient(exc: Exception) -> bool:
    """Provider-agnostic: treat 429/5xx as transient. google.genai uses `.code`; openai uses `.status_code`."""
    status = getattr(exc, "status_code", None) or getattr(exc, "code", None)
    return status in _TRANSIENT_CODES


def _record_id(record: dict) -> str:
    return record.get("vehicle_id") or record.get("person_id") or f"inferred:{record['persona']['id']}"


async def react_one(client: LLMClient, record: dict, changes: list[dict],
                    profile: str = "synthetic_demo",
                    tags: list[str] | None = None) -> tuple[Reaction, bool]:
    """Generate one agent's reaction (sim or inferred — build_prompt dispatches on grounding). Returns
    (reaction, is_fallback). Backs off/retries on transient API errors; retries once on a malformed/invalid
    (or empty) response; otherwise falls back to a neutral reaction."""
    system, user = build_prompt(record, changes, profile, tags)
    parse_retried = False
    for attempt in range(5):  # bounded; most exits are well before this
        try:
            raw = await client.generate_json(system=system, user=user, schema=_ReactionWire)
            raw["sentiment"] = max(-1.0, min(1.0, float(raw["sentiment"])))  # clamp BEFORE constructing
            return Reaction.model_validate(raw), False
        except Exception as exc:
            if _is_transient(exc) and attempt < 4:
                await asyncio.sleep(1.5 * (attempt + 1))  # linear backoff for overload spikes
                continue
            if not parse_retried:  # one retry for a malformed / invalid / empty (non-transient) response
                parse_retried = True
                continue
            print(f"  [warn] reaction for {_record_id(record)} failed ({exc!r}); neutral fallback")
            return _fallback(), True
    return _fallback(), True


# Cap simultaneous in-flight calls. DeepSeek latency is fine (this is batch, not live); a modest cap
# spreads load so backoff retries land and stays far under provider concurrency ceilings. Configurable.
MAX_CONCURRENCY = int(os.environ.get("MAX_CONCURRENCY", "8"))


async def generate_reactions(client: LLMClient, records: list[dict], changes: list[dict],
                             profile: str = "synthetic_demo",
                             tags: list[str] | None = None,
                             events_path: Path | None = None) -> list[tuple[Reaction, bool]]:
    """Generate one reaction per record, concurrently, and stream each as it lands.

    V2.7b C6b — CANCELLABLE, and it MUTATES ``records`` when cancelled: records whose generation was
    skipped are removed in place, so the returned reactions and the caller's records stay matched
    pairs for ``assemble_in_place``'s zip. That is deliberate and it is why the truncation happens
    here rather than at the call site — the two lists must never be able to drift apart between the
    place that knows what was skipped and the place that assembles them."""
    sem = asyncio.Semaphore(MAX_CONCURRENCY)
    # V2.3a stream events (env-gated by the caller; None → byte-identical no-op path). `index` is the
    # record's position in the ORIGINAL order — which is the final artifact's agents[] order — so the
    # client can dedup/reorder. `done` counts completions (single-threaded event loop → race-free).
    orig_index = {id(r): i for i, r in enumerate(records)}
    done = 0

    async def _guarded(rec: dict) -> tuple[Reaction, bool] | None:
        nonlocal done
        # V2.7b C6b — THE CANCEL CHECKPOINT. Every record fires through one asyncio.gather behind a
        # semaphore, so there is no sequential loop to break out of: the ones still queued check here
        # and return None WITHOUT touching the client. Returning None (rather than a placeholder) is
        # the honest shape — `_fallback()` exists for a model that answered badly, and using it to
        # paper over a voice that was never generated would fabricate a resident.
        if run_events.cancelled():
            return None
        if rec["grounding"] == "mandate":
            # V2.3c — institutional voices are DETERMINISTIC (no LLM, no _ReactionWire): the comment
            # is code-composed from the sourced mandate + the baked sidecar facts, and the citations
            # are stamped onto the record so the single builder carries them to both paths.
            import institutions
            entry = {"id": rec["persona"]["id"], "label": rec["persona"]["label"],
                     "mandate": rec["mandate"], "mission_clause": rec["mission_clause"],
                     "cites": rec.get("cites", [])}
            citations = institutions.compose_citations(entry, rec["facts"])
            rec["citations"] = citations
            res = (institutions.compose_reaction(entry, citations), False)
        else:
            async with sem:
                res = await react_one(client, rec, changes, profile, tags)
        if events_path is not None:
            done += 1
            agent = build_agent(rec, res[0])  # the SAME builder as assemble_in_place — transport, not content
            run_events.emit(events_path, "voice", index=orig_index[id(rec)], done=done,
                            total=len(records),
                            agent=agent.model_dump(mode="json", exclude_none=True, by_alias=True))
        return res

    # Order so each persona's calls are ADJACENT — prefix locality for DeepSeek's prompt cache (the
    # shared framing+change prefix hits after call #1 regardless; adjacency also warms the persona slice).
    ordered = sorted(records, key=lambda r: (r["grounding"], r["persona"]["id"]))
    results = await asyncio.gather(*(_guarded(r) for r in ordered))
    by_key = {id(r): res for r, res in zip(ordered, results) if res is not None}
    # Records and reactions stay MATCHED PAIRS: a cancelled record is dropped from BOTH lists, so
    # assemble_in_place's zip yields a genuinely shorter agents[] rather than a misaligned one.
    kept = [r for r in records if id(r) in by_key]
    records[:] = kept
    return [by_key[id(r)] for r in kept]


def build_agent(rec: dict, reaction: Reaction) -> Agent:
    """ONE record → ONE contract Agent. The SINGLE builder for both paths — the final artifact assembly
    (``assemble_in_place``) and the V2.3a per-voice stream events — so a streamed voice is structurally
    identical to the artifact's (streaming is transport, not content)."""
    p = rec["persona"]
    persona = Persona(id=p["id"], label=p["label"])  # trim rich PersonaSpec -> contract {id,label}
    if rec["grounding"] == "sim":
        kw: dict = {"grounding": "sim", "persona": persona, "reaction": reaction,
                    "outcome": Outcome.model_validate(rec["outcome"]), "trigger_t": rec["trigger_t"]}
        if "vehicle_id" in rec:
            kw["vehicle_id"] = rec["vehicle_id"]
        if "person_id" in rec:
            kw["person_id"] = rec["person_id"]
        return Agent(**kw)
    if rec["grounding"] == "mandate":
        # V2.3c — the mandate travels VERBATIM from institutions.json (never reworded — for a real
        # organization, paraphrase is misrepresentation; byte-identity test-pinned); citations were
        # composed deterministically in _guarded and stamped onto the record.
        return Agent(grounding="mandate", persona=persona, reaction=reaction,
                     mandate=Mandate(**rec["mandate"]),
                     citations=[Citation(**c) for c in rec["citations"]])
    # inferred: persona + reaction only (no pin/outcome/trigger_t — the 2.3 invariant)
    return Agent(grounding="inferred", persona=persona, reaction=reaction)


def assemble_in_place(scenario_art: TrajectoryArtifact, records: list[dict], reactions: list[Reaction]) -> TrajectoryArtifact:
    """Set agents[] on the scenario artifact IN PLACE — preserving meta / vehicles / persons / conflicts /
    scorecard (the 2.4 artifact carries all of them; a fresh TrajectoryArtifact(...) would drop them)."""
    scenario_art.agents = [build_agent(rec, reaction) for rec, reaction in zip(records, reactions)]
    return scenario_art


def ensure_version_for_mandate(scenario_art: TrajectoryArtifact, records: list[dict]) -> None:
    """V2.3c — voices enriched under the 0.9.0 producer make a 0.8.0 artifact 0.9.0 (additive: every
    0.9.0 obligation is a 0.8.0 one) WHETHER OR NOT institutions spoke — a quiet run's honest
    empty-state ("no institutional facts in this run") gates on 0.9.0 and must be reachable on
    re-enriched runs, not just fresh ones. Mandate records on a pre-0.8.0 artifact would be a
    doomed dump — fail LOUDLY before any LLM spend; a pre-0.8.0 re-enrich WITHOUT mandates stays
    at its version (the legacy path, unchanged)."""
    has_mandate = any(r["grounding"] == "mandate" for r in records)
    if scenario_art.schema_version in MANDATE_VERSIONS:  # already mandate-capable (0.9.0+) — nothing to do
        return
    if scenario_art.schema_version == "0.8.0":
        scenario_art.schema_version = "0.9.0"
        print("[contract] artifact upgraded 0.8.0 -> 0.9.0 (voices enriched under the 0.9.0 producer)")
        return
    if has_mandate:
        raise SystemExit(
            f"cannot add mandate-grounded voices to a {scenario_art.schema_version} artifact "
            "(pre-0.8.0) — re-run the scenario to produce a current artifact first")


def newest_instrumented() -> Path:
    # The digit-first resolver (the V2.6c stale-roster burn: instrumented-V22AACCEPT outsorted
    # every fresh timestamp name and enriched a dead roster) — see trajectory_io.newest_ts_named.
    return trajectory_io.newest_ts_named(
        RUNS_DIR, "instrumented-*.json", "instrumented-",
        none_msg="no instrumented-*.json in contract/runs/ — run sampler.py first",
        flag_hint="--instrumented")


async def smoke_test(client: LLMClient, changes: list[dict], profile: str = "synthetic_demo",
                     tags: list[str] | None = None) -> None:
    """One cheap call so a bad/absent key (or model id) surfaces ONCE, not as N concurrent failures.

    Uses the REAL shared prefix incl. any zone preface (so it WARMS DeepSeek's prompt cache — the batch
    then hits it instead of all cold-missing). Tolerates transient overload (backoff); a real auth/config
    error raises immediately.
    """
    system = shared_prefix(changes, "sim", profile, tags) + "- Test persona: a neutral test character."
    for attempt in range(4):
        try:
            await client.generate_json(
                system=system, user="Return sentiment 0, stance neutral, comment 'ok'.", schema=_ReactionWire
            )
            return
        except Exception as exc:
            if _is_transient(exc) and attempt < 3:
                await asyncio.sleep(2.0 * (attempt + 1))
                continue
            raise RuntimeError(
                f"smoke test failed ({exc!r}). If this is a model-id error, try `MODEL=deepseek-v4-flash` "
                f"(the current default) or `MODEL=deepseek-v4-pro`. Check the API key in .env."
            ) from exc


async def run(instrumented_path: Path) -> Path:
    side = json.loads(instrumented_path.read_text(encoding="utf-8"))
    scenario_run_id = side["scenario_run_id"]
    # V2.3c closeout — structural guard: this stage REWRITES the run's artifact; the pinned
    # Playwright/report anchor must never be rewritten by accident. Refuses before any LLM spend.
    trajectory_io.guard_pinned_enrich(scenario_run_id)
    records = side["instrumented"]

    scenario_art = trajectory_io.load_artifact(RUNS_DIR / f"{scenario_run_id}.json")
    # GUARD: never wire reactions onto the wrong run.
    if scenario_art.meta.run_id != scenario_run_id:
        raise SystemExit(f"run-id mismatch: instrumented {scenario_run_id!r} != artifact {scenario_art.meta.run_id!r}")
    changes = [c.model_dump() for c in changes_of(scenario_art)]
    # V2.2a: the demand profile drives window rendering (calibrated -> clock times, t=0 == 07:00)
    profile = getattr(scenario_art.meta, "demand_profile", None) or "synthetic_demo"
    # V2.2d: scenario tags gate the mechanical zone preface (untagged prompts stay byte-identical)
    tags = list(scenario_art.meta.scenario.tags) if getattr(scenario_art.meta.scenario, "tags", None) else None

    ensure_version_for_mandate(scenario_art, records)

    client, provider, model = get_client()
    n_sim = sum(1 for r in records if r["grounding"] == "sim")
    n_mandate = sum(1 for r in records if r["grounding"] == "mandate")
    n_inferred = len(records) - n_sim - n_mandate
    print(f"[llm] provider={provider} model={model}  agents={len(records)} "
          f"({n_sim} sim + {n_inferred} inferred + {n_mandate} institutional)")

    # V2.3a: stream events ONLY when the server set NADI_RUN_EVENTS (CLI runs: None → no file, no change)
    events_path = run_events.from_env()
    if events_path is not None:
        run_events.emit(events_path, "voices_total", total=len(records))

    print("[llm] smoke test (warms the shared-prefix cache) ...")
    await smoke_test(client, changes, profile, tags)  # raises here (clear error) if the key/model is bad

    results = await generate_reactions(client, records, changes, profile, tags, events_path=events_path)
    reactions = [r for r, _ in results]
    fallbacks = sum(1 for _, fb in results if fb)

    artifact = assemble_in_place(scenario_art, records, reactions)
    out_path = trajectory_io.dump_artifact(artifact, RUNS_DIR / f"{scenario_run_id}.json")  # validates vs schema

    WEB_PUBLIC.mkdir(parents=True, exist_ok=True)
    web_copy = WEB_PUBLIC / f"{scenario_run_id}.json"
    shutil.copyfile(out_path, web_copy)  # non-destructive: leaves run.json alone

    _report(artifact, records, results, fallbacks, out_path, web_copy, provider, getattr(client, "usage", None))
    # V2.7b: this stage's metered calls, for the ledger's cost line. Institutions rode the same pass
    # and cost NOTHING (deterministic composition over byte-pinned roster text) - the count is the
    # traveler voices' alone, which is exactly what the UI attributes it to.
    run_events.stage_usage("voices", (getattr(client, "usage", None) or {}).get("calls"))

    # V2.7b C8a — the INSTITUTIONS stage's content event. Both halves ride it: who spoke (the
    # mandate agents just assembled, in artifact shape so the card renders the same voice the
    # document will) and who was SILENT, with the fact class their mandate needed and this run did
    # not compute. The silent half has no other source — `institutions.speaks` is the gate that
    # decides it — and without it the designed-silence card would be indistinguishable from a bug.
    import institutions as _inst
    spoke = [a.model_dump(mode="json", exclude_none=True, by_alias=True)
             for a in (artifact.agents or []) if a.grounding == "mandate"]
    run_events.stage_event("institutions", spoke=spoke, silent=_inst.silent_institutions(side))
    return out_path


# DeepSeek deepseek-v4-flash prices (USD per 1M tokens) — APPROXIMATE (docs-flagged; verify live).
_DEEPSEEK_PRICE = {"hit": 0.0028, "miss": 0.14, "out": 0.28}


def _cost_line(provider: str, usage: dict | None) -> str:
    if not usage or not usage.get("calls"):
        return "usage: not reported by this provider"
    hit, miss, out = usage["prompt_cache_hit_tokens"], usage["prompt_cache_miss_tokens"], usage["completion_tokens"]
    total_in = hit + miss
    rate = (hit / total_in) if total_in else 0.0
    base = (f"calls {usage['calls']} | input {total_in:,} tok (cache hit {rate:.0%}: {hit:,} hit / {miss:,} miss)"
            f" | output {out:,} tok")
    if provider == "deepseek":
        dollars = hit / 1e6 * _DEEPSEEK_PRICE["hit"] + miss / 1e6 * _DEEPSEEK_PRICE["miss"] + out / 1e6 * _DEEPSEEK_PRICE["out"]
        return base + f" | ~${dollars:.4f} (APPROX; Flash rates)"
    return base + " | cost n/a"


def _pick_examples(records, results):
    """One winner car + one loser car + a cyclist + a pedestrian + a resident + a business owner (real,
    non-fallback where possible). Returns [(label, record, reaction)]."""
    def find(pred):
        for rec, (reaction, is_fb) in zip(records, results):
            if not is_fb and pred(rec):
                return rec, reaction
        for rec, (reaction, _fb) in zip(records, results):  # relax to include fallbacks if needed
            if pred(rec):
                return rec, reaction
        return None
    wants = [
        ("winner car", lambda r: r["mode"] == "car" and r["outcome"]["delta_seconds"] < -0.5),
        ("loser car", lambda r: r["mode"] == "car" and r["outcome"]["delta_seconds"] > 0.5),
        ("cyclist", lambda r: r["mode"] == "bicycle"),
        ("pedestrian", lambda r: r["mode"] == "pedestrian"),
        ("resident (inferred)", lambda r: r.get("stakeholder") == "local_resident"),
        ("business (inferred)", lambda r: r.get("stakeholder") == "business_owner"),
    ]
    out = []
    for label, pred in wants:
        hit = find(pred)
        if hit:
            out.append((label, hit[0], hit[1]))
    return out


def _report(artifact, records, results, fallbacks, out_path, web_copy, provider, usage) -> None:
    print("\n" + "=" * 74)
    print("AGENT REACTIONS — assembled v0.3.0 artifact (agents[] wired in place)")
    print("=" * 74)
    print(f"run       : {artifact.meta.run_id}")
    print(f"change    : {'; '.join(c.description for c in changes_of(artifact))}")
    print(f"agents    : {len(artifact.agents)}   fallbacks (neutral): {fallbacks}")
    print(f"cost/cache: {_cost_line(provider, usage)}")
    print("-" * 74)
    print("example reactions across the roster:")
    for label, rec, reaction in _pick_examples(records, results):
        tag = (f"delta={rec['outcome']['delta_seconds']:+.0f}s" if rec["grounding"] == "sim" else "inferred")
        print(f"\n  [{label}] {rec['persona']['id']} ({tag})  "
              f"stance={reaction.stance} sentiment={reaction.sentiment:+.2f}")
        print(f"    \"{reaction.comment}\"")
    print("\n" + "=" * 74)
    print(f"artifact written  : contract/runs/{out_path.name}   (validated vs frozen schema)")
    print(f"web copy          : web/public/{web_copy.name}")


def main() -> None:
    # Models can emit non-ASCII (e.g. U+2011 non-breaking hyphen); keep the report printable on
    # Windows' cp1252 console. The JSON artifact is always written UTF-8 regardless.
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    ap = argparse.ArgumentParser(description="Generate agent reactions and assemble the v0.2.0 artifact.")
    ap.add_argument("--instrumented", default=None, help="instrumented-*.json (default: newest in contract/runs)")
    args = ap.parse_args()
    path = Path(args.instrumented) if args.instrumented else newest_instrumented()
    print(f"[in] instrumented: {path.name}")
    asyncio.run(run(path))


if __name__ == "__main__":
    main()
