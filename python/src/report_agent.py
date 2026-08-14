"""Phase 3.2 — the interactive report agent's CORPUS + per-run LightRAG index.

Turns a finished run (artifact + sidecars + the 3.1 report facts) into ~230 small retrieval documents and
builds a per-run LightRAG index at ``contract/runs/index-<ts>/``. `server.py` queries that index and runs a
guarded generation over the retrieved context (the same honesty rules the report obeys).

TWO GRAPHS, ONE JOB (CLAUDE.md): this is the report agent's GraphRAG MEMORY over the run corpus — NOT the
OASIS social graph. Everything here is deterministic + LLM-free EXCEPT the index build, where LightRAG runs
its own entity/relationship extraction (bound to DeepSeek) at insert time.

Design notes learned from the Step-0 gate:
  * Attribution is NATIVE: we pass ``ainsert(texts, file_paths=source_ids)`` and read the ``file_path`` back
    from ``aquery_data`` — no source tag embedded in the doc text (which would pollute the embedding/graph).
  * LightRAG canonicalizes a file_path to its BASENAME, so source ids must be slash-free. We use ``__`` as the
    field separator (persona ids themselves contain single ``_``), e.g. ``voice__time_pressed__veh12``.
  * LightRAG/torch imports live INSIDE the build functions so importing this module (and unit-testing
    ``build_corpus``) needs neither torch nor a network.

Run AFTER report.py:
    python python/src/report_agent.py                 # newest run
    python python/src/report_agent.py --run-id <id> --rebuild
"""

from __future__ import annotations

import argparse
import json
import os
import re
import tempfile
from pathlib import Path

import llm_provider
import personas as personas_mod
import report
import trajectory_io
from contract_models import TrajectoryArtifact

RUNS_DIR = report.RUNS_DIR
EMBED_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
EMBED_DIM = 384  # all-MiniLM-L6-v2 — FIXED once an index is built
EMBED_BACKEND = "hf"  # lightrag.llm.hf.hf_embed
MAX_LLM_ASYNC = 4  # insert-time DeepSeek concurrency (keep modest to dodge rate limits)

# WINDOWS/ONEDRIVE GOTCHA: the repo lives under a OneDrive-synced folder, and OneDrive grabs a handle on
# freshly-created .tmp files, which breaks LightRAG's atomic write (tmp -> os.replace) with WinError 5. So the
# index (a rebuildable artifact, not source) is stored OUTSIDE the synced tree under %LOCALAPPDATA%. Override
# with NADI_INDEX_ROOT if you want it elsewhere. Build and server both resolve via index_dir()/newest_index().
INDEX_ROOT = Path(os.environ.get("NADI_INDEX_ROOT")
                  or os.environ.get("LOCALAPPDATA") or tempfile.gettempdir()) / "nadi-report-agent"

# sim travel mode → scorecard group (inferred voices use their persona.stakeholder directly).
MODE_TO_GROUP = {"car": "car_commuter", "bicycle": "cyclist", "pedestrian": "pedestrian"}


def _persona_specs() -> dict[str, object]:
    return {p.id: p for p in personas_mod.load_personas()}


def _group_of(spec, grounding: str) -> str:
    if spec is None:
        return "other"
    if grounding == "inferred":
        return getattr(spec, "stakeholder", None) or "other"
    return MODE_TO_GROUP.get(getattr(spec, "mode", "car"), "other")


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")


def _doc(source: str, title: str, body: str) -> dict:
    """One corpus doc. `source` is a slash-free, ``__``-separated citation handle (becomes the file_path)."""
    return {"source": source, "text": f"{title}\n{body}"}


# ===================================================================================================
# Corpus (deterministic, LLM-free) — ~230 docs
# ===================================================================================================

