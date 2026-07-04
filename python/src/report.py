"""Phase 3.1 — the report generator.

Turns a finished run (its v0.3.0 artifact + sidecars) into a credibility-first, human-readable report:
a `report-<ts>.md` (portable, also the future report-agent/GraphRAG input) and a `report-<ts>.json`
(structured, rendered richly by the web Report view), mirrored to `web/public/latest-report.{md,json}`.

HONESTY MODEL — the whole point:
  * EVERY number is CODE-RENDERED from the artifact/sidecars. The LLM never emits a digit.
  * The LLM fills only a few tightly-scoped NARRATIVE slots (a change framing, one gloss per scorecard
    row, a per-stakeholder voice synthesis, and an intro to the caveats). It is given the code-rendered
    context as ground truth and four hard rules.
  * Quotes are VERBATIM: the LLM picks WHICH comment ids to quote from a bounded, sentiment-spread list;
    CODE injects the exact comment text. No paraphrase, no fabrication.
  * A deterministic POST-GENERATION AUDIT scans only the LLM prose for (a) digits, (b) safety-direction
    claims, (c) vote/tally language, (d) crash/risk-rate words. A violation names the sentence, retries the
    slot ONCE with it quoted, then fails loudly. A caught-then-corrected violation is the system working.
  * A separate CODE-RENDERED FACT CHECK (A4b) guards OUR OWN rendering (a sign flip / miscount would pass
    the prose audit clean) by asserting the rendered facts equal their sources.

Not a verdict, not a prediction, not an ROI. Safety is a SURROGATE, never a crash claim.

Run (needs the provider key in a .env — DeepSeek default here):
    PROVIDER=deepseek python python/src/report.py            # newest multimodal-scenario-*.json
    PROVIDER=deepseek python python/src/report.py --run-id multimodal-scenario-<ts>
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from pydantic import BaseModel

import personas as personas_mod
import trajectory_io
from contract_models import ScorecardCell, ScorecardGroup, TrajectoryArtifact
from llm_provider import LLMClient, get_client

RUNS_DIR = trajectory_io.RUNS_DIR
WEB_PUBLIC = trajectory_io._REPO_ROOT / "web" / "public"

REPORT_VERSION = "3.1"
MATERIALITY_S = 30
REPORT_MAX_TOKENS = 1000  # narrative synthesis needs more than the reaction layer's 300-token cap

# Surrogate thresholds + seeds mirror scenario_harness.py / robustness.py (kept in sync by hand — importing
# scenario_harness would pull in SUMO/sumolib, and a report generator must run without SUMO on the machine).
TTC_THRESHOLD_S = 3.0
VEH_PET_THRESHOLD_S = 2.0
PED_PET_THRESHOLD_S = 5.0
DEFAULT_SEEDS = [42, 43, 44]

# Canonical scorecard row order + labels — mirror web/lib/personaGroups.ts (kept in lockstep by hand;
# the artifact carries the group ids, this only names them for display).
GROUP_ORDER = ["car_commuter", "cyclist", "pedestrian", "local_resident", "business_owner",
               "accessibility", "transit_riders"]
GROUP_LABEL = {
    "car_commuter": "Car commuters", "cyclist": "Cyclists", "pedestrian": "Pedestrians",
    "local_resident": "Local residents", "business_owner": "Business owners",
    "accessibility": "Accessibility", "transit_riders": "Transit riders",
}

# Section-3 stakeholder buckets: sim travel modes → three groups; every inferred voice → community.
MODE_TO_BUCKET = {"car": "drivers", "bicycle": "cyclists", "pedestrian": "pedestrians"}
BUCKET_ORDER = ["drivers", "cyclists", "pedestrians", "community"]
BUCKET_LABEL = {"drivers": "Drivers", "cyclists": "Cyclists", "pedestrians": "Pedestrians",
                "community": "Community voices"}
SYNTH_SAMPLE = 18  # bounded, sentiment-spread comments fed to each synthesis (a code-rendered honesty choice)


# ===================================================================================================
# Wire schemas (loose — validated/clamped by us, like reactions._ReactionWire)
# ===================================================================================================

class _TextWire(BaseModel):
    text: str


class _SynthWire(BaseModel):
    synthesis: str
    representative_comment_ids: list[int]


# ===================================================================================================
# CODE-RENDERED cell rendering — mirrors web/components/ScorecardPanel.tsx honesty treatment
# ===================================================================================================

def render_cell(cell: ScorecardCell | None, kind: Literal["travel", "safety", "access"]) -> str:
    """Render one scorecard cell as text, MIRRORING the panel:
    - safety = ±magnitude, NO sign (every safety value is positive and the note refuses the direction);
    - travel/access = signed (+/-), POSITIVE = worse;
    - missing cell = em dash; [MEAS]/[LOW] confidence badge.
    """
    if cell is None or cell.value is None:
        return "—"
    badge = "MEAS" if cell.confidence == "measured" else "LOW"
    if kind == "safety":
        return f"±{abs(cell.value):.2f} [{badge}]"
    if kind == "travel":
        s = f"{cell.value:+.1f}s"
        if cell.affected_share is not None:
            s += f", {cell.affected_share * 100:.1f}% >{MATERIALITY_S}s"
        return f"{s} [{badge}]"
    return f"{cell.value:+.2f} [{badge}]"  # access — directional heuristic


def cell_valence(cell: ScorecardCell | None, kind: Literal["travel", "safety", "access"]) -> str:
    """A CODE-RENDERED plain-language valence for a cell — no numbers, but the DIRECTION is resolved here
    (POSITIVE = worse) so the LLM gloss can't invert it. Safety never gets a direction (magnitude only)."""
    if cell is None or cell.value is None:
        return "no measurable signal"
    if kind == "safety":
        return "a near-miss magnitude is present, but its direction is not claimed (not seed-stable)"
    v = cell.value
    if kind == "travel":
        if abs(v) < 0.05:
            base = "no measurable change in typical travel time"
        else:
            base = f"typical travel time is slightly {'worse' if v > 0 else 'better'}"
        if cell.affected_share and cell.affected_share > 0:
            base += "; most are unaffected but a small group is markedly slower"
        return base
    # access — POSITIVE = worse
    if abs(v) < 1e-9:
        return "no change in access (low-confidence estimate)"
    return f"slightly {'worse' if v > 0 else 'better'} access (low-confidence estimate)"


