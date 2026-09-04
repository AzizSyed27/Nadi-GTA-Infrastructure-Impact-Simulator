"""V2.7b C6b — the brake: skip the rest and keep what landed, then resume from where it stopped.

An un-cancellable interpretation turns iteration into a queue: a planner who has seen enough of one
variant should not have to wait out a couple of hundred model calls to try the next. So the brake is
not a nicety, and three things about it are load-bearing:

  * **skip never releases the lock itself.** It writes a flag; the running stage releases through its
    own `finally` once it has stopped safely. Releasing from the endpoint would hand the slot away
    while a subprocess is still writing into the run's files — the exact steal `release(run_id)`
    exists to prevent.
  * **what landed is kept, and nothing is invented to fill the gap.** A cancelled voice returns
    nothing rather than a fallback: `_fallback()` is for a model that answered badly, and using it
    here would fabricate a resident who was never generated.
  * **resume clears the flag FIRST.** A resume that leaves it in place instantly cancels its own
    first stage and looks like a no-op.

Run: python -m pytest python/tests/test_skip_resume.py -v
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "python" / "src"))

import reactions  # noqa: E402
import run_events  # noqa: E402
import run_ledger  # noqa: E402
import run_state  # noqa: E402

try:
    import server  # noqa: E402
    from fastapi.testclient import TestClient  # noqa: E402
except Exception:  # pragma: no cover
    pytest.skip("server deps unavailable (SUMO / lightrag / torch)", allow_module_level=True)

RUN = "multimodal-scenario-19990101T000000Z"


@pytest.fixture()
def client(tmp_path: Path, monkeypatch) -> TestClient:
    monkeypatch.setattr(run_state, "STATE_DIR", tmp_path / "state")
    monkeypatch.setattr(run_events, "EVENTS_ROOT", tmp_path / "events")
    run_state.release()
    yield TestClient(server.app)
    run_state.release()


# --------------------------------------------------------------------------- the cancel channel

def test_the_flag_is_a_file_so_a_subprocess_can_see_it(tmp_path, monkeypatch):
    """An in-process flag cannot reach a subprocess the server already launched with a fixed env —
    which is exactly what every stage is."""
    monkeypatch.setattr(run_events, "EVENTS_ROOT", tmp_path / "events")
    assert run_events.cancelled(RUN) is False
    p = run_events.request_cancel(RUN)
    assert p.is_file() and run_events.cancelled(RUN) is True
    run_events.request_cancel(RUN)  # idempotent
    assert run_events.cancelled(RUN) is True
    run_events.clear_cancel(RUN)
    assert run_events.cancelled(RUN) is False
    run_events.clear_cancel(RUN)  # idempotent when already gone


def test_a_stage_derives_its_own_run_id_from_the_events_path(tmp_path, monkeypatch):
    """A subprocess is handed an events path, not a run id — the no-arg form is what stages call."""
    monkeypatch.setattr(run_events, "EVENTS_ROOT", tmp_path / "events")
    monkeypatch.setenv(run_events.ENV_VAR, str(run_events.events_path(RUN)))
    assert run_events.cancelled() is False
    run_events.request_cancel(RUN)
    assert run_events.cancelled() is True
    monkeypatch.delenv(run_events.ENV_VAR)
    assert run_events.cancelled() is False, "no events path (a CLI run) is never cancelled"


# ------------------------------------------------------------------- what landed is kept, honestly

class _StubClient:
    async def generate_json(self, system: str, user: str, schema, **kw) -> dict:
        return {"comment": "A plain reaction to my own trip.", "sentiment": 0.1, "stance": "neutral"}


def _records(n: int) -> list[dict]:
    return [{"grounding": "inferred", "mode": "inferred",
             "persona": {"id": f"p{i}", "label": f"Persona {i}", "description": "d",
                         "delay_sensitivity": 0.5},
             "stakeholder": "resident"} for i in range(n)]


def test_cancelled_voices_are_dropped_as_matched_pairs_never_faked(tmp_path, monkeypatch):
    """The artifact ends up with FEWER agents, not with placeholder ones — and records/reactions stay
    aligned, or assemble_in_place's zip would silently misattribute every voice after the gap."""
    monkeypatch.setattr(run_events, "EVENTS_ROOT", tmp_path / "events")
    monkeypatch.setenv(run_events.ENV_VAR, str(run_events.events_path(RUN)))
    run_events.request_cancel(RUN)  # cancelled before any generation starts

    records = _records(4)
    results = asyncio.run(reactions.generate_reactions(_StubClient(), records, [], events_path=None))
    assert results == [] and records == [], "nothing generated, nothing invented"

    run_events.clear_cancel(RUN)
    records2 = _records(4)
    results2 = asyncio.run(reactions.generate_reactions(_StubClient(), records2, [], events_path=None))
    assert len(results2) == 4 and len(records2) == 4
    assert all(not fb for _r, fb in results2), "the fallback path is never how a skip is expressed"


