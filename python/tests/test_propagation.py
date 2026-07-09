"""Phase 4.2 — unit tests for the OASIS propagation PRODUCER (base-env, SUMO-free).

Covers the deterministic glue that bugs bite hardest: node build (inferred dedupe WITHOUT collapsing sim
agents), the post-hoc audit (drop 'digits' for chatter, keep safety/tally/crash), per-step event bucketing
via monotonic id boundaries (NOT OASIS created_at), the row_index->agentId map honoured over any DB column,
and argument-reach counting. The graph-build determinism test is SUMO-gated.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

import propagation as P
import report
import trajectory_io

REPO = Path(__file__).resolve().parents[2]
LATEST = REPO / "web" / "public" / "latest.json"


# --------------------------------------------------------------------------- build_nodes
def test_build_nodes_dedupes_inferred_never_collapses_sim() -> None:
    art = trajectory_io.load_artifact(LATEST)
    nodes = P.build_nodes(art)

    # expected from the artifact itself (robust to regeneration).
    def aid(a):
        return a.vehicle_id or a.person_id or a.persona.id

    sim_ids = {aid(a) for a in art.agents if a.grounding == "sim"}
    inferred_personas = {a.persona.id for a in art.agents if a.grounding == "inferred"}

    ids = [n["agent_id"] for n in nodes]
    assert len(ids) == len(set(ids)), "agentIds must be unique graph keys"
    assert len(nodes) == len(sim_ids) + len(inferred_personas)
    assert sum(1 for n in nodes if n["grounding"] == "sim") == len(sim_ids), "no sim agent may be dropped"
    assert sum(1 for n in nodes if n["grounding"] == "inferred") == len(inferred_personas), \
        "inferred voices dedupe to one node per unique persona"
    # rows are a dense 0..n-1 range (used directly as OASIS user_id / CSV row).
    assert [n["row"] for n in nodes] == list(range(len(nodes)))


# --------------------------------------------------------------------------- apply_audit
def test_apply_audit_persona_safety_calibration_and_excluded_by() -> None:
    """Phase 4.4: apply_audit uses the PERSONA-voice safety calibration. First-person hope/conditional about
    safety is LICENSED (the round-0 speech act); an assertion-of-accomplished-fact is EXCLUDED. digits dropped;
    tally kept; seeds (step 0) exempt."""
    events = [
        {"step": 0, "action": "post", "content": "The street is safer now, plain and simple."},  # seed: exempt
        {"step": 1, "action": "post", "content": "I reckon I'll lose 5 minutes each morning now."},  # digits only
        {"step": 1, "action": "comment", "content": "If it slows the cars, the kids are safer crossing — I'm all for it."},  # LICENSED persona hope
        {"step": 1, "action": "post", "content": "The street is safer now, plain and simple."},  # EXCLUDED assertion
        {"step": 1, "action": "post", "content": "The parking out front is my real worry."},  # clean
        {"step": 1, "action": "post", "content": "The majority of us clearly oppose it."},  # tally
        {"step": 1, "action": "like", "content": None},  # no content
    ]
    excluded = P.apply_audit(events)

    assert events[0]["audit_status"] == "clean", "step-0 seed is exempt from re-audit"
    assert events[1]["audit_status"] == "clean", "digit-only chatter is NOT excluded (digits rule dropped)"
    assert events[2]["audit_status"] == "clean", "first-person conditional safety hope is LICENSED (4.4)"
    assert events[3]["audit_status"] == "excluded" and events[3]["excluded_by"] == ["safety_direction"], \
        "an assertion-of-accomplished-fact safety direction is still EXCLUDED"
    assert events[4]["audit_status"] == "clean"
    assert events[5]["audit_status"] == "excluded" and events[5]["excluded_by"] == ["tally"]
    assert events[6]["audit_status"] == "clean"
    assert excluded == 2


def test_cascade_safety_fixtures() -> None:
    """Phase 4.4: every LABELED fixture gets the tuned rule's decision. The 43 real exclusions are frozen
    (40 recover / 3 stay-excluded); the independent MUST-EXCLUDE (evidential/realized assertions) is where the
    rule's teeth are proven, MUST-LICENSE (persona irrealis) where its licence is."""
    fx = json.loads((REPO / "python" / "tests" / "fixtures" / "cascade_safety.json").read_text(encoding="utf-8"))

    def excluded(t: str) -> bool:
        return "safety_direction" in [r for r, _ in report.audit_prose_cascade(t)]

    fails = []
    for e in fx["real_43"]:
        if excluded(e["content"]) != (e["expect"] == "exclude"):
            fails.append((f"real/{e['expect']}", e["content"][:80]))
    for t in fx["must_exclude"]:
        if not excluded(t):
            fails.append(("must_exclude-LEAKED", t))
    for t in fx["must_license"]:
        if excluded(t):
            fails.append(("must_license-OVERFIRED", t))
    assert not fails, "cascade-safety fixtures mis-decided:\n  " + "\n  ".join(map(str, fails))
    ex = sum(1 for e in fx["real_43"] if e["expect"] == "exclude")
    assert len(fx["real_43"]) == 43 and ex == 3, "expected 40 recover / 3 stay-excluded of the 43"


