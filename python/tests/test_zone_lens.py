"""V2.2d Phase 2 — the tag-driven ZONE LENS (zone_lens.py): ped-vehicle crossing conflicts on
zone streets during the window, baseline vs scenario, code-rendered pair.

HONESTY LOCKS pinned here (user-locked, 2026-07-26):
  - population_note NAMES the measured population per demand profile — never "children";
  - variation_note is ALWAYS present on the pair (the count pair bypasses the scorecard's
    CellRange/sign_stable machinery entirely — small-n counts invite subtraction a different
    seed would reverse), NEVER conditional on how the counts look.
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "python" / "src"))

import zone_lens as zl  # noqa: E402
from contract_models import Change, Window  # noqa: E402

TAGS = ["school_zone"]


def _chg(edge: str = "E1", start: float = 600.0, end: float = 1200.0) -> Change:
    return Change(type="speed_limit", target_edge=edge, value_mps=8.33,
                  window=Window(start_s=start, end_s=end),
                  description=f"school-zone limit on {edge}")


def _conf(t: float, type_: str = "crossing", entities: list[str] | None = None) -> dict:
    return {"t": t, "lon": -79.2, "lat": 43.7, "type": type_, "severity": 0.5,
            "entities": entities if entities is not None else ["ped3", "veh7"]}


IN = lambda lon, lat: 10.0  # noqa: E731 — injected distance stubs
OUT = lambda lon, lat: 30.0  # noqa: E731


def _facts(conf_b, conf_s, changes=None, tags=TAGS, dist=IN, profile="synthetic_demo"):
    return zl.compute_zone_facts(conf_b, conf_s, changes or [_chg()], tags,
                                 dist_to_zone=dist, demand_profile=profile)


# ------------------------------------------------------------------ the tag gate


def test_no_tag_no_facts() -> None:
    assert zl.compute_zone_facts([], [], [_chg()], None, dist_to_zone=IN,
                                 demand_profile="synthetic_demo") is None
    assert zl.compute_zone_facts([], [], [_chg()], ["not_a_zone"], dist_to_zone=IN,
                                 demand_profile="synthetic_demo") is None


# ------------------------------------------------------------------ the count rule


def test_counts_crossing_ped_conflicts_inside_window_and_radius() -> None:
    facts = _facts([_conf(700.0)], [_conf(800.0), _conf(900.0)])
    assert facts["ped_vehicle_conflicts"] == {"baseline": 1, "scenario": 2}


def test_crossing_type_required() -> None:
    facts = _facts([_conf(700.0, type_="ttc")], [_conf(800.0, type_="hard_braking")])
    assert facts["ped_vehicle_conflicts"] == {"baseline": 0, "scenario": 0}


def test_ped_entity_prefix_required() -> None:
    facts = _facts([_conf(700.0, entities=["veh1", "bike2"])],
                   [_conf(800.0, entities=["bike9", "veh3"])])
    assert facts["ped_vehicle_conflicts"] == {"baseline": 0, "scenario": 0}


def test_window_bounds_inclusive() -> None:
    facts = _facts([_conf(600.0), _conf(1200.0)], [_conf(599.9), _conf(1200.1)])
    assert facts["ped_vehicle_conflicts"] == {"baseline": 2, "scenario": 0}


def test_radius_boundary_25_in_25_1_out() -> None:
    at_25 = lambda lon, lat: 25.0  # noqa: E731
    past_25 = lambda lon, lat: 25.1  # noqa: E731
    assert _facts([_conf(700.0)], [], dist=at_25)["ped_vehicle_conflicts"]["baseline"] == 1
    assert _facts([_conf(700.0)], [], dist=past_25)["ped_vehicle_conflicts"]["baseline"] == 0


def test_missing_entities_never_counted() -> None:
    c = {"t": 700.0, "lon": -79.2, "lat": 43.7, "type": "crossing", "severity": 0.5}
    assert _facts([c], [])["ped_vehicle_conflicts"] == {"baseline": 0, "scenario": 0}


# ------------------------------------------------------------------ window resolution


def test_shared_window_used_without_note() -> None:
    facts = _facts([], [], changes=[_chg("E1"), _chg("E2")])
    assert facts["window"] == {"start_s": 600.0, "end_s": 1200.0}
    assert facts.get("window_note") is None


def test_differing_windows_span_with_note_never_an_assert() -> None:
    facts = _facts([], [], changes=[_chg("E1", 600.0, 1200.0), _chg("E2", 900.0, 1800.0)])
    assert facts["window"] == {"start_s": 600.0, "end_s": 1800.0}
    assert facts["window_note"] == zl.SPAN_WINDOW_NOTE
    # the spanning window really is what counts: t=1500 is outside E1's window but inside the span
    facts2 = zl.compute_zone_facts([_conf(1500.0)], [], [_chg("E1"), _chg("E2", 900.0, 1800.0)],
                                   TAGS, dist_to_zone=IN, demand_profile="synthetic_demo")
    assert facts2["ped_vehicle_conflicts"]["baseline"] == 1


def test_no_windowed_member_covers_full_run_with_note() -> None:
    unwindowed = Change(type="speed_limit", target_edge="E1", value_mps=8.33,
                        description="permanent limit")
    facts = _facts([_conf(50.0), _conf(99999.0)], [], changes=[unwindowed])
    assert facts["window"] is None
    assert facts["window_note"] == zl.FULL_RUN_WINDOW_NOTE
    assert facts["ped_vehicle_conflicts"]["baseline"] == 2


# ------------------------------------------------------------------ the honesty notes


def test_variation_note_always_present_even_at_large_counts() -> None:
    big_b = [_conf(700.0 + i * 0.01) for i in range(150)]
    big_s = [_conf(700.0 + i * 0.01) for i in range(300)]
    facts = _facts(big_b, big_s)
    assert facts["variation_note"] == zl.VARIATION_NOTE
    assert _facts([], [])["variation_note"] == zl.VARIATION_NOTE  # zero counts too


def test_variation_note_wording_pinned() -> None:
    assert zl.VARIATION_NOTE == ("single-seed counts; at these small event counts the difference "
                                 "between the two figures is within run-to-run variation and does "
                                 "not establish a direction")


def test_population_note_names_the_population_per_profile() -> None:
    syn = _facts([], [], profile="synthetic_demo")["population_note"]
    cal = _facts([], [], profile="calibrated_am_peak")["population_note"]
    for note in (syn, cal):
        assert "not modeled schoolchildren" in note
        assert "student travel demand is deferred" in note
        assert "child" not in note.replace("schoolchildren", "")  # never implies children measured
    assert "synthetic demo demand" in syn
    assert "TMC-anchored calibrated demand" in cal


def test_method_note_pins_radius_window_and_surrogate_framing() -> None:
    note = _facts([], [])["method_note"]
    assert "25" in note and "during the window" in note
    assert "not crash prediction" in note


def test_zone_facts_shape() -> None:
    facts = _facts([], [], changes=[_chg("E1"), _chg("E2")])
    assert facts["tag"] == "school_zone"
    assert facts["zone_edges"] == ["E1", "E2"] and facts["n_edges"] == 2
    for key in ("window", "ped_vehicle_conflicts", "method_note", "variation_note",
                "population_note"):
        assert key in facts
