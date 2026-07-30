"""V2.3a — the streamed-voice byte-identity pin + the CLI no-op gate.

The stream's honesty claim is STRUCTURAL: a `voice` event's agent is built by the SAME ``build_agent`` the
final artifact assembly uses (streaming is transport, not content). Per the recompute-verify-shares-blind-spots
convention, the pin here compares the TWO REAL PATHS' outputs — events written by ``generate_reactions``
through a stub client vs the agents ``assemble_in_place`` puts on the artifact — element-for-element, not the
shared function against itself."""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "python" / "src"))

import enrich_events  # noqa: E402
import reactions  # noqa: E402
from contract_models import Reaction  # noqa: E402


def _records() -> list[dict]:
    outcome = {"baseline_duration": 100.0, "scenario_duration": 160.0, "delta_seconds": 60.0,
               "baseline_timeloss": 20.0, "scenario_timeloss": 45.0}
    return [
        {"grounding": "sim", "vehicle_id": "veh_1", "trigger_t": 12.5, "outcome": outcome,
         "persona": {"id": "car_commuter_1", "label": "Devi, commuter", "description": "drives daily"}},
        {"grounding": "sim", "person_id": "ped_7", "trigger_t": 40.0, "outcome": dict(outcome),
         "persona": {"id": "ped_1", "label": "Sam, walker", "description": "walks to the GO station"}},
        {"grounding": "inferred", "stakeholder": "business_owner",
         "persona": {"id": "shop_owner", "label": "Nadia, shop owner", "description": "runs a bakery"}},
    ]


_CHANGES = [{"type": "speed_limit", "target_edge": "e1", "value_mps": 8.33,
             "description": "40 km/h on Kingston Rd"}]


class _StubClient:
    """Deterministic per-persona comments so reordering bugs can't cancel out."""

    async def generate_json(self, system: str, user: str, schema) -> dict:
        # the persona line is the last line of the system prompt — key the comment on it
        tag = system.rsplit("- ", 1)[-1].split(":", 1)[0]
        return {"comment": f"reaction from {tag}", "sentiment": 0.5, "stance": "supportive"}


def test_streamed_agents_equal_assembled_agents(tmp_path: Path) -> None:
    records = _records()
    ev = tmp_path / "r.events.jsonl"
    enrich_events.truncate(ev)

    results = asyncio.run(
        reactions.generate_reactions(_StubClient(), records, _CHANGES, events_path=ev)
    )
    assert not any(fb for _, fb in results), "stub must not fall back"

    # PATH 1 — the artifact assembly (what dump_artifact would write)
    class _Art:  # assemble_in_place only touches .agents
        agents: list = []

    assembled = reactions.assemble_in_place(_Art(), records, [r for r, _ in results])
    final = [a.model_dump(mode="json", exclude_none=True, by_alias=True) for a in assembled.agents]

    # PATH 2 — the streamed events, arriving in completion order, reordered by index
    events, _ = enrich_events.read_from(ev, 0)
    voices = [e for _, e in events if e["event"] == "voice"]
    assert len(voices) == len(records)
    assert sorted(v["done"] for v in voices) == [1, 2, 3]
    assert all(v["total"] == 3 for v in voices)
    streamed = [v["agent"] for v in sorted(voices, key=lambda v: v["index"])]

    assert streamed == final, "a streamed voice must be byte-identical to the artifact's agent"
    # spot-check the shape really is the contract one (sim pin + no nulls leaked by exclude_none)
    assert streamed[0]["vehicle_id"] == "veh_1" and "person_id" not in streamed[0]
    assert streamed[2]["grounding"] == "inferred" and "outcome" not in streamed[2]


def test_no_env_no_file(tmp_path: Path, monkeypatch) -> None:
    """CLI byte-identity: with NADI_ENRICH_EVENTS unset, generate_reactions touches no events file."""
    monkeypatch.delenv(enrich_events.ENV_VAR, raising=False)
    monkeypatch.setattr(enrich_events, "EVENTS_ROOT", tmp_path / "root")
    assert enrich_events.from_env() is None
    asyncio.run(reactions.generate_reactions(_StubClient(), _records(), _CHANGES,
                                             events_path=enrich_events.from_env()))
    assert not (tmp_path / "root").exists(), "no env var → no events dir/file"


def test_fallback_voice_still_streams(tmp_path: Path) -> None:
    """A neutral-fallback reaction is IN the artifact, so it must stream too (counts stay honest)."""

    class _FailClient:
        async def generate_json(self, system: str, user: str, schema) -> dict:
            raise ValueError("malformed forever")  # non-transient → parse-retry once → fallback

    records = _records()[:1]
    ev = tmp_path / "r.events.jsonl"
    enrich_events.truncate(ev)
    results = asyncio.run(reactions.generate_reactions(_FailClient(), records, _CHANGES, events_path=ev))
    assert results[0][1] is True, "expected the fallback path"
    events, _ = enrich_events.read_from(ev, 0)
    voices = [e for _, e in events if e["event"] == "voice"]
    assert len(voices) == 1 and voices[0]["done"] == 1
    assert voices[0]["agent"]["reaction"] == json.loads(
        Reaction(comment="(no reaction generated)", sentiment=0.0, stance="neutral").model_dump_json()
    )
