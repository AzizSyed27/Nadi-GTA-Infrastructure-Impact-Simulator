"""V2.0 Step b — NETWORK EXPORT: read the canonical corridor net and export every NORMAL edge to
``web/public/network.json`` so the frontend can render the SIMULATION's roads as the base map layer (not
basemap imagery). One-shot; RERUN whenever the canonical ``corridor.net.xml`` changes — this file and the
golden trajectory go stale together (see the run-spine note in CLAUDE.md).

Reuses the proven net-read pattern from ``network_edit.list_edges`` (sumolib, ``convertXY2LonLat`` — the ONLY
geo conversion in the repo). Positions are ALWAYS [lon, lat] (WGS84). This is NOT the frozen trajectory
contract — it is a derived render asset — so it has no schema/version, just a stable shape the map reads.

Per NORMAL edge (internal/junction edges skipped) — the V2.7d v2 shape:
    {id, geometry: [[lon,lat]…],
     lanes: [{width_m, allows: {car, bike, ped, bus}}, …]   # the PER-LANE TABLE, index = SUMO lane index, 0 = curb
     lane_count: int,                                        # the old count, kept for readers that want a number
     speed_mps: float, oneway: bool, allows: {car, bike, ped},   # edge-level OR over the table
     name: str | None,                                       # the OSM street name (V2.7d), None when unnamed
     from: str, to: str,                                     # node ids
     reverse: str | None}                                    # the NODE-PAIR partner edge; None <=> oneway

``oneway`` and ``reverse`` derive from the NODE PAIR (the to-node's outgoing edge back to the from-node), NOT the
``-`` id heuristic — 3,186 of 4,192 two-way edges have a partner whose ``#k`` differs, minted roads (``nr_A_B``)
have no prefix at all. ``name`` comes from the tracked OSM extract by WAY ID (see ``street_names``): V2.7d C0's
dry run showed the netconvert recipe does not reproduce the canonical net, so the net carries no ``name=``
attrs and stays a fixed asset; ``--names-from net`` reads ``edge.getName()`` instead if a future net has them.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import run_sim  # wires SUMO_HOME/tools onto sys.path so sumolib imports; exposes NET / ROOT
import street_names
import sumolib

WEB_PUBLIC = run_sim.ROOT / "web" / "public"
OSM_EXTRACT = run_sim.ROOT / "python" / "scenario" / "corridor_bbox.osm.xml"

LANE_MODES = (("car", "passenger"), ("bike", "bicycle"), ("ped", "pedestrian"), ("bus", "bus"))


def _reverse_partner(edge) -> str | None:
    """The edge running from this edge's to-node back to its from-node (compare by NODE ID), else None."""
    from_id = edge.getFromNode().getID()
    for e in edge.getToNode().getOutgoing():
        if e.getToNode().getID() == from_id:
            return e.getID()
    return None


def _is_oneway(edge) -> bool:
    """True if no reverse-partner edge runs from this edge's to-node back to its from-node (compare by NODE ID)."""
    return _reverse_partner(edge) is None


def _lane_table(lanes) -> list[dict]:
    return [
        {
            "width_m": round(lane.getWidth(), 2),
            "allows": {key: lane.allows(vclass) for key, vclass in LANE_MODES},
        }
        for lane in lanes
    ]


def export_edges(net_path: Path, names_from: str = "auto", osm_path: Path = OSM_EXTRACT) -> dict:
    """Read the net and return {"edges": [...]} with the render shape. Pure — the caller writes the file.

    names_from: "osm" — the way-id join over the extract (the canonical net's case); "net" — `edge.getName()`;
    "auto" — the net if ANY edge carries a name, else the extract. The choice is printed by `main`.
    """
    net = sumolib.net.readNet(str(net_path))
    normal = [e for e in net.getEdges(withInternal=False) if e.getShape()]
    if names_from == "auto":
        names_from = "net" if any(e.getName() for e in normal) else "osm"
    way_names = street_names.osm_way_names(osm_path) if names_from == "osm" and osm_path.is_file() else {}

    edges: list[dict] = []
    for edge in normal:
        pts = [net.convertXY2LonLat(x, y) for (x, y) in edge.getShape()]
        lanes = edge.getLanes()
        table = _lane_table(lanes)
        if names_from == "net":
            name = edge.getName() or None
        else:
            name = street_names.resolve_name(edge.getID(), way_names)
        edges.append({
            "id": edge.getID(),
            "geometry": [[round(lon, 6), round(lat, 6)] for lon, lat in pts],
            "lanes": table,
            "lane_count": len(lanes),
            "speed_mps": round(edge.getSpeed(), 3),
            "oneway": _is_oneway(edge),
            "allows": {key: any(row["allows"][key] for row in table) for key in ("car", "bike", "ped")},
            "name": name,
            "from": edge.getFromNode().getID(),
            "to": edge.getToNode().getID(),
            "reverse": _reverse_partner(edge),
        })
    return {"edges": edges, "_names_from": names_from}


def main() -> None:
    ap = argparse.ArgumentParser(description="Export the canonical corridor net to web/public/network.json (V2.0b/V2.7d).")
    ap.add_argument("--output", type=Path, default=WEB_PUBLIC / "network.json",
                    help="output file (default: web/public/network.json)")
    ap.add_argument("--names-from", choices=("auto", "net", "osm"), default="auto",
                    help="street-name source: the net's name= attrs, the OSM extract by way id, or auto (default)")
    args = ap.parse_args()

    data = export_edges(run_sim.NET, names_from=args.names_from)
    names_from = data.pop("_names_from")
    edges = data["edges"]
    named = sum(1 for e in edges if e["name"])
    print(f"[network_export] street names from: {names_from}  ({named}/{len(edges)} edges named)")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))

    # Sanity: the oneway FRACTION is the whole verification of the one-way indicator — a sane net has one-ways
    # as a clear MINORITY (most streets are two-way edge-pairs). ~100% or ~0% means the derivation is wrong.
    n = len(edges)
    oneway = sum(1 for e in edges if e["oneway"])
    size_kb = args.output.stat().st_size / 1024
    print(f"[network_export] {n} edges -> {args.output}  ({size_kb:.0f} KB)")
    print(f"[network_export] oneway: {oneway}/{n} ({(oneway / n * 100 if n else 0):.0f}%)  "
          f"[expect a clear minority; ~100%/~0% => oneway derivation is wrong]")


if __name__ == "__main__":
    main()
