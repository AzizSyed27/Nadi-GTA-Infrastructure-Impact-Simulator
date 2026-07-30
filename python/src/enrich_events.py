"""V2.3a — the enrich EVENTS channel: an NDJSON file appended by writers, tailed by the server's SSE endpoint.

One file per run at ``%LOCALAPPDATA%\\nadi-enrich\\<run_id>.events.jsonl`` (the OneDrive-safe scratch
convention — ``contract/runs/`` stays artifacts + state only). The file IS the stream: line order is the
event sequence (the SSE ``id:`` is the absolute line number — no cross-process counter), replaying from
line 0 is the reconnect story, and a server restart loses nothing.

Two writers share a file — the server process (job lifecycle: job_start/cmd_start/cmd_end/job_done/
job_failed) and the enrich subprocess (voices_total/voice) — but they are TEMPORALLY DISJOINT: the server
writes only between subprocess lifetimes. ``read_from`` tolerates a partial trailing line anyway (a reader
tick can land mid-append).

Emission is ENV-GATED: the server sets ``NADI_ENRICH_EVENTS=<path>`` in the subprocess env; ``from_env()``
returns None when the var is absent, and every caller no-ops — CLI runs write no file and are byte-identical.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

ENV_VAR = "NADI_ENRICH_EVENTS"
TERMINAL = {"job_done", "job_failed"}

_LOCALAPPDATA = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
EVENTS_ROOT = Path(_LOCALAPPDATA) / "nadi-enrich"


def events_path(run_id: str) -> Path:
    return EVENTS_ROOT / f"{run_id}.events.jsonl"


def from_env() -> Path | None:
    """The emitter gate: None (var unset/empty) means every emit call site should no-op."""
    v = os.environ.get(ENV_VAR)
    return Path(v) if v else None


def truncate(path: Path) -> None:
    """Start a fresh job: empty the file (creating parents). MUST be followed by an immediate
    ``emit(path, "job_start", ...)`` — clients reset their Last-Event-ID dedup on job_start, which only
    works because job_start is line 0 of every fresh file (the POST-time ordering invariant)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("", encoding="utf-8")


def emit(path: Path, event: str, **payload) -> None:
    """Append one event line. Open-append-close per emit (no held handle; ~212 opens per run is trivial).
    Explicit utf-8 — agent comments contain non-ASCII and the Windows default is cp1252."""
    line = json.dumps({"event": event, "ts": time.time(), **payload}, ensure_ascii=False)
    with open(path, "a", encoding="utf-8", newline="\n") as f:
        f.write(line + "\n")


def read_from(path: Path, offset: int) -> tuple[list[tuple[int, dict]], int]:
    """Read complete events starting at line ``offset`` (0-based). Returns ([(lineno, event), ...],
    new_offset) — linenos are ABSOLUTE (they become the SSE ``id:``), and new_offset counts COMPLETE
    lines only: a trailing partial line (writer mid-append) is dropped and re-read on the next tick.
    Unparseable complete lines are skipped defensively but still counted (linenos stay aligned and the
    stream never wedges on one bad line)."""
    try:
        raw = path.read_bytes()
    except FileNotFoundError:
        return [], offset
    lines = raw.split(b"\n")
    # A file whose last write completed ends with b"\n" → split leaves one empty tail element. Anything
    # non-empty in the tail position is a partial line mid-append: drop it, don't advance past it.
    complete = lines[:-1]
    events: list[tuple[int, dict]] = []
    for lineno, ln in enumerate(complete[offset:], start=offset):
        try:
            events.append((lineno, json.loads(ln.decode("utf-8"))))
        except Exception:  # noqa: BLE001 — a torn/corrupt line must not wedge the tail loop
            continue
    return events, len(complete)


def prune(max_age_days: int = 7) -> None:
    """Unlink old events files. Errors are swallowed — a concurrently-tailed file may be open."""
    if not EVENTS_ROOT.is_dir():
        return
    cutoff = time.time() - max_age_days * 86400
    for p in EVENTS_ROOT.glob("*.events.jsonl"):
        try:
            if p.stat().st_mtime < cutoff:
                p.unlink()
        except OSError:
            continue
