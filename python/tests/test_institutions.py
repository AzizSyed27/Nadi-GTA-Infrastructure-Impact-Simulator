"""V2.3c — the institutions pipeline: roster, facts gating, deterministic composition, and the two
locked invariants — MANDATE BYTE-IDENTITY (the mission string reaches the artifact verbatim from
institutions.json; for a real organization, paraphrase is misrepresentation) and ZERO LLM CALLS for
mandate voices (D1: an institution may say only its published mandate + code-rendered facts)."""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "python" / "src"))

import institutions  # noqa: E402
import reactions  # noqa: E402
import response_probe  # noqa: E402
import zone_lens  # noqa: E402
from contract_models import TrajectoryArtifact  # noqa: E402

# ---------------------------------------------------------------------------------------------
# Fake sidecar fragments shaped like the real producers' output
# ---------------------------------------------------------------------------------------------

RESPONSE_DETOUR = {
    "framing": response_probe.FRAMING,
    "lower_bound_note": response_probe.LOWER_BOUND_NOTE,
    "origins_note": ("probe origins are Toronto Fire Services station locations (Toronto Open Data, "
                     "retrieved 2026-07-25); routes are computed from every station and do not "
                     "indicate which station would respond"),
    "destination_edge": "E9",
    "destination_note": "first downstream junction with an alternate approach",
    "probes": [
        {"label": "Fire Station 231 (740 Markham Rd)", "origin_edge": "E1",
         "baseline_s": 57.0, "scenario_s": 105.7, "added_s": 48.7},
        {"label": "Fire Station 232 (1550 Midland Ave)", "origin_edge": "E2",
         "baseline_s": 80.0, "scenario_s": 80.0, "added_s": 0.0,
         "note": "the fastest route from this origin does not use the changed road under free-flow conditions"},
    ],
}
ZONE_FACTS = {
    "tag": "school_zone",
    "zone_edges": ["Z1"],
    "n_edges": 1,
    "window": {"start_s": 3600.0, "end_s": 7200.0},
    "ped_vehicle_conflicts": {"baseline": 30, "scenario": 28},
    "method_note": zone_lens.method_note(),
    "variation_note": zone_lens.VARIATION_NOTE,
    "population_note": zone_lens.population_note("calibrated_am_peak"),
}
NON_COMPLETIONS = {"car": 759, "bicycle": 2, "pedestrian": 5}
SPLIT = {"car": {"entered_not_finished": 400, "not_inserted": 359},
         "bicycle": {"entered_not_finished": 2, "not_inserted": 0},
         "pedestrian": {"entered_not_finished": 5, "not_inserted": 0}}
BACKLOG = {"car": {"baseline": 6000, "scenario": 6300},
           "bicycle": {"baseline": 0, "scenario": 0},
           "pedestrian": {"baseline": 0, "scenario": 0}}


def _side(**extra) -> dict:
    return {"reroute": {"cars_rerouted": 0, "cars_matched": 19804}, **extra}


def _entry(inst_id: str) -> dict:
    return next(e for e in institutions.load_roster() if e["id"] == inst_id)


# ---------------------------------------------------------------------------------------------
# Roster + facts gating
# ---------------------------------------------------------------------------------------------

def test_roster_loads_and_underscore_keys_ignored() -> None:
    roster = institutions.load_roster()
    assert [e["id"] for e in roster] == ["tfs", "tdsb", "transport_ops"]
    for e in roster:
        md = e["mandate"]
        assert all(md.get(k) for k in ("institution", "mission", "source", "retrieved"))
        assert md["source"].startswith("https://")
        # the comment quotes a mission CLAUSE — it must be a literal substring of the verbatim mission
        assert e["mission_clause"] in md["mission"], f"{e['id']}: mission_clause must be verbatim"


def test_speaks_gating_per_predicate() -> None:
    # TFS iff response_detour; TDSB iff zone_facts; ops iff nonzero diversions OR non_completions
    assert institutions.speaks(_entry("tfs"), _side()) is None
    assert institutions.speaks(_entry("tfs"), _side(response_detour=RESPONSE_DETOUR)) is not None
    assert institutions.speaks(_entry("tdsb"), _side()) is None
    assert institutions.speaks(_entry("tdsb"), _side(zone_facts=ZONE_FACTS)) is not None
    # ops: 0 diversions + no non_completions -> silent ("an institution never pads")
    assert institutions.speaks(_entry("transport_ops"), _side()) is None
    assert institutions.speaks(_entry("transport_ops"),
                               {"reroute": {"cars_rerouted": 935, "cars_matched": 19804}}) is not None
    assert institutions.speaks(_entry("transport_ops"), _side(non_completions=NON_COMPLETIONS)) is not None


