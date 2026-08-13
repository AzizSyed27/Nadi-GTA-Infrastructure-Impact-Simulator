"""Tests for the Phase-3.1 report generator's HONESTY MECHANICS (no LLM / network needed).

The report's credibility rests on two deterministic guards; these lock them in:
  * the POST-GENERATION AUDIT (`audit_prose`) — catches digits / safety-direction / tally / crash words in
    LLM prose, and lets qualitative texture through;
  * the CODE-RENDERED FACT CHECK (`verify_facts`) — catches OUR OWN number-rendering bugs (a sign flip or
    miscount the prose audit can't see), plus the ± safety render and the cross-seed-verdict run/change guard.

Run:  python -m pytest python/tests/test_report.py -v
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "python" / "src"))
import report  # noqa: E402
from contract_models import (  # noqa: E402
    Agent, Change, Citation, Mandate, Meta, Persona, Reaction, Scenario, Scorecard, ScorecardCell,
    ScorecardGroup, TrajectoryArtifact, Vehicle,
)

RUNS_DIR = REPO_ROOT / "contract" / "runs"


# --------------------------------------------------------------------------------------------------
# Audit rules — each catches its violation; qualitative texture passes clean.
# --------------------------------------------------------------------------------------------------

def _rules(text: str) -> set[str]:
    return {r for r, _ in report.audit_prose(text)}


def test_audit_catches_digits():
    assert "digits" in _rules("The delay is about 30 seconds for some drivers.")
    assert not report.audit_prose("Most drivers are unaffected, but a small group is markedly slower.")


def test_audit_catches_safety_direction():
    assert "safety_direction" in _rules("The change made the street safer for everyone.")
    assert "safety_direction" in _rules("Conflicts increased sharply at the junction.")
    assert "safety_direction" in _rules("The change reduced collisions along the block.")
    # qualitative concern with no direction claim is clean
    assert not _rules("Some drivers worry about losing a lane near the school.")
    # NOT a false positive: the direction word modifies ACCESS, not the (co-mentioned) safety signal
    assert not _rules("A safety signal exists but its direction is uncertain, while access is slightly improved.")
    assert not _rules("Business owners show no measurable safety signal, but access is slightly worse.")


def test_audit_catches_tally_but_allows_texture():
    assert "tally" in _rules("The majority oppose the change.")
    assert "tally" in _rules("A referendum would settle whether to build it.")
    assert "tally" in _rules("There was overwhelming support from residents.")
    # describing the RANGE of reactions qualitatively is section 3's whole job — must stay clean
    assert not _rules("Some residents welcome calmer streets, while others are wary of losing a lane.")
    assert not _rules("A recurring hope is that the corridor becomes more inviting; some remain skeptical.")


def test_audit_catches_crash_words_but_allows_disclaimer():
    assert "crash" in _rules("This change will cause more accidents on the corridor.")
    # a pure disclaimer that names what it refuses to claim is allowlisted — including a
    # MULTI-OBJECT one (the clause-bounded strip must keep the whole disclaimer clause together)
    assert not _rules("This tool cannot predict crashes or their probability.")


def test_audit_allow_clause_cannot_smuggle_a_real_claim():
    """V2.3b review-caught, hoisted from the interview guard: the _ALLOW skip is clause-bounded,
    not whole-sentence — a compound sentence pairing a licensed disclaimer with a REAL claim must
    still trip on the claim's clause."""
    assert "tally" in _rules("I can't give a verdict, but the majority supports this.")
    assert "crash" in _rules("I can't predict the future, but there would be fewer collisions here.")
    # the disclaimer clause itself stays licensed
    assert not _rules("This isn't a verdict; it is one corridor preview.")


def test_audit_cascade_allow_clause_cannot_smuggle_a_tally():
    rules = {r for r, _ in report.audit_prose_cascade("I can't give a verdict, but most agents vote yes.")}
    assert "tally" in rules
    # and the persona-calibrated variant keeps licensing a pure disclaimer
    assert not report.audit_prose_cascade("I can't predict crashes, that's not my place.")


# --------------------------------------------------------------------------------------------------
# Cell rendering — ± magnitude for safety, signed for travel/access, POSITIVE = worse.
# --------------------------------------------------------------------------------------------------

def _cell(value, share=None, conf="low"):
    return ScorecardCell(value=value, affected_share=share, confidence=conf, note="n")


def test_safety_renders_as_magnitude_no_direction():
    s = report.render_cell(_cell(6.579), "safety")
    assert s == "±6.58 [LOW]"
    assert "+" not in s and "-" not in s and "−" not in s  # never a direction
    assert report.render_cell(None, "safety") == "—"


