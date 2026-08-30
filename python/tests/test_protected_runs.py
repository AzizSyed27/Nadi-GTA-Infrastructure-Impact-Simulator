"""V2.7a C4 — the PROTECTED-RUNS set: the committed EXAMPLE run joins the pinned run's
server-side guards (enrich + identity), each with a role-specific refusal reason.

A committed, landing-load-bearing run is singleton-class: client-side read-only guards the UI
only — the bare-CLI path (which resolves the local latest.json default) bypasses every client
guard, so membership here is the layer that actually prevents mutation. The `report` enrich
stays exempt for both members (it never touches the artifact — the documented maintenance path).

Run: python -m pytest python/tests/test_protected_runs.py -v
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "python" / "src"))
import trajectory_io as tio  # noqa: E402


@pytest.fixture(autouse=True)
def _no_override(monkeypatch):
    monkeypatch.delenv(tio.ALLOW_PINNED_ENV, raising=False)


def test_example_run_id_is_the_committed_landing_composite():
    assert tio.EXAMPLE_RUN_ID == "multimodal-scenario-20260814T063253Z"


def test_both_protected_runs_block_artifact_rewriting_enriches():
    assert tio.pinned_enrich_blocked(tio.PINNED_RUN_ID)
    assert tio.pinned_enrich_blocked(tio.EXAMPLE_RUN_ID)
    assert not tio.pinned_enrich_blocked("multimodal-scenario-20990101T000000Z")


def test_guard_raises_the_run_specific_reason():
    with pytest.raises(SystemExit) as e:
        tio.guard_pinned_enrich(tio.EXAMPLE_RUN_ID)
    msg = str(e.value)
    assert tio.EXAMPLE_RUN_ID in msg
    assert "EXAMPLE" in msg  # the role, not a generic refusal
    assert tio.ALLOW_PINNED_ENV in msg  # the deliberate-override path is always named
    with pytest.raises(SystemExit) as e2:
        tio.guard_pinned_enrich(tio.PINNED_RUN_ID)
    assert "PINNED Playwright" in str(e2.value)


def test_identity_writes_block_for_both_with_role_specific_reasons():
    assert tio.pinned_identity_blocked(tio.PINNED_RUN_ID)
    assert tio.pinned_identity_blocked(tio.EXAMPLE_RUN_ID)
    assert not tio.pinned_identity_blocked("multimodal-scenario-20990101T000000Z")
    assert tio.identity_refusal_reason(tio.PINNED_RUN_ID) == tio.PINNED_IDENTITY_REASON
    ex = tio.identity_refusal_reason(tio.EXAMPLE_RUN_ID)
    assert tio.EXAMPLE_RUN_ID in ex and "EXAMPLE" in ex and tio.ALLOW_PINNED_ENV in ex


def test_pinned_identity_reason_names_the_current_surfaces():
    # V2.7a retired the edit-rail picker; the reason must not describe surfaces that no longer
    # exist (a refusal that misdescribes the blast radius reads as a stale scare).
    assert "edit rail" not in tio.PINNED_IDENTITY_REASON
    assert "run list" in tio.PINNED_IDENTITY_REASON
    assert "compare pickers" in tio.PINNED_IDENTITY_REASON


def test_env_override_unblocks_both(monkeypatch):
    monkeypatch.setenv(tio.ALLOW_PINNED_ENV, "1")
    assert not tio.pinned_enrich_blocked(tio.EXAMPLE_RUN_ID)
    assert not tio.pinned_identity_blocked(tio.EXAMPLE_RUN_ID)
    assert not tio.pinned_enrich_blocked(tio.PINNED_RUN_ID)
    assert not tio.pinned_identity_blocked(tio.PINNED_RUN_ID)
