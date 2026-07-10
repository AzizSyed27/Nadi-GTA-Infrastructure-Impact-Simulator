"""Phase 5.1 — the NETWORK EDIT pipeline: patch the canonical corridor net with a NEW ROAD via netconvert,
then run it through a safety gauntlet. The canonical ``corridor.net.xml`` is NEVER modified — the patched net
is a PER-RUN file under ``contract/runs/nets/<run_id>.net.xml`` (gitignored).

A new_road is a GEOMETRY change (unlike speed_limit/bike_lane, which are runtime TraCI edits): the road *is* a
network patch, so we hand netconvert a tiny ``.edg.xml`` referencing EXISTING junction ids and let it merge +
build the connections. Never hand-edit a ``.net.xml`` (SUMO's own guidance).

netconvert patch (MINIMAL — every guessing flag omitted; any of --junctions.join / --geometry.remove /
--ramps.guess / --roundabouts.guess would re-split existing edges and break the additive invariant):
    netconvert --sumo-net-file <canonical>.net.xml --edge-files <run_id>.edg.xml -o <run_id>.net.xml
"""

from __future__ import annotations

import argparse
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path

import run_sim  # wires SUMO_HOME/tools onto sys.path so sumolib imports; exposes NET / SUMO_HOME
import sumolib
from contract_models import Change

NETCONVERT = run_sim.SUMO_HOME / "bin" / "netconvert.exe"
NETS_DIR = run_sim.ROOT / "contract" / "runs" / "nets"
ROUTES = run_sim.ROOT / "python" / "scenario" / "corridor.rou.xml"  # car routes — the additive-invariant guard


# ==================================================================================================
# minting + validation
# ==================================================================================================
def validate_new_road(change: Change) -> None:
    """Pipeline-level (NOT schema) validation: a new_road MUST carry geometry. Raises loudly otherwise."""
    if change.type != "new_road":
        raise ValueError(f"network_edit only patches new_road changes, got {change.type!r}")
    missing = [f for f in ("from_junction", "to_junction", "lanes", "speed_mps") if getattr(change, f) is None]
    if missing:
        raise ValueError(f"new_road change is missing required geometry: {missing}")


def minted_edge_ids(change: Change) -> list[str]:
    """The new edge id(s). Forward first (== the change's target_edge); a reverse edge iff bidirectional."""
    fwd = f"nr_{change.from_junction}_{change.to_junction}"
    return [fwd, f"nr_{change.to_junction}_{change.from_junction}"] if change.bidirectional else [fwd]


def _write_edg_xml(change: Change, edge_ids: list[str], path: Path) -> None:
    lanes, speed = int(change.lanes), float(change.speed_mps)
    edges = ["<edges>"]
    # forward: from -> to; reverse (if any): to -> from
    ends = [(change.from_junction, change.to_junction)]
    if len(edge_ids) == 2:
        ends.append((change.to_junction, change.from_junction))
    for eid, (a, b) in zip(edge_ids, ends):
        edges.append(f'  <edge id="{eid}" from="{a}" to="{b}" numLanes="{lanes}" '
                     f'speed="{speed:.3f}" allow="passenger"/>')
    edges.append("</edges>\n")
    path.write_text("\n".join(edges), encoding="utf-8")


def _write_con_xml(can_net, change: Change, edge_ids: list[str], path: Path) -> None:
    """On --sumo-net-file re-import netconvert PRESERVES existing junction connections, so a bare new edge is
    unreachable (0 incoming). `reset="true"` removes+re-guesses a from-edge's connections — we reset every
    EXISTING edge incoming to each new edge's from-node (so they pick up the new edge) plus the new edges
    themselves. This is the sanctioned patch mechanism (SUMO PlainXML docs), not a guessing heuristic."""
    from_nodes = [change.from_junction]
    if len(edge_ids) == 2:  # the reverse edge departs the to-junction
        from_nodes.append(change.to_junction)
    reset_edges: set[str] = set()
    for node_id in from_nodes:
        for e in can_net.getNode(node_id).getIncoming():
            reset_edges.add(e.getID())
    lines = ["<connections>"]
    for eid in sorted(reset_edges) + list(edge_ids):
        lines.append(f'  <connection from="{eid}" reset="true"/>')
    lines.append("</connections>\n")
    path.write_text("\n".join(lines), encoding="utf-8")


# ==================================================================================================
# THE GAUNTLET (named invariants)
# ==================================================================================================
def _location_attrs(net_path: Path) -> dict:
    loc = ET.parse(net_path).getroot().find("location")
    if loc is None:
        raise RuntimeError(f"{net_path.name} has no <location> — not a geo-referenced net")
    return {k: loc.get(k) for k in ("projParameter", "netOffset", "origBoundary", "convBoundary")}


def _normal_edge_ids(net) -> set[str]:
    return {e.getID() for e in net.getEdges(withInternal=False)}


