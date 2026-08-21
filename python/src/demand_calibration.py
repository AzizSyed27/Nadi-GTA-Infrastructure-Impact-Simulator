"""V2.1 Step b — CALIBRATED AM-PEAK DEMAND build (counts -> routeSampler -> validated routes).

Turns the V2.1a inventory's 126 fully-covered TMC intersections into SUMO demand: maps each count's
compass approaches onto the net's junction edges, emits routeSampler count files (8x900s intervals,
t=0 == 07:00), generates route candidates, and orchestrates routeSampler. The n_appr compass
convention is EMPIRICALLY GATED before anything is built on it (`verify-convention` — hard-fails,
including a rotation test proving the chosen orientation beats 90/180/270 alternatives).

Class handling: cars+truck+bus are MERGED per movement (the pipeline's mode taxonomy is car/bike/ped;
stated in provenance). Bike counts anchor approach-level edgeData (no turn resolution — coarser,
stated). Ped counts anchor a corridor-total walk scale (order-of-magnitude, NO GEH claim).

    python python/src/demand_calibration.py verify-convention   # M1 gate — run FIRST
    python python/src/demand_calibration.py emit-counts         # M2: turn counts + bike edgeData + provenance
    python python/src/demand_calibration.py candidates          # M3: randomTrips candidate pools
    python python/src/demand_calibration.py sample              # M3: routeSampler passes -> calibrated routes
    python python/src/demand_calibration.py probe               # M4: plain-sumo measure run
    python python/src/demand_calibration.py full                # verify -> emit -> candidates -> sample

Bulky intermediates live under %LOCALAPPDATA%/nadi-demand/ (OneDrive-safe); tracked outputs are
python/scenario/calibrated/ (routes+cfg) and data/demand/ (count files + provenance).
"""

from __future__ import annotations

import argparse
import glob
import json
import math
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from xml.sax.saxutils import quoteattr

import run_sim  # wires SUMO_HOME/tools so sumolib imports; exposes NET / ROOT / SUMO_HOME
import sumolib
from count_inventory import ATTRIBUTION, DATASET_URLS


def _segment_bearing(p0, p1) -> float:
    """Compass bearing (0=N, clockwise) of the segment p0->p1 in UTM XY."""
    return math.degrees(math.atan2(p1[0] - p0[0], p1[1] - p0[1])) % 360.0


def arrival_bearing(edge) -> float:
    """Travel bearing of an INCOMING edge AT the junction (last shape segment). Long edges curve —
    Kingston Rd's chord bearing is tens of degrees off its local approach direction — so the chord
    (count_inventory._edge_bearing) must never classify approaches."""
    shape = edge.getShape()
    return _segment_bearing(shape[-2], shape[-1])


def departure_bearing(edge) -> float:
    """Travel bearing of an OUTGOING edge AT the junction (first shape segment)."""
    shape = edge.getShape()
    return _segment_bearing(shape[0], shape[1])

ROOT = run_sim.ROOT
INVENTORY_GLOB = str(ROOT / "data" / "counts" / "counts-inventory-*.json")
BINS_CACHE = Path(os.environ.get("LOCALAPPDATA") or os.environ.get("TMP") or ".") / "nadi-counts"
LOCAL = Path(os.environ.get("LOCALAPPDATA") or os.environ.get("TMP") or ".") / "nadi-demand"
DATA_DEMAND = ROOT / "data" / "demand"
CAL_DIR = ROOT / "python" / "scenario" / "calibrated"
TOOLS = run_sim.SUMO_HOME / "tools"

# Sim-time convention: t=0 == 07:00. Eight 15-min intervals cover the counted AM peak.
AM_START_MIN = 7 * 60          # minutes since midnight of the first bin
N_INTERVALS = 8
INTERVAL_S = 900
WINDOW_S = N_INTERVALS * INTERVAL_S  # 7200

APPROACHES = ("n", "e", "s", "w")
TURNS = ("l", "t", "r")
_QUADRANT_CENTER = {"n": 0.0, "e": 90.0, "s": 180.0, "w": 270.0}
VEHICLE_CLASSES = ("cars", "truck", "bus")  # merged per movement — stated in provenance


# --------------------------------------------------------------------------------------
# pure compass / classification helpers (unit-tested, no net)
# --------------------------------------------------------------------------------------

def signed_delta(bearing: float, reference: float) -> float:
    """Signed smallest angle from reference to bearing in [-180, 180); positive = clockwise."""
    return (bearing - reference + 180.0) % 360.0 - 180.0


def compass_quadrant(bearing: float) -> str:
    """n/e/s/w quadrant (±45°) of a compass bearing."""
    for q, center in _QUADRANT_CENTER.items():
        if abs(signed_delta(bearing, center)) <= 45.0:
            return q
    return "n"  # unreachable — quadrants tile the circle


def approach_quadrant(travel_bearing: float, rotation: float = 0.0) -> str:
    """Which compass leg a vehicle ARRIVES from, given its direction of travel.

    Traveling south (bearing 180) means arriving from the north leg -> 'n'. The TMC convention
    hypothesis (n_appr = the leg on the intersection's north side) is exactly this flip; ``rotation``
    exists only for the verify-convention rotation test.
    """
    return compass_quadrant((travel_bearing + 180.0 + rotation) % 360.0)


def classify_turn(in_bearing: float, out_bearing: float) -> str:
    """'t'hrough / 'r'ight / 'l'eft / 'u'-turn by relative bearing (compass clockwise-positive)."""
    rel = signed_delta(out_bearing, in_bearing)
    if abs(rel) < 45.0:
        return "t"
    if 45.0 <= rel < 135.0:
        return "r"
    if -135.0 < rel <= -45.0:
        return "l"
    return "u"


def interval_index(start_time: str) -> int | None:
    """0..7 interval index for a bin's start_time (ISO datetime), or None outside 07:00-09:00."""
    s = start_time.split("T", 1)[1] if "T" in start_time else start_time
    try:
        h, m = int(s.split(":")[0]), int(s.split(":")[1])
    except (ValueError, IndexError):
        return None
    offset = h * 60 + m - AM_START_MIN
    if not (0 <= offset < N_INTERVALS * 15):
        return None
    return offset // 15