def build_corpus(artifact: TrajectoryArtifact, outcomes: dict, verdict: dict | None) -> list[dict]:
    facts = report.gather_facts(artifact, outcomes, verdict)
    specs = _persona_specs()
    docs: list[dict] = []

    # --- one doc per agent (voice): persona, group, grounding, stance, outcome summary, verbatim comment ---
    for i, a in enumerate(artifact.agents):
        if a.grounding == "mandate":
            # V2.3c — institutions get their OWN doc kind (never a voice__ doc): the sourced mandate,
            # the citations with their honesty notes, and the not-a-statement disclaimer.
            md = a.mandate
            lines = [
                f"Institutional perspective (mandate lens): {a.persona.label}.",
                f"Published mandate (source {md.source}, retrieved {md.retrieved}): \"{md.mission}\"",
            ]
            for c in a.citations or []:
                lines.append(f"Computed fact cited ({c.key}): {c.text}")
                for n in c.notes or []:
                    lines.append(f"  Note: {n}.")
            lines.append(report.INSTITUTIONAL_DISCLAIMER)
            docs.append(_doc(f"institution__{a.persona.id}",
                             f"Institutional perspective — {a.persona.label}", "\n".join(lines)))
            continue
        spec = specs.get(a.persona.id)
        group = _group_of(spec, a.grounding)
        glabel = report.GROUP_LABEL.get(group, group)
        pin = a.vehicle_id or a.person_id or f"idx{i}"
        grounded = ("a simulated traveler on the corridor" if a.grounding == "sim"
                    else "an inferred community voice (no measured trip on the corridor)")
        lines = [
            f"Stakeholder group: {glabel}.",
            f"Persona: {a.persona.label} (id {a.persona.id}) — {grounded}.",
            f"Anticipated stance toward the change: {a.reaction.stance} (sentiment {a.reaction.sentiment:+.2f}).",
        ]
        if a.outcome is not None:
            o = a.outcome
            lines.append(f"Trip travel time: baseline {o.baseline_duration:.0f}s -> scenario "
                         f"{o.scenario_duration:.0f}s (change {o.delta_seconds:+.0f}s).")
        lines.append(f'Anticipated reaction, verbatim: "{a.reaction.comment}"')
        docs.append(_doc(f"voice__{a.persona.id}__{pin}", f"Voice — {a.persona.label} [{glabel}]", "\n".join(lines)))

    # --- v0.4.0 social posts: CLEAN cascade content only. Events marked audit_status="excluded" by the
    #     immutability/audit guard MUST NOT leak into the clean corpus (they stay in the artifact for provenance).
    if artifact.social is not None:
        for cascade in artifact.social.cascades:
            for step in cascade.steps:
                for ev in step.events:
                    if ev.content and ev.audit_status == "clean":
                        docs.append(_doc(f"social__{ev.agent}__{cascade.cascade_id}__{step.step}",
                                         f"Social post — {ev.agent}", ev.content))

    # --- v0.4.0 discourse: per-cascade ENGAGED-reach + MOVEMENT summaries, the divergence verdict, and the
    #     exclusion breakdown. Deliberately framed MOVEMENT-not-position: the new movement data must NOT let the
    #     chat launder shifts into a directional verdict past the tally guard (so every doc carries the
    #     "movement, never a vote / cascades diverge" caveat inline). Reuses report.discourse_facts (code-only).
    dfacts = report.discourse_facts(artifact)
    if dfacts is not None:
        for cid in dfacts["cascade_ids"]:
            rows = sorted(dfacts["reach"].get(cid, []), key=lambda r: r["reached"], reverse=True)
            ranked = "; ".join(
                f"{r['argument']}: {r['reached']} responses across {r['post_count']} posts"
                + (f" ({r['per_post']} per post)" if r["per_post"] is not None else "")
                for r in rows)
            docs.append(_doc(f"engaged_reach__{cid}", f"Argument engagement — cascade {cid}",
                "Engaged-reach = the number of unique agents who ACTED ON (liked, commented on, or reposted) a "
                "post making the argument — who were moved to respond, NOT merely how many were shown it. Under "
                "the neutral random recommender used here, exposure-based reach saturates to everyone and is not "
                "reported; engaged-reach also partly reflects how much an argument was posted (response volume), "
                f"so read it with the per-post figure. In cascade {cid}: {ranked}."))
            s = dfacts["shifts"][cid]
            byg = ", ".join(f"{g}: {n}" for g, n in s["by_group"].items()) or "none"
            docs.append(_doc(f"movement__{cid}", f"Opinion movement — cascade {cid}",
                f"In this one simulated cascade ({cid}), {s['movers']} agents' DERIVED stance moved during the "
                f"discussion: {s['hardened']} hardened, {s['warmed']} warmed, by group — {byg}. This is MOVEMENT "
                "(who reconsidered), never a final position, a head-count, or a vote. Cascades are illustrative "
                "and diverge: who shifts varies from run to run, so this is never what the community decides."))
        dom = ", ".join(f"{cid}: {arg}" for cid, arg in dfacts["dominant"].items())
        docs.append(_doc("divergence", "Do the cascades agree? (divergence)",
            "Across the independent simulated cascades, the argument that drew the most response "
            + ("DIFFERED — the cascades DIVERGE on which argument travels furthest"
               if dfacts["diverge"] else "was CONSISTENT across runs")
            + f" (most-answered per cascade — {dom}). 'Travels furthest' means drew the most RESPONSE "
            "(engaged-reach), which under the neutral random recommender partly tracks posting volume; "
            "exposure-reach saturates and is not used. These are illustrative unfoldings, not a forecast of "
            "what the community will decide."))
        if dfacts["excluded_count"]:
            eb = ", ".join(f"{r}: {n}" for r, n in dfacts["excluded_by"].items())
            docs.append(_doc("exclusions", "Posts withheld by the honesty guard",
                f"{dfacts['excluded_count']} social posts were withheld from this corpus by the post-hoc guard, "
                f"by rule — {eb}. Excluded content is kept in the artifact only for provenance and is NOT in this "
                "corpus. An exclusion is the honesty guard working — a post that claimed a safety direction, made "
                "a vote/tally, named crashes, or contradicted the agent's own measured trip."))

    # --- one doc per scorecard row (with confidence + verbatim note) ---
    for gid in report.GROUP_ORDER:
        g = facts["by_group"].get(gid)
        glabel = report.GROUP_LABEL[gid]
        lines = [f"Per-stakeholder scorecard row for {glabel} (grounding: {g.grounding if g else 'inferred'}). "
                 "Sign convention: POSITIVE = worse for the group."]
        for label, cell, kind in (("Travel time", g.travel_time_delta if g else None, "travel"),
                                   ("Safety (surrogate near-miss)", g.safety_delta if g else None, "safety"),
                                   ("Access", g.access_delta if g else None, "access")):
            note = f" Note: {cell.note}" if (cell and getattr(cell, "note", None)) else ""
            lines.append(f"{label}: {report.render_cell(cell, kind)} — {report.cell_valence(cell, kind)}.{note}")
        # V2.2 closeout — windowed runs: every scorecard row the chat can retrieve carries the scope
        # sentence, so a run-scoped number can never be served as the windowed change's undiluted cost.
        if facts.get("scope_disclosure"):
            lines.append(facts["scope_disclosure"])
        docs.append(_doc(f"scorecard__{gid}", f"Scorecard row — {glabel}", "\n".join(lines)))

    # --- the change(s) --- v0.5.0: one doc listing every change the scenario composes (single-change → one line).
    change_lines = []
    for ch in facts["changes"]:
        lane = f", lane {ch.target_lane}" if ch.target_lane is not None else ""
        change_lines.append(f"{ch.description}. Change type: {ch.type}. Target edge {ch.target_edge}{lane}.")
    joined = " ".join(change_lines)
    prefix = "The proposed change being previewed" if len(change_lines) == 1 else \
        f"The proposed scenario composes {len(change_lines)} changes"
    # V2.2a — closure runs: non-completions are a first-class fact the chat must be able to retrieve
    # (never averaged into travel-time deltas), alongside the window-revert proof.
    closure_txt = ""
    if facts.get("non_completions") is not None:
        nc = facts["non_completions"]
        closure_txt = (f" Non-completions under the closure: {nc.get('car', 0)} cars, "
                       f"{nc.get('bicycle', 0)} bicycles, {nc.get('pedestrian', 0)} pedestrians completed "
                       f"in baseline but not in the closure run; they are counted as non-completions, "
                       f"never averaged into travel-time deltas.")
        # V2.2c split — the attribution parenthetical is REQUIRED wherever the split renders
        # (not_inserted must never read as closure-caused; the backlog is structural).
        split = facts.get("non_completions_split")
        backlog = facts.get("insertion_backlog") or {}
        if split is not None:
            for m, b in split.items():
                total = b["entered_not_finished"] + b["not_inserted"]
                if total == 0:
                    continue
                bl = backlog.get(m) or {}
                closure_txt += (
                    f" Of the {total} {m} non-completions: {b['entered_not_finished']} entered the "
                    f"network and could not finish; {b['not_inserted']} did not enter the network — "
                    f"this includes trips whose route was invalid at departure, and also trips still "
                    f"queued to enter when the simulated period ended (insertion backlog affects "
                    f"baseline runs too: {bl.get('baseline', 0)} had not entered by the baseline "
                    f"run's end vs {bl.get('scenario', 0)} in this run).")
    for ev in facts.get("window_events") or []:
        if ev.get("reverted_t") is not None and ev.get("restored_ok"):
            closure_txt += (" The closure window was applied and reverted within the run; the restored "
                            "road state was verified to match the pre-closure capture exactly.")
        elif ev.get("note"):
            closure_txt += f" Closure window note: {ev['note']}."
    docs.append(_doc("change", "The proposed change being previewed",
                     f"{prefix}: {joined} "
                     f"Demand simulated on the corridor: {facts['demand']['car']} cars, "
                     f"{facts['demand']['bicycle']} bicycles, {facts['demand']['pedestrian']} pedestrians. "
                     f"In-run adaptation: {facts['cars_rerouted']} cars rerouted within the run."
                     + closure_txt))

    # V2.2b/V2.5b — the response fact as its own retrievable doc (corpus docs may carry digits;
    # generated prose stays digit-free-audited). Shape-keyed: members = the V2.5b end-reachability
    # fact with FULL per-station granularity (retrieval wants it); probes = the legacy anchor
    # shape, verbatim. Metric vocabulary: "added … to reach" — never the legacy number-bearing
    # phrase (the cross-vintage split reaches the chat corpus too).
    rd = facts.get("response_detour")
    if rd and rd.get("members") is not None:
        type_phrase = {"road_closure": "road closure", "lane_closure": "lane closure",
                       "incident": "incident"}
        lines = []
        for m in rd["members"]:
            head = f"{type_phrase.get(m.get('type'), m.get('type'))} {m['edge']}"
            for e in m.get("ends", []):
                if e.get("status") == "no_approach":
                    lines.append(f"{head}, {e['label']}: {e.get('note')}.")
                    continue
                for r in e.get("probes", []):
                    if r.get("added_s") is not None:
                        row = (f"{head}, {e['label']}, from {r['label']}: baseline "
                               f"{r['baseline_s']} s, during the window {r['scenario_s']} s, "
                               f"added {r['added_s']} s to reach this end.")
                        if r.get("note"):
                            row += f" {r['note']}."
                        lines.append(row)
                    else:
                        lines.append(f"{head}, {e['label']}, from {r['label']}: "
                                     f"{r.get('note') or 'not computable'}.")
        tail = "".join(f" {rd[k]}." for k in ("origins_note", "probed_members_note",
                                              "end_method_note", "window_coincidence_note")
                       if rd.get(k))
        docs.append(_doc("response_access", "Emergency response access (free-flow estimate)",
                         " ".join(lines) + tail
                         + f" {rd.get('framing')}. {rd.get('lower_bound_note')}."))
    elif rd:
        lines = []
        if not rd.get("probes"):  # labeled degradation: say why there are no probe numbers
            lines.append(f"Response detour not computable: "
                         f"{rd.get('destination_note') or 'no routable destination for this change'}.")
        for pr in rd.get("probes", []):
            if pr.get("added_s") is not None:
                lines.append(f"From {pr['label']}: baseline {pr['baseline_s']} s, during the window "
                             f"{pr['scenario_s']} s, added {pr['added_s']} s.")
            else:
                lines.append(f"From {pr['label']}: {pr.get('note') or 'not computable'}.")
        origins = f" {rd['origins_note']}." if rd.get("origins_note") else ""
        # V2.5a: differing member windows — the coincidence disclosure rides the numbers here too
        wc = f" {rd['window_coincidence_note']}." if rd.get("window_coincidence_note") else ""
        docs.append(_doc("response_access", "Emergency response access (free-flow estimate)",
                         " ".join(lines) + origins + wc
                         + f" {rd.get('framing')}. {rd.get('lower_bound_note')}."))

    # V2.2d — the school-zone lens pair as its own retrievable doc, with ALL its honesty notes
    # riding the numbers (variation ALWAYS — the pair has no cross-seed range machinery; population
    # names what is measured, never schoolchildren).
    zf = facts.get("zone_facts")
    if zf:
        pv = zf["ped_vehicle_conflicts"]
        zone_lines = [
            f"School zone (tagged scenario): {zf['n_edges']} street(s) with a lower speed limit "
            f"(edges {', '.join(zf['zone_edges'])}).",
            f"Ped-vehicle conflict events on zone streets during the window: {pv['scenario']} in the "
            f"scenario vs {pv['baseline']} in the baseline. These are surrogate near-miss measures, "
            f"not crash predictions, and the pair does not establish a direction.",
            f"{zf['variation_note']}.",
            f"{zf['population_note']}.",
            f"{zf['method_note']}" + (f"; {zf['window_note']}" if zf.get("window_note") else "") + ".",
        ]
        docs.append(_doc("zone__school_zone__facts", "School-zone conflict lens (tagged scenario)",
                         "\n".join(zone_lines)))

    # --- robustness / cross-seed verdict ---
    if verdict:
        per = "; ".join(f"seed {r['seed']}: {r['share_gt30'] * 100:.1f}% of cars over 30s slower"
                        for r in verdict.get("per_seed", []))
        body = f"{verdict.get('verdict', '')} Per-seed car travel-time tail — {per}."
    else:
        body = report._cross_seed_sentence(facts)
    docs.append(_doc("robustness", "Cross-seed robustness of the travel-time tail", body))

    # --- limitations (one doc per caveat, so a safety-direction question retrieves the safety caveat) ---
    for c in report.build_caveats(facts):
        docs.append(_doc(f"limitation__{_slug(c['title'])}", f"Limitation — {c['title']}", c["body"]))

    # --- conflict (surrogate safety) summary: counts by type + ordinal severity framing ---
    docs.append(_conflict_doc(artifact))
    return docs


