"""V2.3c closeout — the STRUCTURAL pinned-run guard. The pinned Playwright/report anchor
(multimodal-scenario-20260702T044134Z) must never be rewritten by an accidental voices/discourse
enrich: the damage (a 0.9.0 rewrite with institutions / regenerated cascades) surfaces hours later
as unexplained spec failures. A doc warning only protects agents that read it — the refusal is
code: server 403 (BEFORE the no-state 404) + CLI SystemExit, with a deliberate env escape hatch."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "python" / "src"))

import trajectory_io  # noqa: E402


def test_blocked_matrix(monkeypatch) -> None:
    monkeypatch.delenv(trajectory_io.ALLOW_PINNED_ENV, raising=False)
    assert trajectory_io.pinned_enrich_blocked(trajectory_io.PINNED_RUN_ID) is True
    assert trajectory_io.pinned_enrich_blocked("multimodal-scenario-20260801T070538Z") is False
    with pytest.raises(SystemExit, match="PINNED"):
        trajectory_io.guard_pinned_enrich(trajectory_io.PINNED_RUN_ID)
    trajectory_io.guard_pinned_enrich("some-other-run")  # no raise


def test_env_escape_hatch_is_a_deliberate_re_pin_only(monkeypatch) -> None:
    monkeypatch.setenv(trajectory_io.ALLOW_PINNED_ENV, "1")
    assert trajectory_io.pinned_enrich_blocked(trajectory_io.PINNED_RUN_ID) is False
    trajectory_io.guard_pinned_enrich(trajectory_io.PINNED_RUN_ID)  # no raise
    monkeypatch.setenv(trajectory_io.ALLOW_PINNED_ENV, "")  # empty = not set
    assert trajectory_io.pinned_enrich_blocked(trajectory_io.PINNED_RUN_ID) is True


def test_reason_names_the_mechanism_and_the_override() -> None:
    r = trajectory_io.PINNED_REASON
    assert trajectory_io.PINNED_RUN_ID in r
    assert "REWRITES" in r and "spec" in r
    assert trajectory_io.ALLOW_PINNED_ENV in r  # the deliberate path is named, never hidden


# --- the server endpoint (TestClient without lifespan — the established template) ---

try:
    import server  # noqa: E402
    from fastapi.testclient import TestClient  # noqa: E402
except Exception:  # pragma: no cover
    pytest.skip("server deps unavailable (SUMO / lightrag / torch)", allow_module_level=True)


@pytest.fixture()
def client(tmp_path: Path, monkeypatch) -> TestClient:
    import run_state

    monkeypatch.setattr(run_state, "STATE_DIR", tmp_path / "state")  # no state files exist
    monkeypatch.delenv(trajectory_io.ALLOW_PINNED_ENV, raising=False)
    return TestClient(server.app)


def test_endpoint_403_fires_before_the_no_state_404(client: TestClient) -> None:
    """The pinned run has NO state file, so an ordinary guard placement would be dead code behind
    the 404 — pin that voices/discourse hit the 403 FIRST, while report falls through to the 404
    (it never touches the artifact; the documented singleton-maintenance path stays open)."""
    for stage in ("voices", "discourse"):
        r = client.post(f"/api/runs/{trajectory_io.PINNED_RUN_ID}/enrich", json={"stage": stage})
        assert r.status_code == 403, stage
        assert "PINNED" in r.json()["detail"]
    r = client.post(f"/api/runs/{trajectory_io.PINNED_RUN_ID}/enrich", json={"stage": "report"})
    assert r.status_code == 404  # report allowed through the guard; no state -> the ordinary 404


def test_endpoint_normal_runs_unaffected(client: TestClient) -> None:
    r = client.post("/api/runs/multimodal-scenario-19990101T000000Z/enrich", json={"stage": "voices"})
    assert r.status_code == 404  # ordinary no-such-run path, no guard interference
