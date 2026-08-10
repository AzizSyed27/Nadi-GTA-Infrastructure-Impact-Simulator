"""Phase 3.2 — minimal localhost FastAPI backend for the interactive report agent.

GET  /api/report  → serves the latest report JSON (+ the served run id).
POST /api/chat {question} → LightRAG retrieval over the per-run index, then a GUARDED DeepSeek generation over
    the retrieved context. The chat agent gets NO exemption from the rules the report obeys: we reuse
    ``report.audit_prose`` on every answer (retry once, else a caveat-only fallback), and answer ONLY from the
    retrieved context, naming sources. Digit-free by design (numbers live in the report view).

Run from python/src:  uvicorn server:app --reload --port 8000
"""

from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys
import time
from typing import Literal
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

SRC = Path(__file__).resolve().parent
sys.path.insert(0, str(SRC))  # bare imports work regardless of cwd
import enrich_events  # noqa: E402
import interview  # noqa: E402
import llm_provider  # noqa: E402
import trajectory_io  # noqa: E402  (the pinned-run enrich guard)
import network_edit  # noqa: E402  (SUMO junctions + the new_road patch)
import report  # noqa: E402
import report_agent  # noqa: E402
import run_state  # noqa: E402

LATEST_REPORT = report.WEB_PUBLIC / "latest-report.json"
HARNESS = SRC / "scenario_harness.py"

# The chat CONSTITUTION = the report's four hard rules (reused verbatim) + chat-specific answer rules.
CHAT_CONSTITUTION = report._FRAMING + (
    "You are now answering a city planner's QUESTION about this specific run, in a chat. Extra rules:\n"
    "  A. Answer ONLY from the provided context (retrieved from this run's corpus). If the context does not "
    "contain the answer, say plainly: \"This run doesn't answer that.\" Never invent facts or numbers.\n"
    "  B. Where natural, name what you drew on (which stakeholder groups, scorecard rows, or voices).\n"
    "  C. If asked whether the change made things SAFER or more dangerous, the honest answer IS the caveat: the "
    "safety signal is a surrogate near-miss magnitude only, its direction is not established (not stable across "
    "seeds), and this preview does not predict crashes. Say that plainly; do NOT pick a direction.\n"
    "  D. If asked whether people SUPPORT or OPPOSE the change, or how many do, refuse the head-count: these are "
    "a stratified sample of anticipated voices, not a poll. Describe the texture of who welcomes it and who "
    "worries — never a tally.\n"
    "  E. Keep it to 2-4 plain sentences. Anticipation, never a verdict.\n\n"
)

THIN_FALLBACK = ("This run doesn't answer that. I can only speak to what this corridor run measured and the "
                 "anticipated reactions it produced — try asking about a specific stakeholder group, the "
                 "scorecard, the change itself, or the limitations.")
CAVEAT_FALLBACK = ("I can't answer that within the limits of this preview. This run reports surrogate near-miss "
                   "measures (not crashes), anticipated stakeholder reactions (not a vote), and a per-group "
                   "outcome distribution (not a verdict) — ask about any of those and I'll ground it in the run.")
NO_INDEX = ("The report index isn't loaded. Build it first: run `python python/src/report_agent.py` (after "
            "`report.py`), then restart this server.")

_STATE: dict = {"rag": None, "client": None, "run_id": None, "index_ts": None}


def _deepseek_client():
    """A DeepSeek client for the guarded answer — explicit (not PROVIDER-env dependent), reusing the preset.
    V2.3b fix: mirror get_client()'s v4/reasoner thinking-disable — without it V4 defaults thinking ON,
    `temperature` is a no-op and reasoning is billed as output (the CLAUDE.md DeepSeek convention)."""
    llm_provider._load_env()
    base_url, model, key_env, json_mode = llm_provider.PROVIDER_PRESETS["deepseek"]
    key = os.environ.get(key_env)
    if not key:
        raise RuntimeError(f"{key_env} is not set (put it in python/.env).")
    extra_body = None
    if any(tag in model.lower() for tag in ("v4", "reasoner")):
        extra_body = {"thinking": {"type": "disabled"}}
    return llm_provider.OpenAICompatAdapter(base_url=base_url, model=model, api_key=key,
                                            json_mode=json_mode, extra_body=extra_body, max_tokens=500)


def _interview_client():
    """Lazy per-process client for /api/interview — independent of the RAG index (interviews must work
    when no chat index is built, and under TestClient-without-lifespan). RuntimeError → HTTP 503."""
    if _STATE.get("interview_client") is None:
        _STATE["interview_client"] = _deepseek_client()
    return _STATE["interview_client"]


@asynccontextmanager
async def lifespan(app: FastAPI):
    idx = report_agent.newest_index()
    if idx is None:
        print(f"[server] NO INDEX FOUND under {report_agent.INDEX_ROOT} — /api/chat will ask you to build it.")
    else:
        wd, ts = idx
        run_id = f"multimodal-scenario-{ts}"
        # Cross-run guard: the loaded index must describe the SAME run the report view is showing.
        served = None
        try:
            served = json.loads(LATEST_REPORT.read_text(encoding="utf-8"))["run"]["scenario_run_id"]
        except Exception:  # noqa: BLE001 — report may not exist yet; not fatal
            pass
        if served and served != run_id:
            print(f"[server] WARNING: index run {run_id!r} != report run {served!r} — rebuild the index for "
                  f"the current report (python report_agent.py).")
        try:
            rag = report_agent.make_rag(wd)  # checks the embedding pin before loading the model
        except report_agent.EmbeddingPinMismatch as e:
            # Hard-stop, but LEGIBLE (both configs named) and without an ugly async traceback — mirror the
            # graceful no-index boot: refuse to serve, /api/chat will report why.
            print(f"[server] EMBEDDING PIN MISMATCH — refusing to serve: {e}")
        else:
            await rag.initialize_storages()
            _STATE.update(rag=rag, client=_deepseek_client(), run_id=run_id, index_ts=ts)
            print(f"[server] loaded index {ts} · serving run {run_id}")
    yield
    if _STATE["rag"] is not None:
        await _STATE["rag"].finalize_storages()