def test_travel_and_access_render_signed():
    assert report.render_cell(_cell(0.0, share=0.033, conf="measured"), "travel") == "+0.0s, 3.3% >30s [MEAS]"
    assert report.render_cell(_cell(0.5), "access") == "+0.50 [LOW]"        # POSITIVE = worse
    assert report.render_cell(_cell(-1.0), "access") == "-1.00 [LOW]"       # negative = better (ASCII minus in .md)


def test_sparse_gloss_never_denies_a_magnitude_the_table_shows():
    # A safety-only group (like local_resident, safety ±7.35) must NOT be glossed as "no signal" — the LLM
    # sometimes did; the deterministic gloss acknowledges the magnitude and refuses only the direction.
    safety_only = ScorecardGroup(group="local_resident", grounding="inferred", travel_time_delta=None,
                                 safety_delta=ScorecardCell(value=7.35, confidence="low", note="unstable"),
                                 access_delta=None)
    g = report._deterministic_gloss(safety_only, "Local residents")
    assert "magnitude is present" in g and "direction is not" in g
    assert "no measurable" not in g.lower() and "no signal" not in g.lower()

    access_only = ScorecardGroup(group="business_owner", grounding="inferred", travel_time_delta=None,
                                 safety_delta=None, access_delta=ScorecardCell(value=0.5, confidence="low", note="est"))
    assert "slightly worse" in report._deterministic_gloss(access_only, "Business owners")  # +0.5 = worse

    empty = ScorecardGroup(group="accessibility", grounding="inferred")
    assert "enough measurable signal" in report._deterministic_gloss(empty, "Accessibility")


def test_valence_resolves_direction_so_the_gloss_cannot_invert_it():
    assert "worse" in report.cell_valence(_cell(0.5), "access")             # +0.5 access = worse
    assert "better" in report.cell_valence(_cell(-1.0), "access")           # -1.0 access = better
    assert "direction is not claimed" in report.cell_valence(_cell(7.35), "safety")
    assert report.cell_valence(None, "access") == "no measurable signal"
    tail = report.cell_valence(_cell(0.0, share=0.033, conf="measured"), "travel")
    assert "small group is markedly slower" in tail


# --------------------------------------------------------------------------------------------------
# A fixture artifact + outcomes (hermetic — no run on disk needed).
# --------------------------------------------------------------------------------------------------

def _artifact() -> TrajectoryArtifact:
    change = Change(type="bike_lane", target_edge="E1", target_lane=1, value_mps=None,
                    description="Converted a car lane to a bike lane")
    meta = Meta(run_id="scen-TEST", network="corridor.net.xml", bbox=[-79.3, 43.7, -79.1, 43.8],
                sim_start=0.0, sim_end=100.0, step_length=1.0, created_at="2026-07-04T00:00:00+00:00",
                scenario=Scenario(baseline_run_id="base-TEST", change=change))
    groups = [
        ScorecardGroup(group="car_commuter", grounding="sim",
                       travel_time_delta=ScorecardCell(value=0.0, affected_share=0.033, confidence="measured", note="tt"),
                       safety_delta=ScorecardCell(value=6.5, confidence="low", note="safety unstable"),
                       access_delta=ScorecardCell(value=0.33, confidence="low", note="est")),
        ScorecardGroup(group="cyclist", grounding="sim",
                       travel_time_delta=ScorecardCell(value=0.0, affected_share=0.0, confidence="measured", note="tt"),
                       safety_delta=ScorecardCell(value=6.8, confidence="low", note="safety unstable"),
                       access_delta=ScorecardCell(value=-1.0, confidence="low", note="est")),
    ]
    return TrajectoryArtifact(schema_version="0.3.0", meta=meta,
                              vehicles=[Vehicle(id="c1", type="car", path=[[-79.2, 43.75], [-79.2, 43.76]],
                                                timestamps=[0.0, 1.0], speeds=[1.0, 1.0])],
                              scorecard=Scorecard(groups=groups, bca=None))


def _outcomes() -> dict:
    return {
        "scenario_run_id": "scen-TEST", "baseline_run_id": "base-TEST",
        "connectivity_severed_edges": [], "reroute": {"cars_rerouted": 0, "cars_matched": 300},
        "modes": {m: {"counts": {"total_demand": d}} for m, d in
                  (("car", 300), ("bicycle", 82), ("pedestrian", 129))},
    }


def test_verify_facts_passes_on_consistent_render():
    art, out = _artifact(), _outcomes()
    facts = report.gather_facts(art, out, verdict=None)
    report.verify_facts(facts, art, out)  # must not raise
    assert facts["demand"] == {"car": 300, "bicycle": 82, "pedestrian": 129}
    assert facts["tail_share_pct"] == 3.3


def test_fact_check_catches_a_miscounted_number():
    art, out = _artifact(), _outcomes()
    facts = report.gather_facts(art, out, verdict=None)
    facts["demand"]["car"] = 301  # a rendering bug the PROSE audit could never see
    with pytest.raises(AssertionError, match="demand"):
        report.verify_facts(facts, art, out)