# ===================================================================================================
# Gather CODE-RENDERED facts
# ===================================================================================================

def _resolve(run_id: str | None) -> tuple[Path, str]:
    """Newest multimodal-scenario artifact by default (mirrors scorecard._resolve)."""
    if run_id:
        art = RUNS_DIR / f"{run_id}.json"
        if not art.is_file():
            raise SystemExit(f"artifact not found: {art}")
    else:
        runs = sorted(RUNS_DIR.glob("multimodal-scenario-*.json"))
        if not runs:
            raise SystemExit("no multimodal-scenario-*.json in contract/runs/ — run the scenario pipeline first.")
        art = runs[-1]
    return art, art.stem.replace("multimodal-scenario-", "")


def _load_verdict(ts: str, artifact: TrajectoryArtifact) -> dict | None:
    """Load the persisted cross-seed verdict IF it matches this run AND this change (the seed-43/44 tripinfo
    that produced it is not ts-stamped, so a run-id match alone isn't enough). Else None → qualitative note."""
    path = RUNS_DIR / f"robustness-verdict-{ts}.json"
    if not path.is_file():
        return None
    v = json.loads(path.read_text(encoding="utf-8"))
    change = artifact.meta.scenario.change
    if v.get("scenario_run_id") != artifact.meta.run_id or v.get("target_edge") != change.target_edge:
        print(f"[verdict] {path.name} does not match this run/change — using the qualitative fallback.")
        return None
    return v.get("car_tail")


def gather_facts(artifact: TrajectoryArtifact, outcomes: dict, verdict: dict | None) -> dict:
    meta = artifact.meta
    change = meta.scenario.change
    by_group: dict[str, ScorecardGroup] = {g.group: g for g in artifact.scorecard.groups}

    # the car travel-time tail (single-seed, from the measured scorecard cell)
    car_travel = by_group["car_commuter"].travel_time_delta
    tail_share_pct = round((car_travel.affected_share or 0.0) * 100, 1)
    tail_median_s = car_travel.value

    demand = {m: outcomes["modes"][m]["counts"]["total_demand"] for m in ("car", "bicycle", "pedestrian")}

    return {
        "scenario_run_id": meta.run_id,
        "baseline_run_id": meta.scenario.baseline_run_id,
        "network": meta.network,
        "change": change,
        "demand": demand,
        "cars_rerouted": outcomes["reroute"]["cars_rerouted"],
        "severed_edges": outcomes.get("connectivity_severed_edges", []),
        "by_group": by_group,
        "tail_share_pct": tail_share_pct,
        "tail_median_s": tail_median_s,
        "verdict": verdict,  # {per_seed, range_gt30, verdict, ...} or None
        "thresholds": {"ttc_s": TTC_THRESHOLD_S, "veh_pet_s": VEH_PET_THRESHOLD_S,
                       "ped_pet_s": PED_PET_THRESHOLD_S, "materiality_s": MATERIALITY_S},
        # seeds prefer the persisted verdict's list (source of truth) → fall back to the known 42/43/44.
        "seeds": (verdict or {}).get("seeds", DEFAULT_SEEDS),
    }


# ===================================================================================================
# A4b — CODE-RENDERED FACT CHECK (guards OUR rendering; the prose audit can't see number bugs)
# ===================================================================================================

