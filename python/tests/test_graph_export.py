"""V2.3d — graph_export: the read-only layout exporter. Load-bearing invariants: determinism,
excluded-content NEVER in the output (metadata only), the read-only byte pin (no pinned guard
because none is needed), component packing disjointness, the three-branch staleness verdict, and
the referendum-guard extension over the sidecar text itself."""

from __future__ import annotations

import fnmatch
import json
import os
import re
import sys
import time
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "python" / "src"))

import graph_export  # noqa: E402
import trajectory_io  # noqa: E402
from contract_models import (  # noqa: E402
    Agent, Assignment, Cascade, CascadeStep, Citation, Mandate, Meta, Outcome, Persona, Reaction,
    Scenario, Social, SocialEdge, SocialEvent, SocialGraph, OpinionTrajectory, TrajectoryArtifact,
    TrajectoryPoint, Vehicle, Change,
)

GRAPHS_BANNED = re.compile(
    r"\b(centrality|most influential|top voices?|influencers?|leaderboard|rank(ed|ing)?)\b", re.I)
SENTINEL = "EXCLUDED_CONTENT_SENTINEL_do_not_leak"


def _reaction(c: str = "fine") -> Reaction:
    return Reaction(comment=c, sentiment=0.0, stance="neutral")


def _artifact() -> TrajectoryArtifact:
    agents = [
        Agent(grounding="sim", vehicle_id="vehA", trigger_t=10.0,
              persona=Persona(id="pa", label="Driver A"), reaction=_reaction("a"),
              outcome=Outcome(baseline_duration=100, scenario_duration=110, delta_seconds=10,
                              baseline_timeloss=5, scenario_timeloss=9)),
        Agent(grounding="sim", vehicle_id="vehB", trigger_t=20.0,
              persona=Persona(id="pb", label="Driver B"), reaction=_reaction("b"),
              outcome=Outcome(baseline_duration=100, scenario_duration=90, delta_seconds=-10,
                              baseline_timeloss=5, scenario_timeloss=3)),
        # sibling inferred voices sharing a persona id — must dedupe to ONE node
        Agent(grounding="inferred", persona=Persona(id="pi", label="Resident"), reaction=_reaction("c")),
        Agent(grounding="inferred", persona=Persona(id="pi", label="Resident"), reaction=_reaction("d")),
        # a zero-edge inferred voice — stays in the layout, connected: false
        Agent(grounding="inferred", persona=Persona(id="pz", label="Zero Edges"), reaction=_reaction("e")),
    ]
    social = Social(
        mechanism="neighbor_pass",
        graph=SocialGraph(edges=[SocialEdge(**{"from": "vehA", "to": "vehB", "kind": "homophily"}),
                                 SocialEdge(**{"from": "pi", "to": "vehA", "kind": "cross"}),
                                 # a phantom endpoint — must be FILTERED from the sidecar, never
                                 # inflate `connected`/`with_edges` while the frontend drops it
                                 SocialEdge(**{"from": "vehA", "to": "ghost-not-a-node", "kind": "geography"})]),
        cascades=[Cascade(cascade_id="c1", steps=[CascadeStep(step=0, events=[
            SocialEvent(agent="vehA", action="post", content="clean words", audit_status="clean"),
            SocialEvent(agent="vehB", action="comment", content=SENTINEL, audit_status="excluded",
                        excluded_by=["crash", "tally"]),
            SocialEvent(agent="vehB", action="post", content=SENTINEL + " again",
                        audit_status="excluded", excluded_by=["crash"]),
        ])])],
        trajectories=[
            OpinionTrajectory(agent="vehB", cascade_id="c1", derived_by="stance_scoring",
                              points=[TrajectoryPoint(step=0, stance="neutral")],
                              shifted=True, influenced_by=["vehA"]),
            OpinionTrajectory(agent="pi", cascade_id="c1", derived_by="stance_scoring",
                              points=[TrajectoryPoint(step=0, stance="neutral")],
                              shifted=False, influenced_by=["vehA", "ghost-not-a-node"]),
        ],
        excluded_count=2,
    )
    meta = Meta(run_id="multimodal-scenario-19990101T000000Z", network="n.xml",
                bbox=[-79.3, 43.7, -79.2, 43.8], sim_start=0.0, sim_end=100.0, step_length=1.0,
                created_at="2026-08-01T00:00:00+00:00", demand_profile="synthetic_demo",
                assignment=Assignment(mode="day_one"),
                scenario=Scenario(baseline_run_id="b",
                                  changes=[Change(type="speed_limit", target_edge="E1",
                                                  value_mps=8.33, description="d")]))
    return TrajectoryArtifact(schema_version="0.9.0", meta=meta,
                              vehicles=[Vehicle(id="vehA", type="car", path=[[-79.25, 43.75], [-79.24, 43.76]],
                                                timestamps=[0.0, 1.0], speeds=[1.0, 1.0]),
                                        Vehicle(id="vehB", type="car", path=[[-79.25, 43.75], [-79.24, 43.76]],
                                                timestamps=[0.0, 1.0], speeds=[1.0, 1.0])],
                              agents=agents, social=social)


