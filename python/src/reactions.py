"""Phase 1 backend: generate per-traveler stakeholder reactions and assemble the v0.2.0 artifact.

For each instrumented traveler (Step 1.3's ``instrumented-<ts>.json``) this builds a grounded prompt
from the proposed CHANGE + that traveler's concrete outcome, asks an LLM (Gemini by default, via the
provider-agnostic ``llm_provider``) for a strict ``{comment, sentiment, stance}`` reaction, then
assembles the full v0.2.0 ``TrajectoryArtifact`` (meta + all vehicles + ``agents[]``) and validates it
against the frozen schema.

Agents react in ISOLATION — ~12 concurrent calls, no inter-agent talk (that is Phase 2 / OASIS).
Reactions are generative, so ``agents[]`` is NOT deterministic; ``meta`` and ``vehicles`` are.

Run as a script (needs GEMINI_API_KEY in a repo-root .env):
    python python/src/reactions.py                         # newest instrumented-*.json
    python python/src/reactions.py --instrumented contract/runs/instrumented-<ts>.json
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

import trajectory_io
from contract_models import Agent, Outcome, Persona, Reaction, TrajectoryArtifact
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

SYSTEM_FRAMING = (
    "You are role-playing one specific Toronto driver reacting to a PROPOSED road change, for a "
    "city-planning preview. Stay in character as the person described below. Speak in the first "
    "person, 1-2 sentences, plain spoken. This is an ANTICIPATED reaction (how you'd feel), not a "
    "verdict or prediction. Ground your reaction STRICTLY in the concrete numbers you are given — do "
    "NOT invent specifics (no street names, exact times, distances, or facts not provided). Reply "
    "ONLY with the JSON object for the tool.\n\nYour character:\n"
)


def _fmt_minutes(seconds: float) -> str:
    return f"{seconds / 60.0:.1f} min"


def build_prompt(persona: dict, outcome: dict, change: dict) -> tuple[str, str]:
    """Return (system, user). `system` = persona + framing; `user` = change semantics + sign-correct outcome."""
    system = SYSTEM_FRAMING + f"- {persona['label']}: {persona['description']}"

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

    change_desc = change.get("description") or change.get("type", "a road change")
    user = (
        f"PROPOSED CHANGE: {change_desc} "
        f"(type: {change.get('type')}"
        + (f", new speed {change['value_mps'] * 3.6:.0f} km/h" if change.get("value_mps") is not None else "")
        # State only the mechanical change — do NOT assert benefits (e.g. "safer"/"calmer") the
        # simulation never measured. Whatever a persona values about it is THEIR anticipation, supplied
        # by their disposition in the system prompt, not a fact injected here (preview, not verdict).
        + ").\n\n"
        f"HOW IT AFFECTS YOUR USUAL TRIP ON THIS CORRIDOR:\n"
        f"- baseline travel time: {_fmt_minutes(outcome['baseline_duration'])}\n"
        f"- with the change:      {_fmt_minutes(outcome['scenario_duration'])}  ({direction})\n"
        f"- delay component:      {delay_phrase}\n\n"
        "React in character to BOTH the change itself and how it affects your trip. Set `sentiment` "
        "in [-1, 1] (negative = unhappy) and `stance` to one of supportive / neutral / opposed."
    )
    return system, user


def _fallback() -> Reaction:
    return Reaction(comment="(no reaction generated)", sentiment=0.0, stance="neutral")


# Transient HTTP-ish codes worth backing off and retrying (overload / rate limit / gateway).
_TRANSIENT_CODES = {408, 409, 429, 500, 502, 503, 504}


def _is_transient(exc: Exception) -> bool:
    """Provider-agnostic: treat 429/5xx as transient. google.genai uses `.code`; openai uses `.status_code`."""
    status = getattr(exc, "status_code", None) or getattr(exc, "code", None)
    return status in _TRANSIENT_CODES


async def react_one(client: LLMClient, record: dict, change: dict) -> tuple[Reaction, bool]:
    """Generate one traveler's reaction. Returns (reaction, is_fallback).

    Backs off and retries on transient API errors (overload/429/5xx); retries once on a malformed or
    schema-invalid response; otherwise falls back to a neutral reaction.
    """
    system, user = build_prompt(record["persona"], record["outcome"], change)
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
            if not parse_retried:  # one retry for a malformed / invalid (non-transient) response
                parse_retried = True
                continue
            print(f"  [warn] reaction for vehicle {record['vehicle_id']} failed ({exc!r}); neutral fallback")
            return _fallback(), True
    return _fallback(), True


# Cap simultaneous in-flight calls. Flash-tier models can return 503 "high demand" under a burst of
# truly-concurrent calls; a small cap spreads the load so backoff retries actually land. Configurable.
MAX_CONCURRENCY = int(os.environ.get("MAX_CONCURRENCY", "4"))


async def generate_reactions(client: LLMClient, records: list[dict], change: dict) -> list[tuple[Reaction, bool]]:
    sem = asyncio.Semaphore(MAX_CONCURRENCY)

    async def _guarded(rec: dict) -> tuple[Reaction, bool]:
        async with sem:
            return await react_one(client, rec, change)

    return await asyncio.gather(*(_guarded(r) for r in records))


def assemble_artifact(scenario_art: TrajectoryArtifact, records: list[dict], reactions: list[Reaction]) -> TrajectoryArtifact:
    """Fill agents[] on the scenario artifact (meta + vehicles preserved)."""
    agents = []
    for rec, reaction in zip(records, reactions):
        p = rec["persona"]
        agents.append(
            Agent(
                vehicle_id=rec["vehicle_id"],
                persona=Persona(id=p["id"], label=p["label"]),  # trim rich PersonaSpec -> contract {id,label}
                outcome=Outcome.model_validate(rec["outcome"]),
                reaction=reaction,
                trigger_t=rec["trigger_t"],
            )
        )
    return TrajectoryArtifact(meta=scenario_art.meta, vehicles=scenario_art.vehicles, agents=agents)


def newest_instrumented() -> Path:
    files = sorted(RUNS_DIR.glob("instrumented-*.json"))
    if not files:
        raise SystemExit("no instrumented-*.json in contract/runs/ — run sampler.py first")
    return files[-1]


async def smoke_test(client: LLMClient) -> None:
    """One cheap call so a bad/absent key (or model id) surfaces ONCE, not as N concurrent failures.

    Tolerates transient overload (retries with backoff) so a temporary 503 doesn't abort the run;
    a real auth/config error (bad key, unknown model) still raises immediately.
    """
    for attempt in range(4):
        try:
            await client.generate_json(
                system="You are a test.",
                user="Return sentiment 0, stance neutral, comment 'ok'.",
                schema=_ReactionWire,
            )
            return
        except Exception as exc:
            if _is_transient(exc) and attempt < 3:
                await asyncio.sleep(2.0 * (attempt + 1))
                continue
            raise


async def run(instrumented_path: Path) -> Path:
    side = json.loads(instrumented_path.read_text(encoding="utf-8"))
    scenario_run_id = side["scenario_run_id"]
    records = side["instrumented"]

    scenario_art = trajectory_io.load_artifact(RUNS_DIR / f"{scenario_run_id}.json")
    change = scenario_art.meta.scenario.change.model_dump()

    client, provider, model = get_client()
    print(f"[llm] provider={provider} model={model}  travelers={len(records)}")

    print("[llm] smoke test ...")
    await smoke_test(client)  # raises here (clear error) if the key/model is bad

    results = await generate_reactions(client, records, change)
    reactions = [r for r, _ in results]
    fallbacks = sum(1 for _, fb in results if fb)

    artifact = assemble_artifact(scenario_art, records, reactions)
    out_path = trajectory_io.dump_artifact(artifact, RUNS_DIR / f"{scenario_run_id}.json")  # validates vs schema

    WEB_PUBLIC.mkdir(parents=True, exist_ok=True)
    web_copy = WEB_PUBLIC / f"{scenario_run_id}.json"
    shutil.copyfile(out_path, web_copy)  # non-destructive: leaves run.json alone

    _report(artifact, records, results, fallbacks, out_path, web_copy)
    return out_path


def _report(artifact, records, results, fallbacks, out_path, web_copy) -> None:
    print("\n" + "=" * 70)
    print("AGENT REACTIONS — assembled v0.2.0 artifact")
    print("=" * 70)
    print(f"run               : {artifact.meta.run_id}")
    print(f"change            : {artifact.meta.scenario.change.description}")
    print(f"agents            : {len(artifact.agents)}   fallbacks (neutral): {fallbacks}")
    print("-" * 70)
    print("3 example reactions (real, non-fallback):")
    shown = 0
    for rec, (reaction, is_fb) in zip(records, results):
        if is_fb or shown >= 3:
            continue
        shown += 1
        print(
            f"\n  [{rec['persona']['id']}]  delta={rec['outcome']['delta_seconds']:+.0f}s  "
            f"stance={reaction.stance}  sentiment={reaction.sentiment:+.2f}"
        )
        print(f"    \"{reaction.comment}\"")
    if shown == 0:
        print("  (none — every reaction fell back; check the API key/model)")
    print("\n" + "=" * 70)
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
