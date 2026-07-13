"""V2.0 Step b — NETWORK EXPORT: read the canonical corridor net and export every NORMAL edge to
``web/public/network.json`` so the frontend can render the SIMULATION's roads as the base map layer (not
basemap imagery). One-shot; RERUN whenever the canonical ``corridor.net.xml`` changes — this file and the
golden trajectory go stale together (see the run-spine note in CLAUDE.md).

Reuses the proven net-read pattern from ``network_edit.list_edges`` (sumolib, ``convertXY2LonLat`` — the ONLY
geo conversion in the repo). Positions are ALWAYS [lon, lat] (WGS84). This is NOT the frozen trajectory
contract — it is a derived render asset — so it has no schema/version, just a stable shape the map reads.

Per NORMAL edge (internal/junction edges skipped):
    {id, geometry: [[lon,lat]…], lanes: int, speed_mps: float, oneway: bool, allows: {car, bike, ped}}

``oneway`` is derived from the NODE PAIR (does the to-node have an outgoing edge back to the from-node), NOT the
``-`` id heuristic — minted roads (``nr_A_B``) and some OSM ids break the prefix rule.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import run_sim  # wires SUMO_HOME/tools onto sys.path so sumolib imports; exposes NET / ROOT
import sumolib

WEB_PUBLIC = run_sim.ROOT / "web" / "public"


def _is_oneway(edge) -> bool:
    """True if no reverse-partner edge runs from this edge's to-node back to its from-node (compare by NODE ID)."""
    from_id = edge.getFromNode().getID()
    return not any(e.getToNode().getID() == from_id for e in edge.getToNode().getOutgoing())


def export_edges(net_path: Path) -> dict:
    """Read the net and return {"edges": [...]} with the render shape. Pure — the caller writes the file."""
    net = sumolib.net.readNet(str(net_path))
    edges: list[dict] = []
    for edge in net.getEdges(withInternal=False):
        pts = [net.convertXY2LonLat(x, y) for (x, y) in edge.getShape()]
        if not pts:
            continue
        lanes = edge.getLanes()
        allows = {
            "car": any(lane.allows("passenger") for lane in lanes),
            "bike": any(lane.allows("bicycle") for lane in lanes),
            "ped": any(lane.allows("pedestrian") for lane in lanes),
        }
        edges.append({
            "id": edge.getID(),
            "geometry": [[round(lon, 6), round(lat, 6)] for lon, lat in pts],
            "lanes": len(lanes),
            "speed_mps": round(edge.getSpeed(), 3),
            "oneway": _is_oneway(edge),
            "allows": allows,
        })
    return {"edges": edges}


def main() -> None:
    ap = argparse.ArgumentParser(description="Export the canonical corridor net to web/public/network.json (V2.0b).")
    ap.add_argument("--output", type=Path, default=WEB_PUBLIC / "network.json",
                    help="output file (default: web/public/network.json)")
    args = ap.parse_args()

    data = export_edges(run_sim.NET)
    edges = data["edges"]
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
