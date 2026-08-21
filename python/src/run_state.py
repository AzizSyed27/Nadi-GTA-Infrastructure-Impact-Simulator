"""Phase 5.1 — minimal on-disk run-state + a one-job lock for the job-runner API.

State lives in ``contract/runs/state/<run_id>.json`` (the whole ``contract/runs/`` tree is gitignored). It sits
in its OWN subdir — NOT flat next to the artifacts — because a state file named ``multimodal-scenario-*.json``
would otherwise be caught by the artifact-discovery globs (``report``/``robustness``/``scorecard``/golden all do
``RUNS_DIR.glob("multimodal-scenario-*.json")[-1]``) and be mistaken for the newest run artifact. No DB, no
queue — an MVP. The SUBPROCESS pipeline writes stages via ``set_stage``; the API process reads them and holds the
in-process ``try_acquire``/``release`` lock (uvicorn is single-process). A "running" state that stopped
updating (server/subprocess died mid-run) is reported as failed on read — the orphan case, handled cheaply.
"""

from __future__ import annotations

import json
import threading
import time
from pathlib import Path

RUNS_DIR = Path(__file__).resolve().parents[2] / "contract" / "runs"
STATE_DIR = RUNS_DIR / "state"  # own subdir — keeps state out of the artifact `*.json` glob namespace
STALE_S = 30 * 60  # a "running" state with no update for this long is treated as failed (crashed mid-run)
_TERMINAL = {"done", "failed"}

_LOCK = threading.Lock()
_ACTIVE: dict = {"run_id": None, "started_at": 0.0}  # the one active job (simulate OR enrich)


def _path(run_id: str) -> Path:
    return STATE_DIR / f"{run_id}.json"


def set_stage(run_id: str, stage: str, detail: str = "", **extra) -> dict:
    """Merge-write the run's state. stage in {regen,baseline,scenario,analysis,done,failed,...}; status is the
    stage itself when terminal (done/failed), else 'running'. First write stamps started_at."""
    p = _path(run_id)
    now = time.time()
    st: dict = {}
    if p.is_file():
        try:
            st = json.loads(p.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            st = {}
    st.setdefault("run_id", run_id)
    st.setdefault("started_at", now)
    st.update({"stage": stage, "status": stage if stage in _TERMINAL else "running",
               "detail": detail, "updated_at": now})
    st.update(extra)
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(st, indent=2), encoding="utf-8")
    return st


def read(run_id: str) -> dict | None:
    p = _path(run_id)
    if not p.is_file():
        return None
    try:
        st = json.loads(p.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return None
    # a STATE file always carries run_id (set_stage stamps it). Anything else in this dir (the
    # V2.2d composite spec files, stray JSON) is NOT run state — refusing here keeps a single
    # foreign file from 500-ing GET /api/runs for every run (review-caught, reproduced live).
    if "run_id" not in st:
        return None
    if st.get("status") == "running" and (time.time() - st.get("updated_at", 0)) > STALE_S:
        st.update({"status": "failed", "stage": "failed", "detail": "stale (no update) — treated as failed"})
    return st


# V2.4c — the run-identity SIDECAR (user name/note). A separate file with exactly ONE writer (the
# identity endpoint) is race-free against the harness's unlocked read-merge-write set_stage BY
# CONSTRUCTION — a rename works even mid-run — and keeps state files harness-only (D5: the
# artifact/state is the simulation record, the sidecar is the workspace).
IDENTITY_SUFFIX = ".identity.json"


def _identity_path(run_id: str):
    return STATE_DIR / f"{run_id}{IDENTITY_SUFFIX}"


def identity(run_id: str) -> dict:
    """The run's user-supplied {name?, note?} — {} on missing/corrupt/foreign content (a
    sync-damaged sidecar must degrade, never 500 a list)."""
    p = _identity_path(run_id)
    if not p.is_file():
        return {}
    try:
        d = json.loads(p.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return {}
    if not isinstance(d, dict):
        # review-caught (the read() bug class, again): VALID JSON with a non-dict top level
        # (a list, null, a number) would AttributeError below — and GET /api/runs calls this in
        # a loop, so one damaged sidecar would 500 the whole list as "backend unreachable".
        return {}
    return {k: d[k] for k in ("name", "note") if isinstance(d.get(k), str) and d[k]}


def set_identity(run_id: str, name: str = "", note: str = "") -> dict:
    """FULL-REPLACE write (the UI sends both fields every save; empty clears). Both empty →
    the sidecar is DELETED, so the state dir stays run-state + handoff specs + live identities."""
    ident = {k: v for k, v in (("name", name.strip()), ("note", note.strip())) if v}
    p = _identity_path(run_id)
    if not ident:
        p.unlink(missing_ok=True)
        return {}
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(ident, indent=2), encoding="utf-8")
    return ident


def list_all() -> list[dict]:
    out = []
    if not STATE_DIR.is_dir():
        return out
    # Ordering ONLY, never a filter (an INVENTORY, not a resolver — junk-named runs stay listed;
    # a planner may legitimately load one from the picker). Digit-first: timestamp-shaped names
    # newest-first, acceptance/smoke names (V22AACCEPT-class — they lexicographically outsort
    # every ts and used to pin themselves to the TOP of the run list) sort LAST.
    for p in sorted(STATE_DIR.glob("*.json"), reverse=True,
                    key=lambda p: (p.stem.rsplit("-", 1)[-1][:1].isdigit(), p.name)):
        if p.name.endswith(".composite.json"):
            continue  # a composite HANDOFF spec (server → harness), not run state
        if p.name.endswith(IDENTITY_SUFFIX):
            continue  # V2.4c: a user identity sidecar (name/note), not run state
        s = read(p.stem)
        if s:
            out.append(s)
    return out


# -------- one-job lock (in-process; uvicorn is single-process) --------
def try_acquire(run_id: str) -> bool:
    """Atomically claim the single job slot. Returns False if a job is already active."""
    with _LOCK:
        if _ACTIVE["run_id"] is not None:
            return False
        _ACTIVE.update(run_id=run_id, started_at=time.time())
        return True


def release() -> None:
    with _LOCK:
        _ACTIVE["run_id"] = None


def active() -> str | None:
    with _LOCK:
        return _ACTIVE["run_id"]
