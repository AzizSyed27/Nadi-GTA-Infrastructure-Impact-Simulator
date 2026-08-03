"""V2.3d — the graph split-view's layout exporter (positions only; the frontend renders).

READ-ONLY BY DESIGN — the report.py class of tool: reads the run ARTIFACT and the LightRAG index's
graphml, writes ONLY the sidecars (``contract/runs/graphs-<ts>.json`` + ``web/public/
<run_id>-graphs.json``). It never touches the artifact, which is why it carries NO pinned-run guard
(test-pinned: artifact bytes identical before/after an export) — backfilling the pinned anchor's
sidecar is legitimate and safe.

TWO GRAPHS, TWO JOBS (the project's oldest locked decision, finally visible):
- the OASIS half = "who influences whom in the simulated discourse" — nodes are the run's voices,
  edges are the seeded follow graph, influence connectors come from opinion trajectories and are
  DELIBERATELY separate from follow edges (in real runs ambient recsys surfacing dominates —
  the exposure_note says so wherever the graph renders);
- the entity half = "what the report's chat agent knows" — the GraphRAG entity/relation graph from
  the SERVED index, per-component spring layouts SHELF-PACKED side by side (the graph is many
  disconnected clusters; force-laying them together would invent false adjacency).

HONESTY RAILS: excluded cascade posts contribute per-agent METADATA ONLY ({count, rules}) — their
content never touches this file's output (the discourse.spec ban applies here too). Entity nodes
carry NO descriptions. The entity half's staleness is made LEGIBLE: index_built_at (graphml mtime)
plus a stale_note when the index predates the artifact's last write — and a third honest branch
when the mtime is unknowable (a clobbered mtime silently rendering as "fresh" would be the
labeled-absence rule inverted). No influence winners anywhere: no degree fields, no rankings.
"""

from __future__ import annotations

import argparse
import json
import math
import time
from datetime import datetime, timezone
from pathlib import Path

import trajectory_io
from trajectory_io import RUNS_DIR

WEB_PUBLIC = trajectory_io._REPO_ROOT / "web" / "public"

LAYOUT_SEED = 42
ROUND = 4  # position decimals — size + pin stability
SCALE = 60.0  # world units per sqrt(node) for component scaling
PAD = 80.0  # shelf padding + isolate grid cell
MTIME_FUTURE_SLACK_S = 3600.0  # an mtime more than an hour in the future is nonsensical

EXPOSURE_NOTE = (
    "influence connectors are drawn from opinion trajectories, separately from follow edges — in "
    "this mechanism most influence travels by ambient surfacing, not by following"
)
ENTITY_NOTE_TEMPLATE = (
    "extracted from the chat index served for this run (index-{ts}) — reflects that index's corpus "
    "when it was built"
)
PACKING_NOTE = "disconnected clusters are packed side by side, not force-laid into false adjacency"
STALE_NOTE = ("this index was built before this run's latest enrich — rebuild the chat index "
              "(report enrich) to refresh it")
UNKNOWABLE_NOTE = ("the index's build time could not be determined — it may or may not reflect "
                   "this run's latest enrich")


def _r(v: float) -> float:
    return round(float(v), ROUND)


# ===================================================================================================
# OASIS half — nodes from build_nodes, edges from the wire, influence from trajectories
# ===================================================================================================


def export_oasis(artifact) -> dict | None:
    """None when the run has no social block (the panel renders its honest empty state)."""
    social = getattr(artifact, "social", None)
    if social is None:
        return None
    import networkx as nx
    from propagation import build_nodes  # SUMO-free (build_graph is NOT — never import it here)

    nodes = build_nodes(artifact)
    node_id_set = {n["agent_id"] for n in nodes}
    # emit ONLY edges both of whose endpoints are laid-out nodes — the layout, the wire list, and
    # the coverage numbers must describe the same graph (review-caught: an unfiltered list would
    # let a phantom edge inflate `connected` while the frontend silently drops it from render)
    edges = [{"from": e.from_, "to": e.to, "kind": e.kind}
             for e in (social.graph.edges if social.graph else [])
             if e.from_ in node_id_set and e.to in node_id_set]

    g = nx.Graph()
    for n in nodes:
        g.add_node(n["agent_id"])
    for e in edges:
        g.add_edge(e["from"], e["to"])
    pos = nx.spring_layout(g, seed=LAYOUT_SEED)  # zero-edge nodes STAY in the layout (dimmed later)

    connected = {v for e in edges for v in (e["from"], e["to"])}

    # per-agent exclusion METADATA only — content is never read into any output of this module
    excluded: dict[str, dict] = {}
    for cascade in social.cascades or []:
        for step in cascade.steps:
            for ev in step.events:
                if ev.audit_status == "excluded":
                    slot = excluded.setdefault(ev.agent, {"count": 0, "rules": []})
                    slot["count"] += 1
                    for r in ev.excluded_by or []:
                        if r not in slot["rules"]:
                            slot["rules"].append(r)

    influence = []
    node_ids = set(g.nodes)
    for t in social.trajectories or []:
        for src in t.influenced_by or []:
            if src in node_ids and t.agent in node_ids:
                influence.append({"cascade_id": t.cascade_id, "from": src, "to": t.agent,
                                  "shifted": bool(t.shifted)})

    out_nodes = []
    for n in nodes:
        aid = n["agent_id"]
        x, y = pos[aid]
        row = {"id": aid, "x": _r(x), "y": _r(y), "label": n["label"], "group": n["group"],
               "grounding": n["grounding"], "connected": aid in connected}
        if aid in excluded:
            row["excluded"] = excluded[aid]
        out_nodes.append(row)

    return {
        "framing": "Who influences whom in the simulated discourse — one simulated preview, not a prediction",
        "seed": LAYOUT_SEED,
        "layout": f"networkx spring_layout(seed={LAYOUT_SEED})",
        "nodes": out_nodes,
        "edges": edges,
        "influence": influence,
        # mandate_excluded rides the numbers so the frontend can attribute the agents-vs-nodes gap
        # honestly: institutional voices never enter cascades (V2.3c) — a gap they cause must not
        # be captioned as sibling-dedup (review-caught misattribution)
        "coverage": {"agents": len(artifact.agents), "nodes": len(out_nodes),
                     "with_edges": len(connected),
                     "mandate_excluded": sum(1 for a in artifact.agents if a.grounding == "mandate")},
        "exposure_note": EXPOSURE_NOTE,
    }


