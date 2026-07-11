"""Phase 4.2 — the OASIS PROPAGATION ORCHESTRATOR (base env, python 3.13).

The base-env half of the two-env boundary. It:
  1. builds the social GRAPH + agent profiles deterministically from an existing v0.4.0 artifact,
  2. invokes the cascade runner (``oasis_cascade.py``) once per cascade as a SUBPROCESS in the `oasis`
     conda env (``conda run --no-capture-output -n oasis …``) — the only crossing is files,
  3. parses the raw per-cascade output, derives opinion TRAJECTORIES (a temp-0 stance-scoring pass through
     the existing provider funnel), runs the POST-HOC GUARDS (audit + immutability), computes ARGUMENT-REACH,
  4. assembles the ``social{}`` block INTO the artifact in place, validates, and recopies ``latest.json``.

Agent keys everywhere use the frozen convention (vehicle_id ?? person_id ?? persona.id). The row_index ->
agentId map is OWNED here (from CSV row order) and reconstructed from row order on return — NEVER from
OASIS's scrambled name/user_name columns. Inferred voices dedupe to one node per unique persona because for
them agentId IS persona.id (a graph key must be unique); the 200 sim agents are NEVER collapsed by persona.

Cost gate: run ``--cascades 1`` FIRST, read the metered cost (cascade tokens + base-env stance-scoring
tokens), report, and only then run ``--cascades 3``.
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import json
import os
import shutil
import subprocess
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from pydantic import BaseModel

import trajectory_io
from contract_models import (ArgumentReach, Cascade, CascadeStep, OpinionTrajectory, Social, SocialEdge,
                             SocialEvent, SocialGraph, TrajectoryPoint)
from llm_provider import get_client
from personas import load_personas
from report import audit_prose_cascade  # persona-voice safety calibration (4.4); NOT the blunt system-voice rule
from social_checks import agent_id_of, check_immutability

# NOTE: sumolib / run_sim / scenario_harness are imported LAZILY inside build_graph() only — they require
# SUMO_HOME, and keeping them out of module import lets the pure-logic units (audit, reach, bucketing,
# node build) be imported and tested without SUMO present (the report.py precedent).

REPO = Path(__file__).resolve().parents[2]
RUNS_DIR = REPO / "contract" / "runs"
WEB_PUBLIC = REPO / "web" / "public"
SCRATCH = Path(os.environ.get("LOCALAPPDATA") or os.environ.get("TMP") or ".") / "nadi-oasis-cascade"
OASIS_CASCADE_PY = REPO / "python" / "src" / "oasis_cascade.py"
OASIS_ENV = os.environ.get("OASIS_ENV", "oasis")

# DeepSeek pricing (deepseek-v4-flash, USD / 1M tokens) — cache-hit prompt is much cheaper, so a flat in-price
# is an UPPER bound. Kept identical to the spike for a like-for-like comparison.
PRICE_IN, PRICE_OUT = 0.27, 1.10
BENCH_IN_PER_CALL, BENCH_OUT_PER_CALL = 3356, 167

# Graph budget — sparse on purpose so follow-driven exposure is distinguishable from recsys surfacing.
HOMOPHILY_K = 3          # out-edges per node to same-group peers
GEO_K = 3                # out-edges per node among corridor-traversing peers
CROSS_K = 8              # how many nodes follow each inferred hub (cross-cutting ties)
CROSS_HUBS = ("shop_owner", "longtime_resident")  # natural cross-group hubs
PROXIMITY_M = 30.0       # a trip "traverses the corridor" if its path passes within this many metres

# Argument keyword families (a documented constant; refinement is a later pass). Matched over CLEAN post
# contents as case-insensitive substrings.
KEYWORD_FAMILIES: dict[str, list[str]] = {
    "parking / curb": ["parking", "curb", "kerb", "loading", "delivery spot", "park out front"],
    "delay / slower": ["slower", "delay", "longer", "backed up", "congest", "traffic", "sit in", "stuck"],
    "protected lane": ["bike lane", "protected", "cycle", "cyclist", "bike", "riding", "ride"],
    "calmer / quieter": ["calmer", "quieter", "safer feel", "slow down traffic", "peaceful", "less speeding"],
    "cost / tax": ["cost", "tax", "spend", "budget", "money", "expensive", "waste"],
}

CONSTITUTION = (
    "Speak ONLY as your own anticipated reaction to this proposed change — never a verdict for the whole "
    "community. Never claim the change makes anyone or any street safer or more dangerous. Never contradict "
    "your own trip experience. Do not invent statistics or numbers."
)


class _StanceWire(BaseModel):
    """Label-only wire schema for the temp-0 stance-scoring pass."""

    stance: Literal["supportive", "neutral", "opposed"]
    sentiment: float


# ==================================================================================================
# 1. GRAPH BUILD (deterministic)
# ==================================================================================================
def build_nodes(artifact) -> list[dict]:
    """One node per unique agentId, row-ordered. 200 sim agents (unique vehicle/person ids) + the unique
    inferred personas (inferred agentId == persona.id, so they must be single nodes)."""
    personas = {p.id: p for p in load_personas()}
    ent = {v.id: v for v in artifact.vehicles}
    ent.update({p.id: p for p in artifact.persons})

    nodes: list[dict] = []
    seen_inferred: set[str] = set()
    for a in artifact.agents:
        aid = agent_id_of(a)
        if a.grounding == "inferred":
            if a.persona.id in seen_inferred:
                continue  # inferred dedupe — agentId IS persona.id, a graph key must be unique
            seen_inferred.add(a.persona.id)
        spec = personas.get(a.persona.id)
        mode = spec.mode if spec else None
        stakeholder = spec.stakeholder if spec else None
        group = (stakeholder or "other") if a.grounding == "inferred" else (mode or "other")
        path = ent[aid].path if (a.grounding == "sim" and aid in ent) else None
        nodes.append({
            "agent_id": aid, "persona_id": a.persona.id, "label": spec.label if spec else a.persona.id,
            "description": spec.description if spec else "", "grounding": a.grounding, "group": group,
            "mode": mode, "stakeholder": stakeholder, "seed": a.reaction.comment,
            "seed_stance": a.reaction.stance, "seed_sentiment": a.reaction.sentiment,
            "delta": a.outcome.delta_seconds if a.outcome else None, "path": path,
        })
    for i, node in enumerate(nodes):
        node["row"] = i
    ids = [n["agent_id"] for n in nodes]
    assert len(ids) == len(set(ids)), "agentId collision among graph nodes — keys must be unique"
    return nodes


def build_graph(nodes: list[dict], target_edge: str, seed: int) -> tuple[dict, dict]:
    """Return ({(from_row, to_row): kind}, stats). Edges are directed 'from follows to'. First kind wins."""
    import random

    import run_sim  # wires SUMO_HOME/tools onto sys.path so `sumolib` imports (must precede sumolib)
    import sumolib
    from scenario_harness import _dist_point_to_polyline

    rng = random.Random(seed)
    edges: dict[tuple[int, int], str] = {}

    def add(a: int, b: int, kind: str) -> None:
        if a != b:
            edges.setdefault((a, b), kind)

    # homophily — within stakeholder/mode groups.
    groups: dict[str, list[int]] = defaultdict(list)
    for n in nodes:
        groups[n["group"]].append(n["row"])
    for rows in groups.values():
        for r in rows:
            others = [x for x in rows if x != r]
            for t in rng.sample(others, min(HOMOPHILY_K, len(others))):
                add(r, t, "homophily")

    # geography — trips that pass within PROXIMITY_M of the changed edge.
    net = sumolib.net.readNet(str(run_sim.NET))
    geo_rows: list[int] = []
    if not net.hasEdge(target_edge):
        # 5.1: a new_road's target_edge lives only in the per-run PATCHED net, not the canonical net we read
        # here — geography edges (proximity to the changed corridor edge) can't be keyed on it. Degrade
        # gracefully (homophily + cross still build) rather than crash. Refining this to the patched net is a
        # later pass.
        print(f"[propagation] target_edge {target_edge!r} not in the canonical net (new_road?) — "
              "skipping geography edges", flush=True)
    else:
        shape = net.getEdge(target_edge).getShape()
        for n in nodes:
            if not n["path"]:
                continue
            mind = min((_dist_point_to_polyline(*net.convertLonLat2XY(lon, lat), shape) for lon, lat in n["path"]),
                       default=float("inf"))
            if mind <= PROXIMITY_M:
                geo_rows.append(n["row"])
    for r in geo_rows:
        others = [x for x in geo_rows if x != r]
        for t in rng.sample(others, min(GEO_K, len(others))):
            add(r, t, "geography")

    # cross — inferred hubs followed across all groups.
    all_rows = [n["row"] for n in nodes]
    hub_rows = [n["row"] for n in nodes if n["persona_id"] in CROSS_HUBS]
    for h in hub_rows:
        for t in rng.sample([x for x in all_rows if x != h], min(CROSS_K, len(all_rows) - 1)):
            add(t, h, "cross")

    kinds = defaultdict(int)
    for k in edges.values():
        kinds[k] += 1
    stats = {"edges": len(edges), "by_kind": dict(kinds), "geo_nodes": len(geo_rows),
             "sim_nodes": sum(1 for n in nodes if n["grounding"] == "sim"),
             "out_degree_avg": round(len(edges) / max(1, len(nodes)), 2)}
    return edges, stats


def write_profiles_csv(nodes: list[dict], edges: dict, path: Path) -> None:
    following: dict[int, list[int]] = defaultdict(list)
    for (f, t) in edges:
        following[f].append(t)
    followers: dict[int, int] = defaultdict(int)
    for (_f, t) in edges:
        followers[t] += 1
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["", "user_id", "name", "username", "following_agentid_list",
                    "following_count", "followers_count", "previous_tweets", "user_char", "description"])
        for n in nodes:
            i = n["row"]
            char = f"You are {n['label']}. {n['description']}\n\n{CONSTITUTION}"
            w.writerow([i, i, n["label"], n["agent_id"], json.dumps(sorted(following[i])),
                        len(following[i]), followers[i], "[]", char, char])


# ==================================================================================================
# 2. CASCADE INVOCATION (subprocess into the oasis env)
# ==================================================================================================
def make_config(cascade_id: str, nodes: list[dict], csv_path: Path, designed_edges: int, steps: int,
                activation: float, seed: int, cascade_idx: int) -> tuple[Path, Path]:
    import random

    rng = random.Random(seed * 1000 + cascade_idx)  # per-cascade activation subset
    n = len(nodes)
    k = max(1, round(activation * n))
    active_indices = [sorted(rng.sample(range(n), k)) for _ in range(steps)]
    db_path = SCRATCH / f"cascade-{cascade_id}.db"
    out_path = SCRATCH / f"cascade-{cascade_id}.raw.json"
    cfg = {
        "cascade_id": cascade_id, "profiles_csv": str(csv_path), "db_path": str(db_path),
        "out_path": str(out_path), "n_steps": steps, "designed_edge_count": designed_edges,
        "active_indices": active_indices,
        "seed_by_row": {str(x["row"]): x["seed"] for x in nodes},
        "agent_id_by_row": {str(x["row"]): x["agent_id"] for x in nodes},
        "model_platform": "DEEPSEEK", "model_type": "deepseek-v4-flash",
        "model_url": "https://api.deepseek.com/v1", "key_env": "DEEPSEEK_API_KEY", "temperature": 0.6,
    }
    cfg_path = SCRATCH / f"cascade-{cascade_id}.config.json"
    cfg_path.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")
    return cfg_path, out_path


def run_cascade(cfg_path: Path, out_path: Path) -> dict:
    """Invoke oasis_cascade.py in the oasis env. Output goes to a KNOWN file (out_path), so we never parse
    the child's stdout — sidestepping the cp1252 re-encode hazard entirely (stdout is inherited/streamed)."""
    if out_path.exists():
        out_path.unlink()
    cmd = ["conda", "run", "--no-capture-output", "-n", OASIS_ENV, "python",
           str(OASIS_CASCADE_PY), str(cfg_path)]
    print(f"[propagation] -> {' '.join(cmd)}", flush=True)
    subprocess.run(cmd, check=True)  # inherit stdout/stderr; raises on the cascade's asserts
    if not out_path.exists():
        raise RuntimeError(f"cascade produced no output at {out_path} (did the subprocess crash?)")
    return json.loads(out_path.read_text(encoding="utf-8"))