app = FastAPI(title="Nadi — report agent", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)


class ChatReq(BaseModel):
    question: str


class InterviewTurn(BaseModel):
    role: Literal["user", "agent"]
    text: str


class InterviewReq(BaseModel):
    """V2.3b — ask ONE persona a question. The client sends IDS, never facts: the grounding context is
    built server-side from the run's artifact. `transcript` is the client-held session history (ephemeral
    — nothing is stored server-side); the server caps it (interview.TRANSCRIPT_MAX_TURNS) and the honesty
    guard audits every answer regardless of what the transcript contains."""

    run_id: str
    agent_id: str  # vehicle_id ?? person_id ?? persona.id — the web/lib/viz.ts agentId convention
    # The record's agents[] index — REQUIRED to disambiguate sibling INFERRED voices (several share
    # one persona.id with distinct comments); optional on the wire so id-only callers still resolve.
    agent_index: int | None = None
    question: str
    transcript: list[InterviewTurn] = []


@app.get("/api/report")
async def get_report():
    if not LATEST_REPORT.is_file():
        return {"error": "no report yet — run report.py"}
    report_json = json.loads(LATEST_REPORT.read_text(encoding="utf-8"))
    return {"report": report_json, "run_id": _STATE["run_id"]}


def _build_context(chunks: list[dict], entities: list[dict], relations: list[dict]) -> str:
    parts = ["Retrieved from this run's corpus:"]
    for c in chunks[:10]:
        content = (c.get("content") or "").strip()
        if content:
            parts.append(f"- {content}")
    if entities:
        names = ", ".join(e.get("entity_name", "") for e in entities[:12] if e.get("entity_name"))
        if names:
            parts.append(f"Related entities: {names}.")
    return "\n".join(parts)


async def _guarded_answer(question: str, context: str, sources: list[str]) -> tuple[str, dict]:
    """Own DeepSeek generation over the retrieved context + the SAME audit the report uses. On an unfixable
    violation (or an LLM error) return the caveat-only fallback — a live request must not hard-crash."""
    client = _STATE["client"]
    system = CHAT_CONSTITUTION + report._json_instr(
        '{"text": "<2-4 plain sentences, grounded ONLY in the context, NO numbers>"}')
    src_line = "; ".join(sources)
    user = (f"{context}\n\nQUESTION: {question}\n\nAnswer in 2-4 plain sentences, grounded ONLY in the context "
            f"above. If the context doesn't contain the answer, say \"This run doesn't answer that.\" Use NO "
            f"numbers. You are drawing on: {src_line}.")
    try:
        obj = await report._call(client, system, user, report._TextWire)
    except Exception as e:  # noqa: BLE001
        return CAVEAT_FALLBACK, {"status": "error", "detail": str(e)[:140]}
    answer = obj["text"].strip()
    v1 = report.audit_prose(answer)
    if not v1:
        return answer, {"status": "clean", "violations": []}

    quoted = "; ".join(f'"{s}" (rule: {r})' for r, s in v1)
    retry = (user + "\n\nYOUR PREVIOUS ANSWER BROKE THE RULES — it contained: " + quoted + ". Rewrite it "
             "WITHOUT any of those: no digits, no safety direction, no vote/tally words, no crash/injury words.")
    try:
        obj = await report._call(client, system, retry, report._TextWire)
    except Exception as e:  # noqa: BLE001
        return CAVEAT_FALLBACK, {"status": "error", "detail": str(e)[:140]}
    answer2 = obj["text"].strip()
    v2 = report.audit_prose(answer2)
    caught = [{"rule": r, "sentence": s} for r, s in v1]
    if v2:
        return CAVEAT_FALLBACK, {"status": "failed", "violations": caught,
                                 "still_present": [{"rule": r, "sentence": s} for r, s in v2]}
    return answer2, {"status": "resolved_on_retry", "violations": caught}


@app.post("/api/chat")
async def chat(req: ChatReq):
    rag = _STATE["rag"]
    if rag is None:
        return {"answer": NO_INDEX, "sources": [], "run_id": None, "audit": {"status": "no_index"}}
    q = (req.question or "").strip()
    if not q:
        return {"answer": "Ask a question about this run.", "sources": [], "run_id": _STATE["run_id"],
                "audit": {"status": "empty"}}

    from lightrag import QueryParam
    data = await rag.aquery_data(q, param=QueryParam(mode="mix", top_k=24, chunk_top_k=10))
    dd = data.get("data", data) if isinstance(data, dict) else {}
    chunks = dd.get("chunks", []) or []
    entities = dd.get("entities", []) or []
    relations = dd.get("relationships", []) or []

    if not chunks and not entities:  # thin retrieval → don't even call the LLM
        return {"answer": THIN_FALLBACK, "sources": [], "run_id": _STATE["run_id"], "audit": {"status": "thin"}}

    handles: list[str] = []
    for c in chunks:
        fp = c.get("file_path")
        if fp and fp != "unknown_source" and fp not in handles:
            handles.append(fp)
    sources = [report_agent.friendly_source(h) for h in handles] or ["this run's corpus"]

    context = _build_context(chunks, entities, relations)
    answer, audit = await _guarded_answer(q, context, sources)
    return {"answer": answer, "sources": sources, "run_id": _STATE["run_id"], "audit": audit}