def test_blunt_audit_prose_unchanged_for_system_voice() -> None:
    """The two-context firewall: the BLUNT audit_prose (report/chat SYSTEM voice) must STILL flag persona-hope
    safety — the 4.4 calibration is cascade-only. Guards against a refactor leaking into the blunt path."""
    hope = "If it slows the cars, the kids are safer crossing."
    assert "safety_direction" in [r for r, _ in report.audit_prose(hope)], "blunt rule must still fire (unchanged)"
    assert "safety_direction" not in [r for r, _ in report.audit_prose_cascade(hope)], "cascade rule licenses it"


# --------------------------------------------------------------------------- parse_cascade / bucketing
def _synthetic_raw() -> dict:
    return {
        "cascade_id": "c1",
        "agent_id_by_row": {"0": "v_a", "1": "v_b", "2": "shop_owner"},
        "tables": {
            "users": [  # DELIBERATELY scrambled name/user_name — must be ignored in favour of agent_id_by_row.
                {"user_id": 0, "agent_id": 0, "user_name": None, "name": "WRONG_A"},
                {"user_id": 1, "agent_id": 1, "user_name": None, "name": "WRONG_B"},
                {"user_id": 2, "agent_id": 2, "user_name": None, "name": "WRONG_C"},
            ],
            "posts": [
                {"post_id": 1, "user_id": 0, "content": "seed a", "original_post_id": None},
                {"post_id": 2, "user_id": 1, "content": "seed b", "original_post_id": None},
                {"post_id": 3, "user_id": 2, "content": "seed c", "original_post_id": None},
                {"post_id": 4, "user_id": 0, "content": "step1 post by a", "original_post_id": None},
                {"post_id": 5, "user_id": 1, "content": "", "original_post_id": 1},  # b reposts a's seed
            ],
            "comments": [{"comment_id": 1, "user_id": 2, "post_id": 1, "content": "c comments on a"}],
            "likes": [{"rowid": 1, "user_id": 1, "post_id": 3}],
            "follows": [{"rowid": 1, "follower_id": 0, "followee_id": 2}],
            "trace": [],
        },
        "rec_snapshots": [
            {"label": "after_seed", "exposures": [[1, 1]]},  # v_b was recommended v_a's seed post
            {"label": "step_1", "exposures": [[1, 1]]},
        ],
        "step_boundaries": [
            {"label": "after_seed", "post": 3, "comment": 0, "like": 0, "follow": 0},
            {"label": "step_1", "post": 5, "comment": 1, "like": 1, "follow": 1},
        ],
    }