def _conflict_doc(artifact: TrajectoryArtifact) -> dict:
    from collections import Counter
    conflicts = artifact.conflicts or []
    by_type = Counter(c.type for c in conflicts)
    top = sorted(conflicts, key=lambda c: c.severity, reverse=True)[:5]
    lines = [
        f"Total near-miss events observed in this run: {len(conflicts)}. These are SURROGATE safety measures "
        "(time-to-collision, post-encroachment-time, hard braking) — they are NOT crashes and NOT a crash "
        "prediction. Severity is ORDINAL: higher = more severe in this run, never a rate or probability. The "
        "direction of the safety change is not claimed (it is not stable across random seeds).",
        "Counts by event type: " + (", ".join(f"{t}: {n}" for t, n in by_type.most_common()) or "none") + ".",
    ]
    if top:
        lines.append("Most severe events observed (ordinal severity): "
                     + "; ".join(f"{c.type} at severity {c.severity:.2f}" for c in top) + ".")
    return _doc("conflicts", "Near-miss (surrogate safety) event summary", "\n".join(lines))


# ===================================================================================================
# Source-handle → human label (used by server.py to render the "drew on…" sources line)
# ===================================================================================================

def _persona_labels() -> dict[str, str]:
    return {p.id: p.label for p in personas_mod.load_personas()}


