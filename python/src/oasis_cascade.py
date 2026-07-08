"""Phase 4.2 — the OASIS CASCADE RUNNER (runs in the dedicated `oasis` conda env, python 3.11).

SELF-CONTAINED by design: this file is the OASIS-env half of the two-env boundary. It reads a config
JSON + a profiles CSV written by the base-env orchestrator (``propagation.py``), runs ONE cascade, and
dumps a raw JSON (all sqlite tables + rec-exposure snapshots + token usage) to %LOCALAPPDATA% scratch,
printing the path on stdout. It imports NOTHING from base-env project modules — the only crossing is files.

Run it (never plain `conda run` — that re-encodes stdout through cp1252 and crashes on non-ASCII posts):
    conda run --no-capture-output -n oasis python python/src/oasis_cascade.py <config.json>

Hard invariants enforced here (see propagation.py / the 4.2 plan):
  * EDGE-COUNT ASSERT — generate_twitter_agent_graph builds NODES but does NOT wire the CSV
    following_agentid_list edges; we wire them via AgentGraph.add_edge and assert the loaded count equals
    the designed count (the spike's zero-edge trap). Refuse to run otherwise.
  * SEED ROUND-TRIP ASSERT — after seeding round-0, every node's seed post is read back from the DB and
    asserted byte-equal to the verbatim reaction the config maps to that row. This proves the whole
    row_index -> agentId -> seed chain (CSV write order, OASIS ingestion, row indexing) end to end.
    We refuse to step the cascade until it passes.
"""

from __future__ import annotations

import asyncio
import csv
import inspect
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

REPO = Path(__file__).resolve().parents[2]
load_dotenv(REPO / "python" / ".env")

# OASIS README benchmark (deepseek-chat): 100 agents x 1 step full activation = 335,600 in / 16,750 out.
BENCH_IN_PER_CALL, BENCH_OUT_PER_CALL = 3356, 167


# --------------------------------------------------------------------------------------------------
# Token metering — wrap the CAMEL backend's inner inference (_run/_arun) and accumulate `.usage`.
# CAMEL model backends return an OpenAI ChatCompletion whose `.usage` carries prompt/completion tokens
# (confirmed against camel-ai docs). Defensive: any shape mismatch simply leaves the totals at 0, and
# the caller falls back to the benchmark estimate labelled "estimated".
# --------------------------------------------------------------------------------------------------
def _meter(model) -> dict:
    usage = {"prompt_tokens": 0, "completion_tokens": 0, "metered_calls": 0}

    def _add(resp) -> None:
        u = getattr(resp, "usage", None)
        if u is None:
            return
        get = (lambda k: u.get(k)) if isinstance(u, dict) else (lambda k: getattr(u, k, None))
        pt, ct = get("prompt_tokens"), get("completion_tokens")
        if pt is None and ct is None:
            return
        usage["prompt_tokens"] += int(pt or 0)
        usage["completion_tokens"] += int(ct or 0)
        usage["metered_calls"] += 1

    # Wrap the INNERMOST inference layer only (single count point). Public run/arun delegate to these.
    for name in ("_arun", "_run"):
        orig = getattr(model, name, None)
        if orig is None:
            continue
        if inspect.iscoroutinefunction(orig):
            async def awrapped(*a, _orig=orig, **k):
                resp = await _orig(*a, **k)
                _add(resp)
                return resp
            setattr(model, name, awrapped)
        else:
            def wrapped(*a, _orig=orig, **k):
                resp = _orig(*a, **k)
                _add(resp)
                return resp
            setattr(model, name, wrapped)
    return usage