# ==================================================================================================
# 3a. PARSE a raw cascade -> events + utterances (deterministic; NO llm)
# ==================================================================================================
def _step_of(kind: str, idv: int, boundaries: list[dict]) -> int:
    for k, b in enumerate(boundaries):
        if idv <= b[kind]:
            return k
    return len(boundaries) - 1


def parse_cascade(raw: dict, edges: dict) -> dict:
    """Reconstruct per-step social events + per-agent utterances. Uses row-index == user_id and the raw's
    authoritative agent_id_by_row; NEVER OASIS name/user_name."""
    aid_by_row = raw["agent_id_by_row"]
    aid = lambda uid: aid_by_row.get(str(uid), f"row{uid}")  # noqa: E731
    t = raw["tables"]
    boundaries = raw["step_boundaries"]
    edge_pairs = set(edges.keys())  # (follower_row, followee_row)

    post_author = {p["post_id"]: p["user_id"] for p in t["posts"]}
    # every [uid, post_id] ever recommended (recsys exposure), across snapshots.
    exposed_pairs = {(u, p) for snap in raw["rec_snapshots"] for (u, p) in snap["exposures"]}

    def exposed_via(actor_uid: int, author_uid: int, post_id: int) -> str | None:
        if (actor_uid, author_uid) in edge_pairs:
            return "follow"  # follow-edge exposure is first-class
        if (actor_uid, post_id) in exposed_pairs:
            return "recsys"
        return None

    events: list[dict] = []
    # posts (incl. reposts) — content-bearing.
    for p in t["posts"]:
        step = _step_of("post", p["post_id"], boundaries)
        if p["original_post_id"]:
            au = post_author.get(p["original_post_id"])
            events.append({"step": step, "agent": aid(p["user_id"]), "action": "repost",
                           "target_agent": aid(au) if au is not None else None,
                           "target_post": str(p["original_post_id"]),
                           "exposed_via": exposed_via(p["user_id"], au, p["original_post_id"]) if au is not None else None,
                           "content": p["content"] or None, "_uid": p["user_id"], "_post_id": p["post_id"]})
        else:
            events.append({"step": step, "agent": aid(p["user_id"]), "action": "post", "target_agent": None,
                           "target_post": None, "exposed_via": None, "content": p["content"],
                           "_uid": p["user_id"], "_post_id": p["post_id"]})
    # comments — content-bearing.
    for c in t["comments"]:
        step = _step_of("comment", c["comment_id"], boundaries)
        au = post_author.get(c["post_id"])
        events.append({"step": step, "agent": aid(c["user_id"]), "action": "comment",
                       "target_agent": aid(au) if au is not None else None, "target_post": str(c["post_id"]),
                       "exposed_via": exposed_via(c["user_id"], au, c["post_id"]) if au is not None else None,
                       "content": c["content"], "_uid": c["user_id"], "_post_id": None})
    # likes — no content.
    for lk in t["likes"]:
        step = _step_of("like", lk["rowid"], boundaries)
        au = post_author.get(lk["post_id"])
        events.append({"step": step, "agent": aid(lk["user_id"]), "action": "like",
                       "target_agent": aid(au) if au is not None else None, "target_post": str(lk["post_id"]),
                       "exposed_via": exposed_via(lk["user_id"], au, lk["post_id"]) if au is not None else None,
                       "content": None, "_uid": lk["user_id"], "_post_id": None})
    # follows — no content.
    for fw in t["follows"]:
        step = _step_of("follow", fw["rowid"], boundaries)
        events.append({"step": step, "agent": aid(fw["follower_id"]), "action": "follow",
                       "target_agent": aid(fw["followee_id"]), "target_post": None,
                       "exposed_via": None, "content": None, "_uid": fw["follower_id"], "_post_id": None})

    events.sort(key=lambda e: (e["step"], e["action"]))
    return {"events": events, "post_author": post_author, "aid_by_row": aid_by_row,
            "rec_snapshots": raw["rec_snapshots"]}


