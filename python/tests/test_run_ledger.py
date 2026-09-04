"""V2.7b — the interpretation ledger sidecar, the FOURTH file class, and the lock's compare-and-clear.

Three things are load-bearing here:
  * the ledger is the SINGLE SOURCE for what ran / was skipped / failed and what it cost — the skipped
    and degraded screens read it, so ``end()`` must mark never-run stages honestly rather than leaving
    them "pending" forever;
  * a new file class in STATE_DIR needs every reader audited — ``list_all`` globs ``*.json`` and would
    otherwise list ``<id>.ledger`` as a bogus run (``read(p.stem)`` resolves it right back);
  * ``release()`` cleared the slot unconditionally, which is safe with one release site and a
    lock-STEALING bug the moment skip adds a second.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "python" / "src"))

import run_ledger  # noqa: E402
import run_state  # noqa: E402

RUN = "multimodal-scenario-19990101T000000Z"


@pytest.fixture(autouse=True)
def _state_dir(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(run_state, "STATE_DIR", tmp_path / "state")
    run_state.release()
    yield
    run_state.release()


def test_init_creates_every_presented_stage_pending() -> None:
    led = run_ledger.init(RUN, projection={"calls": 230, "basis": "212 voices + 13 report slots"})
    assert [s["key"] for s in led["stages"]] == list(run_ledger.STAGE_KEYS)
    assert all(s["status"] == run_ledger.PENDING and s["llm_calls"] == 0 for s in led["stages"])
    assert led["projection"] == {"calls": 230, "basis": "212 voices + 13 report slots"}
    assert led["ended"] is None
    # the presented stages are NOT the subprocesses: institutions has none of its own, and its
    # honest cost class is zero-LLM (the UI's cost copy reads this, never a plausible-looking count)
    by_key = {s["key"]: s for s in led["stages"]}
    assert by_key["institutions"]["llm"] is False and by_key["personas"]["llm"] is False
    assert by_key["voices"]["llm"] is True and by_key["report"]["llm"] is True


def test_stage_transitions_stamp_their_own_times() -> None:
    run_ledger.init(RUN)
    led = run_ledger.set_stage(RUN, "voices", run_ledger.RUNNING)
    row = run_ledger.stage(led, "voices")
    assert row["started_at"] is not None and row["ended_at"] is None
    started = row["started_at"]
    led = run_ledger.set_stage(RUN, "voices", run_ledger.DONE, produced={"agents": 213})
    row = run_ledger.stage(led, "voices")
    assert row["started_at"] == started, "started_at is stamped once, on the first RUNNING"
    assert row["ended_at"] is not None and row["produced"] == {"agents": 213}


def test_llm_calls_accumulate_and_total() -> None:
    run_ledger.init(RUN)
    run_ledger.add_llm_calls(RUN, "voices", 212)
    run_ledger.add_llm_calls(RUN, "voices", 3)  # a retry batch reports again
    led = run_ledger.add_llm_calls(RUN, "report", 13)
    assert run_ledger.stage(led, "voices")["llm_calls"] == 215
    assert run_ledger.total_llm_calls(led) == 228


def test_end_marks_never_run_stages_skipped_and_keeps_what_ran() -> None:
    """The skipped screen's 'kept / never run' split comes from here — a stage left 'pending' would
    read as still-coming forever, and a partial stage must keep its own honest status."""
    run_ledger.init(RUN)
    run_ledger.set_stage(RUN, "personas", run_ledger.DONE)
    run_ledger.set_stage(RUN, "voices", run_ledger.PARTIAL, produced={"kept": 47, "of": 213})
    run_ledger.set_stage(RUN, "institutions", run_ledger.RUNNING)
    led = run_ledger.end(RUN, run_ledger.SKIPPED_END, reason="user")
    got = {s["key"]: s["status"] for s in led["stages"]}
    assert got == {"personas": "done", "voices": "partial", "institutions": "skipped",
                   "discourse": "skipped", "report": "skipped", "index": "skipped"}
    assert led["ended"]["status"] == "skipped" and led["ended"]["reason"] == "user"
    assert run_ledger.stage(led, "voices")["produced"] == {"kept": 47, "of": 213}


def test_read_degrades_on_damage_never_raises(tmp_path: Path) -> None:
    """The read() bug class, third sighting: valid JSON with a non-dict top level must be refused
    here, not AttributeError'd inside a handler."""
    assert run_ledger.read(RUN) is None, "absent → None"
    p = run_ledger.path(RUN)
    p.parent.mkdir(parents=True, exist_ok=True)
    for damaged in ("not json at all", "[]", "null", "3", '{"stages": []}', '{"run_id": "r"}'):
        p.write_text(damaged, encoding="utf-8")
        assert run_ledger.read(RUN) is None, f"{damaged!r} must degrade to None"
    run_ledger.init(RUN)
    assert run_ledger.read(RUN)["run_id"] == RUN


def test_ensure_creates_for_a_pre_v27b_run() -> None:
    assert run_ledger.read(RUN) is None
    led = run_ledger.ensure(RUN)
    assert led["run_id"] == RUN and led["stages"]
    led["stages"][0]["status"] = run_ledger.DONE
    run_ledger._write(led)
    assert run_ledger.ensure(RUN)["stages"][0]["status"] == run_ledger.DONE, "ensure must not reset"


def test_all_four_file_classes_coexist_in_state_dir() -> None:
    """STATE_DIR now holds four classes: state / .composite.json / .identity.json / .ledger.json.
    list_all globs ``*.json`` and would list ``<id>.ledger`` as a run (read(p.stem) resolves the
    real file straight back), so the skip is necessary — and this pins that it is sufficient."""
    run_state.set_stage(RUN, "done", "run complete")
    run_state.set_identity(RUN, name="the doorstep closure")
    (run_state.STATE_DIR / f"{RUN}.composite.json").write_text(
        json.dumps({"changes": [{"type": "road_closure"}]}), encoding="utf-8")
    run_ledger.init(RUN)
    assert sorted(p.name for p in run_state.STATE_DIR.glob("*.json")) == [
        f"{RUN}.composite.json", f"{RUN}.identity.json", f"{RUN}.json", f"{RUN}.ledger.json"]
    runs = run_state.list_all()
    assert [r["run_id"] for r in runs] == [RUN], "exactly one RUN, whatever else shares the dir"
    # and the ledger sidecar never leaks into the state file itself
    assert "stages" not in run_state.read(RUN)


def test_release_is_compare_and_clear() -> None:
    """The steal this closes: a skipped job's worker unwinds LATE, after variant B has acquired.
    An unconditional release would hand B's slot to a third job while B is still running SUMO."""
    assert run_state.try_acquire("A") is True
    assert run_state.release("B") is False, "a foreign id must not clear the slot"
    assert run_state.active() == "A"
    assert run_state.release("A") is True
    assert run_state.active() is None

    # the real sequence: A is cancelled, B acquires, A's late finally fires
    assert run_state.try_acquire("A") is True
    run_state.release("A")
    assert run_state.try_acquire("B") is True
    assert run_state.release("A") is False, "A's late unwind must be a no-op"
    assert run_state.active() == "B", "B still holds the lock — no third job may acquire"
    assert run_state.try_acquire("C") is False

    # bare release() stays the unconditional form (test teardown wants exactly that)
    assert run_state.release() is True
    assert run_state.active() is None
