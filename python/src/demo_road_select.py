"""Phase 5.3 — DEMO ROAD SELECTION. Rank candidate new_road junction pairs by DETOUR FACTOR
(network shortest-path distance / straight-line distance) on the CANONICAL net. A high factor means the road
network genuinely lacks a direct connector there — so a drawn road pulls a VISIBLE reroute count (5.1's
acceptance pair had factor ~1 and pulled ~1 car). Read-only: never patches or writes the net.

    python python/src/demo_road_select.py                 # top 5
    python python/src/demo_road_select.py --top 10 --sample 120

For each ranked pair, the printed junction ids drop straight into the editor (or the CLI/API) as
from/to junctions for a new_road.
"""

from __future__ import annotations

import argparse
import math

import run_sim  # wires SUMO_HOME/tools so sumolib imports; exposes NET
import sumolib

_EARTH_M = 6_371_000.0


def _haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Great-circle distance in metres between two (lon, lat) points."""
    (lon1, lat1), (lon2, lat2) = a, b
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * _EARTH_M * math.asin(min(1.0, math.sqrt(h)))


def _real_junctions(net) -> list[dict]:
    """Real intersections (non-internal, car-routable both ways) with lon/lat + a passenger out/in edge."""
    out: list[dict] = []
    for n in net.getNodes():
        if n.getType() == "internal":
            continue
        oe = [e for e in n.getOutgoing() if e.allows("passenger")]
        ie = [e for e in n.getIncoming() if e.allows("passenger")]
        if not (oe and ie):
            continue
        x, y = n.getCoord()
        lon, lat = net.convertXY2LonLat(x, y)
        out.append({"id": n.getID(), "lon": lon, "lat": lat, "out": oe[0], "in": ie[0]})
    return out


def rank_pairs(net, sample: int = 90, band_m: tuple[float, float] = (250.0, 1200.0),
               max_paths: int = 1200) -> list[dict]:
    """Rank connector-scale junction pairs by detour factor = network-dist / straight-line-dist. Bounds the
    shortest-path count: samples ``sample`` junctions (deterministic stride) and only pairs within ``band_m``."""
    js = _real_junctions(net)
    js.sort(key=lambda j: j["id"])
    stride = max(1, len(js) // sample)
    picks = js[::stride][:sample]

    results: list[dict] = []
    paths_run = 0
    for i, a in enumerate(picks):
        for b in picks[i + 1:]:
            straight = _haversine_m((a["lon"], a["lat"]), (b["lon"], b["lat"]))
            if not (band_m[0] <= straight <= band_m[1]):
                continue
            if paths_run >= max_paths:
                break
            path, cost = net.getShortestPath(a["out"], b["in"], vClass="passenger")
            paths_run += 1
            if path is None or cost <= 0:
                continue  # unreachable by car (a directed dead-end) — not a demo candidate
            net_dist = sum(e.getLength() for e in path)
            results.append({"from": a["id"], "to": b["id"], "from_lonlat": (round(a["lon"], 6), round(a["lat"], 6)),
                            "to_lonlat": (round(b["lon"], 6), round(b["lat"], 6)),
                            "straight_m": round(straight), "net_m": round(net_dist),
                            "factor": round(net_dist / straight, 2)})
        if paths_run >= max_paths:
            break
    results.sort(key=lambda r: r["factor"], reverse=True)
    return results


def main() -> None:
    ap = argparse.ArgumentParser(description="Rank new_road junction pairs by detour factor (5.3 demo selection).")
    ap.add_argument("--top", type=int, default=5)
    ap.add_argument("--sample", type=int, default=90, help="junctions sampled (deterministic stride)")
    ap.add_argument("--band", type=str, default="250,1200", help="straight-line band in metres: min,max")
    ap.add_argument("--max-paths", type=int, default=1200)
    args = ap.parse_args()
    lo, hi = (float(x) for x in args.band.split(","))

    net = sumolib.net.readNet(str(run_sim.NET))
    ranked = rank_pairs(net, sample=args.sample, band_m=(lo, hi), max_paths=args.max_paths)
    if not ranked:
        print("no candidate pairs in band — widen --band")
        return
    print(f"\nTop {args.top} demo-road candidates (network-dist / straight-line; higher = network lacks a connector):\n")  # noqa: E501
    print(f"{'#':>2}  {'from':>12}  {'to':>12}  {'straight':>9}  {'network':>9}  {'factor':>6}")
    print("-" * 62)
    for i, r in enumerate(ranked[: args.top], 1):
        print(f"{i:>2}  {r['from']:>12}  {r['to']:>12}  {r['straight_m']:>7}m  {r['net_m']:>7}m  {r['factor']:>6}")
    best = ranked[0]
    print(f"\nDemo road -> draw {best['from']} to {best['to']}  "
          f"(straight {best['straight_m']}m, road {best['net_m']}m, detour x{best['factor']}).")


if __name__ == "__main__":
    main()