def friendly_source(handle: str) -> str:
    """Turn a citation handle (the retrieved file_path) into a human label for the answer's sources line."""
    parts = handle.split("__")
    kind = parts[0]
    if kind == "voice" and len(parts) >= 2:
        return f"{_persona_labels().get(parts[1], parts[1])} (voice)"
    if kind == "institution" and len(parts) >= 2:
        return f"Institutional perspective ({parts[1]}, mandate lens)"
    if kind == "scorecard" and len(parts) >= 2:
        return f"{report.GROUP_LABEL.get(parts[1], parts[1])} scorecard row"
    if kind == "limitation" and len(parts) >= 2:
        return f"Limitation: {parts[1].replace('_', ' ')}"
    if kind == "engaged_reach" and len(parts) >= 2:
        return f"Argument engagement (cascade {parts[1]})"
    if kind == "movement" and len(parts) >= 2:
        return f"Opinion movement (cascade {parts[1]})"
    if kind == "zone":
        return "School-zone conflict lens"
    return {"change": "The proposed change", "robustness": "Cross-seed robustness",
            "conflicts": "Near-miss event summary", "divergence": "Cascade divergence",
            "exclusions": "Posts withheld by the guard"}.get(kind, handle)


# ===================================================================================================
# Embedding PIN — the vector store is built at a FIXED (model, dim). LightRAG's vdb files record the dim but
# NOT the model, so a same-dim model swap would silently corrupt retrieval. Pin (model, dim, backend) explicitly
# and refuse to open an index whose embedder no longer matches.
# ===================================================================================================