def test_fact_check_catches_a_flipped_tail_share():
    art, out = _artifact(), _outcomes()
    facts = report.gather_facts(art, out, verdict=None)
    facts["tail_share_pct"] = 33.0  # decimal slip (×10)
    with pytest.raises(AssertionError, match="tail_share_pct"):
        report.verify_facts(facts, art, out)


# --------------------------------------------------------------------------------------------------
# Cross-seed verdict guard — only trusted when run_id AND change match this artifact.
# --------------------------------------------------------------------------------------------------

def test_verdict_guard_rejects_a_mismatched_run(tmp_path, monkeypatch):
    art = _artifact()
    # point report at a temp runs dir and write a verdict for a DIFFERENT run/change
    monkeypatch.setattr(report, "RUNS_DIR", tmp_path)
    (tmp_path / "robustness-verdict-TS.json").write_text(json.dumps({
        "scenario_run_id": "some-other-run", "target_edge": "E9",
        "car_tail": {"range_gt30": [0.02, 0.03]},
    }), encoding="utf-8")
    assert report._load_verdict("TS", art) is None  # mismatch → qualitative fallback

    # a MATCHING verdict is accepted
    (tmp_path / "robustness-verdict-OK.json").write_text(json.dumps({
        "scenario_run_id": "scen-TEST", "target_edge": "E1",
        "car_tail": {"range_gt30": [0.023, 0.033], "seeds": [42, 43, 44]},
    }), encoding="utf-8")
    got = report._load_verdict("OK", art)
    assert got is not None and got["range_gt30"] == [0.023, 0.033]


# --------------------------------------------------------------------------------------------------
# V2.2d — the school-zone block: facts flow, fact-check guards, and the code-rendered pair with its
# ALWAYS-present variation sentence (the pair bypasses the scorecard's robustness machinery).
# --------------------------------------------------------------------------------------------------

def _zone_artifact() -> TrajectoryArtifact:
    import zone_lens
    from contract_models import Window
    changes = [Change(type="speed_limit", target_edge=e, value_mps=8.33,
                      window=Window(start_s=600.0, end_s=1200.0),
                      description=f"school-zone limit on {e}") for e in ("E1", "E2", "E3")]
    meta = Meta(run_id="scen-ZONE", network="corridor.net.xml", bbox=[-79.3, 43.7, -79.1, 43.8],
                sim_start=0.0, sim_end=100.0, step_length=1.0, created_at="2026-07-26T00:00:00+00:00",
                demand_profile="synthetic_demo",
                scenario=Scenario(baseline_run_id="base-ZONE", changes=changes, tags=["school_zone"]))
    art = _artifact()
    return TrajectoryArtifact(schema_version="0.8.0", meta=meta, vehicles=art.vehicles,
                              scorecard=art.scorecard)


def _zone_outcomes() -> dict:
    import zone_lens
    out = _outcomes()
    out["scenario_run_id"], out["baseline_run_id"] = "scen-ZONE", "base-ZONE"
    out["zone_facts"] = {
        "tag": "school_zone", "zone_edges": ["E1", "E2", "E3"], "n_edges": 3,
        "window": {"start_s": 600.0, "end_s": 1200.0},
        "ped_vehicle_conflicts": {"baseline": 4, "scenario": 7},
        "method_note": zone_lens.method_note(),
        "variation_note": zone_lens.VARIATION_NOTE,
        "population_note": zone_lens.population_note("synthetic_demo"),
    }
    return out


def test_zone_facts_flow_and_verify_pass():
    art, out = _zone_artifact(), _zone_outcomes()
    facts = report.gather_facts(art, out, verdict=None)
    assert facts["tags"] == ["school_zone"]
    assert facts["zone_facts"] == out["zone_facts"]
    report.verify_facts(facts, art, out)  # must not raise


def test_fact_check_catches_a_mutated_zone_count():
    art, out = _zone_artifact(), _zone_outcomes()
    facts = report.gather_facts(art, out, verdict=None)
    facts["zone_facts"] = dict(facts["zone_facts"])
    facts["zone_facts"]["ped_vehicle_conflicts"] = {"baseline": 4, "scenario": 8}  # doctored
    with pytest.raises(AssertionError, match="zone_facts"):
        report.verify_facts(facts, art, out)


def test_fact_check_requires_the_variation_note_verbatim():
    # the pair may NEVER render without its run-to-run-variation caveat (fold-1 lock)
    art, out = _zone_artifact(), _zone_outcomes()
    out["zone_facts"] = dict(out["zone_facts"])
    out["zone_facts"]["variation_note"] = "counts vary a bit"  # weakened wording
    facts = report.gather_facts(art, out, verdict=None)
    with pytest.raises(AssertionError, match="variation"):
        report.verify_facts(facts, art, out)