@app.post("/api/interview")
async def interview_endpoint(req: InterviewReq):
    """V2.3b — an in-character, honesty-guarded answer from ONE of a run's voices. EPHEMERAL: reads the
    artifact, writes nothing (no lock — this is a live read-only LLM call, deliberately outside the
    one-job subprocess lock). Guard failures are CONTENT (200 + audit status), matching /api/chat."""
    q = (req.question or "").strip()
    if not q:
        raise HTTPException(status_code=400, detail="ask a question")
    if len(q) > interview.QUESTION_MAX_CHARS:
        raise HTTPException(status_code=400,
                            detail=f"question too long (max {interview.QUESTION_MAX_CHARS} chars)")
    try:
        # to_thread: a cold calibrated artifact is a ~90 MB synchronous read+parse — keep it off the
        # event loop so the SSE enrich stream and status polls don't stall behind it (cached after).
        ctx = await asyncio.to_thread(interview.load_run_context, req.run_id)
    except interview.RunNotFound:
        raise HTTPException(status_code=404,
                            detail=f"no artifact for run {req.run_id!r} — run the simulation first")
    except interview.RunNotEnriched:
        raise HTTPException(status_code=409,
                            detail=f"run {req.run_id!r} has no voices yet — run the voices enrich first")
    agent = interview.find_agent(ctx, req.agent_id, req.agent_index)
    if agent is None:
        raise HTTPException(status_code=404, detail=f"no agent {req.agent_id!r} in run {req.run_id!r}")
    try:
        client = _interview_client()
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    text, audit = await interview.answer(client, ctx, agent, q,
                                         [t.model_dump() for t in req.transcript])
    return {"answer": text, "audit": audit, "grounding": agent.get("grounding", "sim"),
            "run_id": req.run_id, "agent_id": req.agent_id,
            "persona_label": (agent.get("persona") or {}).get("label", "")}


# ===================================================================================================
# Phase 5.1 — the EDIT / JOB-RUNNER API. SUMO + the enrich pipelines run as SUBPROCESSES (libsumo global
# state + torch/OASIS make in-process unsafe); a single in-process lock serializes ALL jobs (simulate + enrich).
# ===================================================================================================
_JUNCTIONS: dict = {"all": None}  # cache the (slow) 23MB net read across /api/junctions calls
_EDGES: dict = {"all": None}  # same, for /api/edges (the edit-an-edge palette)


class WindowReq(BaseModel):
    """V2.2a: an active window in sim-seconds (apply at start_s, revert at end_s). end>start is
    validated in simulate() -> a plain 400 (not a pydantic 422 the palette can't render)."""
    start_s: float
    end_s: float


class EffectReq(BaseModel):
    """V2.2b incident effect: a CAPACITY event (never a crash simulation) — blocked lanes and/or
    edge speed x factor, both for the window."""
    blocked: bool | None = None
    speed_factor: float | None = None


class SimChange(BaseModel):
    type: str = "new_road"  # new_road | speed_limit | bike_lane | lane_closure | road_closure | incident
    # new_road geometry
    from_junction: str | None = None
    to_junction: str | None = None
    lanes: int = 1
    speed_mps: float = 13.9
    bidirectional: bool = False
    # runtime-change fields (speed_limit / bike_lane / closures / incident)
    target_edge: str | None = None
    value_mps: float | None = None  # speed_limit new max (m/s)
    target_lane: int | None = None  # bike_lane lane index (default: curbside car lane)
    target_lanes: list[int] | None = None  # lane_closure / incident-blocked: CAR-lane indices (V2.2a/b)
    window: WindowReq | None = None  # V2.2a/b: windowed change (speed_limit / closures / incident)
    effect: EffectReq | None = None  # V2.2b incident only
    position_m: float | None = None  # V2.2b incident: accepted + stored; UNUSED this rung
    description: str | None = None


class SimulateReq(BaseModel):
    # exactly ONE of change / changes (V2.2d: `changes` is a composite scenario — the school-zone
    # flow posts N windowed speed_limit primitives + tags=["school_zone"]).
    change: SimChange | None = None
    changes: list[SimChange] | None = None
    tags: list[str] | None = None  # composite only (e.g. ["school_zone"])
    # V2.1b: which demand to simulate. Synthetic stays the default (fast edit-mode iterations) until the
    # calibrated run times are reviewed (the V2.1c gate). Calibrated needs demand_calibration.py full first.
    demand_profile: Literal["synthetic_demo", "calibrated_am_peak"] = "synthetic_demo"
    # V2.1c: day_one = today's route habits (minutes); settled = iterated assignment (substantially longer).
    assignment: Literal["day_one", "settled"] = "day_one"
    # V2.1d: 1 = single canonical seed (default); 3 = the V1 robustness ladder (42,43,44) — ~3x sim
    # wall-clock; combined with calibrated demand this is a batch-scale run (the form copy says so).
    n_seeds: Literal[1, 3] = 1


class EnrichReq(BaseModel):
    stage: str  # voices | report | discourse


