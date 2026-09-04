"""V2.3a/V2.7b — unit coverage for the run events channel (NDJSON file appended by writers, tailed by SSE).

The load-bearing behaviors: line order IS the sequence (linenos become SSE ids), a partial trailing line
(writer mid-append) is invisible until completed, and the whole channel is env-gated (no var → no file →
CLI byte-identity).

V2.7b adds the per-RUN lifecycle: ``begin`` is the ONE truncation point (line 0 = run_start) and
``ensure_header`` back-fills a header for a run whose file was pruned or predates the step — without ever
truncating a file that already has content."""

from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "python" / "src"))

import run_events  # noqa: E402


def test_emit_read_roundtrip(tmp_path: Path) -> None:
    p = tmp_path / "r.events.jsonl"
    run_events.begin(p, "r", description="a closure")
    run_events.emit(p, "voices_total", total=3)
    run_events.emit(p, "voice", index=1, done=1, total=3, agent={"grounding": "inferred"})
    events, offset = run_events.read_from(p, 0)
    assert offset == 3
    assert [(n, e["event"]) for n, e in events] == [(0, "run_start"), (1, "voices_total"), (2, "voice")]
    assert all("ts" in e for _, e in events)
    assert events[0][1]["run_id"] == "r" and events[0][1]["description"] == "a closure"
    # resume mid-file: absolute linenos, not relative
    tail, offset2 = run_events.read_from(p, 2)
    assert offset2 == 3
    assert [(n, e["event"]) for n, e in tail] == [(2, "voice")]


def test_partial_trailing_line_dropped_then_appears(tmp_path: Path) -> None:
    p = tmp_path / "r.events.jsonl"
    run_events.begin(p, "r")
    # simulate a writer caught mid-append: bytes with no trailing newline
    with open(p, "ab") as f:
        f.write(b'{"event": "voi')
    events, offset = run_events.read_from(p, 0)
    assert [e["event"] for _, e in events] == ["run_start"]
    assert offset == 1, "offset must not advance past the partial line"
    # the writer finishes the line → it appears at the SAME lineno on the next tick
    with open(p, "ab") as f:
        f.write(b'ce", "ts": 0, "index": 0}\n')
    events2, offset2 = run_events.read_from(p, offset)
    assert [(n, e["event"]) for n, e in events2] == [(1, "voice")]
    assert offset2 == 2


def test_corrupt_complete_line_skipped_but_counted(tmp_path: Path) -> None:
    p = tmp_path / "r.events.jsonl"
    run_events.begin(p, "r")
    with open(p, "ab") as f:
        f.write(b"not json at all\n")
    run_events.emit(p, run_events.RUN_ENDED, status="complete")
    events, offset = run_events.read_from(p, 0)
    # the bad line is skipped, but linenos stay aligned (run_ended is still line 2)
    assert [(n, e["event"]) for n, e in events] == [(0, "run_start"), (2, "run_ended")]
    assert offset == 3


def test_begin_resets_and_missing_file_reads_empty(tmp_path: Path) -> None:
    p = tmp_path / "sub" / "r.events.jsonl"  # parents created by begin
    assert run_events.read_from(p, 0) == ([], 0)
    run_events.begin(p, "r")
    run_events.emit(p, run_events.RUN_ENDED, status="complete")
    run_events.begin(p, "r")  # a NEW run at the same id (re-pin/smoke): fresh file
    events, offset = run_events.read_from(p, 0)
    assert [(n, e["event"]) for n, e in events] == [(0, "run_start")], "run_start must be line 0 after begin"
    assert offset == 1


