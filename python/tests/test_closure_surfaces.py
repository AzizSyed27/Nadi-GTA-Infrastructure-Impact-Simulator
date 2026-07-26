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


# ---------------------------------------------------------------- incident surfaces (V2.2b)

INCIDENT_WINDOW = {"start_s": 600.0, "end_s": 1800.0}


def _incident_dict(blocked: bool = True, speed_factor: float | None = None) -> dict:
    d = {"type": "incident", "target_edge": "E1", "window": INCIDENT_WINDOW,
         "effect": {}}
    if blocked:
        d["target_lanes"] = [1, 2]
        d["effect"]["blocked"] = True
    if speed_factor is not None:
        d["effect"]["speed_factor"] = speed_factor
    return d


def test_reactions_incident_lines_mechanical_and_clocked() -> None:
    from reactions import _change_line

    line = _change_line(_incident_dict(blocked=True), "calibrated_am_peak")
    assert "blocked" in line.lower() and "from 07:10 to 07:30" in line
    assert "temporary incident" in line
    both = _change_line(_incident_dict(blocked=True, speed_factor=0.5), "synthetic_demo")
    assert "blocked" in both.lower() and "50%" in both and "from t=600 s to t=1800 s" in both
    speed = _change_line(_incident_dict(blocked=False, speed_factor=0.5), "calibrated_am_peak")
    assert "slowed" in speed.lower() and "blocked" not in speed.lower()
    for line_ in (line, both, speed):
        for banned in ("crash", "collision", "accident", "calmer", "safer"):
            assert banned not in line_.lower()


def test_reactions_inferred_context_incident_temporary_framing() -> None:
    from reactions import _inferred_context

    line = _inferred_context("business_owner", [_incident_dict()])
    assert "incident" in line.lower() and "not a permanent" in line
    # closure strings byte-identical (regression)
    closure_line = _inferred_context("business_owner",
                                     [{"type": "road_closure", "target_edge": "E1", "window": WINDOW}])
    assert "time window" in closure_line and "incident" not in closure_line.lower()


def test_scorecard_incident_honest_null_all_groups() -> None:
    cells = _access_cells([_incident_dict()])
    for group in ("car_commuter", "cyclist", "pedestrian", "business_owner"):
        cell = cells[group]
        assert cell is not None and cell.value is None
        assert cell.note == "temporary incident — access heuristic not meaningful"


def test_report_change_phrase_incident_capacity_wording() -> None:
    import report
    from contract_models import Change, Effect, Window as W

    ch = Change(type="incident", target_edge="E1", target_lanes=[1, 2],
                window=W(start_s=600.0, end_s=1800.0), effect=Effect(blocked=True),
                description="d")
    ph = report._change_phrase(ch, "calibrated_am_peak")
    assert "blocked" in ph.lower() and "capacity" in ph.lower() and "incident" in ph.lower()
    assert "from 07:10 to 07:30" in ph
    for banned in ("crash", "collision", "accident"):
        assert banned not in ph.lower()


def _detour_payload() -> dict:
    import response_probe as rp

    return {"framing": rp.FRAMING, "lower_bound_note": rp.LOWER_BOUND_NOTE,
            "origins_note": "probe origins are Toronto Fire Services station locations (Toronto "
                            "Open Data, retrieved 2026-07-25); routes are computed from every "
                            "station and do not indicate which station would respond",
            "destination_edge": "D1", "destination_note": "first outgoing ... junction",
            "probes": [
                {"label": "Markham entry", "origin_edge": "O1", "baseline_s": 57.0,
                 "scenario_s": 105.7, "added_s": 48.7},
                {"label": "Ellesmere entry", "origin_edge": "O2", "baseline_s": 415.4,
                 "scenario_s": None, "added_s": None,
                 "note": "destination unreachable from this origin during the window"},
            ]}


def test_report_response_access_block_renders_with_both_sentences() -> None:
    import report
    import response_probe as rp

    art, out = _closure_artifact(), _closure_outcomes()
    out["response_detour"] = _detour_payload()
    facts = report.gather_facts(art, out, verdict=None)
    report.verify_facts(facts, art, out)  # consistent payload passes
    glosses = {gid: "gloss" for gid in report.GROUP_ORDER}
    meta = {"generated_at": "x", "provider": "t", "model": "t", "audit_summary": "clean"}
    md = report.render_markdown(facts, "framing", glosses, {}, "intro", report.build_caveats(facts), meta)
    assert "Response access" in md
    assert "+48.7" in md and "Markham entry" in md
    assert "unreachable" in md  # the note renders, never silence
    assert rp.FRAMING in md and rp.LOWER_BOUND_NOTE in md
    # the dispatch-misreading guard renders wherever station names do
    assert "do not indicate which station would respond" in md


