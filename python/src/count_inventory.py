"""V2.1 Step a — CORRIDOR COUNT INVENTORY (exploratory; no demand/pipeline changes).

Pulls Toronto Open Data traffic counts, filters to the canonical corridor bbox, matches each counted
location onto the SUMO net (TMC intersections -> junctions, midblock counts -> edges), and writes an
HONEST coverage report: how many counted locations exist in-corridor, their recency, modes, time
windows — and, explicitly, which counts' raw 15-min bins actually cover the 07:00-09:00 AM peak (the
calibration V2.1b would need). This step only puts the data on the table; the V2.1b gate decision is
read from the report, not made here.

Datasets (CKAN datastore API; license: Open Government Licence – Toronto):
  - traffic-volumes-at-intersections-for-all-modes            (TMC: multimodal intersection counts)
  - traffic-volumes-midblock-vehicle-speed-volume-and-classification-counts  (SVC: midblock counts)
Raw SVC files (100-350 MB, not datastore-active) are NEVER downloaded here. The TMC 15-min bins ARE
datastore-active, so AM-peak coverage is probed per matched count_id — cheap queries, no bulk pull.

Outputs:
  data/counts/counts-inventory-<ts>.{json,md}   tracked evidence + the human coverage report
  web/public/counts-coverage.json               map-ready matched/unmatched locations (later UI layer)
Cache: %LOCALAPPDATA%/nadi-counts/ (OneDrive-safe; reruns are offline-friendly, use --refresh to bust).

    python python/src/count_inventory.py --peek     # print live field names + one sample row, no writes
    python python/src/count_inventory.py            # full inventory
"""

from __future__ import annotations

import argparse
import json
import math
import os
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

import run_sim  # wires SUMO_HOME/tools so sumolib imports; exposes NET / ROOT
import sumolib

CKAN = "https://ckan0.cf.opendata.inter.prod-toronto.ca"
DATASTORE = CKAN + "/api/3/action/datastore_search"

TMC_PACKAGE = "traffic-volumes-at-intersections-for-all-modes"
SVC_PACKAGE = "traffic-volumes-midblock-vehicle-speed-volume-and-classification-counts"
DATASET_URLS = {
    "TMC": f"https://open.toronto.ca/dataset/{TMC_PACKAGE}/",
    "SVC": f"https://open.toronto.ca/dataset/{SVC_PACKAGE}/",
}
# Datastore-active resource ids (verified live 2026-07-13 via package_show; see the V2.1a plan).
RESOURCES = {
    "tmc_recent": "6afa3b1f-f6a5-4235-8bd6-7568411c19f4",   # tmc_most_recent_summary_data (~6.4k rows)
    "tmc_summary": "1364bffa-29a3-4c39-af8a-925d8ca7bf1f",  # tmc_summary_data (all historical counts)
    "tmc_raw_2020s": "262469c2-abfe-4756-9068-4ea5c7ba1af7",  # tmc_raw_data_2020_2029 (15-min bins)
    "svc_recent": "e90038e7-ccb9-4bd2-af3e-696adc904c18",   # svc_most_recent_summary_data (~14.4k rows)
    "svc_summary": "b72cca3a-8190-47f7-8761-98f0b49bafc7",  # svc_summary_data
}
ATTRIBUTION = "Contains information licensed under the Open Government Licence – Toronto."

# OneDrive breaks atomic writes in the repo tree — bulky cache lives under LOCALAPPDATA (oasis_spike pattern).
CACHE = Path(os.environ.get("LOCALAPPDATA") or os.environ.get("TMP") or ".") / "nadi-counts"
DATA_DIR = run_sim.ROOT / "data" / "counts"
WEB_PUBLIC = run_sim.ROOT / "web" / "public"

# Matching thresholds (CLI-tunable; the report prints the values used). Counts are geocoded to the city
# CENTRELINE while the net is OSM-derived, and the corridor net was built with junctions.join — consolidated
# junction centers can sit tens of meters from the centreline point, so a fat 20-40m lobe in the junction
# distance histogram is the consolidation signature, not bad data.
JUNCTION_MATCH_M = 30.0
EDGE_MATCH_M = 45.0
REPORT_RADIUS_M = 150.0  # unmatched locations still get a best-effort nearest distance up to this

HISTORY_SANITY_CAP = 300_000  # abort a history fetch that reports more rows than this (something is off)
AM_START_MIN, AM_END_MIN = 7 * 60, 9 * 60  # the 07:00-09:00 AM-peak window, minutes since midnight


# --------------------------------------------------------------------------------------
# fetch + cache
# --------------------------------------------------------------------------------------

def _http_get(params: dict) -> dict:
    """One datastore_search GET with retries; returns the CKAN ``result`` dict."""
    last: Exception | None = None
    for attempt in range(3):
        try:
            resp = requests.get(DATASTORE, params=params, timeout=30)
            resp.raise_for_status()
            body = resp.json()
            if not body.get("success"):
                raise RuntimeError(f"CKAN success=false for {params.get('resource_id')}")
            return body["result"]
        except Exception as exc:  # noqa: BLE001 — retry any transport/API hiccup, then surface it
            last = exc
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"datastore_search failed after retries: {last}") from last