# ==================================================================================================
# 3b. GUARDS (deterministic audit) + 3c. TRAJECTORIES (temp-0 stance scoring)
# ==================================================================================================
def apply_audit(events: list[dict]) -> int:
    """Audit NEW (step>=1) content-bearing events with the PERSONA-voice calibration (audit_prose_cascade):
    first-person safety hope/conditional is licensed, an assertion-of-accomplished-fact is not. Seeds (step 0)
    are exempt. 'digits' is dropped for chatter; immutability is applied later. FULLY RECOMPUTES each event's
    content-rule status (idempotent — safe to re-run over an already-audited artifact in --reaudit). Returns
    the count excluded here (content rules only, before immutability)."""
    excluded = 0
    for e in events:
        if e["step"] == 0 or not e.get("content"):
            e["audit_status"] = "clean"  # seed or no content -> clean by construction
            e.pop("excluded_by", None)
            continue
        rules = sorted({r for (r, _s) in audit_prose_cascade(e["content"]) if r != "digits"})
        if rules:
            e["audit_status"] = "excluded"
            e["excluded_by"] = rules
            excluded += 1
        else:
            e["audit_status"] = "clean"
            e.pop("excluded_by", None)
    return excluded


async def score_trajectories(parsed_by_cascade: dict, nodes: list[dict], client) -> list[OpinionTrajectory]:
    """Per (agent, cascade): step-0 stance = the artifact's existing reaction (no call); each later
    content-bearing, CLEAN utterance is stance-scored temp-0. shifted = step0 stance != last scored stance."""
    seed_by_aid = {n["agent_id"]: (n["seed_stance"], n["seed_sentiment"]) for n in nodes}
    sem = asyncio.Semaphore(8)
    err_seen: list[str] = []  # surface the FIRST scoring error once (a systemic failure must not stay silent)

    async def score(text: str) -> tuple[str, float] | None:
        async with sem:
            try:
                # DeepSeek json_object mode requires the literal word "json" + a shape example in the prompt
                # (the adapter does not auto-inject — see report.py's convention). Omitting it 400s every call.
                obj = await client.generate_json(
                    system=("You label the STANCE and SENTIMENT of ONE short social-media message about a "
                            "proposed local infrastructure change."),
                    user=(f'Message: "{text}"\n\nReply with ONLY a json object of exactly this shape, nothing '
                          'else: {"stance": "supportive|neutral|opposed", "sentiment": <number from -1 to 1>}'),
                    schema=_StanceWire, temperature=0.0)
                s = obj.get("stance")
                if s not in ("supportive", "neutral", "opposed"):
                    return None
                sent = obj.get("sentiment")
                sent = max(-1.0, min(1.0, float(sent))) if isinstance(sent, (int, float)) else None
                return s, sent
            except Exception as exc:  # defensive: a scoring miss just drops that point
                if not err_seen:
                    err_seen.append(str(exc))
                    print(f"[propagation] WARNING: stance-scoring call failed ({type(exc).__name__}: {exc}) — "
                          "further failures suppressed", flush=True)
                return None

    trajectories: list[OpinionTrajectory] = []
    for cascade_id, parsed in parsed_by_cascade.items():
        # utterances per agent: the last CLEAN content-bearing event per (agent, step>=1).
        by_agent: dict[str, dict[int, str]] = defaultdict(dict)
        acted_on: dict[str, set[str]] = defaultdict(set)
        for e in parsed["events"]:
            if e["step"] >= 1 and e.get("content") and e.get("audit_status") == "clean":
                by_agent[e["agent"]][e["step"]] = e["content"]
            if e["action"] in ("like", "comment", "repost") and e.get("target_agent") and e.get("exposed_via"):
                acted_on[e["agent"]].add(e["target_agent"])

        for agent, step_text in by_agent.items():
            if agent not in seed_by_aid:
                continue
            s0, sent0 = seed_by_aid[agent]
            points = [TrajectoryPoint(step=0, stance=s0, sentiment=sent0)]
            scored = await asyncio.gather(*[score(step_text[s]) for s in sorted(step_text)])
            for s, res in zip(sorted(step_text), scored):
                if res is not None:
                    points.append(TrajectoryPoint(step=s, stance=res[0], sentiment=res[1]))
            if len(points) < 2:
                continue  # nothing new scored -> no movement to report
            trajectories.append(OpinionTrajectory(
                agent=agent, cascade_id=cascade_id, derived_by="stance_scoring", points=points,
                shifted=points[0].stance != points[-1].stance,
                influenced_by=sorted(acted_on.get(agent, set()))))
    return trajectories