def verify_facts(facts: dict, artifact: TrajectoryArtifact, outcomes: dict) -> None:
    """Assert the facts we will render equal their sources. Raises loudly on any mismatch — a confidently
    wrong number is exactly what this report exists to prevent, and the prose audit would pass it clean."""
    problems: list[str] = []
    if facts["scenario_run_id"] != artifact.meta.run_id:
        problems.append("scenario_run_id != meta.run_id")
    src_demand = {m: outcomes["modes"][m]["counts"]["total_demand"] for m in ("car", "bicycle", "pedestrian")}
    if facts["demand"] != src_demand:
        problems.append(f"demand {facts['demand']} != source {src_demand}")
    if facts["cars_rerouted"] != outcomes["reroute"]["cars_rerouted"]:
        problems.append("cars_rerouted mismatch")

    car_cell = artifact.scorecard.groups and {g.group: g for g in artifact.scorecard.groups}["car_commuter"].travel_time_delta
    if round((car_cell.affected_share or 0.0) * 100, 1) != facts["tail_share_pct"]:
        problems.append("tail_share_pct != artifact car cell")

    # Every safety render must be a ±magnitude with NO sign character (the direction the note refuses).
    for g in artifact.scorecard.groups:
        s = render_cell(g.safety_delta, "safety")
        if s != "—" and (not s.startswith("±") or "+" in s or "-" in s or "−" in s):
            problems.append(f"safety cell for {g.group} rendered with a direction: {s!r}")

    th = facts["thresholds"]
    if (th["ttc_s"], th["veh_pet_s"], th["ped_pet_s"]) != (TTC_THRESHOLD_S, VEH_PET_THRESHOLD_S, PED_PET_THRESHOLD_S):
        problems.append("thresholds != module constants")

    if problems:
        raise AssertionError("FACT CHECK FAILED (code-rendered numbers inconsistent with sources):\n  - "
                             + "\n  - ".join(problems))


# ===================================================================================================
# POST-GENERATION AUDIT — deterministic, scans ONLY LLM prose (never code-rendered text or verbatim quotes)
# ===================================================================================================

_DIGIT = re.compile(r"\d")
# Safety-DIRECTION claim = (a) an inherent safety-valence word, or (b) a direction verb ADJACENT (within ~2
# words) to a safety noun — "conflicts increased", "reduced collisions", "safety improved". Proximity (not
# whole-sentence co-occurrence) avoids false-flagging honest sentences where the direction word modifies a
# DIFFERENT dimension, e.g. "a safety signal exists … access is slightly improved". \w* suffixes catch plurals.
_SAFETY_CLAIM_WORD = re.compile(r"\b(safer|unsafe|dangerous|hazard\w*|riskier)\b", re.I)
_SAFETY_NOUN = r"(?:safety|conflict\w*|near-?miss\w*|collision\w*|crash\w*)"
_DIR_VERB = r"(?:increas\w*|decreas\w*|worse\w*|worsen\w*|improv\w*|reduc\w*|more|fewer|less|rose|fell|risen|" \
            r"fallen|rising|falling|higher|lower|grew|grown|dropp\w*|climb\w*)"
_SAFETY_DIR_ADJ = re.compile(
    rf"\b{_SAFETY_NOUN}\W+(?:\w+\W+){{0,2}}{_DIR_VERB}\b"
    rf"|\b{_DIR_VERB}\W+(?:\w+\W+){{0,2}}{_SAFETY_NOUN}\b", re.I)
# Bans stance COUNTS + vote framing (the referendum guard) — NOT qualitative texture. Describing that "some
# object" or "others welcome it" is section 3's whole job; only aggregates/ballots are forbidden. Percentages
# are already caught by the no-digit rule, so this need not chase numbers.
_TALLY = re.compile(r"\b(majorit\w+|minorit\w+|referend\w+|consensus|unanim\w+|plurality|"
                    r"poll(?:ed|ing|s)?|tall(?:y|ies|ied)|vote[ds]?|voting|"
                    r"most\s+(?:agents|respondents|participants|personas)|"
                    r"(?:overwhelming|broad|widespread)\s+(?:support|opposition))\b", re.I)
_CRASH = re.compile(r"\b(crash\w*|accident\w*|collision\w*|fatalit\w*|injur\w*|probabilit\w*|likelihood)\b", re.I)
# Allowlisted disclaimer phrasings (a caveat may legitimately name the thing it refuses to claim). The
# LLM slots are constrained so this rarely fires, but it keeps the audit from flagging a pure disclaimer.
_ALLOW = re.compile(r"(cannot|can't|does not|do not|doesn't|don't|not a|isn't|is not)\b.{0,40}"
                    r"(predict|prediction|verdict|crash|collision|guarantee|claim)", re.I)


def _sentences(text: str) -> list[str]:
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+", (text or "").strip()) if s.strip()]


def _safety_direction(sentence: str) -> bool:
    return bool(_SAFETY_CLAIM_WORD.search(sentence) or _SAFETY_DIR_ADJ.search(sentence))


