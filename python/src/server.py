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
import run_events  # noqa: E402
import run_ledger  # noqa: E402
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
        served = report.served_report_run_id(LATEST_REPORT)  # V2.7a C5: the pointer (None when absent)
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


class GroupTurn(BaseModel):
    """V2.6a — one SHARED-room transcript turn. Agent turns carry the V2.3b id+index ref so the
    server can attribute the utterance ('<label> said:') and detect self ('You said:'); an
    unresolvable ref degrades to 'Another participant said:' — never a 400 (the agent set may have
    drifted under a re-enrich; the honesty guard is the floor for the content either way)."""

    role: Literal["user", "agent"]
    text: str
    agent_id: str | None = None
    agent_index: int | None = None


class GroupAgentRef(BaseModel):
    agent_id: str  # vehicle_id ?? person_id ?? persona.id — the web/lib/viz.ts agentId convention
    agent_index: int | None = None  # sibling disambiguation (the V2.3b lesson)


class GroupInterviewReq(BaseModel):
    """V2.6a — one question to a ROOM of 3-5 voices. Like the single interview, the client sends
    IDS, never facts: each speaker's grounding is built server-side from its OWN records only."""

    run_id: str
    agent_refs: list[GroupAgentRef]  # 3..5, validated in the handler (plain 400s, not 422s)
    question: str
    transcript: list[GroupTurn] = []
    # V2.6b — when set, generate ONLY participants[speak] (the room drawer's sequential fetch
    # loop; each answer renders as its fetch resolves). The FULL room still validates (count,
    # resolution, duplicates). The transcript is used AS SENT as conversational context ONLY —
    # attribution comes from refs resolution and grounding from the artifact, so a doctored
    # prefix reaches neither (fold-in A, test-pinned).
    speak: int | None = None


@app.get("/api/report")
async def get_report():
    # V2.7a C5: resolve the POINTER → that run's stored report, and return the REPORT's OWN run
    # id (the old wrapper returned the chat index's — wrong exactly when misaligned).
    served = report.served_report_run_id(LATEST_REPORT)
    if not served:
        return {"error": "no report yet — run report.py"}
    ts = served.replace("multimodal-scenario-", "")
    path = report.RUNS_DIR / f"report-{ts}.json"
    if not path.is_file():
        return {"error": f"the latest-report pointer names {served} but {path.name} is missing — "
                         f"regenerate with report.py --run-id {served}"}
    report_json = json.loads(path.read_text(encoding="utf-8"))
    rid = report_json.get("run_id") or (report_json.get("run") or {}).get("scenario_run_id")
    return {"report": report_json, "run_id": rid}


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


