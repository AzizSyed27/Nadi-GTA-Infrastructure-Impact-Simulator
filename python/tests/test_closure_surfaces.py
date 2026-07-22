"""V2.2a — honesty surfaces for windowed closures: clock-time rendering (calibrated t=0 == 07:00),
reactions prose, scorecard access cells/notes, report facts. Pure tests, no SUMO."""

from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "python" / "src"))

from contract_models import Window  # noqa: E402
from demand_profiles import fmt_sim_time, fmt_window  # noqa: E402


def test_fmt_sim_time_calibrated_is_clock_time() -> None:
    assert fmt_sim_time(0.0, "calibrated_am_peak") == "07:00"
    assert fmt_sim_time(600.0, "calibrated_am_peak") == "07:10"
    assert fmt_sim_time(3600.0, "calibrated_am_peak") == "08:00"
    assert fmt_sim_time(4500.0, "calibrated_am_peak") == "08:15"


def test_fmt_sim_time_synthetic_is_sim_seconds() -> None:
    assert fmt_sim_time(600.0, "synthetic_demo") == "t=600 s"
    assert fmt_sim_time(0.0, "synthetic_demo") == "t=0 s"


def test_fmt_window_both_profiles() -> None:
    w = Window(start_s=600.0, end_s=2400.0)
    assert fmt_window(w, "calibrated_am_peak") == "from 07:10 to 07:40"
    assert fmt_window(w, "synthetic_demo") == "from t=600 s to t=2400 s"


# ---------------------------------------------------------------- reactions prose (mechanical)

WINDOW = {"start_s": 600.0, "end_s": 2400.0}


def test_reactions_lane_closure_windowed_calibrated_clock_times() -> None:
    from reactions import _change_line

    ch = {"type": "lane_closure", "target_edge": "E1", "target_lanes": [0, 1], "window": WINDOW}
    line = _change_line(ch, "calibrated_am_peak")
    assert "2" in line and "closed" in line.lower()
    assert "from 07:10 to 07:40" in line
    assert "remaining lane" in line  # the road stays open — mechanical, no asserted benefit
    for banned in ("calmer", "safer", "better"):
        assert banned not in line.lower()


def test_reactions_lane_closure_unwindowed_no_window_clause() -> None:
    from reactions import _change_line

    ch = {"type": "lane_closure", "target_edge": "E1", "target_lanes": [0]}
    line = _change_line(ch, "synthetic_demo")
    assert "closed" in line.lower() and "from" not in line


def test_reactions_road_closure_windowed_synthetic_sim_seconds() -> None:
    from reactions import _change_line

    ch = {"type": "road_closure", "target_edge": "E1", "window": WINDOW}
    line = _change_line(ch, "synthetic_demo")
    assert "fully closed" in line.lower()
    assert "from t=600 s to t=2400 s" in line
    assert "other streets" in line


# ---------------------------------------------------------------- report closure surfaces


def _closure_change(windowed: bool = True, kind: str = "lane_closure"):
    from contract_models import Change

    return Change(
        type=kind, target_edge="E1",
        target_lanes=[0, 1] if kind == "lane_closure" else None,
        window=Window(start_s=600.0, end_s=2400.0) if windowed else None,
        description="Closed 2 of 4 car lanes on edge E1" if kind == "lane_closure" else "Closed edge E1 (all lanes)")


def _closure_artifact(windowed: bool = True, kind: str = "lane_closure"):
    from contract_models import Meta, Scenario, Scorecard, ScorecardCell, ScorecardGroup, TrajectoryArtifact, Vehicle

    meta = Meta(run_id="scen-TEST", network="corridor.net.xml", bbox=[-79.3, 43.7, -79.1, 43.8],
                sim_start=0.0, sim_end=3600.0, step_length=1.0, created_at="2026-07-21T00:00:00+00:00",
                demand_profile="calibrated_am_peak",
                scenario=Scenario(baseline_run_id="base-TEST", changes=[_closure_change(windowed, kind)]))
    groups = [
        ScorecardGroup(group="car_commuter", grounding="sim",
                       travel_time_delta=ScorecardCell(value=4.2, affected_share=0.05, confidence="measured", note="tt"),
                       safety_delta=ScorecardCell(value=6.5, confidence="low", note="safety unstable"),
                       access_delta=ScorecardCell(value=0.5, confidence="low", note="rule-based estimate")),
        ScorecardGroup(group="cyclist", grounding="sim",
                       travel_time_delta=ScorecardCell(value=0.0, affected_share=0.0, confidence="measured", note="tt"),
                       safety_delta=ScorecardCell(value=6.8, confidence="low", note="safety unstable"),
                       access_delta=None),
    ]
    return TrajectoryArtifact(schema_version="0.5.0", meta=meta,
                              vehicles=[Vehicle(id="c1", type="car", path=[[-79.2, 43.75], [-79.2, 43.76]],
                                                timestamps=[0.0, 1.0], speeds=[1.0, 1.0])],
                              scorecard=Scorecard(groups=groups, bca=None))


def _closure_outcomes() -> dict:
    return {
        "scenario_run_id": "scen-TEST", "baseline_run_id": "base-TEST",
        "connectivity_severed_edges": [], "reroute": {"cars_rerouted": 41, "cars_matched": 300},
        "modes": {"car": {"counts": {"total_demand": 300, "baseline_only": 37}},
                  "bicycle": {"counts": {"total_demand": 82, "baseline_only": 2}},
                  "pedestrian": {"counts": {"total_demand": 129, "baseline_only": 0}}},
        "non_completions": {"car": 37, "bicycle": 2, "pedestrian": 0},
        "window_events": [{"change_idx": 0, "type": "lane_closure", "target_edge": "E1",
                           "window": {"start_s": 600.0, "end_s": 2400.0},
                           "applied_t": 600.0, "reverted_t": 2400.0, "restored_ok": True, "note": None}],
    }