def test_zone_block_renders_pair_with_adjacent_variation_sentence():
    import zone_lens
    art, out = _zone_artifact(), _zone_outcomes()
    facts = report.gather_facts(art, out, verdict=None)
    lines = report.render_zone_block(facts)
    joined = "\n".join(lines)
    # the code-rendered pair, no valence anywhere in the block
    assert "**7**" in joined and "**4**" in joined
    assert "not crash prediction" in joined
    for banned in ("increase", "reduce", "safer", "improve", "worsen"):
        assert banned not in joined.lower()
    # the variation sentence is IMMEDIATELY adjacent to the pair line (same-breath rule)
    pair_i = next(i for i, ln in enumerate(lines) if "**7**" in ln)
    assert zone_lens.VARIATION_NOTE in lines[pair_i + 1]
    # the population lock renders verbatim
    assert "not modeled schoolchildren" in joined
    assert report.render_zone_block({"zone_facts": None}) == []


def test_zone_caveats_carry_population_and_variation():
    art, out = _zone_artifact(), _zone_outcomes()
    facts = report.gather_facts(art, out, verdict=None)
    caveats = report.build_caveats(facts)
    text = " ".join(c["body"] for c in caveats)
    assert "not modeled schoolchildren" in text
    assert "run-to-run variation" in text


# --------------------------------------------------------------------------------------------------
# V2.2 closeout — the windowed-scope disclosure: scorecard measures are RUN-scoped; when any change
# is windowed the report must say BOTH scopes out loud (and say nothing at all when none is —
# byte-identity is pinned by test_report_golden.py).
# --------------------------------------------------------------------------------------------------

def _win_change(start=600.0, end=1200.0):
    from contract_models import Window
    return Change(type="lane_closure", target_edge="E1", target_lanes=[1],
                  window=Window(start_s=start, end_s=end), description="Closed 1 lane on E1")


def _win_artifact(changes, sim_end=1800.0, profile="synthetic_demo") -> TrajectoryArtifact:
    meta = Meta(run_id="scen-WIN", network="corridor.net.xml", bbox=[-79.3, 43.7, -79.1, 43.8],
                sim_start=0.0, sim_end=sim_end, step_length=1.0, created_at="2026-07-27T00:00:00+00:00",
                demand_profile=profile,
                scenario=Scenario(baseline_run_id="base-WIN", changes=changes))
    art = _artifact()
    return TrajectoryArtifact(schema_version="0.8.0", meta=meta, vehicles=art.vehicles,
                              scorecard=art.scorecard)


def _win_outcomes() -> dict:
    out = _outcomes()
    out["scenario_run_id"], out["baseline_run_id"] = "scen-WIN", "base-WIN"
    return out


def test_scope_disclosure_windowed_closure_both_profiles():
    # synthetic: sim-seconds; interior window → both dilution flanks
    got = report.build_scope_disclosure([_win_change()], 1800.0, "synthetic_demo")
    assert got == ("Scorecard measures cover the full simulated period (t=0 s–t=1800 s); "
                   "the change was active from t=600 s to t=1200 s of it. Effects during the "
                   "active window are diluted by the periods before and after it.")
    # calibrated: clock times (t=0 == 07:00) — the exemplar's shape, window end == sim ceiling,
    # so the dilution names ONLY the period before it (there is no 'after')
    got = report.build_scope_disclosure([_win_change(3600.0, 7200.0)], 7200.0, "calibrated_am_peak")
    assert got == ("Scorecard measures cover the full simulated period (07:00–09:00); "
                   "the change was active from 08:00 to 09:00 of it. Effects during the "
                   "active window are diluted by the period before it.")
    assert "after" not in got  # never claims a post-window period that doesn't exist


def test_scope_disclosure_flank_wording_start_zero_and_full_run():
    # window starts at t=0 → only the period AFTER dilutes
    got = report.build_scope_disclosure([_win_change(0.0, 1200.0)], 1800.0, "synthetic_demo")
    assert got.endswith("diluted by the period after it.")
    assert "before" not in got
    # window IS the full period → nothing dilutes; no dilution sentence at all
    got = report.build_scope_disclosure([_win_change(0.0, 1800.0)], 1800.0, "synthetic_demo")
    assert got == ("Scorecard measures cover the full simulated period (t=0 s–t=1800 s); "
                   "the change was active from t=0 s to t=1800 s of it.")


def test_scope_disclosure_differing_windows_use_spanning_window_and_say_so():
    import zone_lens
    from contract_models import Window
    changes = [_win_change(600.0, 1200.0),
               Change(type="speed_limit", target_edge="E2", value_mps=8.33,
                      window=Window(start_s=900.0, end_s=1500.0),
                      description="30 km/h on E2")]
    got = report.build_scope_disclosure(changes, 1800.0, "synthetic_demo")
    assert got == ("Scorecard measures cover the full simulated period (t=0 s–t=1800 s); "
                   "the changes were active from t=600 s to t=1500 s of it "
                   f"({zone_lens.span_note('these figures')}). Effects during the "
                   "active window are diluted by the periods before and after it.")
    # single source: the span phrasing is zone_lens's, applied to a different subject
    assert "members carry differing windows; these figures use the spanning window" in got