@app.post("/api/group-interview")
async def group_interview_endpoint(req: GroupInterviewReq):
    """V2.6a — one question to a ROOM of 3-5 of a run's voices, sequential in agent_refs order.
    Each speaker's grounding is built independently (interview.build_grounding UNCHANGED — the
    leakage matrix holds structurally); each answer is appended to the shared transcript before the
    next speaker generates, so cross-agent content flows ONLY through actual utterances. EPHEMERAL
    like /api/interview: reads the artifact, writes nothing, deliberately outside the one-job lock.
    Guard failures are CONTENT (200 + per-speaker audit); one refusal never aborts the room."""
    q = (req.question or "").strip()
    if not q:
        raise HTTPException(status_code=400, detail="ask a question")
    if len(q) > interview.QUESTION_MAX_CHARS:
        raise HTTPException(status_code=400,
                            detail=f"question too long (max {interview.QUESTION_MAX_CHARS} chars)")
    n = len(req.agent_refs)
    if not (interview.GROUP_MIN_AGENTS <= n <= interview.GROUP_MAX_AGENTS):
        raise HTTPException(
            status_code=400,
            detail=f"agent_refs must list {interview.GROUP_MIN_AGENTS}.."
                   f"{interview.GROUP_MAX_AGENTS} participants (got {n})")
    # V2.6b — structural check before any I/O; the 0 <= half is load-bearing (a bare `< n`
    # would let participants[-1] silently alias the last speaker).
    if req.speak is not None and not (0 <= req.speak < n):
        raise HTTPException(status_code=400,
                            detail=f"speak must be an agent_refs index 0..{n - 1} (got {req.speak})")
    try:
        ctx = await asyncio.to_thread(interview.load_run_context, req.run_id)
    except interview.RunNotFound:
        raise HTTPException(status_code=404,
                            detail=f"no artifact for run {req.run_id!r} — run the simulation first")
    except interview.RunNotEnriched:
        raise HTTPException(status_code=409,
                            detail=f"run {req.run_id!r} has no voices yet — run the voices enrich first")
    participants: list[tuple[GroupAgentRef, dict]] = []
    for i, ref in enumerate(req.agent_refs):
        a = interview.find_agent(ctx, ref.agent_id, ref.agent_index)
        if a is None:
            raise HTTPException(status_code=404,
                                detail=f"no agent {ref.agent_id!r} (agent_refs[{i}]) in run {req.run_id!r}")
        participants.append((ref, a))
    # Duplicates by RESOLVED record (object identity), never ref equality: ("veh0", None) and
    # ("veh0", 0) are one voice; two SIBLINGS sharing persona.id are two distinct voices.
    seen_records: set[int] = set()
    for i, (ref, a) in enumerate(participants):
        if id(a) in seen_records:
            raise HTTPException(status_code=400,
                                detail=f"agent_refs[{i}] ({ref.agent_id!r}) duplicates an earlier participant")
        seen_records.add(id(a))
    try:
        client = _interview_client()
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    working = [t.model_dump() for t in req.transcript]
    # speak = the drawer's per-speaker call: same room, same validation, ONE generation.
    speakers = participants if req.speak is None else [participants[req.speak]]
    answers = []
    for ref, agent in speakers:
        text, audit = await interview.room_answer(client, ctx, agent, q, working)
        answers.append({"answer": text, "audit": audit,
                        "grounding": agent.get("grounding", "sim"),
                        "agent_id": ref.agent_id, "agent_index": ref.agent_index,
                        "persona_label": (agent.get("persona") or {}).get("label", "")})
        working.append({"role": "agent", "text": text,
                        "agent_id": ref.agent_id, "agent_index": ref.agent_index})
    return {"run_id": req.run_id, "question": q, "answers": answers,
            "llm_calls": sum(a["audit"].get("calls", 0) for a in answers)}


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
    # V2.6d: 'lon,lat' coord-pair VIA WAYPOINTS (consumed capacity — see the recorded decision at
    # contract_models.Change.via). Must exist HERE or pydantic's extra-ignore silently drops it
    # and the POST validation is unreachable.
    via: list[str] | None = None
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


# V2.7b — the quant leg's human label (rides cmd_start; Act I renders its own beats over this).
_SIMULATE_LABELS = ["simulating both legs"]


def _begin_run_events(run_id: str, *, description: str, changes: list[dict],
                      demand_profile: str, assignment: str, n_seeds: int) -> Path:
    """THE one truncation point: start this run's events file with ``run_start`` as line 0.

    Called synchronously at both simulate POST sites (single-change and composite) under the held lock,
    before the subprocess exists — so a client that opens the stream immediately after the POST never
    404s, and line 0 is structurally the run header the client's fold seeds on. ``prune()`` rides here
    too: it is the one moment we are already touching the directory."""
    ev = run_events.events_path(run_id)
    run_events.prune()
    run_events.begin(ev, run_id, description=description, changes=changes,
                     demand_profile=demand_profile, assignment=assignment, n_seeds=n_seeds)
    run_events.emit(ev, "stage_start", stage="quant", label="simulating both legs", kind="quant",
                    stages=list(_SIMULATE_LABELS))
    return ev


def _job_env(events_path: Path | None) -> dict:
    # PIN DeepSeek for the LLM enrich steps (reactions/report/propagation) — else reactions.py defaults to
    # Gemini's tiny free tier (20 req/day) and enrich fails 429. setdefault respects an explicit PROVIDER.
    env = {**os.environ}
    env.setdefault("PROVIDER", "deepseek")
    if events_path is not None:
        env[run_events.ENV_VAR] = str(events_path)
    return env


