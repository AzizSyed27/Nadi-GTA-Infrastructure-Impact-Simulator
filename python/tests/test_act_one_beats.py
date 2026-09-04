"""V2.7b — ACT I: the four beats and the early baseline artifact.

The beats are the run narrating itself while it runs. Two things make them safe to show:

  * a beat that did not happen is never invented. A geometry change has nothing to apply in-sim; an
    unwindowed change has nothing to withdraw; a window past the sim ceiling never fires. Each of
    those gets its OWN honest variant, and the fire-once rule keeps a composite's several members
    from turning one moment into four.
  * beat 4's claim is written FROM `change_scheduler.assert_restored`, which compares the
    (allowed, disallowed, max-speed) triple per lane against the capture taken immediately before
    apply. It is not a whole-network comparison, and the copy must never say it is — a cleanup-proof
    screen that overstates its own check would be the worst overclaim in the product.

Run: python -m pytest python/tests/test_act_one_beats.py -v
"""

from __future__ import annotations

import fnmatch
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "python" / "src"))

import run_events  # noqa: E402
import scenario_harness as sh  # noqa: E402
import trajectory_io  # noqa: E402
from contract_models import Change, Window  # noqa: E402


@pytest.fixture()
def beats(tmp_path, monkeypatch):
    ev = tmp_path / "r.events.jsonl"
    run_events.begin(ev, "r")
    monkeypatch.setenv(run_events.ENV_VAR, str(ev))
    b = sh.Beats("synthetic_demo")
    return b, ev


def _beats_in(ev: Path) -> list[dict]:
    events, _ = run_events.read_from(ev, 0)
    return [e for _, e in events if e["event"] == "beat"]


def test_beats_are_env_gated(tmp_path, monkeypatch):
    """CLI byte-identity: without the server's env var a harness run emits nothing at all."""
    monkeypatch.delenv(run_events.ENV_VAR, raising=False)
    monkeypatch.setattr(run_events, "EVENTS_ROOT", tmp_path / "root")
    b = sh.Beats("synthetic_demo")
    assert b.on is False
    b.beat(1, "demand", "T", "D")
    b.emit("baseline_ready", url="/x.json")
    assert not (tmp_path / "root").exists(), "no env var → no events dir/file"


def test_a_beat_fires_once(beats):
    b, ev = beats
    b.beat(3, "applied", "FIRST", "the real moment")
    b.beat(3, "applied", "SECOND", "a composite's second member")
    (only,) = _beats_in(ev)
    assert only["title"] == "FIRST", "a composite must not turn one moment into four"


def test_sim_time_renders_in_the_profiles_honest_form(tmp_path, monkeypatch):
    """Only calibrated demand carries a real clock anchor. Synthetic demand has no time of day, so
    borrowing 07:00 for it would fabricate a clock the run does not have."""
    ev = tmp_path / "r.events.jsonl"
    run_events.begin(ev, "r")
    monkeypatch.setenv(run_events.ENV_VAR, str(ev))
    assert sh.Beats("synthetic_demo").fmt_t(600.0) == "t=600 s"
    assert sh.Beats("calibrated_am_peak").fmt_t(600.0) == "07:10"
    assert sh.Beats("synthetic_demo").fmt_t(None) is None


# ------------------------------------------------------------------ beats 3/4 from the scheduler

def _proof(**over) -> dict:
    return {"change_idx": 0, "type": "road_closure", "target_edge": "-e1",
            "window": {"start_s": 600.0, "end_s": 1200.0}, "applied_t": None, "reverted_t": None,
            "restored_ok": None, "note": None, **over}


def test_apply_and_revert_beats_carry_the_moment_and_the_real_claim(beats):
    b, ev = beats
    b.scheduler_event("applied", _proof(applied_t=600.0), lanes=[0, 1])
    b.scheduler_event("reverted", _proof(applied_t=600.0, reverted_t=1200.0, restored_ok=True),
                      lanes=["-e1_0", "-e1_1"])
    b3, b4 = _beats_in(ev)
    assert b3["n"] == 3 and "t=600 s" in b3["title"]
    assert "road_closure on -e1" in b3["detail"] and "computing, not shown" in b3["detail"]
    assert b4["n"] == 4 and "t=1200 s" in b4["title"]
    # the claim is exactly what assert_restored checks — per lane, against the pre-apply capture
    assert "on every lane it touched" in b4["detail"]
    assert "captured immediately before it was applied" in b4["detail"]
    assert b4["restored_ok"] is True and b4["lanes"] == 2


def test_beat_four_never_claims_a_network_wide_comparison(beats):
    """The mockup said 'restored network graph identical to baseline, checked edge by edge'. The
    harness checks lane permissions and speeds on the lanes the change touched. Nothing more."""
    b, ev = beats
    b.scheduler_event("reverted", _proof(reverted_t=1200.0, restored_ok=True), lanes=["-e1_0"])
    (b4,) = _beats_in(ev)
    text = (b4["title"] + " " + b4["detail"]).lower()
    for overclaim in ("edge by edge", "identical to baseline", "network graph", "whole network"):
        assert overclaim not in text, f"beat 4 must not claim {overclaim!r}"


# ------------------------------------------------------------ the honest variants (nothing invented)

def test_geometry_run_says_there_was_nothing_to_apply_in_sim(beats):
    b, ev = beats
    b.settle_change_beats([Change(type="new_road", target_edge="nr_A_B", description="d")], [],
                          geometry=True)
    b3, b4 = _beats_in(ev)
    assert "nothing to apply or withdraw during the simulation" in b3["detail"]
    assert b4["title"] == "NOTHING TO WITHDRAW"


