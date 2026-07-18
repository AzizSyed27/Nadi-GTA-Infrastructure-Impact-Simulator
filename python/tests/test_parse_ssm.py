"""V2.1c regression — `_parse_xy` on real SSM position shapes. One INVALID-sentinel record written as
3D "x,y,z" (a teleporting vehicle) killed a 50-minute calibrated leg via `x, y = first.split(",")`;
the parser must index-not-unpack and reject sentinels, exactly like the subscription recorder path."""

from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "python" / "src"))

from scenario_harness import _parse_xy  # noqa: E402

SENTINEL = "-1073741824.00"


def test_plain_xy() -> None:
    assert _parse_xy("123.4,567.8") == (123.4, 567.8)


def test_na_and_empty() -> None:
    assert _parse_xy("NA") is None
    assert _parse_xy("") is None
    assert _parse_xy(None) is None


def test_span_takes_first_usable() -> None:
    assert _parse_xy("1.0,2.0 3.0,4.0") == (1.0, 2.0)
    # a Span whose leading samples are NA must not crash — skip to the first x,y
    assert _parse_xy("NA 3.0,4.0") == (3.0, 4.0)


def test_3d_sentinel_record_skipped() -> None:
    # the exact record that killed run 20260718T184427Z's baseline leg
    assert _parse_xy(f"{SENTINEL},{SENTINEL},{SENTINEL}") is None


def test_3d_valid_takes_xy() -> None:
    assert _parse_xy("10.0,20.0,0.0") == (10.0, 20.0)


def test_sentinel_2d_skipped_but_later_sample_used() -> None:
    assert _parse_xy(f"{SENTINEL},{SENTINEL} 5.0,6.0") == (5.0, 6.0)