def _run_cmds(run_id: str, cmds: list[list[str]], label: str, events_path: Path | None,
              labels: list[str] | None, *, mark_failed: bool = True) -> tuple[bool, str]:
    """Run subprocesses sequentially. Returns (ok, detail). NO lock release, NO terminal state write.

    V2.7b C6a — extracted so the CHAIN can run six stages under ONE acquire. A per-stage
    ``_run_subprocess_job`` would release the lock between stages, which opens a steal window, lets
    the SSE orphan guard inject a terminal mid-chain (it fires when the lock is free and the state is
    terminal), and writes five ``done`` edges that would each storm the client's artifact reload."""
    env = _job_env(events_path)

    def _emit(event: str, **payload) -> None:
        if events_path is not None:
            run_events.emit(events_path, event, **payload)

    for i, cmd in enumerate(cmds):
        cmd_label = (labels[i] if labels and i < len(labels) else Path(cmd[1]).stem)
        _emit("cmd_start", i=i, n=len(cmds), label=cmd_label)
        proc = subprocess.run(cmd, cwd=str(SRC), capture_output=True, text=True, env=env)
        _emit("cmd_end", i=i, n=len(cmds), label=cmd_label, returncode=proc.returncode)
        if proc.returncode != 0:
            detail = (proc.stderr or "")[-280:]
            st = run_state.read(run_id)
            # `mark_failed=False` is for steps whose failure is NOT the run's failure (the results
            # document): writing "failed" and correcting it a line later would flash a wrong state
            # at whatever polled in between.
            if mark_failed and (not st or st.get("status") != "failed"):
                run_state.set_stage(run_id, "failed", f"{label} failed: {detail}")
            _emit("stage_end", stage=label, status="failed", detail=detail)
            return False, detail
    _emit("stage_end", stage=label, status="done", detail="")
    return True, ""


def _absorb_usage(run_id: str, events_path: Path | None, offset: int) -> int:
    """Fold every ``stage_usage`` event written since ``offset`` into the ledger. Returns the new EOF.

    Each subprocess reports its own metered calls as it exits, keyed by the PRESENTED stage it
    produced — so the fold needs no mapping table and cannot drift from the chain's shape. A stage
    that honestly cannot count itself reports null, which `add_llm_calls` leaves as-is rather than
    turning into a zero."""
    if events_path is None:
        return offset
    try:
        events, eof = run_events.read_from(events_path, offset)
    except OSError:
        return offset
    for _lineno, ev in events:
        if ev.get("event") == "stage_usage" and ev.get("calls") is not None:
            run_ledger.add_llm_calls(run_id, str(ev.get("stage")), int(ev["calls"]))
    return eof


def _stage_was_partial(run_id: str, events_path: Path | None, offset: int) -> bool:
    """Did this stage stop mid-way, or did it happen to finish before the stop was noticed?

    The difference is what the screen says: "47 of 213 voices, kept" versus "213 voices". Read it
    off what the stage actually emitted — a voices stage that streamed fewer voices than it declared
    a total for is partial; anything else is a stage that simply finished first."""
    if events_path is None:
        return False
    try:
        events, _ = run_events.read_from(events_path, offset)
    except OSError:
        return False
    total: int | None = None
    done = 0
    for _lineno, ev in events:
        if ev.get("event") == "voices_total":
            total = ev.get("total")
        elif ev.get("event") == "voice":
            done = max(done, int(ev.get("done") or 0))
            total = ev.get("total", total)
    return total is not None and done < int(total)


def _events_eof(events_path: Path | None) -> int:
    if events_path is None:
        return 0
    try:
        _, eof = run_events.read_from(events_path, 0)
    except OSError:
        return 0
    return eof


