"""V2.3a — unit coverage for the enrich events channel (NDJSON file appended by writers, tailed by SSE).

The load-bearing behaviors: line order IS the sequence (linenos become SSE ids), a partial trailing line
(writer mid-append) is invisible until completed, and the whole channel is env-gated (no var → no file →
CLI byte-identity)."""

from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "python" / "src"))

import enrich_events  # noqa: E402


def test_emit_read_roundtrip(tmp_path: Path) -> None:
    p = tmp_path / "r.events.jsonl"
    enrich_events.truncate(p)
    enrich_events.emit(p, "job_start", run_id="r", label="enrich:voices")
    enrich_events.emit(p, "voices_total", total=3)
    enrich_events.emit(p, "voice", index=1, done=1, total=3, agent={"grounding": "inferred"})
    events, offset = enrich_events.read_from(p, 0)
    assert offset == 3
    assert [(n, e["event"]) for n, e in events] == [(0, "job_start"), (1, "voices_total"), (2, "voice")]
    assert all("ts" in e for _, e in events)
    # resume mid-file: absolute linenos, not relative
    tail, offset2 = enrich_events.read_from(p, 2)
    assert offset2 == 3
    assert [(n, e["event"]) for n, e in tail] == [(2, "voice")]


def test_partial_trailing_line_dropped_then_appears(tmp_path: Path) -> None:
    p = tmp_path / "r.events.jsonl"
    enrich_events.truncate(p)
    enrich_events.emit(p, "job_start", run_id="r")
    # simulate a writer caught mid-append: bytes with no trailing newline
    with open(p, "ab") as f:
        f.write(b'{"event": "voi')
    events, offset = enrich_events.read_from(p, 0)
    assert [e["event"] for _, e in events] == ["job_start"]
    assert offset == 1, "offset must not advance past the partial line"
    # the writer finishes the line → it appears at the SAME lineno on the next tick
    with open(p, "ab") as f:
        f.write(b'ce", "ts": 0, "index": 0}\n')
    events2, offset2 = enrich_events.read_from(p, offset)
    assert [(n, e["event"]) for n, e in events2] == [(1, "voice")]
    assert offset2 == 2


def test_corrupt_complete_line_skipped_but_counted(tmp_path: Path) -> None:
    p = tmp_path / "r.events.jsonl"
    enrich_events.truncate(p)
    enrich_events.emit(p, "job_start", run_id="r")
    with open(p, "ab") as f:
        f.write(b"not json at all\n")
    enrich_events.emit(p, "job_done")
    events, offset = enrich_events.read_from(p, 0)
    # the bad line is skipped, but linenos stay aligned (job_done is still line 2)
    assert [(n, e["event"]) for n, e in events] == [(0, "job_start"), (2, "job_done")]
    assert offset == 3


def test_truncate_resets_and_missing_file_reads_empty(tmp_path: Path) -> None:
    p = tmp_path / "sub" / "r.events.jsonl"  # parents created by truncate
    assert enrich_events.read_from(p, 0) == ([], 0)
    enrich_events.truncate(p)
    enrich_events.emit(p, "job_start", run_id="r")
    enrich_events.emit(p, "job_done")
    enrich_events.truncate(p)  # re-enrich: fresh file
    enrich_events.emit(p, "job_start", run_id="r")
    events, offset = enrich_events.read_from(p, 0)
    assert [(n, e["event"]) for n, e in events] == [(0, "job_start")], "job_start must be line 0 after truncate"
    assert offset == 1


def test_from_env_gate(monkeypatch) -> None:
    monkeypatch.delenv(enrich_events.ENV_VAR, raising=False)
    assert enrich_events.from_env() is None
    monkeypatch.setenv(enrich_events.ENV_VAR, "")
    assert enrich_events.from_env() is None, "empty var must gate off too"
    monkeypatch.setenv(enrich_events.ENV_VAR, r"C:\somewhere\r.events.jsonl")
    assert enrich_events.from_env() == Path(r"C:\somewhere\r.events.jsonl")


def test_non_ascii_roundtrip(tmp_path: Path) -> None:
    p = tmp_path / "r.events.jsonl"
    enrich_events.truncate(p)
    comment = "détour on Kingston Rd — c'est long…"
    enrich_events.emit(p, "voice", index=0, done=1, total=1, agent={"reaction": {"comment": comment}})
    events, _ = enrich_events.read_from(p, 0)
    assert events[0][1]["agent"]["reaction"]["comment"] == comment


def test_prune_unlinks_only_old(tmp_path: Path, monkeypatch) -> None:
    import os
    import time

    monkeypatch.setattr(enrich_events, "EVENTS_ROOT", tmp_path)
    old = tmp_path / "old.events.jsonl"
    new = tmp_path / "new.events.jsonl"
    old.write_text("{}\n", encoding="utf-8")
    new.write_text("{}\n", encoding="utf-8")
    stale = time.time() - 8 * 86400
    os.utime(old, (stale, stale))
    enrich_events.prune(max_age_days=7)
    assert not old.exists()
    assert new.exists()