# ==================================================================================================
# 3d. ENGAGED-REACH (code, no llm)
# ==================================================================================================
# ENGAGED-reach, NOT exposure-reach: reached = unique agents who ACTED ON (liked / commented / reposted) a
# clean post making the argument — "moved to respond, not merely shown". Exposure-reach (agents merely SHOWN a
# post via rec/follow) saturates to everyone under the RANDOM recsys and cannot discriminate; it is retired
# here and mentioned only in the report limitations. The diagnostics also return post_count + actions-per-post
# so the volume-confound (engagement tracking post-VOLUME rather than persuasiveness) is a read-off.
def engaged_reach(parsed: dict, cascade_id: str) -> list[dict]:
    """Per-family engaged-reach diagnostics: {argument, cascade_id, reached, post_count, actions_per_post}.
    Needs only each event's target_post + post content + audit_status — no graph/SUMO, no rec snapshots."""
    events = parsed["events"]
    # A post "makes" an argument if it is a CLEAN post/repost whose content matches the family terms.
    clean_posts = [e for e in events if e["action"] in ("post", "repost") and e.get("content")
                   and e.get("audit_status") == "clean" and e.get("_post_id") is not None]
    # Acting ON a post = a like/comment/repost carrying that post as target_post (target_post is a str id).
    actions = [e for e in events if e["action"] in ("like", "comment", "repost") and e.get("target_post")]
    out: list[dict] = []
    for family, terms in KEYWORD_FAMILIES.items():
        fam_pids = {str(e["_post_id"]) for e in clean_posts if any(t in e["content"].lower() for t in terms)}
        actors = {e["agent"] for e in actions if e.get("target_post") in fam_pids}
        pc, reached = len(fam_pids), len(actors)
        out.append({"argument": family, "cascade_id": cascade_id, "reached": reached, "post_count": pc,
                    "actions_per_post": round(reached / pc, 2) if pc else 0.0})
    return out