def test_scope_disclosure_mixed_types_differing_windows_the_acceptance_shape():
    # V2.4b acceptance shape: road_closure 600-1200 + speed_limit 900-1500 + factor-only incident
    # 600-1800 — all windowed, windows DIFFER → spanning window + the span note, subject "the
    # changes were"; span end == sim ceiling so only the before-flank dilutes.
    import zone_lens
    from contract_models import Effect, Window
    changes = [Change(type="road_closure", target_edge="E1",
                      window=Window(start_s=600.0, end_s=1200.0), description="closed E1"),
               Change(type="speed_limit", target_edge="E2", value_mps=8.33,
                      window=Window(start_s=900.0, end_s=1500.0), description="30 km/h on E2"),
               Change(type="incident", target_edge="E3",
                      window=Window(start_s=600.0, end_s=1800.0),
                      effect=Effect(speed_factor=0.5), description="incident on E3")]
    got = report.build_scope_disclosure(changes, 1800.0, "synthetic_demo")
    assert got == ("Scorecard measures cover the full simulated period (t=0 s–t=1800 s); "
                   "the changes were active from t=600 s to t=1800 s of it "
                   f"({zone_lens.span_note('these figures')}). Effects during the "
                   "active window are diluted by the period before it.")


def test_scope_disclosure_mixed_set_never_claims_the_permanent_member_was_temporary():
    # fixture-only today (no palette composes windowed + unwindowed members), but the future
    # multi-change closure flow (BACKLOG) will make it reachable — THIS TEST is what keeps the
    # sentence correct until then: only the WINDOWED member is described as time-scoped.
    changes = [_win_change(600.0, 1200.0),
               Change(type="speed_limit", target_edge="E2", value_mps=8.33,
                      description="40 km/h on E2")]  # permanent member
    got = report.build_scope_disclosure(changes, 1800.0, "synthetic_demo")
    assert got == ("Scorecard measures cover the full simulated period (t=0 s–t=1800 s); "
                   "the windowed change was active from t=600 s to t=1200 s of it. Effects during "
                   "the active window are diluted by the periods before and after it.")
    # the span covers WINDOWED members only — the permanent member never narrows or widens it
    assert "t=600 s to t=1200 s" in got


def test_scope_disclosure_clamps_display_to_the_simulated_period():
    # a window may legally END past the sim ceiling (the scheduler discloses "never reverted") —
    # the sentence must never claim activity outside the period it just defined (review-caught:
    # verify_facts recomputes via the same function, so an unclamped contradiction ships silently)
    got = report.build_scope_disclosure([_win_change(600.0, 2000.0)], 1800.0, "synthetic_demo")
    assert got == ("Scorecard measures cover the full simulated period (t=0 s–t=1800 s); "
                   "the change was active from t=600 s to t=1800 s of it. Effects during the "
                   "active window are diluted by the period before it.")
    assert "t=2000" not in got


def test_scope_disclosure_disjoint_windows_name_the_dead_time():
    """V2.5a: disjoint member windows make the span absorb dead time — worst at the exact
    understatement shape ([0,300]+[1500,1800] on 1800 s: the clamped span covers the whole run,
    the dilution sentence is SUPPRESSED, and the line read as 'active the entire run'). The
    clause rides inside the differing parenthetical, after the pinned span_note substring."""
    import zone_lens
    got = report.build_scope_disclosure([_win_change(0.0, 300.0), _win_change(1500.0, 1800.0)],
                                        1800.0, "synthetic_demo")
    assert got == ("Scorecard measures cover the full simulated period (t=0 s–t=1800 s); "
                   "the changes were active from t=0 s to t=1800 s of it "
                   "(members carry differing windows; these figures use the spanning window; "
                   "the spanning window includes periods where no change was active).")
    # interior disjoint pair: the clause and the dilution sentence coexist
    got2 = report.build_scope_disclosure([_win_change(300.0, 600.0), _win_change(1200.0, 1500.0)],
                                         1800.0, "synthetic_demo")
    assert zone_lens.DISJOINT_SPAN_CLAUSE in got2
    assert "diluted by the periods before and after it" in got2