def merged_movements(record: dict) -> dict[str, dict[str, int]]:
    """One raw 15-min bin record -> {approach: {'l'/'t'/'r': merged cars+truck+bus, 'peds', 'bike'}}."""
    out: dict[str, dict[str, int]] = {}
    for a in APPROACHES:
        cell = {t: sum(int(record.get(f"{a}_appr_{c}_{t}") or 0) for c in VEHICLE_CLASSES) for t in TURNS}
        cell["peds"] = int(record.get(f"{a}_appr_peds") or 0)
        cell["bike"] = int(record.get(f"{a}_appr_bike") or 0)
        out[a] = cell
    return out


# --------------------------------------------------------------------------------------
# inventory + bins loading
# --------------------------------------------------------------------------------------

def newest_inventory() -> Path:
    # Digit-first (the resolver-family rule; the space holds one ts-shaped file today —
    # future-proofing against the V22AACCEPT-class junk that fired twice elsewhere).
    paths = sorted(p for p in glob.glob(INVENTORY_GLOB)
                   if Path(p).name.rsplit("-", 1)[-1][:1].isdigit())
    if not paths:
        raise SystemExit("no counts inventory found — run count_inventory.py first (V2.1a)")
    return Path(paths[-1])


def load_supported_locations(inv_path: Path | None = None) -> list[dict]:
    """The calibration input set: matched TMC intersections whose bins fully cover 07:00-09:00.

    Each: {count_id, node_id, name, date (latest covering date), am_peak_start, am_peak_vehicle}.
    """
    path = inv_path or newest_inventory()
    inv = json.loads(path.read_text(encoding="utf-8"))
    locs = []
    for x in inv["locations"]:
        if x["source"] != "TMC" or x["kind"] != "intersection":
            continue
        if not x["match"]["matched"] or not x.get("am_bins", {}).get("covered"):
            continue
        locs.append({
            "count_id": int(x["count_id"]),
            "node_id": x["match"]["id"],
            "name": x["name"],
            "date": sorted(x["am_bins"]["dates"])[-1],
            "am_peak_start": x["time_window"].get("am_peak_start"),
            "am_peak_vehicle": x["time_window"].get("am_peak_vehicle"),
            "lon": x["lon"], "lat": x["lat"],
        })
    if not locs:
        raise SystemExit(f"{path.name}: no AM-peak-supported locations — nothing to calibrate")
    return locs


def load_bins(count_id: int, date: str) -> list[dict]:
    """This count's raw 15-min records for one date, from the V2.1a cache. Fails loudly if absent."""
    path = BINS_CACHE / f"tmc-bins-{count_id}.json"
    if not path.is_file():
        raise SystemExit(f"missing bin cache {path} — rerun count_inventory.py (it probes matched TMCs)")
    records = json.loads(path.read_text(encoding="utf-8"))["records"]
    return [r for r in records if str(r.get("count_date", ""))[:10] == date]


def interval_counts(bins: list[dict]) -> dict[int, dict[str, dict[str, int]]]:
    """{interval_idx: {approach: {l,t,r,peds,bike}}} summed over a single date's AM-window bins."""
    out: dict[int, dict[str, dict[str, int]]] = {}
    for rec in bins:
        idx = interval_index(str(rec.get("start_time", "")))
        if idx is None:
            continue
        merged = merged_movements(rec)
        slot = out.setdefault(idx, {a: {k: 0 for k in (*TURNS, "peds", "bike")} for a in APPROACHES})
        for a in APPROACHES:
            for k in (*TURNS, "peds", "bike"):
                slot[a][k] += merged[a][k]
    return out


# --------------------------------------------------------------------------------------
# net-side approach mapping
# --------------------------------------------------------------------------------------

def _passenger_edges(edges) -> list:
    return [e for e in edges if e.allows("passenger")]


def fit_leg_rotation(leg_bearings: list[float]) -> float:
    """Per-junction compass skew θ ∈ [-45, 45): the offset that best aligns {θ, θ+90, θ+180, θ+270}
    with the junction's actual leg bearings. Toronto's TMC approach labels are SEMANTIC (Kingston Rd
    legs are 'e/w' even where the road runs ~60° NE); a strict geometric quadrant drops those legs
    into the wrong bucket. Grid-aligned junctions fit θ≈0 — behavior there is unchanged."""
    if not leg_bearings:
        return 0.0
    best_theta, best_err = 0.0, math.inf
    for theta_deg in range(-45, 45):
        err = sum(min(abs(signed_delta(b, (theta_deg + k * 90.0) % 360.0)) for k in range(4))
                  for b in leg_bearings)
        if err < best_err:
            best_theta, best_err = float(theta_deg), err
    return best_theta


CLUSTER_RADIUS_M = 45.0   # divided-road carriageway crossings sit ~20-40 m apart
CLUSTER_EDGE_M = 60.0     # only short connector edges chain nodes into one intersection
CLUSTER_MAX_NODES = 6


def cluster_nodes(net, node_id: str) -> list:
    """The matched node + neighbors that are really the SAME intersection: at divided roads the side
    street crosses each carriageway at a separate net node 20-40 m apart, so approaches on the far
    carriageway are invisible to the matched node's getIncoming(). BFS over short passenger edges
    within CLUSTER_RADIUS_M of the matched node (bounded — never chains down the block)."""
    root = net.getNode(node_id)
    if root is None:
        raise KeyError(f"junction {node_id!r} not in net")
    rx, ry = root.getCoord()
    seen = {root.getID(): root}
    frontier = [root]
    while frontier and len(seen) < CLUSTER_MAX_NODES:
        node = frontier.pop()
        for e in _passenger_edges(list(node.getIncoming()) + list(node.getOutgoing())):
            if e.getLength() > CLUSTER_EDGE_M:
                continue
            for n in (e.getFromNode(), e.getToNode()):
                nid = n.getID()
                if nid in seen:
                    continue
                nx, ny = n.getCoord()
                if math.hypot(nx - rx, ny - ry) <= CLUSTER_RADIUS_M:
                    seen[nid] = n
                    frontier.append(n)
    return list(seen.values())


def _boundary_edges(net, node_id: str) -> tuple[list, list]:
    """(incoming-from-outside, outgoing-to-outside) passenger edges of the virtual cluster. Internal
    connector edges (both ends inside) are the --turn-max-gap hop, not approaches/exits."""
    nodes = cluster_nodes(net, node_id)
    ids = {n.getID() for n in nodes}
    inc, out = [], []
    for n in nodes:
        for e in _passenger_edges(n.getIncoming()):
            if e.getFromNode().getID() not in ids:
                inc.append(e)
        for e in _passenger_edges(n.getOutgoing()):
            if e.getToNode().getID() not in ids:
                out.append(e)
    return inc, out