def _route_edges(rou_path: Path) -> set[str]:
    if not rou_path.is_file():
        return set()
    out: set[str] = set()
    for route in ET.parse(rou_path).getroot().iter("route"):
        out.update((route.get("edges") or "").split())
    return out


def run_gauntlet(canonical_path: Path, patched_path: Path, new_edge_ids: list[str]) -> dict:
    """The additive/geo/connectivity safety gauntlet. Raises on any violation. Returns a stats dict."""
    # (2) GEO-REF byte-identical
    can_loc, new_loc = _location_attrs(canonical_path), _location_attrs(patched_path)
    for k in ("projParameter", "netOffset", "origBoundary"):
        if can_loc[k] != new_loc[k]:
            raise AssertionError(f"GEO-REF changed ({k}): {can_loc[k]!r} != {new_loc[k]!r}")

    can_net = sumolib.net.readNet(str(canonical_path))
    new_net = sumolib.net.readNet(str(patched_path))
    can_edges, new_edges = _normal_edge_ids(can_net), _normal_edge_ids(new_net)

    # (3) ADDITIVE — every canonical edge (and every route edge) survives with its id
    dropped = can_edges - new_edges
    if dropped:
        raise AssertionError(f"ADDITIVE violated — {len(dropped)} canonical edges missing (e.g. {sorted(dropped)[:5]})")
    missing_routes = _route_edges(ROUTES) - new_edges
    if missing_routes:
        raise AssertionError(f"ADDITIVE violated — route edges missing: {sorted(missing_routes)[:5]}")

    # (4) EDGE-COUNT DELTA — exactly the new edges, nothing re-split
    expected = len(new_edge_ids)
    delta = len(new_edges) - len(can_edges)
    if delta != expected:
        raise AssertionError(f"EDGE-COUNT DELTA {delta} != expected {expected} (netconvert re-split edges?)")
    for eid in new_edge_ids:
        if eid not in new_edges:
            raise AssertionError(f"minted edge {eid!r} not in patched net")

    # (5) CONNECTIVITY — the new edge is ROUTABLE (a car can enter AND exit it), not a stub
    for eid in new_edge_ids:
        e = new_net.getEdge(eid)
        if not e.getIncoming() or not e.getOutgoing():
            raise AssertionError(
                f"CONNECTIVITY: new edge {eid!r} is a stub (incoming={len(e.getIncoming())}, "
                f"outgoing={len(e.getOutgoing())}) — no vehicle can use it; pick different junctions")

    return {"canonical_edges": len(can_edges), "patched_edges": len(new_edges), "new_edges": new_edge_ids,
            "geo_ref_identical": True}


# ==================================================================================================
# the patch
# ==================================================================================================
def patch_network(change: Change, run_id: str) -> tuple[Path, list[str], dict]:
    """Build a per-run patched net for a new_road change and run the gauntlet. The CANONICAL net is read-only
    and asserted unchanged (mtime+size). Returns (patched_net_path, minted_edge_ids, gauntlet_stats)."""
    validate_new_road(change)
    if not NETCONVERT.is_file():
        raise FileNotFoundError(f"netconvert not found: {NETCONVERT} (set SUMO_HOME)")

    canonical = run_sim.NET
    can_net = sumolib.net.readNet(str(canonical))  # read-only
    for j in (change.from_junction, change.to_junction):
        try:
            can_net.getNode(j)
        except KeyError:
            raise ValueError(f"junction {j!r} is not in the canonical net — pick an existing junction id")

    edge_ids = minted_edge_ids(change)
    NETS_DIR.mkdir(parents=True, exist_ok=True)
    edg_path = NETS_DIR / f"{run_id}.edg.xml"
    out_path = NETS_DIR / f"{run_id}.net.xml"

    # (1) CANONICAL-UNTOUCHED — encode it: never write over the canonical; snapshot it before the patch.
    if out_path.resolve() == canonical.resolve():
        raise AssertionError("refusing to write the patched net over the canonical corridor.net.xml")
    before = (canonical.stat().st_mtime_ns, canonical.stat().st_size)

    _write_edg_xml(change, edge_ids, edg_path)
    con_path = NETS_DIR / f"{run_id}.con.xml"
    _write_con_xml(can_net, change, edge_ids, con_path)
    cmd = [str(NETCONVERT), "--sumo-net-file", str(canonical), "--edge-files", str(edg_path),
           "--connection-files", str(con_path), "-o", str(out_path)]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"netconvert failed (exit {proc.returncode}):\n{proc.stderr[-2000:]}")

    after = (canonical.stat().st_mtime_ns, canonical.stat().st_size)
    if before != after:
        raise AssertionError("CANONICAL-UNTOUCHED violated — corridor.net.xml changed during the patch")

    stats = run_gauntlet(canonical, out_path, edge_ids)
    return out_path, edge_ids, stats


