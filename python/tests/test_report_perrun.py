"""V2.7a C1 — the per-run report rung: widened report_json facts + the --refresh-facts mode.

The report JSON must carry the code-derived facts the run document renders (the markdown-only
facts of V2.2–V2.5), a top-level run_id, and a per-run web copy (`web/public/<run_id>-report.json`,
the graphs-sidecar pattern); `--refresh-facts` re-derives every code-rendered field from the run's
sidecars while REUSING the stored LLM prose and audit block byte-identically, with ZERO LLM calls
and NO latest-report.* write (an old-run refresh repointing the singleton is the recorded
2026-08-13 incident class).

Run: python -m pytest python/tests/test_report_perrun.py -v
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "python" / "src"))
import report  # noqa: E402
import trajectory_io  # noqa: E402
from contract_models import (  # noqa: E402
    Change, Meta, Scenario, Scorecard, ScorecardCell, ScorecardGroup, TrajectoryArtifact, Vehicle,
)

RUN_ID = "multimodal-scenario-TESTREFRESH"
TS = "TESTREFRESH"

# Every code-derived fact the run document renders — the widened report_json block must carry
# each of these KEYS even when the value is honestly null for the run.
WIDENED_KEYS = {
    "changes", "assignment", "demand_profile", "sim_end", "tags", "n_seeds", "seed_basis",
    "sign_unstable_cells", "non_completions", "non_completions_split", "insertion_backlog",
    "window_events", "response_detour", "zone_facts", "scope_disclosure", "calibration",
    "render_sample",
}


# --------------------------------------------------------------------------------------------------
# The deterministic stub run (mirrors test_report._artifact, named the way _resolve expects).
# --------------------------------------------------------------------------------------------------

def _artifact() -> TrajectoryArtifact:
    change = Change(type="bike_lane", target_edge="E1", target_lane=1, value_mps=None,
                    description="Converted a car lane to a bike lane")
    meta = Meta(run_id=RUN_ID, network="corridor.net.xml", bbox=[-79.3, 43.7, -79.1, 43.8],
                sim_start=0.0, sim_end=100.0, step_length=1.0, created_at="2026-07-04T00:00:00+00:00",
                scenario=Scenario(baseline_run_id="multimodal-baseline-TESTREFRESH", change=change))
    groups = [
        ScorecardGroup(group="car_commuter", grounding="sim",
                       travel_time_delta=ScorecardCell(value=0.0, affected_share=0.033,
                                                       confidence="measured", note="tt"),
                       safety_delta=ScorecardCell(value=6.5, confidence="low", note="safety unstable"),
                       access_delta=ScorecardCell(value=0.33, confidence="low", note="est")),
        ScorecardGroup(group="cyclist", grounding="sim",
                       travel_time_delta=ScorecardCell(value=0.0, affected_share=0.0,
                                                       confidence="measured", note="tt"),
                       safety_delta=ScorecardCell(value=6.8, confidence="low", note="safety unstable"),
                       access_delta=ScorecardCell(value=-1.0, confidence="low", note="est")),
    ]
    return TrajectoryArtifact(schema_version="0.3.0", meta=meta,
                              vehicles=[Vehicle(id="c1", type="car",
                                                path=[[-79.2, 43.75], [-79.2, 43.76]],
                                                timestamps=[0.0, 1.0], speeds=[1.0, 1.0])],
                              scorecard=Scorecard(groups=groups, bca=None))


def _outcomes() -> dict:
    return {
        "scenario_run_id": RUN_ID, "baseline_run_id": "multimodal-baseline-TESTREFRESH",
        "connectivity_severed_edges": [], "reroute": {"cars_rerouted": 0, "cars_matched": 300},
        "modes": {m: {"counts": {"total_demand": d}} for m, d in
                  (("car", 300), ("bicycle", 82), ("pedestrian", 129))},
    }


def _old_report() -> dict:
    """A stored pre-widening report JSON — markers where refresh must REUSE, never regenerate."""
    return {
        "report_version": report.REPORT_VERSION,
        "generated_at": "2026-01-01T00:00:00+00:00",
        "provider": "provider-OLD", "model": "model-OLD", "usage": {"marker": 1},
        "run": {"scenario_run_id": RUN_ID, "baseline_run_id": "multimodal-baseline-TESTREFRESH"},
        "scenario_change": {"type": "bike_lane", "target_edge": "E1"},
        "scorecard": {"groups": []},
        "car_tail": {"median_s": 0.0, "share_gt30_pct": 3.3},
        "sections": {
            "what_tested": {"framing": "OLD FRAMING PROSE."},
            "who_affected": {"group_order": report.GROUP_ORDER, "group_labels": report.GROUP_LABEL,
                             "glosses": {gid: f"OLD GLOSS {gid}." for gid in report.GROUP_ORDER}},
            "what_they_say": {"groups": []},
            "institutional": None,
            "discourse": None,
            "cannot_tell": {"intro": "OLD INTRO.", "caveats": [{"title": "old", "body": "old caveat"}]},
        },
        "audit": {"passed": True, "slots_checked": 13, "summary": "OLD AUDIT SUMMARY",
                  "log": [{"slot": "framing", "status": "clean", "violations": []}]},
        "sources": ["stale-source.json"],
    }


@pytest.fixture()
def env(tmp_path, monkeypatch):
    runs = tmp_path / "runs"
    web = tmp_path / "web"
    runs.mkdir()
    web.mkdir()
    monkeypatch.setattr(report, "RUNS_DIR", runs)
    monkeypatch.setattr(report, "WEB_PUBLIC", web)
    trajectory_io.dump_artifact(_artifact(), runs / f"{RUN_ID}.json")
    (runs / f"outcomes-{TS}.json").write_text(json.dumps(_outcomes()), encoding="utf-8")
    (runs / f"report-{TS}.json").write_text(json.dumps(_old_report()), encoding="utf-8")
    return runs, web


def _new_report(runs: Path) -> dict:
    return json.loads((runs / f"report-{TS}.json").read_text(encoding="utf-8"))


# --------------------------------------------------------------------------------------------------
# The refresh mode
# --------------------------------------------------------------------------------------------------

def test_refresh_reuses_prose_and_audit_byte_identical(env):
    runs, _web = env
    old = _old_report()
    report.refresh_facts(RUN_ID)
    new = _new_report(runs)
    # LLM-authored material and its provenance are REUSED, never regenerated
    assert new["audit"] == old["audit"]
    assert new["sections"]["what_tested"]["framing"] == "OLD FRAMING PROSE."
    assert new["sections"]["who_affected"]["glosses"] == old["sections"]["who_affected"]["glosses"]
    assert new["sections"]["cannot_tell"]["intro"] == "OLD INTRO."
    assert (new["provider"], new["model"], new["usage"]) == ("provider-OLD", "model-OLD", {"marker": 1})
    assert new["generated_at"] == "2026-01-01T00:00:00+00:00"
    # the refresh is stamped as a refresh, not disguised as a fresh generation
    assert new.get("facts_refreshed_at"), "refresh must stamp facts_refreshed_at"
    assert new["facts_refreshed_at"] != new["generated_at"]
    # the markdown re-render happened too
    assert (runs / f"report-{TS}.md").read_text(encoding="utf-8").strip()


def test_refresh_widens_report_json(env):
    runs, _web = env
    report.refresh_facts(RUN_ID)
    new = _new_report(runs)
    assert new["run_id"] == RUN_ID
    assert new["run"]["scenario_run_id"] == RUN_ID
    facts = new["facts"]
    missing = WIDENED_KEYS - set(facts)
    assert not missing, f"widened facts block is missing keys: {sorted(missing)}"
    # code-derived values, not copies of the stale stored report
    assert len(facts["changes"]) == 1 and facts["changes"][0]["type"] == "bike_lane"
    assert facts["demand_profile"] == "synthetic_demo"
    assert facts["sim_end"] == 100.0
    assert facts["n_seeds"] == 1
    # honestly-null facts keep their KEYS (absence must stay distinguishable from omission)
    assert facts["scope_disclosure"] is None
    assert facts["response_detour"] is None
    # code-rendered numbers are re-derived (the stale sources list is replaced)
    assert new["sources"] != ["stale-source.json"]


def test_refresh_writes_per_run_web_copy_and_never_the_singleton(env):
    runs, web = env
    report.refresh_facts(RUN_ID)
    per_run = web / f"{RUN_ID}-report.json"
    assert per_run.is_file(), "per-run web copy missing"
    assert per_run.read_bytes() == (runs / f"report-{TS}.json").read_bytes()
    assert not (web / "latest-report.json").exists(), "refresh must NEVER write the singleton"
    assert not (web / "latest-report.md").exists(), "refresh must NEVER write the singleton"


def test_refresh_requires_explicit_run_id(env):
    with pytest.raises(SystemExit):
        report.refresh_facts(None)


def test_refresh_missing_stored_report_exits_loudly(env):
    runs, _web = env
    (runs / f"report-{TS}.json").unlink()
    with pytest.raises(SystemExit) as ei:
        report.refresh_facts(RUN_ID)
    assert f"report-{TS}.json" in str(ei.value)


def test_refresh_stored_report_for_another_run_exits_loudly(env):
    runs, _web = env
    old = _old_report()
    old["run"]["scenario_run_id"] = "multimodal-scenario-SOMEOTHER"
    (runs / f"report-{TS}.json").write_text(json.dumps(old), encoding="utf-8")
    with pytest.raises(SystemExit):
        report.refresh_facts(RUN_ID)


def test_facts_block_serializes_model_typed_vintage_fields(env):
    """0.7.0+/0.6.0+ artifacts carry pydantic MODELS in meta.assignment / meta.render_sample —
    the facts block must emit plain JSON for them (caught live on the example run's refresh:
    'Object of type Assignment is not JSON serializable')."""
    from contract_models import Assignment, RenderSample
    runs, _web = env
    art = _artifact()
    facts = report.gather_facts(art, _outcomes(), verdict=None)
    facts["assignment"] = Assignment(mode="settled", scope="cars_only")
    facts["render_sample"] = RenderSample(strategy="outcome_stratified", rendered_vehicles=1,
                                          total_vehicles=2, rendered_persons=0, total_persons=0)
    block = report._report_json_facts(facts)
    dumped = json.loads(json.dumps(block))  # must round-trip as plain JSON
    assert dumped["assignment"] == {"mode": "settled", "scope": "cars_only"}
    assert dumped["render_sample"]["strategy"] == "outcome_stratified"


def test_refresh_constructs_no_llm_client(env, monkeypatch):
    def _boom():
        raise AssertionError("LLM client constructed during --refresh-facts")
    monkeypatch.setattr(report, "get_client", _boom)
    report.refresh_facts(RUN_ID)  # must complete without touching the provider layer


# --------------------------------------------------------------------------------------------------
# The COMMITTED per-run reports (singleton-class artifacts — pinned the moment they land).
# --------------------------------------------------------------------------------------------------

PINNED = "multimodal-scenario-20260702T044134Z"
EXAMPLE = "multimodal-scenario-20260814T063253Z"
WEB_PUBLIC_REAL = REPO_ROOT / "web" / "public"
RUNS_REAL = REPO_ROOT / "contract" / "runs"


@pytest.mark.parametrize("run_id", [PINNED, EXAMPLE])
def test_committed_per_run_report_shape_pin(run_id):
    p = WEB_PUBLIC_REAL / f"{run_id}-report.json"
    assert p.is_file(), f"committed per-run report missing: {p.name}"
    r = json.loads(p.read_text(encoding="utf-8"))
    assert r["run_id"] == run_id == r["run"]["scenario_run_id"]
    missing = WIDENED_KEYS - set(r["facts"])
    assert not missing, f"committed {p.name} lacks widened keys: {sorted(missing)}"
    assert r["audit"]["passed"] is True and r["audit"]["log"], "audit block must ride the copy"
    # values-vs-sidecars leg — only on a box that holds the (gitignored) run sidecars
    ts = run_id.replace("multimodal-scenario-", "")
    outcomes_path = RUNS_REAL / f"outcomes-{ts}.json"
    if not outcomes_path.is_file():
        pytest.skip("run sidecars not on this box (contract/runs is gitignored) — shape pin only")
    outcomes = json.loads(outcomes_path.read_text(encoding="utf-8"))
    assert r["facts"]["response_detour"] == outcomes.get("response_detour")
    assert r["facts"]["non_completions_split"] == outcomes.get("non_completions_split")
    assert r["facts"]["window_events"] == outcomes.get("window_events")


def test_committed_example_report_carries_the_per_end_finding():
    """The landing's flagship callouts, pinned to the committed bytes (committed-artifact-SPECIFIC
    values, never non-emptiness): east end +1.7 s / west end +29.1 s / Station 231 origin-closed."""
    r = json.loads((WEB_PUBLIC_REAL / f"{EXAMPLE}-report.json").read_text(encoding="utf-8"))
    rd = r["facts"]["response_detour"]
    closure = next(m for m in rd["members"] if m["type"] == "road_closure")
    east = next(e for e in closure["ends"] if e["label"] == "east end")
    west = next(e for e in closure["ends"] if e["label"] == "west end")

    def worst(end):
        return max(p["added_s"] for p in end["probes"] if p["added_s"] is not None)

    assert worst(east) == 1.7
    assert worst(west) == 29.1
    s231 = next(p for p in east["probes"] if "231" in p["label"])
    assert s231["added_s"] is None
    assert "closed during the window" in s231["note"]
    # the honesty notes ride the payload wherever its numbers go
    for key in ("end_method_note", "probed_members_note", "window_coincidence_note", "origins_note"):
        assert rd.get(key), f"riding note missing from the committed payload: {key}"