def fetch_resource(tag: str, *, refresh: bool = False, page_size: int = 1000,
                   sanity_cap: int | None = None) -> tuple[list[dict], str]:
    """Full-paginate one datastore resource; cache under CACHE/<tag>.json. Returns (records, retrieved_at)."""
    resource_id = RESOURCES[tag]
    cache_file = CACHE / f"{tag}.json"
    if cache_file.is_file() and not refresh:
        blob = json.loads(cache_file.read_text(encoding="utf-8"))
        if blob.get("resource_id") == resource_id:
            print(f"[fetch] {tag}: using cache retrieved {blob['retrieved_at']} ({len(blob['records'])} rows)")
            return blob["records"], blob["retrieved_at"]

    records: list[dict] = []
    offset = 0
    total: int | None = None
    while True:
        result = _http_get({"resource_id": resource_id, "limit": page_size, "offset": offset})
        page = result.get("records", [])
        if total is None:
            total = int(result.get("total", 0))
            if sanity_cap is not None and total > sanity_cap:
                raise RuntimeError(f"{tag}: total={total} exceeds sanity cap {sanity_cap} — refusing bulk fetch")
        records.extend(page)
        offset += len(page)
        if offset >= total or len(page) < page_size:  # short page = belt and braces vs an off total
            break
    retrieved_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    CACHE.mkdir(parents=True, exist_ok=True)
    cache_file.write_text(
        json.dumps({"resource_id": resource_id, "retrieved_at": retrieved_at,
                    "total": total, "records": records}),
        encoding="utf-8")
    print(f"[fetch] {tag}: fetched {len(records)}/{total} rows -> {cache_file}")
    return records, retrieved_at


def peek() -> None:
    """Print field names + one sample record per resource (first page only). No writes; locks spellings."""
    for tag, resource_id in RESOURCES.items():
        result = _http_get({"resource_id": resource_id, "limit": 1})
        fields = [f["id"] for f in result.get("fields", [])]
        sample = result.get("records", [{}])
        print(f"\n=== {tag} ({resource_id})  total={result.get('total')} ===")
        print("fields:", ", ".join(fields))
        if sample:
            print("sample:", json.dumps(sample[0], indent=2, default=str)[:2000])


# --------------------------------------------------------------------------------------
# pure helpers (no net, no HTTP — unit-tested)
# --------------------------------------------------------------------------------------

def in_bbox(lon: float | None, lat: float | None, bbox: list[float]) -> bool:
    """True if (lon, lat) is inside [minLon, minLat, maxLon, maxLat]. None/0.0 coords are null-ish -> False."""
    if not lon or not lat:  # 0.0 is off-Toronto; treat exactly like missing
        return False
    return bbox[0] <= lon <= bbox[2] and bbox[1] <= lat <= bbox[3]


def recency_class(date_str: str | None) -> str:
    """'recent' (>=2020) / 'aging' (2015-2019) / 'stale' (<2015) / 'unknown' (missing or unparseable)."""
    if not date_str:
        return "unknown"
    try:
        year = int(str(date_str)[:4])
    except ValueError:
        return "unknown"
    if year < 1900 or year > 2100:
        return "unknown"
    if year >= 2020:
        return "recent"
    if year >= 2015:
        return "aging"
    return "stale"


def dedupe(rows: list[dict], key_fn, date_fn) -> list[dict]:
    """Group rows by key_fn; keep the row with the max date_fn; carry n_duplicates on the survivor."""
    best: dict = {}
    counts: dict = {}
    for row in rows:
        k = key_fn(row)
        counts[k] = counts.get(k, 0) + 1
        if k not in best or (date_fn(row) or "") > (date_fn(best[k]) or ""):
            best[k] = row
    out = []
    for k, row in best.items():
        row = dict(row)
        row["n_duplicates"] = counts[k] - 1
        out.append(row)
    return out


def _parse_hhmm_minutes(value: str | None) -> int | None:
    """Minutes since midnight from a time-ish string ('07:15', '2024-06-11T07:15:00', '7:15:00')."""
    if not value:
        return None
    s = str(value)
    if "T" in s:
        s = s.split("T", 1)[1]
    elif " " in s and ":" in s.split(" ")[-1]:
        s = s.split(" ")[-1]
    parts = s.split(":")
    try:
        return int(parts[0]) * 60 + int(parts[1])
    except (ValueError, IndexError):
        return None


def am_peak_verdict(bins: list[dict]) -> dict:
    """The explicit AM-peak answer for one count's raw 15-min bins: does the counted data COVER 07:00-09:00?

    covered = at least ONE SINGLE DATE has every 15-min slot in the window (8 slots) — coverage is never
    assembled across separate count days (a calibration needs one coherent morning). slots_present is the
    best single date's slot count. Returns {covered, dates (covering dates, else any-AM-bin dates),
    bins_in_window, slots_present, slots_expected}.
    """
    per_date: dict[str, set[int]] = {}
    bins_in_window = 0
    for b in bins:
        start = _parse_hhmm_minutes(b.get("start_time"))
        if start is None or not (AM_START_MIN <= start < AM_END_MIN):
            continue
        bins_in_window += 1
        per_date.setdefault(str(b.get("count_date", ""))[:10], set()).add(start)
    n_slots = (AM_END_MIN - AM_START_MIN) // 15
    covered_dates = sorted(d for d, slots in per_date.items() if len(slots) == n_slots)
    return {
        "covered": bool(covered_dates),
        "dates": covered_dates or sorted(per_date),
        "bins_in_window": bins_in_window,
        "slots_present": max((len(s) for s in per_date.values()), default=0),
        "slots_expected": n_slots,
    }


_DIR_BEARINGS = {"NB": 0.0, "EB": 90.0, "SB": 180.0, "WB": 270.0,
                 "NORTH": 0.0, "EAST": 90.0, "SOUTH": 180.0, "WEST": 270.0,
                 "NORTHBOUND": 0.0, "EASTBOUND": 90.0, "SOUTHBOUND": 180.0, "WESTBOUND": 270.0}


def direction_bearing(value: str | None) -> float | None:
    """Compass bearing (deg) for a direction-of-travel field value, or None if absent/unrecognised."""
    if not value:
        return None
    return _DIR_BEARINGS.get(str(value).strip().upper())