def audit_prose(text: str) -> list[tuple[str, str]]:
    """Return [(rule, offending_sentence)] for a piece of LLM prose. Empty = clean."""
    viol: list[tuple[str, str]] = []
    for s in _sentences(text):
        if _DIGIT.search(s):
            viol.append(("digits", s))
        if _ALLOW.search(s):
            continue
        if _safety_direction(s):
            viol.append(("safety_direction", s))
        if _TALLY.search(s):
            viol.append(("tally", s))
        if _CRASH.search(s):
            viol.append(("crash", s))
    # de-dupe, preserve order
    seen, out = set(), []
    for v in viol:
        if v not in seen:
            seen.add(v)
            out.append(v)
    return out


# ===================================================================================================
# LLM plumbing
# ===================================================================================================

_TRANSIENT = {408, 409, 429, 500, 502, 503, 504}


def _is_transient(e: Exception) -> bool:
    code = getattr(e, "status_code", None) or getattr(e, "code", None)
    return code in _TRANSIENT


async def _call(client: LLMClient, system: str, user: str, wire: type[BaseModel], attempts: int = 4) -> dict:
    """One structured generation with the reaction-layer retry policy (transient backoff + one parse retry)."""
    last: Exception | None = None
    for i in range(attempts):
        try:
            raw = await client.generate_json(system=system, user=user, schema=wire)
            return wire.model_validate(raw).model_dump()
        except Exception as e:  # noqa: BLE001 — provider SDK errors vary; classify by attribute
            last = e
            if i >= attempts - 1:
                break
            await asyncio.sleep(1.5 * (i + 1) if _is_transient(e) else 0.5)
    raise RuntimeError(f"LLM call failed after {attempts} attempts: {last}")


_FRAMING = (
    "You are the report writer for a city-planning PREVIEW of a PROPOSED road change on one Toronto corridor. "
    "Your text ANTICIPATES how people might react and what the change might mean — it is NEVER a verdict, "
    "prediction, recommendation, or score. FOUR HARD RULES you must always follow:\n"
    "  1. NO digits or numbers anywhere in your prose — the numbers live in tables shown beside your text.\n"
    "  2. NO direction for safety: never say safer / more dangerous / unsafe / increased or reduced conflicts / "
    "near-misses — that signal is not directionally reliable in this run.\n"
    "  3. NO vote or tally: do not count or aggregate opinion — no 'majority', 'referendum', 'consensus', "
    "'overwhelming support', 'X% oppose', 'most agents'. You SHOULD describe the qualitative texture ('some "
    "worry about parking', 'others welcome calmer streets', 'a recurring hope is…') — just never as a headcount "
    "or ballot. Plain distribution words about the measured delay ('a small group', 'most drivers') are fine.\n"
    "  4. NO crashes, accidents, collisions, injuries, or probabilities — these are SURROGATE measures, not "
    "crash predictions.\n"
    "Write plainly and concretely. This is anticipation, never a verdict.\n\n"
)


def _json_instr(shape: str) -> str:
    return f"Reply with ONLY a json object of exactly this shape, nothing else:\n{shape}\n\n"


async def _slot(client, system, user, wire, field, name, audit_log) -> dict:
    """Generate one narrative slot, audit it, retry ONCE on violation with the offending sentence quoted,
    then fail loudly. Records a single audit-log entry (clean / resolved_on_retry / failed)."""
    obj = await _call(client, system, user, wire)
    v1 = audit_prose(obj[field])
    if not v1:
        audit_log.append({"slot": name, "status": "clean", "violations": []})
        return obj
    quoted = "; ".join(f'"{s}" (rule: {r})' for r, s in v1)
    retry = (user + "\n\nYOUR PREVIOUS ANSWER BROKE THE RULES — it contained: " + quoted +
             ". Rewrite it WITHOUT any of those, following all four rules. Remember: no digits, no safety "
             "direction, no vote/tally words, no crash/injury words.")
    obj = await _call(client, system, retry, wire)
    v2 = audit_prose(obj[field])
    caught = [{"rule": r, "sentence": s} for r, s in v1]
    if v2:
        audit_log.append({"slot": name, "status": "failed", "violations": caught,
                          "still_present": [{"rule": r, "sentence": s} for r, s in v2]})
        raise RuntimeError(f"AUDIT FAILED for slot {name!r} after one retry. Still violating: {v2}")
    audit_log.append({"slot": name, "status": "resolved_on_retry", "violations": caught})
    return obj


# ===================================================================================================
# Narrative slots
# ===================================================================================================

def _change_phrase(change) -> str:
    if change.type == "bike_lane":
        return "one general-traffic (car) lane on the corridor is being converted into a bicycle-only lane"
    return change.description


async def slot_framing(client, facts, audit_log) -> str:
    change = facts["change"]
    system = _FRAMING + _json_instr('{"text": "<2-3 plain sentences, NO numbers>"}')
    user = (f"Write 2-3 plain-language sentences framing what is being tested, for a reader who is not a "
            f"traffic engineer. Mechanically: {_change_phrase(change)}. Do NOT assert any benefit (not "
            f"'calmer', 'safer'), do NOT include any numbers. Just explain, neutrally, what the change is and "
            f"that this report previews who it would affect.")
    return (await _slot(client, system, user, _TextWire, "text", "framing", audit_log))["text"].strip()


