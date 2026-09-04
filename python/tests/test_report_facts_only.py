"""V2.7b — the report's three contained changes: --facts-only, the persisted draft, the seed cure.

WHY EACH ONE EARNS ITS PLACE:
  * ``facts_only`` is what makes "the results are complete the moment the physics ends" true rather
    than aspirational — one zero-LLM mechanism serving three screens (results-readable-immediately,
    the skipped state, the degraded state);
  * the rejected DRAFT is the credibility moment of the AI act — a reader watching the guard catch an
    overclaim and correct it. It was thrown away by a rebinding;
  * the safety caveat quoted a scorecard cell note that bakes the canonical 42/43/44 tuple into every
    SINGLE-seed run, so the landing page's prose claimed a three-seed check beside ``n_seeds: 1``.

Run: python -m pytest python/tests/test_report_facts_only.py -v
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

import pytest
from pydantic import BaseModel

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "python" / "src"))
import report  # noqa: E402
import run_events  # noqa: E402
import scorecard as scorecard_mod  # noqa: E402
import trajectory_io  # noqa: E402
from contract_models import (  # noqa: E402
    Change, Meta, Scenario, Scorecard, ScorecardCell, ScorecardGroup, TrajectoryArtifact, Vehicle,
)

RUN_ID = "multimodal-scenario-TESTFACTSONLY"
TS = "TESTFACTSONLY"


def _artifact() -> TrajectoryArtifact:
    change = Change(type="bike_lane", target_edge="E1", target_lane=1,
                    description="Converted a car lane to a bike lane")
    meta = Meta(run_id=RUN_ID, network="corridor.net.xml", bbox=[-79.3, 43.7, -79.1, 43.8],
                sim_start=0.0, sim_end=100.0, step_length=1.0, created_at="2026-07-04T00:00:00+00:00",
                scenario=Scenario(baseline_run_id=f"multimodal-baseline-{TS}", change=change))
    groups = [
        ScorecardGroup(group="car_commuter", grounding="sim",
                       travel_time_delta=ScorecardCell(value=0.0, affected_share=0.03,
                                                       confidence="measured", note="tt"),
                       safety_delta=ScorecardCell(value=6.5, confidence="low",
                                                  note=scorecard_mod._SAFETY_NOTE),
                       access_delta=ScorecardCell(value=0.33, confidence="low", note="est")),
    ]
    return TrajectoryArtifact(schema_version="0.3.0", meta=meta,
                              vehicles=[Vehicle(id="c1", type="car",
                                                path=[[-79.2, 43.75], [-79.2, 43.76]],
                                                timestamps=[0.0, 1.0], speeds=[1.0, 1.0])],
                              scorecard=Scorecard(groups=groups, bca=None))


def _outcomes() -> dict:
    return {
        "scenario_run_id": RUN_ID, "baseline_run_id": f"multimodal-baseline-{TS}",
        "connectivity_severed_edges": [], "reroute": {"cars_rerouted": 0, "cars_matched": 300},
        "modes": {m: {"counts": {"total_demand": d}} for m, d in
                  (("car", 300), ("bicycle", 82), ("pedestrian", 129))},
    }


@pytest.fixture()
def env(tmp_path, monkeypatch):
    runs, web = tmp_path / "runs", tmp_path / "web"
    runs.mkdir()
    web.mkdir()
    monkeypatch.setattr(report, "RUNS_DIR", runs)
    monkeypatch.setattr(report, "WEB_PUBLIC", web)
    import run_state
    monkeypatch.setattr(run_state, "STATE_DIR", tmp_path / "state")
    trajectory_io.dump_artifact(_artifact(), runs / f"{RUN_ID}.json")
    (runs / f"outcomes-{TS}.json").write_text(json.dumps(_outcomes()), encoding="utf-8")
    return runs, web


def _report(runs: Path) -> dict:
    return json.loads((runs / f"report-{TS}.json").read_text(encoding="utf-8"))


# --------------------------------------------------------------------------------------------- facts-only

def test_facts_only_writes_the_code_rendered_half_with_no_model_call(env, monkeypatch):
    """Structurally zero-LLM: if anything reached for a client this would raise."""
    runs, web = env
    monkeypatch.setattr(report, "get_client", lambda *a, **k: pytest.fail("facts_only made a model call"))
    out = report.facts_only(RUN_ID)
    assert out == runs / f"report-{TS}.json"
    rj = _report(runs)
    # the FIGURES are all there
    assert rj["run_id"] == RUN_ID
    assert rj["facts"]["demand_profile"] and rj["facts"]["n_seeds"] == 1
    assert rj["scorecard"]["groups"], "the scorecard rides the facts-only document"
    assert rj["car_tail"]["sentence"], "the cross-seed sentence is code-rendered"
    assert rj["sections"]["cannot_tell"]["caveats"], "the caveats are code-rendered too"
    # …and the prose is ABSENT and LABELLED, never faked or silently blank
    assert rj["prose"]["status"] == report.NOT_COMPOSED
    assert "computed by the simulator" in rj["prose"]["note"]
    assert rj["sections"]["what_tested"]["framing"] == ""
    assert rj["sections"]["who_affected"]["glosses"] == {}
    assert rj["sections"]["what_they_say"]["groups"] == []
    assert rj["sections"]["cannot_tell"]["intro"] == ""
    assert rj["audit"]["log"] == [] and rj["audit"]["passed"] is None
    assert "nothing to audit" in rj["audit"]["summary"]
    # the per-run web copy is the client's resolution path
    assert json.loads((web / f"{RUN_ID}-report.json").read_text(encoding="utf-8")) == rj


def test_facts_only_writes_no_markdown_and_never_repoints_the_served_report(env):
    """There is no prose to render, and aiming the served-report pointer at a prose-less document
    is the recorded 2026-08-13 incident class — the same restraint refresh_facts already shows."""
    runs, web = env
    report.facts_only(RUN_ID)
    assert not (runs / f"report-{TS}.md").exists(), "no prose → no markdown"
    assert not (web / "latest-report.json").exists(), "facts-only must never write the pointer"
    assert sorted(p.name for p in web.iterdir()) == [f"{RUN_ID}-report.json"]


def test_facts_only_refuses_a_run_without_a_scorecard(env):
    runs, _web = env
    art = _artifact()
    art.scorecard = None
    trajectory_io.dump_artifact(art, runs / f"{RUN_ID}.json")
    with pytest.raises(SystemExit, match="no scorecard"):
        report.facts_only(RUN_ID)


def _compose_stored(runs: Path, **overrides) -> None:
    """Give the stored report real prose, so 'composed' describes it truthfully."""
    stored = _report(runs)
    stored["sections"]["what_tested"]["framing"] = "STORED FRAMING PROSE."
    stored["sections"]["who_affected"]["glosses"] = {gid: f"STORED GLOSS {gid}."
                                                     for gid in report.GROUP_ORDER}
    stored["sections"]["cannot_tell"]["intro"] = "STORED INTRO."
    stored.update(overrides)
    (runs / f"report-{TS}.json").write_text(json.dumps(stored), encoding="utf-8")


def test_refresh_of_a_facts_only_document_stays_not_composed(env):
    """A refresh must not INVENT prose status, and must not manufacture a markdown rendering of
    prose that does not exist. Mutation-effective in both directions."""
    runs, _web = env
    report.facts_only(RUN_ID)
    report.refresh_facts(RUN_ID)
    assert _report(runs)["prose"]["status"] == report.NOT_COMPOSED
    assert not (runs / f"report-{TS}.md").exists(), "no prose → still no markdown after a refresh"

    # the other direction: a genuinely composed document refreshes as composed, markdown and all
    _compose_stored(runs, prose={"status": report.COMPOSED, "note": ""})
    report.refresh_facts(RUN_ID)
    assert _report(runs)["prose"]["status"] == report.COMPOSED
    assert (runs / f"report-{TS}.md").exists()
    assert "STORED FRAMING PROSE." in (runs / f"report-{TS}.md").read_text(encoding="utf-8")

    # a PRE-V2.7b report has no prose key at all and legitimately carries prose
    stored = _report(runs)
    del stored["prose"]
    (runs / f"report-{TS}.json").write_text(json.dumps(stored), encoding="utf-8")
    report.refresh_facts(RUN_ID)
    assert _report(runs)["prose"]["status"] == report.COMPOSED


# ------------------------------------------------------------------------------- the persisted draft

class _Wire(BaseModel):
    framing: str


class _RetryClient:
    """First answer trips the tally rule; the retry is clean — the audit path under test."""

    def __init__(self) -> None:
        self.calls = 0

    async def generate_json(self, system: str, user: str, schema, **kw) -> dict:
        self.calls += 1
        if self.calls == 1:
            return {"framing": "The majority of residents welcome this change."}
        return {"framing": "Some residents welcome the change and others do not."}


def test_rejected_draft_is_persisted_with_its_rule(env):
    """The correction is only showable if the draft survives. It used to be overwritten by the retry's
    rebinding, leaving only the offending sentence inside `violations`."""
    log: list[dict] = []
    client = _RetryClient()
    obj = asyncio.run(report._slot(client, "sys", "user", _Wire, "framing", "framing", log))
    assert client.calls == 2
    (entry,) = log
    assert entry["status"] == "resolved_on_retry"
    assert entry["draft"] == "The majority of residents welcome this change."
    assert [v["rule"] for v in entry["violations"]] == ["tally"]
    assert entry["violations"][0]["sentence"] == entry["draft"]
    assert obj["framing"] == "Some residents welcome the change and others do not."


def test_a_clean_slot_records_no_draft(env):
    class _Clean:
        async def generate_json(self, system, user, schema, **kw):
            return {"framing": "Some residents welcome the change and others do not."}

    log: list[dict] = []
    asyncio.run(report._slot(_Clean(), "sys", "user", _Wire, "framing", "framing", log))
    assert log == [{"slot": "framing", "status": "clean", "violations": []}]
    assert "draft" not in log[0], "a clean slot has no rejected draft to show"


def test_slot_events_are_env_gated(tmp_path, monkeypatch):
    """CLI byte-identity: with NADI_RUN_EVENTS unset, a report generation writes no events file."""
    monkeypatch.delenv(run_events.ENV_VAR, raising=False)
    monkeypatch.setattr(run_events, "EVENTS_ROOT", tmp_path / "root")
    log: list[dict] = []
    asyncio.run(report._slot(_RetryClient(), "s", "u", _Wire, "framing", "framing", log))
    assert not (tmp_path / "root").exists(), "no env var → no events dir/file"

    ev = tmp_path / "r.events.jsonl"
    run_events.begin(ev, "r")
    monkeypatch.setenv(run_events.ENV_VAR, str(ev))
    log2: list[dict] = []
    asyncio.run(report._slot(_RetryClient(), "s", "u", _Wire, "framing", "framing", log2))
    events, _ = run_events.read_from(ev, 0)
    kinds = [e["event"] for _, e in events]
    assert kinds == ["run_start", "slot_start", "slot_landed"]
    landed = events[2][1]
    assert landed["status"] == "resolved_on_retry" and landed["calls"] == 2
    assert landed["draft"] == "The majority of residents welcome this change."
    assert landed["text"] == "Some residents welcome the change and others do not."


# --------------------------------------------------------------------- the safety caveat's seed wording

def _caveat_body(note: str, seeds: list[int]) -> str:
    group = type("G", (), {"safety_delta": type("C", (), {"note": note})()})()
    return report._safety_direction_body({"by_group": {"g": group}, "seeds": seeds})


def test_single_seed_caveat_names_this_runs_seed_and_never_the_canonical_tuple():
    body = _caveat_body(scorecard_mod._SAFETY_NOTE, [42])
    assert "42/43/44" not in body, "a single-seed run must not claim a three-seed check"
    assert "This run used a single seed (42)" in body
    assert "cross-seed sign stability was not probed for it" in body
    assert "its direction is not claimed" in body


def test_the_calibrated_appendix_is_real_content_and_survives():
    """Only the baked prefix is replaced — the peak-density clause was measured and stays."""
    note = scorecard_mod._SAFETY_NOTE + (". At peak density, safety surrogates are dominated by "
                                         "queue interactions")
    body = _caveat_body(note, [42])
    assert "42/43/44" not in body
    assert "At peak density, safety surrogates are dominated by queue interactions" in body


def test_an_earned_multi_seed_note_is_still_quoted_verbatim():
    """Mutation-effective in the other direction: a note the scorecard EARNED (the run measured its
    own stability) is honest, and must keep being quoted rather than replaced by the derived form."""
    earned = "sign flips across seeds 42/43/44 in this run; directional claim not supported"
    body = _caveat_body(earned, [42, 43, 44])
    assert f"“{earned}”" in body
    assert "This run used a single seed" not in body


def test_a_multi_seed_run_without_an_earned_note_says_so():
    body = _caveat_body(scorecard_mod._SAFETY_NOTE, [42, 43, 44])
    assert "Seeds 42/43/44 were run for this scenario" in body
    assert "no per-cell sign stability was recorded" in body
    assert "single seed" not in body


def test_the_bare_fallback_string_is_gone():
    """With no note at all the old code fell back to a literal 'sign not stable across seeds' — a
    claim about seeds nobody checked. The derived sentence covers this case honestly."""
    body = _caveat_body("", [42])
    assert "This run used a single seed (42)" in body


def test_the_caveat_rides_the_real_facts_only_document(env):
    runs, _web = env
    report.facts_only(RUN_ID)
    (safety,) = [c for c in _report(runs)["sections"]["cannot_tell"]["caveats"]
                 if c["title"] == "Safety direction is not established"]
    assert "42/43/44" not in safety["body"]
    assert "This run used a single seed (42)" in safety["body"]