def test_report_facts_carry_closure_numbers_and_verify() -> None:
    import report

    art, out = _closure_artifact(), _closure_outcomes()
    facts = report.gather_facts(art, out, verdict=None)
    assert facts["non_completions"] == {"car": 37, "bicycle": 2, "pedestrian": 0}
    assert facts["window_events"][0]["restored_ok"] is True
    report.verify_facts(facts, art, out)  # must not raise


def test_report_fact_check_catches_failed_revert() -> None:
    import pytest as _pytest

    import report

    art, out = _closure_artifact(), _closure_outcomes()
    facts = report.gather_facts(art, out, verdict=None)
    facts["window_events"][0]["restored_ok"] = False
    out["window_events"][0]["restored_ok"] = False  # both views tampered — the guard must still refuse
    with _pytest.raises(AssertionError, match="restored_ok"):
        report.verify_facts(facts, art, out)


def test_report_fact_check_catches_non_completion_mismatch() -> None:
    import pytest as _pytest

    import report

    art, out = _closure_artifact(), _closure_outcomes()
    facts = report.gather_facts(art, out, verdict=None)
    facts["non_completions"] = {"car": 999, "bicycle": 2, "pedestrian": 0}
    with _pytest.raises(AssertionError, match="non_completion"):
        report.verify_facts(facts, art, out)


def test_report_markdown_closure_block_renders_clock_times() -> None:
    import report

    art, out = _closure_artifact(), _closure_outcomes()
    facts = report.gather_facts(art, out, verdict=None)
    glosses = {gid: "gloss" for gid in report.GROUP_ORDER}
    report_meta = {"generated_at": "2026-07-21T00:00:00Z", "provider": "test", "model": "test",
                   "audit_summary": "clean"}
    md = report.render_markdown(facts, "framing", glosses, {}, "intro", report.build_caveats(facts), report_meta)
    assert "07:10" in md and "07:40" in md  # calibrated -> clock times, never bare sim-seconds
    assert "restored" in md  # the window-revert proof line
    assert "completed in baseline but not" in md  # non-completions, first-class
    assert "37 cars" in md
    assert "41" in md  # diverted count


def test_report_caveats_windowed_and_road_closure() -> None:
    import report

    art, out = _closure_artifact(windowed=True), _closure_outcomes()
    facts = report.gather_facts(art, out, verdict=None)
    titles = [c["title"] for c in report.build_caveats(facts)]
    assert any("temporary event" in t.lower() for t in titles)

    art_rc = _closure_artifact(windowed=False, kind="road_closure")
    facts_rc = report.gather_facts(art_rc, out, verdict=None)
    titles_rc = [c["title"] for c in report.build_caveats(facts_rc)]
    assert any("strand" in t.lower() for t in titles_rc)
    assert not any("temporary event" in t.lower() for t in titles_rc)  # unwindowed: no window caveat


def test_report_change_phrase_closure_is_mechanical() -> None:
    import report

    ph = report._change_phrase(_closure_change(windowed=True), "calibrated_am_peak")
    assert "closed" in ph.lower() and "from 07:10 to 07:40" in ph
    for banned in ("calmer", "safer"):
        assert banned not in ph.lower()


# ---------------------------------------------------------------- scorecard access heuristic


def _access_cells(changes: list[dict]) -> dict:
    import scorecard

    sc = scorecard.compute_scorecard({}, [], [], changes)
    return {g.group: g.access_delta for g in sc.groups}


def test_scorecard_lane_closure_car_access_worse_low_confidence() -> None:
    cells = _access_cells([{"type": "lane_closure", "target_edge": "E", "target_lanes": [0]}])
    car = cells["car_commuter"]
    assert car is not None and car.value == 0.5 and car.confidence == "low"
    assert car.note == "rule-based estimate"


def test_scorecard_windowed_lane_closure_note_is_time_scoped() -> None:
    # A 30-minute closure must NOT render the identical cell as a permanent one — the note scopes it.
    cells = _access_cells([{"type": "lane_closure", "target_edge": "E", "target_lanes": [0],
                            "window": WINDOW}])
    car = cells["car_commuter"]
    assert car is not None and car.value == 0.5
    assert car.note == "rule-based estimate; applies during the closure window"


def test_scorecard_road_closure_honest_null_with_note() -> None:
    cells = _access_cells([{"type": "road_closure", "target_edge": "E"}])
    for group in ("car_commuter", "cyclist", "pedestrian", "business_owner"):
        cell = cells[group]
        assert cell is not None and cell.value is None
        assert cell.note == "road severed/closed — access heuristic not meaningful"


def test_scorecard_new_road_note_unchanged() -> None:
    cells = _access_cells([{"type": "new_road", "target_edge": "nr_A_B"}])
    assert cells["car_commuter"].value == -0.5
    assert cells["cyclist"].note == "no access heuristic for this change type yet"


def test_reactions_inferred_context_closure_scopes_by_window() -> None:
    from reactions import _inferred_context

    windowed = [{"type": "road_closure", "target_edge": "E1", "window": WINDOW}]
    permanent = [{"type": "road_closure", "target_edge": "E1"}]
    w_line = _inferred_context("business_owner", windowed)
    p_line = _inferred_context("business_owner", permanent)
    assert "time window" in w_line and "not a permanent" in w_line
    assert "time window" not in p_line
    # non-overridden stakeholders keep the default framing
    assert _inferred_context("taxpayer", windowed).startswith("You are a skeptical taxpayer")