def _run_subprocess_job(run_id: str, cmds: list[list[str]], label: str,
                        events_path: Path | None = None, labels: list[str] | None = None) -> None:
    """The SINGLE-SHOT job: one stage, its own terminal state, its own release.

    Used by POST /api/runs/<id>/enrich (the manual per-stage path, unchanged) and by a simulate whose
    auto-chain is off. The chain has its own runner below."""
    def _emit(event: str, **payload) -> None:
        if events_path is not None:
            run_events.emit(events_path, event, **payload)

    before = _events_eof(events_path)
    try:
        ok, detail = _run_cmds(run_id, cmds, label, events_path, labels)
        _absorb_usage(run_id, events_path, before)
        if not ok:
            _emit(run_events.RUN_ENDED, status="failed", detail=detail)
            return
        if label != "simulate":  # the quant pipeline writes its own terminal "done"; enrich sets it here
            run_state.set_stage(run_id, "done", f"{label} complete")
        _emit(run_events.RUN_ENDED, status="complete", detail="")
    finally:
        # COMPARE-AND-CLEAR (V2.7b): pass the owner id so a late unwind can never clear a LATER
        # job's claim. See run_state.release for the steal this closes.
        run_state.release(run_id)


# --------------------------------------------------------------------------------------------------
# V2.7b C6a — THE STAGE RUNNER. After the physics, the interpretation, automatically, in order.
# --------------------------------------------------------------------------------------------------

AUTO_ENRICH_ENV = "NADI_AUTO_ENRICH"


def auto_enrich_enabled() -> bool:
    """Is the interpretation chain armed? DEFAULT OFF until the brake exists.

    The chain spends a couple of hundred model calls per Run. Turning it on before there is a skip
    button and a cost line on screen would mean a window where pressing Run spends that with no way
    to stop it and no indication it is happening — so the flip rides the brake (V2.7b C10), not the
    capability. Afterwards this stays the operator's off switch."""
    return os.environ.get(AUTO_ENRICH_ENV, "0").strip().lower() not in ("", "0", "false", "no")


def _chain_steps(run_id: str) -> list[dict]:
    """The interpretation chain: PRESENTED stages mapped onto the subprocesses that produce them.

    They are not the same list and never will be. ``institutions`` has no subprocess of its own —
    reactions.py composes those voices deterministically in the same pass that generates the
    traveler ones — and ``personas``/``voices`` are two presented stages inside what used to be one
    enrich click. The UI shows the presented stages; a subprocess boundary is machinery."""
    ts = run_id.replace("multimodal-scenario-", "")
    py = sys.executable
    return [
        {"keys": ["personas"], "state": "enrich:voices", "label": "sampling travelers",
         "cmd": [py, str(SRC / "sampler.py"), "--outcomes",
                 str(run_state.RUNS_DIR / f"outcomes-{ts}.json")]},
        {"keys": ["voices", "institutions"], "state": "enrich:voices", "label": "generating voices",
         "cmd": [py, str(SRC / "reactions.py"), "--instrumented",
                 str(run_state.RUNS_DIR / f"instrumented-{ts}.json")]},
        {"keys": ["discourse"], "state": "enrich:discourse", "label": "running the discourse cascades",
         "cmd": [py, str(SRC / "propagation.py"), "--run-id", run_id, "--cascades", "3"]},
        {"keys": ["report"], "state": "enrich:report", "label": "writing the report",
         "cmd": [py, str(SRC / "report.py"), "--run-id", run_id]},
        {"keys": ["index"], "state": "enrich:index", "label": "building the chat index",
         "cmd": [py, str(SRC / "report_agent.py"), "--run-id", run_id, "--rebuild"]},
    ]


def _run_facts_only(run_id: str, events_path: Path | None) -> bool:
    """ACT I'S TAIL: the zero-LLM results document, written the moment the physics ends.

    This is what makes "the results are complete when the physics ends" true on screen rather than
    in principle — every figure, the scorecard and the caveats become readable while interpretation
    is still streaming, or after it was skipped, or after it failed. It runs on EVERY completed
    quant run, chain or no chain, because it is not interpretation: no model is called.

    SOFT-FAILS. A quant run that produced numbers is a good run; if the document cannot be assembled
    the run is still complete, and the Read stage already has a labeled state for a missing report."""
    ok, detail = _run_cmds(run_id, [[sys.executable, str(SRC / "report.py"), "--facts-only",
                                     "--run-id", run_id]],
                           "results", events_path, ["computing the results document"],
                           mark_failed=False)
    run_ledger.set_facts_report(run_id, run_ledger.DONE if ok else run_ledger.FAILED)
    if not ok:
        print(f"[chain] facts-only report failed for {run_id}: {detail}")
        run_state.set_stage(run_id, "done", "run complete (results document unavailable)")
    return ok