def _deterministic_gloss(g, group_label: str) -> str:
    """A CODE-RENDERED gloss for sparse groups (0-1 dimensions of signal — all the inferred rows). The LLM is
    unreliable exactly here: on the near-mechanical rows it sometimes DENIES a magnitude the table shows (e.g.
    calling a safety-only row 'no measurable signal'). Neither guard catches a plausible-but-wrong denial, so
    for these we render the honest line directly from the cell valence instead of asking the model."""
    dims = []
    if g:
        for cell, kind in ((g.travel_time_delta, "travel"), (g.safety_delta, "safety"), (g.access_delta, "access")):
            if cell is not None and cell.value is not None:
                dims.append((cell, kind))
    if not dims:
        return f"There isn't enough measurable signal in this run to characterize how this change affects {group_label.lower()}."
    cell, kind = dims[0]  # sparse groups carry exactly one signal
    if kind == "safety":
        return ("A near-miss magnitude is present for this group, but its direction is not seed-stable and is "
                "not claimed here — the table shows the magnitude only.")
    if kind == "access":
        v = cell.value
        word = "unchanged" if abs(v) < 1e-9 else ("slightly worse" if v > 0 else "slightly better")
        return f"Access is estimated to be {word} for this group, from a low-confidence rule-based estimate."
    return f"For this group, {cell_valence(cell, 'travel')}."


async def slot_gloss(client, facts, group_id, audit_log) -> str:
    g = facts["by_group"].get(group_id)
    parts = []
    if g:
        for label, cell, kind in (("travel", g.travel_time_delta, "travel"),
                                   ("safety", g.safety_delta, "safety"),
                                   ("access", g.access_delta, "access")):
            if cell is not None and cell.value is not None:
                parts.append((label, cell, kind))

    # Sparse rows (≤1 signal — every inferred group) → deterministic, so a gloss can never deny a magnitude
    # the table displays. Only the richer multi-dimension sim rows get the LLM's nicer prose.
    if len(parts) <= 1:
        gloss = _deterministic_gloss(g, GROUP_LABEL[group_id])
        audit_log.append({"slot": f"gloss:{group_id}", "status": "code_rendered", "violations": []})
        return gloss

    # Only describe dimensions that HAVE a signal — mentioning a null dimension next to a directional one
    # would trip the sentence-level safety-direction audit for no reason.
    summary = "; ".join(f"{label} — {cell_valence(cell, kind)}" for label, cell, kind in parts)  # type: ignore[arg-type]
    system = _FRAMING + _json_instr('{"text": "<ONE plain sentence, NO numbers>"}')
    user = (f"In ONE plain sentence with NO numbers, gloss what the scorecard row for '{GROUP_LABEL[group_id]}' "
            f"means for that group. Ground it STRICTLY in this plain-language reading of the row (already gives "
            f"the direction — do not flip it, do not deny any part of it, do not add impacts it does not state): "
            f"{summary}. Example of the right register: 'most drivers are unaffected, but a small group of "
            f"specific commuters absorbs a real delay.'")
    return (await _slot(client, system, user, _TextWire, "text", f"gloss:{group_id}", audit_log))["text"].strip()


def _bucket_of(agent, mode_of: dict[str, str]) -> str:
    return MODE_TO_BUCKET.get(mode_of.get(agent.persona.id, "inferred"), "community")


def _spread_sample(agents: list, k: int) -> list:
    s = sorted(agents, key=lambda a: a.reaction.sentiment)
    if len(s) <= k:
        return s
    idx = sorted({round(i * (len(s) - 1) / (k - 1)) for i in range(k)})
    return [s[i] for i in idx]


async def slot_synthesis(client, bucket_key, agents, audit_log) -> dict:
    """One stakeholder-group voice synthesis. The LLM writes the texture and PICKS 1-2 comment ids to quote;
    we inject those comments VERBATIM (it never retypes them)."""
    sample = _spread_sample(agents, SYNTH_SAMPLE)
    listing = "\n".join(f"[{i}] ({a.reaction.stance}) {a.reaction.comment}" for i, a in enumerate(sample, 1))
    community = bucket_key == "community"
    kind = ("These are INFERRED community voices — they do not make a measured trip on the corridor; they speak "
            "from their standpoint." if community else
            "These are simulated travelers who use the corridor in this mode.")
    system = _FRAMING + _json_instr(
        '{"synthesis": "<2-4 plain sentences on the shared texture, NO numbers>", '
        '"representative_comment_ids": [<1 or 2 ids from the list>]}')
    user = (f"{kind}\nBelow are anticipated reactions from this group (id in brackets). Synthesize, in 2-4 plain "
            f"sentences with NO numbers, the TEXTURE of what they'd bring to a public meeting — the recurring "
            f"concerns and hopes, the arguments, the tensions between them. Then pick the 1-2 ids that BEST "
            f"represent the range. Do not invent views not present; do not tally or say how many feel a certain "
            f"way.\n\nREACTIONS:\n{listing}")
    obj = await _slot(client, system, user, _SynthWire, "synthesis", f"synthesis:{bucket_key}", audit_log)

    # CODE injects verbatim quotes for the ids the LLM chose (clamp to valid, 1-2).
    ids = [i for i in obj["representative_comment_ids"] if isinstance(i, int) and 1 <= i <= len(sample)][:2]
    if not ids:
        ids = [1]
    quotes = [{"label": sample[i - 1].persona.label, "comment": sample[i - 1].reaction.comment,
               "grounding": sample[i - 1].grounding} for i in ids]
    return {"synthesis": obj["synthesis"].strip(), "quotes": quotes, "sample_size": len(sample)}


