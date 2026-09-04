"""V2.7b — the RUN events channel: an NDJSON file appended by writers, tailed by the server's SSE endpoint.

One file per run at ``%LOCALAPPDATA%\\nadi-run-events\\<run_id>.events.jsonl`` (the OneDrive-safe scratch
convention — ``contract/runs/`` stays artifacts + state only). The file IS the stream: line order is the
event sequence (the SSE ``id:`` is the absolute line number — no cross-process counter), replaying from
line 0 is the reconnect story, and a server restart loses nothing.

V2.3a shipped this as ``enrich_events`` — one file per ENRICH JOB, truncated at every enrich POST. V2.7b
widens the scope to the RUN'S WHOLE LIFE: the file is truncated once, at the simulate POST (line 0 is
``run_start``), and the harness, every enrich subprocess and the stage runner append to it thereafter.
The client experience is a pure fold over these lines, so a reload mid-run — or a return an hour later —
reconstructs the same screen.

THE TERMINAL IS STATE-DRIVEN, NOT CONTENT-DRIVEN (the V2.7b hazard, recorded so it is not re-broken).
V2.3a closed the stream on a ``job_done``/``job_failed`` LINE. In a never-truncated file that breaks twice:
under the auto-chain the first stage's terminal would end the client's stream before stage 2 exists, and a
SKIP writes a terminal that RESUME then appends after — so every later replay of that run would hit an
interior terminal and close early, permanently. ``run_ended`` is therefore CONTENT (it labels HOW a run
ended and the fold reads it); end-of-stream is decided by the reader from EOF + lock + run-state.

Writers share a file — the server process (lifecycle), the harness (Act I beats) and each enrich
subprocess (voices/slots/cascades) — but they are TEMPORALLY DISJOINT: the server writes only between
subprocess lifetimes. ``read_from`` tolerates a partial trailing line anyway (a reader tick can land
mid-append).

Emission is ENV-GATED: the server sets ``NADI_RUN_EVENTS=<path>`` in the subprocess env; ``from_env()``
returns None when the var is absent, and every caller no-ops — CLI runs write no file and are byte-identical.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

ENV_VAR = "NADI_RUN_EVENTS"

# The run header. ALWAYS line 0 of a non-empty file (written by the simulate POST, or reconstructed by
# ``ensure_header`` for a run whose file was pruned or predates V2.7b). The client's fold seeds on it.
RUN_START = "run_start"
# The content event that LABELS how a run ended (complete | skipped | degraded | failed). NOT the
# stream's close signal — see the module docstring.
RUN_ENDED = "run_ended"
# STREAM CONTROL, never a file line: the SSE endpoint synthesizes this frame when it has drained the
# file and the run is provably over (state terminal + lock free), and the client closes its EventSource
# on it. Keeping control and content in DIFFERENT event names is what makes an interior ``run_ended``
# line (skip, then resume appends after it) safe to replay forever.
STREAM_END = "stream_end"

_LOCALAPPDATA = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
EVENTS_ROOT = Path(_LOCALAPPDATA) / "nadi-run-events"


def events_path(run_id: str) -> Path:
    return EVENTS_ROOT / f"{run_id}.events.jsonl"


def from_env() -> Path | None:
    """The emitter gate: None (var unset/empty) means every emit call site should no-op."""
    v = os.environ.get(ENV_VAR)
    return Path(v) if v else None


def emit(path: Path, event: str, **payload) -> None:
    """Append one event line. Open-append-close per emit (no held handle; ~212 opens per run is trivial).
    Explicit utf-8 — agent comments contain non-ASCII and the Windows default is cp1252."""
    line = json.dumps({"event": event, "ts": time.time(), **payload}, ensure_ascii=False)
    with open(path, "a", encoding="utf-8", newline="\n") as f:
        f.write(line + "\n")


def begin(path: Path, run_id: str, **payload) -> None:
    """Start a run's file: empty it (creating parents) and write ``run_start`` as line 0.

    The ONE truncation point, called synchronously at the simulate POST under the held lock. Line 0 is
    structurally the run header, which is what lets a client reset its Last-Event-ID dedup on it and what
    makes a stale-id-past-EOF replay-from-0 recover cleanly."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("", encoding="utf-8")
    emit(path, RUN_START, run_id=run_id, **payload)


def ensure_header(path: Path, run_id: str, **payload) -> None:
    """Write a RECONSTRUCTED ``run_start`` iff the file is absent or empty — never truncating one that
    already has content.

    An enrich (or a resume) may be the first thing to touch a run whose events file was pruned at 7 days,
    or which predates V2.7b entirely. Without this the first line would be a ``stage_start`` and the fold
    would have no header to seed on. The reconstructed flag is honest about where the fields came from."""
    try:
        existing = path.read_bytes()
    except FileNotFoundError:
        existing = b""
    if existing.strip():
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("", encoding="utf-8")
    emit(path, RUN_START, run_id=run_id, reconstructed=True, **payload)


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
    if offset > len(complete):
        # The file SHRANK below our offset — a fresh RUN truncated it while we were tailing. Replay from
        # line 0: run_start is line 0 of every fresh file and resets the client's Last-Event-ID dedup, so
        # the replayed lines flow instead of being dropped as stale.
        offset = 0
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