def _run_chain(run_id: str, events_path: Path, only: set[str] | None = None) -> None:
    """Run the interpretation stages, in order, writing the ledger and the run's terminal state.

    Shared by the auto-chain and by RESUME (which passes the stages its ledger says never ran), so
    the two can never drift into different definitions of what a stage is or what ending it writes.
    The CALLER owns the lock and releases it — this function assumes it is already held."""
    def _emit(event: str, **payload) -> None:
        run_events.emit(events_path, event, **payload)

    for step in _chain_steps(run_id):
        # RESUME runs only what never ran. A stage already marked done is stepped over rather than
        # re-run: re-running it would spend again for an output that already exists, and the copy
        # promises that resuming re-reads a sealed run rather than redoing it.
        if only is not None and not (set(step["keys"]) & only):
            continue
        # PROTECTED RUNS ARE RE-CHECKED BEFORE EVERY STAGE, not once at the top: the guard is
        # cheap, the set is small, and a stage that rewrites a landing-load-bearing artifact is
        # not something to protect only on the first iteration.
        if trajectory_io.pinned_enrich_blocked(run_id):
            reason = trajectory_io.enrich_refusal_reason(run_id)
            run_ledger.end(run_id, run_ledger.SKIPPED_END, reason=reason)
            _emit(run_events.RUN_ENDED, status="skipped", detail=reason)
            return
        for key in step["keys"]:
            run_ledger.set_stage(run_id, key, run_ledger.RUNNING)
        run_state.set_stage(run_id, step["state"], step["label"])
        _emit("stage_start", stage=step["state"], label=step["label"], kind="llm",
              stages=[step["label"]])
        before = _events_eof(events_path)
        ok, detail = _run_cmds(run_id, [step["cmd"]], step["state"], events_path, [step["label"]])
        _absorb_usage(run_id, events_path, before)
        # A SKIP looks like a successful stage that stopped early — the subprocess exits 0 having
        # written what it generated. `end()` then marks every stage that never ran as skipped, so
        # the screen can say "kept: … / never run: …" from the ledger alone.
        if run_events.cancelled(run_id):
            partial = ok and _stage_was_partial(run_id, events_path, before)
            for key in step["keys"]:
                run_ledger.set_stage(run_id, key,
                                     run_ledger.PARTIAL if partial else run_ledger.DONE if ok
                                     else run_ledger.FAILED, detail=detail)
            _emit("stage_partial", stage=step["state"], keys=list(step["keys"]))
            run_ledger.end(run_id, run_ledger.SKIPPED_END, reason="stopped at your request")
            run_state.set_stage(run_id, "done", "run complete (interpretation stopped early)")
            _emit(run_events.RUN_ENDED, status="skipped", detail="stopped at your request")
            return
        for key in step["keys"]:
            run_ledger.set_stage(run_id, key,
                                 run_ledger.DONE if ok else run_ledger.FAILED, detail=detail)
        if not ok:
            # DEGRADED: interpretation could not continue. The RUN is unharmed and says so —
            # every number came from the physics and none of them moves because of this.
            run_ledger.end(run_id, run_ledger.DEGRADED, reason=detail)
            run_state.set_stage(run_id, "done", "run complete (interpretation incomplete)")
            _emit(run_events.RUN_ENDED, status="degraded", detail=detail)
            return

    run_state.set_stage(run_id, "done", "run complete")
    run_ledger.end(run_id, run_ledger.COMPLETE)
    _emit(run_events.RUN_ENDED, status="complete", detail="")


def _resume_chain(run_id: str, events_path: Path, pending: list[str]) -> None:
    """RESUME: the stages the ledger says never ran, against the sealed run. Nothing is
    re-simulated and no figure can move — the physics act is over and its outputs are on disk."""
    try:
        _run_chain(run_id, events_path, only=set(pending))
    finally:
        run_state.release(run_id)