def _junction_rotation(net, node_id: str) -> float:
    """The fitted skew from ALL cluster-boundary legs (junction-local bearings)."""
    inc, out = _boundary_edges(net, node_id)
    legs = [(arrival_bearing(e) + 180.0) % 360.0 for e in inc] + [departure_bearing(e) for e in out]
    return fit_leg_rotation(legs)


def approach_edges(net, node_id: str, rotation: float = 0.0) -> dict[str, list]:
    """{n/e/s/w: [cluster-boundary incoming edges arriving from that compass leg]}, labeled in the
    junction's FITTED frame (see fit_leg_rotation). ``rotation`` adds on top of the fit — the
    verify-convention rotation test spins the PRODUCTION mapping by 90/180/270."""
    rot = rotation - _junction_rotation(net, node_id)
    inc, _ = _boundary_edges(net, node_id)
    out: dict[str, list] = {a: [] for a in APPROACHES}
    for e in inc:
        out[approach_quadrant(arrival_bearing(e), rot)].append(e)
    return out


def exit_edges(net, node_id: str, rotation: float = 0.0) -> dict[str, list]:
    """{n/e/s/w: [cluster-boundary outgoing edges LEAVING toward that compass leg]}, same frame."""
    rot = rotation - _junction_rotation(net, node_id)
    _, outs = _boundary_edges(net, node_id)
    out: dict[str, list] = {a: [] for a in APPROACHES}
    for e in outs:
        out[compass_quadrant((departure_bearing(e) + rot) % 360.0)].append(e)
    return out


LEG_CLUSTER_DEG = 30.0     # boundary edges within this bearing spread form one street leg
LABEL_DEVIATION_CAP = 80.0  # a label never binds to a leg more than this far from its nominal compass


def leg_groups(net, node_id: str) -> list[dict]:
    """Cluster the junction's boundary edges into street LEGS by bearing: each leg carries its
    approach-from bearing plus its in/out edges, sorted clockwise. (A leg's in-edges arrive FROM that
    compass side; its out-edges depart TOWARD it.)"""
    inc, outs = _boundary_edges(net, node_id)
    items = [((arrival_bearing(e) + 180.0) % 360.0, "in", e) for e in inc]
    items += [(departure_bearing(e), "out", e) for e in outs]
    items.sort(key=lambda x: x[0])
    legs: list[dict] = []
    for b, kind, e in items:
        home = None
        for leg in legs:
            if abs(signed_delta(b, leg["bearing"])) <= LEG_CLUSTER_DEG:
                home = leg
                break
        if home is None:
            home = {"bearing": b, "in": [], "out": [], "_bearings": []}
            legs.append(home)
        home[kind].append(e)
        home["_bearings"].append(b)
        # circular mean keeps the leg center honest as edges accumulate
        sines = sum(math.sin(math.radians(x)) for x in home["_bearings"])
        cosines = sum(math.cos(math.radians(x)) for x in home["_bearings"])
        home["bearing"] = math.degrees(math.atan2(sines, cosines)) % 360.0
    legs.sort(key=lambda leg: leg["bearing"])
    return legs


def assign_labels(legs: list[dict], label_volumes: dict[str, int]) -> tuple[dict[str, dict], list[str]]:
    """Match counted compass labels to street legs. Toronto's TMC labels are STREET-SEMANTIC —
    Kingston Rd's legs are always 'e'/'w' because Kingston is nominally east-west, even where it
    locally bears ~33° — so no quadrant or global rotation can place them. Instead: enumerate
    injective, cyclic-order-preserving maps from the counted labels onto legs (deviation-capped),
    minimizing (unmatched counted volume, then total angular deviation).

    Returns ({label: leg}, unmatched_labels)."""
    labels = [a for a in APPROACHES if label_volumes.get(a, 0) > 0]
    if not labels or not legs:
        return {}, labels
    from itertools import permutations

    def cyclic_ok(idx: list[int]) -> bool:
        # leg indices must advance clockwise exactly once as labels do
        rel = [(i - idx[0]) % len(legs) for i in idx]
        return all(rel[k] < rel[k + 1] for k in range(len(rel) - 1))

    from itertools import combinations

    best_key, best_map = None, None
    n = len(legs)
    for k in range(min(len(labels), n), 0, -1):  # all sizes — a smaller map can drop LESS volume
        for keep in combinations(labels, k):
            for idx in permutations(range(n), k):
                if not cyclic_ok(list(idx)):
                    continue
                devs = [abs(signed_delta(legs[i]["bearing"], _QUADRANT_CENTER[lab]))
                        for lab, i in zip(keep, idx)]
                if any(d > LABEL_DEVIATION_CAP for d in devs):
                    continue
                unmatched = sum(label_volumes.get(a, 0) for a in labels if a not in keep)
                key = (unmatched, sum(devs))
                if best_key is None or key < best_key:
                    best_key = key
                    best_map = {lab: legs[i] for lab, i in zip(keep, idx)}
    if best_map is None:
        return {}, labels
    return best_map, [a for a in labels if a not in best_map]


def movement_exits(net, node_id: str, in_edge) -> dict[str, list]:
    """{'l'/'t'/'r': [cluster-boundary exit edges in that band]} for one approach edge (u-turns
    skipped). from->to may span an internal connector edge — routeSampler's --turn-max-gap covers it."""
    _, outs = _boundary_edges(net, node_id)
    in_b = arrival_bearing(in_edge)
    out: dict[str, list] = {t: [] for t in TURNS}
    for e in outs:
        band = classify_turn(in_b, departure_bearing(e))
        if band in out:
            out[band].append(e)
    return out


# --------------------------------------------------------------------------------------
# the convention gate (M1)
# --------------------------------------------------------------------------------------