def _run_subprocess_job(run_id: str, cmds: list[list[str]], label: str,
                        events_path: Path | None = None, labels: list[str] | None = None) -> None:
    """Run one or more subprocesses sequentially under the held lock; reconcile state; always release.

    V2.3a: enrich jobs pass ``events_path`` (+ per-cmd human ``labels``) — lifecycle events (cmd_start/
    cmd_end/job_done/job_failed) are appended here and NADI_ENRICH_EVENTS is exported so reactions.py
    streams per-voice events into the same file. Simulate passes neither (no events file → the stream
    endpoint 404s for simulate runs, correctly). The two writers are temporally disjoint: this process
    writes only between subprocess lifetimes."""
    # PIN DeepSeek for the LLM enrich steps (reactions/report/propagation) — else reactions.py defaults to
    # Gemini's tiny free tier (20 req/day) and enrich fails 429. setdefault respects an explicit PROVIDER.
    env = {**os.environ}
    env.setdefault("PROVIDER", "deepseek")
    if events_path is not None:
        env[enrich_events.ENV_VAR] = str(events_path)

    def _emit(event: str, **payload) -> None:
        if events_path is not None:
            enrich_events.emit(events_path, event, **payload)

    try:
        for i, cmd in enumerate(cmds):
            cmd_label = (labels[i] if labels and i < len(labels) else Path(cmd[1]).stem)
            _emit("cmd_start", i=i, n=len(cmds), label=cmd_label)
            proc = subprocess.run(cmd, cwd=str(SRC), capture_output=True, text=True, env=env)
            _emit("cmd_end", i=i, n=len(cmds), label=cmd_label, returncode=proc.returncode)
            if proc.returncode != 0:
                st = run_state.read(run_id)
                if not st or st.get("status") != "failed":
                    run_state.set_stage(run_id, "failed", f"{label} failed: {(proc.stderr or '')[-280:]}")
                _emit("job_failed", label=label, detail=(proc.stderr or "")[-280:])
                return
        st = run_state.read(run_id)  # the pipeline sets its own terminal "done"; enrich sets it here.
        if label != "simulate":
            run_state.set_stage(run_id, "done", f"{label} complete")
        _emit("job_done", label=label)
    finally:
        run_state.release()


@app.get("/api/junctions")
async def junctions(bbox: str | None = Query(None, description="minLon,minLat,maxLon,maxLat")):
    """Existing junction snap targets for the editor."""
    if _JUNCTIONS["all"] is None:
        _JUNCTIONS["all"] = network_edit.list_junctions(None)  # cache the full net read
    js = _JUNCTIONS["all"]
    if bbox:
        b = [float(x) for x in bbox.split(",")]
        js = [j for j in js if b[0] <= j["lon"] <= b[2] and b[1] <= j["lat"] <= b[3]]
    return {"junctions": js, "count": len(js)}


@app.get("/api/edges")
async def edges():
    """V2.0b: edit-palette ELIGIBILITY METADATA only — {id, car_lane_count, eligible_bike_lane,
    eligibility_reason} for every normal edge. Geometry moved to web/public/network.json (network_export.py); the
    frontend renders that and joins this by id. No bbox: the metadata map is small and keyed by id, not geometry."""
    if _EDGES["all"] is None:
        _EDGES["all"] = network_edit.list_edges(None)  # cache the full net read (also feeds simulate validation)
    es = [{k: e[k] for k in network_edit.ELIGIBILITY_KEYS} for e in _EDGES["all"]]
    return {"edges": es, "count": len(es)}


def _edges_by_id() -> dict:
    """Edge id -> record from the cached /api/edges list (for existence + bike-eligibility validation)."""
    if _EDGES["all"] is None:
        _EDGES["all"] = network_edit.list_edges(None)
    return {e["id"]: e for e in _EDGES["all"]}


def _build_harness_cmd(ch: SimChange, ts: str, desc: str, demand_profile: str = "synthetic_demo",
                       assignment: str = "day_one", n_seeds: int = 1) -> list[str]:
    """PURE scenario_harness command construction (no validation / no IO) so it's unit-testable. Uses the
    ``--target-edge=<id>`` (=form) because SUMO edge ids can start with '-' (reverse edges), which argparse would
    otherwise read as an option — the reverse-edge bug this helper's test guards against. V2.1b/c/d: the
    ``--demand-profile``/``--assignment``/``--n-seeds`` flags are appended ONLY for non-defaults (the default
    cmd stays byte-stable)."""
    base = [sys.executable, str(HARNESS), "--change-type", ch.type, "--run-ts", ts]
    if demand_profile != "synthetic_demo":
        base += ["--demand-profile", demand_profile]
    if assignment != "day_one":
        base += ["--assignment", assignment]
    if n_seeds != 1:
        base += ["--n-seeds", str(n_seeds)]
    if ch.type == "new_road":
        cmd = base + ["--from-junction", ch.from_junction, "--to-junction", ch.to_junction,
                      "--lanes", str(ch.lanes), "--speed-mps", str(ch.speed_mps), "--description", desc]
        if ch.bidirectional:
            cmd.append("--bidirectional")
    elif ch.type == "speed_limit":
        cmd = base + [f"--target-edge={ch.target_edge}", "--speed-mps", str(ch.value_mps), "--description", desc]
    elif ch.type == "bike_lane":
        cmd = base + [f"--target-edge={ch.target_edge}", "--description", desc]
        if ch.target_lane is not None:
            cmd += ["--target-lane", str(ch.target_lane)]
    elif ch.type in ("lane_closure", "road_closure"):
        cmd = base + [f"--target-edge={ch.target_edge}", "--description", desc]
        if ch.type == "lane_closure":
            cmd += ["--target-lanes", ",".join(str(i) for i in ch.target_lanes)]
    elif ch.type == "incident":
        cmd = base + [f"--target-edge={ch.target_edge}", "--description", desc]
        if ch.target_lanes:
            cmd += ["--target-lanes", ",".join(str(i) for i in ch.target_lanes)]
        if ch.effect is not None and ch.effect.blocked:
            cmd.append("--blocked")
        if ch.effect is not None and ch.effect.speed_factor is not None:
            cmd += ["--speed-factor", str(ch.effect.speed_factor)]
        if ch.position_m is not None:
            cmd += ["--position-m", str(ch.position_m)]
    else:
        raise ValueError(f"unsupported change type {ch.type!r}")
    # single source with the window-sanity gate — an incident window must never be silently dropped
    import change_scheduler
    if ch.window is not None and ch.type in change_scheduler.WINDOWABLE_TYPES:
        cmd += ["--window-start", str(ch.window.start_s), "--window-end", str(ch.window.end_s)]
    return cmd


