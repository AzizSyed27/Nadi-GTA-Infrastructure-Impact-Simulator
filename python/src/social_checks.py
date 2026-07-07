"""Phase 4.1 — the deterministic social-content IMMUTABILITY checker.

A social post/comment may not claim a trip DIRECTION that contradicts the owning agent's MEASURED outcome.
An agent whose ``delta_seconds`` is POSITIVE (their trip got SLOWER) must not post that it got faster, and
vice versa. This is a semantic guard (like the report audit), NOT wired into schema validation — the producer
(4.2) runs it over clean candidate events and marks any violator ``audit_status="excluded"``.

Sign convention (scenario_harness / reactions._sim_suffix): ``delta_seconds = scenario - baseline``;
POSITIVE = slower, NEGATIVE = faster. Agents with no measured outcome (inferred voices) are skipped — they
made no trip, so there is nothing to contradict. Already-excluded events are skipped (already handled).
"""

from __future__ import annotations

import re

from contract_models import TrajectoryArtifact

# Claims that the trip got FASTER / SLOWER. Kept deliberately narrow — a false negative (missing a paraphrase)
# is safer than a false positive that excludes an honest post.
_FASTER = re.compile(
    r"\b(faster|quicker|sped up|saved? (?:me )?(?:time|minutes)|shaved? off|"
    r"(?:less|shorter) (?:time|commute|drive|trip)|got there sooner)\b", re.I)
_SLOWER = re.compile(
    r"\b(slower|took longer|lost time|(?:added|costs?|cost me) (?:time|minutes)|"
    r"(?:more|extra|longer) (?:time|commute|drive|trip|minutes)|delayed?|held up)\b", re.I)


def agent_id_of(agent) -> str:
    """The frontend agentId convention: vehicle_id ?? person_id ?? persona.id."""
    return agent.vehicle_id or agent.person_id or agent.persona.id


def check_immutability(artifact: TrajectoryArtifact) -> list[dict]:
    """Return a list of violations. Empty = every clean social post is sign-consistent with the actor's outcome."""
    if artifact.social is None:
        return []
    # agentId -> measured delta_seconds, ONLY for agents with an outcome (sim-grounded travelers).
    delta_by_agent = {agent_id_of(a): a.outcome.delta_seconds for a in artifact.agents if a.outcome is not None}

    violations: list[dict] = []
    for cascade in artifact.social.cascades:
        for step in cascade.steps:
            for ev in step.events:
                if ev.audit_status == "excluded" or not ev.content:
                    continue  # already handled / nothing to check (e.g. a like)
                delta = delta_by_agent.get(ev.agent)
                if delta is None:
                    continue  # inferred voice — no measured trip, nothing to contradict
                claim = None
                if delta > 0 and _FASTER.search(ev.content):
                    claim = "faster"  # got slower, claims faster
                elif delta < 0 and _SLOWER.search(ev.content):
                    claim = "slower"  # got faster, claims slower
                if claim is not None:
                    violations.append({
                        "cascade_id": cascade.cascade_id, "step": step.step, "agent": ev.agent,
                        "delta_seconds": delta, "claim": claim, "content": ev.content,
                    })
    return violations
