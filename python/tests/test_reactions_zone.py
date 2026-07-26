"""V2.2d Phase 3 — the school-zone preface in the reactions prompt.

ONE mechanical sentence before the change enumeration when the scenario is tagged school_zone —
no asserted benefit, no child voice (parents react from their OWN outcomes; the children-playing
rule is measured + advocated, never ventriloquized). Untagged prompts stay BYTE-IDENTICAL.
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "python" / "src"))

from reactions import shared_prefix  # noqa: E402

WINDOW = {"start_s": 600.0, "end_s": 1200.0}


def _changes(n: int = 3, window: dict | None = WINDOW) -> list[dict]:
    return [{"type": "speed_limit", "target_edge": f"E{i}", "value_mps": 8.33,
             **({"window": window} if window else {}),
             "description": f"school-zone limit on E{i}"} for i in range(1, n + 1)]


def test_zone_preface_exact_and_mechanical() -> None:
    prefix = shared_prefix(_changes(), "sim", "synthetic_demo", tags=["school_zone"])
    assert ("These changes together form a proposed school zone: lower speed limits on "
            "3 streets from t=600 s to t=1200 s.") in prefix
    # the preface comes BEFORE the numbered enumeration
    assert prefix.index("proposed school zone") < prefix.index("This scenario composes 3 changes")


def test_zone_preface_clock_times_on_calibrated() -> None:
    w = {"start_s": 3600.0, "end_s": 7200.0}
    prefix = shared_prefix(_changes(window=w), "sim", "calibrated_am_peak", tags=["school_zone"])
    assert "proposed school zone: lower speed limits on 3 streets from 08:00 to 09:00." in prefix


def test_zone_preface_asserts_no_benefit_and_no_children() -> None:
    prefix = shared_prefix(_changes(), "sim", "synthetic_demo", tags=["school_zone"])
    preface = next(ln for ln in prefix.splitlines() if "proposed school zone" in ln)
    for banned in ("safer", "calmer", "protect", "child", "kids", "better"):
        assert banned not in preface.lower(), banned


def test_untagged_prefix_byte_identical() -> None:
    changes = _changes()
    base = shared_prefix(changes, "sim", "synthetic_demo")
    assert shared_prefix(changes, "sim", "synthetic_demo", tags=None) == base
    assert shared_prefix(changes, "sim", "synthetic_demo", tags=["not_a_zone"]) == base
    assert "school zone" not in base


def test_single_change_with_tag_still_gets_the_preface() -> None:
    prefix = shared_prefix(_changes(1), "inferred", "synthetic_demo", tags=["school_zone"])
    assert "proposed school zone: lower speed limits on 1 street from" in prefix