def bearing_compatible(edge_bearing: float, target_bearing: float, tol: float = 90.0) -> bool:
    """True if the edge's travel bearing is within +/-tol degrees of the target compass bearing."""
    diff = abs((edge_bearing - target_bearing + 180.0) % 360.0 - 180.0)
    return diff <= tol


# --------------------------------------------------------------------------------------
# matching (net-dependent)
# --------------------------------------------------------------------------------------

def junction_index(net) -> list[tuple[str, float, float]]:
    """(id, x, y) of real intersections: non-internal, with in+out passenger edges (demo_road_select filter)."""
    out = []
    for n in net.getNodes():
        if n.getType() == "internal":
            continue
        if not any(e.allows("passenger") for e in n.getOutgoing()):
            continue
        if not any(e.allows("passenger") for e in n.getIncoming()):
            continue
        x, y = n.getCoord()
        out.append((n.getID(), x, y))
    return out


def stub_index(net) -> list[tuple[str, float, float]]:
    """(id, x, y) of boundary stubs: non-internal nodes MISSING a passenger in or out edge. Where the bbox
    clipped a cross street, the real intersection degrades to dead-end stubs — a TMC point right on top of
    one is 'at the net boundary', which is a different truth than 'no junction nearby'."""
    out = []
    for n in net.getNodes():
        if n.getType() == "internal":
            continue
        has_out = any(e.allows("passenger") for e in n.getOutgoing())
        has_in = any(e.allows("passenger") for e in n.getIncoming())
        if has_out != has_in or n.getType() == "dead_end":
            x, y = n.getCoord()
            out.append((n.getID(), x, y))
    return out


def match_junction(x: float, y: float, index: list[tuple[str, float, float]],
                   threshold: float) -> tuple[str | None, float | None, bool]:
    """Nearest real junction. Returns (junction_id, dist_m, matched); beyond REPORT_RADIUS_M -> (None, None, False)."""
    best_id, best_d = None, math.inf
    for jid, jx, jy in index:
        d = math.hypot(x - jx, y - jy)
        if d < best_d:
            best_id, best_d = jid, d
    if best_id is None or best_d > REPORT_RADIUS_M:
        return None, None, False
    return best_id, round(best_d, 1), best_d <= threshold


def _edge_bearing(edge) -> float:
    """Compass bearing (deg, 0=N) of an edge's overall travel direction, from its first to last shape point."""
    shape = edge.getShape()
    (x0, y0), (x1, y1) = shape[0], shape[-1]
    return math.degrees(math.atan2(x1 - x0, y1 - y0)) % 360.0  # atan2(dx, dy): UTM north-up


def _reverse_edge_id(edge) -> str | None:
    """The reverse-partner edge id via the node-pair test (network_export._is_oneway logic)."""
    from_id = edge.getFromNode().getID()
    for e in edge.getToNode().getOutgoing():
        if e.getToNode().getID() == from_id:
            return e.getID()
    return None


def match_edge(net, x: float, y: float, threshold: float,
               target_bearing: float | None = None) -> dict:
    """Nearest car-permitted edge, with a bearing check when the count carries a direction of travel.

    Prefers the nearest bearing-COMPATIBLE edge (distance alone can silently land on a parallel side
    street or the wrong carriageway of a divided road); sets bearing_flag when nearest and
    nearest-compatible disagree. Returns {edge_id, reverse_edge_id, dist_m, matched, bearing_flag,
    direction_resolution}.
    """
    hits = net.getNeighboringEdges(x, y, r=REPORT_RADIUS_M, includeJunctions=False)
    candidates = sorted(((d, e) for e, d in hits if e.allows("passenger")), key=lambda p: p[0])
    if not candidates:
        return {"edge_id": None, "reverse_edge_id": None, "dist_m": None, "matched": False,
                "bearing_flag": False, "direction_resolution": None}

    nearest_d, nearest_e = candidates[0]
    chosen_d, chosen_e = nearest_d, nearest_e
    bearing_flag = False
    resolution = "pair"  # no direction info -> the volume spans the edge pair; never one directed edge silently
    if target_bearing is not None:
        resolution = "bearing"
        compatible = [(d, e) for d, e in candidates if bearing_compatible(_edge_bearing(e), target_bearing)]
        if compatible:
            chosen_d, chosen_e = compatible[0]
            bearing_flag = chosen_e.getID() != nearest_e.getID()
        else:
            resolution = "no_compatible_bearing"  # keep nearest, but say so

    return {
        "edge_id": chosen_e.getID(),
        "reverse_edge_id": _reverse_edge_id(chosen_e),
        "dist_m": round(chosen_d, 1),
        "matched": chosen_d <= threshold,
        "bearing_flag": bearing_flag,
        "direction_resolution": resolution,
        "edge_lanes": len(chosen_e.getLanes()),
        "edge_speed_mps": round(chosen_e.getSpeed(), 1),
    }


# --------------------------------------------------------------------------------------
# per-dataset row mapping (field names locked via --peek, 2026-07-14)
# --------------------------------------------------------------------------------------

# centreline_type is NUMERIC-CODED on the wire ("1"=midblock segment, "2"=intersection point),
# not the "Intersection"/"Midblock" strings the dataset page describes.
CENTRELINE_TYPES = {"1": "midblock", "2": "intersection"}


def tmc_modes(row: dict) -> list[str]:
    """Modes actually observed (total > 0) in a TMC summary row."""
    modes = []
    if (row.get("total_vehicle") or 0) > 0:
        modes.append("vehicle")
    if (row.get("total_bike") or 0) > 0:
        modes.append("bike")
    if (row.get("total_pedestrian") or 0) > 0:
        modes.append("ped")
    return modes