def test_speed_limit_quiet_run_no_institutions() -> None:
    """The acceptance predicate: a plain speed_limit run (no capacity event, no zone tag, nothing
    diverted) gives NO institution standing — the empty-state is the honest surface."""
    assert institutions.speaking_institutions(_side()) == []


def test_speaking_set_on_a_closure_sidecar() -> None:
    side = _side(response_detour=RESPONSE_DETOUR, non_completions=NON_COMPLETIONS,
                 non_completions_split=SPLIT, insertion_backlog=BACKLOG)
    side["reroute"] = {"cars_rerouted": 935, "cars_matched": 19804}
    ids = [e["id"] for e, _ in institutions.speaking_institutions(side)]
    assert ids == ["tfs", "transport_ops"]  # no zone_facts -> TDSB silent


# ---------------------------------------------------------------------------------------------
# Citation composition — deterministic, honesty notes verbatim
# ---------------------------------------------------------------------------------------------

def test_tfs_citation_carries_both_honesty_sentences_verbatim() -> None:
    facts = {"response_detour": RESPONSE_DETOUR}
    cites = institutions.compose_citations(_entry("tfs"), facts)
    assert [c["key"] for c in cites] == ["response_detour"]
    c = cites[0]
    assert "worst of 2 fire stations +48.7 s" in c["text"]
    assert response_probe.FRAMING in c["notes"]
    assert response_probe.LOWER_BOUND_NOTE in c["notes"]
    assert any("do not indicate which station would respond" in n for n in c["notes"])
    # determinism
    assert institutions.compose_citations(_entry("tfs"), facts) == cites


def test_tdsb_citation_carries_zone_notes_verbatim() -> None:
    cites = institutions.compose_citations(_entry("tdsb"), {"zone_facts": ZONE_FACTS})
    c = cites[0]
    assert "28 in the scenario vs 30 in the baseline" in c["text"]
    assert "not crash prediction" in c["text"]
    assert zone_lens.VARIATION_NOTE in c["notes"]
    assert any("not modeled schoolchildren" in n for n in c["notes"])


def test_ops_citation_split_never_renders_without_the_attribution_parenthetical() -> None:
    facts = {"reroute": {"cars_rerouted": 935, "cars_matched": 19804},
             "non_completions": NON_COMPLETIONS, "non_completions_split": SPLIT,
             "insertion_backlog": BACKLOG}
    cites = institutions.compose_citations(_entry("transport_ops"), facts)
    assert [c["key"] for c in cites] == ["reroute", "non_completions"]
    nc = cites[1]["text"]
    assert "766" in nc  # the recomputed total
    assert "insertion backlog affects baseline runs too: 6000" in nc and "6300" in nc
    # without the split, no parenthetical is owed
    lean = institutions.compose_citations(_entry("transport_ops"),
                                          {"reroute": {"cars_rerouted": 935, "cars_matched": 19804},
                                           "non_completions": NON_COMPLETIONS})
    assert "insertion backlog" not in lean[1]["text"]


def test_comment_is_third_person_mandate_lens() -> None:
    entry = _entry("tfs")
    cites = institutions.compose_citations(entry, {"response_detour": RESPONSE_DETOUR})
    comment = institutions.compose_comment(entry, cites)
    assert comment.startswith("Toronto Fire Services' published mandate (toronto.ca, retrieved ")
    assert entry["mission_clause"] in comment
    assert response_probe.FRAMING in comment  # the first honesty note rides inline
    reaction = institutions.compose_reaction(entry, cites)
    assert reaction.sentiment == 0.0 and reaction.stance == "neutral"


# ---------------------------------------------------------------------------------------------
# The pipeline: sampler-shaped record -> deterministic reaction -> Agent -> dumped dict
# ---------------------------------------------------------------------------------------------

def _mandate_record(inst_id: str, facts: dict) -> dict:
    e = _entry(inst_id)
    return {"grounding": "mandate", "mode": "mandate",
            "persona": {"id": e["id"], "label": e["label"]},
            "mandate": dict(e["mandate"]), "mission_clause": e["mission_clause"],
            "cites": list(e.get("cites", [])), "facts": facts}


class _CountingClient:
    def __init__(self) -> None:
        self.calls = 0

    async def generate_json(self, *, system: str, user: str, schema, temperature: float = 0.8) -> dict:
        self.calls += 1
        return {"comment": "a stub reaction", "sentiment": 0.2, "stance": "neutral"}


