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
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

sys.path.insert(0, str(Path(__file__).resolve().parent))  # bare imports work regardless of cwd
import llm_provider  # noqa: E402
import report  # noqa: E402
import report_agent  # noqa: E402

LATEST_REPORT = report.WEB_PUBLIC / "latest-report.json"

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
        rag = report_agent.make_rag(wd)
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