def svc_kind(row: dict) -> dict:
    """What an SVC count measures. Speed fields are only real for ATR_SPEED_VOLUME rows — never read
    avg_speed off the other types."""
    ctype = row.get("latest_count_type") or row.get("count_type") or ""
    return {"volume": True, "speed": ctype == "ATR_SPEED_VOLUME", "classification": ctype == "VEHICLE_CLASS"}


def _loc_key(row: dict) -> tuple[float, float]:
    """Location identity: coords rounded to ~1 m (the datasets have no cross-resource location id)."""
    return (round(row.get("longitude") or 0.0, 5), round(row.get("latitude") or 0.0, 5))


def history_by_location(rows: list[dict], date_field: str) -> dict[tuple[float, float], dict]:
    """Per-location count-history depth from a full-summary resource: {n_counts, first, last}."""
    out: dict[tuple[float, float], dict] = {}
    for row in rows:
        k = _loc_key(row)
        d = str(row.get(date_field) or "")[:10]
        h = out.setdefault(k, {"n_counts": 0, "first": d, "last": d})
        h["n_counts"] += 1
        if d:
            h["first"] = min(h["first"] or d, d)
            h["last"] = max(h["last"] or d, d)
    return out


def probe_tmc_bins(count_id: int, *, refresh: bool = False) -> dict:
    """Fetch one count's 15-min bins from tmc_raw_data_2020_2029 (datastore filters=, cached per id) and
    return the explicit AM-peak verdict. Only meaningful for post-2020 counts (the resource's decade)."""
    resource_id = RESOURCES["tmc_raw_2020s"]
    cache_file = CACHE / f"tmc-bins-{count_id}.json"
    bins: list[dict] | None = None
    if cache_file.is_file() and not refresh:
        blob = json.loads(cache_file.read_text(encoding="utf-8"))
        if blob.get("resource_id") == resource_id:  # a rotated resource GUID must not serve stale bins
            bins = blob["records"]
    if bins is None:
        bins = []
        offset = 0
        while True:  # paginate — a multi-day count can exceed one page
            result = _http_get({"resource_id": resource_id, "limit": 1000, "offset": offset,
                                "filters": json.dumps({"count_id": count_id})})
            page = result.get("records", [])
            bins.extend(page)
            offset += len(page)
            if not page or offset >= int(result.get("total", 0)):
                break
        CACHE.mkdir(parents=True, exist_ok=True)
        cache_file.write_text(json.dumps({"count_id": count_id, "resource_id": resource_id,
                                          "records": bins}), encoding="utf-8")
    verdict = am_peak_verdict(bins)
    verdict["n_bins"] = len(bins)
    verdict["linkage"] = "count_id"
    return verdict


# --------------------------------------------------------------------------------------
# inventory assembly
# --------------------------------------------------------------------------------------

def _dist_bucket(dist: float | None) -> str:
    if dist is None:
        return f">{REPORT_RADIUS_M:.0f}m/none"
    for hi in (10, 20, 30, 45, REPORT_RADIUS_M):
        if dist < hi:
            return f"<{hi:.0f}m"
    return f">{REPORT_RADIUS_M:.0f}m/none"