def _location_leg_violations(net, loc: dict, totals: dict[str, dict[str, int]],
                             rotation: float) -> tuple[int, int]:
    """(violations, checks) for one location at one rotation: counted flow on legs the NET says are
    impossible. approach counts on a leg with no incoming edge; exit-bound counts toward a leg with
    no outgoing edge. 'Counted flow' threshold: >2% of the location total AND >20 vehicles/2h."""
    appr = approach_edges(net, loc["node_id"], rotation)
    exits = exit_edges(net, loc["node_id"], rotation)
    loc_total = sum(sum(cell[t] for t in TURNS) for cell in totals.values()) or 1
    # counted exit-bound volume toward compass q, derived from movements:
    #   exit_n = s_appr_t + e_appr_r + w_appr_l   (and rotations thereof)
    exit_bound = {}
    ring = {"n": ("s", "e", "w"), "e": ("w", "s", "n"), "s": ("n", "w", "e"), "w": ("e", "n", "s")}
    for q, (thru_from, right_from, left_from) in ring.items():
        exit_bound[q] = totals[thru_from]["t"] + totals[right_from]["r"] + totals[left_from]["l"]

    violations = checks = 0
    for q in APPROACHES:
        counted_in = sum(totals[q][t] for t in TURNS)
        checks += 1
        if not appr[q] and counted_in > max(20, 0.02 * loc_total):
            violations += 1
        checks += 1
        if not exits[q] and exit_bound[q] > max(20, 0.02 * loc_total):
            violations += 1
    return violations, checks