def _run_quant_then_chain(run_id: str, cmd: list[str], events_path: Path) -> None:
    """The simulate job: the physics, the results document, then — if armed — the interpretation.

    ONE acquire is held across all of it (released in the finally). That is load-bearing three times:
    it closes the steal window a per-stage re-acquire would open, it keeps ``run_state.active()``
    equal to this run so the SSE orphan guard cannot inject a terminal between stages, and it lets
    the chain write exactly one terminal state instead of one per stage."""
    def _emit(event: str, **payload) -> None:
        run_events.emit(events_path, event, **payload)

    try:
        run_ledger.init(run_id)
        ok, detail = _run_cmds(run_id, [cmd], "simulate", events_path, list(_SIMULATE_LABELS))
        run_ledger.set_quant(run_id, run_ledger.DONE if ok else run_ledger.FAILED)
        if not ok:
            run_ledger.end(run_id, run_ledger.FAILED_END, reason=detail)
            _emit(run_events.RUN_ENDED, status="failed", detail=detail)
            return

        _run_facts_only(run_id, events_path)

        if not auto_enrich_enabled():
            run_ledger.end(run_id, run_ledger.COMPLETE, reason="interpretation not requested")
            _emit(run_events.RUN_ENDED, status="complete", detail="")
            return

        _run_chain(run_id, events_path)
    finally:
        run_state.release(run_id)



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
        if ch.via:
            # V2.6d: the =form — a 'lon,lat' value starts with '-' (the reverse-edge argparse bug class)
            cmd += [f"--via={v}" for v in ch.via]
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
    ev = _begin_run_events(run_id, description=desc, changes=members,
                           demand_profile=req.demand_profile, assignment=req.assignment,
                           n_seeds=req.n_seeds)
    bg.add_task(_run_quant_then_chain, run_id, cmd, ev)
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
        if ch.via:
            # V2.6d: parse strictly, then the four geometry rules — the harness re-validates with
            # the SAME sentences at SystemExit severity (crash loud in a CLI, plain 400 here).
            import contract_models
            try:
                for item in ch.via:
                    contract_models.parse_via_item(item)
            except ValueError as e:
                raise HTTPException(400, str(e)) from None
            reason = network_edit.new_road_via_reason(ch.from_junction, ch.to_junction, ch.via,
                                                      network_edit.canonical_net())
            if reason is not None:
                raise HTTPException(400, reason)
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
    change_dump = ch.model_dump(exclude_none=True)
    run_state.set_stage(run_id, "queued", "queued", description=desc, change=change_dump,
                        demand_profile=req.demand_profile, assignment=req.assignment,
                        n_seeds=req.n_seeds)
    ev = _begin_run_events(run_id, description=desc, changes=[change_dump],
                           demand_profile=req.demand_profile, assignment=req.assignment,
                           n_seeds=req.n_seeds)
    bg.add_task(_run_quant_then_chain, run_id, cmd, ev)
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
                    # V2.7a — the run LIST is an inventory (names, dates, a plain-terms option
                    # fingerprint, a change summary): pass the state file's own fields through.
                    # Deltas/scores stay OUT by design — comparison lives behind the provenance
                    # guard in Compare, never on the list.
                    "demand_profile": s.get("demand_profile"), "assignment": s.get("assignment"),
                    "n_seeds": s.get("n_seeds"),
                    "changes": s.get("changes") or ([s["change"]] if s.get("change") else None),
                    "tags": s.get("tags"),
                    **({"name": ident["name"]} if ident.get("name") else {})})
    return {"runs": out}


