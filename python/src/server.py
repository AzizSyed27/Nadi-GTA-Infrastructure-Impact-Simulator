"""Phase 3.2 — minimal localhost FastAPI backend for the interactive report agent.

GET  /api/report  → serves the latest report JSON (+ the served run id).
POST /api/chat {question} → LightRAG retrieval over the per-run index, then a GUARDED DeepSeek generation over
    the retrieved context. The chat agent gets NO exemption from the rules the report obeys: we reuse
    ``report.audit_prose`` on every answer (retry once, else a caveat-only fallback), and answer ONLY from the
    retrieved context, naming sources. Digit-free by design (numbers live in the report view).

Run from python/src:  uvicorn server:app --reload --port 8000
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

SRC = Path(__file__).resolve().parent
sys.path.insert(0, str(SRC))  # bare imports work regardless of cwd
import llm_provider  # noqa: E402
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
    """A DeepSeek client for the guarded answer — explicit (not PROVIDER-env dependent), reusing the preset."""
    llm_provider._load_env()
    base_url, model, key_env, json_mode = llm_provider.PROVIDER_PRESETS["deepseek"]
    key = os.environ.get(key_env)
    if not key:
        raise RuntimeError(f"{key_env} is not set (put it in python/.env).")
    return llm_provider.OpenAICompatAdapter(base_url=base_url, model=model, api_key=key,
                                            json_mode=json_mode, max_tokens=500)


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


# ===================================================================================================
# Phase 5.1 — the EDIT / JOB-RUNNER API. SUMO + the enrich pipelines run as SUBPROCESSES (libsumo global
# state + torch/OASIS make in-process unsafe); a single in-process lock serializes ALL jobs (simulate + enrich).
# ===================================================================================================
_JUNCTIONS: dict = {"all": None}  # cache the (slow) 23MB net read across /api/junctions calls
_EDGES: dict = {"all": None}  # same, for /api/edges (the edit-an-edge palette)


class SimChange(BaseModel):
    type: str = "new_road"  # new_road | speed_limit | bike_lane
    # new_road geometry
    from_junction: str | None = None
    to_junction: str | None = None
    lanes: int = 1
    speed_mps: float = 13.9
    bidirectional: bool = False
    # runtime-change fields (speed_limit / bike_lane)
    target_edge: str | None = None
    value_mps: float | None = None  # speed_limit new max (m/s)
    target_lane: int | None = None  # bike_lane lane index (default: curbside car lane)
    description: str | None = None


class SimulateReq(BaseModel):
    change: SimChange


class EnrichReq(BaseModel):
    stage: str  # voices | report | discourse


def _run_subprocess_job(run_id: str, cmds: list[list[str]], label: str) -> None:
    """Run one or more subprocesses sequentially under the held lock; reconcile state; always release."""
    try:
        for cmd in cmds:
            proc = subprocess.run(cmd, cwd=str(SRC), capture_output=True, text=True)
            if proc.returncode != 0:
                st = run_state.read(run_id)
                if not st or st.get("status") != "failed":
                    run_state.set_stage(run_id, "failed", f"{label} failed: {(proc.stderr or '')[-280:]}")
                return
        st = run_state.read(run_id)  # the pipeline sets its own terminal "done"; enrich sets it here.
        if label != "simulate":
            run_state.set_stage(run_id, "done", f"{label} complete")
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
async def edges(bbox: str | None = Query(None, description="minLon,minLat,maxLon,maxLat")):
    """Corridor edges for the edit-an-edge palette: geometry + speed + car-lane count + bike eligibility."""
    if _EDGES["all"] is None:
        _EDGES["all"] = network_edit.list_edges(None)  # cache the full net read
    es = _EDGES["all"]
    if bbox:
        b = [float(x) for x in bbox.split(",")]
        es = [e for e in es if any(b[0] <= lon <= b[2] and b[1] <= lat <= b[3] for lon, lat in e["geometry"])]
    return {"edges": es, "count": len(es)}


def _edges_by_id() -> dict:
    """Edge id -> record from the cached /api/edges list (for existence + bike-eligibility validation)."""
    if _EDGES["all"] is None:
        _EDGES["all"] = network_edit.list_edges(None)
    return {e["id"]: e for e in _EDGES["all"]}


@app.post("/api/simulate")
async def simulate(req: SimulateReq, bg: BackgroundTasks):
    """Validate an edit (new_road | speed_limit | bike_lane), mint a run id, and launch the quant pipeline as a
    background subprocess. bike_lane is rejected 400 with the SINGLE-SOURCE eligibility reason if ineligible."""
    ch = req.change
    py, ts = sys.executable, datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_id = f"multimodal-scenario-{ts}"

    if ch.type == "new_road":
        if not (ch.from_junction and ch.to_junction and ch.lanes and ch.speed_mps):
            raise HTTPException(400, "new_road requires from_junction, to_junction, lanes, speed_mps")
        desc = ch.description or f"New road {ch.from_junction}->{ch.to_junction}"
        cmd = [py, str(HARNESS), "--change-type", "new_road", "--run-ts", ts,
               "--from-junction", ch.from_junction, "--to-junction", ch.to_junction,
               "--lanes", str(ch.lanes), "--speed-mps", str(ch.speed_mps), "--description", desc]
        if ch.bidirectional:
            cmd.append("--bidirectional")
    elif ch.type == "speed_limit":
        if not (ch.target_edge and ch.value_mps):
            raise HTTPException(400, "speed_limit requires target_edge and value_mps")
        if ch.target_edge not in _edges_by_id():
            raise HTTPException(400, f"edge {ch.target_edge!r} is not in the network")
        desc = ch.description or f"Speed limit on {ch.target_edge} -> {ch.value_mps} m/s"
        # `--flag=value` form: SUMO edge ids can start with '-' (reverse edges), which argparse would else
        # mistake for an option.
        cmd = [py, str(HARNESS), "--change-type", "speed_limit", "--run-ts", ts,
               f"--target-edge={ch.target_edge}", "--speed-mps", str(ch.value_mps), "--description", desc]
    elif ch.type == "bike_lane":
        if not ch.target_edge:
            raise HTTPException(400, "bike_lane requires target_edge")
        edge = _edges_by_id().get(ch.target_edge)
        if edge is None:
            raise HTTPException(400, f"edge {ch.target_edge!r} is not in the network")
        if not edge["eligible_bike_lane"]:
            raise HTTPException(400, edge["eligibility_reason"])  # the backend's own words, verbatim
        desc = ch.description or f"Bike lane on {ch.target_edge}"
        cmd = [py, str(HARNESS), "--change-type", "bike_lane", "--run-ts", ts,
               f"--target-edge={ch.target_edge}", "--description", desc]  # =form: edge ids can start with '-'
        if ch.target_lane is not None:
            cmd += ["--target-lane", str(ch.target_lane)]
    else:
        raise HTTPException(400, f"unsupported change type {ch.type!r} (new_road | speed_limit | bike_lane)")

    if not run_state.try_acquire(run_id):  # synchronous, race-free reject-if-active
        raise HTTPException(409, f"a job is already running ({run_state.active()}); one job at a time")
    run_state.set_stage(run_id, "queued", "queued", description=desc, change=ch.model_dump(exclude_none=True))
    bg.add_task(_run_subprocess_job, run_id, [cmd], "simulate")
    return {"run_id": run_id}


@app.get("/api/runs")
async def runs():
    return {"runs": [{"id": s["run_id"], "description": s.get("description", ""), "status": s.get("status"),
                      "stage": s.get("stage"), "started_at": s.get("started_at")} for s in run_state.list_all()]}


@app.get("/api/runs/{run_id}/status")
async def run_status(run_id: str):
    st = run_state.read(run_id)
    if st is None:
        raise HTTPException(404, f"no such run {run_id!r}")
    return st


@app.post("/api/runs/{run_id}/enrich")
async def enrich(run_id: str, req: EnrichReq, bg: BackgroundTasks):
    """Launch an existing enrich pipeline (voices | report | discourse) against a completed run."""
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
    bg.add_task(_run_subprocess_job, run_id, cmds, f"enrich:{req.stage}")
    return {"run_id": run_id, "stage": req.stage}