# --------------------------------------------------------------------------------------------------
def _read_profiles(csv_path: Path) -> list[dict]:
    """Return one dict per row, in row order (row index == user_id == OASIS agent_id by construction)."""
    with open(csv_path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def _snapshot_rec(db_path: Path, label: str) -> dict:
    """DIY exposure-over-time: the `rec` table is current-state only (overwritten each step)."""
    con = sqlite3.connect(db_path)
    try:
        rows = con.execute("SELECT user_id, post_id FROM rec").fetchall()
    except sqlite3.OperationalError:
        rows = []
    finally:
        con.close()
    return {"label": label, "exposures": [[u, p] for u, p in rows]}


def _boundary(db_path: Path, label: str) -> dict:
    """Monotonic id/rowid high-water marks after a step — lets the base env bucket each event into its
    step deterministically (id in (prev, cur]), sidestepping any ambiguity in OASIS's `created_at` clock."""
    con = sqlite3.connect(db_path)

    def mx(sql: str) -> int:
        try:
            return con.execute(sql).fetchone()[0] or 0
        except sqlite3.OperationalError:
            return 0

    b = {"label": label, "post": mx("SELECT MAX(post_id) FROM post"),
         "comment": mx("SELECT MAX(comment_id) FROM comment"),
         "like": mx("SELECT MAX(rowid) FROM like"), "follow": mx("SELECT MAX(rowid) FROM follow")}
    con.close()
    return b


async def run_cascade(cfg: dict) -> dict:
    from camel.models import ModelFactory
    from camel.types import ModelPlatformType

    import oasis
    from oasis import ActionType, LLMAction, ManualAction, generate_twitter_agent_graph
    from oasis.social_platform.channel import Channel
    from oasis.social_platform.platform import Platform
    from oasis.social_platform.typing import RecsysType

    csv_path = Path(cfg["profiles_csv"])
    db_path = Path(cfg["db_path"])
    n_steps = int(cfg["n_steps"])
    designed_edges = int(cfg["designed_edge_count"])
    rows = _read_profiles(csv_path)
    n = len(rows)
    # active_indices[step] = list of row indices asked to act at that step (the activation throttle).
    active_indices = cfg.get("active_indices") or [list(range(n)) for _ in range(n_steps)]
    seed_by_row = {int(k): v for k, v in cfg["seed_by_row"].items()}  # row index -> verbatim seed text

    if db_path.exists():
        db_path.unlink()

    api_key = os.environ[cfg.get("key_env", "DEEPSEEK_API_KEY")]
    model = ModelFactory.create(
        model_platform=getattr(ModelPlatformType, cfg.get("model_platform", "DEEPSEEK")),
        model_type=cfg.get("model_type", "deepseek-chat"),
        api_key=api_key, url=cfg.get("model_url", "https://api.deepseek.com/v1"),
        model_config_dict={"temperature": cfg.get("temperature", 0.6)})
    usage = _meter(model)

    available = [ActionType.CREATE_POST, ActionType.LIKE_POST, ActionType.REPOST,
                 ActionType.CREATE_COMMENT, ActionType.FOLLOW, ActionType.DO_NOTHING]
    graph = await generate_twitter_agent_graph(str(csv_path), model=model, available_actions=available)

    # Wire follow edges from the CSV `following_agentid_list` (add_edge — nodes-only otherwise) and ASSERT.
    wired = 0
    for i, row in enumerate(rows):
        for j in json.loads(row["following_agentid_list"] or "[]"):
            graph.add_edge(i, int(j))
            wired += 1
    loaded = graph.get_num_edges()
    print(f"[cascade {cfg['cascade_id']}] graph: {graph.get_num_nodes()} nodes, {loaded} edges "
          f"(wired {wired}, designed {designed_edges})", flush=True)
    assert loaded == designed_edges, (
        f"EDGE-COUNT ASSERT FAILED: loaded {loaded} != designed {designed_edges} "
        f"(zero-edge trap — exposure would be recsys-only). Refusing to run.")

    # Recommender = RecsysType.RANDOM. OASIS 0.2.5's other recsys functions assume DB formats THIS Platform
    # config doesn't produce, and they only crash once #posts > max_rec_post_len (case 2 — the spike's 10
    # posts stayed in case 1, so it never hit them): TWITTER's rec_sys_personalized_with_trace reads a trace
    # 'post_id' COLUMN this version lacks (post_id is inside trace.info) -> KeyError in get_trace_contents +
    # the swap branch; REDDIT's rec_sys_reddit calls datetime.strptime on created_at, which here is an INTEGER
    # step, not a datetime string -> TypeError. rec_sys_random needs only post_id: robust at any scale. It is
    # the DISCOVER channel (uniform surfacing); the graph-driven follow feed (following_post_count) — the
    # channel this phase is about — is independent of recsys_type. exposed_via still separates follow vs recsys.
    platform = Platform(db_path=str(db_path), channel=Channel(), recsys_type=RecsysType.RANDOM,
                        refresh_rec_post_count=8, max_rec_post_len=20, following_post_count=8)
    env = oasis.make(agent_graph=graph, platform=platform, database_path=str(db_path))
    await env.reset()

    all_agents = env.agent_graph.get_agents()  # list[(agent_id, SocialAgent)] — agent_id == row index
    agent_by_id = {aid: ag for aid, ag in all_agents}

    # Round-0: EVERY node posts its own verbatim reaction (ManualAction = 0 LLM calls, no dedupe).
    print(f"[cascade {cfg['cascade_id']}] seeding {len(all_agents)} verbatim reactions …", flush=True)
    await env.step({agent_by_id[i]: ManualAction(action_type=ActionType.CREATE_POST,
                                                 action_args={"content": seed_by_row[i]})
                    for i in range(n) if i in agent_by_id})
    rec_snaps = [_snapshot_rec(db_path, "after_seed")]
    boundaries = [_boundary(db_path, "after_seed")]

    _assert_seed_roundtrip(db_path, seed_by_row, cfg["agent_id_by_row"], cfg["cascade_id"])

    for step in range(n_steps):
        active = [i for i in active_indices[step] if i in agent_by_id]
        print(f"[cascade {cfg['cascade_id']}] step {step + 1}/{n_steps} — {len(active)} active agents …", flush=True)
        await env.step({agent_by_id[i]: LLMAction() for i in active})
        rec_snaps.append(_snapshot_rec(db_path, f"step_{step + 1}"))
        boundaries.append(_boundary(db_path, f"step_{step + 1}"))

    await env.close()
    return _extract(db_path, cfg, rec_snaps, boundaries, usage, active_indices)


def _assert_seed_roundtrip(db_path: Path, seed_by_row: dict, agent_id_by_row: dict, cascade_id: str) -> None:
    """Read each round-0 post back and assert it equals the verbatim seed the config maps to that row.
    A free, TOTAL integrity check on CSV-write-order -> OASIS-ingestion -> row-indexing. Fail loudly."""
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    posts = [dict(r) for r in con.execute("SELECT user_id, content FROM post ORDER BY post_id").fetchall()]
    con.close()
    by_uid: dict[int, str] = {}
    for p in posts:
        by_uid.setdefault(int(p["user_id"]), p["content"])  # first (seed) post per user
    for row, expected in seed_by_row.items():
        agent_id = agent_id_by_row[str(row)]
        got = by_uid.get(row)
        if got != expected:
            raise AssertionError(
                f"SEED ROUND-TRIP ASSERT FAILED (cascade {cascade_id}): row {row} (agentId {agent_id!r}) — "
                f"the map chain is broken. Refusing to step.\n  expected: {expected!r}\n  got:      {got!r}")
    print(f"[cascade {cascade_id}] seed round-trip OK — {len(seed_by_row)} posts byte-equal to config", flush=True)


def _extract(db_path: Path, cfg: dict, rec_snaps: list[dict], boundaries: list[dict], usage: dict,
             active_indices: list) -> dict:
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    q = lambda sql: [dict(r) for r in con.execute(sql).fetchall()]  # noqa: E731
    users = q("SELECT user_id, agent_id, user_name, name FROM user")
    posts = q("SELECT post_id, user_id, content, created_at, original_post_id, num_likes, num_shares "
              "FROM post ORDER BY post_id")
    comments = q("SELECT comment_id, post_id, user_id, content, created_at FROM comment ORDER BY comment_id")
    likes = q("SELECT rowid AS rowid, user_id, post_id, created_at FROM like ORDER BY rowid")
    follows = q("SELECT rowid AS rowid, follower_id, followee_id, created_at FROM follow ORDER BY rowid")
    trace = q("SELECT user_id, created_at, action, info FROM trace ORDER BY user_id, created_at")
    con.close()

    llm_calls = sum(len(a) for a in active_indices)  # agents asked to act across all steps
    return {
        "cascade_id": cfg["cascade_id"],
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "agent_id_by_row": cfg["agent_id_by_row"],  # echoed back — the ONLY authoritative row->agentId map
        "designed_edge_count": cfg["designed_edge_count"],
        "n_steps": cfg["n_steps"],
        "active_indices": active_indices,
        "tables": {"users": users, "posts": posts, "comments": comments, "likes": likes, "follows": follows,
                   "trace": trace},
        "rec_snapshots": rec_snaps,
        "step_boundaries": boundaries,
        "usage": {**usage, "llm_calls": llm_calls,
                  "estimated": usage["metered_calls"] == 0,
                  "est_in": llm_calls * BENCH_IN_PER_CALL if usage["metered_calls"] == 0 else usage["prompt_tokens"],
                  "est_out": llm_calls * BENCH_OUT_PER_CALL if usage["metered_calls"] == 0 else usage["completion_tokens"]},
    }


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("usage: oasis_cascade.py <config.json>")
    cfg = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    out_path = Path(cfg["out_path"])
    out_path.parent.mkdir(parents=True, exist_ok=True)
    result = asyncio.run(run_cascade(cfg))
    out_path.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"[cascade {cfg['cascade_id']}] raw output -> {out_path}", flush=True)
    print(f"OASIS_CASCADE_OUT={out_path}", flush=True)  # machine-readable line for the orchestrator


if __name__ == "__main__":
    main()