def build_inventory(net, bbox: list[float], *, refresh: bool = False, skip_bins: bool = False,
                    with_history: bool = True, junction_threshold: float = JUNCTION_MATCH_M,
                    edge_threshold: float = EDGE_MATCH_M) -> dict:
    """Fetch, filter, match and roll up everything into the single dict all three outputs render from."""
    retrieved: dict[str, str] = {}
    tmc_rows, retrieved["tmc_recent"] = fetch_resource("tmc_recent", refresh=refresh)
    svc_rows, retrieved["svc_recent"] = fetch_resource("svc_recent", refresh=refresh)
    tmc_hist: dict = {}
    svc_hist: dict = {}
    if with_history:
        rows, retrieved["tmc_summary"] = fetch_resource("tmc_summary", refresh=refresh,
                                                        sanity_cap=HISTORY_SANITY_CAP)
        tmc_hist = history_by_location(rows, "count_date")
        rows, retrieved["svc_summary"] = fetch_resource("svc_summary", refresh=refresh,
                                                        sanity_cap=HISTORY_SANITY_CAP)
        svc_hist = history_by_location(rows, "count_date_start")

    null_coords = {"TMC": sum(1 for r in tmc_rows if not r.get("longitude") or not r.get("latitude")),
                   "SVC": sum(1 for r in svc_rows if not r.get("longitude") or not r.get("latitude"))}
    tmc_in = dedupe([r for r in tmc_rows if in_bbox(r.get("longitude"), r.get("latitude"), bbox)],
                    _loc_key, lambda r: r.get("latest_count_date"))
    svc_in = dedupe([r for r in svc_rows if in_bbox(r.get("longitude"), r.get("latitude"), bbox)],
                    _loc_key, lambda r: r.get("latest_count_date_start"))

    jindex = junction_index(net)
    stubs = stub_index(net)
    locations: list[dict] = []

    for row in tmc_in:
        lon, lat = row["longitude"], row["latitude"]
        x, y = net.convertLonLat2XY(lon, lat)
        kind = CENTRELINE_TYPES.get(str(row.get("centreline_type")), "unknown")
        date = str(row.get("latest_count_date") or "")[:10]
        loc = {
            "id": f"tmc_{row.get('latest_count_id')}",
            "source": "TMC",
            "kind": kind if kind != "unknown" else "midblock",  # unknown-coded rows are edge-matched, labeled
            "centreline_type_raw": str(row.get("centreline_type")),
            "name": row.get("location_name"),
            "lon": round(lon, 6), "lat": round(lat, 6),
            "count_id": row.get("latest_count_id"),
            "latest_count_date": date,
            "recency": recency_class(date),
            "modes": tmc_modes(row),
            "time_window": {"count_duration_h": row.get("count_duration"),
                            "am_peak_start": row.get("am_peak_start"),
                            "am_peak_vehicle": row.get("am_peak_vehicle"),
                            "pm_peak_start": row.get("pm_peak_start")},
            "history": tmc_hist.get(_loc_key(row)),
            "n_duplicates": row.get("n_duplicates", 0),
        }
        if kind == "intersection":
            jid, dist, ok = match_junction(x, y, jindex, junction_threshold)
            loc["match"] = {"kind": "junction", "id": jid, "dist_m": dist, "matched": ok}
            if not ok:
                # verified live: unmatched majors (e.g. Markham/Kingston 2025) sit on dead-end stubs where
                # the bbox clipped the cross street — a boundary intersection, not a matcher miss.
                stub_d = min((math.hypot(x - sx, y - sy) for _sid, sx, sy in stubs), default=math.inf)
                loc["match"]["boundary_clipped"] = stub_d <= 25.0
        else:
            m = match_edge(net, x, y, edge_threshold)
            loc["match"] = {"kind": "edge", "id": m["edge_id"], "reverse_edge_id": m["reverse_edge_id"],
                            "dist_m": m["dist_m"], "matched": m["matched"],
                            "direction_resolution": m["direction_resolution"]}
        locations.append(loc)

    for row in svc_in:
        lon, lat = row["longitude"], row["latitude"]
        x, y = net.convertLonLat2XY(lon, lat)
        date = str(row.get("latest_count_date_start") or "")[:10]
        kinds = svc_kind(row)
        # NO direction-of-travel field exists in the SVC summary resources (verified via --peek) and the
        # net carries no street names — so a bidirectional volume attaches to the edge PAIR, never one
        # directed edge, and the wrong-street insurance is the threshold + a capacity plausibility flag.
        m = match_edge(net, x, y, edge_threshold)
        vol = row.get("avg_daily_vol") or 0
        plausibility = (m["matched"] and vol > 8000
                        and m["edge_lanes"] == 1 and (m["edge_speed_mps"] or 99) < 12.0)
        locations.append({
            "id": f"svc_{row.get('latest_count_id')}",
            "source": "SVC",
            "kind": "midblock",
            "name": row.get("location_name"),
            "lon": round(lon, 6), "lat": round(lat, 6),
            "count_id": row.get("latest_count_id"),
            "count_type": row.get("latest_count_type"),
            "measures": kinds,
            "latest_count_date": date,
            "recency": recency_class(date),
            "modes": ["vehicle"],
            "time_window": {"count_duration_h": row.get("latest_count_duration"),
                            "am_peak_start": row.get("avg_wkdy_am_peak_start"),
                            "am_peak_vol": row.get("avg_wkdy_am_peak_vol"),
                            "pm_peak_start": row.get("avg_wkdy_pm_peak_start")},
            "avg_daily_vol": row.get("avg_daily_vol"),
            "avg_85th_percentile_speed": row.get("avg_85th_percentile_speed") if kinds["speed"] else None,
            "history": svc_hist.get(_loc_key(row)),
            "n_duplicates": row.get("n_duplicates", 0),
            "match": {"kind": "edge", "id": m["edge_id"], "reverse_edge_id": m["reverse_edge_id"],
                      "dist_m": m["dist_m"], "matched": m["matched"],
                      "direction_resolution": m["direction_resolution"],
                      "plausibility_flag": bool(plausibility)},
        })

    # AM-peak bin probes: matched TMC only; the raw resource is the 2020s decade, so pre-2020 counts
    # honestly get covered=false with a reason instead of a doomed query.
    if not skip_bins:
        for loc in locations:
            if loc["source"] != "TMC" or not loc["match"]["matched"]:
                continue
            if loc["recency"] != "recent":
                loc["am_bins"] = {"covered": False, "reason": "pre-2020 count — outside the 2020s raw resource",
                                  "dates": [], "n_bins": 0}
                continue
            loc["am_bins"] = probe_tmc_bins(int(loc["count_id"]))

    # co-located TMC/SVC pairs (<25 m) — context only, never merged: they measure different things.
    tmc_xy = [(loc, net.convertLonLat2XY(loc["lon"], loc["lat"])) for loc in locations if loc["source"] == "TMC"]
    svc_xy = [(loc, net.convertLonLat2XY(loc["lon"], loc["lat"])) for loc in locations if loc["source"] == "SVC"]
    co_located = sum(1 for _t, (tx, ty) in tmc_xy
                     if any(math.hypot(tx - sx, ty - sy) < 25.0 for _s, (sx, sy) in svc_xy))

    def _rollup(source: str) -> dict:
        locs = [loc for loc in locations if loc["source"] == source]
        hist: dict[str, int] = {}
        dists: dict[str, int] = {}
        for loc in locs:
            hist[loc["recency"]] = hist.get(loc["recency"], 0) + 1
            b = _dist_bucket(loc["match"]["dist_m"])
            dists[b] = dists.get(b, 0) + 1
        return {"in_bbox": len(locs),
                "matched": sum(1 for loc in locs if loc["match"]["matched"]),
                "recency": hist, "match_dist_histogram": dists}

    tmc_int = [loc for loc in locations if loc["source"] == "TMC" and loc["kind"] == "intersection"]
    am_supported = [loc for loc in tmc_int
                    if loc["match"]["matched"] and loc.get("am_bins", {}).get("covered")]

    return {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "attribution": ATTRIBUTION,
        "sources": {
            "TMC": {"package": TMC_PACKAGE, "url": DATASET_URLS["TMC"],
                    "resources": {k: RESOURCES[k] for k in ("tmc_recent", "tmc_summary", "tmc_raw_2020s")}},
            "SVC": {"package": SVC_PACKAGE, "url": DATASET_URLS["SVC"],
                    "resources": {k: RESOURCES[k] for k in ("svc_recent", "svc_summary")}},
        },
        "retrieved_at": retrieved,
        "bbox": bbox,
        "thresholds": {"junction_m": junction_threshold, "edge_m": edge_threshold,
                       "report_radius_m": REPORT_RADIUS_M},
        "rollup": {"TMC": _rollup("TMC"), "SVC": _rollup("SVC"),
                   "tmc_intersections": len(tmc_int),
                   "tmc_intersections_matched": sum(1 for loc in tmc_int if loc["match"]["matched"]),
                   "am_peak_supported": len(am_supported),
                   "boundary_clipped": sum(1 for loc in locations
                                           if loc["match"].get("boundary_clipped")),
                   "co_located_pairs_lt25m": co_located,
                   "null_coords": null_coords},
        "locations": locations,
    }