# ==================================================================================================
# 4. ASSEMBLE social{} IN PLACE
# ==================================================================================================
def to_social_events(events: list[dict]) -> dict[int, list[SocialEvent]]:
    by_step: dict[int, list[SocialEvent]] = defaultdict(list)
    for e in events:
        kw = {"agent": e["agent"], "action": e["action"], "audit_status": e.get("audit_status", "clean")}
        for opt in ("target_agent", "target_post", "content", "exposed_via"):
            if e.get(opt) is not None:
                kw[opt] = e[opt]
        if e.get("excluded_by"):
            kw["excluded_by"] = e["excluded_by"]
        by_step[e["step"]].append(SocialEvent(**kw))
    return by_step


def assemble(artifact, run_id: str, edges: dict, nodes: list[dict], parsed_by_cascade: dict,
             trajectories: list[OpinionTrajectory], reaches: list[ArgumentReach]) -> dict:
    aid_by_row = {str(n["row"]): n["agent_id"] for n in nodes}
    graph = SocialGraph(edges=[SocialEdge.model_validate(
        {"from": aid_by_row[str(f)], "to": aid_by_row[str(t)], "kind": kind}) for (f, t), kind in edges.items()])

    cascades = []
    for cascade_id, parsed in parsed_by_cascade.items():
        by_step = to_social_events(parsed["events"])
        steps = [CascadeStep(step=s, events=by_step[s]) for s in sorted(by_step)]
        cascades.append(Cascade(cascade_id=cascade_id, steps=steps))

    social = Social(mechanism="oasis", graph=graph, cascades=cascades, trajectories=trajectories,
                    argument_reach=reaches, excluded_count=0)
    artifact.social = social
    artifact.schema_version = "0.4.0"  # carrying a social{} block makes this a v0.4.0 artifact

    # Immutability guard runs on the ASSEMBLED artifact (it needs the agents' outcomes). Mark violators.
    viols = check_immutability(artifact)
    viol_keys = {(v["cascade_id"], v["step"], v["agent"], v["content"]) for v in viols}
    for c in social.cascades:
        for st in c.steps:
            for ev in st.events:
                if (c.cascade_id, st.step, ev.agent, ev.content) in viol_keys:
                    ev.audit_status = "excluded"
                    ev.excluded_by = sorted(set((ev.excluded_by or []) + ["immutability"]))
    social.excluded_count = sum(1 for c in social.cascades for st in c.steps
                                for ev in st.events if ev.audit_status == "excluded")

    out_path = RUNS_DIR / f"{run_id}.json"
    trajectory_io.dump_artifact(artifact, path=out_path)  # validates against the frozen schema
    trajectory_io.load_artifact(out_path)  # round-trip proof
    WEB_PUBLIC.mkdir(parents=True, exist_ok=True)
    (WEB_PUBLIC / out_path.name).write_text(out_path.read_text(encoding="utf-8"), encoding="utf-8")
    (WEB_PUBLIC / "latest.json").write_text(out_path.read_text(encoding="utf-8"), encoding="utf-8")
    return {"excluded_count": social.excluded_count, "immutability_violations": viols, "out_path": str(out_path)}


# ==================================================================================================
# COST + REPORT
# ==================================================================================================
def _usd(prompt_tokens: int, completion_tokens: int) -> float:
    return round(prompt_tokens / 1e6 * PRICE_IN + completion_tokens / 1e6 * PRICE_OUT, 4)


