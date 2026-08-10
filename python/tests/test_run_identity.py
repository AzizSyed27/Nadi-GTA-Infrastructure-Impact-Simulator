"""V2.4c — run identity (user name/note) as a STATE_DIR sidecar + the pinned sibling guard.

The sidecar (`<run_id>.identity.json`) is written by exactly ONE writer (the identity endpoint),
which makes it race-free against the harness's unlocked read-merge-write `set_stage` by
construction — a rename works even mid-run. Names are USER TEXT: the server caps are the
ENFORCEMENT (client maxLength is convenience), markup is stored VERBATIM (inert RENDERING is the
single deliberate defense layer — pinned end-to-end in web/tests/run-identity.spec.ts).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "python" / "src"))

import run_state  # noqa: E402
import trajectory_io  # noqa: E402


@pytest.fixture()
def state_dir(tmp_path: Path, monkeypatch) -> Path:
    d = tmp_path / "state"
    monkeypatch.setattr(run_state, "STATE_DIR", d)
    return d


# ---------------------------------------------------------------- the sidecar store


def test_sidecar_semantics(state_dir: Path) -> None:
    rid = "multimodal-scenario-19990101T000000Z"
    assert run_state.identity(rid) == {}  # missing → {}
    stored = run_state.set_identity(rid, name="  Kingston pilot  ", note="")
    assert stored == {"name": "Kingston pilot"}  # trimmed; empty note dropped
    assert run_state.identity(rid) == {"name": "Kingston pilot"}
    p = state_dir / f"{rid}{run_state.IDENTITY_SUFFIX}"
    assert p.is_file()
    # both-empty DELETES the sidecar (the state dir stays run-state + handoff specs only)
    assert run_state.set_identity(rid, name="", note="   ") == {}
    assert not p.exists()
    # corrupt/foreign content degrades to {} (OneDrive-sync damage must never 500 a list)
    p.write_text("{not json", encoding="utf-8")
    assert run_state.identity(rid) == {}
    p.write_text(json.dumps({"name": 7, "note": ["x"], "other": "y"}), encoding="utf-8")
    assert run_state.identity(rid) == {}  # non-string / foreign keys never pass
    # review-caught: VALID JSON with a NON-DICT top level crashed the comprehension — and
    # GET /api/runs reads every sidecar in a loop, so one damaged file 500'd the whole list
    for shape in ("[1, 2, 3]", "null", "42", '"just a string"'):
        p.write_text(shape, encoding="utf-8")
        assert run_state.identity(rid) == {}, shape


def test_list_all_skips_identity_sidecars_and_state_stays_pure(state_dir: Path) -> None:
    """All THREE file classes coexist under list_all's one glob (the composite spec collision
    500'd GET /api/runs live once — this pin covers the new class the same way), and set_stage
    NEVER bakes identity into the state file (the sidecar survives state rewrites — the
    rename-mid-run proof)."""
    rid = "multimodal-scenario-19990101T000000Z"
    run_state.set_stage(rid, "baseline", "leg 1", description="d")
    run_state.set_identity(rid, name="My run", note="watch the detour")
    (state_dir / f"{rid}.composite.json").write_text(json.dumps({"changes": []}), encoding="utf-8")

    rows = run_state.list_all()
    assert len(rows) == 1 and rows[0]["run_id"] == rid  # one run, no sidecar/spec rows
    assert "name" not in rows[0] and "note" not in rows[0]  # list_all stays identity-free (server merges)

    run_state.set_stage(rid, "done", "finished")  # the harness rewrites state...
    state = json.loads((state_dir / f"{rid}.json").read_text(encoding="utf-8"))
    assert "name" not in state and "note" not in state  # ...and identity never leaks into it
    assert run_state.identity(rid) == {"name": "My run", "note": "watch the detour"}  # sidecar survives


# ---------------------------------------------------------------- the sibling guard


def test_identity_guard_matrix(monkeypatch) -> None:
    monkeypatch.delenv(trajectory_io.ALLOW_PINNED_ENV, raising=False)
    assert trajectory_io.pinned_identity_blocked(trajectory_io.PINNED_RUN_ID) is True
    assert trajectory_io.pinned_identity_blocked("multimodal-scenario-20260801T070538Z") is False
    monkeypatch.setenv(trajectory_io.ALLOW_PINNED_ENV, "1")
    assert trajectory_io.pinned_identity_blocked(trajectory_io.PINNED_RUN_ID) is False
    monkeypatch.setenv(trajectory_io.ALLOW_PINNED_ENV, "")  # empty = not set
    assert trajectory_io.pinned_identity_blocked(trajectory_io.PINNED_RUN_ID) is True


def test_identity_reason_names_the_surfaces_and_the_override() -> None:
    r = trajectory_io.PINNED_IDENTITY_REASON
    assert trajectory_io.PINNED_RUN_ID in r
    assert "picker" in r  # names the surface class that breaks (runLabel / pickers)
    assert "clone" in r  # says the read-only path stays open
    assert trajectory_io.ALLOW_PINNED_ENV in r  # the deliberate path is named, never hidden


# ---------------------------------------------------------------- the endpoint

try:
    import server  # noqa: E402
    from fastapi.testclient import TestClient  # noqa: E402
except Exception:  # pragma: no cover
    pytest.skip("server deps unavailable (SUMO / lightrag / torch)", allow_module_level=True)


@pytest.fixture()
def client(state_dir: Path, monkeypatch) -> TestClient:
    monkeypatch.delenv(trajectory_io.ALLOW_PINNED_ENV, raising=False)
    return TestClient(server.app)


def test_endpoint_roundtrip_and_projection(client: TestClient) -> None:
    rid = "multimodal-scenario-19990101T000000Z"
    run_state.set_stage(rid, "done", "finished", description="a run")
    r = client.post(f"/api/runs/{rid}/identity", json={"name": "  Kingston pilot ", "note": "n1"})
    assert r.status_code == 200 and r.json() == {"name": "Kingston pilot", "note": "n1"}
    # GET /api/runs projection carries name (the pickers' source); status carries name + note
    rows = client.get("/api/runs").json()["runs"]
    assert rows[0]["id"] == rid and rows[0]["name"] == "Kingston pilot"
    st = client.get(f"/api/runs/{rid}/status").json()
    assert st["name"] == "Kingston pilot" and st["note"] == "n1"
    # clearing: both empty → {} + the projection drops the key
    r2 = client.post(f"/api/runs/{rid}/identity", json={"name": "", "note": ""})
    assert r2.status_code == 200 and r2.json() == {}
    assert "name" not in client.get("/api/runs").json()["runs"][0]


def test_endpoint_renames_while_the_one_job_lock_is_held(client: TestClient) -> None:
    """The 'rename works MID-RUN' half of the sidecar's race-freedom claim, pinned (review-caught:
    the storage half was pinned, this half rested on inspection): the identity endpoint never
    touches the one-job lock, so a rename succeeds while a run is actively executing."""
    rid = "multimodal-scenario-19990101T000000Z"
    run_state.set_stage(rid, "baseline", "leg 1")  # mid-run shape
    assert run_state.try_acquire(rid)  # the job lock is HELD
    try:
        r = client.post(f"/api/runs/{rid}/identity", json={"name": "named while cooking"})
        assert r.status_code == 200 and r.json() == {"name": "named while cooking"}
        assert run_state.identity(rid) == {"name": "named while cooking"}
    finally:
        run_state.release()


def test_endpoint_stores_markup_verbatim(client: TestClient) -> None:
    """Rendering, not storage, is the injection defense (documented + web-spec-pinned): the
    server neither sanitizes nor rejects markup — the string round-trips byte-identical."""
    rid = "multimodal-scenario-19990101T000000Z"
    run_state.set_stage(rid, "done", "finished")
    evil = "<img src=x onerror=window.__pwned=1>**bold**"
    r = client.post(f"/api/runs/{rid}/identity", json={"name": evil, "note": ""})
    assert r.status_code == 200 and r.json()["name"] == evil
    assert client.get(f"/api/runs/{rid}/status").json()["name"] == evil


def test_endpoint_caps_exact_strings(client: TestClient) -> None:
    rid = "multimodal-scenario-19990101T000000Z"
    run_state.set_stage(rid, "done", "finished")
    r = client.post(f"/api/runs/{rid}/identity", json={"name": "x" * 61})
    assert r.status_code == 400 and r.json()["detail"] == "name too long (61 > 60 chars)"
    r2 = client.post(f"/api/runs/{rid}/identity", json={"note": "y" * 501})
    assert r2.status_code == 400 and r2.json()["detail"] == "note too long (501 > 500 chars)"
    # caps measure the TRIMMED value: 60 real chars in whitespace passes
    r3 = client.post(f"/api/runs/{rid}/identity", json={"name": "  " + "x" * 60 + "  "})
    assert r3.status_code == 200


def test_endpoint_404_and_pinned_403_order(client: TestClient, monkeypatch) -> None:
    r = client.post("/api/runs/multimodal-scenario-19990101T000000Z/identity", json={"name": "x"})
    assert r.status_code == 404  # unknown run, ordinary path
    # the pinned run has NO state file here — the 403 must fire FIRST or it would be dead code
    r2 = client.post(f"/api/runs/{trajectory_io.PINNED_RUN_ID}/identity", json={"name": "x"})
    assert r2.status_code == 403
    assert r2.json()["detail"] == trajectory_io.PINNED_IDENTITY_REASON
    # deliberate override → falls through to the ordinary 404 (still no state file)
    monkeypatch.setenv(trajectory_io.ALLOW_PINNED_ENV, "1")
    r3 = client.post(f"/api/runs/{trajectory_io.PINNED_RUN_ID}/identity", json={"name": "x"})
    assert r3.status_code == 404
