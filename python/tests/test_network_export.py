"""V2.7d C1a — network.json v2: the per-lane table, street names, from/to nodes, the reverse partner.

`network_export.export_edges` is the ONLY producer of `web/public/network.json`, the map's single source
of road pixels and (since V2.7d) the single runtime source of street names on BOTH sides of the
Python<->TS boundary. These pins hold the v2 shape against the canonical net:

  * `lanes` is a TABLE (index = SUMO lane index, 0 = curb) of `{width_m, allows{car,bike,ped,bus}}` —
    the exact data the client's `laneModel` reads, replacing V2.7c's sidewalk derivation RULE;
    `lane_count` keeps the old count for the readers that only want a number.
  * `name` is the OSM way name (V2.7d C0 decided EXIT B: the canonical net is a fixed asset without
    `name=` attrs, so names come from the tracked extract by WAY ID — SUMO edge ids ARE OSM way ids —
    the same data `--output.street-names` would have copied). `""`/missing -> None, never "".
  * `from`/`to` are node ids; `reverse` is the NODE-PAIR partner (probed: 3,186 of 4,192 two-way edges
    have a partner whose `#k` differs from the `-id` guess — the client never derives a partner);
    `oneway <=> reverse is None`.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
try:  # run_sim wires SUMO_HOME/tools onto sys.path so sumolib imports — must precede it
    import run_sim
    import sumolib
except Exception:  # pragma: no cover - environment-dependent
    pytest.skip("SUMO/sumolib unavailable (SUMO_HOME unset)", allow_module_level=True)
# Our own modules import OUTSIDE the guard: a missing/broken module is a FAILURE, never a skip.
import network_export  # noqa: E402
import street_names  # noqa: E402

pytestmark = pytest.mark.skipif(not run_sim.NET.is_file(), reason="corridor net unavailable")

OSM = run_sim.ROOT / "python" / "scenario" / "corridor_bbox.osm.xml"

# Probed on the canonical net + the tracked extract (2026-09-13/14); the "derive from data" rule.
MARKHAM = "-1288863201"
DOORSTEP = "-36784353#20"  # Rochman Boulevard
FIRST_TWO_WAY = "-1073334268#2"  # its node-pair partner is NOT `1073334268#2`
FIRST_TWO_WAY_PARTNER = "1073334268#0"
RAMP = "135952898-AddedOnRampEdge"


# ---- the way-id resolver (pure) -------------------------------------------------------------------

def test_way_id_of_strips_direction_segment_and_ramp_suffixes():
    assert street_names.way_id_of("1288863201") == "1288863201"
    assert street_names.way_id_of("-1288863201") == "1288863201"
    assert street_names.way_id_of("27040771#5") == "27040771"
    assert street_names.way_id_of("-36784353#20") == "36784353"
    assert street_names.way_id_of(RAMP) == "135952898"
    assert street_names.way_id_of("-135953626-AddedOffRampEdge") == "135953626"
    assert street_names.way_id_of("-135952898#2-AddedOnRampEdge") == "135952898"


def test_way_id_of_leaves_minted_and_synthetic_ids_alone():
    # A minted road (`nr_A_B`) or a fixture id has no way; the resolver returns it unchanged and the
    # name lookup simply misses — id-only rendering, never a raise.
    assert street_names.way_id_of("nr_A_B") == "nr_A_B"
    assert street_names.way_id_of("E1") == "E1"


@pytest.mark.skipif(not OSM.is_file(), reason="OSM extract unavailable")
def test_osm_way_names_reads_the_tracked_extract():
    names = street_names.osm_way_names(OSM)
    assert names["1288863201"] == "Markham Road"
    assert names["36784353"] == "Rochman Boulevard"
    assert "42140001" in names and names["42140001"] == "Kingston Road"
    assert len(names) > 3000  # 3,193 named ways probed; a shrinking extract would be a different file


# ---- the export shape ----------------------------------------------------------------------------

@pytest.fixture(scope="module")
def exported():
    return {e["id"]: e for e in network_export.export_edges(run_sim.NET)["edges"]}


@pytest.fixture(scope="module")
def net():
    return sumolib.net.readNet(str(run_sim.NET))


def test_every_edge_carries_the_v2_keys(exported):
    keys = {"id", "geometry", "lanes", "lane_count", "speed_mps", "oneway", "allows", "name", "from", "to", "reverse"}
    assert all(set(e) == keys for e in exported.values())
    assert len(exported) == 4570


def test_lane_table_matches_the_net_per_lane(exported, net):
    """The table IS the net: one row per SUMO lane, in index order, width + the four modes."""
    for e in net.getEdges(withInternal=False):
        if not e.getShape():
            continue
        row = exported[e.getID()]
        lanes = e.getLanes()
        assert row["lane_count"] == len(lanes)
        assert len(row["lanes"]) == len(lanes)
        for i, lane in enumerate(lanes):
            t = row["lanes"][i]
            assert t["width_m"] == round(lane.getWidth(), 2)
            assert t["allows"] == {
                "car": lane.allows("passenger"),
                "bike": lane.allows("bicycle"),
                "ped": lane.allows("pedestrian"),
                "bus": lane.allows("bus"),
            }


def test_edge_allows_stays_the_or_over_the_table(exported):
    for row in exported.values():
        for mode in ("car", "bike", "ped"):
            assert row["allows"][mode] == any(t["allows"][mode] for t in row["lanes"])


def test_names_are_the_osm_way_names_or_none(exported):
    assert exported[MARKHAM]["name"] == "Markham Road"
    assert exported[DOORSTEP]["name"] == "Rochman Boulevard"
    for row in exported.values():
        assert row["name"] is None or (isinstance(row["name"], str) and row["name"] != "")


@pytest.mark.skipif(not OSM.is_file(), reason="OSM extract unavailable")
def test_ramp_edges_resolve_through_their_way_prefix(exported):
    """A netconvert-minted ramp edge names whatever its WAY is named — here the way is an unnamed
    highway link in OSM, so the honest answer is None (found by this test's first run, which had
    assumed the prefix implied a name). The pin is equality with the extract, not non-nullness."""
    names = street_names.osm_way_names(OSM)
    assert street_names.way_id_of(RAMP) == "135952898"
    assert exported[RAMP]["name"] == names.get("135952898")


def test_the_export_counts_are_the_probed_literals(exported):
    """Probed on the first C1a export (2026-09-14): named / unnamed / one-way — a moved count is a moved net."""
    assert sum(1 for r in exported.values() if r["name"]) == 4487
    assert sum(1 for r in exported.values() if r["name"] is None) == 83
    assert sum(1 for r in exported.values() if r["oneway"]) == 378
    assert sum(1 for r in exported.values() if r["reverse"] is None) == 378


def test_from_to_and_the_node_pair_reverse_partner(exported, net):
    e = net.getEdge(FIRST_TWO_WAY)
    row = exported[FIRST_TWO_WAY]
    assert row["from"] == e.getFromNode().getID()
    assert row["to"] == e.getToNode().getID()
    assert row["reverse"] == FIRST_TWO_WAY_PARTNER  # not the `-id` guess
    assert exported[FIRST_TWO_WAY_PARTNER]["reverse"] == FIRST_TWO_WAY


def test_oneway_iff_no_reverse_partner(exported):
    for row in exported.values():
        assert row["oneway"] == (row["reverse"] is None)
        if row["reverse"] is not None:
            partner = exported[row["reverse"]]
            assert partner["from"] == row["to"] and partner["to"] == row["from"]