def test_mandate_voices_make_zero_llm_calls_and_streamed_equals_assembled(tmp_path: Path, monkeypatch) -> None:
    import enrich_events

    inferred = {"grounding": "inferred", "mode": "inferred",
                "persona": {"id": "taxpayer", "label": "Skeptical taxpayer",
                            "description": "wants receipts", "delay_sensitivity": 0.5},
                "stakeholder": "taxpayer"}
    mandate = _mandate_record("tfs", {"response_detour": RESPONSE_DETOUR})
    records = [inferred, mandate]
    client = _CountingClient()
    events = tmp_path / "ev.jsonl"
    enrich_events.truncate(events)

    results = asyncio.run(reactions.generate_reactions(
        client, records, changes=[{"type": "speed_limit", "description": "d", "value_mps": 11.1}],
        events_path=events))
    assert client.calls == 1, "the mandate voice must make ZERO LLM calls (only the inferred one)"

    # streamed voice == assembled agent, element for element (transport, not content)
    agents = [reactions.build_agent(r, res[0]) for r, res in zip(records, results)]
    dumped = [a.model_dump(mode="json", exclude_none=True, by_alias=True) for a in agents]
    streamed = {}
    evs, _ = enrich_events.read_from(events, 0)
    for _n, e in evs:
        if e["event"] == "voice":
            streamed[e["index"]] = e["agent"]
    assert streamed[1] == dumped[1], "the streamed mandate agent must equal the assembled one"
    assert dumped[1]["grounding"] == "mandate" and dumped[1]["citations"]


def test_mandate_mission_reaches_the_artifact_byte_identical() -> None:
    """THE byte-identity pin (user fold-in): roster JSON -> sampler-shaped record -> Agent ->
    dumped artifact dict, mission EXACTLY equal for every roster institution — no truncation, no
    reformatting, no template interpolation, never LLM-touched. The one string in this system where
    paraphrase is a misrepresentation."""
    roster_raw = json.loads((REPO / "python" / "src" / "institutions.json").read_text(encoding="utf-8"))
    facts_by_id = {"tfs": {"response_detour": RESPONSE_DETOUR}, "tdsb": {"zone_facts": ZONE_FACTS},
                   "transport_ops": {"reroute": {"cars_rerouted": 935, "cars_matched": 19804},
                                     "non_completions": NON_COMPLETIONS}}
    for entry_raw in roster_raw["institutions"]:
        rec = _mandate_record(entry_raw["id"], facts_by_id[entry_raw["id"]])
        entry = {"id": rec["persona"]["id"], "label": rec["persona"]["label"],
                 "mandate": rec["mandate"], "mission_clause": rec["mission_clause"],
                 "cites": rec["cites"]}
        rec["citations"] = institutions.compose_citations(entry, rec["facts"])
        agent = reactions.build_agent(rec, institutions.compose_reaction(entry, rec["citations"]))
        dumped = agent.model_dump(mode="json", exclude_none=True, by_alias=True)
        assert dumped["mandate"]["mission"] == entry_raw["mandate"]["mission"], (
            f"{entry_raw['id']}: mandate.mission must reach the artifact BYTE-IDENTICAL to the roster")
        assert dumped["mandate"]["source"] == entry_raw["mandate"]["source"]
        assert dumped["mandate"]["retrieved"] == entry_raw["mandate"]["retrieved"]


def test_ensure_version_for_mandate() -> None:
    art9 = TrajectoryArtifact.model_validate(
        json.loads((REPO / "web" / "public" / "sample_v0_9_0.json").read_text(encoding="utf-8")))
    mandate_rec = [{"grounding": "mandate"}]

    art9.schema_version = "0.8.0"
    reactions.ensure_version_for_mandate(art9, mandate_rec)
    assert art9.schema_version == "0.9.0"  # upgraded in place

    art9.schema_version = "0.9.0"
    reactions.ensure_version_for_mandate(art9, mandate_rec)
    assert art9.schema_version == "0.9.0"  # idempotent

    art9.schema_version = "0.7.0"
    with pytest.raises(SystemExit):
        reactions.ensure_version_for_mandate(art9, mandate_rec)

    art9.schema_version = "0.7.0"
    reactions.ensure_version_for_mandate(art9, [{"grounding": "inferred"}])
    assert art9.schema_version == "0.7.0"  # no mandate records -> untouched


def test_mandate_agents_never_seed_the_social_graph() -> None:
    """V2.3c — institutions never argue on social feeds (and their digit-bearing comments would trip
    the cascade audit): build_nodes must exclude mandate agents entirely."""
    import propagation
    import trajectory_io

    art = trajectory_io.load_artifact(REPO / "web" / "public" / "sample_v0_9_0.json")
    assert any(a.grounding == "mandate" for a in art.agents)
    nodes = propagation.build_nodes(art)
    ids = {n["persona_id"] for n in nodes}
    assert "tfs" not in ids, "a mandate agent leaked into the social graph"
    assert {a.persona.id for a in art.agents if a.grounding != "mandate"} == ids
