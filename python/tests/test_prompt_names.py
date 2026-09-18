"""V2.7e C5 — street names in the persona prompts (RATIFIED at D-Q3, 2026-09-17).

The rule is the V2.7d one, carried into the model's input: NAME-PLUS-ID, never name-instead-of-id,
and every UNNAMED form BYTE-IDENTICAL to the pre-C5 wording — the unnamed literals below were copied
from a run of the untouched code, so byte-identity is a diff, not a memory. The report's framing
phrase is the id-free twin (its slot forbids digits; an edge id is digits) — it gains the NAME only.
The names come from `network.json` through `street_names` — here a two-edge asset in tmp_path, so
the pins never skip.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "python" / "src"))

import interview  # noqa: E402
import reactions  # noqa: E402
import report  # noqa: E402
import scenario_harness  # noqa: E402
import street_names  # noqa: E402
from contract_models import Change  # noqa: E402

NAMED = "N1"  # Lawrence Avenue East
UNNAMED = "E1"
DIGIT_NAMED = "H1"  # Highway 401 Collector — a real name on this net that carries digits
W = {"start_s": 600.0, "end_s": 2400.0}
WIN = "from t=600 s to t=2400 s"
TAIL = " — a temporary incident; capacity is reduced while it is active, then restored."


@pytest.fixture(autouse=True)
def two_edge_net(tmp_path, monkeypatch):
    net = tmp_path / "network.json"
    net.write_text(json.dumps({"edges": [{"id": NAMED, "name": "Lawrence Avenue East"},
                                         {"id": DIGIT_NAMED, "name": "Highway 401 Collector"},
                                         {"id": UNNAMED, "name": None}]}), encoding="utf-8")
    monkeypatch.setattr(street_names, "NETWORK_JSON", net)
    street_names.reset_name_cache()
    yield
    street_names.reset_name_cache()


def _line(change: dict) -> str:
    return reactions._change_line(change, "synthetic_demo")


# ---------------------------------------------------------------- the voices' change line

@pytest.mark.parametrize("edge, expected", [
    (UNNAMED, "1 car lane on the corridor road (E1) is closed; the road stays open in the remaining lane(s)."),
    (NAMED, "1 car lane on Lawrence Avenue East (edge N1) is closed; the road stays open in the remaining lane(s)."),
])
def test_lane_closure_line(edge, expected):
    assert _line({"type": "lane_closure", "target_edge": edge, "target_lanes": [1]}) == expected


def test_lane_closure_line_windowed_plural_unnamed_byte_identical():
    assert _line({"type": "lane_closure", "target_edge": UNNAMED, "target_lanes": [0, 1], "window": W}) == (
        f"2 car lanes on the corridor road (E1) are closed {WIN}; the road stays open in the remaining lane(s).")


@pytest.mark.parametrize("edge, expected", [
    (UNNAMED, f"The corridor road (E1) is fully closed {WIN}; traffic must use other streets."),
    (NAMED, f"Lawrence Avenue East (edge N1) is fully closed {WIN}; traffic must use other streets."),
])
def test_road_closure_line(edge, expected):
    assert _line({"type": "road_closure", "target_edge": edge, "window": W}) == expected


def _incident(edge: str, lanes=None, blocked=False, speed_factor=None) -> dict:
    d = {"type": "incident", "target_edge": edge, "window": W, "effect": {}}
    if lanes:
        d["target_lanes"] = lanes
    if blocked:
        d["effect"]["blocked"] = True
    if speed_factor is not None:
        d["effect"]["speed_factor"] = speed_factor
    return d


@pytest.mark.parametrize("edge, road", [
    (UNNAMED, "the corridor road (E1)"),
    (NAMED, "Lawrence Avenue East (edge N1)"),
])
def test_incident_lines_all_three_shapes(edge, road):
    assert _line(_incident(edge, [1, 2], blocked=True)) == f"2 car lanes on {road} are blocked {WIN}{TAIL}"
    assert _line(_incident(edge, speed_factor=0.5)) == (
        f"Traffic on {road} is slowed to 50% of its normal speed {WIN}{TAIL}")
    assert _line(_incident(edge, [1], blocked=True, speed_factor=0.5)) == (
        f"1 car lane on {road} is blocked and traffic is slowed to 50% of its normal speed {WIN}{TAIL}")
    assert _line(_incident(edge)) == f"Capacity on {road} is reduced {WIN}{TAIL}"


@pytest.mark.parametrize("edge, expected", [
    (UNNAMED, "One general-traffic (car) lane on the corridor is being converted into a bicycle-only lane."),
    (NAMED, "One general-traffic (car) lane on Lawrence Avenue East (edge N1) is being converted into a "
            "bicycle-only lane."),
])
def test_bike_lane_line_is_name_conditional_never_the_description(edge, expected):
    """The recorded decision: the mechanical sentence gains the name; it never adopts the description
    (a CLI run's description is id-only and the server's is a label, so adopting it would move the
    unnamed bytes and put a label where a mechanism belongs)."""
    ch = {"type": "bike_lane", "target_edge": edge, "target_lane": 0,
          "description": f"Converted lane 0 of edge {edge} to a bicycle-only lane"}
    assert _line(ch) == expected


def test_new_road_line_untouched():
    ch = {"type": "new_road", "from_junction": "J1", "to_junction": "J2", "lanes": 2,
          "description": "New road from junction J1 to J2"}
    assert _line(ch) == ("A new 2-lane road now connects junction J1 to junction J2 — a NEW travel option, not "
                         "a reallocation of existing lanes; it carries no sidewalk at this stage.")


def test_sim_framing_licenses_provided_names_only():
    assert ("do NOT invent specifics (no street names beyond those provided, exact times, distances, or "
            "facts not provided)") in reactions._SIM_FRAMING
    assert "(no street names, exact" not in reactions._SIM_FRAMING
    # the inferred framing and the interview constitution already say "not provided" — untouched
    assert "do NOT invent specifics not provided" in reactions._INFERRED_FRAMING


# ---------------------------------------------------------------- the report's id-free twin

def _phrase(change: Change) -> str:
    return report._change_phrase(change, "synthetic_demo")


@pytest.mark.parametrize("edge, road", [(UNNAMED, "the corridor road"), (NAMED, "Lawrence Avenue East")])
def test_report_framing_phrase_names_the_street_without_the_id(edge, road):
    assert _phrase(Change(type="lane_closure", target_edge=edge, target_lanes=[1], description="d")) == (
        f"1 car lane is closed on {road}; the road stays open in the remaining lane(s)")
    assert _phrase(Change(type="road_closure", target_edge=edge, window=W, description="d")) == (
        f"{road} is fully closed {WIN}; traffic must use other streets")
    assert _phrase(Change(type="incident", target_edge=edge, target_lanes=[1], window=W,
                          effect={"blocked": True}, description="d")) == (
        f"lanes blocked / capacity reduced on {road} {WIN} (a temporary incident; capacity is restored afterwards)")
    assert "N1" not in _phrase(Change(type="road_closure", target_edge=NAMED, description="d"))


@pytest.mark.parametrize("edge, expected", [
    (UNNAMED, "one general-traffic (car) lane on the corridor is being converted into a bicycle-only lane"),
    (NAMED, "one general-traffic (car) lane on Lawrence Avenue East is being converted into a bicycle-only lane"),
])
def test_report_framing_phrase_bike_lane(edge, expected):
    assert _phrase(Change(type="bike_lane", target_edge=edge, target_lane=0, description="d")) == expected


def test_report_framing_phrase_keeps_a_digit_bearing_name_out_but_the_voices_say_it():
    """The framing slot is digit-audited (retry once, else fail loudly) and 50 named edges on this net carry
    digits — the id-free twin is DIGIT-FREE by construction, so such an edge keeps the fallback. The voices'
    line has no digit rule and renders the name-plus-id form like any other named edge."""
    assert _phrase(Change(type="road_closure", target_edge=DIGIT_NAMED, description="d")) == (
        "the corridor road is fully closed; traffic must use other streets")
    assert _line({"type": "road_closure", "target_edge": DIGIT_NAMED}) == (
        "Highway 401 Collector (edge H1) is fully closed; traffic must use other streets.")


# ---------------------------------------------------------------- the CLI harness descriptions

@pytest.mark.parametrize("edge, ref, incident_ref, road_desc", [
    (UNNAMED, "edge E1", "edge E1 (incident)", "Closed edge E1 (all lanes)"),
    (NAMED, "Lawrence Avenue East (edge N1)", "Lawrence Avenue East (edge N1, incident)",
     "Closed all lanes of Lawrence Avenue East (edge N1)"),
])
def test_cli_descriptions_match_the_server_forms(edge, ref, incident_ref, road_desc):
    d = scenario_harness.cli_base_desc
    assert d("speed_limit", edge, kmh=40.0) == f"Reduced max speed on {ref} to 40 km/h"
    assert d("lane_closure", edge, n_closed=1, n_car_lanes=3) == f"Closed 1 of 3 car lanes on {ref}"
    assert d("road_closure", edge) == road_desc
    assert d("bike_lane", edge, target_lane=0) == f"Converted lane 0 of {ref} to a bicycle-only lane"
    assert d("incident", edge, blocked_lanes=[1, 2]) == f"Blocked 2 car lanes on {incident_ref}"
    assert d("incident", edge, speed_factor=0.5) == f"Reduced speed to 50% on {incident_ref}"


# ---------------------------------------------------------------- interviews + the room inherit it

def test_interview_grounding_inherits_the_named_change_line():
    agent = {"persona": {"id": "commuter_driver", "label": "Commuter"}, "grounding": "inferred",
             "stakeholder": "business_owner",
             "reaction": {"comment": "ok", "sentiment": 0.0, "stance": "neutral"}}
    ctx = interview.RunContext(run_id="r", mtime_ns=0, agents=[agent],
                               changes=[{"type": "lane_closure", "target_edge": NAMED, "target_lanes": [1],
                                         "description": "Closed 1 of 3 car lanes on Lawrence Avenue East (edge N1)"}],
                               demand_profile="synthetic_demo", tags=None)
    system = interview.build_system(agent, ctx)
    assert "1 car lane on Lawrence Avenue East (edge N1) is closed" in system