# --------------------------------------------------------------------------------------
# outputs
# --------------------------------------------------------------------------------------

def _am_cell(loc: dict) -> str:
    """The 'AM 07:00-09:00 covered?' report cell — the column that separates 'matched' from 'supports
    the calibration we're planning'."""
    bins = loc.get("am_bins")
    if bins is None:
        return "not probed" if loc["match"]["matched"] else "—"
    if bins.get("covered"):
        return "YES (" + ", ".join(bins["dates"]) + ")"
    if bins.get("reason"):
        return f"no — {bins['reason']}"
    if bins.get("slots_present", 0) > 0:
        return f"partial ({bins['slots_present']}/{bins['slots_expected']} slots)"
    return "no — counted hours outside the window"


def _gap_m(a: dict, b: dict) -> float:
    """Equirectangular distance in metres between two location dicts — fine at corridor scale."""
    lat0 = math.radians((a["lat"] + b["lat"]) / 2)
    dx = math.radians(b["lon"] - a["lon"]) * math.cos(lat0) * 6_371_000.0
    dy = math.radians(b["lat"] - a["lat"]) * 6_371_000.0
    return math.hypot(dx, dy)


def render_markdown(inv: dict) -> str:
    """The human coverage report. Honest counts only — it puts the data on the table for the V2.1b gate
    read; it never answers the gate question itself."""
    L = inv["locations"]
    tmc_int = [x for x in L if x["source"] == "TMC" and x["kind"] == "intersection"]
    tmc_mid = [x for x in L if x["source"] == "TMC" and x["kind"] != "intersection"]
    svc = [x for x in L if x["source"] == "SVC"]
    order = {"recent": 0, "aging": 1, "stale": 2, "unknown": 3}

    def sort_key(loc):
        return (not loc["match"]["matched"], order.get(loc["recency"], 3), loc["latest_count_date"] or "")

    out: list[str] = []
    out.append("# Corridor count inventory — V2.1 Step a (exploratory)")
    out.append("")
    out.append(f"_{inv['attribution']}_")
    out.append("")
    out.append(f"- Generated: {inv['generated_at']}  |  bbox (from the canonical net): "
               f"{', '.join(f'{v:.6f}' for v in inv['bbox'])}")
    for src, meta in inv["sources"].items():
        out.append(f"- **{src}**: [{meta['package']}]({meta['url']}) — resources "
                   + ", ".join(f"`{k}`" for k in meta["resources"]))
    out.append("- Retrieved: " + ", ".join(f"{k} @ {v}" for k, v in inv["retrieved_at"].items()))
    thr = inv["thresholds"]
    out.append(f"- Match thresholds: junction {thr['junction_m']:.0f} m, edge {thr['edge_m']:.0f} m "
               f"(distances reported up to {thr['report_radius_m']:.0f} m).")
    out.append("")
    out.append("Counts are geocoded to the city **centreline**; the net is OSM-derived and was built with "
               "`junctions.join`, so consolidated junction centers can sit tens of metres from the "
               "centreline point — a 20–40 m lobe in the junction distance histogram is the consolidation "
               "signature, not bad data. The SVC summary resources carry **no direction-of-travel field** "
               "(verified against the live schema) and the net has no street names, so midblock volumes "
               "attach to the directed edge **pair** (`direction_resolution: pair`) — never silently to one "
               "direction — with a capacity plausibility flag as the wrong-street insurance.")

    def table(rows: list[str], header: str, sep: str) -> None:
        out.append("")
        out.append(header)
        out.append(sep)
        out.extend(rows)

    r = inv["rollup"]
    out.append("")
    out.append(f"## TMC intersections in-corridor ({len(tmc_int)}; matched "
               f"{r['tmc_intersections_matched']}, AM-peak-supported {r['am_peak_supported']})")
    table([f"| {x['name']} | {x['latest_count_date']} | {x['recency']} | {'/'.join(x['modes'])} "
           f"| {x['time_window']['count_duration_h']} | {x['match']['id'] or '—'} "
           f"| {x['match']['dist_m'] if x['match']['dist_m'] is not None else '—'} "
           f"| {'yes' if x['match']['matched'] else 'NO'} | {_am_cell(x)} |"
           for x in sorted(tmc_int, key=sort_key)],
          "| location | latest count | recency | modes | dur (h) | junction | dist (m) | matched | AM 07–09 covered? |",
          "|---|---|---|---|---|---|---|---|---|")

    if tmc_mid:
        out.append("")
        out.append(f"## TMC midblock rows ({len(tmc_mid)}) — multimodal short counts, NOT intersection "
                   "turning movements (kept out of the intersections-covered number)")
        table([f"| {x['name']} | {x['latest_count_date']} | {x['recency']} | {'/'.join(x['modes'])} "
               f"| {x['match']['id'] or '—'} | {x['match']['dist_m'] if x['match']['dist_m'] is not None else '—'} "
               f"| {'yes' if x['match']['matched'] else 'NO'} |"
               for x in sorted(tmc_mid, key=sort_key)],
              "| location | latest count | recency | modes | edge | dist (m) | matched |",
              "|---|---|---|---|---|---|---|")

    out.append("")
    out.append(f"## SVC midblock counts in-corridor ({len(svc)}; matched {r['SVC']['matched']})")
    svc_rows = []
    for x in sorted(svc, key=sort_key):
        flags = []
        if x["match"].get("plausibility_flag"):
            flags.append("CAPACITY?")
        if x["n_duplicates"]:
            flags.append(f"dupes:{x['n_duplicates']}")
        am = x["time_window"]
        am_txt = f"{am['am_peak_start']} ({am['am_peak_vol']})" if am.get("am_peak_vol") is not None else "—"
        svc_rows.append(
            f"| {x['name']} | {x['count_type']} | {x['latest_count_date']} | {x['recency']} "
            f"| {x['avg_daily_vol'] if x['avg_daily_vol'] is not None else '—'} | {am_txt} "
            f"| {x['match']['id'] or '—'} (pair) "
            f"| {x['match']['dist_m'] if x['match']['dist_m'] is not None else '—'} "
            f"| {'yes' if x['match']['matched'] else 'NO'} | {' '.join(flags) or '—'} |")
    table(svc_rows,
          "| location | type | latest count | recency | avg daily vol | wkdy AM peak (vol) | edge | dist (m) | matched | flags |",
          "|---|---|---|---|---|---|---|---|---|---|")

    unmatched = [x for x in L if not x["match"]["matched"]]
    n_clipped = sum(1 for x in unmatched if x["match"].get("boundary_clipped"))
    out.append("")
    out.append(f"## Unmatched in-corridor locations ({len(unmatched)}, of which {n_clipped} at the net boundary)")
    out.append("A location marked *net boundary* sits on a dead-end stub where the bbox clipped the cross "
               "street — the intersection exists in the city, not in this net. Those counts cannot "
               "constrain a junction of this net (though boundary counts could inform corridor INFLOWS "
               "in a later calibration step).")
    if unmatched:
        out.extend(f"- {x['source']} {x['name']} ({x['latest_count_date']}, {x['recency']}) — nearest "
                   f"{x['match']['kind']} {x['match']['id'] or 'none'} at "
                   f"{str(x['match']['dist_m']) + ' m' if x['match']['dist_m'] is not None else '>150 m'}"
                   + (" — **net boundary**" if x["match"].get("boundary_clipped") else "")
                   for x in unmatched)
    else:
        out.append("- none")
    nc = r["null_coords"]
    out.append(f"- Rows with null/zero coordinates (whole dataset, unbboxable): TMC {nc['TMC']}, SVC {nc['SVC']}")

    out.append("")
    out.append("## Histograms")
    bucket_order = [f"<{hi:.0f}m" for hi in (10, 20, 30, 45, REPORT_RADIUS_M)] + [f">{REPORT_RADIUS_M:.0f}m/none"]
    for src in ("TMC", "SVC"):
        out.append(f"- {src} recency: " + ", ".join(f"{k}={v}" for k, v in sorted(r[src]["recency"].items())))
        hist = r[src]["match_dist_histogram"]
        out.append(f"- {src} match distance: "
                   + ", ".join(f"{k}={hist[k]}" for k in bucket_order if k in hist))
    out.append(f"- Co-located TMC/SVC pairs (<25 m): {r['co_located_pairs_lt25m']} "
               "(context only — an intersection TMC and a midblock SVC measure different things)")

    out.append("")
    out.append("## AM-peak calibration coverage — verdict data")
    supported = [x for x in tmc_int if x["match"]["matched"] and x.get("am_bins", {}).get("covered")]
    out.append(f"- TMC intersections in-corridor: **{len(tmc_int)}**; matched to a net junction: "
               f"**{r['tmc_intersections_matched']}** (of the unmatched, "
               f"{r.get('boundary_clipped', 0)} sit at the net's clipped boundary — real intersections "
               "the net does not model; potential inflow references, never junction constraints).")
    out.append(f"- Of the matched, counts whose raw 15-min bins **fully cover 07:00–09:00, post-2020** "
               f"(the set an AM-peak calibration would stand on): **{len(supported)}**.")
    partial: dict[str, int] = {}
    for x in tmc_int:
        b = x.get("am_bins")
        if x["match"]["matched"] and b and not b.get("covered") and not b.get("reason") \
                and b.get("slots_present", 0) > 0:
            k = f"{b['slots_present']}/{b['slots_expected']}"
            partial[k] = partial.get(k, 0) + 1
    if partial:
        out.append("- Additionally, matched post-2020 counts covering the window only PARTIALLY: "
                   + ", ".join(f"**{v}** at {k} slots" for k, v in sorted(partial.items(), reverse=True))
                   + " (the city's standard 8-hour counts start 07:30, so 6/8 = 07:30–09:00 covered — "
                     "usable if the calibrated window narrows, stated as such).")
    for x in sorted(supported, key=lambda s: s["lon"]):
        out.append(f"  - {x['name']} — junction {x['match']['id']}, counted {x['latest_count_date']} "
                   f"(AM bins on {', '.join(x['am_bins']['dates'])})")
    if len(supported) >= 2:
        chain = sorted(supported, key=lambda s: s["lon"])
        gaps = [(a, b, _gap_m(a, b)) for a, b in zip(chain, chain[1:])]
        big = [(a, b, g) for a, b, g in gaps if g > 1500]
        if big:
            out.append("- Spatial gaps > 1.5 km between adjacent supported intersections (west→east). "
                       "CAVEAT: the chain is ordered by longitude across the WHOLE study area, so adjacent "
                       "points may sit on parallel arterials — read this as area spread, not along-route "
                       "spacing (per-arterial spacing is a V2.1b question):")
            out.extend(f"  - {g / 1000:.1f} km between “{a['name']}” and “{b['name']}”" for a, b, g in big)
        else:
            out.append("- No gap > 1.5 km between adjacent supported intersections (west→east).")
    svc_am = [x for x in svc if x["time_window"].get("am_peak_vol") is not None]
    svc_am_hist: dict[str, int] = {}
    for x in svc_am:
        svc_am_hist[x["recency"]] = svc_am_hist.get(x["recency"], 0) + 1
    out.append(f"- SVC midblock locations with a weekday-AM-peak volume: **{len(svc_am)}** "
               f"({', '.join(f'{k}={v}' for k, v in sorted(svc_am_hist.items())) or 'none'}).")
    out.append("")
    out.append("**V2.1b decision input (the gate question, restated — not answered here):** is this "
               "enough counted, recent, AM-peak-covering data to calibrate an AM peak on this corridor — "
               "and if the coverage is thinner than hoped, does the calibrated claim narrow to the "
               "counted arterials?")
    out.append("")
    return "\n".join(out)


