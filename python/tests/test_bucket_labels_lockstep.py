"""V2.7b C9 — the bucket labels exist in two languages, so they are pinned across the boundary.

WHY THERE IS A SECOND COPY AT ALL. Act II composes the run document in front of the reader by
merging `slot_landed` events into the facts-only report. A `synthesis:<bucket>` event carries the
synthesis TEXT and nothing else — the label, the quotes and the sample size are injected code-side
after the slot returns, so they arrive only with the written file. The client therefore needs its
own bucket -> label map to render the section heading while composition is live.

A fourth uncontrolled copy of a Python constant is exactly the drift this project pins, so:
`web/lib/mergeSlots.ts`'s BUCKET_LABEL is asserted here against `report.BUCKET_LABEL`, both
directions. The precedent is `test_event_vocabulary.py` (run_events -> runStream.ts) and
`test_golden_trajectory.py`'s compactTime pin — read the .ts, assert containment, no parsing, no
Node in the loop.

Run: python -m pytest python/tests/test_bucket_labels_lockstep.py -v
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "python" / "src"))

import report  # noqa: E402

MERGE_SLOTS_TS = REPO / "web" / "lib" / "mergeSlots.ts"


def _client_bucket_labels() -> dict[str, str]:
    """Parse the BUCKET_LABEL object literal out of mergeSlots.ts."""
    src = MERGE_SLOTS_TS.read_text(encoding="utf-8")
    block = src.split("export const BUCKET_LABEL: Record<string, string> = {", 1)[1].split("};", 1)[0]
    return dict(re.findall(r"(\w+):\s*'([^']*)'", block))


def test_bucket_labels_match_python_exactly() -> None:
    """THE PIN. A bucket renamed on one side only would put a heading in the composing document
    that the written file then silently replaces at the swap — a difference a reader would see and
    could not explain."""
    assert _client_bucket_labels() == report.BUCKET_LABEL, (
        "web/lib/mergeSlots.ts BUCKET_LABEL has drifted from report.BUCKET_LABEL — change both"
    )


def test_every_bucket_that_can_emit_a_slot_has_a_label() -> None:
    """`slot_synthesis` emits one slot per NON-EMPTY bucket in BUCKET_ORDER, so every one of those
    keys must resolve client-side or the section renders its raw key as a heading."""
    client = _client_bucket_labels()
    missing = [bk for bk in report.BUCKET_ORDER if bk not in client]
    assert not missing, f"buckets with no client label: {missing}"