def verify_convention(net, locs: list[dict], sample_n: int = 20) -> dict:
    """The empirical n_appr gate. Three checks over a deterministic sample of locations, plus a
    ROTATION test: the 0° orientation must strictly minimize impossible-leg violations vs 90/180/270.
    Returns the evidence dict; raises SystemExit on FAIL."""
    picks = sorted(locs, key=lambda x: x["count_id"])[:: max(1, len(locs) // sample_n)][:sample_n]

    rotation_viols = {rot: 0 for rot in (0.0, 90.0, 180.0, 270.0)}
    totals_checks: list[dict] = []
    exit_missing_major = 0
    major_movements = 0

    for loc in picks:
        bins = load_bins(loc["count_id"], loc["date"])
        per_interval = interval_counts(bins)
        totals = {a: {k: sum(per_interval[i][a][k] for i in per_interval) for k in (*TURNS, "peds", "bike")}
                  for a in APPROACHES}

        # (a) totals reconciliation vs the city's own am_peak_vehicle (peak HOUR = 4 consecutive bins)
        anchor = loc.get("am_peak_vehicle")
        peak_start = str(loc.get("am_peak_start") or "")
        if anchor and peak_start[:10] == loc["date"]:
            idx0 = interval_index(peak_start)
            if idx0 is not None and idx0 <= N_INTERVALS - 4:
                hour = sum(sum(per_interval.get(i, {a: {t: 0 for t in TURNS} for a in APPROACHES})[a][t]
                               for a in APPROACHES for t in TURNS) for i in range(idx0, idx0 + 4))
                rel_err = abs(hour - anchor) / anchor if anchor else 0.0
                totals_checks.append({"name": loc["name"], "ours": hour, "city": anchor,
                                      "rel_err": round(rel_err, 4)})

        # (b) impossible-leg violations at each rotation — the decisive compass test
        for rot in rotation_viols:
            v, _ = _location_leg_violations(net, loc, totals, rot)
            rotation_viols[rot] += v

        # (c) exit-consistency: major counted movements (>=50 veh/2h) must have an exit edge in-band
        appr = approach_edges(net, loc["node_id"])
        for a in APPROACHES:
            if not appr[a]:
                continue
            bands = movement_exits(net, loc["node_id"], appr[a][0])
            for t in TURNS:
                if totals[a][t] >= 50:
                    major_movements += 1
                    if not bands[t]:
                        exit_missing_major += 1

    ok_totals = [c for c in totals_checks if c["rel_err"] <= 0.05]
    evidence = {
        "sampled_locations": len(picks),
        "totals_checks": totals_checks,
        "totals_within_5pct": f"{len(ok_totals)}/{len(totals_checks)}",
        "rotation_violations": {f"{int(k)}deg": v for k, v in rotation_viols.items()},
        "major_movements_missing_exit": f"{exit_missing_major}/{major_movements}",
    }

    passed = (
        (not totals_checks or len(ok_totals) >= 0.8 * len(totals_checks))
        and rotation_viols[0.0] < min(v for r, v in rotation_viols.items() if r != 0.0)
        and (major_movements == 0 or exit_missing_major <= 0.1 * major_movements)
    )
    evidence["verdict"] = "PASS" if passed else "FAIL"
    print(json.dumps(evidence, indent=2))
    if not passed:
        raise SystemExit("verify-convention FAIL — do NOT build demand on this mapping; "
                         "inspect the evidence above (rotation table = compass orientation; "
                         "totals = bin linkage; missing exits = L/T/R banding)")
    return evidence


# --------------------------------------------------------------------------------------
# M2 — count-file emitters + provenance
# --------------------------------------------------------------------------------------

def apportion(total: int, weights: list[int]) -> list[int]:
    """Split ``total`` across ``weights`` (e.g. lane counts) by largest remainder — sums exactly."""
    if not weights:
        return []
    wsum = sum(weights) or len(weights)
    shares = [total * (w or 1) / wsum for w in weights]
    floors = [int(s) for s in shares]
    rem = total - sum(floors)
    order = sorted(range(len(shares)), key=lambda i: shares[i] - floors[i], reverse=True)
    for i in order[:rem]:
        floors[i] += 1
    return floors


_IDEAL_REL = {"t": 0.0, "r": 90.0, "l": -90.0}


def _best_exit(in_edge, band_edges: list, turn: str):
    """The exit edge whose junction-local bearing sits closest to the turn's ideal relative bearing."""
    in_b = arrival_bearing(in_edge)
    return min(band_edges,
               key=lambda e: abs(signed_delta(departure_bearing(e), (in_b + _IDEAL_REL[turn]) % 360.0)))


def build_turn_counts(net, locs: list[dict], agg: int = 1) -> dict:
    """Emit data/demand/turn_counts.am.xml (<edgeRelation from to count> intervals) from the supported
    locations' bins. ``agg`` groups the 8x900s bins (agg=4 -> two HOURLY intervals): DMRB GEH is defined
    on hourly flows and our acceptance metric is the 2h mean-hourly, so hourly constraints keep the
    calibrated CLAIM intact while giving routeSampler more freedom than per-15-min targets (departures
    inside an aggregated interval spread uniformly — stated in provenance). Multi-edge approaches split
    by lane-count apportionment (exact sums); unmappable counts are SKIPPED AND LOGGED, never silently
    dropped. Counted zeros are kept (a zero is real data)."""
    n_groups = N_INTERVALS // agg
    intervals: list[list[str]] = [[] for _ in range(N_INTERVALS)]
    skip_report: list[dict] = []
    splits: list[dict] = []
    emitted_total = skipped_total = 0
    per_location: list[dict] = []
    deviations: list[float] = []

    for loc in locs:
        per_interval = interval_counts(load_bins(loc["count_id"], loc["date"]))
        appr_totals = {a: sum(per_interval.get(i, {}).get(a, {}).get(t, 0)
                              for i in range(N_INTERVALS) for t in TURNS) for a in APPROACHES}
        mapping, unmatched = assign_labels(leg_groups(net, loc["node_id"]), appr_totals)
        loc_emitted = loc_skipped = 0
        for a in unmatched:
            skip_report.append({"location": loc["name"], "approach": a,
                                "reason": "no leg matches this counted label", "count_2h": appr_totals[a]})
            loc_skipped += appr_totals[a]
        for a, leg in mapping.items():
            deviations.append(abs(signed_delta(leg["bearing"], _QUADRANT_CENTER[a])))
            edges = leg["in"]
            if not edges:
                if appr_totals[a]:
                    skip_report.append({"location": loc["name"], "approach": a,
                                        "reason": "matched leg has no incoming edge (one-way outbound)",
                                        "count_2h": appr_totals[a]})
                    loc_skipped += appr_totals[a]
                continue
            weights = [len(e.getLanes()) for e in edges]
            if len(edges) > 1:
                splits.append({"location": loc["name"], "approach": a,
                               "edges": [e.getID() for e in edges], "lane_weights": weights})
            bands_per_edge = [movement_exits(net, loc["node_id"], e) for e in edges]
            for g in range(n_groups):
                cells = [per_interval.get(i, {}).get(a) for i in range(g * agg, (g + 1) * agg)]
                merged_cell = {t: sum(c[t] for c in cells if c) for t in TURNS}
                if not any(merged_cell.values()) and all(c is None for c in cells):
                    continue
                for t in TURNS:
                    parts = apportion(merged_cell[t], weights)
                    for e, bands, part in zip(edges, bands_per_edge, parts):
                        if not bands[t]:
                            if part:
                                skip_report.append({"location": loc["name"], "approach": a, "turn": t,
                                                    "interval": g, "reason": "no exit edge in band",
                                                    "count": part})
                                loc_skipped += part
                            continue
                        exit_e = _best_exit(e, bands[t], t)
                        intervals[g].append(f'    <edgeRelation from={quoteattr(e.getID())} '
                                            f'to={quoteattr(exit_e.getID())} count="{part}"/>')
                        loc_emitted += part
        emitted_total += loc_emitted
        skipped_total += loc_skipped
        per_location.append({"name": loc["name"], "emitted": loc_emitted, "skipped": loc_skipped})

    DATA_DEMAND.mkdir(parents=True, exist_ok=True)
    path = DATA_DEMAND / "turn_counts.am.xml"
    span = INTERVAL_S * agg
    lines = ["<data>"]
    for g in range(n_groups):
        lines.append(f'  <interval id="am_{g}" begin="{g * span}" end="{(g + 1) * span}">')
        lines.extend(intervals[g])
        lines.append("  </interval>")
    lines.append("</data>")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    assignment = {"mean_deviation_deg": round(sum(deviations) / len(deviations), 1) if deviations else 0,
                  "max_deviation_deg": round(max(deviations), 1) if deviations else 0}
    return {"path": path, "emitted_total": emitted_total, "skipped_total": skipped_total,
            "skip_report": skip_report, "splits": splits, "per_location": per_location,
            "assignment": assignment}


def build_bike_edgedata(net, locs: list[dict]) -> dict:
    """Approach-level bike counts as an edgeData file (bike TMC has NO turn resolution — coarser,
    stated). Assigned to approach edges by the same lane apportionment."""
    intervals: list[list[str]] = [[] for _ in range(N_INTERVALS)]
    total = 0
    for loc in locs:
        per_interval = interval_counts(load_bins(loc["count_id"], loc["date"]))
        bike_totals = {a: sum(per_interval.get(i, {}).get(a, {}).get("bike", 0)
                              for i in range(N_INTERVALS)) for a in APPROACHES}
        mapping, _ = assign_labels(leg_groups(net, loc["node_id"]), bike_totals)
        for a, leg in mapping.items():
            edges = leg["in"]
            if not edges:
                continue
            weights = [len(e.getLanes()) for e in edges]
            for i in range(N_INTERVALS):
                cell = per_interval.get(i, {}).get(a)
                if not cell or not cell["bike"]:
                    continue
                for e, part in zip(edges, apportion(cell["bike"], weights)):
                    if part:
                        intervals[i].append(f'    <edge id={quoteattr(e.getID())} entered="{part}"/>')
                        total += part
    DATA_DEMAND.mkdir(parents=True, exist_ok=True)
    path = DATA_DEMAND / "bike_edgedata.am.xml"
    lines = ["<data>"]
    for i, rows in enumerate(intervals):
        lines.append(f'  <interval id="am_bike_{i}" begin="{i * INTERVAL_S}" end="{(i + 1) * INTERVAL_S}">')
        lines.extend(rows)
        lines.append("  </interval>")
    lines.append("</data>")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return {"path": path, "total": total}


def ped_counted_total(locs: list[dict]) -> int:
    """2h pedestrian crossings summed over counted intersections — the corridor walk-demand anchor
    (order-of-magnitude only; peds are crossing counts, not link volumes — NO GEH claim)."""
    total = 0
    for loc in locs:
        per_interval = interval_counts(load_bins(loc["count_id"], loc["date"]))
        total += sum(per_interval[i][a]["peds"] for i in per_interval for a in APPROACHES)
    return total


def write_provenance(inv_path: Path, locs: list[dict], turn_stats: dict, bike_stats: dict,
                     ped_total: int) -> Path:
    """The demand-profile provenance artifact. GEH tables / iterations / measurements are APPENDED by
    later steps (geh_validation.py, the probe) — this writes the build-side truth."""
    inv = json.loads(inv_path.read_text(encoding="utf-8"))
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = DATA_DEMAND / f"demand-calibrated-am-{ts}.json"
    dates = sorted({loc["date"] for loc in locs})
    blob = {
        "profile": "calibrated_am_peak",
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "attribution": ATTRIBUTION,
        "datasets": {k: {"url": v, "retrieved_at": inv["retrieved_at"]} for k, v in DATASET_URLS.items()},
        "inventory": inv_path.name,
        "sim_time_convention": "t=0 == 07:00; window 0-7200s; 8x900s intervals",
        "locations_used": [{"count_id": loc["count_id"], "junction": loc["node_id"],
                            "name": loc["name"], "count_date": loc["date"]} for loc in locs],
        "caveats": {
            "composite_day": f"each location contributes its own latest covering date "
                             f"({dates[0]}..{dates[-1]}, {len(dates)} distinct days) — this demand is a "
                             "COMPOSITE typical AM peak, not one observed morning",
            "class_merge": "cars+truck+bus merged per movement (the pipeline's mode taxonomy is "
                           "car/bike/ped); no separate heavy-vehicle demand",
            "bike": "bike counts anchor APPROACH-LEVEL edgeData only (TMC bikes carry no turn "
                    "resolution) — coarser than vehicle turn calibration",
            "ped": "ped counts are intersection CROSSINGS; they anchor a corridor-total walk scale, "
                   "order-of-magnitude only — NO GEH claim for bike/ped",
        },
        "turn_counts": {"file": turn_stats["path"].name, "emitted_total": turn_stats["emitted_total"],
                        "skipped_total": turn_stats["skipped_total"],
                        "label_assignment": turn_stats["assignment"],
                        "skip_report": turn_stats["skip_report"], "splits": turn_stats["splits"]},
        "bike_edgedata": {"file": bike_stats["path"].name, "total": bike_stats["total"]},
        "ped_counted_total_2h": ped_total,
        "tool_cmdlines": [],   # appended by the candidates/sample steps
        "iterations": [],      # appended by geh_validation
        "measurements": {},    # appended by the probe
    }
    path.write_text(json.dumps(blob, indent=2, ensure_ascii=False), encoding="utf-8")
    return path


def newest_provenance() -> Path:
    # Digit-first (the resolver-family rule) — see newest_inventory.
    paths = sorted(p for p in DATA_DEMAND.glob("demand-calibrated-am-*.json")
                   if p.name[len("demand-calibrated-am-"):][:1].isdigit())
    if not paths:
        raise SystemExit("no provenance JSON — run `demand_calibration.py emit-counts` first")
    return paths[-1]


def emit_counts(net, locs: list[dict], agg: int = 1) -> Path:
    inv_path = newest_inventory()
    turn_stats = build_turn_counts(net, locs, agg=agg)
    bike_stats = build_bike_edgedata(net, locs)
    ped_total = ped_counted_total(locs)
    prov = write_provenance(inv_path, locs, turn_stats, bike_stats, ped_total)
    kept = turn_stats["emitted_total"]
    skipped = turn_stats["skipped_total"]
    print(f"[emit] turn counts: {kept} vehicles emitted, {skipped} skipped "
          f"({len(turn_stats['skip_report'])} skip entries) -> {turn_stats['path']}")
    print(f"[emit] bike edgeData: {bike_stats['total']} -> {bike_stats['path']}")
    print(f"[emit] ped counted total (2h crossings): {ped_total}")
    print(f"[emit] provenance -> {prov}")
    return prov


# --------------------------------------------------------------------------------------
# M3 — candidates + routeSampler build
# --------------------------------------------------------------------------------------

CAR_VTYPE = '    <vType id="passenger" vClass="passenger"/>'
BIKE_VTYPE = '    <vType id="bike_bicycle" vClass="bicycle"/>'
PED_WALK_SHARE = 3.0  # assumed counted-crossing events per walking trip (order-of-magnitude anchor)


def _run_tool(cmd: list, log_name: str) -> tuple[float, str, str]:
    """Run a SUMO tool, log full output under LOCAL, fail loudly. Returns (wall_s, stdout, cmdline)."""
    LOCAL.mkdir(parents=True, exist_ok=True)
    argv = [str(c) for c in cmd]
    t0 = time.perf_counter()
    proc = subprocess.run(argv, capture_output=True, text=True,
                          env={**os.environ, "SUMO_HOME": str(run_sim.SUMO_HOME)})
    wall = time.perf_counter() - t0
    log = LOCAL / log_name
    log.write_text((proc.stdout or "") + "\n--- stderr ---\n" + (proc.stderr or ""), encoding="utf-8")
    if proc.returncode != 0:
        raise SystemExit(f"{Path(argv[1] if len(argv) > 1 else argv[0]).name} failed "
                         f"(exit {proc.returncode}) — see {log}")
    cmdline = " ".join(Path(a).name if os.sep in a or "/" in a else a for a in argv)
    return wall, proc.stdout or "", cmdline


def build_candidates(period: float = 0.5, fringe: float = 10.0, intermediate: int = 0,
                     routing_factor: float = 1.5) -> list[str]:
    """randomTrips candidate pools (cars + bikes) under LOCAL. Deterministic seeds; --validate routes
    via duarouter so routeSampler gets a real .rou.xml pool. The car-pool knobs are the GEH-iteration
    levers (density/variety/origin spread)."""
    cmdlines = []
    car = [sys.executable, TOOLS / "randomTrips.py", "-n", run_sim.NET,
           "-o", LOCAL / "cand.car.trips.xml", "-r", LOCAL / "cand.car.rou.xml",
           "-b", "0", "-e", str(WINDOW_S), "-p", str(period), "--fringe-factor", str(fringe),
           *(["--intermediate", str(intermediate)] if intermediate else []),
           "--min-distance", "300", "--validate", "--edge-permission", "passenger",
           "--random-routing-factor", str(routing_factor), "--seed", "42", "--prefix", "c"]
    wall, _, cmdline = _run_tool(car, "randomtrips.car.log")
    print(f"[candidates] cars: {wall:.0f}s")
    cmdlines.append(cmdline)
    bike = [sys.executable, TOOLS / "randomTrips.py", "-n", run_sim.NET,
            "-o", LOCAL / "cand.bike.trips.xml", "-r", LOCAL / "cand.bike.rou.xml",
            "-b", "0", "-e", str(WINDOW_S), "-p", "4", "--fringe-factor", "3",
            "--min-distance", "200", "--max-distance", "4000", "--validate",
            "--vehicle-class", "bicycle", "--edge-permission", "bicycle",
            "--seed", "42", "--prefix", "cb"]
    wall, _, cmdline = _run_tool(bike, "randomtrips.bike.log")
    print(f"[candidates] bikes: {wall:.0f}s")
    cmdlines.append(cmdline)
    return cmdlines


def _prepend_vtype(path: Path, vtype_xml: str) -> None:
    text = path.read_text(encoding="utf-8")
    head_end = text.index(">", text.index("<routes")) + 1
    path.write_text(text[:head_end] + "\n" + vtype_xml + text[head_end:], encoding="utf-8")


def _assert_prefixes(car_path: Path, bike_path: Path) -> tuple[int, int]:
    """join_per_mode splits car/bike on the literal `bike` id prefix — this invariant is load-bearing."""
    import xml.etree.ElementTree as ET
    car_ids = [v.get("id", "") for v in ET.parse(car_path).getroot().iter("vehicle")]
    bike_ids = [v.get("id", "") for v in ET.parse(bike_path).getroot().iter("vehicle")]
    assert car_ids and all(i.startswith("veh") and not i.startswith("bike") for i in car_ids), \
        "car ids must start with 'veh' (and never 'bike')"
    assert bike_ids and all(i.startswith("bike") for i in bike_ids), "bike ids must start with 'bike'"
    return len(car_ids), len(bike_ids)


def _geh_lines(stdout: str) -> list[str]:
    return [ln.strip() for ln in stdout.splitlines() if "GEH" in ln or "achieving" in ln]


def sample_routes() -> dict:
    """routeSampler passes (cars: turn counts; bikes: approach edgeData) + scaled ped walks into
    python/scenario/calibrated/, plus the calibrated sumocfg. Returns build stats for provenance."""
    CAL_DIR.mkdir(parents=True, exist_ok=True)
    stats: dict = {"tool_cmdlines": [], "build_geh": {}}

    car_out = CAL_DIR / "calibrated.am.rou.xml"
    car = [sys.executable, TOOLS / "routeSampler.py", "-r", LOCAL / "cand.car.rou.xml",
           "-t", DATA_DEMAND / "turn_counts.am.xml", "-o", car_out,
           "--prefix", "veh", "--geh-ok", "5", "--turn-max-gap", "2", "--optimize", "full",
           "--seed", "42", "--mismatch-output", LOCAL / "mismatch.car.xml",
           "--attributes", 'type="passenger" departLane="best"']
    wall, stdout, cmdline = _run_tool(car, "routesampler.car.log")
    print(f"[sample] cars: {wall:.0f}s")
    stats["tool_cmdlines"].append(cmdline)
    stats["build_geh"]["car"] = _geh_lines(stdout)

    bike_out = CAL_DIR / "calibrated.am.bike.rou.xml"
    bike = [sys.executable, TOOLS / "routeSampler.py", "-r", LOCAL / "cand.bike.rou.xml",
            "-d", DATA_DEMAND / "bike_edgedata.am.xml", "-o", bike_out,
            "--prefix", "bike", "--geh-ok", "5", "--seed", "42",
            "--mismatch-output", LOCAL / "mismatch.bike.xml",
            "--attributes", 'type="bike_bicycle"']
    wall, stdout, cmdline = _run_tool(bike, "routesampler.bike.log")
    print(f"[sample] bikes: {wall:.0f}s")
    stats["tool_cmdlines"].append(cmdline)
    stats["build_geh"]["bike"] = _geh_lines(stdout)

    _prepend_vtype(car_out, CAR_VTYPE)
    _prepend_vtype(bike_out, BIKE_VTYPE)

    ped_total = ped_counted_total(load_supported_locations())
    walks = max(1, int(ped_total / PED_WALK_SHARE))
    ped_out = CAL_DIR / "calibrated.am.ped.rou.xml"
    ped = [sys.executable, TOOLS / "randomTrips.py", "-n", run_sim.NET,
           "-o", LOCAL / "cand.ped.trips.xml", "-r", ped_out,
           "-b", "0", "-e", str(WINDOW_S), "-p", f"{WINDOW_S / walks:.4f}",
           "--pedestrians", "--prefix", "ped", "--min-distance", "50", "--max-distance", "1500",
           "--seed", "42"]
    wall, stdout, cmdline = _run_tool(ped, "randomtrips.ped.log")
    print(f"[sample] peds: {wall:.0f}s ({walks} walks anchored to {ped_total} counted crossings "
          f"/ {PED_WALK_SHARE} crossings-per-walk)")
    stats["tool_cmdlines"].append(cmdline)
    stats["ped"] = {"counted_crossings_2h": ped_total, "crossings_per_walk_assumed": PED_WALK_SHARE,
                    "walks": walks}

    n_car, n_bike = _assert_prefixes(car_out, bike_out)
    stats["vehicles"] = {"car": n_car, "bike": n_bike}
    print(f"[sample] calibrated demand: {n_car} cars, {n_bike} bikes, {walks} peds")

    cfg = CAL_DIR / "corridor.calibrated.am.sumocfg"
    cfg.write_text(
        "<configuration>\n"
        "  <!-- V2.1b calibrated AM-peak demand (t=0 == 07:00; departs 0-7200s). Generated by\n"
        "       demand_calibration.py sample — provenance in data/demand/. SEPARATE from the synthetic\n"
        "       corridor.sumocfg / corridor.multimodal.sumocfg (golden test + default harness). -->\n"
        "  <input>\n"
        '    <net-file value="../corridor.net.xml"/>\n'
        '    <route-files value="calibrated.am.rou.xml,calibrated.am.bike.rou.xml,'
        'calibrated.am.ped.rou.xml"/>\n'
        "  </input>\n"
        "  <time>\n"
        '    <begin value="0"/>\n'
        '    <end value="10800"/>\n'
        "  </time>\n"
        "  <processing>\n"
        '    <pedestrian.model value="striping"/>\n'
        "  </processing>\n"
        "</configuration>\n",
        encoding="utf-8")
    stats["cfg"] = cfg.name
    return stats


# --------------------------------------------------------------------------------------
# M4 — measure-first probe (plain sumo, NO TraCI, no trajectory recording)
# --------------------------------------------------------------------------------------

# Python-object cost per recorded sim step in the harness recorder (records lon/lat list + timestamp
# + speed floats + xy_tracks tuple) — the basis of the trajectory-strategy decision gate.
RECORDER_BYTES_PER_STEP = 300
SPILL_THRESHOLD_BYTES = 1.5e9


def probe(time_to_teleport: int = 300) -> dict:
    """Run the calibrated baseline HEADLESS (tripinfo + edgeData only) to learn the real scale before
    any trajectory-recording strategy is chosen. Appends measurements + the memory-gate verdict to
    provenance; the edgeData output feeds geh_validation.py directly."""
    cfg = CAL_DIR / "corridor.calibrated.am.sumocfg"
    if not cfg.is_file():
        raise SystemExit("no calibrated cfg — run `demand_calibration.py sample` first")
    LOCAL.mkdir(parents=True, exist_ok=True)
    edgedata_out = LOCAL / "probe.edgedata.xml"
    add_file = LOCAL / "edgedata_def.add.xml"  # embeds an absolute output path -> stays untracked
    add_file.write_text(
        f'<additional>\n  <edgeData id="am" file={quoteattr(str(edgedata_out))} '
        f'begin="0" end="{WINDOW_S}" period="{INTERVAL_S}" excludeEmpty="true"/>\n</additional>\n',
        encoding="utf-8")

    cmd = [run_sim.SUMO_BINARY, "-c", cfg,
           "--tripinfo-output", LOCAL / "probe.tripinfo.xml",
           "--additional-files", add_file,
           "--statistic-output", LOCAL / "probe.stats.xml",
           "--time-to-teleport", str(time_to_teleport),
           "--duration-log.statistics", "--no-step-log", "--seed", "42"]
    wall, stdout, cmdline = _run_tool(cmd, "probe.sumo.log")

    stats_root = None
    stats_path = LOCAL / "probe.stats.xml"
    if stats_path.is_file():
        import xml.etree.ElementTree as ET
        stats_root = ET.parse(stats_path).getroot()

    def _attr(xpath: str, attr: str) -> float | None:
        if stats_root is None:
            return None
        el = stats_root.find(xpath)
        return float(el.get(attr)) if el is not None and el.get(attr) is not None else None

    inserted = _attr("vehicles", "inserted") or 0
    trip_duration = _attr("vehicleTripStatistics", "duration") or 0
    measurements = {
        "wall_clock_s": round(wall, 1),
        "vehicles_loaded": _attr("vehicles", "loaded"),
        "vehicles_inserted": inserted,
        "persons_loaded": _attr("persons", "loaded"),
        "teleports": _attr("teleports", "total"),
        "avg_trip_duration_s": trip_duration,
        "avg_depart_delay_s": _attr("vehicleTripStatistics", "departDelay"),
        "avg_time_loss_s": _attr("vehicleTripStatistics", "timeLoss"),
    }
    est_steps = inserted * trip_duration
    est_bytes = est_steps * RECORDER_BYTES_PER_STEP
    measurements["recorder_estimate"] = {
        "est_recorded_steps": int(est_steps),
        "est_recorder_bytes": int(est_bytes),
        "bytes_per_step_assumed": RECORDER_BYTES_PER_STEP,
        "strategy": "spill" if est_bytes > SPILL_THRESHOLD_BYTES else "in_memory",
    }
    print(json.dumps(measurements, indent=2))
    print(f"[probe] trajectory-strategy gate: est {est_bytes / 1e9:.2f} GB of recorder objects -> "
          f"{measurements['recorder_estimate']['strategy'].upper()} "
          f"(threshold {SPILL_THRESHOLD_BYTES / 1e9:.1f} GB)")
    append_provenance({"measurements": {"baseline_probe": measurements},
                       "tool_cmdlines": [cmdline]})
    return measurements


def append_provenance(updates: dict) -> Path:
    path = newest_provenance()
    blob = json.loads(path.read_text(encoding="utf-8"))
    for k, v in updates.items():
        if isinstance(v, list) and isinstance(blob.get(k), list):
            blob[k].extend(v)
        elif isinstance(v, dict) and isinstance(blob.get(k), dict):
            blob[k].update(v)
        else:
            blob[k] = v
    path.write_text(json.dumps(blob, indent=2, ensure_ascii=False), encoding="utf-8")
    return path


# --------------------------------------------------------------------------------------
# CLI (subcommands grow with M2-M4)
# --------------------------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser(description="V2.1b calibrated AM-peak demand build.")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("verify-convention", help="M1 gate: empirically verify the n_appr compass mapping")
    emit = sub.add_parser("emit-counts", help="M2: turn-count + bike edgeData files + provenance skeleton")
    emit.add_argument("--hourly", action="store_true",
                      help="aggregate the 8x900s bins to two HOURLY intervals (DMRB GEH is hourly; "
                           "easier for routeSampler; departures spread uniformly within the hour)")
    cand = sub.add_parser("candidates", help="M3: randomTrips candidate route pools (cars + bikes)")
    cand.add_argument("--period", type=float, default=0.5, help="car candidate period (lower = denser pool)")
    cand.add_argument("--fringe-factor", type=float, default=10.0)
    cand.add_argument("--intermediate", type=int, default=0, help="via-points per trip (turn variety)")
    cand.add_argument("--routing-factor", type=float, default=1.5)
    sub.add_parser("sample", help="M3: routeSampler passes -> python/scenario/calibrated/")
    pr = sub.add_parser("probe", help="M4: headless calibrated baseline -> scale/wall-clock measurements")
    pr.add_argument("--time-to-teleport", type=int, default=300,
                    help="SUMO teleport threshold (s); higher = fewer teleport-removals under saturation")
    sub.add_parser("full", help="verify -> emit-counts -> candidates -> sample")
    args = ap.parse_args()

    if args.cmd == "probe":  # needs no net read / inventory
        probe(time_to_teleport=args.time_to_teleport)
        return

    net = sumolib.net.readNet(str(run_sim.NET))
    locs = load_supported_locations()
    if args.cmd == "verify-convention":
        verify_convention(net, locs)
    elif args.cmd == "emit-counts":
        verify_convention(net, locs)  # the gate always precedes a build
        emit_counts(net, locs, agg=4 if args.hourly else 1)
    elif args.cmd == "candidates":
        append_provenance({"tool_cmdlines": build_candidates(
            period=args.period, fringe=args.fringe_factor,
            intermediate=args.intermediate, routing_factor=args.routing_factor)})
    elif args.cmd == "sample":
        stats = sample_routes()
        prov = append_provenance({"tool_cmdlines": stats.pop("tool_cmdlines"), "build": stats})
        print(f"[sample] provenance updated -> {prov}")
    elif args.cmd == "full":
        verify_convention(net, locs)
        emit_counts(net, locs)
        append_provenance({"tool_cmdlines": build_candidates()})
        stats = sample_routes()
        prov = append_provenance({"tool_cmdlines": stats.pop("tool_cmdlines"), "build": stats})
        print(f"[full] done -> {prov}")


if __name__ == "__main__":
    main()
