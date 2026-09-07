"""V2.7b C10a — EVERY EXIT PATH LEAVES THE RUN TERMINAL. A property test, not a happy-path check.

WHY THIS IS A PROPERTY AND NOT AN EXAMPLE. `run_state.set_stage` derives status from the stage
STRING: anything that is not literally "done" or "failed" reads as "running". So a chain that
returns after writing `enrich:report` leaves a finished run whose state says it is still working —
and three consumers key on exactly that:

  * the client's poll loop (`useRunFeed`: `status === 'done' || 'failed'`) never stops,
  * the SSE end-of-stream predicate (`_run_is_over`) never fires, so the stream heartbeats forever,
  * the run list shows the run as "computing", indefinitely.

The only thing that ever ended such a run was `run_state`'s 30-minute stale coercion, which is a
READ-side fallback that never rewrites the file. All of it was harmless while the chain was dark.
The moment C10b arms it, every chained run that takes one of the quiet paths sits in the list as
"computing" until the reader gives up — so the fix is pinned here, before the flip, as a property
over ALL the ways the runner can return rather than over the one that already worked.

Three paths were writing no terminal state at all: the pinned-run refusal, the no-auto-enrich exit,
and any exception (whose `finally` only released the lock). Two more are asserted for a subtler
reason — the degraded path used to let `_run_cmds` write "failed" and then corrected it to "done",
so a poll landing between the two saw a run that had failed when it had not.

Run: python -m pytest python/tests/test_terminal_state.py -v
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

RUN = "multimodal-scenario-19990101T000001Z"
TERMINAL = ("done", "failed")


@pytest.fixture()
def env(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(run_state, "STATE_DIR", tmp_path / "state")
    monkeypatch.setattr(run_events, "EVENTS_ROOT", tmp_path / "events")
    # run_ledger resolves through run_state.STATE_DIR, so the one patch above covers both
    monkeypatch.setenv(server.AUTO_ENRICH_ENV, "1")  # armed, so the chain paths are reachable
    run_state.release()
    yield tmp_path
    run_state.release()


class _Runs:
    """Stand in for every subprocess. `fail` names the scripts that exit non-zero."""

    def __init__(self, fail: set[str] | None = None):
        self.cmds: list[list[str]] = []
        self.fail = fail or set()

    def __call__(self, cmd, **kw):
        self.cmds.append(cmd)
        script = Path(cmd[1]).stem

        class _P:
            returncode = 1 if script in self.fail else 0
            stderr = f"{script} exploded" if script in self.fail else ""
        return _P()


def _begin(monkeypatch, runs: _Runs) -> Path:
    monkeypatch.setattr(server.subprocess, "run", runs)
    ev = run_events.events_path(RUN)
    run_events.begin(ev, RUN, description="a closure")
    run_state.set_stage(RUN, "queued", "queued")
    assert run_state.try_acquire(RUN)
    return ev


def _assert_over(why: str) -> None:
    """THE PROPERTY. Terminal state AND a free lock — the two halves `_run_is_over` reads."""
    st = run_state.read(RUN)
    assert st is not None, f"{why}: the run has no state at all"
    assert st.get("status") in TERMINAL, (
        f"{why}: run-state says {st.get('status')!r} (stage {st.get('stage')!r}) — a finished run "
        f"that reads as running polls forever and sits in the run list as 'computing'")
    assert run_state.active() is None, f"{why}: the one-job slot is still held"


# ------------------------------------------------------------------------------- the seven paths

def test_all_stages_ok(env, monkeypatch):
    _begin(monkeypatch, runs := _Runs())
    server._run_quant_then_chain(RUN, ["py", "scenario_harness.py"], run_events.events_path(RUN))
    assert runs.cmds, "the runner launched nothing"
    _assert_over("all stages ok")


def test_quant_failure(env, monkeypatch):
    _begin(monkeypatch, _Runs(fail={"scenario_harness"}))
    server._run_quant_then_chain(RUN, ["py", "scenario_harness.py"], run_events.events_path(RUN))
    _assert_over("quant failed")
    assert run_state.read(RUN)["status"] == "failed", "a failed physics run is a FAILED run"


def test_no_auto_enrich(env, monkeypatch):
    """The dark default's own path. It wrote no terminal state and leaned entirely on the harness
    subprocess having written one — which the fake above deliberately does not do, exactly as a
    crashed-after-writing-nothing harness would not."""
    monkeypatch.setenv(server.AUTO_ENRICH_ENV, "0")
    _begin(monkeypatch, _Runs())
    server._run_quant_then_chain(RUN, ["py", "scenario_harness.py"], run_events.events_path(RUN))
    _assert_over("interpretation not requested")


def test_a_chain_stage_failing_is_DEGRADED_not_a_failed_run(env, monkeypatch):
    """And the run must never pass THROUGH 'failed' on the way: every number came from the physics
    and still stands, so a poll landing mid-correction must not see a run that failed."""
    seen: list[str] = []
    real = run_state.set_stage
    monkeypatch.setattr(run_state, "set_stage",
                        lambda rid, stage, *a, **k: (seen.append(stage), real(rid, stage, *a, **k))[1])
    _begin(monkeypatch, _Runs(fail={"propagation"}))
    server._run_quant_then_chain(RUN, ["py", "scenario_harness.py"], run_events.events_path(RUN))
    _assert_over("a chain stage failed")
    assert run_state.read(RUN)["status"] == "done"
    assert "failed" not in seen, f"the run flashed a 'failed' state on its way to degraded: {seen}"
    led = run_ledger.read(RUN)
    assert led["ended"]["status"] == run_ledger.DEGRADED


def test_the_protected_run_refusal(env, monkeypatch):
    """The quietest path of the three: it wrote the ledger and the event and returned, leaving the
    last `enrich:*` stage string behind as the run's state."""
    monkeypatch.setattr(trajectory_io, "pinned_enrich_blocked", lambda rid: True)
    monkeypatch.setattr(trajectory_io, "enrich_refusal_reason", lambda rid: "protected run")
    _begin(monkeypatch, _Runs())
    server._run_quant_then_chain(RUN, ["py", "scenario_harness.py"], run_events.events_path(RUN))
    _assert_over("protected-run refusal")
    assert run_ledger.read(RUN)["ended"]["status"] == run_ledger.SKIPPED_END


