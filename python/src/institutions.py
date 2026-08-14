"""V2.3c — mandate-grounded institutional voices (contract v0.9.0).

D1 rule: an institutional voice may say ONLY two kinds of things — its PUBLISHED mandate (sourced,
quoted verbatim from institutions.json; NEVER reworded, truncated, or LLM-touched anywhere in the
pipeline: for a real organization, paraphrase is misrepresentation — byte-identity test-pinned) and
CODE-RENDERED facts from this run's outcomes sidecar. Everything here is DETERMINISTIC — no LLM.

Facts gating: ``speaks`` is a PURE function of sidecar-key presence/nonzero (the single gate source,
recomputable by report.verify_facts) — an institution with no relevant facts in a run does NOT speak,
and never pads. The honesty sentences (free-flow/lower-bound framing, the zone variation/population
notes, the backlog attribution parenthetical) ride the citations verbatim wherever the numbers go.

Impersonation rule: these are REAL organizations. Every composed voice is THIRD person, framed as a
"mandate lens" reading by this tool — never a statement by, from, or on behalf of the institution.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlparse

from contract_models import Reaction

ROSTER_PATH = Path(__file__).resolve().parent / "institutions.json"


@lru_cache(maxsize=1)
def load_roster() -> list[dict]:
    """The institutions array only — underscore-prefixed keys are documentation, never read."""
    data = json.loads(ROSTER_PATH.read_text(encoding="utf-8"))
    roster = data["institutions"]
    if not roster:
        raise RuntimeError(f"no institutions defined in {ROSTER_PATH}")
    return roster


def _get_path(side: dict, dotted: str):
    """Resolve a dotted sidecar path ('reroute.cars_rerouted') to its value, or None."""
    cur = side
    for part in dotted.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return None
        cur = cur[part]
    return cur


def _has_signal(value) -> bool:
    """Does a fact payload carry anything to STAND on? A purely numeric tree of zeros does not (a
    closure smoke run's non_completions {car:0,...} exists but says nothing — citing it would be
    padding, live-acceptance-caught). Any non-numeric content (the zone lens' notes, the detour
    payload's framing strings/probes) is structural standing even when its counts are zero — those
    payloads exist only on runs where the observation was designated."""
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, dict):
        return any(_has_signal(v) for v in value.values())
    if isinstance(value, (list, tuple)):
        return any(_has_signal(v) for v in value)
    return bool(value)  # strings/None


def speaks(entry: dict, side: dict) -> dict | None:
    """The facts-gating rule: returns the subset of sidecar facts this institution may cite, or
    None when the run computed nothing in its mandate (no facts -> no voice; never pads —
    presence of an all-zero numeric payload is NOT standing)."""
    req = entry.get("facts_required") or {}
    hit = any(_has_signal(side.get(k)) for k in req.get("any_of", []))
    if not hit:
        for dotted in req.get("or_nonzero", []):
            v = _get_path(side, dotted)
            if isinstance(v, (int, float)) and v > 0:
                hit = True
                break
    if not hit:
        return None
    facts: dict = {}
    for key in entry.get("cites", []):
        if side.get(key) is not None:
            facts[key] = side[key]
    return facts or None


def speaking_institutions(side: dict) -> list[tuple[dict, dict]]:
    """(roster entry, facts subset) for every institution the sidecar gives standing to."""
    out = []
    for entry in load_roster():
        facts = speaks(entry, side)
        if facts is not None:
            out.append((entry, facts))
    return out


# ===================================================================================================
# Citation composition — code-rendered fact sentences + the verbatim honesty notes riding along
# ===================================================================================================


_MEMBER_TYPE_PHRASE = {"road_closure": "road closure", "lane_closure": "lane closure",
                       "incident": "incident"}


def _members_end_frag(e: dict, noun: str) -> str:
    """One terse fragment per end (the ratified aggregation rule: stations aggregate, per-station
    figures never enter the citation — the report/corpus carry them)."""
    if e.get("status") == "no_approach":
        return f"{e['label']} not probeable (no approach)"
    rows = e.get("probes", [])
    reach = [r for r in rows if r.get("added_s") is not None]
    unre = [r for r in rows if r.get("added_s") is None]
    if not reach:
        return f"{e['label']} unreachable from all {len(rows)} {noun}"
    worst = max(r["added_s"] for r in reach)
    if unre:
        return f"{e['label']} worst of the reachable {worst:+g} s ({len(unre)} of {len(rows)} unreachable)"
    return f"{e['label']} worst {worst:+g} s"


def _cite_response_members(rd: dict) -> dict:
    """V2.5b members shape. Length is the binding constraint (the TFS comment embeds this text in
    a non-scrollable feed block): per-member clauses, fully-reachable/-unreachable end pairs
    COLLAPSE, and the capstone names only stations unreachable at EVERY probed end — a station
    cut off at one end but fine at the other is a count, not a name (naming it would read as
    fully cut off). The metric phrase is the V2.5b vocabulary; never the legacy number-bearing
    "…s added response-route time" (cross-vintage incomparability, test-pinned)."""
    origins = rd.get("origins") or []
    noun = ("stations" if origins and all(o.get("represents") == "fire_station" for o in origins)
            else "response-route origins")
    clauses: list[str] = []
    for m in rd.get("members", []):
        ends = m.get("ends", [])
        rows_ok = [e for e in ends if e.get("status") != "no_approach"]
        all_reach = rows_ok and len(rows_ok) == len(ends) == 2 and all(
            r.get("added_s") is not None for e in rows_ok for r in e.get("probes", []))
        all_unre = rows_ok and len(rows_ok) == len(ends) == 2 and all(
            r.get("added_s") is None for e in rows_ok for r in e.get("probes", []))
        head = f"{_MEMBER_TYPE_PHRASE.get(m.get('type'), m.get('type'))} {m['edge']} — "
        if all_reach:
            worst = max(r["added_s"] for e in ends for r in e["probes"])
            clause = head + f"worst {worst:+g} s across both ends"
        elif all_unre:
            n = max(len(e.get("probes", [])) for e in ends)
            clause = head + f"unreachable from all {n} {noun} at both ends"
        else:
            clause = head + "; ".join(_members_end_frag(e, noun) for e in ends)
        clauses.append(clause[0].upper() + clause[1:])
    text = "Response access (free-flow estimate): " + ". ".join(clauses) + "."
    # capstone: stations with a finite-baseline row somewhere but NO reachable row anywhere
    cut_off: list[str] = []
    for o in origins:
        rows = [r for m in rd.get("members", []) for e in m.get("ends", [])
                for r in e.get("probes", []) if r.get("label") == o.get("label")]
        probed = [r for r in rows if r.get("baseline_s") is not None]
        if probed and all(r.get("added_s") is None for r in probed):
            cut_off.append(o["label"])
    if cut_off:
        text += f" Unreachable at every probed end: {'; '.join(cut_off)}."
    notes = [n for n in (rd.get("framing"), rd.get("lower_bound_note"),
                         rd.get("window_coincidence_note"), rd.get("origins_note"),
                         rd.get("end_method_note"), rd.get("probed_members_note")) if n]
    return {"key": "response_detour", "text": text, "notes": notes}


def _cite_response_detour(rd: dict) -> dict:
    # V2.5b shape dispatch — a payload with NEITHER key must raise, never fall through to the
    # legacy "could not be computed" degradation (TFS speaking a falsehood with all guards green)
    if rd.get("members"):
        return _cite_response_members(rd)
    if rd.get("probes") is None:
        raise ValueError("response_detour payload has neither 'members' nor 'probes' — refusing "
                         "to compose a citation that could misstate the fact")
    probes = rd.get("probes") or []
    numeric = [p for p in probes if isinstance(p.get("added_s"), (int, float))]
    # A probe whose destination becomes UNREACHABLE while the change is active is the single most
    # consequential fact in the payload — it must be NAMED, never silently dropped (the doorstep
    # closure exposed exactly this: "worst of 4" listing 3 rows, 231-unreachable omitted).
    unreachable = [p for p in probes
                   if p.get("added_s") is None and "unreachable" in (p.get("note") or "")]
    # NEVER assume the origin kind — old sidecars carry the retired corridor-entry probes, and
    # calling those "fire stations" would misdescribe the data (live-acceptance-caught)
    origins = ("fire stations" if probes and all(p.get("represents") == "fire_station" for p in probes)
               else "response-route origins")
    if numeric:
        worst = max(p["added_s"] for p in numeric)
        per = "; ".join(f"{p['label']}: {p['added_s']:+g} s" for p in numeric)
        if unreachable:
            names = "; ".join(p["label"] for p in unreachable)
            text = (f"Response access (free-flow estimate): {len(unreachable)} of {len(probes)} "
                    f"{origins} unreachable during the window; worst of the reachable {worst:+g} s "
                    f"added response-route time ({per}; unreachable: {names}).")
        else:
            text = (f"Response access (free-flow estimate): worst of {len(probes)} {origins} "
                    f"{worst:+g} s added response-route time ({per}).")
    elif unreachable and len(unreachable) == len(probes):
        text = (f"Response access (free-flow estimate): all {len(probes)} {origins} unreachable "
                "during the window.")
    else:
        text = ("Response access: the free-flow response-route estimate could not be computed "
                "for any station in this run.")
    # the honesty sentences are LIFTED from the payload (single source; report.verify_facts pins
    # the payload strings against the response_probe constants) — framing first, it rides inline
    notes = [n for n in (rd.get("framing"), rd.get("lower_bound_note"),
                         rd.get("window_coincidence_note"), rd.get("origins_note")) if n]
    return {"key": "response_detour", "text": text, "notes": notes}


def _cite_zone_facts(zf: dict) -> dict:
    pv = zf["ped_vehicle_conflicts"]
    text = (f"Ped-vehicle conflict events on zone streets during the window: {pv['scenario']} in "
            f"the scenario vs {pv['baseline']} in the baseline (surrogate near-miss measures, not "
            f"crash prediction).")
    notes = [n for n in (zf.get("variation_note"), zf.get("population_note"), zf.get("method_note"),
                         zf.get("window_note")) if n]
    return {"key": "zone_facts", "text": text, "notes": notes}


def _cite_reroute(rr: dict) -> dict:
    text = (f"{rr.get('cars_rerouted', 0)} of {rr.get('cars_matched', 0)} matched car trips "
            f"diverted onto other streets during the run.")
    return {"key": "reroute", "text": text, "notes": []}


def _cite_non_completions(facts: dict) -> dict:
    nc = facts["non_completions"]
    total = sum(nc.values())
    per = ", ".join(f"{m} {n}" for m, n in nc.items() if n > 0) or "none"
    text = f"Trips that completed in the baseline but not this scenario: {total} ({per})."
    split = facts.get("non_completions_split")
    backlog = facts.get("insertion_backlog")
    if split and backlog:
        entered = sum(b.get("entered_not_finished", 0) for b in split.values())
        not_ins = sum(b.get("not_inserted", 0) for b in split.values())
        bl_b = sum(b.get("baseline", 0) for b in backlog.values())
        bl_s = sum(b.get("scenario", 0) for b in backlog.values())
        # the attribution parenthetical is REQUIRED wherever the split renders (the V2.2c invariant:
        # not_inserted is causally neutral — the backlog is structural, not closure-caused)
        text += (f" Of these, {entered} entered the network and could not finish and {not_ins} did "
                 f"not enter the network (insertion backlog affects baseline runs too: {bl_b} "
                 f"vehicles had not entered by the baseline run's end vs {bl_s} in this run).")
    return {"key": "non_completions", "text": text, "notes": []}


def compose_citations(entry: dict, facts: dict) -> list[dict]:
    """The exact facts this institution cites, in roster `cites` order, keys present only."""
    out: list[dict] = []
    for key in entry.get("cites", []):
        if key not in facts:
            continue
        if key == "response_detour":
            out.append(_cite_response_detour(facts[key]))
        elif key == "zone_facts":
            out.append(_cite_zone_facts(facts[key]))
        elif key == "reroute":
            out.append(_cite_reroute(facts[key]))
        elif key == "non_completions":
            out.append(_cite_non_completions(facts))
        # non_completions_split / insertion_backlog fold into the non_completions citation
    return out


def _domain(url: str) -> str:
    return urlparse(url).netloc.removeprefix("www.") or url


def compose_comment(entry: dict, citations: list[dict]) -> str:
    """Third-person mandate-lens voice: the sourced mandate framing + the headline computed fact,
    with the first honesty note riding inline. The mission itself is only ever QUOTED via its
    verbatim clause — the full verbatim mission travels on agent.mandate.mission, untouched."""
    md = entry["mandate"]
    head = citations[0]
    inline = f" ({head['notes'][0]})" if head.get("notes") else ""
    possessive = entry["label"] + ("'" if entry["label"].endswith("s") else "'s")
    return (f"{possessive} published mandate ({_domain(md['source'])}, retrieved "
            f"{md['retrieved']}) prioritizes {entry['mission_clause']}. Read against that mandate, "
            f"this run computed: {head['text'].rstrip('.')}{inline}.")


def compose_reaction(entry: dict, citations: list[dict]) -> Reaction:
    """Institutions recite facts within mandate, never stances — sentiment 0, neutral (the
    contract-layer invariant)."""
    return Reaction(comment=compose_comment(entry, citations), sentiment=0.0, stance="neutral")