def test_scope_disclosure_disjoint_clause_suppressed_by_a_permanent_member():
    # a permanent member fills the gap — "no change was active" would be FALSE there; the
    # differing parenthetical still renders and the mixed-set subject rule is untouched
    import zone_lens
    perm = Change(type="speed_limit", target_edge="E2", value_mps=8.33, description="permanent")
    got = report.build_scope_disclosure(
        [_win_change(0.0, 300.0), _win_change(1500.0, 1800.0), perm], 1800.0, "synthetic_demo")
    assert f"({zone_lens.span_note('these figures')})" in got
    assert zone_lens.DISJOINT_SPAN_CLAUSE not in got
    assert "the windowed changes were" in got


def test_fact_check_catches_a_stripped_disjoint_clause():
    # the scope_disclosure equality recompute covers the clause automatically — prove it
    import zone_lens
    art = _win_artifact([_win_change(0.0, 300.0), _win_change(1500.0, 1800.0)])
    out = _win_outcomes()
    facts = report.gather_facts(art, out, verdict=None)
    assert zone_lens.DISJOINT_SPAN_CLAUSE in facts["scope_disclosure"]
    facts["scope_disclosure"] = facts["scope_disclosure"].replace(
        f"; {zone_lens.DISJOINT_SPAN_CLAUSE}", "")
    with pytest.raises(AssertionError, match="scope_disclosure"):
        report.verify_facts(facts, art, out)


def test_scope_disclosure_absent_for_unwindowed_runs():
    change = Change(type="speed_limit", target_edge="E1", value_mps=11.11, description="40 km/h")
    assert report.build_scope_disclosure([change], 1800.0, "synthetic_demo") is None


def test_scope_disclosure_renders_adjacent_to_scorecard_and_joins_caveats():
    art, out = _win_artifact([_win_change()]), _win_outcomes()
    facts = report.gather_facts(art, out, verdict=None)
    assert facts["scope_disclosure"] is not None
    report.verify_facts(facts, art, out)  # present-and-verbatim passes
    glosses = {gid: "Stub." for gid in report.GROUP_ORDER}
    caveats = report.build_caveats(facts)
    md = report.render_markdown(facts, "Stub framing.", glosses, {}, "Stub intro.", caveats,
                                {"generated_at": "x", "provider": "p", "model": "m", "audit_summary": "a"})
    lines = md.split("\n")
    legend_i = next(i for i, ln in enumerate(lines) if ln.startswith("*POSITIVE = worse"))
    # the scope line sits ADJACENT to the scorecard legend (same-breath rule, like the zone pair)
    assert lines[legend_i + 2] == f"*{facts['scope_disclosure']}*"
    assert any(c["title"] == "A windowed change: scorecard measures cover the whole run"
               and c["body"] == facts["scope_disclosure"] for c in caveats)


def test_fact_check_requires_the_scope_disclosure_iff_windowed():
    # missing on a windowed run → fail
    art, out = _win_artifact([_win_change()]), _win_outcomes()
    facts = report.gather_facts(art, out, verdict=None)
    facts["scope_disclosure"] = None
    with pytest.raises(AssertionError, match="scope_disclosure"):
        report.verify_facts(facts, art, out)
    # doctored wording → fail
    facts = report.gather_facts(art, out, verdict=None)
    facts["scope_disclosure"] = facts["scope_disclosure"].replace("diluted", "affected")
    with pytest.raises(AssertionError, match="scope_disclosure"):
        report.verify_facts(facts, art, out)
    # spurious on an UNwindowed run → fail
    art0, out0 = _artifact(), _outcomes()
    facts0 = report.gather_facts(art0, out0, verdict=None)
    facts0["scope_disclosure"] = "Scorecard measures cover the full simulated period."
    with pytest.raises(AssertionError, match="scope_disclosure"):
        report.verify_facts(facts0, art0, out0)


def _wc_detour_payload(note: bool) -> dict:
    """A V2.4b-shaped consistent payload for a 2-member same-edge composite (anchor keys present
    so the verify sub-block gates in; pre-V2.4b sidecars lack them and skip it)."""
    import response_probe

    rd = {"framing": response_probe.FRAMING, "lower_bound_note": response_probe.LOWER_BOUND_NOTE,
          "destination_edge": "E9", "destination_note": "n", "probes": [],
          "modified_edges": ["E1"], "destination_anchor": "E1",
          "anchor_note": ("destination anchored to the first change; with multiple modified "
                          "edges this choice is arbitrary and affects the estimate")}
    if note:
        rd["window_coincidence_note"] = response_probe.WINDOW_COINCIDENCE_NOTE
    return rd


