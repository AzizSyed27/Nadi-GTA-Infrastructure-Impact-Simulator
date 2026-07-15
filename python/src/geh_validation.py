"""V2.1b M5 — GEH VALIDATION: the calibrated baseline's simulated approach volumes vs the counted
ones, per approach directed edge across the supported intersections (~400-500 links).

GEH = sqrt(2(m-c)^2/(m+c)) on HOURLY flows (mirrors sumolib.statistics.geh). Headline = the share of
links with GEH < 5 on the 2h mean-hourly flows; the DMRB-style target (>=85%) is enforced HERE — SUMO
only reports percentages. Per-15-min tables go to provenance for diagnosis, not the headline.

SVC midblock counts are EXCLUDED from acceptance (stale 2013 + pair-attached direction) — context only.
Bike/ped make NO GEH claim (coarser anchoring, stated in provenance).

    python python/src/geh_validation.py --edgedata <sim_edgedata.xml> [--note "iteration 1: ..."]
"""

from __future__ import annotations

import argparse
import json
import math
import xml.etree.ElementTree as ET
from pathlib import Path

import run_sim  # wires SUMO_HOME/tools so sumolib imports
import sumolib
import demand_calibration as dc

GEH_OK = 5.0
TARGET_SHARE = 0.85  # DMRB-style: GEH<5 at >=85% of counted links
HOURS = dc.WINDOW_S / 3600.0


def geh(m: float, c: float) -> float:
    """Geoffrey E. Havers' error function on hourly flows (== sumolib.statistics.geh)."""
    if m + c == 0:
        return 0.0
    return math.sqrt(2 * (m - c) * (m - c) / (m + c))


def counted_approach_volumes(net, locs: list[dict]) -> dict[str, dict]:
    """{approach_edge_id: {location, node, label, counts: [8 x 15-min vehicles]}} using the SAME
    label-assignment + lane apportionment as the emitted turn counts (apples-to-apples)."""
    out: dict[str, dict] = {}
    for loc in locs:
        per_interval = dc.interval_counts(dc.load_bins(loc["count_id"], loc["date"]))
        appr_totals = {a: sum(per_interval.get(i, {}).get(a, {}).get(t, 0)
                              for i in range(dc.N_INTERVALS) for t in dc.TURNS)
                       for a in dc.APPROACHES}
        mapping, _ = dc.assign_labels(dc.leg_groups(net, loc["node_id"]), appr_totals)
        for a, leg in mapping.items():
            edges = leg["in"]
            if not edges:
                continue
            weights = [len(e.getLanes()) for e in edges]
            for i in range(dc.N_INTERVALS):
                cell = per_interval.get(i, {}).get(a)
                if cell is None:
                    continue
                total_i = sum(cell[t] for t in dc.TURNS)
                for e, part in zip(edges, dc.apportion(total_i, weights)):
                    row = out.setdefault(e.getID(), {"location": loc["name"], "node": loc["node_id"],
                                                     "label": a, "counts": [0] * dc.N_INTERVALS})
                    row["counts"][i] += part
    return out


def sim_approach_volumes(edgedata_xml: Path) -> dict[str, list[int]]:
    """{edge_id: [8 x entered]} from a sim edgeData output with period=900 over 0-7200s."""
    out: dict[str, list[int]] = {}
    root = ET.parse(edgedata_xml).getroot()
    for interval in root.iter("interval"):
        begin = float(interval.get("begin", "0"))
        idx = int(begin // dc.INTERVAL_S)
        if not (0 <= idx < dc.N_INTERVALS) or begin >= dc.WINDOW_S:
            continue
        for edge in interval.iter("edge"):
            eid = edge.get("id", "")
            out.setdefault(eid, [0] * dc.N_INTERVALS)[idx] += int(float(edge.get("entered", "0")))
    return out


def acceptance_table(counted: dict[str, dict], simulated: dict[str, list[int]]) -> dict:
    """One row per counted approach edge: counted vs simulated mean-hourly flow + GEH. A counted edge
    with NO sim data scores against 0 (an honest miss, never dropped)."""
    rows = []
    for eid, row in sorted(counted.items(), key=lambda kv: kv[1]["location"]):
        c_hourly = sum(row["counts"]) / HOURS
        sim = simulated.get(eid, [0] * dc.N_INTERVALS)
        m_hourly = sum(sim) / HOURS
        g = geh(m_hourly, c_hourly)
        rows.append({"location": row["location"], "node": row["node"], "edge": eid,
                     "label": row["label"], "counted_hourly": round(c_hourly, 1),
                     "simulated_hourly": round(m_hourly, 1), "geh": round(g, 2),
                     "geh_per_interval": [round(geh(s / (dc.INTERVAL_S / 3600.0),
                                                    c / (dc.INTERVAL_S / 3600.0)), 2)
                                          for s, c in zip(sim, row["counts"])]})
    n = len(rows)
    ok = sum(1 for r in rows if r["geh"] < GEH_OK)
    return {"rows": rows, "n_links": n, "geh_ok": GEH_OK,
            "share_geh_lt5": round(ok / n, 4) if n else 0.0,
            "target_share": TARGET_SHARE,
            "meets_target": bool(n and ok / n >= TARGET_SHARE)}


def main() -> None:
    ap = argparse.ArgumentParser(description="V2.1b GEH acceptance: sim edgeData vs counted approaches.")
    ap.add_argument("--edgedata", type=Path, required=True, help="sim edgeData XML (period=900, 0-7200s)")
    ap.add_argument("--note", type=str, default="", help="iteration note recorded in provenance")
    args = ap.parse_args()

    net = sumolib.net.readNet(str(run_sim.NET))
    locs = dc.load_supported_locations()
    counted = counted_approach_volumes(net, locs)
    simulated = sim_approach_volumes(args.edgedata)
    table = acceptance_table(counted, simulated)

    print(f"[geh] {table['n_links']} counted approach links | GEH<{GEH_OK:.0f} at "
          f"{table['share_geh_lt5'] * 100:.1f}% (target {TARGET_SHARE * 100:.0f}%) -> "
          f"{'MEETS TARGET' if table['meets_target'] else 'BELOW TARGET'}")
    worst = sorted(table["rows"], key=lambda r: -r["geh"])[:10]
    for r in worst:
        print(f"  GEH {r['geh']:6.2f}  counted {r['counted_hourly']:7.1f}/h  "
              f"sim {r['simulated_hourly']:7.1f}/h  {r['label']}  {r['location']}")

    prov = dc.append_provenance({
        "geh_acceptance": {k: v for k, v in table.items() if k != "rows"} | {"rows": table["rows"]},
        "iterations": [{"note": args.note or "acceptance run",
                        "share_geh_lt5": table["share_geh_lt5"],
                        "n_links": table["n_links"]}],
    })
    print(f"[geh] provenance updated -> {prov}")


if __name__ == "__main__":
    main()
