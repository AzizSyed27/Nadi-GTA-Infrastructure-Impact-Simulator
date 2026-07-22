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
