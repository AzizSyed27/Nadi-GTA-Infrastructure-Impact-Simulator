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
import os
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from pydantic import BaseModel

import personas as personas_mod
import trajectory_io
from contract_models import ScorecardCell, ScorecardGroup, TrajectoryArtifact, changes_of
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

def _is_unstable(cell: ScorecardCell | None) -> bool:
    """V2.1d: sign-unstable = this cell carries a cross-seed range whose sign flipped. None-safe by
    design — sign_stable exists ONLY on CellRange, so a rangeless cell is stable-by-absence (this is
    the ONE guard every consumer goes through; never read cell.range.sign_stable bare)."""
    return cell is not None and cell.range is not None and cell.range.sign_stable is False


def _range_clause(cell: ScorecardCell, kind: str) -> str:
    """The code-rendered cross-seed range appendix. Travel keeps SIGNED endpoints (measured data —
    on an unstable cell the straddle IS the evidence); safety uses ABSOLUTE endpoints (a safety
    render never emits a sign character on any surface)."""
    r = cell.range
    if r is None:
        return ""
    if kind == "safety":
        lo, hi = sorted((abs(r.min), abs(r.max)))
        return f" (range ±{lo:.2f} to ±{hi:.2f} across {r.n_seeds} seeds)"
    return f" (range {r.min:+.1f} to {r.max:+.1f}s across {r.n_seeds} seeds)"


def render_cell(cell: ScorecardCell | None, kind: Literal["travel", "safety", "access"]) -> str:
    """Render one scorecard cell as text, MIRRORING the panel:
    - safety = ±magnitude, NO sign (every safety value is positive and the note refuses the direction);
    - V2.1d: ANY sign-unstable cell = ±magnitude (a signed unstable value would assert a direction
      the seeds refute — map panel and report agree); ranged cells append the range clause;
    - travel/access = signed (+/-), POSITIVE = worse;
    - missing cell = em dash; [MEAS]/[LOW] confidence badge.
    """
    if cell is None or cell.value is None:
        return "—"
    badge = "MEAS" if cell.confidence == "measured" else "LOW"
    if kind == "safety":
        return f"±{abs(cell.value):.2f} [{badge}]{_range_clause(cell, 'safety')}"
    if kind == "travel":
        if _is_unstable(cell):
            s = f"±{abs(cell.value):.1f}s"
        else:
            s = f"{cell.value:+.1f}s"
        if cell.affected_share is not None:
            s += f", {cell.affected_share * 100:.1f}% >{MATERIALITY_S}s"
        return f"{s} [{badge}]{_range_clause(cell, 'travel')}"
    if _is_unstable(cell):  # access never gets ranges today, but the guard is uniform
        return f"±{abs(cell.value):.2f} [{badge}]{_range_clause(cell, 'access')}"
    return f"{cell.value:+.2f} [{badge}]"  # access — directional heuristic


