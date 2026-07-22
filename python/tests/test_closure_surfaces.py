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