def test_unwindowed_run_says_the_change_has_no_window(beats):
    b, ev = beats
    b.settle_change_beats([Change(type="speed_limit", target_edge="e1", value_mps=8.0,
                                  description="d")], [], geometry=False)
    b3, b4 = _beats_in(ev)
    assert "read back to confirm it took effect" in b3["detail"]
    assert b4["title"] == "NO WITHDRAWAL — THIS CHANGE HAS NO WINDOW"
    assert "reverted" not in b4["detail"].lower()


def test_a_window_that_never_fired_renders_the_schedulers_own_words(beats):
    b, ev = beats
    ch = Change(type="road_closure", target_edge="e1", description="d",
                window=Window(start_s=9000.0, end_s=9600.0))
    note = "window starts at 9000s, at/after the sim ceiling 7200s — never applied"
    b.settle_change_beats([ch], [_proof(note=note)], geometry=False)
    b3, b4 = _beats_in(ev)
    assert b3["title"] == "YOUR CHANGE WAS NEVER APPLIED" and b3["detail"] == note
    assert b4["title"] == "YOUR CHANGE WAS NEVER WITHDRAWN" and b4["detail"] == note


def test_a_live_scheduler_beat_is_not_overwritten_by_the_settle_pass(beats):
    """settle_change_beats runs on EVERY run — the fire-once rule is what keeps it from relabelling
    a moment that actually happened."""
    b, ev = beats
    b.scheduler_event("applied", _proof(applied_t=600.0), lanes=[0])
    b.scheduler_event("reverted", _proof(reverted_t=1200.0, restored_ok=True), lanes=["-e1_0"])
    b.settle_change_beats([Change(type="road_closure", target_edge="e1", description="d",
                                  window=Window(start_s=600.0, end_s=1200.0))],
                          [_proof(applied_t=600.0, reverted_t=1200.0, restored_ok=True)],
                          geometry=False)
    b3, b4 = _beats_in(ev)
    assert "t=600 s" in b3["title"] and "t=1200 s" in b4["title"]


# ------------------------------------------------------------------- the early baseline artifact

def _records() -> dict:
    return {
        "veh1": {"type": "car", "path": [[-79.2, 43.75], [-79.2, 43.76]],
                 "timestamps": [0.0, 1.0], "speeds": [5.0, 5.0]},
        "bike1": {"type": "bicycle", "path": [[-79.2, 43.75], [-79.21, 43.76]],
                  "timestamps": [0.0, 1.0], "speeds": [3.0, 3.0]},
        # a TELEPORT GAP: three points, irregular cadence -> the true explicit array is kept
        "ped1": {"type": "pedestrian",
                 "path": [[-79.2, 43.75], [-79.2, 43.751], [-79.2, 43.752]],
                 "timestamps": [0.0, 1.0, 5.0], "speeds": [1.0, 1.0, 1.0]},
    }


def test_baseline_artifact_is_contract_valid_and_carries_no_scenario(tmp_path):
    """meta.scenario stays None, and that is MEANINGFUL: a baseline leg has no change. The schema
    reaches scenario through `properties`, not `required`, exactly so this file can exist."""
    out = tmp_path / "multimodal-baseline-TS.json"
    n = sh.write_baseline_artifact(out, run_id="multimodal-baseline-TS",
                                   bbox=[-79.3, 43.7, -79.1, 43.8], sim_end=100.0, step=1.0,
                                   records=_records(), demand_profile="synthetic_demo",
                                   assignment=None)
    assert n == 3
    art = trajectory_io.load_artifact(out)  # validates against the schema on the way in
    assert art.meta.scenario is None
    assert art.schema_version == "0.10.0"
    assert [v.id for v in art.vehicles] == ["veh1", "bike1"]
    assert [p.id for p in art.persons] == ["ped1"]
    assert art.scorecard is None and art.agents == []
    # the SAME 0.10.0 encoders as the real artifact: regular cadence compacts, a gap stays explicit
    assert art.vehicles[0].t0 == 0.0 and art.vehicles[0].dt == 1.0
    assert art.persons[0].timestamps == [0.0, 1.0, 5.0] and art.persons[0].t0 is None
    assert art.vehicles[0].speeds is None, "0.10.0 drops wire speeds"


def test_baseline_artifact_writes_nothing_when_there_is_nothing_to_play(tmp_path):
    out = tmp_path / "multimodal-baseline-TS.json"
    peds_only = {k: v for k, v in _records().items() if v["type"] == "pedestrian"}
    assert sh.write_baseline_artifact(out, run_id="b", bbox=[-79.3, 43.7, -79.1, 43.8],
                                      sim_end=100.0, step=1.0, records=peds_only,
                                      demand_profile="synthetic_demo", assignment=None) == 0
    assert not out.exists(), "no file rather than an empty one — the caller labels the absence"


def test_the_baseline_name_never_matches_an_artifact_discovery_glob():
    """The baseline file is now a VALID artifact sitting in RUNS_DIR, so its name has to stay out of
    the resolvers' namespace — the graph_export naming precedent, pinned the same way."""
    name = "multimodal-baseline-20260903T000000Z.json"
    for pattern in ("multimodal-scenario-*.json", "outcomes-*.json", "instrumented-*.json"):
        assert not fnmatch.fnmatch(name, pattern), f"{name} must not be discoverable as {pattern}"
    assert fnmatch.fnmatch("multimodal-scenario-20260903T000000Z.json", "multimodal-scenario-*.json")