def _build_composite_cmd(spec_path: Path, ts: str, demand_profile: str = "synthetic_demo",
                         assignment: str = "day_one", n_seeds: int = 1) -> list[str]:
    """V2.2d composite handoff: the member list rides a SPEC FILE under contract/runs/state/ (runtime
    run-state emission, the established convention) — the single-change CLI stays byte-untouched.
    Non-default flags appended only when non-default, like _build_harness_cmd."""
    cmd = [sys.executable, str(HARNESS), "--composite", str(spec_path), "--run-ts", ts]
    if demand_profile != "synthetic_demo":
        cmd += ["--demand-profile", demand_profile]
    if assignment != "day_one":
        cmd += ["--assignment", assignment]
    if n_seeds != 1:
        cmd += ["--n-seeds", str(n_seeds)]
    return cmd


async def _simulate_composite(req: SimulateReq, bg: BackgroundTasks):
    """V2.2d/V2.4b — the composite POST path: per-member validation over the four WINDOWABLE
    member types (shared reason strings, `change {i}: ` prefixed), server-filled member
    descriptions (Change.description is contract-required), a spec-file handoff, and run-state
    that carries changes + tags for the RunCard. Settled composites stay rejected wholesale."""
    import change_scheduler
    from demand_profiles import fmt_window

    if not req.changes:
        raise HTTPException(400, "changes must be a non-empty list")
    if req.assignment == "settled":
        raise HTTPException(400, change_scheduler.REASON_COMPOSITE_SETTLED)
    edges = _edges_by_id()
    members: list[dict] = []
    for i, ch in enumerate(req.changes):
        # V2.4b: composite members are exactly the WINDOWABLE runtime types; bike_lane and
        # new_road stay single-change scenarios (the single-source reason names why).
        if ch.type not in change_scheduler.WINDOWABLE_TYPES:
            raise HTTPException(400, f"change {i}: {change_scheduler.REASON_COMPOSITE_MEMBER}")
        if not ch.target_edge:
            raise HTTPException(400, f"change {i}: {ch.type} requires target_edge")
        if ch.target_edge not in edges:
            raise HTTPException(400, f"change {i}: edge {ch.target_edge!r} is not in the network")
        edge = edges[ch.target_edge]
        if ch.type == "speed_limit":
            if not ch.value_mps:
                raise HTTPException(400, f"change {i}: speed_limit requires target_edge and value_mps")
            base_desc = f"Reduced max speed on edge {ch.target_edge} to {ch.value_mps * 3.6:.0f} km/h"
        elif ch.type == "lane_closure":
            reason = change_scheduler.validate_target_lanes(ch.target_lanes, edge["car_lane_indices"],
                                                            ch.target_edge)
            if reason is not None:
                raise HTTPException(400, f"change {i}: {reason}")
            base_desc = (f"Closed {len(ch.target_lanes)} of {len(edge['car_lane_indices'])} car lanes "
                         f"on edge {ch.target_edge}")
        elif ch.type == "road_closure":
            base_desc = f"Closed edge {ch.target_edge} (all lanes)"
        else:  # incident
            if ch.window is None:
                raise HTTPException(400, f"change {i}: incident requires a window (a temporary event; "
                                         "start_s/end_s in sim-seconds)")
            blocked = ch.effect.blocked if ch.effect else None
            speed_factor = ch.effect.speed_factor if ch.effect else None
            reason = change_scheduler.incident_rejection_reason(
                blocked, speed_factor, ch.target_lanes, edge["car_lane_indices"], ch.target_edge)
            if reason is not None:
                raise HTTPException(400, f"change {i}: {reason}")
            base_desc = change_scheduler.incident_base_desc(
                ch.target_lanes if blocked else None, speed_factor, ch.target_edge)
        if ch.window is not None and ch.window.end_s <= ch.window.start_s:
            raise HTTPException(400, f"change {i}: window.end_s ({ch.window.end_s:g}) must be > "
                                     f"window.start_s ({ch.window.start_s:g})")
        # (assignment_rejection_reason is deliberately NOT replicated per member: the settled 400
        # above precedes this loop, so every composite is day_one by the time members validate.)
        desc = ch.description or (
            base_desc + (f" {fmt_window(ch.window, req.demand_profile)}" if ch.window is not None else ""))
        # Serialize by per-type ALLOWLIST — SimChange carries non-None new_road DEFAULTS
        # (lanes=1 / speed_mps=13.9 / bidirectional=False) that a model_dump(exclude_none=True)
        # would leak into every member; the spec must carry each member's defining fields only.
        m: dict = {"type": ch.type, "target_edge": ch.target_edge}
        if ch.type == "speed_limit":
            m["value_mps"] = ch.value_mps
        if ch.type == "lane_closure" or (ch.type == "incident" and ch.target_lanes):
            m["target_lanes"] = ch.target_lanes
        if ch.type == "incident":
            m["effect"] = {k: v for k, v in
                           {"blocked": ch.effect.blocked, "speed_factor": ch.effect.speed_factor}.items()
                           if v is not None}
            if ch.position_m is not None:
                m["position_m"] = ch.position_m
        if ch.window is not None:
            m["window"] = {"start_s": ch.window.start_s, "end_s": ch.window.end_s}
        m["description"] = desc
        members.append(m)

    # same-edge members must be LIFO-revertible (disjoint or nested windows) — reject HERE, not as
    # a raw scheduler ValueError mid-SUMO-run (review-caught; same pure rule the scheduler enforces).
    from contract_models import Change as _Change
    reason = change_scheduler.lifo_conflict_reason([_Change.model_validate(m) for m in members])
    if reason is not None:
        raise HTTPException(400, reason)

    if req.demand_profile != "synthetic_demo":
        import demand_profiles
        try:
            demand_profiles.get_profile(req.demand_profile)
        except (KeyError, FileNotFoundError) as e:
            raise HTTPException(400, str(e)) from e

    # the run description: the school-zone flow gets its own mechanical label; other composites a count
    n = len(members)
    speeds = {m["value_mps"] for m in members if m["type"] == "speed_limit"}
    windows = [m["window"] for m in members if m.get("window")]
    span_txt = ""
    if windows:
        span = {"start_s": min(w["start_s"] for w in windows), "end_s": max(w["end_s"] for w in windows)}
        span_txt = f", {fmt_window(span, req.demand_profile)}"
    all_speed = all(m["type"] == "speed_limit" for m in members)
    if req.tags and "school_zone" in req.tags and all_speed and len(speeds) == 1:
        desc = f"School zone: {next(iter(speeds)) * 3.6:.0f} km/h on {n} street{'s' if n != 1 else ''}{span_txt}"
    elif all_speed:
        desc = f"{n} speed-limit changes on the corridor{span_txt}"
    else:
        desc = f"{n} changes on the corridor{span_txt}"  # V2.4b mixed members (matches the report title convention)

    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_id = f"multimodal-scenario-{ts}"
    spec_path = run_state.STATE_DIR / f"{run_id}.composite.json"
    cmd = _build_composite_cmd(spec_path, ts, demand_profile=req.demand_profile,
                               assignment=req.assignment, n_seeds=req.n_seeds)
    if not run_state.try_acquire(run_id):
        raise HTTPException(409, f"a job is already running ({run_state.active()}); one job at a time")
    run_state.STATE_DIR.mkdir(parents=True, exist_ok=True)
    spec_path.write_text(json.dumps(
        {"changes": members, **({"tags": req.tags} if req.tags else {})}, indent=2), encoding="utf-8")
    run_state.set_stage(run_id, "queued", "queued", description=desc,
                        change=members[0], changes=members,
                        **({"tags": req.tags} if req.tags else {}),
                        demand_profile=req.demand_profile, assignment=req.assignment,
                        n_seeds=req.n_seeds)
    bg.add_task(_run_subprocess_job, run_id, [cmd], "simulate")
    return {"run_id": run_id}


