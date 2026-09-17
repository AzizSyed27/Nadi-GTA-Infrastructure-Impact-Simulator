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
    for term in ("report slots", "discourse cascade", "chat index", "institutions cost nothing",
                 "retries push the actual above this"):
        assert term in proj["basis"], f"the basis must name {term!r}"


def test_the_projection_never_hides_the_terms_that_dominate_it() -> None:
    """Voices and report slots are ~225 calls; the DISCOURSE and the CHAT INDEX are thousands. A
    projection missing either understates by a multiple — the one direction a consent number may
    never err in, and the direction the first version of this function actually erred in (it read
    1,815 against a metered ~5,000 on C11's acceptance run, having omitted propagation's own stance
    scoring and the index stage entirely). Both dominant terms must be in the TOTAL and named in the
    BASIS, so a reader can see what they are consenting to and check it afterwards."""
    p = server._project_interpretation(instrumented=212)
    voices_and_slots = 212 + server.REPORT_SLOT_ESTIMATE
    assert p["calls"] > 10 * voices_and_slots, "the cascades and the index are missing from the total"
    # each large term appears in the basis as its own figure, not folded into an opaque total
    acting = round(server.CASCADE_ACTIVATION * 212)
    discourse = 3 * (server.CASCADE_STEPS * acting + round(server.CASCADE_SCORING_PER_AGENT * 212))
    assert str(discourse) in p["basis"], "the discourse term is not shown"
    assert "chat index" in p["basis"] and "documents" in p["basis"], "the index term is not shown"
    # and the total is the sum of the four terms — no rounding slop hiding a fifth. The voices
    # term carries the MEASURED retry allowance (the V2.7d follow-up): the sample, one call each,
    # plus the retries the acceptance run actually made.
    corpus = 212 + round(server.CASCADE_POSTS_PER_CALL * 3 * server.CASCADE_STEPS * acting)
    assert p["calls"] == 212 + server.retry_allowance(212) + server.REPORT_SLOT_ESTIMATE + discourse + round(
        server.INDEX_CALLS_PER_DOC * corpus)


# ------------------------------------------------------- the per-STAGE projections (V2.7d follow-up)
# The run card's three enrich buttons and the manual enrich's cost line read a STAGE's projection,
# composed from the same terms as the whole — one cost model, three callers. Measured on C11's run A:
# voices 213 (212 records + one audit retry), report 10 + chat index 2,751 (the report BUTTON rebuilds
# the index too), discourse 2,231. A stage projection sits ABOVE its measured stage, or it understates
# on a consent surface — the one direction it may never err in.

def test_each_stage_projection_sits_above_the_measured_acceptance_run() -> None:
    assert server._project_stage("voices")["calls"] >= 213, "212 records metered 213 — the retry"
    assert server._project_stage("report")["calls"] >= 10 + 2751, "the report button rebuilds the index"
    assert server._project_stage("discourse")["calls"] >= 2231


def test_the_stage_projections_partition_the_whole() -> None:
    """The three buttons add up to the Run button's number — the index rides `report`, because that is
    what the button launches; nothing is counted twice and nothing is dropped."""
    whole = server._project_interpretation()["calls"]
    parts = sum(server._project_stage(s)["calls"] for s in ("voices", "report", "discourse"))
    assert parts == whole, f"{parts} != {whole}"


def test_each_stage_basis_names_its_terms_and_the_retry_clause() -> None:
    v = server._project_stage("voices")["basis"]
    assert "one call each" in v and "retry" in v and "institutions cost nothing" in v
    assert "standard sample" in v, "pre-sampler, the count is the configured sample — and says so"
    r = server._project_stage("report")["basis"]
    assert "report slots" in r and "chat index" in r and "documents" in r
    d = server._project_stage("discourse")["basis"]
    assert "cascade" in d and "scoring" in d
    for b in (v, r, d):
        assert "retries push the actual above this" in b


def test_the_voices_retry_allowance_is_measured_and_rounds_up() -> None:
    """One retry in 212 on run A is 0.47 %; the allowance is the next whole percent, never less than one
    call — over-estimating is the safe side of a consent number (the C11 terms' own rule)."""
    assert server.VOICE_RETRY_ALLOWANCE == 0.01
    assert server.retry_allowance(212) >= 1
    assert server.retry_allowance(1) == 1, "floored at one call"
    assert server.retry_allowance(1000) == 10


def test_an_unknown_stage_is_refused_not_guessed() -> None:
    with pytest.raises(ValueError):
        server._project_stage("index")


def test_the_projection_errs_HIGH_not_low_against_the_measured_acceptance_run() -> None:
    """C11's run A metered 5,205 calls end to end: voices 213, discourse 2,231, report 10, chat
    index 2,751. The projection must sit ABOVE that, not below it — a consent number that comes in
    under the bill is the failure this test exists for, and the first version of this function came
    in at 1,815. The margin may be generous: an estimate that overstates costs a reader nothing."""
    p = server._project_interpretation(instrumented=213)
    assert p["calls"] >= 5205, f"projection {p['calls']} is below the measured acceptance run"


def test_the_pre_run_projection_says_the_count_is_a_standin() -> None:
    """Before a run exists there is no instrumented count, so it falls back to the sampler's
    configured sample — and says so, rather than presenting a guess as a measurement."""
    pre = server._project_interpretation()
    assert "standard sample" in pre["basis"]
    assert "sampled travelers" not in pre["basis"]
    assert server._project_interpretation(instrumented=213)["calls"] > pre["calls"]


# --------------------------------------------------------------------------------- the stale guess
# V2.7b C11: staleness is a GUESS about a process nobody can see; the lock is a FACT about one this
# process owns. Caught live during the acceptance — the chat index worked honestly for 37 minutes
# without writing state (a chain stage writes once at its start) and `/status` reported the live run
# as `failed - stale`, which stops the client's poll and unmounts the act mid-run.


def _stale_running(env, run_id: str = "stale-run") -> None:
    import json
    import time
    p = run_state.STATE_DIR / f"{run_id}.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps({
        "run_id": run_id, "stage": "enrich:index", "status": "running",
        "detail": "building the chat index", "updated_at": time.time() - (run_state.STALE_S + 60),
    }), encoding="utf-8")


def test_a_stale_running_state_is_still_treated_as_failed_when_nobody_holds_the_lock(env):
    """The fallback the coercion exists for: a process that died without writing a terminal state."""
    _stale_running(env)
    assert run_state.active() is None
    st = run_state.read("stale-run")
    assert st["status"] == "failed" and "stale" in st["detail"]


def test_the_HELD_LOCK_outranks_the_stale_guess(env):
    """...but not when THIS process is demonstrably running THAT run. Otherwise a long honest stage
    is reported as a crash, which is the worse error: it is wrong, and it is wrong in the direction
    that makes a working run look broken."""
    _stale_running(env)
    assert run_state.try_acquire("stale-run"), "test setup: the lock must be free"
    try:
        st = run_state.read("stale-run")
        assert st["status"] == "running", "a run this process is actively holding is not stale"
        assert st["stage"] == "enrich:index" and st["detail"] == "building the chat index"
    finally:
        run_state.release("stale-run")
    # and the guess resumes the moment the lock is gone
    assert run_state.read("stale-run")["status"] == "failed"


def test_the_lock_exemption_is_scoped_to_the_run_that_holds_it(env):
    """A different run holding the lock says nothing about this one."""
    _stale_running(env)
    assert run_state.try_acquire("some-other-run")
    try:
        assert run_state.read("stale-run")["status"] == "failed"
    finally:
        run_state.release("some-other-run")