def write_outputs(inv: dict, md: str) -> list[Path]:
    """Write the tracked evidence pair (data/counts/) + the map-ready web asset. Returns the paths."""
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    json_path = DATA_DIR / f"counts-inventory-{ts}.json"
    md_path = DATA_DIR / f"counts-inventory-{ts}.md"
    json_path.write_text(json.dumps(inv, indent=2, ensure_ascii=False), encoding="utf-8")
    md_path.write_text(md, encoding="utf-8")

    map_blob = {
        "generated_at": inv["generated_at"],
        "attribution": inv["attribution"],
        "sources": {k: v["url"] for k, v in inv["sources"].items()},
        "locations": [{
            "id": x["id"], "source": x["source"], "kind": x["kind"], "lon": x["lon"], "lat": x["lat"],
            "name": x["name"], "matched": x["match"]["matched"], "match_type": x["match"]["kind"],
            "match_id": x["match"]["id"], "dist_m": x["match"]["dist_m"], "modes": x["modes"],
            "latest_count_date": x["latest_count_date"], "recency": x["recency"],
            # null = never probed (SVC / unmatched / --skip-bins); False = probed and NOT covered
            "am_peak_covered": (bool(x["am_bins"].get("covered")) if x.get("am_bins") else None),
        } for x in inv["locations"]],
    }
    map_path = WEB_PUBLIC / "counts-coverage.json"
    with map_path.open("w", encoding="utf-8") as fh:
        json.dump(map_blob, fh, ensure_ascii=False, separators=(",", ":"))
    return [json_path, md_path, map_path]