def test_fact_check_requires_the_window_coincidence_note_iff_windows_differ():
    # V2.5a — the scope-disclosure enforcement level: recompute from the change list, one
    # equality → missing, doctored, and spurious all fail. Nested windows keep the pair LIFO-legal.
    differing = [_win_change(600.0, 1800.0), _win_change(900.0, 1200.0)]
    art, out = _win_artifact(differing), _win_outcomes()
    out["response_detour"] = _wc_detour_payload(note=True)
    facts = report.gather_facts(art, out, verdict=None)
    report.verify_facts(facts, art, out)  # consistent → must not raise
    # missing on a differing-windows composite → fail
    out2 = _win_outcomes()
    out2["response_detour"] = _wc_detour_payload(note=False)
    facts2 = report.gather_facts(art, out2, verdict=None)
    with pytest.raises(AssertionError, match="window_coincidence"):
        report.verify_facts(facts2, art, out2)
    # doctored wording → fail
    out3 = _win_outcomes()
    out3["response_detour"] = _wc_detour_payload(note=True)
    out3["response_detour"]["window_coincidence_note"] = \
        out3["response_detour"]["window_coincidence_note"].replace("most-constrained", "typical")
    facts3 = report.gather_facts(art, out3, verdict=None)
    with pytest.raises(AssertionError, match="window_coincidence"):
        report.verify_facts(facts3, art, out3)
    # spurious on identical windows → fail (the shared-window shape owes no disclosure)
    shared = [_win_change(600.0, 1200.0), _win_change(600.0, 1200.0)]
    art4, out4 = _win_artifact(shared), _win_outcomes()
    out4["response_detour"] = _wc_detour_payload(note=True)
    facts4 = report.gather_facts(art4, out4, verdict=None)
    with pytest.raises(AssertionError, match="window_coincidence"):
        report.verify_facts(facts4, art4, out4)


# --------------------------------------------------------------------------------------------------
# Section-3 bucketing + bounded sentiment-spread sample.
# --------------------------------------------------------------------------------------------------

def test_spread_sample_is_bounded_and_sorted():
    class _A:
        def __init__(self, s):
            self.reaction = type("R", (), {"sentiment": s})()
    agents = [_A(s) for s in (0.5, -0.9, 0.1, -0.3, 0.8, -0.6, 0.0, 0.9, -0.1, 0.4)]
    out = report._spread_sample(agents, 4)
    assert len(out) <= 4
    sentiments = [a.reaction.sentiment for a in out]
    assert sentiments == sorted(sentiments)  # spans worst→best in order
    assert sentiments[0] == -0.9 and sentiments[-1] == 0.9  # includes the extremes


# --------------------------------------------------------------------------------------------------
# V2.3c — institutional voices: the facts-gated speaking set (REQUIRED-iff both ways), citation
# recompute pins, mission byte-identity, section gating (pre-0.9.0 renders NOTHING), the caveat.
# --------------------------------------------------------------------------------------------------

def _tfs_agent():
    import institutions

    entry = next(e for e in institutions.load_roster() if e["id"] == "tfs")
    rd = _detour_outcomes()["response_detour"]
    cites = institutions.compose_citations(entry, {"response_detour": rd})
    return Agent(grounding="mandate",
                 persona=Persona(id="tfs", label="Toronto Fire Services"),
                 reaction=institutions.compose_reaction(entry, cites),
                 mandate=Mandate(**entry["mandate"]),
                 citations=[Citation(**c) for c in cites])


def _detour_outcomes() -> dict:
    import response_probe

    out = _outcomes()
    out["response_detour"] = {
        "framing": response_probe.FRAMING,
        "lower_bound_note": response_probe.LOWER_BOUND_NOTE,
        "origins_note": "probe origins are Toronto Fire Services station locations (Toronto Open "
                        "Data, retrieved 2026-07-25); routes are computed from every station and do "
                        "not indicate which station would respond",
        "destination_edge": "E9", "destination_note": "n",
        "probes": [{"label": "Fire Station 231 (740 Markham Rd)", "origin_edge": "E1",
                    "baseline_s": 57.0, "scenario_s": 105.7, "added_s": 48.7}],
    }
    return out


def _institutional_artifact() -> TrajectoryArtifact:
    art = _artifact()
    return TrajectoryArtifact(schema_version="0.9.0", meta=art.meta, vehicles=art.vehicles,
                              scorecard=art.scorecard, agents=[_tfs_agent()])


def test_institutional_verify_passes_and_required_iff_both_ways():
    art, out = _institutional_artifact(), _detour_outcomes()
    facts = report.gather_facts(art, out, verdict=None)
    assert [v["id"] for v in facts["institutional"]] == ["tfs"]
    report.verify_facts(facts, art, out)  # gated set matches -> must not raise

    # ABSENT-when-owed: drop the voice while the sidecar still grants standing
    facts2 = report.gather_facts(art, out, verdict=None)
    facts2["institutional"] = []
    with pytest.raises(AssertionError, match="speaking set"):
        report.verify_facts(facts2, art, out)

    # PRESENT-when-forbidden: a quiet sidecar (no detour fact) must silence TFS
    out3 = _outcomes()
    facts3 = report.gather_facts(art, out3, verdict=None)
    with pytest.raises(AssertionError, match="speaking set"):
        report.verify_facts(facts3, art, out3)