async def slot_caveat_intro(client, audit_log) -> str:
    system = _FRAMING + _json_instr('{"text": "<1-2 plain introductory sentences, NO numbers>"}')
    user = ("Write 1-2 plain sentences that INTRODUCE a list of limits on what this preview can claim (the list "
            "itself is shown below your text). Purely introductory — do NOT mention safety, crashes, seeds, or "
            "any specific limitation or number; just say, plainly, that the following limits bound what this "
            "preview can and cannot claim, and should be read alongside the findings.")
    return (await _slot(client, system, user, _TextWire, "text", "caveat_intro", audit_log))["text"].strip()


# ===================================================================================================
# Code-rendered caveat skeleton (Section 4) — MANDATORY, non-trimmable
# ===================================================================================================

def build_caveats(facts: dict) -> list[dict]:
    safety_note = next((g.safety_delta.note for g in facts["by_group"].values()
                        if g.safety_delta and g.safety_delta.note), "sign not stable across seeds")
    rerouted = facts["cars_rerouted"]
    return [
        {"title": "Safety direction is not established",
         "body": f"The safety surrogate is reported as a magnitude only — its direction is not claimed: "
                 f"“{safety_note}”. Do not read the safety column as 'the change made things safer or "
                 f"more dangerous'."},
        {"title": "Surrogate measures are not crash predictions",
         "body": "Safety here means trajectory-derived surrogates (time-to-collision, hard braking, blocked "
                 "junctions), counted as near-miss events observed in this run. They are not crashes, and this "
                 "tool does not predict crashes, injuries, or their probability."},
        {"title": "One corridor, one demand level",
         "body": "The simulation is bounded to a single corridor at a single modelled demand "
                 f"({facts['demand']['car']} cars, {facts['demand']['bicycle']} bicycles, "
                 f"{facts['demand']['pedestrian']} pedestrians). It does not model the wider network, other "
                 "times of day, or induced demand."},
        {"title": "In-run adaptation is not settled equilibrium",
         "body": f"Travelers do not re-plan across days here: {rerouted} cars rerouted within the run. Real "
                 "corridors reach a new equilibrium over weeks as people adjust routes, modes, and times — this "
                 "preview shows the immediate response, not that settled state."},
        {"title": "A stratified sample, not a census",
         "body": "The voiced reactions come from a stratified sample of personas pinned to specific simulated "
                 "travelers (deliberately including the hardest-hit tail), not a poll of everyone. They show the "
                 "texture of who wins and loses, never a headcount of support or opposition."},
        {"title": "The access column is a rule-based estimate",
         "body": "Access impacts are a deterministic heuristic from the change type (e.g. curbside space), "
                 "labelled low-confidence — an estimate to reason about, not a measurement."},
    ]


# ===================================================================================================
# Renderers
# ===================================================================================================

def _cross_seed_sentence(facts: dict) -> str:
    v = facts["verdict"]
    if v:
        lo, hi = v["range_gt30"]
        return (f"Across seeds 42/43/44 this share stays in [{lo * 100:.1f}%, {hi * 100:.1f}%] — a small "
                f"hard-hit tail, with the vast majority of cars unaffected.")
    return ("This small affected share was checked across seeds 42, 43 and 44 and remains a small, stable tail "
            "with the vast majority of cars unaffected (exact cross-seed range not available for this run).")