def report(cascade_raws: list[dict], scoring_usage: dict, graph_stats: dict, assemble_stats: dict,
           trajectories: list[OpinionTrajectory], reach_diag: dict[str, list[dict]], nodes: list[dict]) -> None:
    n_cascades = len(cascade_raws)
    print("\n" + "=" * 88)
    print(f"PROPAGATION — {n_cascades} cascade(s) over {len(nodes)} agents")
    print("=" * 88)
    print(f"graph: {graph_stats['edges']} edges {graph_stats['by_kind']} | "
          f"geo_nodes {graph_stats['geo_nodes']}/{graph_stats['sim_nodes']} sim | "
          f"avg out-degree {graph_stats['out_degree_avg']}")

    # cost — cascade tokens (metered or estimated) + base-env stance-scoring tokens.
    c_in = sum(r["usage"]["est_in"] for r in cascade_raws)
    c_out = sum(r["usage"]["est_out"] for r in cascade_raws)
    estimated = any(r["usage"]["estimated"] for r in cascade_raws)
    s_in = scoring_usage["prompt_cache_hit_tokens"] + scoring_usage["prompt_cache_miss_tokens"]
    s_out = scoring_usage["completion_tokens"]
    bench_in = sum(r["usage"]["llm_calls"] for r in cascade_raws) * BENCH_IN_PER_CALL
    bench_out = sum(r["usage"]["llm_calls"] for r in cascade_raws) * BENCH_OUT_PER_CALL
    print("\n--- COST (DeepSeek deepseek-v4-flash; flat in-price = upper bound) ---")
    print(f"cascade LLM   : {c_in:,} in / {c_out:,} out  = ${_usd(c_in, c_out)}"
          f"   [{'ESTIMATED (benchmark)' if estimated else 'METERED'}]")
    print(f"stance scoring: {s_in:,} in / {s_out:,} out  = ${_usd(s_in, s_out)}   [metered, {scoring_usage['calls']} calls]")
    print(f"TOTAL         : {c_in + s_in:,} in / {c_out + s_out:,} out  = ${_usd(c_in + s_in, c_out + s_out)}")
    print(f"spike benchmark for the same cascade call-count: ${_usd(bench_in, bench_out)}")

    # per-cascade shifts + excluded + divergence.
    print("\n--- PER CASCADE ---")
    shifts_by_cascade: dict[str, list] = defaultdict(list)
    for tr in trajectories:
        if tr.shifted:
            shifts_by_cascade[tr.cascade_id].append(tr.agent)
    node_group = {n["agent_id"]: n["group"] for n in nodes}
    for r in cascade_raws:
        cid = r["cascade_id"]
        n_events = sum(len(r["tables"][k]) for k in ("posts", "comments", "likes", "follows"))
        movers = shifts_by_cascade.get(cid, [])
        grp = defaultdict(int)
        for a in movers:
            grp[node_group.get(a, "?")] += 1
        print(f"[{cid}] ~{n_events} raw actions | shifted agents: {len(movers)} by group {dict(grp)}")

    print(f"\nexcluded_count: {assemble_stats['excluded_count']} "
          f"(immutability violations: {len(assemble_stats['immutability_violations'])})")

    _report_reach(reach_diag)


def _report_reach(reach_diag: dict[str, list[dict]]) -> None:
    """Engaged-reach gate table: reached / post_count / actions-per-post per family, so the volume-confound is
    a read-off. Divergence verdict by dominant-reached AND (normalized) dominant-actions-per-post."""
    print("\n--- ENGAGED-REACH (unique agents who ACTED ON a post making the argument; within each cascade) ---")
    print("    columns: reached (engaged agents) / posts (clean posts making it) / act-per-post (reached/posts)")
    dom_reached: dict[str, str | None] = {}
    dom_norm: dict[str, str | None] = {}
    for cid, diag in reach_diag.items():
        cells = " | ".join(f"{d['argument']}: {d['reached']}/{d['post_count']}/{d['actions_per_post']}"
                           for d in diag)
        top_r = max(diag, key=lambda d: d["reached"])["argument"] if diag else None
        top_n = max(diag, key=lambda d: d["actions_per_post"])["argument"] if diag else None
        dom_reached[cid], dom_norm[cid] = top_r, top_n
        print(f"[{cid}] {cells}")
        print(f"      dominant by reached: {top_r!r} | dominant by act-per-post (volume-normalized): {top_n!r}")
    # divergence verdict on the ENGAGED metric (dominant by reached across cascades).
    vals = [v for v in dom_reached.values() if v]
    if len(set(vals)) > 1:
        print(f"VERDICT: cascades DIVERGE — dominant argument differs across runs: {dom_reached}")
    elif vals:
        print(f"VERDICT: cascades CONVERGE on {vals[0]!r} (by engaged-reach)")
    # volume-confound read-off: if reached-dominant != normalized-dominant, engagement tracks volume.
    confounded = [cid for cid in reach_diag if dom_reached.get(cid) != dom_norm.get(cid)]
    if confounded:
        print(f"NOTE: reached-lead != per-post-lead in {confounded} — engagement partly tracks post VOLUME; "
              "reframe as 'which argument drew the most response', not 'moved people'.")