class EmbeddingPinMismatch(Exception):
    """Raised when an existing index was built with a different embedder than the current one."""


def embedding_meta() -> dict:
    return {"model": EMBED_MODEL, "dim": EMBED_DIM, "backend": EMBED_BACKEND}


def _pin_path(working_dir: Path | str) -> Path:
    return Path(working_dir) / "embedding_meta.json"


def write_embedding_pin(working_dir: Path | str) -> None:
    _pin_path(working_dir).write_text(json.dumps(embedding_meta(), indent=2), encoding="utf-8")


def check_embedding_pin(working_dir: Path | str) -> None:
    """Assert the current embedder matches this index's pin. Missing pin = legacy/fresh index → no-op. On any
    mismatch, raise loudly with BOTH configs named."""
    path = _pin_path(working_dir)
    if not path.is_file():
        return
    pinned = json.loads(path.read_text(encoding="utf-8"))
    current = embedding_meta()
    if pinned != current:
        raise EmbeddingPinMismatch(
            f"embedding config mismatch for {Path(working_dir).name}: index was built with {pinned}, but the "
            f"current embedder is {current}. Rebuild the index (report_agent.py --rebuild) or restore the "
            f"matching embedder.")


# ===================================================================================================
# Index build + resolution (LightRAG / torch imported lazily here)
# ===================================================================================================