@app.post("/api/simulate")
async def simulate(req: SimulateReq, bg: BackgroundTasks):
    """Validate an edit (new_road | speed_limit | bike_lane | closures | incident | a V2.2d composite),
    mint a run id, and launch the quant pipeline as a background subprocess. bike_lane is rejected 400
    with the SINGLE-SOURCE eligibility reason if ineligible."""
    if req.change is not None and req.changes is not None:
        raise HTTPException(400, "provide change or changes, not both")
    if req.changes is not None:
        return await _simulate_composite(req, bg)
    if req.change is None:
        raise HTTPException(400, "provide change or changes")
    ch = req.change
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_id = f"multimodal-scenario-{ts}"

    if ch.type == "new_road":
        if not (ch.from_junction and ch.to_junction and ch.lanes and ch.speed_mps):
            raise HTTPException(400, "new_road requires from_junction, to_junction, lanes, speed_mps")
        desc = ch.description or f"New road {ch.from_junction}->{ch.to_junction}"
    elif ch.type == "speed_limit":
        if not (ch.target_edge and ch.value_mps):
            raise HTTPException(400, "speed_limit requires target_edge and value_mps")
        if ch.target_edge not in _edges_by_id():
            raise HTTPException(400, f"edge {ch.target_edge!r} is not in the network")
        desc = ch.description or f"Speed limit on {ch.target_edge} -> {ch.value_mps} m/s"
    elif ch.type == "bike_lane":
        if not ch.target_edge:
            raise HTTPException(400, "bike_lane requires target_edge")
        edge = _edges_by_id().get(ch.target_edge)
        if edge is None:
            raise HTTPException(400, f"edge {ch.target_edge!r} is not in the network")
        if not edge["eligible_bike_lane"]:
            raise HTTPException(400, edge["eligibility_reason"])  # the backend's own words, verbatim
        desc = ch.description or f"Bike lane on {ch.target_edge}"
    elif ch.type in ("lane_closure", "road_closure"):
        # V2.2a — closures (windowable). Same validators + reason strings as the harness (single source).
        import change_scheduler
        from demand_profiles import fmt_window

        if not ch.target_edge:
            raise HTTPException(400, f"{ch.type} requires target_edge")
        edge = _edges_by_id().get(ch.target_edge)
        if edge is None:
            raise HTTPException(400, f"edge {ch.target_edge!r} is not in the network")
        if ch.type == "lane_closure":
            reason = change_scheduler.validate_target_lanes(ch.target_lanes, edge["car_lane_indices"],
                                                            ch.target_edge)
            if reason is not None:
                raise HTTPException(400, reason)
            closes_all = set(edge["car_lane_indices"]) <= set(ch.target_lanes)
            base_desc = f"Closed {len(ch.target_lanes)} of {len(edge['car_lane_indices'])} car lanes on edge {ch.target_edge}"
        else:
            closes_all = True
            base_desc = f"Closed edge {ch.target_edge} (all lanes)"
        window_txt = f" {fmt_window(ch.window, req.demand_profile)}" if ch.window is not None else ""
        desc = ch.description or (base_desc + window_txt)
    elif ch.type == "incident":
        # V2.2b — a windowed CAPACITY event. Same validators + reason strings as the harness.
        import change_scheduler
        from demand_profiles import fmt_window

        if not ch.target_edge:
            raise HTTPException(400, "incident requires target_edge")
        edge = _edges_by_id().get(ch.target_edge)
        if edge is None:
            raise HTTPException(400, f"edge {ch.target_edge!r} is not in the network")
        if ch.window is None:
            raise HTTPException(400, "incident requires a window (a temporary event; start_s/end_s in sim-seconds)")
        blocked = ch.effect.blocked if ch.effect else None
        speed_factor = ch.effect.speed_factor if ch.effect else None
        reason = change_scheduler.incident_rejection_reason(
            blocked, speed_factor, ch.target_lanes, edge["car_lane_indices"], ch.target_edge)
        if reason is not None:
            raise HTTPException(400, reason)
        closes_all = bool(blocked) and set(edge["car_lane_indices"]) <= set(ch.target_lanes or [])
        desc = ch.description or (
            change_scheduler.incident_base_desc(ch.target_lanes if blocked else None,
                                                speed_factor, ch.target_edge)
            + f" {fmt_window(ch.window, req.demand_profile)}")
    else:
        raise HTTPException(400, f"unsupported change type {ch.type!r} (new_road | speed_limit | bike_lane | "
                                 "lane_closure | road_closure | incident)")

    # V2.2a/b — window sanity + the D1/severing rejection matrix (assignment lives on the request,
    # so this runs AFTER the per-type block; the reason strings are shared verbatim with the harness).
    import change_scheduler
    if ch.window is not None:
        if ch.type not in change_scheduler.WINDOWABLE_TYPES:
            raise HTTPException(400, f"a window is not supported on change type {ch.type!r}")
        if ch.window.end_s <= ch.window.start_s:
            raise HTTPException(400, f"window.end_s ({ch.window.end_s:g}) must be > window.start_s ({ch.window.start_s:g})")
    reason = change_scheduler.assignment_rejection_reason(
        req.assignment, ch.type,
        ch.window is not None,
        closes_all if ch.type in ("lane_closure", "road_closure", "incident") else False)
    if reason is not None:
        raise HTTPException(400, reason)

    if req.demand_profile != "synthetic_demo":  # V2.1b: calibrated demand must be BUILT before it can run
        import demand_profiles
        try:
            demand_profiles.get_profile(req.demand_profile)
        except (KeyError, FileNotFoundError) as e:
            raise HTTPException(400, str(e)) from e

    cmd = _build_harness_cmd(ch, ts, desc, demand_profile=req.demand_profile, assignment=req.assignment,
                             n_seeds=req.n_seeds)
    if not run_state.try_acquire(run_id):  # synchronous, race-free reject-if-active
        raise HTTPException(409, f"a job is already running ({run_state.active()}); one job at a time")
    run_state.set_stage(run_id, "queued", "queued", description=desc, change=ch.model_dump(exclude_none=True),
                        demand_profile=req.demand_profile, assignment=req.assignment,
                        n_seeds=req.n_seeds)
    bg.add_task(_run_subprocess_job, run_id, [cmd], "simulate")
    return {"run_id": run_id}