# ==================================================================================================
def recompute_reach(run_id: str, art_path: Path) -> None:
    """Step-0 recompute: engaged-reach from the SAVED raw dumps -> update social.argument_reach IN PLACE.
    No OASIS, no LLM, no graph/SUMO — needs only each event's target_post + post content + audit_status."""
    artifact = trajectory_io.load_artifact(art_path)
    if artifact.social is None or not artifact.social.cascades:
        raise SystemExit("artifact has no social cascades — run the producer first.")
    reach_diag: dict[str, list[dict]] = {}
    new_reaches: list[ArgumentReach] = []
    for cascade in artifact.social.cascades:
        cid = cascade.cascade_id
        raw_path = SCRATCH / f"cascade-{cid}.raw.json"
        if not raw_path.exists():
            raise SystemExit(f"missing saved raw dump for {cid}: {raw_path} — re-run the producer (--reuse-raw).")
        raw = json.loads(raw_path.read_text(encoding="utf-8"))
        parsed = parse_cascade(raw, {})   # empty edges: engaged-reach ignores exposure/edges entirely
        apply_audit(parsed["events"])     # sets audit_status — only CLEAN posts count as making an argument
        diag = engaged_reach(parsed, cid)
        reach_diag[cid] = diag
        new_reaches.extend(ArgumentReach(argument=d["argument"], cascade_id=cid, reached=d["reached"],
                                          post_count=d["post_count"]) for d in diag)
    artifact.social.argument_reach = new_reaches
    trajectory_io.dump_artifact(artifact, path=art_path)  # revalidates against the frozen schema
    trajectory_io.load_artifact(art_path)                 # round-trip proof
    (WEB_PUBLIC / art_path.name).write_text(art_path.read_text(encoding="utf-8"), encoding="utf-8")
    (WEB_PUBLIC / "latest.json").write_text(art_path.read_text(encoding="utf-8"), encoding="utf-8")
    print(f"[propagation] recomputed ENGAGED-reach for {len(reach_diag)} cascade(s) -> {art_path.name} + latest.json")
    _report_reach(reach_diag)


def reaudit(run_id: str, art_path: Path) -> None:
    """Phase 4.4 re-apply (no OASIS, no LLM): re-run the content audit over EVERY cascade content event with the
    refined persona-voice safety calibration, then re-run the immutability guard, and update audit_status /
    excluded_by / excluded_count IN PLACE. Justified over the 'raw dumps' path because the artifact retains
    every content-bearing event (clean + excluded) — same population, and it preserves trajectories/reach/graph
    untouched. Reports before->after per rule + recovered-clean vs reclassified-to-immutability."""
    from collections import Counter

    artifact = trajectory_io.load_artifact(art_path)
    if artifact.social is None or not artifact.social.cascades:
        raise SystemExit("artifact has no social cascades — run the producer first.")

    before = Counter()
    sd_before = []  # events currently excluded SOLELY by safety_direction — the population we may recover
    dict_events, refs = [], []
    for cascade in artifact.social.cascades:
        for step in cascade.steps:
            for ev in step.events:
                if ev.audit_status == "excluded":
                    for r in (ev.excluded_by or []):
                        before[r] += 1
                    if ev.excluded_by == ["safety_direction"]:
                        sd_before.append(ev)
                dict_events.append({"step": step.step, "content": ev.content, "action": ev.action})
                refs.append(ev)

    audited = sum(1 for e in dict_events if e["step"] >= 1 and e.get("content"))
    assert audited == 797, f"expected 797 content-bearing step>=1 events (the full population), got {audited}"

    apply_audit(dict_events)  # recompute content-rule audit (refined safety) into the dicts
    for e, ev in zip(dict_events, refs):
        ev.audit_status = e["audit_status"]
        ev.excluded_by = e.get("excluded_by")  # None when cleared

    # immutability on the (content-reset) artifact — recovered utterances tripping _SLOWER can reclassify here.
    viol_keys = {(v["cascade_id"], v["step"], v["agent"], v["content"]) for v in check_immutability(artifact)}
    for c in artifact.social.cascades:
        for st in c.steps:
            for ev in st.events:
                if (c.cascade_id, st.step, ev.agent, ev.content) in viol_keys:
                    ev.audit_status = "excluded"
                    ev.excluded_by = sorted(set((ev.excluded_by or []) + ["immutability"]))

    excluded_now = [ev for c in artifact.social.cascades for st in c.steps for ev in st.events
                    if ev.audit_status == "excluded"]
    after = Counter(r for ev in excluded_now for r in (ev.excluded_by or []))
    artifact.social.excluded_count = len(excluded_now)

    # categorize the previously-safety_direction events by their NEW fate.
    recovered, reclassified, stayed = [], [], []
    for ev in sd_before:
        if ev.audit_status == "clean":
            recovered.append(ev)
        elif "immutability" in (ev.excluded_by or []):
            reclassified.append(ev)
        else:
            stayed.append(ev)

    trajectory_io.dump_artifact(artifact, path=art_path)  # revalidates
    trajectory_io.load_artifact(art_path)                 # round-trip proof
    (WEB_PUBLIC / art_path.name).write_text(art_path.read_text(encoding="utf-8"), encoding="utf-8")
    (WEB_PUBLIC / "latest.json").write_text(art_path.read_text(encoding="utf-8"), encoding="utf-8")

    print("\n" + "=" * 72)
    print(f"RE-AUDIT (persona-voice safety) — {art_path.name} + latest.json")
    print("=" * 72)
    print(f"content-bearing step>=1 events audited: {audited} (== 797, full population)")
    print(f"excluded_count: {sum(before.values())} -> {len(excluded_now)}")
    print(f"  by rule BEFORE: {dict(before)}")
    print(f"  by rule AFTER : {dict(after)}")
    print(f"\nof the {len(sd_before)} safety_direction exclusions:")
    print(f"  recovered -> clean       : {len(recovered)}")
    print(f"  reclassified -> immutability: {len(reclassified)}")
    print(f"  stayed safety_direction  : {len(stayed)}")
    for label, lst in (("recovered", recovered), ("reclassified", reclassified), ("stayed", stayed)):
        if lst:
            print(f"  e.g. [{label}] {lst[0].content[:130]!r}")


