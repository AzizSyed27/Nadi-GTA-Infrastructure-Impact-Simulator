"""V2.1d — report-side honesty for cross-seed ranges (pure; no LLM calls).

Pins: _is_unstable is None-safe (rangeless cells are stable-by-absence, never a throw);
a sign-unstable cell of ANY kind renders ±magnitude (never signed); ranged renders append the
range clause (safety with ABSOLUTE endpoints — no sign character ever); cell_valence refuses the
direction of an unstable cell (the string the LLM slots and the chat corpus receive)."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "python" / "src"))

try:  # report.py drags the agent stack config — skip cleanly where unavailable
    import report
except Exception:  # pragma: no cover
    pytest.skip("report deps unavailable", allow_module_level=True)

from contract_models import CellRange, ScorecardCell  # noqa: E402

UNSTABLE = CellRange(min=-1.4, max=5.1, n_seeds=3, sign_stable=False)
STABLE = CellRange(min=1.8, max=2.9, n_seeds=3, sign_stable=True)


def test_is_unstable_none_safe() -> None:
    assert report._is_unstable(None) is False
    assert report._is_unstable(ScorecardCell(value=1.0)) is False  # rangeless = stable-by-absence
    assert report._is_unstable(ScorecardCell(value=2.3, range=UNSTABLE)) is True
    assert report._is_unstable(ScorecardCell(value=2.1, range=STABLE)) is False


def test_unstable_travel_renders_magnitude_only() -> None:
    cell = ScorecardCell(value=2.3, affected_share=0.19, confidence="measured", range=UNSTABLE)
    s = report.render_cell(cell, "travel")
    assert s.startswith("±2.3s"), s
    assert "+2.3" not in s
    # the range clause keeps SIGNED endpoints — the straddle is the evidence, not a claim
    assert "(range -1.4 to +5.1s across 3 seeds)" in s


def test_stable_travel_renders_signed_with_range() -> None:
    cell = ScorecardCell(value=2.1, affected_share=0.18, confidence="measured", range=STABLE)
    s = report.render_cell(cell, "travel")
    assert s.startswith("+2.1s"), s
    assert "(range +1.8 to +2.9s across 3 seeds)" in s


def test_safety_range_render_has_no_sign_character() -> None:
    cell = ScorecardCell(value=0.2, confidence="low",
                         range=CellRange(min=-1.2, max=2.4, n_seeds=3, sign_stable=False))
    s = report.render_cell(cell, "safety")
    assert s.startswith("±0.20")
    assert "(range ±1.20 to ±2.40 across 3 seeds)" in s
    assert "+" not in s and "-" not in s and "−" not in s  # the safety no-sign-char invariant


def test_cell_valence_refuses_unstable_direction() -> None:
    v = report.cell_valence(ScorecardCell(value=2.3, range=UNSTABLE), "travel")
    assert "direction is not claimed" in v and "flips across" in v
    assert "worse" not in v and "better" not in v
    # a measured-STABLE safety range earns the better caveat, still no direction
    stable_safety = CellRange(min=0.5, max=1.1, n_seeds=3, sign_stable=True)
    v2 = report.cell_valence(ScorecardCell(value=0.8, confidence="low", range=stable_safety), "safety")
    assert "sign held across" in v2 and "magnitude only" in v2
    assert "safer" not in v2 and "worse" not in v2
