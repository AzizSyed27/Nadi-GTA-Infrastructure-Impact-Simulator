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


# ---- RUNTIME half (C2): names read back from the export — the ONE runtime source on both sides ----

NETWORK_JSON = Path(__file__).resolve().parents[2] / "web" / "public" / "network.json"
_NAMES: dict[str, str] | None = None


def reset_name_cache() -> None:
    """Forget the loaded names (tests repoint `NETWORK_JSON`; the server never needs this)."""
    global _NAMES
    _NAMES = None


def _names() -> dict[str, str]:
    """{edge id: name} for every NAMED edge in `network.json`; `{}` when the asset is missing or damaged —
    id-only rendering everywhere, never a raise (the asset is a render artefact, not the contract)."""
    global _NAMES
    if _NAMES is None:
        names: dict[str, str] = {}
        try:
            import json

            data = json.loads(NETWORK_JSON.read_text(encoding="utf-8"))
            for e in data.get("edges", []):
                n = e.get("name")
                if isinstance(n, str) and n:
                    names[e["id"]] = n
        except (OSError, ValueError, TypeError, AttributeError):
            names = {}
        _NAMES = names
    return _NAMES


def name_of(edge_id: str) -> str | None:
    return _names().get(edge_id)


def describe_edge(edge_id: str, tail: str | None = None) -> str:
    """NAME-PLUS-ID, never name-instead-of-id: `Markham Road (edge -1288863201)`; unnamed → `edge -1288863201`
    (byte-identical to the pre-V2.7d wording). A `tail` rides inside the parenthetical:
    `Markham Road (edge X, incident)` / unnamed `edge X (incident)` — the incident description's tag."""
    name = name_of(edge_id)
    if name:
        return f"{name} (edge {edge_id}, {tail})" if tail else f"{name} (edge {edge_id})"
    return f"edge {edge_id} ({tail})" if tail else f"edge {edge_id}"


def closed_all_lanes_desc(edge_id: str) -> str:
    """The road-closure description: `Closed all lanes of Markham Road (edge X)`; unnamed keeps the
    pre-V2.7d `Closed edge X (all lanes)` byte-identical (the pinned wording in fixtures and specs)."""
    return (f"Closed all lanes of {describe_edge(edge_id)}" if name_of(edge_id)
            else f"Closed edge {edge_id} (all lanes)")


def report_edge_ref(edge_id: str) -> str:
    """The report's backticked form: `Markham Road, edge \\`X\\`` / unnamed `edge \\`X\\`` (the golden's form)."""
    name = name_of(edge_id)
    return f"{name}, edge `{edge_id}`" if name else f"edge `{edge_id}`"
