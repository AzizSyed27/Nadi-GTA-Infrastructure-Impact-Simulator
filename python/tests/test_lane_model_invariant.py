"""V2.7c/V2.7d — the LANE-MODEL INVARIANT the map's road styling derives from, RE-DERIVED over the wire.

V2.7c derived the sidewalk from ONE rule probed on the canonical net (`allows.ped` => lane index 0 is a
2.0 m pedestrian-only lane, the rest 3.2 m car lanes) and pinned its premises here as literals with
three stated residuals. V2.7d C1a put the exact per-lane TABLE on the wire (`network.json` `lanes:
[{width_m, allows{car,bike,ped,bus}}]`), so the client no longer derives anything — but the invariant is
NOT deleted: it is re-derived from the TABLE, so that (1) the export is proven to equal the net lane for
lane, and (2) the counts the V2.7c record states (4,214 sidewalk edges; the 28 / 23 / 6 residuals) stay
pinned as FACTS ABOUT THE DATA the map now renders exactly, rather than as shapes the rule drew wrong.

The residual classes, restated over the table:
  * 28 edges allow pedestrians on a car lane and carry NO sidewalk lane (now drawn without a ribbon),
  * 23 edges carry one lane that is neither car nor pedestrian — the BUS+BIKE (psv) lanes V2.7d found
    (now drawable as a bus band; V2.7c's "no bus data" conflicts row was false-premised),
  * six car lanes off 3.2 m: four 1.6 m (`23809840` segments) and two 7.0 m (`27040771#0/#5`) — now
    drawn at their true width.

The regen premise: V2.7d C0's dry run showed the netconvert recipe does NOT reproduce the canonical net,
so the net is a fixed asset and these literals describe it; a deliberate geometry regen fails here first.
Numbers probed on 2026-09-11 (V2.7c) and re-verified over the table on 2026-09-14 (V2.7d C1a).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
try:  # run_sim wires SUMO_HOME/tools onto sys.path so sumolib imports — must precede it
    import run_sim
    import sumolib
except Exception:  # pragma: no cover - environment-dependent
    pytest.skip("SUMO/sumolib unavailable (SUMO_HOME unset)", allow_module_level=True)

pytestmark = pytest.mark.skipif(not run_sim.NET.is_file(), reason="corridor net unavailable")

NETWORK_JSON = run_sim.ROOT / "web" / "public" / "network.json"

# The probed literals (the "derive from data" rule: every one of these came from the net, not a mockup).
TOTAL_EDGES = 4570
SIDEWALK_EDGES = 4214  # exactly one 2.0 m ped-only lane, at index 0
PED_ON_CAR_LANE_NO_SIDEWALK = 28  # allows.ped is true but no ped-only lane exists (residual 1)
EXTRA_NON_CAR_NON_PED_LANE = 23  # one lane that is neither car nor pedestrian — bus+bike (residual 2)
SIDEWALK_WIDTH_M = 2.0
CAR_LANE_WIDTH_M = 3.2
# Car-lane width histogram (lanes, not edges): the six off-width lanes are residual 3.
CAR_LANE_WIDTHS = {3.2: 6717, 1.6: 4, 7.0: 2}
OFF_WIDTH_CAR_LANE_EDGES = 6
OFF_WIDTH_EDGE_IDS = {"-23809840#2", "-23809840#3", "23809840#0", "23809840#3", "27040771#0", "27040771#5"}


def _classify(rows):
    """Classify over TABLE rows: each row is {id, lanes: [{width_m, allows{car,bike,ped,bus}}], allows}."""
    sidewalk = 0
    ped_on_car = 0
    extra = 0
    total = 0
    bad_sidewalk_shape = []  # any sidewalk edge whose sidewalk is not (one lane, index 0, 2.0 m)
    car_widths: dict[float, int] = {}
    off_width_edges = set()
    bus_only_lanes = 0
    for row in rows:
        total += 1
        lanes = row["lanes"]
        ped_only = [i for i, l in enumerate(lanes) if l["allows"]["ped"] and not l["allows"]["car"]]
        car = [l for l in lanes if l["allows"]["car"]]
        other = [l for l in lanes if not l["allows"]["car"] and not l["allows"]["ped"]]
        any_ped = any(l["allows"]["ped"] for l in lanes)
        for l in car:
            w = l["width_m"]
            car_widths[w] = car_widths.get(w, 0) + 1
            if w != CAR_LANE_WIDTH_M:
                off_width_edges.add(row["id"])
        if ped_only:
            sidewalk += 1
            if ped_only != [0] or lanes[0]["width_m"] != SIDEWALK_WIDTH_M:
                bad_sidewalk_shape.append(row["id"])
        elif any_ped:
            ped_on_car += 1
        if other:
            extra += 1
        bus_only_lanes += sum(1 for l in lanes if l["allows"]["bus"] and not l["allows"]["car"])
    return {
        "total": total,
        "sidewalk": sidewalk,
        "ped_on_car": ped_on_car,
        "extra": extra,
        "bad_sidewalk_shape": bad_sidewalk_shape,
        "car_widths": car_widths,
        "off_width_edges": off_width_edges,
        "bus_only_lanes": bus_only_lanes,
    }


def _net_rows(net):
    """The same row shape read straight from the net — the export must equal this, lane for lane."""
    rows = []
    for e in net.getEdges(withInternal=False):
        if not e.getShape():
            continue  # network_export skips shapeless edges the same way
        rows.append({
            "id": e.getID(),
            "lanes": [
                {
                    "width_m": round(l.getWidth(), 2),
                    "allows": {
                        "car": l.allows("passenger"),
                        "bike": l.allows("bicycle"),
                        "ped": l.allows("pedestrian"),
                        "bus": l.allows("bus"),
                    },
                }
                for l in e.getLanes()
            ],
        })
    return rows


@pytest.fixture(scope="module")
def wire_rows():
    return json.loads(NETWORK_JSON.read_text(encoding="utf-8"))["edges"]


@pytest.fixture(scope="module")
def classes(wire_rows):
    return _classify(wire_rows)


def test_wire_table_equals_the_net_per_lane(wire_rows):
    """`network.json` IS the net: every edge, every lane, width and the four modes — no derivation left."""
    net_rows = {r["id"]: r["lanes"] for r in _net_rows(sumolib.net.readNet(str(run_sim.NET)))}
    wire = {r["id"]: r["lanes"] for r in wire_rows}
    assert set(wire) == set(net_rows)
    assert wire == net_rows


def test_sidewalk_property_holds_over_the_table(classes):
    """allows.ped => ONE 2.0 m ped-only lane at index 0 — for every sidewalk edge, counted from the table."""
    assert classes["total"] == TOTAL_EDGES
    assert classes["sidewalk"] == SIDEWALK_EDGES
    assert classes["bad_sidewalk_shape"] == []


def test_residual_classes_are_the_stated_counts(classes):
    """The residuals stay COUNTED as facts about the data the map renders exactly (V2.7d)."""
    assert classes["ped_on_car"] == PED_ON_CAR_LANE_NO_SIDEWALK
    assert classes["extra"] == EXTRA_NON_CAR_NON_PED_LANE
    assert classes["bus_only_lanes"] == EXTRA_NON_CAR_NON_PED_LANE  # the 23 are all bus+bike lanes


def test_car_lane_width_histogram_and_the_off_width_residual(classes):
    assert classes["car_widths"] == CAR_LANE_WIDTHS
    assert len(classes["off_width_edges"]) == OFF_WIDTH_CAR_LANE_EDGES
    assert classes["off_width_edges"] == OFF_WIDTH_EDGE_IDS


def test_wire_allows_ped_is_the_two_classes_summed(wire_rows):
    """The edge-level `allows.ped` = sidewalk edges + the ped-on-car residual (unchanged from V2.7c)."""
    assert len(wire_rows) == TOTAL_EDGES
    assert sum(1 for e in wire_rows if e["allows"]["ped"]) == SIDEWALK_EDGES + PED_ON_CAR_LANE_NO_SIDEWALK
