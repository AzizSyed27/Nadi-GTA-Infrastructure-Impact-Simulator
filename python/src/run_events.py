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

# ---------------------------------------------------------------------------------------------
# THE VOCABULARY (V2.7b C8a) — the single source of what the server may write.
# ---------------------------------------------------------------------------------------------
# EventSource dispatches STRICTLY BY NAME: the client registers one listener per name, there is no
# wildcard, and `onmessage` never fires because every frame carries an explicit `event:`. So a name
# the server writes but the client never registered is not an error — it is SILENCE. That is exactly
# what happened in C7: `web/lib/runStream.ts`'s list predated the Act I/II vocabulary, and every
# beat, baseline_ready, results_ready, slot_landed and stage_usage frame was dropped on the floor
# while Act I rendered nothing and nothing failed.
#
# This tuple closes that class. `emit` warns when a name is missing from it, and a pytest asserts
# every name here appears in the client's listener list (the compactTime lockstep precedent). The
# direction that matters is python → TS: a registered name with no listener loses data, while a
# listener with no emitter is a harmless no-op.
EVENT_NAMES: tuple[str, ...] = (
    # lifecycle
    RUN_START, "stage_start", "stage_end", "stage_partial", "cmd_start", "cmd_end", RUN_ENDED,
    # ACT I — the run narrating its own physics
    "beat", "baseline_ready", "baseline_unavailable", "results_ready",
    # ACT II — streamed content, and the ledger's cost inputs
    "personas", "voices_total", "voice", "institutions",
    "slot_start", "slot_landed", "index_progress", "stage_usage",
)

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
    Explicit utf-8 — agent comments contain non-ASCII and the Windows default is cp1252.

    An unregistered name WARNS and is still written. Not raised: a run event is a narration of the
    run, never part of it — the same reason `change_scheduler` swallows a beat listener's failure
    rather than letting it kill a simulation. The warning is what a developer sees in test output
    and in the server log; the pytest lockstep pin is what fails the build."""
    if event not in EVENT_NAMES:
        print(f"[run-events] WARNING: emitting unregistered event {event!r} — add it to "
              f"run_events.EVENT_NAMES and to RUN_EVENT_NAMES in web/lib/runStream.ts, or the "
              f"client will silently never receive it.", flush=True)
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


# ---------------------------------------------------------------------------------------------
# THE CANCEL CHANNEL (V2.7b C6b) — "skip the rest, keep what landed"
# ---------------------------------------------------------------------------------------------
# A FILE, not an in-process flag, because the thing that has to notice is a SUBPROCESS the server
# has already launched and whose environment is fixed. It lives beside the run's events file rather
# than in STATE_DIR: the events dir is scratch the server already owns and prunes, and STATE_DIR's
# file classes are read by `list_all`, which should not have to learn about a transient flag.
#
# An un-cancellable interpretation turns iteration into a queue: a planner who has seen enough of
# one variant should not have to wait out ~230 model calls to try the next.


def cancel_path(run_id: str) -> Path:
    return EVENTS_ROOT / f"{run_id}.cancel"


def request_cancel(run_id: str) -> Path:
    """Ask the running stage to stop at its next safe point. Idempotent."""
    p = cancel_path(run_id)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(str(time.time()), encoding="utf-8")
    return p


def clear_cancel(run_id: str) -> None:
    """Drop the flag. RESUME MUST CALL THIS FIRST, or it instantly cancels its own first stage."""
    cancel_path(run_id).unlink(missing_ok=True)


def cancelled(run_id: str | None = None) -> bool:
    """Has a stop been requested? Subprocesses call the no-arg form, which derives the run id from
    the events path the server handed them — so a stage never needs to be told its own run id."""
    if run_id is None:
        path = from_env()
        if path is None:
            return False
        run_id = path.name.removesuffix(".events.jsonl")
    return cancel_path(run_id).exists()


def stage_event(event: str, **payload) -> None:
    """Emit one CONTENT event from a subprocess, resolving the path from the environment.

    The subprocess-side twin of `emit`: a stage is handed an events path in its env, never a run id,
    so every stage emitter would otherwise repeat the same three lines. Env-gated — a CLI run
    resolves no path and writes nothing, which is what keeps CLI output byte-identical."""
    path = from_env()
    if path is not None:
        emit(path, event, **payload)


def stage_usage(stage: str, calls: int | None) -> None:
    """Report a stage's METERED model calls, once, as the stage's process exits.

    The ledger's per-stage cost has no other source: only report.py persists usage today, and the
    server sees a return code. Each stage is a fresh process, so its adapter's lifetime call count
    IS that stage's count — exact, not apportioned.

    ``calls=None`` is the honest answer where a stage genuinely cannot count its own calls; the
    ledger stores the null and the cost line says the total is a floor rather than quietly adding a
    zero. Understating a spend the user is paying for is the one failure mode this must not have."""
    path = from_env()
    if path is not None:
        emit(path, "stage_usage", stage=stage, calls=calls)


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