def test_report_response_access_uncomputable_is_labeled_not_silent() -> None:
    # destination_edge None -> probes [] must render the destination_note as a labeled absence
    # (the labeled-degradation rule), never a floating disclaimer with no explanation.
    import report
    import response_probe as rp

    art, out = _closure_artifact(), _closure_outcomes()
    out["response_detour"] = {
        "framing": rp.FRAMING, "lower_bound_note": rp.LOWER_BOUND_NOTE,
        "destination_edge": None,
        "destination_note": "dead-end downstream of the changed road — detour not computable",
        "probes": []}
    facts = report.gather_facts(art, out, verdict=None)
    report.verify_facts(facts, art, out)
    glosses = {gid: "gloss" for gid in report.GROUP_ORDER}
    meta = {"generated_at": "x", "provider": "t", "model": "t", "audit_summary": "clean"}
    md = report.render_markdown(facts, "framing", glosses, {}, "intro", report.build_caveats(facts), meta)
    assert "detour not computable" in md  # the labeled reason renders
    assert "Response access" in md


def test_report_verify_catches_doctored_detour_and_missing_framing() -> None:
    import pytest as _pytest

    import report

    art, out = _closure_artifact(), _closure_outcomes()
    out["response_detour"] = _detour_payload()
    facts = report.gather_facts(art, out, verdict=None)
    facts["response_detour"]["probes"][0]["added_s"] = 3.0  # doctored
    with _pytest.raises(AssertionError, match="added_s"):
        report.verify_facts(facts, art, out)

    out2 = _closure_outcomes()
    out2["response_detour"] = _detour_payload()
    out2["response_detour"]["framing"] = "totally reliable dispatch prediction"
    facts2 = report.gather_facts(art, out2, verdict=None)
    with _pytest.raises(AssertionError, match="framing"):
        report.verify_facts(facts2, art, out2)


def test_report_caveat_covers_incident_and_speed_only_gets_no_noncompletion_claim() -> None:
    import report
    from contract_models import Change, Effect, Meta, Scenario, Scorecard, ScorecardCell, ScorecardGroup, TrajectoryArtifact, Vehicle
    from contract_models import Window as W

    ch = Change(type="incident", target_edge="E1", window=W(start_s=600.0, end_s=1800.0),
                effect=Effect(speed_factor=0.5), description="Reduced speed to 50% on edge E1 (incident)")
    meta = Meta(run_id="scen-TEST", network="n", bbox=[-79.3, 43.7, -79.1, 43.8], sim_start=0.0,
                sim_end=3600.0, step_length=1.0, created_at="2026-07-22T00:00:00+00:00",
                demand_profile="calibrated_am_peak",
                scenario=Scenario(baseline_run_id="base-TEST", changes=[ch]))
    groups = [ScorecardGroup(group="car_commuter", grounding="sim",
                             travel_time_delta=ScorecardCell(value=1.0, affected_share=0.01,
                                                             confidence="measured", note="tt"),
                             safety_delta=None, access_delta=None)]
    art = TrajectoryArtifact(schema_version="0.5.0", meta=meta,
                             vehicles=[Vehicle(id="c1", type="car", path=[[-79.2, 43.75], [-79.2, 43.76]],
                                               timestamps=[0.0, 1.0], speeds=[1.0, 1.0])],
                             scorecard=Scorecard(groups=groups, bca=None))
    out = _closure_outcomes()
    del out["non_completions"]  # speed-only: the harness writes no non_completions key
    facts = report.gather_facts(art, out, verdict=None)
    titles = [c["title"] for c in report.build_caveats(facts)]
    assert any("temporary event" in t.lower() for t in titles)
    assert facts["non_completions"] is None  # never invented for speed-only incidents


# ---------------------------------------------------------------- non-completions split (V2.2c prelim B)


def _write_tripinfo(path, veh_ids: list[str], ped_ids: list[str]) -> None:
    rows = [f'  <tripinfo id="{v}" depart="0" arrival="100" duration="100" timeLoss="10"/>' for v in veh_ids]
    rows += [f'  <personinfo id="{p}" depart="0">\n'
             f'    <walk depart="0" arrival="60" duration="60" timeLoss="5"/>\n'
             f'  </personinfo>' for p in ped_ids]
    path.write_text("<tripinfos>\n" + "\n".join(rows) + "\n</tripinfos>\n", encoding="utf-8")