@app.get("/api/runs")
async def runs():
    out = []
    for s in run_state.list_all():
        # V2.4c: the user name merges from the identity SIDECAR here (list_all stays identity-free
        # so state consumers never see workspace metadata); present only when set.
        ident = run_state.identity(s["run_id"])
        out.append({"id": s["run_id"], "description": s.get("description", ""), "status": s.get("status"),
                    "stage": s.get("stage"), "started_at": s.get("started_at"),
                    **({"name": ident["name"]} if ident.get("name") else {})})
    return {"runs": out}


def _enrich_progress(run_id: str) -> dict | None:
    """V2.3a — derive {done, total, label} from the run's events file for the POLL degrade path.

    READ-ONLY derivation in the GET handler: the run-state file is never written with progress (its
    ``set_stage`` is an unlocked read-merge-write — a second writer would race the server's own writes).
    The events file is a few hundred KB at most; parsing it per 1.5 s poll is cheap."""
    path = enrich_events.events_path(run_id)
    events, _ = enrich_events.read_from(path, 0)
    if not events:
        return None
    out: dict = {}
    for _, ev in events:
        kind = ev.get("event")
        if kind == "voices_total":
            out["total"] = ev.get("total")
        elif kind == "voice":
            out["done"] = ev.get("done")
            out["total"] = ev.get("total")
        elif kind == "cmd_start":
            out["label"] = ev.get("label")
    return out or None


@app.get("/api/runs/{run_id}/status")
async def run_status(run_id: str):
    st = run_state.read(run_id)
    if st is None:
        raise HTTPException(404, f"no such run {run_id!r}")
    if str(st.get("stage", "")).startswith("enrich:"):
        prog = _enrich_progress(run_id)
        if prog:
            st["enrich_progress"] = prog
    st.update(run_state.identity(run_id))  # V2.4c: name/note merge (keys can't collide with state)
    return st


class IdentityReq(BaseModel):
    """V2.4c — user name/note for a run. FULL-REPLACE semantics: the UI sends both fields on
    every save; empty/omitted clears."""
    name: str | None = None
    note: str | None = None


@app.post("/api/runs/{run_id}/identity")
async def set_run_identity(run_id: str, req: IdentityReq):
    """V2.4c — write the run's identity SIDECAR (contract/runs/state/<id>.identity.json — never
    the artifact or the state file; run-ids stay canonical in APIs/sidecars/reports). No job lock:
    identity is not a job, and the sidecar's single-writer design makes it race-free. The server
    caps are the ENFORCEMENT (client maxLength is convenience); markup is stored VERBATIM — inert
    RENDERING is the single deliberate defense layer (web-spec-pinned end to end)."""
    # the pinned guard FIRST (the enrich precedent: after the 404 it would be dead code)
    if trajectory_io.pinned_identity_blocked(run_id):
        raise HTTPException(403, trajectory_io.PINNED_IDENTITY_REASON)
    if run_state.read(run_id) is None:
        raise HTTPException(404, f"no such run {run_id!r}")
    name = (req.name or "").strip()
    note = (req.note or "").strip()
    if len(name) > 60:
        raise HTTPException(400, f"name too long ({len(name)} > 60 chars)")
    if len(note) > 500:
        raise HTTPException(400, f"note too long ({len(note)} > 500 chars)")
    return run_state.set_identity(run_id, name, note)


