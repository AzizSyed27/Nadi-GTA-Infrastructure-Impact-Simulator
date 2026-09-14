"""V2.7d — STREET NAMES for the corridor's edges.

Two halves, deliberately separate:

EXPORT-TIME (C1a — the only code that ever opens the OSM extract): SUMO edge ids ARE OSM way ids
(`<way>`, `<way>#<k>`, `-<way>…`, `<way>-Added(On|Off)RampEdge`), so the way's `name=` tag is the edge's
street name — the same data netconvert's `--output.street-names` copies. V2.7d C0's dry run showed the
netconvert recipe does NOT reproduce the canonical net (32 normal + 80 internal edges added), so the net
stays a fixed asset WITHOUT `name=` attrs and `network_export` resolves names here instead, from the
tracked `python/scenario/corridor_bbox.osm.xml`, by way id. Probed 2026-09-13: 4,480 of 4,570 edges
resolve, 79 are unnamed in OSM (netconvert would name them nothing either), 11 ramp edges resolve
through their way prefix.

RUNTIME (C2): every other consumer reads names back from `web/public/network.json` (the ONE runtime
source on both sides of the Python<->TS boundary) — `name_of` / `describe_edge` / `report_edge_ref`, all
id-only when the name is missing and never raising when the file is absent.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from pathlib import Path

_RAMP_SUFFIX = re.compile(r"-Added(?:On|Off)RampEdge$")


def way_id_of(edge_id: str) -> str:
    """The OSM way id behind a SUMO edge id: strip the direction `-`, the ramp suffix, and `#<segment>`.
    Ids that are not way-shaped (minted `nr_A_B`, fixture `E1`) come back unchanged and simply miss."""
    s = _RAMP_SUFFIX.sub("", edge_id)
    if s.startswith("-"):
        s = s[1:]
    return s.split("#", 1)[0]


def osm_way_names(osm_path: Path) -> dict[str, str]:
    """{way id: name} for every named `<way>` in an OSM XML extract (streaming parse; ~10 s on 44 MB)."""
    names: dict[str, str] = {}
    for _event, el in ET.iterparse(str(osm_path), events=("end",)):
        if el.tag == "way":
            for tag in el.iter("tag"):
                if tag.get("k") == "name":
                    v = (tag.get("v") or "").strip()
                    if v:
                        names[el.get("id", "")] = v
                    break
            el.clear()
    return names


def resolve_name(edge_id: str, way_names: dict[str, str]) -> str | None:
    """The street name for an edge, or None when its way is unnamed or not a way at all."""
    return way_names.get(way_id_of(edge_id))