def test_ensure_header_backfills_only_when_absent_or_empty(tmp_path: Path) -> None:
    """The pruned/pre-V2.7b run: an enrich must not be able to make ``stage_start`` line 0, and it must
    never truncate a file that already carries this run's history."""
    p = tmp_path / "r.events.jsonl"
    # 1. absent → reconstructed header
    run_events.ensure_header(p, "r", description="reconstructed from run state")
    events, _ = run_events.read_from(p, 0)
    assert [e["event"] for _, e in events] == ["run_start"]
    assert events[0][1]["reconstructed"] is True
    assert events[0][1]["description"] == "reconstructed from run state"

    # 2. already has content → left exactly as-is (no second header, nothing lost)
    run_events.emit(p, "stage_start", stage="enrich:voices")
    before = p.read_bytes()
    run_events.ensure_header(p, "r", description="should not appear")
    assert p.read_bytes() == before

    # 3. present but EMPTY (a truncate that never got its header) → back-filled
    empty = tmp_path / "e.events.jsonl"
    empty.write_text("", encoding="utf-8")
    run_events.ensure_header(empty, "e")
    evs, _ = run_events.read_from(empty, 0)
    assert [(n, e["event"]) for n, e in evs] == [(0, "run_start")]


def test_run_start_is_not_a_stream_terminal_and_run_ended_is_content(tmp_path: Path) -> None:
    """V2.7b: ``run_ended`` is CONTENT. A skip writes it and a resume appends AFTER it — the reader must
    keep returning the later lines, or every replay of that run would stop at the interior terminal."""
    p = tmp_path / "r.events.jsonl"
    run_events.begin(p, "r")
    run_events.emit(p, run_events.RUN_ENDED, status="skipped")
    run_events.emit(p, "stage_start", stage="enrich:report")  # resume, after the terminal
    run_events.emit(p, run_events.RUN_ENDED, status="complete")
    events, offset = run_events.read_from(p, 0)
    assert [e["event"] for _, e in events] == ["run_start", "run_ended", "stage_start", "run_ended"]
    assert offset == 4
    assert run_events.STREAM_END != run_events.RUN_ENDED, "control and content must not share a name"


def test_truncated_underneath_a_tail_replays_from_line_0(tmp_path: Path) -> None:
    """Review-caught hardening: a tail whose offset exceeds the (freshly begun) file's length must
    replay from line 0 — run_start is line 0 of every fresh file and resets the client dedup — instead
    of returning a silently non-monotonic offset that drops the new run's events as stale."""
    p = tmp_path / "r.events.jsonl"
    run_events.begin(p, "r")
    for _ in range(5):
        run_events.emit(p, "voice", index=0, done=1, total=5, agent={})
    _, offset = run_events.read_from(p, 0)
    assert offset == 6
    run_events.begin(p, "r")  # a fresh run lands while the old connection is still tailing
    run_events.emit(p, "voices_total", total=3)
    events, new_offset = run_events.read_from(p, offset)
    assert [(n, e["event"]) for n, e in events] == [(0, "run_start"), (1, "voices_total")]
    assert new_offset == 2


def test_from_env_gate(monkeypatch) -> None:
    monkeypatch.delenv(run_events.ENV_VAR, raising=False)
    assert run_events.from_env() is None
    monkeypatch.setenv(run_events.ENV_VAR, "")
    assert run_events.from_env() is None, "empty var must gate off too"
    monkeypatch.setenv(run_events.ENV_VAR, r"C:\somewhere\r.events.jsonl")
    assert run_events.from_env() == Path(r"C:\somewhere\r.events.jsonl")


def test_non_ascii_roundtrip(tmp_path: Path) -> None:
    p = tmp_path / "r.events.jsonl"
    run_events.begin(p, "r")
    comment = "détour on Kingston Rd — c'est long…"
    run_events.emit(p, "voice", index=0, done=1, total=1, agent={"reaction": {"comment": comment}})
    events, _ = run_events.read_from(p, 0)
    assert events[1][1]["agent"]["reaction"]["comment"] == comment


def test_prune_unlinks_only_old(tmp_path: Path, monkeypatch) -> None:
    import os
    import time

    monkeypatch.setattr(run_events, "EVENTS_ROOT", tmp_path)
    old = tmp_path / "old.events.jsonl"
    new = tmp_path / "new.events.jsonl"
    old.write_text("{}\n", encoding="utf-8")
    new.write_text("{}\n", encoding="utf-8")
    stale = time.time() - 8 * 86400
    os.utime(old, (stale, stale))
    run_events.prune(max_age_days=7)
    assert not old.exists()
    assert new.exists()