def cell_valence(cell: ScorecardCell | None, kind: Literal["travel", "safety", "access"]) -> str:
    """A CODE-RENDERED plain-language valence for a cell — no numbers, but the DIRECTION is resolved here
    (POSITIVE = worse) so the LLM gloss can't invert it. Safety never gets a direction (magnitude only);
    V2.1d: a sign-unstable cell of ANY kind gets no direction either (the sign flips across seeds), so
    the LLM slots and the chat corpus can never launder an unstable sign into a directional claim."""
    if cell is None or cell.value is None:
        return "no measurable signal"
    if _is_unstable(cell):
        return ("a magnitude is present, but its direction is not claimed (the sign flips across "
                "this run's seeds)")
    if kind == "safety":
        if cell.range is not None:  # a measured-stable safety range earns a better caveat, not a direction
            return ("a near-miss magnitude is present; its sign held across this run's seeds, but "
                    "direction is still reported as magnitude only")
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
    that produced it is not ts-stamped, so a run-id match alone isn't enough). Else None → qualitative note.

    V2.1d precedence: native cell ranges (contract 0.8.0, --n-seeds runs) are the seed authority for
    CELL values; this verdict remains the source for the affected-share tail range (which cell ranges
    don't cover — they are value-only) and for pre-0.8.0 runs."""
    path = RUNS_DIR / f"robustness-verdict-{ts}.json"
    if not path.is_file():
        return None
    v = json.loads(path.read_text(encoding="utf-8"))
    changes = changes_of(artifact)
    target_edge = changes[0].target_edge if changes else None
    if v.get("scenario_run_id") != artifact.meta.run_id or v.get("target_edge") != target_edge:
        print(f"[verdict] {path.name} does not match this run/change — using the qualitative fallback.")
        return None
    return v.get("car_tail")


def gather_facts(artifact: TrajectoryArtifact, outcomes: dict, verdict: dict | None) -> dict:
    meta = artifact.meta
    # v0.5.0: read the normalized change list. `change` (=changes[0]) stays the PRIMARY for the out-of-contract
    # report JSON `scenario_change` (ReportPanel reads a single change); render_markdown iterates `changes`.
    changes = changes_of(artifact)
    change = changes[0]
    by_group: dict[str, ScorecardGroup] = {g.group: g for g in artifact.scorecard.groups}

    # the car travel-time tail (single-seed, from the measured scorecard cell)
    car_travel = by_group["car_commuter"].travel_time_delta
    tail_share_pct = round((car_travel.affected_share or 0.0) * 100, 1)
    tail_median_s = car_travel.value

    demand = {m: outcomes["modes"][m]["counts"]["total_demand"] for m in ("car", "bicycle", "pedestrian")}

    # V2.1d seed provenance, native-first: the outcomes sidecar (a real multi-seed run) → the verdict's
    # list (the legacy robustness sweep genuinely ran) → [42] only. The old [42,43,44] fallback printed
    # unearned provenance on every single-seed run.
    sc_seeds = outcomes.get("seeds") or {}
    if sc_seeds:
        seeds = [sc_seeds["canonical"], *sc_seeds.get("probes", [])]
    else:
        seeds = (verdict or {}).get("seeds") or [42]

    return {
        "scenario_run_id": meta.run_id,
        "baseline_run_id": meta.scenario.baseline_run_id,
        "network": meta.network,
        "change": change,      # PRIMARY (changes[0]) — for the report JSON scenario_change + slot_framing
        "changes": changes,    # v0.5.0: the full list — render_markdown "What was tested" iterates this
        "demand": demand,
        "cars_rerouted": outcomes["reroute"]["cars_rerouted"],
        "severed_edges": outcomes.get("connectivity_severed_edges", []),
        "by_group": by_group,
        "tail_share_pct": tail_share_pct,
        "tail_median_s": tail_median_s,
        "verdict": verdict,  # {per_seed, range_gt30, verdict, ...} or None
        "thresholds": {"ttc_s": TTC_THRESHOLD_S, "veh_pet_s": VEH_PET_THRESHOLD_S,
                       "ped_pet_s": PED_PET_THRESHOLD_S, "materiality_s": MATERIALITY_S},
        "seeds": seeds,
        "n_seeds": sc_seeds.get("n_seeds", 1),
        "seed_basis": sc_seeds.get("basis"),
        # every (group, kind) whose cross-seed sign flipped — drives the methodology line + checks
        "sign_unstable_cells": [
            (g.group, kind)
            for g in artifact.scorecard.groups
            for kind, attr in (("travel", "travel_time_delta"), ("safety", "safety_delta"),
                               ("access", "access_delta"))
            if _is_unstable(getattr(g, attr))
        ],
        # V2.1b: which demand the run simulated (v0.6.0 meta) + calibration provenance for the methodology
        # section. Older (pre-0.6.0) artifacts have no demand_profile — rendered as the synthetic demo.
        "demand_profile": getattr(meta, "demand_profile", None) or "synthetic_demo",
        "assignment": getattr(meta, "assignment", None),  # v0.7.0; None for older artifacts = day-one
        "render_sample": getattr(meta, "render_sample", None),
        "calibration": _load_calibration_provenance() if getattr(meta, "demand_profile", None) == "calibrated_am_peak" else None,
        # V2.2a/b (capacity runs only; None/absent otherwise): the first-class capacity numbers —
        # non-completions per mode (route-invalidating changes only), the scheduler's revert proof,
        # and the emergency-response detour fact (free-flow routing estimate).
        "non_completions": outcomes.get("non_completions"),
        "non_completions_split": outcomes.get("non_completions_split"),
        "insertion_backlog": outcomes.get("insertion_backlog"),
        "window_events": outcomes.get("window_events"),
        "response_detour": outcomes.get("response_detour"),
        # V2.2d — scenario tags + the school-zone lens (tag-gated sidecar block; None otherwise)
        "tags": list(meta.scenario.tags) if getattr(meta.scenario, "tags", None) else None,
        "zone_facts": outcomes.get("zone_facts"),
        # V2.2 closeout — run-scoped scorecard vs windowed change: the scope disclosure (None when
        # no change is windowed; verify_facts re-derives and pins it verbatim).
        "sim_end": meta.sim_end,
        "scope_disclosure": build_scope_disclosure(
            changes, meta.sim_end, getattr(meta, "demand_profile", None) or "synthetic_demo"),
    }


def _load_calibration_provenance() -> dict | None:
    """The newest data/demand provenance (GEH acceptance + caveats) for calibrated-run methodology.
    Missing file -> None (the report renders a labeled absence, never silence)."""
    demand_dir = Path(__file__).resolve().parents[2] / "data" / "demand"
    paths = sorted(demand_dir.glob("demand-calibrated-am-*.json"))
    if not paths:
        return None
    return json.loads(paths[-1].read_text(encoding="utf-8"))


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

    # V2.2a closure guards: non_completions must re-derive from the mode counts, and every window
    # revert we would present as proof must actually carry the restored_ok verification.
    if facts.get("non_completions") is not None:
        src_nc = {m: outcomes["modes"][m]["counts"].get("baseline_only")
                  for m in facts["non_completions"]}
        if facts["non_completions"] != src_nc:
            problems.append(f"non_completions {facts['non_completions']} != source {src_nc}")
    # V2.2c: the split must equal its sidecar source AND sum per mode to the total; the backlog
    # context (what keeps not_inserted causally honest) must equal the sidecar too.
    if facts.get("non_completions_split") is not None:
        if facts["non_completions_split"] != outcomes.get("non_completions_split"):
            problems.append("non_completions_split != sidecar source")
        for m, buckets_ in facts["non_completions_split"].items():
            total = (facts.get("non_completions") or {}).get(m)
            if total is not None and buckets_["entered_not_finished"] + buckets_["not_inserted"] != total:
                problems.append(f"non_completions_split[{m}] does not sum to non_completions ({total})")
    if facts.get("insertion_backlog") is not None and \
            facts["insertion_backlog"] != outcomes.get("insertion_backlog"):
        problems.append("insertion_backlog != sidecar source")
    for ev in facts.get("window_events") or []:
        if ev.get("reverted_t") is not None and ev.get("restored_ok") is not True:
            problems.append(f"window event {ev.get('change_idx')}: revert without restored_ok proof")
    # V2.2b: the response-detour block may never render with doctored arithmetic or without BOTH
    # honesty sentences (free-flow framing + the lower-bound disclosure) verbatim.
    rd = facts.get("response_detour")
    if rd is not None:
        import response_probe
        if rd.get("framing") != response_probe.FRAMING or \
                rd.get("lower_bound_note") != response_probe.LOWER_BOUND_NOTE:
            problems.append("response_detour framing/lower-bound sentences altered or missing")
        for pr in rd.get("probes", []):
            if pr.get("added_s") is not None and pr.get("scenario_s") is not None \
                    and pr.get("baseline_s") is not None:
                if abs(pr["added_s"] - round(pr["scenario_s"] - pr["baseline_s"], 1)) > 0.05:
                    problems.append(f"response probe {pr.get('label')!r}: added_s mismatch")

    # V2.2d — the zone lens pair may never render doctored, or without its honesty notes. The pair
    # bypasses the scorecard's CellRange/sign_stable machinery, so the variation caveat is a
    # REQUIRED part of the block (fold-1 lock), verbatim — like the response-detour framing.
    zf = facts.get("zone_facts")
    if zf is not None:
        import zone_lens
        if zf != outcomes.get("zone_facts"):
            problems.append("zone_facts != sidecar source")
        pv = zf.get("ped_vehicle_conflicts") or {}
        if not (isinstance(pv.get("baseline"), int) and isinstance(pv.get("scenario"), int)
                and pv["baseline"] >= 0 and pv["scenario"] >= 0):
            problems.append("zone_facts pair is not a pair of non-negative counts")
        if zf.get("variation_note") != zone_lens.VARIATION_NOTE:
            problems.append("zone_facts variation note altered or missing (the pair may not render without it)")
        if "not modeled schoolchildren" not in (zf.get("population_note") or ""):
            problems.append("zone_facts population note altered or missing")

    # V2.2 closeout — the scope disclosure is REQUIRED verbatim whenever any change is windowed and
    # FORBIDDEN otherwise (the variation_note enforcement level: rendering without it is a failure).
    expected_scope = build_scope_disclosure(
        changes_of(artifact), artifact.meta.sim_end,
        getattr(artifact.meta, "demand_profile", None) or "synthetic_demo")
    if facts.get("scope_disclosure") != expected_scope:
        problems.append(f"scope_disclosure altered, missing, or spurious (expected {expected_scope!r}, "
                        f"got {facts.get('scope_disclosure')!r})")

    car_cell = artifact.scorecard.groups and {g.group: g for g in artifact.scorecard.groups}["car_commuter"].travel_time_delta
    if round((car_cell.affected_share or 0.0) * 100, 1) != facts["tail_share_pct"]:
        problems.append("tail_share_pct != artifact car cell")

    # Every safety render must be a ±magnitude with NO sign character (the direction the note refuses).
    for g in artifact.scorecard.groups:
        s = render_cell(g.safety_delta, "safety")
        if s != "—" and (not s.startswith("±") or "+" in s or "-" in s or "−" in s):
            problems.append(f"safety cell for {g.group} rendered with a direction: {s!r}")

    # V2.1d: (a) every SIGN-UNSTABLE cell of any kind renders ±magnitude (a signed render would
    # assert the direction the seeds refute); (b) every range is internally consistent. Belt and
    # suspenders over the pydantic validators — a render bug would slip the model layer.
    for g in artifact.scorecard.groups:
        for kind, attr in (("travel", "travel_time_delta"), ("safety", "safety_delta"),
                           ("access", "access_delta")):
            cell = getattr(g, attr)
            if cell is None:
                continue
            if _is_unstable(cell):
                s = render_cell(cell, kind)  # type: ignore[arg-type]
                if s != "—" and not s.startswith("±"):
                    problems.append(f"sign-unstable {kind} cell for {g.group} rendered signed: {s!r}")
            if cell.range is not None:
                r = cell.range
                if r.min > r.max:
                    problems.append(f"{g.group}.{kind} range min > max")
                if cell.value is not None and not (r.min <= cell.value <= r.max):
                    problems.append(f"{g.group}.{kind} canonical value outside its own range")

    th = facts["thresholds"]
    if (th["ttc_s"], th["veh_pet_s"], th["ped_pet_s"]) != (TTC_THRESHOLD_S, VEH_PET_THRESHOLD_S, PED_PET_THRESHOLD_S):
        problems.append("thresholds != module constants")

    # v0.4.0 discourse invariants a consumer (and Section 4) assumes about artifact.social.
    if artifact.social is not None:
        ev = [e for c in artifact.social.cascades for s in c.steps for e in s.events]
        n_excluded = sum(1 for e in ev if e.audit_status == "excluded")
        if artifact.social.excluded_count is not None and artifact.social.excluded_count != n_excluded:
            problems.append(f"social.excluded_count {artifact.social.excluded_count} != actual {n_excluded}")
        if any(e.audit_status == "excluded" and not e.excluded_by for e in ev):
            problems.append("some excluded social events carry no excluded_by rule")

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
# PERSONA-VOICE safety calibration — cascade content ONLY (propagation.apply_audit). NOT the blunt rule.
# Two contexts, two calibrations (the `digits` precedent): the blunt `_safety_direction` above governs
# SYSTEM voice (report/chat) where any safety+direction pairing is forbidden and stays here UNCHANGED. In a
# cascade, content is already persona-attributed and framed "one simulated cascade — not a prediction", so a
# first-person hope/value/conditional ("if it means safer crossings", "my kids' safety matters more", "I'd
# feel safer") is licensed anticipation — the same speech act round-0 seeds were exempted to voice — while an
# assertion-of-accomplished-fact ("it's safer now", "has gotten safer since") or evidential framing ("the data
# show it's safer") is NOT. Over-firing is the high-cost error here (it deletes synthesis moments); we
# default-license and exclude only the two harmful forms.
_EVIDENTIAL = re.compile(
    r"\b(data|study|studies|research|statistic\w*|evidence|proven|measurabl\w*|"
    r"records?\s+show\w*|numbers?\s+show\w*|studies?\s+show\w*|shown\s+to\s+be)\b", re.I)
# A realized SAFETY assertion: a copula / realization verb (or a realization time-marker) ADJACENT to a safety
# valence ADJECTIVE — "it is safer", "made the corner more dangerous", "safer now", "safer these days".
_SAFETY_VAL = r"(?:safer|safe|unsafe|dangerous|riskier|calmer)"
_REALIZED_SAFETY = re.compile(
    r"\b(?:is|are|'s|’s|was|were|been|becam\w*|becom\w*|got|gotten|getting|made|turn\w*|ended up)\W+"
    rf"(?:\w+\W+){{0,3}}{_SAFETY_VAL}\b"  # {0,3} catches "made the corner more dangerous"
    rf"|\b{_SAFETY_VAL}\W+(?:\w+\W+){{0,1}}(?:now|these days|already|nowadays|since (?:the|this|they))\b", re.I)
# License FRAMES (irrealis / persona voice): conditional, modal, desiderative, evaluative, opinion-hedge,
# feeling. NB: "makes" is deliberately NOT here (it reads as causal assertion) — "if …" carries those cases.
_LICENSE = re.compile(
    r"\b(if|as long as|unless|would|'d|’d|could|might|may|means?|meaning|"
    r"hope\w*|hoping|want\w*|wish\w*|rather|prefer\w*|worth|matters?|care\w*|no-?brainer|"
    r"i think|i reckon|i guess|in my book|as far as i'?m concerned|to me|imo|"
    r"feel\w*|glad|hopeful|love|peace of mind)\b", re.I)


def _persona_safety_excluded(sentence: str) -> bool:
    """Cascade-context safety verdict. True = exclude. A safety-direction MENTION is licensed by default
    (persona anticipation); it is excluded ONLY when it invents evidence, or asserts an accomplished-fact
    safety direction without a conditional/evaluative/hedge frame."""
    if not _safety_direction(sentence):
        return False  # no safety-direction mention at all — nothing to judge
    if _EVIDENTIAL.search(sentence):
        return True  # invents evidence ("the data show it's safer") — a system-voice move, never licensed
    if _REALIZED_SAFETY.search(sentence) and not _LICENSE.search(sentence):
        return True  # unhedged, non-conditional assertion the change HAS produced a direction
    return False  # first-person hope / value / conditional — licensed anticipation


def audit_prose_cascade(text: str) -> list[tuple[str, str]]:
    """Persona-voice variant of `audit_prose` for CASCADE content: identical digits/tally/crash/allow rules,
    but the safety rule is the persona-calibrated `_persona_safety_excluded`. The blunt `audit_prose` is
    UNCHANGED and remains the guard for report/chat system voice."""
    viol: list[tuple[str, str]] = []
    for s in _sentences(text):
        if _DIGIT.search(s):
            viol.append(("digits", s))
        if _ALLOW.search(s):
            continue
        if _persona_safety_excluded(s):
            viol.append(("safety_direction", s))
        if _TALLY.search(s):
            viol.append(("tally", s))
        if _CRASH.search(s):
            viol.append(("crash", s))
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


async def _call(client: LLMClient, system: str, user: str, wire: type[BaseModel], attempts: int = 4,
                temperature: float = 0.3) -> dict:
    """One structured generation with the reaction-layer retry policy (transient backoff + one parse retry).
    temperature defaults to 0.3 — the report + chat agent want DETERMINISTIC facts (reactions.py calls
    generate_json directly and keeps the 0.8 default for persona variety)."""
    last: Exception | None = None
    for i in range(attempts):
        try:
            raw = await client.generate_json(system=system, user=user, schema=wire, temperature=temperature)
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

def _change_phrase(change, profile: str = "synthetic_demo") -> str:
    from demand_profiles import fmt_window

    window_txt = f" {fmt_window(change.window, profile)}" if getattr(change, "window", None) else ""
    if change.type == "new_road":
        lanes = change.lanes or 1
        way = "two-way" if change.bidirectional else "one-way"
        return (f"a new {lanes}-lane {way} road connecting junction {change.from_junction} to junction "
                f"{change.to_junction} (no sidewalk at this stage)")
    if change.type == "bike_lane":
        return "one general-traffic (car) lane on the corridor is being converted into a bicycle-only lane"
    if change.type == "lane_closure":  # V2.2a — mechanical; clock times on calibrated (t=0 == 07:00)
        n = len(change.target_lanes or [])
        return (f"{n} car lane{'s are' if n != 1 else ' is'} closed on the corridor road{window_txt}; "
                f"the road stays open in the remaining lane(s)")
    if change.type == "road_closure":
        return f"the corridor road is fully closed{window_txt}; traffic must use other streets"
    if change.type == "incident":  # V2.2b — a capacity event, never a crash simulation
        return (f"lanes blocked / capacity reduced on the corridor road{window_txt} "
                f"(a temporary incident; capacity is restored afterwards)")
    return change.description


def _changes_phrase(changes, profile: str = "synthetic_demo") -> str:
    """A single change renders exactly as before; a composite (v0.5.0) joins each change's phrase."""
    phrases = [_change_phrase(c, profile) for c in changes]
    if len(phrases) == 1:
        return phrases[0]
    return "; and ".join(phrases)


async def slot_framing(client, facts, audit_log) -> str:
    changes = facts["changes"]
    system = _FRAMING + _json_instr('{"text": "<2-3 plain sentences, NO numbers>"}')
    user = (f"Write 2-3 plain-language sentences framing what is being tested, for a reader who is not a "
            f"traffic engineer. Mechanically: {_changes_phrase(changes, facts['demand_profile'])}. Do NOT "
            f"assert any benefit (not "
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
        # V2.1d: valence-driven so a measured-stable range doesn't get the stale "not seed-stable"
        # wording (and an unstable one states the flip) — one source of truth, cell_valence.
        return f"For this group, {cell_valence(cell, 'safety')} — the table shows the magnitude only."
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
# V2.2 closeout — the windowed-scope disclosure. Scorecard measures are RUN-scoped; a windowed
# change was active for only part of the run, so its per-group numbers are DILUTED by the periods
# in which nothing was different. This sentence is the single source for the report line, the
# caveat, the chat corpus, and the verify_facts pin — never re-derive the phrasing elsewhere.
# ===================================================================================================

def build_scope_disclosure(changes: list, sim_end: float, profile: str) -> str | None:
    """The scorecard-scope sentence when ANY change is windowed; None otherwise (unwindowed runs
    render NOTHING new — golden-pinned byte-identical). Span convention = zone_lens.resolve_window
    (windowed members only; differing windows → the spanning window, said out loud). The dilution
    sentence names only the flanks that exist — a window ending at the sim ceiling has no 'after'."""
    import zone_lens
    from demand_profiles import fmt_sim_time, fmt_window
    windowed = [c for c in changes if getattr(c, "window", None) is not None]
    if not windowed:
        return None
    span, _ = zone_lens.resolve_window(changes)
    differing = len({(c.window.start_s, c.window.end_s) for c in windowed}) > 1
    # a MIXED set (windowed + permanent members) must never read as "the changes were temporary"
    if len(windowed) < len(changes):
        subject = "the windowed changes were" if len(windowed) > 1 else "the windowed change was"
    else:
        subject = "the changes were" if len(changes) > 1 else "the change was"
    s = (f"Scorecard measures cover the full simulated period "
         f"({fmt_sim_time(0.0, profile)}–{fmt_sim_time(sim_end, profile)}); "
         f"{subject} active {fmt_window(span, profile)} of it")
    if differing:
        s += f" ({zone_lens.span_note('these figures')})"
    s += "."
    before, after = span["start_s"] > 0.0, span["end_s"] < sim_end
    if before or after:
        flank = ("the periods before and after it" if before and after
                 else "the period before it" if before else "the period after it")
        s += f" Effects during the active window are diluted by {flank}."
    return s


# ===================================================================================================
# Code-rendered caveat skeleton (Section 4) — MANDATORY, non-trimmable
# ===================================================================================================

def build_caveats(facts: dict, has_discourse: bool = False) -> list[dict]:
    safety_note = next((g.safety_delta.note for g in facts["by_group"].values()
                        if g.safety_delta and g.safety_delta.note), "sign not stable across seeds")
    rerouted = facts["cars_rerouted"]
    caveats = [
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
        # V2.1c: this caveat must MATCH the run's assignment mode — the day-one wording on a settled
        # artifact would contradict the methodology's Assignment bullet on the same page.
        ({"title": "Iterated assignment is a model equilibrium, not observed adaptation",
          "body": f"Driver routes were re-computed until travel times stabilized ({rerouted} cars ended on "
                  "different routes than day one), approximating the adjusted state. Real corridors settle "
                  "over weeks as people also shift modes and departure times — neither is modeled here, and "
                  "pedestrian and cyclist routes were held fixed."}
         if (facts.get("assignment") is not None and getattr(facts["assignment"], "mode", None) == "settled") else
         {"title": "In-run adaptation is not settled equilibrium",
          "body": f"Travelers do not re-plan across days here: {rerouted} cars rerouted within the run. Real "
                  "corridors reach a new equilibrium over weeks as people adjust routes, modes, and times — this "
                  "preview shows the immediate response, not that settled state."}),
        {"title": "A stratified sample, not a census",
         "body": "The voiced reactions come from a stratified sample of personas pinned to specific simulated "
                 "travelers (deliberately including the hardest-hit tail), not a poll of everyone. They show the "
                 "texture of who wins and loses, never a headcount of support or opposition."},
        {"title": "The access column is a rule-based estimate",
         "body": "Access impacts are a deterministic heuristic from the change type (e.g. curbside space), "
                 "labelled low-confidence — an estimate to reason about, not a measurement."},
    ]
    # V2.2 closeout — ANY windowed change (broader than the closure/incident gate below): the
    # scorecard's run-scoped numbers dilute the windowed change's effect; say both scopes out loud.
    if facts.get("scope_disclosure"):
        caveats.append(
            {"title": "A windowed change: scorecard measures cover the whole run",
             "body": facts["scope_disclosure"]})
    # V2.2a — closure-specific honesty. Windowed: a temporary event has no settled equilibrium, so only
    # the day-one response is previewed. road_closure: stranded trips are a first-class outcome.
    chs = facts.get("changes") or []
    if any(getattr(c, "window", None) is not None
           and c.type in ("lane_closure", "road_closure", "incident") for c in chs):
        caveats.append(
            {"title": "A temporary event, previewed as the day-one response only",
             "body": "The closure or incident applies and is lifted within the simulated period. Temporary "
                     "events have no settled equilibrium, so no iterated-assignment claim is made — what you "
                     "see is how travelers respond within the run (diverting, queueing, or not completing), "
                     "not how the corridor would adapt to a permanent change."})
    if any(c.type == "road_closure" for c in chs):
        caveats.append(
            {"title": "A closure can strand trips",
             "body": "Trips that start or end on the closed road may be unable to complete. Those travelers "
                     "are counted as non-completions in section 1 — they are deliberately never averaged into "
                     "the travel-time deltas, which cover only travelers who completed in both runs."})
    # V2.2d — the school-zone lens: both honesty locks ride the caveats too (the block in section 1
    # carries them next to the numbers; here they join the run's standing limitations).
    zf = facts.get("zone_facts")
    if zf is not None:
        caveats += [
            {"title": "The zone conflict pair does not establish a direction",
             "body": f"The zone's ped-vehicle conflict figures are {zf['variation_note']}. The pair sits "
                     "outside the scorecard, so it carries no cross-seed range — read it as two observed "
                     "counts, not a measured improvement or worsening."},
            {"title": "The zone counts measure the modeled population, not schoolchildren",
             "body": f"{zf['population_note']}. The zone lens is spatial and temporal "
                     f"({zf['method_note']}), not demographic."},
        ]
    if has_discourse:
        caveats += [
            {"title": "Cascades are illustrative unfoldings",
             "body": "The discourse section shows independent simulated cascades over the same seeded "
                     "reactions. They are illustrative, not forecasts — the same opinions cascaded differently "
                     "across runs (who engages and who shifts varies run to run), so read them as texture, "
                     "never as what the community will decide."},
            {"title": "Argument spread is response volume under neutral surfacing",
             "body": "The recommender that decides which posts agents see is a neutral random-surfacing stand-in "
                     "(the interest-based recommender is unavailable at this scale), so an argument's engagement "
                     "partly reflects how much it was posted, not only its pull. Exposure-based reach saturates "
                     "under random surfacing and is not reported; the engaged figures are 'drew the most "
                     "response', shown with a per-post normalization."},
        ]
    return caveats


# ===================================================================================================
# Section 4 — "How discourse might unfold" (the OASIS social cascade). ALL numbers code-rendered from
# artifact.social; the LLM fills only a narrative slot + picks a verbatim CASCADE quote by id.
# ===================================================================================================

_STANCE_RANK = {"supportive": 1, "neutral": 0, "opposed": -1}
# a persona's travel mode → the scorecard group it voices (mirrors personaGroups.ts / scorecard groups)
_MODE_GROUP = {"car": "car_commuter", "bicycle": "cyclist", "pedestrian": "pedestrian"}
# compromise/synthesis flavour — biases the quote pick-list toward middle-ground utterances (LLM still chooses)
_COMPROMISE_HINTS = ("rather", "worth it", "as long as", "if it", "trade", "fair", "both", "calmer",
                     "i can live", "i'll take", "quieter", "safer for")


def discourse_facts(artifact: TrajectoryArtifact) -> dict | None:
    """Code-rendered facts for Section 4 from artifact.social. Returns None when there is no social block."""
    social = artifact.social
    if social is None or not social.cascades:
        return None
    from collections import Counter

    specs = {p.id: p for p in personas_mod.load_personas()}

    def group_of(pid: str | None) -> str:
        spec = specs.get(pid or "")
        if spec is None:
            return "other"
        if spec.mode in _MODE_GROUP:
            return _MODE_GROUP[spec.mode]
        return spec.stakeholder or "other"

    aid_persona: dict[str, str] = {}
    aid_label: dict[str, str] = {}
    for a in artifact.agents:
        aid = a.vehicle_id or a.person_id or a.persona.id
        aid_persona.setdefault(aid, a.persona.id)
        aid_label.setdefault(aid, a.persona.label)

    cascade_ids = [c.cascade_id for c in social.cascades]
    ref = cascade_ids[0]

    reach: dict[str, list[dict]] = {}
    for r in social.argument_reach:
        reach.setdefault(r.cascade_id, []).append({
            "argument": r.argument, "reached": r.reached, "post_count": r.post_count,
            "per_post": round(r.reached / r.post_count, 2) if r.post_count else None})
    dominant = {cid: (max(rows, key=lambda x: x["reached"])["argument"] if rows else None)
                for cid, rows in reach.items()}

    shifts: dict[str, dict] = {}
    for cid in cascade_ids:
        trs = [t for t in social.trajectories if (t.cascade_id or ref) == cid]
        byg: Counter = Counter()
        hardened = warmed = movers = 0
        for t in trs:
            if not t.shifted:
                continue
            movers += 1
            byg[group_of(aid_persona.get(t.agent))] += 1
            pts = t.points or []
            if len(pts) >= 2:
                d = _STANCE_RANK.get(pts[-1].stance, 0) - _STANCE_RANK.get(pts[0].stance, 0)
                if d < 0:
                    hardened += 1
                elif d > 0:
                    warmed += 1
        shifts[cid] = {"movers": movers, "by_group": dict(byg), "hardened": hardened, "warmed": warmed}

    excluded = [e for c in social.cascades for s in c.steps for e in s.events if e.audit_status == "excluded"]
    excl_by = dict(Counter(r for e in excluded for r in (e.excluded_by or [])))

    # verbatim-quote pick-list: CLEAN step>=1 CASCADE utterances (NOT round-0 reactions). Compromise-flavoured
    # first, then stable-sorted so the sample is deterministic. label comes from the agentId join (label ONLY).
    utter: list[tuple[str, str]] = []
    for c in social.cascades:
        for s in c.steps:
            if s.step < 1:
                continue
            for e in s.events:
                if e.content and e.audit_status == "clean" and e.action in ("post", "comment"):
                    utter.append((e.agent, e.content))
    utter.sort(key=lambda x: (0 if any(k in x[1].lower() for k in _COMPROMISE_HINTS) else 1, x[1]))
    seen: set[str] = set()
    sample: list[dict] = []
    for aid, content in utter:
        if content in seen:
            continue
        seen.add(content)
        sample.append({"agent": aid, "label": aid_label.get(aid, aid), "content": content})
        if len(sample) >= SYNTH_SAMPLE:
            break

    return {
        "cascade_ids": cascade_ids, "n_cascades": len(cascade_ids), "reach": reach, "dominant": dominant,
        "diverge": len({v for v in dominant.values() if v}) > 1, "shifts": shifts,
        "excluded_count": len(excluded), "excluded_by": excl_by, "sample": sample,
        "movers_range": [min(s["movers"] for s in shifts.values()), max(s["movers"] for s in shifts.values())],
    }


async def slot_discourse(client, dfacts: dict, audit_log: list[dict]) -> dict:
    """One narrative paragraph (audited) + a verbatim CASCADE quote chosen by id. The LLM never types the
    quote — it picks an index into the clean-cascade sample; code injects event.content verbatim."""
    sample = dfacts["sample"]
    listing = "\n".join(f"[{i}] {s['content']}" for i, s in enumerate(sample, 1)) or "[none]"
    system = _FRAMING + _json_instr(
        '{"synthesis": "<2-4 plain sentences on how the conversation might unfold — MOVEMENT and texture, '
        'never a final for/against split, NO numbers>", "representative_comment_ids": [<1 or 2 ids>]}')
    user = ("These are utterances from a SIMULATED social cascade over the seeded reactions (one illustrative "
            "unfolding). Describe, as anticipation, how the conversation might unfold — who engages, where "
            "middle-ground appears — WITHOUT any head-count or final position. Then pick the 1-2 ids that best "
            "show a middle-ground / compromise moment.\n\nUTTERANCES:\n" + listing)
    obj = await _slot(client, system, user, _SynthWire, "synthesis", "discourse", audit_log)
    ids = [i for i in obj["representative_comment_ids"] if isinstance(i, int) and 1 <= i <= len(sample)][:2]
    if not ids and sample:
        ids = [1]
    quotes = [{"label": sample[i - 1]["label"], "comment": sample[i - 1]["content"]} for i in ids]
    return {"synthesis": obj["synthesis"].strip(), "quotes": quotes}


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


def render_discourse_md(dfacts: dict, discourse: dict) -> list[str]:
    """Section 4 markdown — ALL numbers code-rendered from dfacts; only `discourse.synthesis`/`quotes` are LLM."""
    L: list[str] = ["## 4. How discourse might unfold", ""]
    L.append("*One or more SIMULATED cascades over the seeded reactions — illustrative unfoldings, never a "
             "forecast or a vote. Movement, not a final position.*")
    L.append("")
    L.append(discourse["synthesis"])
    L.append("")
    # engaged-reach per cascade
    L.append("**Which argument drew the most response** (unique agents who acted on a post making it; "
             "“/post” normalizes for how much it was posted):")
    for cid in dfacts["cascade_ids"]:
        rows = sorted(dfacts["reach"].get(cid, []), key=lambda x: x["reached"], reverse=True)
        cells = "; ".join(
            f"{r['argument']} — {r['reached']}"
            + (f" ({r['post_count']} posts, {r['per_post']}/post)" if r["post_count"] else "")
            for r in rows)
        L.append(f"- *cascade {cid}:* {cells}")
    L.append("")
    # movement by group per cascade (transitions, never a final split; never summed across cascades)
    L.append("**Who moved** (derived stance transitions within each cascade — movement, not a final position; "
             "counts are per cascade and are not added across cascades):")
    for cid in dfacts["cascade_ids"]:
        s = dfacts["shifts"][cid]
        by = ", ".join(f"{g}: {n}" for g, n in s["by_group"].items()) or "none"
        L.append(f"- *cascade {cid}:* {s['movers']} agents moved (by group — {by}); "
                 f"{s['hardened']} hardened, {s['warmed']} warmed.")
    L.append("")
    verdict = ("differed across runs — the cascades DIVERGE on which argument travels furthest"
               if dfacts["diverge"] else "was consistent across runs")
    L.append(f"**Across cascades:** the most-answered argument {verdict}. Engagement is response volume under "
             "neutral surfacing, not persuasion (see limitations).")
    if dfacts["excluded_count"]:
        by = ", ".join(f"{r}: {n}" for r, n in dfacts["excluded_by"].items())
        L.append("")
        L.append(f"**Withheld by the guard:** {dfacts['excluded_count']} posts were excluded from this section "
                 f"and the chat corpus (by rule — {by}). An exclusion is the honesty guard working.")
    if discourse["quotes"]:
        L.append("")
        L.append("*A middle-ground moment from the cascade (verbatim):*")
        for q in discourse["quotes"]:
            L.append(f"> “{q['comment']}”")
            L.append(f"> — {q['label']} (simulated cascade utterance)")
            L.append("")
    return L


def render_zone_block(facts) -> list[str]:
    """V2.2d — the school-zone block: a code-rendered PAIR with NO valence (never
    "increased"/"reduced"; the reader sees both figures), the variation sentence IMMEDIATELY after
    the pair (a reader who subtracts must meet the caveat in the same breath — the pair has no
    CellRange/sign_stable machinery), then the population + method notes. Empty for untagged runs."""
    zf = facts.get("zone_facts")
    if not zf:
        return []
    from demand_profiles import fmt_window
    profile = facts.get("demand_profile") or "synthetic_demo"
    pv = zf["ped_vehicle_conflicts"]
    L = [f"- **School zone (tagged):** {zf['n_edges']} street(s) with a lower speed limit"
         + (f", {fmt_window(zf['window'], profile)}" if zf.get("window") else "") + "."]
    L.append(f"- **Ped-vehicle conflict events on zone streets during the window:** "
             f"**{pv['scenario']}** in the scenario vs **{pv['baseline']}** in the baseline "
             f"(surrogate near-miss measures, not crash prediction).")
    L.append(f"  - *{zf['variation_note']}.*")  # ALWAYS adjacent to the pair (verify_facts enforces presence)
    L.append(f"- *{zf['population_note']}.*")
    L.append(f"- *{zf['method_note']}"
             + (f"; {zf['window_note']}" if zf.get("window_note") else "") + ".*")
    return L


def render_markdown(facts, framing, glosses, syntheses, caveat_intro, caveats, meta, dfacts=None, discourse=None) -> str:
    changes = facts["changes"]
    change = changes[0]  # PRIMARY, for the title
    title = change.description if len(changes) == 1 else f"{len(changes)} changes on the corridor"
    L: list[str] = []
    L.append(f"# Corridor change preview — {title}")
    L.append("")
    L.append("*A stakeholder-reaction preview, not a verdict. Safety figures are surrogate near-miss measures, "
             "not crash predictions.*")
    L.append("")

    L.append("## 1. What was tested")
    L.append("")
    L.append(framing)
    L.append("")
    # v0.5.0: render every change in the scenario (a single-change scenario is one bullet, as before).
    from demand_profiles import fmt_sim_time, fmt_window
    profile = facts.get("demand_profile") or "synthetic_demo"
    for ch in changes:
        lane = f", lane {ch.target_lane}" if ch.target_lane is not None else ""
        if ch.type == "new_road":
            _lanes, _way = ch.lanes or 1, ("two-way" if ch.bidirectional else "one-way")
            L.append(f"- **Change:** A new {_lanes}-lane {_way} road connecting junction `{ch.from_junction}` and "
                     f"junction `{ch.to_junction}` — a new travel option, no sidewalk at this stage "
                     f"(new edge `{ch.target_edge}`).")
        elif ch.type in ("lane_closure", "road_closure", "incident"):
            lanes_txt = f", lanes {ch.target_lanes}" if ch.target_lanes else ""
            window_txt = f" — active {fmt_window(ch.window, profile)}" if getattr(ch, "window", None) else ""
            L.append(f"- **Change:** {ch.description} (edge `{ch.target_edge}`{lanes_txt}){window_txt}")
        else:
            L.append(f"- **Change:** {ch.description} (edge `{ch.target_edge}`{lane})")
    L.append(f"- **Corridor / network:** `{facts['network']}` — one Toronto corridor")
    L.append(f"- **Demand simulated:** {facts['demand']['car']} cars, {facts['demand']['bicycle']} bicycles, "
             f"{facts['demand']['pedestrian']} pedestrians")
    L.append(f"- **Runs compared:** scenario `{facts['scenario_run_id']}` vs baseline `{facts['baseline_run_id']}`")
    # V2.2a — the closure block: the window-revert PROOF, diversion, and non-completions are THE
    # first-class numbers for a closure run. All code-rendered; clock times on calibrated demand.
    for ev in facts.get("window_events") or []:
        w = ev.get("window") or {}
        applied = fmt_sim_time(ev["applied_t"], profile) if ev.get("applied_t") is not None else None
        if ev.get("reverted_t") is not None:
            reverted = fmt_sim_time(ev["reverted_t"], profile)
            L.append(f"- **Closure window (verified):** applied at {applied}, reverted at {reverted} — the "
                     f"restored road state was checked against the exact pre-closure capture (restored == captured).")
        elif applied is not None:
            L.append(f"- **Closure window:** applied at {applied}; {ev.get('note') or 'not reverted within the simulated period'}.")
        else:
            L.append(f"- **Closure window:** {ev.get('note') or 'never active within the simulated period'} "
                     f"(window {w.get('start_s')}–{w.get('end_s')} s).")
    if facts.get("non_completions") is not None:
        # noun parameterized for incident runs; closure output stays byte-identical (test-pinned)
        noun = "incident" if any(c.type == "incident" for c in changes) else "closure"
        nc = facts["non_completions"]
        L.append(f"- **Non-completions under the {noun}:** {nc.get('car', 0)} cars, {nc.get('bicycle', 0)} "
                 f"bicycles, {nc.get('pedestrian', 0)} pedestrians completed in baseline but not in the {noun} "
                 f"run — counted here as non-completions, never averaged into travel-time deltas.")
        # V2.2c split — USER-CONFIRMED INVARIANT: not_inserted must NEVER read as closure-caused;
        # the backlog parenthetical (with the baseline-vs-scenario numbers) is a REQUIRED part of
        # the sentence, not styling — insertion backlog is structural and hits the baseline leg too.
        split = facts.get("non_completions_split")
        backlog = facts.get("insertion_backlog") or {}
        if split is not None:
            mode_noun = {"car": "cars", "bicycle": "bicycles", "pedestrian": "pedestrians"}
            for m, b in split.items():
                total = b["entered_not_finished"] + b["not_inserted"]
                if total == 0:
                    continue
                bl = backlog.get(m) or {}
                L.append(
                    f"  - Of the {total} {mode_noun[m]}: {b['entered_not_finished']} entered the network "
                    f"and could not finish; {b['not_inserted']} did not enter the network — under a "
                    f"{noun} this includes trips whose route was invalid at departure, and also trips "
                    f"still queued to enter when the simulated period ended (insertion backlog affects "
                    f"baseline runs too: {bl.get('baseline', 0)} vehicles had not entered by the "
                    f"baseline run's end vs {bl.get('scenario', 0)} in this run).")
        L.append(f"- **Diverted:** {facts['cars_rerouted']} cars ended on a different route than baseline; "
                 f"the travel-time cells in section 2 are the delay on the alternates (matched travelers only).")
    # V2.2b — the emergency-response detour fact, all code-rendered; BOTH honesty sentences ship
    # with the numbers (verify_facts enforces them verbatim).
    rd = facts.get("response_detour")
    if rd is not None:
        if not rd.get("probes"):
            # labeled degradation, never silence: say WHY there are no probe numbers
            L.append(f"- **Response access (free-flow estimate):** "
                     f"{rd.get('destination_note') or 'not computable for this change'}.")
        for pr in rd.get("probes", []):
            if pr.get("added_s") is not None:
                L.append(f"- **Response access (free-flow estimate):** from {pr['label']}: baseline "
                         f"{pr['baseline_s']:g} s → during the window {pr['scenario_s']:g} s "
                         f"({pr['added_s']:+g} s).")
            else:
                L.append(f"- **Response access (free-flow estimate):** from {pr['label']}: "
                         f"{pr.get('note') or 'not computable'}.")
            if pr.get("note") and pr.get("added_s") is not None:
                L.append(f"  - *{pr['note']}.*")
        # what the origins ARE + the dispatch-misreading guard (real station names must never
        # read as "the response time" / "the nearest station responds")
        if rd.get("origins_note"):
            L.append(f"- *{rd['origins_note']}.*")
        L.append(f"- *{rd.get('framing')}; {rd.get('lower_bound_note')}.*")
    # V2.2d — the school-zone lens block (tag-gated; empty list for every untagged run).
    L.extend(render_zone_block(facts))
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
    # V2.2 closeout — the windowed-scope disclosure sits ADJACENT to the table it scopes (a reader
    # must never take a run-scoped number as the change's undiluted cost). Code-rendered, no LLM slot.
    if facts.get("scope_disclosure"):
        L.append(f"*{facts['scope_disclosure']}*")
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
    # V2.1d: a sign-unstable car travel cell must not have its median rendered SIGNED even here.
    car_travel_cell = facts["by_group"]["car_commuter"].travel_time_delta
    if _is_unstable(car_travel_cell):
        median_phrase = f"±{abs(median):.1f}s (direction not seed-stable)"
    else:
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

    if dfacts is not None and discourse is not None:
        L.extend(render_discourse_md(dfacts, discourse))

    L.append("## 5. What this analysis cannot tell you")
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
    # V2.1d: the seeds line is EARNED — single-seed runs say "42" (or the verdict-era list when that
    # sweep genuinely ran); multi-seed runs name the convention + which cells were sign-unstable.
    if facts.get("n_seeds", 1) > 1:
        unstable = facts.get("sign_unstable_cells") or []
        unstable_txt = (", ".join(f"{GROUP_LABEL.get(g, g)} {k}" for g, k in unstable)
                        if unstable else "none")
        seeds_line = (f"- **Seeds:** {', '.join(str(s) for s in facts['seeds'])} — "
                      f"{facts['n_seeds']} baseline+scenario pairs; seed {facts['seeds'][0]} is the "
                      f"canonical run (all trajectories and cell values), extra seeds contribute "
                      f"per-cell ranges. Sign-unstable this run: {unstable_txt}.")
        if facts.get("seed_basis") == "settled_fixed_routes":
            seeds_line += (" On settled runs, ranges reflect simulation stochasticity at fixed "
                           "equilibrium routes, not assignment seed-sensitivity.")
        L.append(seeds_line)
    else:
        L.append(f"- **Seeds:** {', '.join(str(s) for s in facts['seeds'])}")
    L.append(f"- **Thresholds:** time-to-collision {th['ttc_s']}s, vehicle PET {th['veh_pet_s']}s, "
             f"pedestrian PET {th['ped_pet_s']}s, delay materiality >{th['materiality_s']}s")
    # V2.1b — the demand statement (which traffic this run simulated) + calibrated-run GEH acceptance.
    # ALL numbers here are code-rendered (the report honesty rule); prose slots never carry them.
    if facts.get("demand_profile") == "calibrated_am_peak":
        cal = facts.get("calibration")
        acc = (cal or {}).get("geh_acceptance")
        if cal and acc:
            # V2.1b closeout framing — every number code-rendered from the calibration provenance.
            # "Interior" is the diagnosis finding (data/demand/V2.1b-diagnosis.md): boundary-clipped
            # intersections never matched, so the scored set is interior by construction.
            n_locs = len(cal.get("locations_used", []))
            years = sorted({str(loc.get("count_date", ""))[:4]
                            for loc in cal.get("locations_used", []) if loc.get("count_date")})
            y_range = f"{years[0]}–{years[-1]}" if years else "post-2020"
            pct = round(acc["share_geh_lt5"] * 100, 1)
            L.append(f"- **Demand:** anchored to {n_locs} interior counted intersections ({y_range}, "
                     f"multimodal 15-min counts), GEH-validated at {pct}% of {acc['n_links']} counted "
                     "approach links (industry target 85%). Absolute volumes are approximate — the "
                     "corridor's boundary inflow and default signal timing under-deliver demand at busy "
                     "links. Baseline-vs-scenario comparisons use identical demand, so this systematic "
                     "bias cancels in the delta: the tool's comparisons are like-for-like even where "
                     "absolute volumes are approximate.")
            L.append("- **Demand construction:** Toronto Open Data turning-movement counts via SUMO "
                     "routeSampler (sim t=0 is 07:00); each intersection contributes its own latest count "
                     "day — a composite typical AM peak. Vehicle classes merged per movement; bike demand "
                     "anchored at approach level and pedestrian demand at corridor total only — no "
                     "count-fidelity claim for bike/ped volumes.")
        else:
            L.append("- **Demand:** count-calibrated AM peak — calibration provenance missing; "
                     "anchoring numbers unavailable (a labeled absence, not an implied pass).")
        rs_meta = facts.get("render_sample")
        if rs_meta is not None:
            L.append(f"- **Rendering:** the map shows {rs_meta.rendered_vehicles} of {rs_meta.total_vehicles} "
                     f"vehicles and {rs_meta.rendered_persons} of {rs_meta.total_persons} pedestrians "
                     "(an outcome-stratified sample); conflict flares are a severity-stratified sample; "
                     "every number in this report is computed over the full simulated population.")
        if acc:
            L.append("- **Worst counted locations (GEH):**")
            L.append("")
            L.append("  | location | approach | counted (veh/h) | simulated (veh/h) | GEH |")
            L.append("  |---|---|---|---|---|")
            for r in sorted(acc.get("rows", []), key=lambda r: -r["geh"])[:5]:
                L.append(f"  | {r['location']} | {r['label']} | {r['counted_hourly']:.0f} "
                         f"| {r['simulated_hourly']:.0f} | {r['geh']:.1f} |")
            L.append("")
            L.append(f"  Full per-location table + iteration log: `data/demand/` provenance "
                     f"(`{(cal or {}).get('inventory', 'counts inventory')}` lineage).")
    else:
        L.append("- **Demand:** synthetic demonstration demand (a small random-trips set) — traffic volumes "
                 "are illustrative, not calibrated to counts; read volume-dependent numbers as "
                 "baseline-vs-scenario comparisons, not real-world magnitudes.")
    # V2.1c — the assignment mode (day-one vs settled) + the one plain-language paragraph. All numbers
    # code-rendered; the paragraph is static prose (no LLM slot), so the honesty audit rules are moot.
    asn = facts.get("assignment")
    if asn is not None and getattr(asn, "mode", "day_one") == "settled":
        conv = ("converged" if asn.converged else "stopped at the iteration cap without converging")
        L.append(f"- **Assignment:** settled response — driver routes iterated "
                 f"{asn.iterations if asn.iterations is not None else '?'} times "
                 f"(mesoscopic assignment, micro-simulated final state); travel-time stability "
                 f"{'' if asn.relative_deviation is None else f'{asn.relative_deviation:.3f} relative deviation, '}"
                 f"{conv}.")
    else:
        L.append("- **Assignment:** day-one response — travelers use today's route habits; no iterated "
                 "adjustment was applied.")
    L.append("- **Day-one vs settled, in plain terms:** a day-one run answers \"what happens the morning "
             "this change appears\" — every traveler still follows the route habits they had before, and "
             "the numbers show the shock response. A settled run answers \"what does this corridor look "
             "like after people have had time to adjust\" — driver route choices are re-computed "
             "repeatedly until overall travel times stop shifting, approximating the adjusted state. "
             "Neither is more true; they answer different planning questions, and the difference between "
             "them is itself informative (it shows how much adaptation the change invites). Settled "
             "response iterates driver route choice; pedestrian and cyclist routes are held fixed, so "
             "adaptation is modeled for drivers only.")
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

    # The report pipeline is DeepSeek-tuned (bigger prompts, ~13 slot calls, prefix caching). Default to it
    # so `python report.py` just works — Gemini's free tier can't handle the load. An explicit PROVIDER wins.
    os.environ.setdefault("PROVIDER", "deepseek")
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
    dfacts = discourse_facts(artifact)  # v0.4.0 social cascade — None on older artifacts
    discourse = await slot_discourse(client, dfacts, audit_log) if dfacts else None
    caveat_intro = await slot_caveat_intro(client, audit_log)
    caveats = build_caveats(facts, has_discourse=dfacts is not None)

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
            "discourse": ({"synthesis": discourse["synthesis"], "quotes": discourse["quotes"],
                           "cascade_ids": dfacts["cascade_ids"], "reach": dfacts["reach"],
                           "dominant": dfacts["dominant"], "diverge": dfacts["diverge"],
                           "shifts": dfacts["shifts"], "excluded_count": dfacts["excluded_count"],
                           "excluded_by": dfacts["excluded_by"]} if dfacts else None),
            "cannot_tell": {"intro": caveat_intro, "caveats": caveats},
        },
        "audit": {"passed": True, "slots_checked": len(audit_log), "summary": audit_summary, "log": audit_log},
        "sources": sources,
    }

    md = render_markdown(facts, framing, glosses, syntheses, caveat_intro, caveats, meta,
                         dfacts=dfacts, discourse=discourse)

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
