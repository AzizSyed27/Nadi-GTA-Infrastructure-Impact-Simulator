"""V2.7e C3 — the safety cell's NOTE derives from THIS run's seeds (the `_SAFETY_NOTE` ceremony).

`scorecard._SAFETY_NOTE` was a V1 literal with the canonical 42/43/44 tuple baked in, written into
every SINGLE-seed run's safety cells — the same constant-seed-tuple disease the V2.7a follow-up cured
in `report._cross_seed_sentence` and V2.7b cured in the landing caveat, but baked into committed
artifacts. Hover-only until V2.7e C1 put the cell notes on screen as body text (the evidence strip):
the example run then READ "seeds 42/43/44" beside its own single-seed caveat. So the note derives now:
    single seed  → "single seed (42) — cross-seed sign stability was not probed; magnitude only, …"
    multi seed   → the seeds are named and the range carries the stability (the earned rewrite in
                   `_apply_ranges` still replaces it once ranges attach)
    unknown      → "seed count not recorded — …" (a fixture built without a run)
THE COUPLING: `report._safety_direction_body` and `_apply_ranges` sniff the default note by PREFIX to
tell it from an EARNED (measured) note. Every un-recomputed vintage on disk — the PINNED run, the 0709
pair, `sample_v0_4_0`, the archived smoke — still carries the legacy literal, so BOTH prefixes are
recognised: the legacy one routes to the derived caveat and is never quoted as earned.
And the mechanical layer the ceremony lacked: a scorecard recompute of a PROTECTED run is refused
without the same env escape hatch the enrich guards honour.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "python" / "src"))

import report  # noqa: E402
import scorecard  # noqa: E402
import trajectory_io  # noqa: E402
from contract_models import ScorecardCell, ScorecardGroup  # noqa: E402

LEGACY = "sign not stable across seeds 42/43/44; directional claim not supported"


def _group(note: str | None) -> ScorecardGroup:
    return ScorecardGroup(group="car_commuter", grounding="sim",
                          safety_delta=ScorecardCell(value=1.5, confidence="low", note=note))


def _caveat(note: str, seeds: list[int]) -> str:
    return report._safety_direction_body({"by_group": {"g": _group(note)}, "seeds": seeds})


# ------------------------------------------------------------------------------ the derived note

def test_the_single_seed_note_names_its_own_seed_and_no_other() -> None:
    note = scorecard.default_safety_note([42])
    assert "single seed (42)" in note
    assert "42/43/44" not in note
    assert "directional claim not supported" in note
    assert scorecard.default_safety_note([7]).startswith("single seed (7)")


def test_the_multi_seed_default_names_the_seeds_and_claims_no_stability() -> None:
    note = scorecard.default_safety_note([42, 43, 44])
    assert "42, 43, 44" in note
    assert "directional claim not supported" in note
    assert "flips" not in note and "consistent" not in note, "stability is the RANGE's to claim"


def test_unknown_seeds_say_so_rather_than_inventing_a_tuple() -> None:
    note = scorecard.default_safety_note(None)
    assert note.startswith("seed count not recorded")
    assert "42" not in note


def test_the_legacy_literal_is_kept_and_recognised_but_no_longer_written() -> None:
    assert scorecard._LEGACY_SAFETY_NOTE == LEGACY
    assert scorecard._SAFETY_NOTE == LEGACY, "the tests' import of the V1 literal keeps its meaning"
    for n in (LEGACY, scorecard.default_safety_note([42]), scorecard.default_safety_note(None),
              scorecard.default_safety_note([42, 43])):
        assert scorecard.is_default_safety_note(n), n
    assert not scorecard.is_default_safety_note("sign flips across seeds 42, 43 in this run; directional claim not supported")
    assert not scorecard.is_default_safety_note("")


def test_compute_scorecard_writes_the_derived_note_from_the_seeds_it_is_given() -> None:
    buckets = {"car": {"outcomes": []}, "bicycle": {"outcomes": []}, "pedestrian": {"outcomes": []}}
    sc = scorecard.compute_scorecard(buckets, [], [], [{"type": "speed_limit", "target_edge": "E1"}], seeds=[42])
    notes = {g.group: g.safety_delta.note for g in sc.groups if g.safety_delta}
    assert notes["car_commuter"].startswith("single seed (42)")
    assert all("42/43/44" not in n for n in notes.values())
    # the calibrated appendix rides AFTER the derived prefix, as it did after the legacy one
    cal = scorecard.compute_scorecard(buckets, [], [], [{"type": "speed_limit", "target_edge": "E1"}],
                                      demand_profile="calibrated_am_peak", seeds=[42])
    n = next(g.safety_delta.note for g in cal.groups if g.group == "car_commuter")
    assert n.startswith("single seed (42)") and "At peak density" in n


def test_strip_keeps_the_appendix_for_both_prefixes() -> None:
    tail = ". At peak density, safety surrogates are dominated by queue interactions"
    assert scorecard.strip_default_safety_prefix(LEGACY + tail) == tail
    assert scorecard.strip_default_safety_prefix(scorecard.default_safety_note([42]) + tail) == tail
    assert scorecard.strip_default_safety_prefix("an earned note") == "an earned note"


def test_the_earned_rewrite_replaces_a_derived_prefix_exactly_as_it_replaced_the_legacy_one() -> None:
    buckets = {"car": {"outcomes": []}, "bicycle": {"outcomes": []}, "pedestrian": {"outcomes": []}}
    changes = [{"type": "speed_limit", "target_edge": "E1"}]
    canonical = scorecard.compute_scorecard(buckets, [], [], changes, seeds=[42], demand_profile="calibrated_am_peak")
    probe = scorecard.compute_scorecard(buckets, [], [], changes, seeds=[43])
    for g in canonical.groups:
        if g.safety_delta:
            g.safety_delta.value = 0.5
    for g in probe.groups:
        if g.safety_delta:
            g.safety_delta.value = -0.2
    scorecard.attach_ranges(canonical, [probe], [42, 43])
    note = next(g.safety_delta.note for g in canonical.groups if g.group == "car_commuter")
    assert note.startswith("sign flips across seeds 42, 43 in this run")
    assert "single seed" not in note, "the derived prefix is fully replaced, never doubled"
    assert "At peak density" in note


# ------------------------------------------------------------------------------ the report coupling

def test_the_caveat_treats_the_derived_note_as_a_default_never_as_earned() -> None:
    body = _caveat(scorecard.default_safety_note([42]), [42])
    assert "This run used a single seed (42)" in body
    assert "“single seed" not in body, "a default note is derived from, never quoted as earned"


def test_the_caveat_still_routes_the_legacy_literal_to_the_derived_sentence() -> None:
    """Every un-recomputed vintage keeps the V1 literal in its cells; the caveat must keep curing it."""
    body = _caveat(LEGACY, [42])
    assert "42/43/44" not in body
    assert "This run used a single seed (42)" in body


def test_an_earned_note_is_still_quoted() -> None:
    earned = "sign flips across seeds 42, 43, 44 in this run; directional claim not supported"
    assert f"“{earned}”" in _caveat(earned, [42, 43, 44])


# ------------------------------------------------------------------------------ the guard

def test_a_scorecard_recompute_of_a_protected_run_is_refused_without_the_env(monkeypatch) -> None:
    monkeypatch.delenv(trajectory_io.ALLOW_PINNED_ENV, raising=False)
    with pytest.raises(SystemExit) as ex:
        scorecard.refuse_if_protected(trajectory_io.EXAMPLE_RUN_ID)
    assert trajectory_io.ALLOW_PINNED_ENV in str(ex.value)
    assert "scorecard recompute" in str(ex.value)
    with pytest.raises(SystemExit):
        scorecard.refuse_if_protected(trajectory_io.PINNED_RUN_ID)
    scorecard.refuse_if_protected("multimodal-scenario-19990101T000000Z")  # an ordinary run passes
    monkeypatch.setenv(trajectory_io.ALLOW_PINNED_ENV, "1")
    scorecard.refuse_if_protected(trajectory_io.EXAMPLE_RUN_ID)  # the documented ceremony path