# ==================================================================================================
# junction snap targets (for the editor / CLI junction-picking)
# ==================================================================================================
def list_junctions(bbox: list[float] | None = None) -> list[dict]:
    """Existing junctions as snap targets: {id, lon, lat, type, n_in, n_out}. Skips internal nodes. bbox =
    [minLon,minLat,maxLon,maxLat] filters."""
    net = sumolib.net.readNet(str(run_sim.NET))
    out: list[dict] = []
    for node in net.getNodes():
        if node.getType() == "internal":
            continue
        x, y = node.getCoord()
        lon, lat = net.convertXY2LonLat(x, y)
        if bbox and not (bbox[0] <= lon <= bbox[2] and bbox[1] <= lat <= bbox[3]):
            continue
        out.append({"id": node.getID(), "lon": round(lon, 6), "lat": round(lat, 6), "type": node.getType(),
                    "n_in": len(node.getIncoming()), "n_out": len(node.getOutgoing())})
    return out


# ==================================================================================================
# edge listing + bike-lane eligibility (the editor's edit-an-edge palette — Phase 5.2b)
# ==================================================================================================
def _car_lane_indices_static(net, edge_id: str) -> list[int]:
    """Static (sumolib) car-lane indices — the pre-sim mirror of ``run_sim._car_lane_indices`` (live conn)."""
    return [i for i, lane in enumerate(net.getEdge(edge_id).getLanes()) if lane.allows("passenger")]


def edge_bike_eligibility(net, edge_id: str) -> tuple[bool, str]:
    """Static bike-lane eligibility, deferring to the SINGLE-SOURCE rule ``run_sim.bike_lane_reason`` (the same
    one the live ``apply_change`` enforces). Returns (eligible, reason): eligible -> reason 'eligible', else the
    backend's exact words. Used by ``/api/edges`` (the greyed affordance) and ``/api/simulate`` (400 on reject)."""
    if not net.hasEdge(edge_id):
        return False, f"edge {edge_id!r} not found in the network"
    reason = run_sim.bike_lane_reason(_car_lane_indices_static(net, edge_id), edge_id)
    return (reason is None), (reason or "eligible")


def list_edges(bbox: list[float] | None = None) -> list[dict]:
    """Corridor edges for the editor: {id, geometry [[lon,lat]…], speed_mps, car_lane_count, eligible_bike_lane,
    eligibility_reason}. Skips internal edges. bbox = [minLon,minLat,maxLon,maxLat] keeps an edge if ANY shape
    point is inside (the frontend zoom-gates, so city zoom never asks for the whole net)."""
    net = sumolib.net.readNet(str(run_sim.NET))
    out: list[dict] = []
    for edge in net.getEdges(withInternal=False):
        pts = [net.convertXY2LonLat(x, y) for (x, y) in edge.getShape()]
        if not pts:
            continue
        if bbox and not any(bbox[0] <= lon <= bbox[2] and bbox[1] <= lat <= bbox[3] for lon, lat in pts):
            continue
        eid = edge.getID()
        eligible, reason = edge_bike_eligibility(net, eid)
        out.append({"id": eid,
                    "geometry": [[round(lon, 6), round(lat, 6)] for lon, lat in pts],
                    "speed_mps": round(edge.getSpeed(), 3),
                    "car_lane_count": len(_car_lane_indices_static(net, eid)),
                    "eligible_bike_lane": eligible, "eligibility_reason": reason})
    return out


# ==================================================================================================
def _change_from_args(args) -> Change:
    a, b = args.from_junction, args.to_junction
    return Change(type="new_road", target_edge=f"nr_{a}_{b}", from_junction=a, to_junction=b,
                  lanes=args.lanes, speed_mps=args.speed, bidirectional=args.bidirectional,
                  description=args.description or f"New road from junction {a} to {b}")


def main() -> None:
    ap = argparse.ArgumentParser(description="Patch the corridor net with a new_road (Phase 5.1).")
    ap.add_argument("--list-junctions", action="store_true", help="print junction snap targets and exit")
    ap.add_argument("--bbox", default=None, help="minLon,minLat,maxLon,maxLat filter for --list-junctions")
    ap.add_argument("--from-junction")
    ap.add_argument("--to-junction")
    ap.add_argument("--lanes", type=int, default=1)
    ap.add_argument("--speed", type=float, default=13.9)  # ~50 km/h
    ap.add_argument("--bidirectional", action="store_true")
    ap.add_argument("--description", default=None)
    ap.add_argument("--run-id", default="edit-test")
    args = ap.parse_args()

    if args.list_junctions:
        import json
        bbox = [float(x) for x in args.bbox.split(",")] if args.bbox else None
        js = list_junctions(bbox)
        print(json.dumps(js, indent=2))
        print(f"\n[{len(js)} junctions]")
        return

    if not (args.from_junction and args.to_junction):
        raise SystemExit("need --from-junction and --to-junction (or --list-junctions)")
    change = _change_from_args(args)
    out_path, edge_ids, stats = patch_network(change, args.run_id)
    print(f"[network_edit] minted edges: {edge_ids}")
    print(f"[network_edit] patched net : {out_path}")
    print(f"[network_edit] GAUNTLET OK : {stats}")


if __name__ == "__main__":
    main()