# Human labels for the enrich sub-commands — these ride cmd_start events and render live in the UI
# ("writing the report…"). Coarse per-cmd progress is D3's whole ask for report/discourse.
_ENRICH_LABELS = {
    "voices": ["sampling travelers", "generating voices"],
    "report": ["writing the report", "rebuilding the chat index"],
    "discourse": ["running the discourse cascades"],
}


@app.post("/api/runs/{run_id}/enrich")
async def enrich(run_id: str, req: EnrichReq, bg: BackgroundTasks):
    """Launch an existing enrich pipeline (voices | report | discourse) against a completed run."""
    # V2.3c closeout — the STRUCTURAL pinned-run guard, FIRST (it must precede the no-state 404
    # below or it's dead code): voices/discourse rewrite the artifact; report never does and stays
    # allowed (the documented singleton-maintenance path). 403 is unused elsewhere in this handler —
    # a distinct signal. The CLIs carry the same guard (trajectory_io.guard_pinned_enrich).
    if req.stage in ("voices", "discourse") and trajectory_io.pinned_enrich_blocked(run_id):
        raise HTTPException(403, trajectory_io.PINNED_REASON)
    st = run_state.read(run_id)
    if st is None:
        raise HTTPException(404, f"no such run {run_id!r}")
    ts = run_id.replace("multimodal-scenario-", "")
    py = sys.executable
    if req.stage == "voices":
        cmds = [[py, str(SRC / "sampler.py"), "--outcomes", str(run_state.RUNS_DIR / f"outcomes-{ts}.json")],
                [py, str(SRC / "reactions.py"), "--instrumented", str(run_state.RUNS_DIR / f"instrumented-{ts}.json")]]
    elif req.stage == "report":
        cmds = [[py, str(SRC / "report.py"), "--run-id", run_id],
                [py, str(SRC / "report_agent.py"), "--run-id", run_id, "--rebuild"]]
    elif req.stage == "discourse":
        cmds = [[py, str(SRC / "propagation.py"), "--run-id", run_id, "--cascades", "3"]]
    else:
        raise HTTPException(400, f"unknown enrich stage {req.stage!r} (voices|report|discourse)")
    if not run_state.try_acquire(run_id):
        raise HTTPException(409, f"a job is already running ({run_state.active()}); one job at a time")
    run_state.set_stage(run_id, f"enrich:{req.stage}", f"running {req.stage}")
    # V2.3a INVARIANT — POST-time ordering: truncate → emit job_start → launch. All three run
    # synchronously HERE (BackgroundTasks fire after the response), under the held lock, BEFORE the
    # subprocess exists, so: (a) the client's stream GET never 404s in the postEnrich→EventSource gap;
    # (b) job_start is structurally LINE 0 of every fresh file — clients reset their Last-Event-ID
    # dedup on job_start, and a stale id past EOF replays from 0, which only recovers because of this.
    labels = _ENRICH_LABELS[req.stage]
    ev = enrich_events.events_path(run_id)
    enrich_events.prune()  # prune's one call site: cheap, bounded, and we're already touching the dir
    enrich_events.truncate(ev)
    enrich_events.emit(ev, "job_start", run_id=run_id, label=f"enrich:{req.stage}", stages=labels)
    bg.add_task(_run_subprocess_job, run_id, cmds, f"enrich:{req.stage}", ev, labels)
    return {"run_id": run_id, "stage": req.stage}


@app.get("/api/runs/{run_id}/enrich/stream")
async def enrich_stream(run_id: str, request: Request):
    """V2.3a — SSE over the run's enrich events file: replay from 0 (or Last-Event-ID), then tail.

    The ``id:`` of each frame is the file's absolute line number, so a dropped EventSource resumes via
    the native Last-Event-ID reconnect; a stale id past EOF (a new job truncated the file) replays from
    0 and the client's job_start reset handles the rest. Degrade path: no events file → 404 → the client
    falls back to the poll it never stopped running."""
    path = enrich_events.events_path(run_id)
    if not path.is_file():
        raise HTTPException(404, f"no enrich event stream for {run_id!r}")
    raw = request.headers.get("last-event-id", "")
    resume_after = int(raw) if raw.isdigit() else -1

    async def gen():
        offset = 0
        start = resume_after + 1
        _, eof = enrich_events.read_from(path, 0)
        if start > eof:  # stale Last-Event-ID from a previous job's longer file → replay from 0
            start = 0
        last_beat = time.monotonic()
        while True:
            events, offset = enrich_events.read_from(path, offset)
            for lineno, ev in events:
                if lineno < start:
                    continue
                yield f"id: {lineno}\nevent: {ev.get('event', 'message')}\ndata: {json.dumps(ev)}\n\n"
                last_beat = time.monotonic()
                if ev.get("event") in enrich_events.TERMINAL:
                    return
            if await request.is_disconnected():
                return
            # ORPHAN GUARD: the job died without a terminal event (server restart / killed subprocess).
            # run_state.read already coerces stale "running" to failed; without this, the stream would
            # heartbeat a dead job forever.
            st = run_state.read(run_id)
            if st and st.get("status") in ("done", "failed") and run_state.active() != run_id:
                synthetic = {"event": "job_done" if st["status"] == "done" else "job_failed",
                             "ts": time.time(), "synthetic": True, "detail": st.get("detail", "")}
                yield f"id: {offset}\nevent: {synthetic['event']}\ndata: {json.dumps(synthetic)}\n\n"
                return
            if time.monotonic() - last_beat > 15:
                yield ": ping\n\n"
                last_beat = time.monotonic()
            await asyncio.sleep(0.25)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