# ===================================================================================================
# Entity half — per-component spring layouts, shelf-packed; staleness made legible
# ===================================================================================================


def _split_sources(file_path_value: str) -> list[str]:
    """graphml file_path is <SEP>-multi-valued and may embed a truncate marker — keep only tokens
    that look like corpus handles (kind__…), dedupe preserving order."""
    out: list[str] = []
    for tok in (file_path_value or "").split("<SEP>"):
        tok = tok.strip()
        if "__" in tok and " " not in tok and tok not in out:
            out.append(tok)
    return out


def _index_built_at(graphml: Path) -> tuple[str | None, bool]:
    """(iso timestamp | None, unknowable). Mtimes are fragile — a clobbered one must never render
    as 'fresh': missing/unstattable/nonsensical (future) mtimes are the UNKNOWABLE branch."""
    try:
        mtime = graphml.stat().st_mtime
    except OSError:
        return None, True
    if mtime <= 0 or mtime > time.time() + MTIME_FUTURE_SLACK_S:
        return None, True
    return datetime.fromtimestamp(mtime, tz=timezone.utc).isoformat(timespec="seconds"), False


def export_entity(ts: str, artifact_path: Path) -> dict | None:
    """None when no index exists for the run (the panel renders its honest empty state)."""
    import networkx as nx
    import report_agent

    graphml = report_agent.index_dir(ts) / "graph_chunk_entity_relation.graphml"
    if not graphml.is_file():
        return None
    g = nx.read_graphml(graphml)

    comps = sorted(nx.connected_components(g), key=lambda c: (-len(c), min(c)))
    isolates = [c for c in comps if len(c) == 1]
    real = [c for c in comps if len(c) > 1]

    placed: dict[str, tuple[float, float]] = {}
    boxes: list[tuple[float, float]] = []  # (w, h) per real component, in `real` order
    comp_pos: list[dict[str, tuple[float, float]]] = []
    for comp in real:
        members = sorted(comp)
        if len(comp) == 2:
            pos = {members[0]: (-0.5, 0.0), members[1]: (0.5, 0.0)}
        else:
            pos = nx.spring_layout(g.subgraph(members), seed=LAYOUT_SEED)
        scale = SCALE * math.sqrt(len(comp))
        xs = [p[0] for p in pos.values()]
        ys = [p[1] for p in pos.values()]
        w = max(1.0, (max(xs) - min(xs)) * scale)
        h = max(1.0, (max(ys) - min(ys)) * scale)
        norm = {v: ((p[0] - min(xs)) * scale, (p[1] - min(ys)) * scale) for v, p in pos.items()}
        comp_pos.append(norm)
        boxes.append((w, h))

    # shelf pack, size-desc (comps already sorted); y grows DOWN (OrthographicView flipY)
    total_area = sum(w * h for w, h in boxes) or 1.0
    W = max((boxes[0][0] if boxes else 1.0), 1.6 * math.sqrt(total_area))
    x = y = shelf_h = 0.0
    for norm, (w, h) in zip(comp_pos, boxes):
        if x > 0 and x + w > W:
            y += shelf_h + PAD
            x = shelf_h = 0.0
        for v, (px, py) in norm.items():
            placed[v] = (x + px, y + py)
        x += w + PAD
        shelf_h = max(shelf_h, h)

    if isolates:
        y += shelf_h + PAD
        ids = sorted(v for c in isolates for v in c)
        cols = max(1, math.ceil(math.sqrt(len(ids))))
        for i, v in enumerate(ids):
            placed[v] = ((i % cols) * PAD, y + (i // cols) * PAD)

    built_at, unknowable = _index_built_at(graphml)
    stale_note = None
    if unknowable:
        stale_note = UNKNOWABLE_NOTE
    else:
        try:
            if graphml.stat().st_mtime < artifact_path.stat().st_mtime:
                stale_note = STALE_NOTE
        except OSError:
            built_at, stale_note = None, UNKNOWABLE_NOTE

    nodes = []
    for v in sorted(g.nodes):
        d = g.nodes[v]
        sources = [_friendly(s) for s in _split_sources(d.get("file_path", ""))]
        px, py = placed[v]
        nodes.append({"id": v, "x": _r(px), "y": _r(py),
                      "type": d.get("entity_type", "unknown"),
                      "sources": sources[:3], "source_count": len(sources)})
    edges = [{"from": u, "to": v, "weight": _r(float(g.edges[u, v].get("weight", 1.0)))}
             for u, v in sorted(g.edges)]

    half = {
        "framing": "What the report's chat agent knows — entities and relations extracted from this run's corpus",
        "index_ts": ts,
        "index_built_at": built_at,
        "note": ENTITY_NOTE_TEMPLATE.format(ts=ts),
        "packing_note": PACKING_NOTE,
        "nodes": nodes,
        "edges": edges,
        "components": len(comps),
        "isolates": len(isolates),
    }
    if stale_note:
        half["stale_note"] = stale_note
    return half


def _friendly(handle: str) -> str:
    import report_agent

    return report_agent.friendly_source(handle)


# ===================================================================================================
# Assembly + merge + CLI
# ===================================================================================================


def sidecar_paths(run_id: str) -> tuple[Path, Path]:
    ts = run_id.replace("multimodal-scenario-", "")
    # NB the contract/runs name is `graphs-<ts>.json` — NEVER multimodal-scenario-* (three
    # artifact-discovery globs would pick a sidecar up as an artifact)
    return RUNS_DIR / f"graphs-{ts}.json", WEB_PUBLIC / f"{run_id}-graphs.json"


def export_for_run(run_id: str, halves: tuple[str, ...] = ("oasis", "entity")) -> dict:
    """Export whichever requested halves have inputs, MERGING with any existing sidecar (a
    discourse-time export refreshes oasis, a report-time export refreshes entity — each preserves
    the other half). Returns the written payload."""
    ts = run_id.replace("multimodal-scenario-", "")
    artifact_path = RUNS_DIR / f"{run_id}.json"
    if not artifact_path.is_file():
        # the web copy is the fixture-side fallback (contract/runs is gitignored on fresh clones)
        artifact_path = WEB_PUBLIC / f"{run_id}.json"
    if not artifact_path.is_file():
        raise SystemExit(f"no artifact for run {run_id!r}")

    runs_path, web_path = sidecar_paths(run_id)
    payload: dict = {"run_id": run_id, "oasis": None, "entity": None}
    if runs_path.is_file():
        try:
            prior = json.loads(runs_path.read_text(encoding="utf-8"))
            if prior.get("run_id") == run_id:
                payload["oasis"] = prior.get("oasis")
                payload["entity"] = prior.get("entity")
        except Exception:  # noqa: BLE001 — a corrupt prior sidecar must not block a fresh export
            pass

    if "oasis" in halves:
        artifact = trajectory_io.load_artifact(artifact_path)
        payload["oasis"] = export_oasis(artifact)
    if "entity" in halves:
        payload["entity"] = export_entity(ts, artifact_path)

    # IDEMPOTENT write (review-caught churn): routine index maintenance (e.g. a pinned-run
    # report_agent rebuild) re-exports identical content — preserve the prior generated_at so the
    # bytes stay identical and the committed pinned sidecar never dirties the tree over a no-op.
    payload["generated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    if web_path.is_file():
        try:
            prev = json.loads(web_path.read_text(encoding="utf-8"))
            if {k: v for k, v in prev.items() if k != "generated_at"} == \
               {k: v for k, v in payload.items() if k != "generated_at"} and prev.get("generated_at"):
                payload["generated_at"] = prev["generated_at"]
        except Exception:  # noqa: BLE001 — a corrupt web copy just loses the no-op optimization
            pass
    text = json.dumps(payload, ensure_ascii=False, indent=1)
    runs_path.write_text(text, encoding="utf-8")
    web_path.write_text(text, encoding="utf-8")
    o, e = payload["oasis"], payload["entity"]
    print(f"[graphs] {run_id}: oasis={'%d nodes' % len(o['nodes']) if o else 'absent'} "
          f"entity={'%d nodes' % len(e['nodes']) if e else 'absent'} -> {web_path.name}")
    return payload


def main() -> None:
    ap = argparse.ArgumentParser(description="Export the split-view graph layouts (read-only backfill CLI)")
    # --run-id is REQUIRED — no default-from-latest.json (that resolution is the documented footgun)
    ap.add_argument("--run-id", required=True, help="multimodal-scenario-<ts>")
    ap.add_argument("--half", choices=["oasis", "entity", "both"], default="both")
    args = ap.parse_args()
    halves = ("oasis", "entity") if args.half == "both" else (args.half,)
    export_for_run(args.run_id, halves)


if __name__ == "__main__":
    main()