def make_rag(working_dir: Path | str):
    """Shared LightRAG factory (used by the index build AND by server.py) — DeepSeek LLM + local MiniLM embed.
    Refuses to open an index whose embedding pin no longer matches (checked BEFORE loading the model)."""
    from functools import partial

    from lightrag import LightRAG
    from lightrag.llm.hf import hf_embed
    from lightrag.llm.openai import openai_complete_if_cache
    from lightrag.utils import EmbeddingFunc
    from transformers import AutoModel, AutoTokenizer

    check_embedding_pin(working_dir)  # fail cheap (before torch) on a mismatched embedder
    llm_provider._load_env()
    _, _, key_env, _ = llm_provider.PROVIDER_PRESETS["deepseek"]
    ds_key = os.environ.get(key_env)
    if not ds_key:
        raise SystemExit(f"{key_env} is not set (put it in python/.env).")

    async def llm_func(prompt, system_prompt=None, history_messages=None, keyword_extraction=False, **kwargs):
        # deepseek-v4-flash (successor to the retired deepseek-chat) defaults thinking ON — force it off, else the
        # ~230-doc index build is slow + bills reasoning as output. LightRAG forwards **kwargs to the OpenAI SDK.
        eb = dict(kwargs.pop("extra_body", {}) or {})
        eb["thinking"] = {"type": "disabled"}
        return await openai_complete_if_cache(
            "deepseek-v4-flash", prompt, system_prompt=system_prompt, history_messages=history_messages or [],
            api_key=ds_key, base_url="https://api.deepseek.com/v1", extra_body=eb, **kwargs)

    tokenizer = AutoTokenizer.from_pretrained(EMBED_MODEL)
    embed_model = AutoModel.from_pretrained(EMBED_MODEL)
    return LightRAG(
        working_dir=str(working_dir), llm_model_func=llm_func, llm_model_name="deepseek-v4-flash",
        llm_model_max_async=MAX_LLM_ASYNC,
        embedding_func=EmbeddingFunc(embedding_dim=EMBED_DIM, max_token_size=512,
                                     func=partial(hf_embed.func, tokenizer=tokenizer, embed_model=embed_model)))