def test_parse_cascade_buckets_and_uses_agentid_map_not_db_columns() -> None:
    edges = {(0, 2): "homophily"}  # row 0 (v_a) follows row 2 (shop_owner)
    parsed = P.parse_cascade(_synthetic_raw(), edges)
    ev = {(e["agent"], e["action"], e.get("target_post")): e for e in parsed["events"]}

    # agentIds come from agent_id_by_row, NEVER the scrambled `name` column.
    assert all(e["agent"] in {"v_a", "v_b", "shop_owner"} for e in parsed["events"])
    assert not any("WRONG" in (e["agent"] or "") for e in parsed["events"])

    # step bucketing: seeds -> step 0; everything after -> step 1.
    seeds = [e for e in parsed["events"] if e["action"] == "post" and e["content"] in ("seed a", "seed b", "seed c")]
    assert all(e["step"] == 0 for e in seeds)
    assert ev[("v_a", "post", None)]["step"] == 1  # post_id 4
    repost = ev[("v_b", "repost", "1")]
    assert repost["step"] == 1 and repost["target_agent"] == "v_a"
    assert repost["exposed_via"] == "recsys"  # (1,0) not a follow edge, but (1, post 1) was recommended
    comment = ev[("shop_owner", "comment", "1")]
    assert comment["step"] == 1 and comment["target_agent"] == "v_a"
    follow = ev[("v_a", "follow", None)]
    assert follow["step"] == 1 and follow["target_agent"] == "shop_owner"


# --------------------------------------------------------------------------- engaged_reach
def test_engaged_reach_counts_unique_actors_and_normalizes_by_volume() -> None:
    parsed = {
        "events": [
            # two CLEAN parking posts; one EXCLUDED parking post (must not count as making the argument).
            {"action": "post", "content": "The parking out front matters.", "audit_status": "clean",
             "_post_id": 10, "agent": "a0"},
            {"action": "post", "content": "Curb parking for my shop is the issue.", "audit_status": "clean",
             "_post_id": 11, "agent": "a1"},
            {"action": "post", "content": "Losing parking is unacceptable.", "audit_status": "excluded",
             "_post_id": 12, "agent": "a9"},
            # actors who ACT ON those posts: likes/comments/reposts carrying target_post.
            {"action": "like", "target_post": "10", "agent": "a2"},
            {"action": "comment", "target_post": "10", "content": "agreed", "audit_status": "clean", "agent": "a3"},
            {"action": "like", "target_post": "11", "agent": "a2"},           # a2 again -> still one unique actor
            {"action": "like", "target_post": "12", "agent": "a4"},           # acts on the EXCLUDED post -> ignored
            {"action": "repost", "target_post": "99", "agent": "a5"},         # non-family post -> ignored
        ],
    }
    diag = P.engaged_reach(parsed, "c1")
    parking = next(d for d in diag if d["argument"] == "parking / curb")
    assert parking["post_count"] == 2, "two CLEAN parking posts (the excluded one does not make the argument)"
    assert parking["reached"] == 2, "unique actors a2,a3 on posts 10/11; a2 dedup'd; a4 (excluded post) ignored"
    assert parking["actions_per_post"] == 1.0  # 2 reached / 2 posts
    assert all(d["cascade_id"] == "c1" for d in diag)


# --------------------------------------------------------------------------- build_graph determinism (SUMO)
def test_build_graph_is_deterministic_and_sparse() -> None:
    try:
        import run_sim
        import sumolib  # noqa: F401
    except Exception:  # pragma: no cover - SUMO not on this box
        pytest.skip("SUMO/sumolib not importable (SUMO_HOME unset) — graph-build test skipped")
    if not run_sim.NET.is_file():
        pytest.skip("corridor net unavailable")

    art = trajectory_io.load_artifact(LATEST)
    if art.meta.scenario is None:
        pytest.skip("latest artifact carries no scenario/change")
    nodes = P.build_nodes(art)
    target = art.meta.scenario.change.target_edge
    # 5.1: a new_road's target_edge lives in the per-run PATCHED net, not the canonical net build_graph reads,
    # so geography edges are (correctly) skipped — this determinism/geography test needs a runtime-change run.
    if not sumolib.net.readNet(str(run_sim.NET)).hasEdge(target):
        pytest.skip("latest artifact is a new_road run (target edge not in canonical net) — geography skipped")
    e1, s1 = P.build_graph(nodes, target, seed=42)
    e2, s2 = P.build_graph(nodes, target, seed=42)
    assert e1 == e2 and s1 == s2, "same seed must reproduce the graph exactly"
    assert {"homophily", "geography", "cross"} <= set(s1["by_kind"]), "all three edge families present"
    assert 0 < s1["geo_nodes"] < s1["sim_nodes"], "geography must be a meaningful SUBSET of sim agents"
    assert s1["out_degree_avg"] <= 8, "graph must stay sparse (follow-driven distinguishable from recsys)"
