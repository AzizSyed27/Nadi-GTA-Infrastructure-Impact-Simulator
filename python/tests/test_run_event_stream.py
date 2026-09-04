"""V2.3a/V2.7b — the SSE run-event stream + the POST-time ordering invariants + status-derived progress.

TestClient is used WITHOUT the context manager on purpose: lifespan (the LightRAG index load) doesn't run,
requests still route. server.py drags heavy deps — gate the import like test_server_cmd.py does.

V2.7b reshapes three of these pins, and the reshaping IS the point:
  * the file is per-RUN (truncated once at the simulate POST), so the enrich POST no longer truncates —
    it back-fills a header when one is missing and appends ``stage_start``;
  * end-of-stream is STATE-DRIVEN (EOF + terminal state + free lock), closing with a synthesized
    ``stream_end`` CONTROL frame — an interior ``run_ended`` content line must NOT close the stream, or a
    skip-then-resume run could never be replayed past its first ending;
  * derived progress folds from the LAST ``stage_start``, not from line 0, or every later stage would
    open showing the previous stage's completed counter.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "python" / "src"))

import run_events  # noqa: E402
import run_state  # noqa: E402

try:  # heavy: the whole server module (agent stack + SUMO). Skip cleanly if the env lacks them.
    import server  # noqa: E402
    from fastapi.testclient import TestClient  # noqa: E402
except Exception:  # pragma: no cover
    pytest.skip("server deps unavailable (SUMO / lightrag / torch)", allow_module_level=True)

RUN = "multimodal-scenario-19990101T000000Z"


@pytest.fixture()
def client(tmp_path: Path, monkeypatch) -> TestClient:
    monkeypatch.setattr(run_events, "EVENTS_ROOT", tmp_path / "events")
    monkeypatch.setattr(run_state, "STATE_DIR", tmp_path / "state")
    # never launch real subprocesses from a POST in tests
    monkeypatch.setattr(server, "_run_subprocess_job", lambda *a, **k: run_state.release())
    return TestClient(server.app)  # no `with` → lifespan (LightRAG load) never runs


def _frames(text: str) -> list[tuple[int, str]]:
    """Parse SSE text into (id, event) pairs, ignoring comment/heartbeat frames."""
    out = []
    for block in text.split("\n\n"):
        lines = dict(ln.split(": ", 1) for ln in block.splitlines() if ": " in ln and not ln.startswith(":"))
        if "id" in lines and "event" in lines:
            out.append((int(lines["id"]), lines["event"]))
    return out


def _seed_events(run_id: str, upto: str = "run_ended") -> Path:
    p = run_events.events_path(run_id)
    run_events.begin(p, run_id, description="a closure")
    run_events.emit(p, "stage_start", stage="enrich:voices", label="enrich:voices", kind="llm",
                    stages=["sampling travelers", "generating voices"])
    run_events.emit(p, "cmd_start", i=0, n=2, label="sampling travelers")
    run_events.emit(p, "voices_total", total=3)
    run_events.emit(p, "voice", index=0, done=1, total=3, agent={"grounding": "inferred"})
    run_events.emit(p, "voice", index=2, done=2, total=3, agent={"grounding": "inferred"})
    if upto == "run_ended":
        run_events.emit(p, "stage_end", stage="enrich:voices", status="done", detail="")
        run_events.emit(p, run_events.RUN_ENDED, status="complete", detail="")
    return p


def _terminal(run_id: str) -> None:
    """Put the run in the state the stream reads as 'over': terminal status, lock free."""
    run_state.set_stage(run_id, "done", "run complete")


def test_stream_404_without_events_file(client: TestClient) -> None:
    assert client.get(f"/api/runs/{RUN}/events").status_code == 404


def test_stream_replays_in_order_and_ends_with_a_control_frame(client: TestClient) -> None:
    _seed_events(RUN)
    _terminal(RUN)
    r = client.get(f"/api/runs/{RUN}/events")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/event-stream")
    assert _frames(r.text) == [(0, "run_start"), (1, "stage_start"), (2, "cmd_start"), (3, "voices_total"),
                               (4, "voice"), (5, "voice"), (6, "stage_end"), (7, "run_ended"),
                               (8, "stream_end")]


def test_interior_run_ended_does_not_close_the_stream(client: TestClient) -> None:
    """THE V2.7b HAZARD, pinned: a skip writes ``run_ended`` and a resume appends AFTER it. A
    content-driven terminal would close here forever; the state-driven one replays the whole file."""
    p = _seed_events(RUN)  # already ends with run_ended at line 7
    run_events.emit(p, "stage_start", stage="enrich:report", label="enrich:report", kind="llm")
    run_events.emit(p, run_events.RUN_ENDED, status="complete", detail="")
    _terminal(RUN)
    frames = _frames(client.get(f"/api/runs/{RUN}/events").text)
    assert [e for _, e in frames] == ["run_start", "stage_start", "cmd_start", "voices_total", "voice",
                                      "voice", "stage_end", "run_ended", "stage_start", "run_ended",
                                      "stream_end"]
    assert frames[-1][0] == 10, "the control frame's id follows the last file line"


def test_last_event_id_resumes(client: TestClient) -> None:
    _seed_events(RUN)
    _terminal(RUN)
    r = client.get(f"/api/runs/{RUN}/events", headers={"Last-Event-ID": "3"})
    assert _frames(r.text) == [(4, "voice"), (5, "voice"), (6, "stage_end"), (7, "run_ended"),
                               (8, "stream_end")]


def test_stale_last_event_id_replays_from_zero(client: TestClient) -> None:
    """A stale id past EOF (the file was truncated by a NEW run) must replay from 0 — the client's
    run_start reset sentinel handles the rest."""
    _seed_events(RUN)
    _terminal(RUN)
    r = client.get(f"/api/runs/{RUN}/events", headers={"Last-Event-ID": "999"})
    frames = _frames(r.text)
    assert frames[0] == (0, "run_start") and frames[-1][1] == "stream_end"


def test_orphan_run_still_gets_a_control_frame(client: TestClient) -> None:
    """Events file with NO ending event + terminal run-state + free lock → the stream still closes
    (a stream must never heartbeat a dead job forever). This is the old orphan guard, now folded into
    the one state-driven predicate."""
    _seed_events(RUN, upto="voices")
    run_state.set_stage(RUN, "done", "voices complete")
    r = client.get(f"/api/runs/{RUN}/events")
    frames = _frames(r.text)
    assert frames[-1][1] == "stream_end"
    assert "run_ended" not in [e for _, e in frames], "no ending was written — none may be invented"
    assert '"status": "done"' in r.text


def test_post_enrich_appends_and_never_truncates(client: TestClient) -> None:
    """THE V2.7b INVARIANT: an enrich POST appends ``stage_start`` to the RUN's file. The run's earlier
    history — beats, prior stages — survives, because the experience is a fold over the whole file."""
    _terminal(RUN)
    p = _seed_events(RUN)  # a prior stage's populated file (8 lines, ends run_ended)
    before, _ = run_events.read_from(p, 0)
    r = client.post(f"/api/runs/{RUN}/enrich", json={"stage": "voices"})
    assert r.status_code == 200
    events, _ = run_events.read_from(p, 0)
    assert [e["event"] for _, e in events[:len(before)]] == [e["event"] for _, e in before], \
        "the prior lines must survive byte-for-byte in order"
    assert events[0][1]["event"] == "run_start", "line 0 stays the run header"
    assert len([e for _, e in events if e["event"] == "run_start"]) == 1, "exactly one header, ever"
    assert events[-1][1]["event"] == "stage_start"
    assert events[-1][1]["stages"] == ["sampling travelers", "generating voices"]


def test_post_enrich_backfills_a_header_when_the_file_is_gone(client: TestClient) -> None:
    """A run whose events file was pruned (7 days) or predates V2.7b: the POST reconstructs the header
    from run-state so ``stage_start`` can never be line 0."""
    run_state.set_stage(RUN, "done", "run complete", description="a closure on the corridor",
                        demand_profile="synthetic_demo", assignment="day_one", n_seeds=1,
                        change={"type": "road_closure", "target_edge": "e1"})
    p = run_events.events_path(RUN)
    assert not p.exists()
    assert client.post(f"/api/runs/{RUN}/enrich", json={"stage": "voices"}).status_code == 200
    events, _ = run_events.read_from(p, 0)
    assert [e["event"] for _, e in events] == ["run_start", "stage_start"]
    header = events[0][1]
    assert header["reconstructed"] is True
    assert header["description"] == "a closure on the corridor"
    assert header["changes"] == [{"type": "road_closure", "target_edge": "e1"}]


def test_status_derives_enrich_progress_from_the_current_stage(client: TestClient) -> None:
    """Poll degrade path: GET status carries enrich_progress DERIVED from the events file (never written
    into run-state — its merge-write is unlocked), folded from the LAST stage_start. Without that window
    the previous stage's finished counter would open the next stage at 100%."""
    p = _seed_events(RUN, upto="voices")
    run_state.set_stage(RUN, "enrich:voices", "running voices")
    st = client.get(f"/api/runs/{RUN}/status").json()
    assert st["enrich_progress"] == {"done": 2, "total": 3, "label": "sampling travelers"}
    # the on-disk state file itself never gained the field
    assert "enrich_progress" not in run_state.read(RUN)

    # the voices stage finishes at 3/3 and the REPORT stage opens: its progress is the report's own
    run_events.emit(p, "voice", index=1, done=3, total=3, agent={"grounding": "sim"})
    run_events.emit(p, "stage_end", stage="enrich:voices", status="done", detail="")
    run_events.emit(p, "stage_start", stage="enrich:report", label="enrich:report", kind="llm")
    run_events.emit(p, "cmd_start", i=0, n=2, label="writing the report")
    run_state.set_stage(RUN, "enrich:report", "running report")
    st2 = client.get(f"/api/runs/{RUN}/status").json()
    assert st2["enrich_progress"] == {"label": "writing the report"}, \
        "the voices stage's 3/3 must not leak into the report stage"

    run_state.set_stage(RUN, "done", "report complete")
    st3 = client.get(f"/api/runs/{RUN}/status").json()
    assert "enrich_progress" not in st3, "non-enrich stages carry no derived progress"


def test_ledger_endpoint_serves_null_for_a_run_that_has_none(client: TestClient) -> None:
    """A run with no ledger is NOT an error — every pre-V2.7b run and every CLI-harness run has none.
    Painting a failure over a perfectly good run is the labeled-degradation rule inverted."""
    import run_ledger

    run_state.set_stage(RUN, "done", "run complete")
    assert client.get("/api/runs/nope/ledger").status_code == 404, "an unknown RUN is still a 404"
    body = client.get(f"/api/runs/{RUN}/ledger").json()
    assert body == {"run_id": RUN, "ledger": None}

    run_ledger.init(RUN, projection={"calls": 230, "basis": "212 voices + 13 report slots"})
    run_ledger.set_stage(RUN, "personas", run_ledger.DONE, produced={"total": 213})
    served = client.get(f"/api/runs/{RUN}/ledger").json()["ledger"]
    assert served["projection"]["calls"] == 230
    assert run_ledger.stage(served, "personas")["produced"] == {"total": 213}
