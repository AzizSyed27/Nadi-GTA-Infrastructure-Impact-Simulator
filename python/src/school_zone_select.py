"""V2.2d exemplar support — select the Markham Rd / Lawrence Ave E school-cluster ZONE EDGES.

Fetches Toronto Open Data "School Locations - All Types" (the one datastore-active resource),
filters to the four named cluster schools, binds each school point to its nearest car-permitted
edge on the canonical corridor net (``response_probe.origin_edge`` — 150 m, deterministic,
permission-filtered; a school that binds nothing is DROPPED and documented, never radius-inflated),
dedupes, and writes the tracked selection file ``data/schools/school-zone-exemplar.json`` with full
provenance. The ABORT FLOOR counts unique EDGES, not schools — four schools fronting two shared
streets is a 2-street zone, and the zone-chip / report enumeration / zone lens all key off edges.

Run:  python python/src/school_zone_select.py   (prints the composite member edge list)
"""

from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import requests
import run_sim  # wires SUMO_HOME/tools; exposes NET / ROOT
import sumolib
from response_probe import ORIGIN_MATCH_RADIUS_M, origin_edge

CKAN = "https://ckan0.cf.opendata.inter.prod-toronto.ca"
DATASTORE = CKAN + "/api/3/action/datastore_search"
PACKAGE_ID = "1a714b5c-64c0-4cdf-9739-0086f80fb3ee"  # school-locations-all-types
RESOURCE_ID = "02ef7447-54d9-4aa7-b76d-8ef8138ac546"  # the one datastore-active resource (GeoJSON rows)
DATASET_URL = "https://open.toronto.ca/dataset/school-locations-all-types/"

# The Markham Rd / Lawrence Ave E cluster (recon 2026-07-26). Name-contains, case-insensitive —
# a dataset rename must fail LOUDLY (zero matches printed), never silently select something else.
CLUSTER = ("ST BARBARA", "TECUMSEH", "CORNELL", "GOLF ROAD")

CACHE = Path(os.environ.get("LOCALAPPDATA") or os.environ.get("TMP") or ".") / "nadi-counts"
OUT = run_sim.ROOT / "data" / "schools" / "school-zone-exemplar.json"
MIN_ZONE_EDGES = 2  # the floor is EDGES (deduped), never schools


def fetch_schools(refresh: bool = False) -> tuple[list[dict], str]:
    """Full-paginate the school resource; cache under %LOCALAPPDATA%\\nadi-counts (OneDrive-safe)."""
    cache_file = CACHE / "school_locations.json"
    if cache_file.is_file() and not refresh:
        blob = json.loads(cache_file.read_text(encoding="utf-8"))
        if blob.get("resource_id") == RESOURCE_ID:
            print(f"[fetch] schools: using cache retrieved {blob['retrieved_at']} ({len(blob['records'])} rows)")
            return blob["records"], blob["retrieved_at"]
    records: list[dict] = []
    offset, total = 0, None
    while True:
        last: Exception | None = None
        for attempt in range(3):
            try:
                resp = requests.get(DATASTORE, params={"resource_id": RESOURCE_ID, "limit": 1000,
                                                       "offset": offset}, timeout=30)
                resp.raise_for_status()
                body = resp.json()
                if not body.get("success"):
                    raise RuntimeError("CKAN success=false")
                result = body["result"]
                break
            except Exception as exc:  # noqa: BLE001 — retry transport hiccups, then surface
                last = exc
                time.sleep(1.5 * (attempt + 1))
        else:
            raise RuntimeError(f"datastore_search failed after retries: {last}")
        page = result.get("records", [])
        if total is None:
            total = int(result.get("total", 0))
        records.extend(page)
        offset += len(page)
        if not page or offset >= total:
            break
    retrieved_at = datetime.now(timezone.utc).isoformat()
    CACHE.mkdir(parents=True, exist_ok=True)
    cache_file.write_text(json.dumps({"resource_id": RESOURCE_ID, "retrieved_at": retrieved_at,
                                      "records": records}), encoding="utf-8")
    print(f"[fetch] schools: {len(records)} rows retrieved {retrieved_at}")
    return records, retrieved_at


def select() -> dict:
    records, retrieved_at = fetch_schools()
    net = sumolib.net.readNet(str(run_sim.NET))

    schools, dropped = [], []
    for needle in CLUSTER:
        matches = [r for r in records if needle in (r.get("NAME") or "").upper()]
        if not matches:
            dropped.append({"query": needle, "reason": "no name-contains match in the dataset (renamed?)"})
            print(f"[select] {needle}: NO MATCH in the dataset")
            continue
        for r in matches:
            geom = r.get("geometry")
            geom = json.loads(geom) if isinstance(geom, str) else geom
            lon, lat = geom["coordinates"]
            edge = origin_edge(net, lon, lat)
            if edge is None:
                dropped.append({"name": r.get("NAME"), "lon": lon, "lat": lat,
                                "reason": f"no car-permitted edge within {ORIGIN_MATCH_RADIUS_M:g} m "
                                          f"of the school point (boundary-clipped net)"})
                print(f"[select] {r.get('NAME')}: DROPPED — nothing within {ORIGIN_MATCH_RADIUS_M:g} m")
                continue
            x, y = net.convertLonLat2XY(lon, lat)
            dist = min(d for e, d in net.getNeighboringEdges(x, y, r=ORIGIN_MATCH_RADIUS_M)
                       if e.getID() == edge.getID())
            schools.append({"name": r.get("NAME"), "school_type": r.get("SCHOOL_TYPE_DESC"),
                            "address": r.get("ADDRESS_FULL"), "lon": lon, "lat": lat,
                            "matched_edge": edge.getID(), "dist_m": round(dist, 1)})
            print(f"[select] {r.get('NAME')}: edge {edge.getID()} ({dist:.0f} m)")

    zone_edges = sorted({s["matched_edge"] for s in schools})
    out = {
        "_provenance": {
            "dataset": "School Locations - All Types (Toronto Open Data)",
            "dataset_url": DATASET_URL,
            "package_id": PACKAGE_ID,
            "resource_id": RESOURCE_ID,
            "license": "License not specified (recorded honestly — no OGL-Toronto statement on this package)",
            "last_refreshed": "2026-05-27",
            "retrieved_at": retrieved_at,
            "selection_rule": f"name-contains cluster match; nearest car-permitted edge within "
                              f"{ORIGIN_MATCH_RADIUS_M:g} m (response_probe.origin_edge); edges deduped",
            "note": "school locations are SITING CONTEXT for the exemplar zone only — the run measures "
                    "pedestrian entities from the calibrated demand, not schoolchildren (zone_facts "
                    "population_note carries this wherever the numbers render)",
        },
        "schools": schools,
        "zone_edges": zone_edges,  # THE composite members; N streets == len(zone_edges), never len(schools)
        **({"_dropped": dropped} if dropped else {}),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(f"\n[select] zone edges ({len(zone_edges)}): {zone_edges}")
    print(f"[select] wrote {OUT}")
    if len(zone_edges) < MIN_ZONE_EDGES:
        raise SystemExit(f"only {len(zone_edges)} unique zone edge(s) bound — a {len(zone_edges)}-street "
                         f"'zone' is not the exemplar; not launching (floor: {MIN_ZONE_EDGES} EDGES)")
    return out


if __name__ == "__main__":
    select()