def test_the_partial_shape_is_read_off_what_the_stage_emitted(tmp_path, monkeypatch):
    """"47 of 213, kept" vs "213 voices" is the difference between a partial stage and one that
    happened to finish before the stop was noticed. Read it from the stream, not from the clock."""
    monkeypatch.setattr(run_events, "EVENTS_ROOT", tmp_path / "events")
    ev = run_events.events_path(RUN)
    run_events.begin(ev, RUN)
    start = 1
    run_events.emit(ev, "voices_total", total=5)
    for i in range(2):
        run_events.emit(ev, "voice", index=i, done=i + 1, total=5, agent={})
    assert server._stage_was_partial(RUN, ev, start) is True
    for i in range(2, 5):
        run_events.emit(ev, "voice", index=i, done=i + 1, total=5, agent={})
    assert server._stage_was_partial(RUN, ev, start) is False, "it finished; nothing was lost"


# ------------------------------------------------------------------------------- the endpoints

def test_skip_writes_the_flag_and_deliberately_does_not_release_the_lock(client: TestClient):
    run_state.set_stage(RUN, "enrich:voices", "running voices")
    assert run_state.try_acquire(RUN)
    assert client.post("/api/runs/nope/skip").status_code == 404

    r = client.post(f"/api/runs/{RUN}/skip")
    assert r.status_code == 200 and r.json()["cancel_requested"] is True
    assert run_events.cancelled(RUN) is True
    assert run_state.active() == RUN, (
        "the running stage releases through its own finally; releasing here would hand the slot "
        "away while a subprocess is still writing")


def test_resume_runs_only_what_never_ran_and_clears_the_flag_first(client: TestClient, monkeypatch):
    run_state.set_stage(RUN, "done", "run complete")
    run_ledger.init(RUN)
    for key in ("personas", "voices", "institutions"):
        run_ledger.set_stage(RUN, key, run_ledger.DONE)
    run_ledger.end(RUN, run_ledger.SKIPPED_END, reason="stopped at your request")
    run_events.request_cancel(RUN)

    seen: dict = {}
    monkeypatch.setattr(server, "_resume_chain",
                        lambda rid, ev, pending: seen.update(run_id=rid, pending=list(pending)))
    r = client.post(f"/api/runs/{RUN}/resume")
    assert r.status_code == 200
    assert r.json()["resuming"] == ["discourse", "report", "index"]
    assert run_events.cancelled(RUN) is False, "a resume that leaves the flag set cancels itself"
    assert run_state.active() == RUN, "resume takes the one-job lock like every other job"
    run_state.release(RUN)


def test_resume_refuses_when_there_is_nothing_to_resume(client: TestClient):
    run_state.set_stage(RUN, "done", "run complete")
    assert client.post(f"/api/runs/{RUN}/resume").status_code == 409, "no ledger to resume from"

    run_ledger.init(RUN)
    for s in run_ledger.STAGE_KEYS:
        run_ledger.set_stage(RUN, s, run_ledger.DONE)
    r = client.post(f"/api/runs/{RUN}/resume")
    assert r.status_code == 409 and "already ran" in r.json()["detail"]
    assert run_state.active() is None, "a refused resume must not strand the lock"


def test_resume_is_refused_on_a_protected_run(client: TestClient):
    import trajectory_io

    protected = trajectory_io.EXAMPLE_RUN_ID
    run_state.set_stage(protected, "done", "run complete")
    run_ledger.init(protected)
    r = client.post(f"/api/runs/{protected}/resume")
    assert r.status_code == 403
    assert r.json()["detail"] == trajectory_io.enrich_refusal_reason(protected)
    assert run_state.active() is None


# ----------------------------------------------------------------------- the runner's skip ending

class _Runs:
    def __init__(self, cancel_after: str | None = None):
        self.cmds: list[list[str]] = []
        self.cancel_after = cancel_after

    def __call__(self, cmd, **kw):
        self.cmds.append(cmd)
        script = Path(cmd[1]).stem
        if script == self.cancel_after:
            run_events.request_cancel(RUN)  # the user presses skip WHILE this stage runs

        class _P:
            returncode = 0
            stderr = ""
        return _P()

    @property
    def scripts(self) -> list[str]:
        return [Path(c[1]).stem for c in self.cmds]


def test_a_skip_mid_chain_keeps_what_landed_and_ends_the_run_honestly(client: TestClient, monkeypatch):
    monkeypatch.setenv(server.AUTO_ENRICH_ENV, "1")
    runs = _Runs(cancel_after="reactions")
    monkeypatch.setattr(server.subprocess, "run", runs)
    ev = run_events.events_path(RUN)
    run_events.begin(ev, RUN)
    run_state.set_stage(RUN, "queued", "queued")
    assert run_state.try_acquire(RUN)
    server._run_quant_then_chain(RUN, ["py", "scenario_harness.py"], ev)

    assert runs.scripts == ["scenario_harness", "report", "sampler", "reactions"]
    assert "propagation" not in runs.scripts, "the chain stops after the stage that was interrupted"
    led = run_ledger.read(RUN)
    assert run_ledger.stage(led, "voices")["status"] == "done", "what landed is KEPT"
    assert run_ledger.stage(led, "discourse")["status"] == "skipped"
    assert run_ledger.stage(led, "report")["status"] == "skipped"
    assert led["ended"]["status"] == "skipped"
    st = run_state.read(RUN)
    assert st["status"] == "done" and "stopped early" in st["detail"], (
        "the RUN is complete — every number came from the physics")
    kinds = [e["event"] for _n, e in run_events.read_from(ev, 0)[0]]
    assert "stage_partial" in kinds
    assert kinds[-1] == "run_ended"
    assert run_state.active() is None, "the lock is free for the next variant"