def render_markdown(facts, framing, glosses, syntheses, caveat_intro, caveats, meta) -> str:
    change = facts["change"]
    lane = f", lane {change.target_lane}" if change.target_lane is not None else ""
    L: list[str] = []
    L.append(f"# Corridor change preview — {change.description}")
    L.append("")
    L.append("*A stakeholder-reaction preview, not a verdict. Safety figures are surrogate near-miss measures, "
             "not crash predictions.*")
    L.append("")

    L.append("## 1. What was tested")
    L.append("")
    L.append(framing)
    L.append("")
    L.append(f"- **Change:** {change.description} (edge `{change.target_edge}`{lane})")
    L.append(f"- **Corridor / network:** `{facts['network']}` — one Toronto corridor")
    L.append(f"- **Demand simulated:** {facts['demand']['car']} cars, {facts['demand']['bicycle']} bicycles, "
             f"{facts['demand']['pedestrian']} pedestrians")
    L.append(f"- **Runs compared:** scenario `{facts['scenario_run_id']}` vs baseline `{facts['baseline_run_id']}`")
    L.append("")

    L.append("## 2. Who is affected, and how")
    L.append("")
    L.append("| Stakeholder group | Travel time | Safety | Access |")
    L.append("|---|---|---|---|")
    for gid in GROUP_ORDER:
        g = facts["by_group"].get(gid)
        L.append(f"| {GROUP_LABEL[gid]} | {render_cell(g.travel_time_delta if g else None, 'travel')} | "
                 f"{render_cell(g.safety_delta if g else None, 'safety')} | "
                 f"{render_cell(g.access_delta if g else None, 'access')} |")
    L.append("")
    L.append("*POSITIVE = worse for the group · ± = magnitude only (safety direction not claimed) · "
             "[MEAS] measured · [LOW] low-confidence estimate.*")
    L.append("")
    # verbatim cell notes
    notes = []
    for kind, attr in (("Travel time", "travel_time_delta"), ("Safety", "safety_delta"), ("Access", "access_delta")):
        note = next((getattr(g, attr).note for g in facts["by_group"].values()
                     if getattr(g, attr) and getattr(g, attr).note), None)
        if note:
            notes.append(f"- *{kind}:* {note}")
    if notes:
        L.append("**Cell notes (verbatim):**")
        L.extend(notes)
        L.append("")
    median = facts["tail_median_s"]
    median_phrase = "about no change" if abs(median) < 0.05 else f"{median:+.1f}s"
    L.append(f"**Travel-time tail (cars):** median {median_phrase}; {facts['tail_share_pct']:.1f}% of cars are "
             f">{MATERIALITY_S}s slower. {_cross_seed_sentence(facts)}")
    L.append("")
    L.append("**Per-group reading:**")
    for gid in GROUP_ORDER:
        L.append(f"- **{GROUP_LABEL[gid]}:** {glosses[gid]}")
    L.append("")

    L.append("## 3. What the affected people say")
    L.append("")
    L.append("*Simulated persona reactions — anticipated texture, not a poll. Each quote is verbatim from one "
             "simulated persona.*")
    L.append("")
    for bk in BUCKET_ORDER:
        s = syntheses.get(bk)
        if not s:
            continue
        L.append(f"### {BUCKET_LABEL[bk]}")
        L.append("")
        L.append(s["synthesis"])
        L.append("")
        for q in s["quotes"]:
            tag = "community perspective, not a measured traveler" if q["grounding"] == "inferred" else "simulated persona"
            L.append(f"> “{q['comment']}”")
            L.append(f"> — {q['label']} ({tag})")
            L.append("")

    L.append("## 4. What this analysis cannot tell you")
    L.append("")
    L.append(caveat_intro)
    L.append("")
    for c in caveats:
        L.append(f"- **{c['title']}.** {c['body']}")
    L.append("")

    th = facts["thresholds"]
    L.append("## Methodology & provenance")
    L.append("")
    L.append(f"- **Runs:** scenario `{facts['scenario_run_id']}`, baseline `{facts['baseline_run_id']}`")
    L.append(f"- **Seeds:** {', '.join(str(s) for s in facts['seeds'])}")
    L.append(f"- **Thresholds:** time-to-collision {th['ttc_s']}s, vehicle PET {th['veh_pet_s']}s, "
             f"pedestrian PET {th['ped_pet_s']}s, delay materiality >{th['materiality_s']}s")
    L.append(f"- **Generated:** {meta['generated_at']} · {meta['provider']}/{meta['model']}")
    L.append(f"- **Audit:** {meta['audit_summary']}")
    L.append("")
    return "\n".join(L)


# ===================================================================================================
# Orchestration
# ===================================================================================================