def test_non_completions_split_partitions_by_departure(tmp_path) -> None:
    import scenario_harness as sh

    base = tmp_path / "base.xml"
    scen = tmp_path / "scen.xml"
    _write_tripinfo(base, ["veh1", "veh2", "veh3", "bike1"], ["ped1"])
    _write_tripinfo(scen, ["veh1"], [])
    # baseline_only: cars {veh2, veh3}, bikes {bike1}, peds {ped1}
    departed = {"veh2", "bike1"}  # entered the scenario network but never finished
    split = sh.non_completions_split(base, scen, departed)
    assert split["car"] == {"entered_not_finished": 1, "not_inserted": 1}
    assert split["bicycle"] == {"entered_not_finished": 1, "not_inserted": 0}
    assert split["pedestrian"] == {"entered_not_finished": 0, "not_inserted": 1}


def test_departed_mode_counts_by_prefix() -> None:
    import scenario_harness as sh

    counts = sh.departed_mode_counts({"veh1", "veh2", "bike7", "ped3", "ped4", "ped5"})
    assert counts == {"car": 2, "bicycle": 1, "pedestrian": 3}


def _split_outcomes() -> dict:
    out = _closure_outcomes()
    out["non_completions_split"] = {
        "car": {"entered_not_finished": 30, "not_inserted": 7},
        "bicycle": {"entered_not_finished": 2, "not_inserted": 0},
        "pedestrian": {"entered_not_finished": 0, "not_inserted": 0},
    }
    out["insertion_backlog"] = {
        "car": {"baseline": 4100, "scenario": 4180},
        "bicycle": {"baseline": 3, "scenario": 3},
        "pedestrian": {"baseline": 12, "scenario": 12},
    }
    return out


def test_report_split_sentence_is_causally_neutral_with_backlog_parenthetical() -> None:
    # USER-CONFIRMED INVARIANT: the split may NEVER render without the attribution parenthetical —
    # not_inserted includes structural insertion backlog the closure did not cause.
    import report

    art, out = _closure_artifact(), _split_outcomes()
    facts = report.gather_facts(art, out, verdict=None)
    report.verify_facts(facts, art, out)
    glosses = {gid: "gloss" for gid in report.GROUP_ORDER}
    meta = {"generated_at": "x", "provider": "t", "model": "t", "audit_summary": "clean"}
    md = report.render_markdown(facts, "framing", glosses, {}, "intro", report.build_caveats(facts), meta)
    assert "Of the 37 cars: 30 entered the network and could not finish; 7 did not enter the network" in md
    assert "insertion backlog affects baseline runs too" in md
    assert "4100 vehicles had not entered by the baseline run's end vs 4180 in this run" in md
    # bicycle sub-bullet renders too (nonzero); pedestrian (all-zero) does not
    assert "Of the 2 bicycles" in md


def test_report_split_back_compat_no_split_renders_as_today() -> None:
    import report

    art, out = _closure_artifact(), _closure_outcomes()  # no split keys (a pre-c sidecar)
    facts = report.gather_facts(art, out, verdict=None)
    report.verify_facts(facts, art, out)
    glosses = {gid: "gloss" for gid in report.GROUP_ORDER}
    meta = {"generated_at": "x", "provider": "t", "model": "t", "audit_summary": "clean"}
    md = report.render_markdown(facts, "framing", glosses, {}, "intro", report.build_caveats(facts), meta)
    assert "Non-completions under the closure" in md
    assert "entered the network and could not finish" not in md  # no invented split


def test_report_verify_rejects_non_summing_split_and_doctored_backlog() -> None:
    import pytest as _pytest

    import report

    art = _closure_artifact()
    out = _split_outcomes()
    facts = report.gather_facts(art, out, verdict=None)
    facts["non_completions_split"]["car"]["not_inserted"] = 99  # 30+99 != 37
    with _pytest.raises(AssertionError, match="split"):
        report.verify_facts(facts, art, out)

    out2 = _split_outcomes()
    facts2 = report.gather_facts(art, out2, verdict=None)
    # replace (not mutate) — facts share the sidecar dict by reference (the gather_facts
    # convention); the threat modeled is a rendering-layer copy diverging from its source.
    facts2["insertion_backlog"] = {**facts2["insertion_backlog"],
                                   "car": {"baseline": 1, "scenario": 4180}}
    with _pytest.raises(AssertionError, match="backlog"):
        report.verify_facts(facts2, art, out2)


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
