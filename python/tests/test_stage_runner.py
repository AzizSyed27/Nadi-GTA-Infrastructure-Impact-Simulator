"""V2.7b C6a — the stage runner: the physics, then the results document, then the interpretation.

FOUR PROPERTIES ARE LOAD-BEARING, and each has a way of failing that would not announce itself:

  * **the chain ships dark.** `NADI_AUTO_ENRICH` defaults off, because turning it on before a skip
    button and a cost line exist would mean a window where pressing Run spends a couple of hundred
    model calls with no brake and nothing on screen saying so.
  * **one lock, held across every stage.** A per-stage re-acquire opens a steal window, lets the SSE
    orphan guard inject a terminal mid-chain (it fires on free-lock + terminal-state), and writes one
    `done` edge per stage where the client expects one per run.
  * **protected runs are re-checked before EVERY stage**, not once at the top.
  * **the results document runs on every completed quant run**, chain or no chain, and SOFT-FAILS —
    a run that produced numbers is a good run even if its document could not be assembled.

Run: python -m pytest python/tests/test_stage_runner.py -v
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "python" / "src"))

import run_events  # noqa: E402
import run_ledger  # noqa: E402
import run_state  # noqa: E402
import trajectory_io  # noqa: E402

try:
    import server  # noqa: E402
except Exception:  # pragma: no cover
    pytest.skip("server deps unavailable (SUMO / lightrag / torch)", allow_module_level=True)

RUN = "multimodal-scenario-19990101T000000Z"


@pytest.fixture()
def env(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(run_state, "STATE_DIR", tmp_path / "state")
    monkeypatch.setattr(run_events, "EVENTS_ROOT", tmp_path / "events")
    run_state.release()
    yield tmp_path
    run_state.release()


class _Runs:
    """Record every cmd the runner launches; fail the ones whose script is in `fail`."""

    def __init__(self, fail: set[str] | None = None, usage: dict[str, int] | None = None):
        self.cmds: list[list[str]] = []
        self.fail = fail or set()
        self.usage = usage or {}

    def __call__(self, cmd, **kw):
        self.cmds.append(cmd)
        script = Path(cmd[1]).stem
        # a real subprocess would emit its own stage_usage as it exits; stand in for that
        ev = kw.get("env", {}).get(run_events.ENV_VAR)
        if ev and script in self.usage:
            run_events.emit(Path(ev), "stage_usage", stage=_STAGE_OF[script], calls=self.usage[script])

        class _P:
            returncode = 1 if script in self.fail else 0
            stderr = f"{script} exploded" if script in self.fail else ""
        return _P()

    @property
    def scripts(self) -> list[str]:
        return [Path(c[1]).stem for c in self.cmds]


_STAGE_OF = {"reactions": "voices", "propagation": "discourse", "report": "report",
             "report_agent": "index"}


def _begin(monkeypatch, runs: _Runs) -> Path:
    monkeypatch.setattr(server.subprocess, "run", runs)
    ev = run_events.events_path(RUN)
    run_events.begin(ev, RUN, description="a closure")
    run_state.set_stage(RUN, "queued", "queued")
    assert run_state.try_acquire(RUN)
    return ev


def _events(ev: Path) -> list[dict]:
    got, _ = run_events.read_from(ev, 0)
    return [e for _, e in got]


def _kinds(ev: Path) -> list[str]:
    return [e["event"] for e in _events(ev)]


# ------------------------------------------------------------------------------- the dark default

def test_auto_enrich_defaults_off_and_the_env_var_is_the_only_switch(monkeypatch):
    monkeypatch.delenv(server.AUTO_ENRICH_ENV, raising=False)
    assert server.auto_enrich_enabled() is False, "the chain must not be armed by default"
    for off in ("0", "", "false", "FALSE", "no"):
        monkeypatch.setenv(server.AUTO_ENRICH_ENV, off)
        assert server.auto_enrich_enabled() is False
    for on in ("1", "true", "yes"):
        monkeypatch.setenv(server.AUTO_ENRICH_ENV, on)
        assert server.auto_enrich_enabled() is True


def test_dark_run_does_the_physics_and_the_results_document_and_stops(env, monkeypatch):
    """With the chain off the behavior is today's, PLUS the zero-LLM results document — which is not
    interpretation and is what makes the figures readable the moment the physics ends."""
    monkeypatch.delenv(server.AUTO_ENRICH_ENV, raising=False)
    runs = _Runs()
    ev = _begin(monkeypatch, runs)
    server._run_quant_then_chain(RUN, ["py", "scenario_harness.py"], ev)

    assert runs.scripts == ["scenario_harness", "report"], "no interpretation stage may run"
    assert "--facts-only" in runs.cmds[1], "the results document is the zero-LLM one"
    assert run_state.active() is None, "the lock is released"
    led = run_ledger.read(RUN)
    assert led["quant"]["status"] == "done"
    assert led["facts_report"]["status"] == "done"
    assert led["ended"]["status"] == "complete"
    assert all(s["status"] == "skipped" for s in led["stages"]), "never-run stages say so honestly"
    assert _kinds(ev)[-1] == "run_ended"


# ------------------------------------------------------------------------------------- the chain

def test_the_armed_chain_runs_every_stage_in_order_under_one_lock(env, monkeypatch):
    monkeypatch.setenv(server.AUTO_ENRICH_ENV, "1")
    runs = _Runs(usage={"reactions": 213, "propagation": 40, "report": 13, "report_agent": 7})
    ev = _begin(monkeypatch, runs)
    holds: list[str | None] = []
    real = server._run_cmds

    def spy(*a, **k):
        holds.append(run_state.active())  # the lock must be held for EVERY stage
        return real(*a, **k)

    monkeypatch.setattr(server, "_run_cmds", spy)
    server._run_quant_then_chain(RUN, ["py", "scenario_harness.py"], ev)

    assert runs.scripts == ["scenario_harness", "report", "sampler", "reactions", "propagation",
                            "report", "report_agent"]
    assert holds and set(holds) == {RUN}, "one acquire held across the whole chain"
    assert run_state.active() is None, "…and released exactly once, at the end"

    led = run_ledger.read(RUN)
    assert [s["status"] for s in led["stages"]] == ["done"] * 6
    assert led["ended"]["status"] == "complete"
    # per-stage cost folded from each subprocess's own report, keyed by the PRESENTED stage
    by_key = {s["key"]: s["llm_calls"] for s in led["stages"]}
    assert by_key["voices"] == 213 and by_key["discourse"] == 40
    assert by_key["report"] == 13 and by_key["index"] == 7
    assert by_key["personas"] == 0 and by_key["institutions"] == 0, "these stages call no model"
    assert run_ledger.total_llm_calls(led) == 273

    # exactly ONE terminal state write and ONE run_ended for the whole chain
    assert _kinds(ev).count("run_ended") == 1
    assert run_state.read(RUN)["stage"] == "done"


def test_a_failing_stage_degrades_the_run_without_harming_it(env, monkeypatch):
    """The run is unharmed and says so: every number came from the physics and none of them moves."""
    monkeypatch.setenv(server.AUTO_ENRICH_ENV, "1")
    runs = _Runs(fail={"propagation"})
    ev = _begin(monkeypatch, runs)
    server._run_quant_then_chain(RUN, ["py", "scenario_harness.py"], ev)

    assert runs.scripts == ["scenario_harness", "report", "sampler", "reactions", "propagation"]
    assert "report_agent" not in runs.scripts, "the chain stops at the failure"
    led = run_ledger.read(RUN)
    assert run_ledger.stage(led, "voices")["status"] == "done", "what landed is kept"
    assert run_ledger.stage(led, "discourse")["status"] == "failed"
    assert run_ledger.stage(led, "report")["status"] == "skipped"
    assert led["ended"]["status"] == "degraded" and "propagation exploded" in led["ended"]["reason"]
    # the RUN is still done — a failed interpretation is not a failed run
    assert run_state.read(RUN)["status"] == "done"
    assert run_state.read(RUN)["detail"] == "run complete (interpretation incomplete)"
    ended = [e for e in _events(ev) if e["event"] == "run_ended"]
    assert len(ended) == 1 and ended[0]["status"] == "degraded"
    assert run_state.active() is None


def test_a_failing_quant_never_reaches_the_document_or_the_chain(env, monkeypatch):
    monkeypatch.setenv(server.AUTO_ENRICH_ENV, "1")
    runs = _Runs(fail={"scenario_harness"})
    ev = _begin(monkeypatch, runs)
    server._run_quant_then_chain(RUN, ["py", "scenario_harness.py"], ev)

    assert runs.scripts == ["scenario_harness"]
    led = run_ledger.read(RUN)
    assert led["quant"]["status"] == "failed" and led["ended"]["status"] == "failed"
    assert led["facts_report"]["status"] == "pending", "no numbers → no document to write"
    assert run_state.read(RUN)["status"] == "failed"
    assert run_state.active() is None


def test_the_results_document_soft_fails_and_the_run_stays_complete(env, monkeypatch):
    """A quant run that produced numbers is a good run. If the document cannot be assembled the run
    is still done — the Read stage already has a labeled state for a missing report."""
    monkeypatch.delenv(server.AUTO_ENRICH_ENV, raising=False)
    runs = _Runs(fail={"report"})
    ev = _begin(monkeypatch, runs)
    server._run_quant_then_chain(RUN, ["py", "scenario_harness.py"], ev)

    led = run_ledger.read(RUN)
    assert led["quant"]["status"] == "done"
    assert led["facts_report"]["status"] == "failed"
    assert led["ended"]["status"] == "complete", "the RUN completed; only its document did not"
    st = run_state.read(RUN)
    assert st["status"] == "done" and "results document unavailable" in st["detail"]
    assert run_state.active() is None


# ---------------------------------------------------------------------------- the protected set

def test_a_protected_run_never_auto_chains_and_is_re_checked_every_stage(env, monkeypatch):
    """Membership is re-checked before EVERY stage, not once at the top — a stage that rewrites a
    landing-load-bearing artifact is not something to protect only on the first iteration."""
    monkeypatch.setenv(server.AUTO_ENRICH_ENV, "1")
    protected = trajectory_io.EXAMPLE_RUN_ID
    monkeypatch.setattr(run_state, "STATE_DIR", run_state.STATE_DIR)
    runs = _Runs()
    monkeypatch.setattr(server.subprocess, "run", runs)
    ev = run_events.events_path(protected)
    run_events.begin(ev, protected)
    run_state.set_stage(protected, "queued", "queued")
    assert run_state.try_acquire(protected)
    server._run_quant_then_chain(protected, ["py", "scenario_harness.py"], ev)

    assert runs.scripts == ["scenario_harness", "report"], "physics + document only; no enrich"
    led = run_ledger.read(protected)
    assert led["ended"]["status"] == "skipped"
    assert trajectory_io.EXAMPLE_RUN_ID in led["ended"]["reason"]
    assert run_state.active() is None


def test_the_protected_check_runs_before_every_stage_not_once(env, monkeypatch):
    """Hoisting the guard out of the loop would still pass the test above. This one fails if it is
    hoisted: protection that begins mid-chain stops the chain there, because the question is asked
    again before each stage rather than remembered from the first."""
    monkeypatch.setenv(server.AUTO_ENRICH_ENV, "1")
    protected = trajectory_io.EXAMPLE_RUN_ID
    asked = {"n": 0}

    def blocked_from_the_third_ask(rid: str) -> bool:
        asked["n"] += 1
        return asked["n"] >= 3  # stages 1 and 2 proceed; the third is refused

    monkeypatch.setattr(trajectory_io, "pinned_enrich_blocked", blocked_from_the_third_ask)
    runs = _Runs()
    monkeypatch.setattr(server.subprocess, "run", runs)
    ev = run_events.events_path(protected)
    run_events.begin(ev, protected)
    run_state.set_stage(protected, "queued", "queued")
    assert run_state.try_acquire(protected)
    server._run_quant_then_chain(protected, ["py", "scenario_harness.py"], ev)

    assert asked["n"] == 3, "asked once per stage, and the third answer stopped the chain"
    assert runs.scripts == ["scenario_harness", "report", "sampler", "reactions"]
    led = run_ledger.read(protected)
    assert run_ledger.stage(led, "voices")["status"] == "done", "what ran before the refusal is kept"
    assert run_ledger.stage(led, "discourse")["status"] == "skipped"
    assert led["ended"]["status"] == "skipped"
    assert run_state.active() is None


# --------------------------------------------------------------------------- the lock never leaks

def test_the_lock_is_released_even_when_the_runner_itself_raises(env, monkeypatch):
    """Every exit path goes through the finally: a raise in the ledger write, the protected check or
    the cancel-file read must not strand the one-job slot until the server restarts."""
    monkeypatch.delenv(server.AUTO_ENRICH_ENV, raising=False)
    runs = _Runs()
    ev = _begin(monkeypatch, runs)
    monkeypatch.setattr(server.run_ledger, "set_quant",
                        lambda *a, **k: (_ for _ in ()).throw(OSError("sidecar write failed")))
    with pytest.raises(OSError):
        server._run_quant_then_chain(RUN, ["py", "scenario_harness.py"], ev)
    assert run_state.active() is None, "the slot is free for the next run"