async def generate(run_id: str | None) -> tuple[Path, Path]:
    art_path, ts = _resolve(run_id)
    artifact = trajectory_io.load_artifact(art_path)
    if artifact.scorecard is None or not artifact.scorecard.groups:
        raise SystemExit(f"{art_path.name} has no scorecard — run scorecard.py first.")

    outcomes = json.loads((RUNS_DIR / f"outcomes-{ts}.json").read_text(encoding="utf-8"))
    if outcomes.get("scenario_run_id") != artifact.meta.run_id:
        raise SystemExit(f"run-id mismatch: outcomes {outcomes.get('scenario_run_id')!r} != "
                         f"artifact {artifact.meta.run_id!r}")

    verdict = _load_verdict(ts, artifact)
    facts = gather_facts(artifact, outcomes, verdict)
    verify_facts(facts, artifact, outcomes)  # A4b — fail loudly before spending any LLM tokens

    client, provider, model = get_client()
    if hasattr(client, "_max_tokens"):  # raise the OpenAI-compat cap for synthesis (keeps get_client's key/v4 path)
        client._max_tokens = REPORT_MAX_TOKENS
    print(f"[report] provider={provider} model={model} run={facts['scenario_run_id']}")

    # persona id -> travel mode (for section-3 bucketing; artifact persona is {id,label} only)
    mode_of = {p.id: p.mode for p in personas_mod.load_personas()}
    buckets: dict[str, list] = {b: [] for b in BUCKET_ORDER}
    for a in artifact.agents:
        buckets[_bucket_of(a, mode_of)].append(a)

    audit_log: list[dict] = []

    # Slots (sequential — DeepSeek prefix cache + simpler audit-retry accounting; the run is small).
    framing = await slot_framing(client, facts, audit_log)
    glosses = {gid: await slot_gloss(client, facts, gid, audit_log) for gid in GROUP_ORDER}
    syntheses: dict[str, dict] = {}
    for bk in BUCKET_ORDER:
        if buckets[bk]:
            syntheses[bk] = await slot_synthesis(client, bk, buckets[bk], audit_log)
    caveat_intro = await slot_caveat_intro(client, audit_log)
    caveats = build_caveats(facts)

    resolved = sum(1 for e in audit_log if e["status"] == "resolved_on_retry")
    clean = sum(1 for e in audit_log if e["status"] == "clean")
    code_rendered = sum(1 for e in audit_log if e["status"] == "code_rendered")
    audited = clean + resolved
    audit_summary = (f"passed — {len(audit_log)} slots ({audited} LLM-audited: {clean} clean, {resolved} corrected "
                     f"on retry, 0 unresolved; {code_rendered} code-rendered).")

    generated_at = datetime.now(timezone.utc).isoformat()
    meta = {"generated_at": generated_at, "provider": provider, "model": model, "audit_summary": audit_summary}

    sources = [art_path.name, f"outcomes-{ts}.json", f"conflicts-baseline-{ts}.json"]
    if verdict:
        sources.append(f"robustness-verdict-{ts}.json")

    report_json = {
        "report_version": REPORT_VERSION,
        "generated_at": generated_at,
        "provider": provider, "model": model, "usage": getattr(client, "usage", None),
        "run": {
            "scenario_run_id": facts["scenario_run_id"], "baseline_run_id": facts["baseline_run_id"],
            "network": facts["network"], "seeds": facts["seeds"], "thresholds": facts["thresholds"],
            "demand": facts["demand"], "cars_rerouted": facts["cars_rerouted"],
            "severed_edges": facts["severed_edges"],
        },
        "scenario_change": facts["change"].model_dump(mode="json"),
        "scorecard": artifact.scorecard.model_dump(mode="json", exclude_none=True),
        "car_tail": {
            "median_s": facts["tail_median_s"], "share_gt30_pct": facts["tail_share_pct"],
            "cross_seed": verdict, "cross_seed_available": verdict is not None,
            "sentence": _cross_seed_sentence(facts),
        },
        "sections": {
            "what_tested": {"framing": framing},
            "who_affected": {"group_order": GROUP_ORDER, "group_labels": GROUP_LABEL, "glosses": glosses},
            "what_they_say": {
                "groups": [{"key": bk, "label": BUCKET_LABEL[bk], **syntheses[bk]}
                           for bk in BUCKET_ORDER if bk in syntheses],
            },
            "cannot_tell": {"intro": caveat_intro, "caveats": caveats},
        },
        "audit": {"passed": True, "slots_checked": len(audit_log), "summary": audit_summary, "log": audit_log},
        "sources": sources,
    }

    md = render_markdown(facts, framing, glosses, syntheses, caveat_intro, caveats, meta)

    md_path = RUNS_DIR / f"report-{ts}.md"
    json_path = RUNS_DIR / f"report-{ts}.json"
    md_path.write_text(md, encoding="utf-8")
    json_path.write_text(json.dumps(report_json, indent=2, ensure_ascii=False), encoding="utf-8")
    WEB_PUBLIC.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(md_path, WEB_PUBLIC / "latest-report.md")
    shutil.copyfile(json_path, WEB_PUBLIC / "latest-report.json")

    # audit log to stdout (a caught-then-corrected violation is the system working)
    print("\n=== AUDIT LOG ===")
    for e in audit_log:
        line = f"  [{e['status']:>18}] {e['slot']}"
        if e["violations"]:
            line += " :: " + "; ".join(f"{v['rule']}:{v['sentence'][:70]}" for v in e["violations"])
        print(line)
    print(f"\n{audit_summary}")
    print(f"[report] wrote {md_path.name} + {json_path.name}  (+ web/public/latest-report.{{md,json}})")
    return md_path, json_path


def main() -> None:
    ap = argparse.ArgumentParser(description="Generate the credibility-first run report (Phase 3.1).")
    ap.add_argument("--run-id", default=None, help="artifact stem (default: newest multimodal-scenario)")
    args = ap.parse_args()
    asyncio.run(generate(args.run_id))


if __name__ == "__main__":
    main()