@pytest.fixture()
def env(tmp_path: Path, monkeypatch):
    runs = tmp_path / "runs"
    web = tmp_path / "web"
    runs.mkdir(), web.mkdir()
    monkeypatch.setattr(graph_export, "RUNS_DIR", runs)
    monkeypatch.setattr(graph_export, "WEB_PUBLIC", web)
    art = _artifact()
    trajectory_io.dump_artifact(art, runs / f"{art.meta.run_id}.json")
    return {"runs": runs, "web": web, "run_id": art.meta.run_id}


def _graphml(tmp_path: Path, monkeypatch, ts: str, mtime: float | None = None) -> Path:
    import networkx as nx
    import report_agent

    idx_root = tmp_path / "indexes"
    monkeypatch.setattr(report_agent, "INDEX_ROOT", idx_root)
    d = idx_root / f"index-{ts}"
    d.mkdir(parents=True, exist_ok=True)
    g = nx.Graph()
    # giant-ish component + a pair + isolates
    for a, b in (("e1", "e2"), ("e2", "e3"), ("e3", "e1"), ("e3", "e4")):
        g.add_edge(a, b, weight=2.0)
    g.add_edge("p1", "p2", weight=1.0)
    g.add_node("iso1"), g.add_node("iso2")
    for v in g.nodes:
        g.nodes[v]["entity_type"] = "concept"
        g.nodes[v]["file_path"] = ("voice__pa__vehA<SEP>scorecard__car_commuter"
                                   "<SEP>...truncated...(KEEP Old)<SEP>voice__pa__vehA")
    p = d / "graph_chunk_entity_relation.graphml"
    nx.write_graphml(g, p)
    if mtime is not None:
        os.utime(p, (mtime, mtime))
    return p


def test_oasis_half_coverage_and_dedupe(env) -> None:
    payload = graph_export.export_for_run(env["run_id"], halves=("oasis",))
    o = payload["oasis"]
    ids = [n["id"] for n in o["nodes"]]
    assert sorted(ids) == ["pi", "pz", "vehA", "vehB"]  # siblings deduped; both sims; zero-edge kept
    by_id = {n["id"]: n for n in o["nodes"]}
    assert by_id["pz"]["connected"] is False and by_id["vehA"]["connected"] is True
    assert o["coverage"] == {"agents": 5, "nodes": 4, "with_edges": 3, "mandate_excluded": 0}
    assert all(isinstance(n["x"], float) and isinstance(n["y"], float) for n in o["nodes"])
    assert o["exposure_note"] == graph_export.EXPOSURE_NOTE
    # the phantom-endpoint edge was filtered: layout, wire list, and coverage describe ONE graph
    assert len(o["edges"]) == 2
    assert all("ghost-not-a-node" not in (e["from"], e["to"]) for e in o["edges"])


