"""V2.3d — the committed pinned graphs sidecar (web/public/<pinned>-graphs.json), the seeds-fixture
convention: the OASIS half is REPRODUCIBLE from the committed pinned artifact (layout over the wire
edges, seed 42 — SUMO-free by construction) and pinned against drift; the entity half derives from
a LightRAG index OUTSIDE the repo, so it is a frozen snapshot — presence + sanity only, never
producer equality. Belt-and-braces: no excluded cascade content ever appears in the sidecar text.

Regenerate (read-only): python python/src/graph_export.py --run-id multimodal-scenario-20260702T044134Z
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "python" / "src"))

import graph_export  # noqa: E402
import trajectory_io  # noqa: E402

PINNED = "multimodal-scenario-20260702T044134Z"
# the WEB copies are the committed ones — contract/runs is gitignored (fresh clones have no copy)
SIDECAR = REPO / "web" / "public" / f"{PINNED}-graphs.json"
ARTIFACT = REPO / "web" / "public" / f"{PINNED}.json"


@pytest.fixture(scope="module")
def sidecar() -> dict:
    assert SIDECAR.is_file(), (
        f"committed pinned graphs sidecar missing: {SIDECAR} — regenerate: "
        f"python python/src/graph_export.py --run-id {PINNED} (check the .gitignore negation!)")
    return json.loads(SIDECAR.read_text(encoding="utf-8"))


def test_oasis_half_equals_recompute_from_the_committed_artifact(sidecar) -> None:
    """The anti-hand-edit / anti-silent-drift pin: layout(committed wire edges, seed 42) must equal
    the committed OASIS subtree exactly (positions included — the layout is deterministic)."""
    art = trajectory_io.load_artifact(ARTIFACT)
    expected = graph_export.export_oasis(art)
    assert sidecar["oasis"] == expected, (
        "the committed sidecar's OASIS half drifted from the committed artifact — regenerate, "
        "never hand-edit")


def test_entity_half_present_and_sane_no_producer_equality(sidecar) -> None:
    e = sidecar["entity"]
    assert e is not None, "the pinned sidecar must carry the entity half (frozen snapshot)"
    assert len(e["nodes"]) > 100 and len(e["edges"]) > 100  # sanity, NEVER exact counts (stale index)
    assert e["components"] >= 1 and e["isolates"] >= 0
    assert e["index_ts"] == PINNED.replace("multimodal-scenario-", "")
    assert "packing_note" in e and "note" in e
    # every node has positions + type + bounded sources
    for n in e["nodes"][:50]:
        assert isinstance(n["x"], (int, float)) and isinstance(n["y"], (int, float))
        assert len(n["sources"]) <= 3


def test_no_excluded_content_in_the_committed_sidecar(sidecar) -> None:
    """Belt-and-braces over the leak rule: every excluded cascade event's content string from the
    pinned artifact is absent from the ENTIRE committed sidecar text (both halves — entity names
    included)."""
    art = json.loads(ARTIFACT.read_text(encoding="utf-8"))
    text = SIDECAR.read_text(encoding="utf-8")
    checked = 0
    for cascade in (art.get("social") or {}).get("cascades", []):
        for step in cascade["steps"]:
            for ev in step["events"]:
                if ev.get("audit_status") == "excluded" and ev.get("content"):
                    snippet = ev["content"][:60]
                    if len(snippet) > 20:  # too-short snippets would false-positive on common words
                        assert snippet not in text, "excluded post content leaked into the sidecar"
                        checked += 1
    assert checked > 10, "the pinned artifact should carry dozens of excluded events to sweep"


if __name__ == "__main__":
    graph_export.export_for_run(PINNED)
    print(f"regenerated {SIDECAR}")
