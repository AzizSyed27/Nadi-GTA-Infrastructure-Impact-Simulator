"""V2.7c — the LANE-MODEL INVARIANT the map's road styling derives from.

`web/public/network.json` carries per edge only `lanes` (a COUNT) and `allows{car,bike,ped}`; no
per-lane table. The transit-map restyle (web/lib/roadGeometry.ts `laneModel`) needs to know which
of those lanes is a sidewalk, and it derives that from ONE rule probed on the canonical net:

    allows.ped  ⇒  lane index 0 is a 2.0 m pedestrian-only sidewalk lane,
                   and the remaining `lanes − 1` are 3.2 m car lanes.

This test recomputes the rule's premises from `corridor.net.xml` and pins the counts as
LITERALS — so a netconvert regen (V2.7d's) that changes the lane bundle fails HERE, loudly, instead
of silently drawing every lane stripe half a lane off. The two residual classes the rule mishandles
are pinned too, as numbers, so they stay stated rather than discovered:

  * edges that allow pedestrians on a CAR lane with no sidewalk lane (drawn with a ribbon they
    lack), and
  * edges carrying one extra lane that is neither car nor pedestrian (drawn 3.2 m wide), and
  * car lanes that are not 3.2 m wide — found by THIS test's first run, not by the probe: four
    1.6 m lanes (the `23809840` segments) and two 7.0 m lanes (`27040771#0/#5`), six edges drawn
    at 3.2 m.

The exact per-lane table on the wire is V2.7d's network_export change; until then this pin is what
makes the derivation honest. Numbers here were probed on 2026-09-11 (CLAUDE.md, V2.7c).
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
EXTRA_NON_CAR_NON_PED_LANE = 23  # one lane that is neither car nor pedestrian (residual 2)
SIDEWALK_WIDTH_M = 2.0
CAR_LANE_WIDTH_M = 3.2
# Car-lane width histogram (lanes, not edges): the six off-width lanes are residual 3.
CAR_LANE_WIDTHS = {3.2: 6717, 1.6: 4, 7.0: 2}
OFF_WIDTH_CAR_LANE_EDGES = 6


def _classify(net):
    sidewalk = 0
    ped_on_car = 0
    extra = 0
    total = 0
    bad_sidewalk_shape = []  # any sidewalk edge whose sidewalk is not (one lane, index 0, 2.0 m)
    car_widths: dict[float, int] = {}
    off_width_edges = set()
    for e in net.getEdges(withInternal=False):
        if not e.getShape():
            continue  # network_export skips shapeless edges the same way
        total += 1
        lanes = e.getLanes()
        ped_only = [i for i, l in enumerate(lanes) if l.allows("pedestrian") and not l.allows("passenger")]
        car = [l for l in lanes if l.allows("passenger")]
        other = [l for l in lanes if not l.allows("passenger") and not l.allows("pedestrian")]
        any_ped = any(l.allows("pedestrian") for l in lanes)
        for l in car:
            w = round(l.getWidth(), 2)
            car_widths[w] = car_widths.get(w, 0) + 1
            if w != CAR_LANE_WIDTH_M:
                off_width_edges.add(e.getID())
        if ped_only:
            sidewalk += 1
            if ped_only != [0] or round(lanes[0].getWidth(), 2) != SIDEWALK_WIDTH_M:
                bad_sidewalk_shape.append(e.getID())
        elif any_ped:
            ped_on_car += 1
        if other:
            extra += 1
    return {
        "total": total,
        "sidewalk": sidewalk,
        "ped_on_car": ped_on_car,
        "extra": extra,
        "bad_sidewalk_shape": bad_sidewalk_shape,
        "car_widths": car_widths,
        "off_width_edges": off_width_edges,
    }


@pytest.fixture(scope="module")
def classes():
    return _classify(sumolib.net.readNet(str(run_sim.NET)))


def test_sidewalk_rule_holds_on_the_canonical_net(classes):
    """allows.ped ⇒ ONE 2.0 m ped-only lane at index 0 — for every sidewalk edge, no exceptions."""
    assert classes["total"] == TOTAL_EDGES
    assert classes["sidewalk"] == SIDEWALK_EDGES
    assert classes["bad_sidewalk_shape"] == []


def test_residual_classes_are_the_stated_counts(classes):
    """The two shapes the rule mishandles stay COUNTED (a change here is a change to what the map says)."""
    assert classes["ped_on_car"] == PED_ON_CAR_LANE_NO_SIDEWALK
    assert classes["extra"] == EXTRA_NON_CAR_NON_PED_LANE


def test_car_lane_width_histogram_and_the_off_width_residual(classes):
    """3.2 m is the car lane width the client multiplies `lanes − sidewalk` by — for all but six
    lanes on six edges (residual 3), pinned by histogram so a regen cannot move them silently."""
    assert classes["car_widths"] == CAR_LANE_WIDTHS
    assert len(classes["off_width_edges"]) == OFF_WIDTH_CAR_LANE_EDGES
    assert classes["off_width_edges"] == {
        "-23809840#2", "-23809840#3", "23809840#0", "23809840#3", "27040771#0", "27040771#5",
    }


def test_wire_allows_ped_is_the_two_classes_summed():
    """network.json's `allows.ped` (the client's ONLY input) = sidewalk edges + the ped-on-car residual."""
    edges = json.loads(NETWORK_JSON.read_text(encoding="utf-8"))["edges"]
    assert len(edges) == TOTAL_EDGES
    assert sum(1 for e in edges if e["allows"]["ped"]) == SIDEWALK_EDGES + PED_ON_CAR_LANE_NO_SIDEWALK