def test_mandate_agents_excluded_and_counted(env) -> None:
    """Institutions never enter the social graph (V2.3c) — the exporter must COUNT them so the
    frontend can attribute the agents-vs-nodes gap honestly (never captioned as sibling-dedup)."""
    art = _artifact()
    art.agents.append(Agent(
        grounding="mandate",
        persona=Persona(id="inst_tfs", label="Toronto Fire Services — mandate lens"),
        reaction=Reaction(comment="Within its mandate, the service notes the computed detour fact.",
                          sentiment=0.0, stance="neutral"),
        mandate=Mandate(institution="Toronto Fire Services", mission="quoted mission text",
                        source="https://example.org/tfs", retrieved="2026-08-01"),
        citations=[Citation(key="response_detour", text="a computed fact line", notes=[])]))
    run_id = "multimodal-scenario-19990102T000000Z"
    art.meta.run_id = run_id
    trajectory_io.dump_artifact(art, env["runs"] / f"{run_id}.json")

    o = graph_export.export_for_run(run_id, halves=("oasis",))["oasis"]
    assert "inst_tfs" not in [n["id"] for n in o["nodes"]]
    assert o["coverage"] == {"agents": 6, "nodes": 4, "with_edges": 3, "mandate_excluded": 1}


def test_idempotent_rewrite_preserves_generated_at(env) -> None:
    """Routine index maintenance re-exports identical content — the bytes must stay identical so
    the committed pinned sidecar never dirties the tree over a no-op (review-caught churn)."""
    graph_export.export_for_run(env["run_id"], halves=("oasis",))
    _, web_path = graph_export.sidecar_paths(env["run_id"])
    before = web_path.read_bytes()
    time.sleep(1.1)  # generated_at has 1 s resolution — prove preservation, not a fast clock
    graph_export.export_for_run(env["run_id"], halves=("oasis",))
    assert web_path.read_bytes() == before


def test_excluded_content_never_leaks_metadata_only(env) -> None:
    graph_export.export_for_run(env["run_id"], halves=("oasis",))
    runs_path, web_path = graph_export.sidecar_paths(env["run_id"])
    for p in (runs_path, web_path):
        text = p.read_text(encoding="utf-8")
        assert SENTINEL not in text, "excluded post content leaked into the sidecar"
    o = json.loads(runs_path.read_text(encoding="utf-8"))["oasis"]
    vb = next(n for n in o["nodes"] if n["id"] == "vehB")
    assert vb["excluded"] == {"count": 2, "rules": ["crash", "tally"]}
    assert "excluded" not in next(n for n in o["nodes"] if n["id"] == "vehA")


def test_influence_pairs_nodes_only(env) -> None:
    o = graph_export.export_for_run(env["run_id"], halves=("oasis",))["oasis"]
    assert {"cascade_id": "c1", "from": "vehA", "to": "vehB", "shifted": True} in o["influence"]
    assert all(p["from"] != "ghost-not-a-node" for p in o["influence"])  # non-node sources dropped


def test_determinism_two_exports_identical(env) -> None:
    a = graph_export.export_for_run(env["run_id"], halves=("oasis",))
    b = graph_export.export_for_run(env["run_id"], halves=("oasis",))
    a.pop("generated_at"), b.pop("generated_at")
    assert a == b


def test_read_only_pin_artifact_bytes_untouched(env) -> None:
    art_path = env["runs"] / f"{env['run_id']}.json"
    before = art_path.read_bytes()
    graph_export.export_for_run(env["run_id"])
    assert art_path.read_bytes() == before, "the exporter must NEVER touch the artifact"


def test_merge_preserves_the_other_half(env, tmp_path, monkeypatch) -> None:
    ts = env["run_id"].replace("multimodal-scenario-", "")
    _graphml(tmp_path, monkeypatch, ts)
    a = graph_export.export_for_run(env["run_id"], halves=("oasis",))
    assert a["oasis"] and a["entity"] is None
    b = graph_export.export_for_run(env["run_id"], halves=("entity",))
    assert b["entity"] and b["oasis"] is not None, "the entity export must PRESERVE the oasis half"
    c = graph_export.export_for_run(env["run_id"], halves=("oasis",))
    assert c["oasis"] and c["entity"] is not None, "and vice versa"