def test_institutional_verify_requires_the_window_coincidence_sentence_to_ride():
    """V2.5a defense-in-depth (the framing/lower-bound riding shape): whenever the payload
    carries the window-coincidence note, the TFS citation must carry it too — a voice must
    never cite the figure while dropping its most-constrained-moment caveat."""
    import institutions
    import response_probe

    # citation composed BEFORE the payload gained the note → the sentence does not ride → fail
    art, out = _institutional_artifact(), _detour_outcomes()
    out["response_detour"]["window_coincidence_note"] = response_probe.WINDOW_COINCIDENCE_NOTE
    facts = report.gather_facts(art, out, verdict=None)
    with pytest.raises(AssertionError, match="window-coincidence sentence must ride"):
        report.verify_facts(facts, art, out)

    # the compose path LIFTS it → rides → passes
    entry = next(e for e in institutions.load_roster() if e["id"] == "tfs")
    cites = institutions.compose_citations(entry, {"response_detour": out["response_detour"]})
    agent = Agent(grounding="mandate", persona=Persona(id="tfs", label="Toronto Fire Services"),
                  reaction=institutions.compose_reaction(entry, cites),
                  mandate=Mandate(**entry["mandate"]),
                  citations=[Citation(**c) for c in cites])
    base = _artifact()
    art2 = TrajectoryArtifact(schema_version="0.9.0", meta=base.meta, vehicles=base.vehicles,
                              scorecard=base.scorecard, agents=[agent])
    facts2 = report.gather_facts(art2, out, verdict=None)
    report.verify_facts(facts2, art2, out)  # must not raise


def test_institutional_verify_catches_doctored_citation_and_mission():
    art, out = _institutional_artifact(), _detour_outcomes()

    facts = report.gather_facts(art, out, verdict=None)
    facts["institutional"][0]["citations"][0]["text"] = "worst of 1 fire stations +12.0 s added"
    with pytest.raises(AssertionError, match="worst-station"):
        report.verify_facts(facts, art, out)

    facts = report.gather_facts(art, out, verdict=None)
    facts["institutional"][0]["citations"][0]["notes"] = ["only one note, nothing riding"]
    with pytest.raises(AssertionError, match="framing sentence|lower-bound sentence"):
        report.verify_facts(facts, art, out)

    facts = report.gather_facts(art, out, verdict=None)
    facts["institutional"][0]["mandate"]["mission"] = "Protecting Toronto since 1874."
    with pytest.raises(AssertionError, match="paraphrase is misrepresentation"):
        report.verify_facts(facts, art, out)


def test_institutional_section_gating_pre_0_9_0_renders_nothing():
    # pre-0.9.0 facts (the unwindowed-golden shape): no section, no empty-state, no markdown lines
    art, out = _artifact(), _outcomes()
    facts = report.gather_facts(art, out, verdict=None)
    assert facts["institutional"] == []
    assert report.build_institutional_section(facts) is None
    assert report.render_institutional_md(None) == []

    # a 0.9.0 run with agents but NO standing -> the honest empty state
    art9 = TrajectoryArtifact(schema_version="0.9.0", meta=art.meta, vehicles=art.vehicles,
                              scorecard=art.scorecard,
                              agents=[Agent(grounding="inferred",
                                            persona=Persona(id="taxpayer", label="Taxpayer"),
                                            reaction=Reaction(comment="c", sentiment=0.0,
                                                              stance="neutral"))])
    facts9 = report.gather_facts(art9, out, verdict=None)
    section = report.build_institutional_section(facts9)
    assert section is not None and section["voices"] == []
    assert "this run computed none" in section["empty_reason"]
    md = report.render_institutional_md(section)
    assert any("Institutional perspectives (mandate lens)" in ln for ln in md)
    assert any("not a school-zone run" in ln for ln in md)


def test_institutional_caveat_present_iff_voices():
    art, out = _institutional_artifact(), _detour_outcomes()
    facts = report.gather_facts(art, out, verdict=None)
    caveats = report.build_caveats(facts)
    assert any("not statements by, from, or on behalf" in c["body"] for c in caveats)
    lean = report.build_caveats(report.gather_facts(_artifact(), _outcomes(), verdict=None))
    assert not any("on behalf" in c["body"] for c in lean)


def test_institutional_md_renders_mission_verbatim_with_retrieved_date():
    import institutions

    art, out = _institutional_artifact(), _detour_outcomes()
    facts = report.gather_facts(art, out, verdict=None)
    md = "\n".join(report.render_institutional_md(report.build_institutional_section(facts)))
    entry = next(e for e in institutions.load_roster() if e["id"] == "tfs")
    assert entry["mandate"]["mission"] in md  # verbatim, uncut
    assert f"retrieved {entry['mandate']['retrieved']}" in md  # the freshness signal renders
    assert "not a dispatch model" in md and "a lower bound" in md
