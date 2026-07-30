"""V2.3a — the SSE stream endpoint + the POST-time ordering invariant + status-derived progress.

TestClient is used WITHOUT the context manager on purpose: lifespan (the LightRAG index load) doesn't run,
requests still route. server.py drags heavy deps — gate the import like test_server_cmd.py does."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "python" / "src"))

import enrich_events  # noqa: E402
import run_state  # noqa: E402

try:  # heavy: the whole server module (agent stack + SUMO). Skip cleanly if the env lacks them.
    import server  # noqa: E402
    from fastapi.testclient import TestClient  # noqa: E402
except Exception:  # pragma: no cover
    pytest.skip("server deps unavailable (SUMO / lightrag / torch)", allow_module_level=True)

RUN = "multimodal-scenario-19990101T000000Z"


@pytest.fixture()
def client(tmp_path: Path, monkeypatch) -> TestClient:
    monkeypatch.setattr(enrich_events, "EVENTS_ROOT", tmp_path / "events")
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


def _seed_events(run_id: str, upto: str = "job_done") -> Path:
    p = enrich_events.events_path(run_id)
    enrich_events.truncate(p)
    enrich_events.emit(p, "job_start", run_id=run_id, label="enrich:voices",
                       stages=["sampling travelers", "generating voices"])
    enrich_events.emit(p, "cmd_start", i=0, n=2, label="sampling travelers")
    enrich_events.emit(p, "voices_total", total=3)
    enrich_events.emit(p, "voice", index=0, done=1, total=3, agent={"grounding": "inferred"})
    enrich_events.emit(p, "voice", index=2, done=2, total=3, agent={"grounding": "inferred"})
    if upto == "job_done":
        enrich_events.emit(p, "job_done", label="enrich:voices")
    return p


def test_stream_404_without_events_file(client: TestClient) -> None:
    assert client.get(f"/api/runs/{RUN}/enrich/stream").status_code == 404


def test_stream_replays_in_order_and_ends_at_terminal(client: TestClient) -> None:
    _seed_events(RUN)
    r = client.get(f"/api/runs/{RUN}/enrich/stream")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/event-stream")
    assert _frames(r.text) == [(0, "job_start"), (1, "cmd_start"), (2, "voices_total"),
                               (3, "voice"), (4, "voice"), (5, "job_done")]


def test_last_event_id_resumes(client: TestClient) -> None:
    _seed_events(RUN)
    r = client.get(f"/api/runs/{RUN}/enrich/stream", headers={"Last-Event-ID": "2"})
    assert _frames(r.text) == [(3, "voice"), (4, "voice"), (5, "job_done")]


def test_stale_last_event_id_replays_from_zero(client: TestClient) -> None:
    """A stale id past EOF (the file was truncated by a NEW job) must replay from 0 — the client's
    job_start reset sentinel handles the rest."""
    _seed_events(RUN)
    r = client.get(f"/api/runs/{RUN}/enrich/stream", headers={"Last-Event-ID": "999"})
    frames = _frames(r.text)
    assert frames[0] == (0, "job_start") and frames[-1] == (5, "job_done")


def test_orphan_guard_synthesizes_terminal(client: TestClient) -> None:
    """Events file with NO terminal event + terminal run-state + lock free → a synthetic terminal frame
    (a stream must never heartbeat a dead job forever)."""
    _seed_events(RUN, upto="voices")
    run_state.set_stage(RUN, "done", "voices complete")
    r = client.get(f"/api/runs/{RUN}/enrich/stream")
    frames = _frames(r.text)
    assert frames[-1][1] == "job_done"
    assert '"synthetic": true' in r.text


def test_post_enrich_ordering_invariant(client: TestClient) -> None:
    """THE INVARIANT: after a re-enrich POST, the events file starts fresh with job_start at LINE 0 —
    nothing from the prior job survives (clients reset Last-Event-ID dedup on job_start)."""
    run_state.set_stage(RUN, "done", "run complete")
    p = _seed_events(RUN)  # a PRIOR job's populated file (6 lines, ends job_done)
    r = client.post(f"/api/runs/{RUN}/enrich", json={"stage": "voices"})
    assert r.status_code == 200
    events, offset = enrich_events.read_from(p, 0)
    assert events[0][0] == 0 and events[0][1]["event"] == "job_start", "job_start must be line 0"
    starts = [e for _, e in events if e["event"] == "job_start"]
    assert len(starts) == 1, "the prior job's events must be gone"
    assert starts[0]["stages"] == ["sampling travelers", "generating voices"]


def test_status_derives_enrich_progress(client: TestClient) -> None:
    """Poll degrade path: GET status carries enrich_progress DERIVED from the events file (never written
    into run-state — its merge-write is unlocked)."""
    _seed_events(RUN, upto="voices")
    run_state.set_stage(RUN, "enrich:voices", "running voices")
    st = client.get(f"/api/runs/{RUN}/status").json()
    assert st["enrich_progress"] == {"done": 2, "total": 3, "label": "sampling travelers"}
    # the on-disk state file itself never gained the field
    assert "enrich_progress" not in run_state.read(RUN)

    run_state.set_stage(RUN, "done", "voices complete")
    st2 = client.get(f"/api/runs/{RUN}/status").json()
    assert "enrich_progress" not in st2, "non-enrich stages carry no derived progress"