def print_summary(inv: dict, paths: list[Path]) -> None:
    r = inv["rollup"]
    print("\n=== corridor count inventory (V2.1a) ===")
    for src in ("TMC", "SVC"):
        s = r[src]
        rec = s["recency"].get("recent", 0)
        print(f"{src}: {s['in_bbox']} in-corridor | {s['matched']} matched | {rec} recent (>=2020)")
    print(f"TMC intersections: {r['tmc_intersections']} ({r['tmc_intersections_matched']} matched) | "
          f"AM-peak-supported (post-2020 bins cover 07:00-09:00): {r['am_peak_supported']}")
    print(f"co-located TMC/SVC pairs <25m: {r['co_located_pairs_lt25m']} | "
          f"null coords: TMC {r['null_coords']['TMC']}, SVC {r['null_coords']['SVC']}")
    for p in paths:
        print(f"wrote {p}")


def main() -> None:
    ap = argparse.ArgumentParser(description="V2.1a corridor count inventory (Toronto Open Data -> coverage report).")
    ap.add_argument("--peek", action="store_true", help="print live field names + a sample row per resource; no writes")
    ap.add_argument("--refresh", action="store_true", help="bust the %LOCALAPPDATA%/nadi-counts cache")
    ap.add_argument("--skip-bins", action="store_true", help="skip the per-count AM-peak bin probes")
    ap.add_argument("--no-history", action="store_true", help="skip the full-history summary fetches")
    ap.add_argument("--junction-threshold", type=float, default=JUNCTION_MATCH_M)
    ap.add_argument("--edge-threshold", type=float, default=EDGE_MATCH_M)
    args = ap.parse_args()

    if args.peek:
        peek()
        return

    net = sumolib.net.readNet(str(run_sim.NET))
    xmin, ymin, xmax, ymax = net.getBoundary()
    lon0, lat0 = net.convertXY2LonLat(xmin, ymin)
    lon1, lat1 = net.convertXY2LonLat(xmax, ymax)
    bbox = [min(lon0, lon1), min(lat0, lat1), max(lon0, lon1), max(lat0, lat1)]

    inv = build_inventory(net, bbox, refresh=args.refresh, skip_bins=args.skip_bins,
                          with_history=not args.no_history,
                          junction_threshold=args.junction_threshold, edge_threshold=args.edge_threshold)
    md = render_markdown(inv)
    paths = write_outputs(inv, md)
    print_summary(inv, paths)


if __name__ == "__main__":
    main()