def index_dir(ts: str) -> Path:
    return INDEX_ROOT / f"index-{ts}"


def newest_index() -> tuple[Path, str] | None:
    if not INDEX_ROOT.exists():
        return None
    dirs = sorted(INDEX_ROOT.glob("index-*"))
    if not dirs:
        return None
    d = dirs[-1]
    return d, d.name.replace("index-", "")


def build_index(run_id: str | None = None, rebuild: bool = False) -> tuple[Path, int]:
    import asyncio
    import shutil

    art_path, ts = report._resolve(run_id)
    artifact = trajectory_io.load_artifact(art_path)
    outcomes = json.loads((RUNS_DIR / f"outcomes-{ts}.json").read_text(encoding="utf-8"))
    if outcomes.get("scenario_run_id") != artifact.meta.run_id:
        raise SystemExit(f"run-id mismatch: outcomes {outcomes.get('scenario_run_id')!r} != "
                         f"artifact {artifact.meta.run_id!r}")
    verdict = report._load_verdict(ts, artifact)

    docs = build_corpus(artifact, outcomes, verdict)
    wd = index_dir(ts)
    if rebuild and wd.exists():
        shutil.rmtree(wd)
    wd.mkdir(parents=True, exist_ok=True)
    write_embedding_pin(wd)  # pin the embedder so a later mismatched open fails loudly
    print(f"[report_agent] run={artifact.meta.run_id} · {len(docs)} corpus docs · indexing into {wd} …")

    async def run() -> None:
        rag = make_rag(wd)
        await rag.initialize_storages()
        try:
            # Re-runnable: LightRAG's doc_status skips already-indexed docs; --rebuild wipes first.
            await rag.ainsert([d["text"] for d in docs], file_paths=[d["source"] for d in docs])
        finally:
            await rag.finalize_storages()

    asyncio.run(run())
    print(f"[report_agent] done — {len(docs)} docs indexed at {wd}")

    # V2.3d — refresh the ENTITY half of the graphs sidecar from the just-built graphml (soft-fail:
    # the index itself is complete; a layout failure must not fail the report enrich). Covers both
    # the server report-enrich and CLI rebuilds.
    try:
        import graph_export

        graph_export.export_for_run(artifact.meta.run_id, halves=("entity",))
    except Exception as exc:  # noqa: BLE001
        print(f"[report_agent] graphs sidecar export FAILED ({exc}) — backfill: "
              f"python python/src/graph_export.py --run-id {artifact.meta.run_id}", flush=True)

    return wd, len(docs)


def main() -> None:
    ap = argparse.ArgumentParser(description="Build the per-run LightRAG index for the report agent (Phase 3.2).")
    ap.add_argument("--run-id", default=None, help="artifact stem (default: newest multimodal-scenario)")
    ap.add_argument("--rebuild", action="store_true", help="delete any existing index-<ts>/ first")
    args = ap.parse_args()
    try:
        build_index(args.run_id, rebuild=args.rebuild)
    except EmbeddingPinMismatch as e:  # print the named-configs message cleanly, no traceback
        raise SystemExit(f"[report_agent] {e}")


if __name__ == "__main__":
    main()
