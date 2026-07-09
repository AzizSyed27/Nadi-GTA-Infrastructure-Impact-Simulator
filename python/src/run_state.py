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
    if st.get("status") == "running" and (time.time() - st.get("updated_at", 0)) > STALE_S:
        st.update({"status": "failed", "stage": "failed", "detail": "stale (no update) — treated as failed"})
    return st


def list_all() -> list[dict]:
    out = []
    if not STATE_DIR.is_dir():
        return out
    for p in sorted(STATE_DIR.glob("*.json"), reverse=True):
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
