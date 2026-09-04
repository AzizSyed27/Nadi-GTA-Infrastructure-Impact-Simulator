"""Suite-wide fixtures.

THE EVENTS SCRATCH IS REDIRECTED FOR EVERY TEST (V2.7b C3). Before C1 a `POST /api/simulate` wrote
no events file, so no test could leak one. Since C1 every simulate POST opens the run's events file
at `%LOCALAPPDATA%\\nadi-run-events\\`, and any POST-success test without its own monkeypatch drops a
real file into the developer's live scratch directory — where `prune()` will eventually delete it,
but where it also sits alongside real runs' events and muddies exactly the directory you go looking
in when a live run misbehaves.

Fixing this per-test would be whack-a-mole: the leak is a property of the CLASS of tests that POST a
run, including the ones not written yet. One autouse fixture covers all of them, and a test that
wants to inspect the file still can — it just gets a tmp_path-scoped one.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "python" / "src"))


@pytest.fixture(autouse=True)
def _isolate_run_events(tmp_path_factory, monkeypatch):
    """Point run_events at a per-test scratch dir. Import-guarded: a test session that cannot import
    the module (missing optional deps) must not fail here."""
    try:
        import run_events
    except Exception:  # pragma: no cover - the module is stdlib-only; this is belt and braces
        return
    monkeypatch.setattr(run_events, "EVENTS_ROOT", tmp_path_factory.mktemp("run-events"))
