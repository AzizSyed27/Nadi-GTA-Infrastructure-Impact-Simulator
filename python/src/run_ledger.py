"""V2.7b — the INTERPRETATION LEDGER: what ran, what was skipped, what it cost.

One sidecar per run at ``contract/runs/state/<run_id>.ledger.json`` — the FOURTH file class in that
directory (state / ``.composite.json`` / ``.identity.json`` / ``.ledger.json``), skipped by
``run_state.list_all`` like its siblings.

WHY A SIDECAR AND NOT THE STATE FILE: ``run_state.set_stage`` is an unlocked read-merge-write called
from the harness SUBPROCESS as well as the server. A second writer would race it. The identity sidecar
solved the same problem the same way in V2.4c — exactly one writer (here: the server's stage runner)
makes it race-free by construction.

WHAT IT IS FOR: the events file is the live detail; the ledger is the DURABLE SUMMARY. Together they
are the whole client experience — a reload mid-run seeds from the ledger and folds the events over it,
and a return an hour later (after the events file has been pruned) still renders the honest end state.
EVERY counter the UI shows derives from one of the two. There are no literals on screen.

THE STAGES ARE THE PRESENTED ONES, NOT THE SUBPROCESSES. ``institutions`` has no subprocess of its own
(reactions.py composes those voices deterministically) and ``personas``/``voices`` are two presented
stages inside one enrich job. The runner maps subprocesses onto these keys; the UI never learns that a
subprocess boundary exists, because a subprocess boundary is machinery.
"""

from __future__ import annotations

import json
import time
from pathlib import Path

import run_state

LEDGER_SUFFIX = run_state.LEDGER_SUFFIX

# The presented Act II stages, in order. ``llm`` is the honest cost class: institutions are composed
# from byte-pinned roster text with ZERO model calls, and the UI says so rather than inheriting a
# plausible-looking count.
STAGES: tuple[dict, ...] = (
    {"key": "personas", "label": "personas sampled", "llm": False},
    {"key": "voices", "label": "voices", "llm": True},
    {"key": "institutions", "label": "institutions", "llm": False},
    {"key": "discourse", "label": "discourse", "llm": True},
    {"key": "report", "label": "report", "llm": True},
    {"key": "index", "label": "chat index", "llm": True},
)
STAGE_KEYS: tuple[str, ...] = tuple(s["key"] for s in STAGES)

# stage statuses. ``partial`` = a skip landed mid-stage and what had been generated was kept.
PENDING, RUNNING, DONE, PARTIAL, SKIPPED, FAILED = (
    "pending", "running", "done", "partial", "skipped", "failed")
_TERMINAL_STAGE = {DONE, PARTIAL, SKIPPED, FAILED}

# run endings. ``degraded`` = interpretation could not start/continue (provider unreachable); the run
# itself is unharmed and every number stands.
COMPLETE, SKIPPED_END, DEGRADED, FAILED_END = "complete", "skipped", "degraded", "failed"


def path(run_id: str) -> Path:
    return run_state.STATE_DIR / f"{run_id}{LEDGER_SUFFIX}"


def read(run_id: str) -> dict | None:
    """The ledger, or None when absent/corrupt/foreign.

    Degrade-hardened like ``run_state.identity``: a sync-damaged sidecar must never 500 a handler.
    Valid JSON with a non-dict top level (a list, null, a number) is the read() bug class this
    project has now been bitten by twice — it is refused here, not AttributeError'd downstream."""
    p = path(run_id)
    if not p.is_file():
        return None
    try:
        d = json.loads(p.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return None
    if not isinstance(d, dict) or "run_id" not in d or not isinstance(d.get("stages"), list):
        return None
    return d


def _write(led: dict) -> dict:
    led["updated_at"] = time.time()
    run_state.STATE_DIR.mkdir(parents=True, exist_ok=True)
    path(led["run_id"]).write_text(json.dumps(led, indent=2), encoding="utf-8")
    return led


def init(run_id: str, *, projection: dict | None = None) -> dict:
    """Create (or reset) a run's ledger with every stage pending. Idempotent per run start."""
    led = {
        "run_id": run_id,
        "created_at": time.time(),
        "updated_at": time.time(),
        "quant": {"status": RUNNING, "started_at": time.time(), "ended_at": None},
        "facts_report": {"status": PENDING, "at": None},
        "stages": [{"key": s["key"], "label": s["label"], "llm": s["llm"], "status": PENDING,
                    "started_at": None, "ended_at": None, "llm_calls": 0, "detail": "",
                    "produced": {}} for s in STAGES],
        "projection": projection or {"calls": None, "basis": ""},
        "ended": None,
    }
    return _write(led)


def ensure(run_id: str, *, projection: dict | None = None) -> dict:
    """The ledger for a run, creating one if it has none (a pre-V2.7b run, or a pruned sidecar)."""
    return read(run_id) or init(run_id, projection=projection)


def stage(led: dict, key: str) -> dict | None:
    for s in led.get("stages", []):
        if s.get("key") == key:
            return s
    return None


def set_stage(run_id: str, key: str, status: str, **fields) -> dict:
    """Merge one stage's row. Stamps started_at on the first RUNNING and ended_at on any terminal
    status, so the UI's per-stage durations derive rather than being asserted."""
    led = ensure(run_id)
    row = stage(led, key)
    if row is None:  # an unknown key would silently vanish; keep it visible instead
        row = {"key": key, "label": key, "llm": True, "status": PENDING, "started_at": None,
               "ended_at": None, "llm_calls": 0, "detail": "", "produced": {}}
        led["stages"].append(row)
    now = time.time()
    if status == RUNNING and row.get("started_at") is None:
        row["started_at"] = now
    if status in _TERMINAL_STAGE:
        row["ended_at"] = now
    row["status"] = status
    row.update(fields)
    return _write(led)


def add_llm_calls(run_id: str, key: str, calls: int) -> dict:
    """Accumulate a stage's metered model calls (the subprocess reports its own adapter total at
    exit; a fresh process per stage makes that total exactly this stage's)."""
    led = ensure(run_id)
    row = stage(led, key)
    if row is not None:
        row["llm_calls"] = int(row.get("llm_calls") or 0) + int(calls or 0)
    return _write(led)


def set_quant(run_id: str, status: str, **fields) -> dict:
    led = ensure(run_id)
    led["quant"] = {**led.get("quant", {}), "status": status, **fields}
    if status in _TERMINAL_STAGE:
        led["quant"]["ended_at"] = time.time()
    return _write(led)


def set_facts_report(run_id: str, status: str) -> dict:
    """Act I's tail: the zero-LLM facts-only report that makes the results readable immediately."""
    led = ensure(run_id)
    led["facts_report"] = {"status": status, "at": time.time() if status == DONE else None}
    return _write(led)


def set_projection(run_id: str, calls: int | None, basis: str) -> dict:
    led = ensure(run_id)
    led["projection"] = {"calls": calls, "basis": basis}
    return _write(led)


def end(run_id: str, status: str, reason: str = "") -> dict:
    """Close the ledger, and mark every stage that never ran as SKIPPED — the honest 'never run' list
    the skipped/degraded screens read. A stage that already ran keeps its own status."""
    led = ensure(run_id)
    for row in led["stages"]:
        if row.get("status") in (PENDING, RUNNING):
            row["status"] = SKIPPED
    led["ended"] = {"status": status, "at": time.time(), "reason": reason}
    return _write(led)


def total_llm_calls(led: dict) -> int:
    return sum(int(s.get("llm_calls") or 0) for s in led.get("stages", []))