def _enrich_progress(run_id: str) -> dict | None:
    """V2.3a — derive {done, total, label} from the run's events file for the POLL degrade path.

    READ-ONLY derivation in the GET handler: the run-state file is never written with progress (its
    ``set_stage`` is an unlocked read-merge-write — a second writer would race the server's own writes).
    The events file is a few hundred KB at most; parsing it per 1.5 s poll is cheap.

    V2.7b — SCAN FROM THE LAST ``stage_start``, not from line 0. The file is no longer truncated per
    enrich job, so the PREVIOUS stage's ``voice 212/212`` is still in the file: folding from 0 would open
    every later stage showing a full progress bar. The current stage's window is the only honest one."""
    path = run_events.events_path(run_id)
    events, _ = run_events.read_from(path, 0)
    if not events:
        return None
    start = 0
    for i, (_, ev) in enumerate(events):
        if ev.get("event") == "stage_start":
            start = i
    out: dict = {}
    for _, ev in events[start:]:
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


@app.post("/api/runs/{run_id}/skip")
async def skip_interpretation(run_id: str):
    """V2.7b C6b — "skip the rest, keep what landed".

    Writes the cancel flag and returns. It DELIBERATELY does not release the lock: the running stage
    releases it through its own `finally` once it has stopped at a safe point and written what it
    generated. Releasing here would hand the slot away while a subprocess is still writing into the
    run's files, which is the lock-stealing shape `release(run_id)` exists to prevent."""
    if run_state.read(run_id) is None:
        raise HTTPException(404, f"no such run {run_id!r}")
    run_events.request_cancel(run_id)
    return {"run_id": run_id, "cancel_requested": True,
            "note": "the current stage stops at its next safe point and keeps what it generated"}


@app.post("/api/runs/{run_id}/resume")
async def resume_interpretation(run_id: str, bg: BackgroundTasks):
    """V2.7b C6b — run the stages the ledger says never ran, against the SEALED run.

    Nothing is re-simulated: every figure was computed in the physics act and none of them can move.
    Clearing the cancel flag FIRST is not a detail — a resume that leaves it in place instantly
    cancels its own first stage and looks like a no-op."""
    if trajectory_io.pinned_enrich_blocked(run_id):
        raise HTTPException(403, trajectory_io.enrich_refusal_reason(run_id))
    if run_state.read(run_id) is None:
        raise HTTPException(404, f"no such run {run_id!r}")
    led = run_ledger.read(run_id)
    if led is None:
        raise HTTPException(409, f"run {run_id!r} has no interpretation ledger to resume from")
    pending = [s["key"] for s in led["stages"] if s["status"] not in (run_ledger.DONE,)]
    if not pending:
        raise HTTPException(409, "every interpretation stage already ran for this run")
    if not run_state.try_acquire(run_id):
        raise HTTPException(409, f"a job is already running ({run_state.active()}); one job at a time")
    run_events.clear_cancel(run_id)
    ev = run_events.events_path(run_id)
    run_events.ensure_header(ev, run_id, description=(run_state.read(run_id) or {}).get("description"))
    bg.add_task(_resume_chain, run_id, ev, pending)
    return {"run_id": run_id, "resuming": pending}


@app.get("/api/runs/{run_id}/ledger")
async def run_ledger_get(run_id: str):
    """V2.7b — the interpretation LEDGER: which stages ran, were skipped or failed, what each cost.

    The durable half of the run experience (the events file is the live half). A run with no ledger
    is not an error — every run before this step, and every CLI-harness run, legitimately has none —
    so this returns ``{ledger: null}`` rather than 404ing, and the client renders the run without the
    interpretation panel instead of painting a failure over a perfectly good run."""
    if run_state.read(run_id) is None:
        raise HTTPException(404, f"no such run {run_id!r}")
    return {"run_id": run_id, "ledger": run_ledger.read(run_id)}


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
        raise HTTPException(403, trajectory_io.identity_refusal_reason(run_id))
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
        raise HTTPException(403, trajectory_io.enrich_refusal_reason(run_id))
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
    # V2.7b INVARIANT — POST-time ordering: ensure the header → emit stage_start → launch. All three run
    # synchronously HERE (BackgroundTasks fire after the response), under the held lock, BEFORE the
    # subprocess exists, so the client's stream GET never 404s in the postEnrich→EventSource gap.
    # The file is NO LONGER truncated here (V2.3a did): it is the RUN's file, truncated once at the
    # simulate POST. ``ensure_header`` covers the two cases where it is missing anyway — a run whose
    # file was pruned at 7 days, and a run that predates V2.7b — so line 0 is always the run header.
    labels = _ENRICH_LABELS[req.stage]
    ev = run_events.events_path(run_id)
    run_events.ensure_header(ev, run_id, description=st.get("description"),
                             changes=st.get("changes") or ([st["change"]] if st.get("change") else None),
                             demand_profile=st.get("demand_profile"), assignment=st.get("assignment"),
                             n_seeds=st.get("n_seeds"))
    run_events.emit(ev, "stage_start", stage=f"enrich:{req.stage}",
                    label=f"enrich:{req.stage}", kind="llm", stages=labels)
    bg.add_task(_run_subprocess_job, run_id, cmds, f"enrich:{req.stage}", ev, labels)
    return {"run_id": run_id, "stage": req.stage}