def test_skip(env, monkeypatch):
    runs = _Runs()
    ev = _begin(monkeypatch, runs)
    run_events.request_cancel(RUN)
    server._run_quant_then_chain(RUN, ["py", "scenario_harness.py"], ev)
    _assert_over("stopped at your request")
    assert run_ledger.read(RUN)["ended"]["status"] == run_ledger.SKIPPED_END


def test_the_runner_raising(env, monkeypatch):
    """The `finally` released the lock and nothing else, so a crash left the run 'running' for the
    30-minute stale window — indistinguishable, to every reader, from a run still working."""
    ev = _begin(monkeypatch, _Runs())
    monkeypatch.setattr(server.run_ledger, "set_quant",
                        lambda *a, **k: (_ for _ in ()).throw(OSError("sidecar write failed")))
    with pytest.raises(OSError):
        server._run_quant_then_chain(RUN, ["py", "scenario_harness.py"], ev)
    _assert_over("the runner raised")
    assert run_state.read(RUN)["status"] == "failed", "an unexplained stop is a FAILURE, not a done run"


# ------------------------------------------------------------------- the flag that outlived a skip

def test_a_skip_does_not_silently_cancel_the_next_enrich(env, monkeypatch):
    """THE LATENT BUG C10 HAD TO CLOSE BEFORE SHIPPING A SKIP BUTTON.

    The cancel flag is a FILE. `prune()` globs only `*.events.jsonl` and resume was its single
    clearer, so after a skip it survived indefinitely — and the next manual enrich launched with it
    still set. `reactions` checks it at its first checkpoint, returns None for every voice, and the
    stage exits 0 reporting 'complete' with ZERO agents. Nothing errors; the run simply has no
    voices and no explanation. C10 ships the button that makes skipping routine, so C10 clears the
    flag at both ends: when the skip ending is written, and again at every enrich launch."""
    ev = _begin(monkeypatch, _Runs())
    run_events.request_cancel(RUN)
    server._run_quant_then_chain(RUN, ["py", "scenario_harness.py"], ev)
    assert not run_events.cancelled(RUN), (
        "the skip ending left its cancel flag behind — the next enrich would generate nothing")


# ------------------------------------------------------------------------------ the projection

def test_the_chain_writes_a_projection_whose_basis_names_its_terms(env, monkeypatch):
    """`set_projection` and its client field have both existed since C2 with nothing between them.
    The number a reader consents to before pressing Run and the number the ledger reports must come
    from ONE function, so the endpoint (C10b) and the chain call the same one."""
    _begin(monkeypatch, _Runs())
    server._run_quant_then_chain(RUN, ["py", "scenario_harness.py"], run_events.events_path(RUN))
    proj = run_ledger.read(RUN)["projection"]
    assert proj["calls"] and proj["calls"] > 0
    for term in ("report slots", "discourse cascade", "institutions cost nothing", "Retries"):
        assert term in proj["basis"], f"the basis must name {term!r}"


def test_the_projection_never_hides_the_term_that_dominates_it() -> None:
    """Discourse is ~90% of the spend (3 cascades x 5 steps x half the agents). A projection that
    counted only voices and report slots would understate by an order of magnitude — the one
    direction a consent number may never err in."""
    p = server._project_interpretation(instrumented=212)
    voices_and_slots = 212 + server.REPORT_SLOT_ESTIMATE
    assert p["calls"] > 5 * voices_and_slots, "the cascades are missing from the total"
    assert str(p["calls"] - voices_and_slots) in p["basis"], "the cascade term is not shown"


def test_the_pre_run_projection_says_the_count_is_a_standin() -> None:
    """Before a run exists there is no instrumented count, so it falls back to the sampler's
    configured sample — and says so, rather than presenting a guess as a measurement."""
    pre = server._project_interpretation()
    assert "standard sample" in pre["basis"]
    assert "sampled travelers" not in pre["basis"]
    assert server._project_interpretation(instrumented=213)["calls"] > pre["calls"]