def main() -> None:
    ap = argparse.ArgumentParser(description="OASIS propagation orchestrator (Phase 4.2)")
    ap.add_argument("--cascades", type=int, default=3, help="number of independent cascades (run 1 FIRST)")
    ap.add_argument("--steps", type=int, default=5)
    ap.add_argument("--activation", type=float, default=0.5, help="fraction of agents asked to act per step")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--run-id", type=str, default=None, help="artifact run_id (default: latest.json's)")
    ap.add_argument("--reuse-raw", action="store_true",
                    help="reuse existing per-cascade raw OASIS output (skip the subprocess) — redo only the "
                         "base-env post-processing (parse/score/guards/reach/assemble) without re-paying OASIS")
    ap.add_argument("--recompute-reach", action="store_true",
                    help="ONLY recompute social.argument_reach as ENGAGED-reach from the saved raw dumps and "
                         "update the artifact in place (no OASIS, no LLM, no graph/SUMO). Prints the gate table.")
    ap.add_argument("--reaudit", action="store_true",
                    help="ONLY re-run the content audit (refined persona-voice safety, 4.4) + immutability over "
                         "the existing artifact in place (no OASIS, no LLM). Reports the before->after breakdown.")
    args = ap.parse_args()

    SCRATCH.mkdir(parents=True, exist_ok=True)
    run_id = args.run_id or json.loads((WEB_PUBLIC / "latest.json").read_text(encoding="utf-8"))["meta"]["run_id"]
    art_path = RUNS_DIR / f"{run_id}.json"

    if args.recompute_reach:
        recompute_reach(run_id, art_path)
        return
    if args.reaudit:
        reaudit(run_id, art_path)
        return
    artifact = trajectory_io.load_artifact(art_path)
    if artifact.meta.scenario is None:
        raise SystemExit("artifact has no scenario/change — nothing for the corridor geography edges to key on")
    target_edge = artifact.meta.scenario.change.target_edge

    nodes = build_nodes(artifact)
    edges, graph_stats = build_graph(nodes, target_edge, args.seed)
    print(f"[propagation] {len(nodes)} nodes, target_edge {target_edge!r}, graph {graph_stats}", flush=True)
    csv_path = SCRATCH / "profiles.csv"
    write_profiles_csv(nodes, edges, csv_path)

    parsed_by_cascade: dict[str, dict] = {}
    cascade_raws: list[dict] = []
    for i in range(args.cascades):
        cid = f"c{i + 1}"
        out_path = SCRATCH / f"cascade-{cid}.raw.json"
        if args.reuse_raw and out_path.exists():
            print(f"[propagation] reusing existing raw OASIS output for {cid}: {out_path}", flush=True)
            raw = json.loads(out_path.read_text(encoding="utf-8"))
        else:
            cfg_path, out_path = make_config(cid, nodes, csv_path, graph_stats["edges"], args.steps,
                                             args.activation, args.seed, i)
            raw = run_cascade(cfg_path, out_path)
        cascade_raws.append(raw)
        parsed_by_cascade[cid] = parse_cascade(raw, edges)

    # audit every cascade's new utterances (deterministic).
    for parsed in parsed_by_cascade.values():
        apply_audit(parsed["events"])

    # stance-scoring pass (base-env llm through the funnel). PIN DeepSeek (as report.py does): it is the
    # metered adapter (OpenAICompatAdapter tracks .usage — GeminiAdapter does not, which would zero the
    # scoring line of the cost gate), and keeps this consistent with the pinned report/agent pipeline.
    os.environ.setdefault("PROVIDER", "deepseek")
    client, provider, model = get_client()
    print(f"[propagation] stance scoring via {provider}/{model}", flush=True)
    trajectories = asyncio.run(score_trajectories(parsed_by_cascade, nodes, client))

    # engaged-reach per cascade (diagnostics for the gate + ArgumentReach for the contract).
    reach_diag: dict[str, list[dict]] = {}
    reaches: list[ArgumentReach] = []
    for cid, parsed in parsed_by_cascade.items():
        diag = engaged_reach(parsed, cid)
        reach_diag[cid] = diag
        reaches.extend(ArgumentReach(argument=d["argument"], cascade_id=cid, reached=d["reached"],
                                     post_count=d["post_count"]) for d in diag)

    assemble_stats = assemble(artifact, run_id, edges, nodes, parsed_by_cascade, trajectories, reaches)
    report(cascade_raws, client.usage, graph_stats, assemble_stats, trajectories, reach_diag, nodes)

    if args.cascades == 1:
        print("\n" + "!" * 88)
        print("COST GATE: this was cascade #1. Review the cost above, then re-run with --cascades 3.")
        print("!" * 88)
    print(f"\n[propagation] social{{}} assembled into {assemble_stats['out_path']} + web/public/latest.json")


if __name__ == "__main__":
    main()