def _run_is_over(run_id: str) -> bool:
    """The STATE-DRIVEN end-of-stream predicate: run-state is terminal AND no job holds the lock.

    V2.3a closed the stream on a ``job_done``/``job_failed`` LINE. That cannot survive a per-RUN file:
    under the auto-chain the first stage's terminal would end the client's stream before stage 2 exists,
    and a skip writes a terminal that a later resume appends AFTER — so every later replay would close
    early, permanently. Reading the run's actual state instead makes an interior ``run_ended`` line
    harmless content. ``run_state.read`` already coerces a stale "running" to failed, which also folds
    the old ORPHAN GUARD (server restart / killed subprocess) into this one predicate."""
    st = run_state.read(run_id)
    return bool(st and st.get("status") in ("done", "failed") and run_state.active() != run_id)


@app.get("/api/runs/{run_id}/events")
async def run_event_stream(run_id: str, request: Request):
    """V2.7b — SSE over the RUN's events file: replay from 0 (or Last-Event-ID), then tail.

    The ``id:`` of each frame is the file's absolute line number, so a dropped EventSource resumes via
    the native Last-Event-ID reconnect; a stale id past EOF (a fresh run truncated the file) replays from
    0 and the client's run_start reset handles the rest. The stream closes with a synthesized
    ``stream_end`` CONTROL frame — never a file line, so it can never be confused with the ``run_ended``
    content event. Degrade path: no events file → 404 → the client falls back to the poll it never
    stopped running (and shows nothing at all for an already-finished run, which legitimately has none)."""
    path = run_events.events_path(run_id)
    if not path.is_file():
        raise HTTPException(404, f"no event stream for {run_id!r}")
    raw = request.headers.get("last-event-id", "")
    resume_after = int(raw) if raw.isdigit() else -1

    async def gen():
        offset = 0
        start = resume_after + 1
        _, eof = run_events.read_from(path, 0)
        if start > eof:  # stale Last-Event-ID from a previous run's longer file → replay from 0
            start = 0
        last_beat = time.monotonic()
        while True:
            events, offset = run_events.read_from(path, offset)
            for lineno, ev in events:
                if lineno < start:
                    continue
                yield f"id: {lineno}\nevent: {ev.get('event', 'message')}\ndata: {json.dumps(ev)}\n\n"
                last_beat = time.monotonic()
            if await request.is_disconnected():
                return
            if _run_is_over(run_id):
                # Drain once more before closing: the subprocess's last lines and the terminal state
                # write are not atomic with each other, so a line can land in that window.
                events, offset = run_events.read_from(path, offset)
                for lineno, ev in events:
                    if lineno < start:
                        continue
                    yield f"id: {lineno}\nevent: {ev.get('event', 'message')}\ndata: {json.dumps(ev)}\n\n"
                st = run_state.read(run_id) or {}
                ctl = {"event": run_events.STREAM_END, "ts": time.time(),
                       "status": st.get("status", "done"), "detail": st.get("detail", "")}
                yield f"id: {offset}\nevent: {run_events.STREAM_END}\ndata: {json.dumps(ctl)}\n\n"
                return
            if time.monotonic() - last_beat > 15:
                yield ": ping\n\n"
                last_beat = time.monotonic()
            await asyncio.sleep(0.25)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
