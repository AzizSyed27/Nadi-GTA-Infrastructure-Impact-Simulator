"""V2.1d — pure tests for the cross-seed range aggregation (scorecard.attach_ranges).

No SUMO, no LLM: tiny Scorecard objects in, ranges out. Pins the ratified conventions: seed 42
canonical (cells never touched), min/max over per-seed values, sign_stable strict-straddle (a zero
endpoint does NOT flip it), access never ranged, <2 values -> no range, the earned safety note
(suffixes preserved), and the settled fixed-routes disclosure riding every ranged cell's note.
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "python" / "src"))

import scorecard as sc_mod  # noqa: E402
from contract_models import Scorecard, ScorecardCell, ScorecardGroup  # noqa: E402
from scorecard import _SAFETY_NOTE, _SETTLED_RANGE_NOTE, attach_ranges, attach_ranges_from_sidecar  # noqa: E402


def _card(travel: float | None = 2.3, safety: float | None = 0.5, access: float | None = 0.33,
          safety_note: str = _SAFETY_NOTE) -> Scorecard:
    return Scorecard(groups=[
        ScorecardGroup(
            group="car_commuter", grounding="sim",
            travel_time_delta=ScorecardCell(value=travel, affected_share=0.18, confidence="measured",
                                            note="affected_share = fraction >30s slower")
            if travel is not None else None,
            safety_delta=ScorecardCell(value=safety, confidence="low", note=safety_note)
            if safety is not None else None,
            access_delta=ScorecardCell(value=access, confidence="low", note="rule-based estimate")
            if access is not None else None,
        ),
    ])


def test_straddle_is_unstable_and_notes_earned() -> None:
    canonical = _card(travel=2.3, safety=0.5)
    probes = [_card(travel=-1.4, safety=-0.2), _card(travel=5.1, safety=1.0)]
    prov = attach_ranges(canonical, probes, [42, 43, 44])
    tr = canonical.groups[0].travel_time_delta
    sf = canonical.groups[0].safety_delta
    assert tr.range.min == -1.4 and tr.range.max == 5.1 and tr.range.n_seeds == 3
    assert tr.range.sign_stable is False
    assert "sign not stable across seeds this run — magnitude only" in tr.note
    assert sf.range.sign_stable is False
    assert sf.note.startswith("sign flips across seeds 42, 43, 44 in this run")
    assert prov["car_commuter"]["travel_time_delta"] == {"42": 2.3, "43": -1.4, "44": 5.1}


def test_all_positive_is_stable() -> None:
    canonical = _card(travel=2.3, safety=0.5)
    probes = [_card(travel=1.8, safety=0.2), _card(travel=2.9, safety=0.9)]
    attach_ranges(canonical, probes, [42, 43, 44])
    tr = canonical.groups[0].travel_time_delta
    sf = canonical.groups[0].safety_delta
    assert tr.range.sign_stable is True and (tr.range.min, tr.range.max) == (1.8, 2.9)
    # stable travel keeps its original note untouched (no unstable appendix)
    assert tr.note == "affected_share = fraction >30s slower"
    assert sf.note.startswith("sign consistent across seeds 42, 43, 44 in this run")
    assert "magnitude only (a 3-seed probe, not proof of direction)" in sf.note


def test_zero_endpoint_is_stable() -> None:
    """The ratified STRICT straddle: min < 0 < max. A 0.0 endpoint does not flip stability."""
    canonical = _card(travel=0.0)
    probes = [_card(travel=3.0), _card(travel=1.5)]
    attach_ranges(canonical, probes, [42, 43, 44])
    assert canonical.groups[0].travel_time_delta.range.sign_stable is True


def test_all_zero_is_stable() -> None:
    canonical = _card(travel=0.0)
    probes = [_card(travel=0.0), _card(travel=0.0)]
    attach_ranges(canonical, probes, [42, 43, 44])
    r = canonical.groups[0].travel_time_delta.range
    assert r.sign_stable is True and r.min == r.max == 0.0


def test_none_probe_cells_excluded_and_lonely_canonical_gets_no_range() -> None:
    canonical = _card(travel=2.3)
    # both probes lack the travel cell -> only the canonical value remains -> NO range claimed
    probes = [_card(travel=None), _card(travel=None)]
    attach_ranges(canonical, probes, [42, 43, 44])
    assert canonical.groups[0].travel_time_delta.range is None
    # one probe present -> a 2-value range IS attached (n_seeds counts VALUES, not requested seeds)
    canonical2 = _card(travel=2.3)
    attach_ranges(canonical2, [_card(travel=1.0), _card(travel=None)], [42, 43, 44])
    r2 = canonical2.groups[0].travel_time_delta.range
    assert r2 is not None and r2.n_seeds == 2 and (r2.min, r2.max) == (1.0, 2.3)


def test_access_never_ranged_and_canonical_cells_untouched() -> None:
    canonical = _card()
    before_tr = canonical.groups[0].travel_time_delta.model_dump(exclude={"range", "note"})
    attach_ranges(canonical, [_card(travel=-1.0, safety=-0.1)], [42, 43])
    g = canonical.groups[0]
    assert g.access_delta.range is None, "access is a deterministic heuristic — never ranged"
    assert g.access_delta.note == "rule-based estimate"
    # value/affected_share/confidence byte-equal — seed 42 IS the artifact
    assert g.travel_time_delta.model_dump(exclude={"range", "note"}) == before_tr


def test_safety_note_suffixes_survive_the_earned_rewrite() -> None:
    calibrated_note = _SAFETY_NOTE + ". At peak density, safety surrogates are dominated by queue interactions"
    canonical = _card(safety=0.5, safety_note=calibrated_note)
    attach_ranges(canonical, [_card(safety=0.2)], [42, 43])
    note = canonical.groups[0].safety_delta.note
    assert note.startswith("sign consistent across seeds 42, 43 in this run")
    assert note.endswith(". At peak density, safety surrogates are dominated by queue interactions")
    assert _SAFETY_NOTE not in note  # the V1 clause is fully replaced, never doubled


def test_settled_basis_note_rides_every_ranged_cell() -> None:
    canonical = _card(travel=2.3, safety=0.5)
    attach_ranges(canonical, [_card(travel=1.0, safety=0.1)], [42, 43], settled=True)
    g = canonical.groups[0]
    assert g.travel_time_delta.note.endswith(_SETTLED_RANGE_NOTE)
    assert g.safety_delta.note.endswith(_SETTLED_RANGE_NOTE)
    assert g.access_delta.note == "rule-based estimate", "rangeless cells carry NO basis note"


def test_sidecar_reattach_matches_attach() -> None:
    """The recompute path (scorecard.py main) must rebuild identical ranges from stored values."""
    canonical = _card(travel=2.3, safety=0.5)
    probes = [_card(travel=-1.4, safety=-0.2), _card(travel=5.1, safety=1.0)]
    prov = attach_ranges(canonical, probes, [42, 43, 44])

    fresh = _card(travel=2.3, safety=0.5)
    attach_ranges_from_sidecar(fresh, prov, {"canonical": 42, "n_seeds": 3, "basis": "day_one_resim"})
    assert fresh.groups[0].travel_time_delta.range == canonical.groups[0].travel_time_delta.range
    assert fresh.groups[0].safety_delta.note == canonical.groups[0].safety_delta.note

    # settled basis via the sidecar flag reproduces the disclosure too
    fresh2 = _card(travel=2.3, safety=0.5)
    attach_ranges_from_sidecar(fresh2, prov, {"basis": "settled_fixed_routes"})
    assert fresh2.groups[0].travel_time_delta.note.endswith(_SETTLED_RANGE_NOTE)


def test_no_probes_attaches_nothing() -> None:
    """n_seeds=1 byte-identity at the unit level: an empty probe list changes NOTHING."""
    canonical = _card()
    untouched = _card()
    prov = attach_ranges(canonical, [], [42])
    assert prov == {}
    assert canonical.model_dump() == untouched.model_dump()


def test_ranged_fields_constant_pins_access_exclusion() -> None:
    assert sc_mod.RANGED_FIELDS == ("travel_time_delta", "safety_delta")