def test_entity_packing_disjoint_and_isolate_grid(env, tmp_path, monkeypatch) -> None:
    ts = env["run_id"].replace("multimodal-scenario-", "")
    _graphml(tmp_path, monkeypatch, ts)
    e = graph_export.export_for_run(env["run_id"], halves=("entity",))["entity"]
    assert e["components"] == 4 and e["isolates"] == 2
    pos = {n["id"]: (n["x"], n["y"]) for n in e["nodes"]}
    # component bboxes pairwise disjoint (with PAD slack): giant {e1..e4}, pair {p1,p2}, isolates
    def bbox(ids):
        xs = [pos[i][0] for i in ids]
        ys = [pos[i][1] for i in ids]
        return min(xs), min(ys), max(xs), max(ys)
    giant, pair = bbox(["e1", "e2", "e3", "e4"]), bbox(["p1", "p2"])
    disjoint = (giant[2] < pair[0] or pair[2] < giant[0] or giant[3] < pair[1] or pair[3] < giant[1])
    assert disjoint, "packed components must not overlap"
    assert pos["iso1"] != pos["iso2"]  # the isolate grid separates them
    # determinism of the whole entity half
    e2 = graph_export.export_for_run(env["run_id"], halves=("entity",))["entity"]
    assert e == e2


def test_entity_sources_sep_split_and_truncate_dropped(env, tmp_path, monkeypatch) -> None:
    ts = env["run_id"].replace("multimodal-scenario-", "")
    _graphml(tmp_path, monkeypatch, ts)
    e = graph_export.export_for_run(env["run_id"], halves=("entity",))["entity"]
    n = e["nodes"][0]
    assert n["source_count"] == 2  # dup dropped + truncate marker dropped
    assert len(n["sources"]) <= 3
    assert not any("truncated" in s for s in n["sources"])


def test_staleness_three_branches(env, tmp_path, monkeypatch) -> None:
    ts = env["run_id"].replace("multimodal-scenario-", "")
    art_path = env["runs"] / f"{env['run_id']}.json"
    # fresh: graphml newer than the artifact -> no note
    p = _graphml(tmp_path, monkeypatch, ts, mtime=art_path.stat().st_mtime + 60)
    e = graph_export.export_for_run(env["run_id"], halves=("entity",))["entity"]
    assert e["index_built_at"] and "stale_note" not in e
    # stale: graphml older than the artifact -> the verbatim stale note
    os.utime(p, (art_path.stat().st_mtime - 3600, art_path.stat().st_mtime - 3600))
    e = graph_export.export_for_run(env["run_id"], halves=("entity",))["entity"]
    assert e["stale_note"] == graph_export.STALE_NOTE
    # unknowable: a nonsensical (far-future) mtime -> null built_at + the unknowable note
    os.utime(p, (time.time() + 10 * 86400, time.time() + 10 * 86400))
    e = graph_export.export_for_run(env["run_id"], halves=("entity",))["entity"]
    assert e["index_built_at"] is None and e["stale_note"] == graph_export.UNKNOWABLE_NOTE


def test_sidecar_naming_never_matches_artifact_globs(env) -> None:
    runs_path, web_path = graph_export.sidecar_paths(env["run_id"])
    assert not fnmatch.fnmatch(runs_path.name, "multimodal-scenario-*.json")
    assert runs_path.name.startswith("graphs-")
    assert web_path.name == f"{env['run_id']}-graphs.json"


def test_graphs_banned_regex_clean_over_the_sidecar(env, tmp_path, monkeypatch) -> None:
    ts = env["run_id"].replace("multimodal-scenario-", "")
    _graphml(tmp_path, monkeypatch, ts)
    graph_export.export_for_run(env["run_id"])
    runs_path, _ = graph_export.sidecar_paths(env["run_id"])
    text = runs_path.read_text(encoding="utf-8")
    assert not GRAPHS_BANNED.search(text), "no influence winners / centrality language in the sidecar"
