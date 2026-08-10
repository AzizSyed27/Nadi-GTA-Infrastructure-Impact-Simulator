"""V2.2b — the emergency-response DETOUR fact: free-flow shortest-path travel time from fixed
probe origins to the changed edge's vicinity, baseline net vs the DURING-WINDOW scenario state.
Since the V2.2d prelim the origins are 4 REAL Toronto Fire Services stations inside the
corridor bbox (Toronto Open Data; provenance in response_probes.json — the 5th in-bbox station,
221, is documented-dropped: 381 m from the nearest modeled car edge). Routes are computed from
EVERY station — the fact never claims which station would respond (origins_note carries that
guard wherever the numbers render). A routing computation, not a simulation — cheap, deterministic, and honest about
what it is (both framing sentences below ship with every payload and render wherever the numbers
do).

SUMO 1.27 pins (verified against the v1_27_0 source):
  - ``net.getOptimalPath(from, to, fastest=True, vClass="passenger")`` is a real Dijkstra over
    edge length/speed; its cost IS the free-flow travel time in seconds. ``getShortestPath`` is
    DISTANCE-only — never use it here. Unreachable returns ``(None, 1e400)`` — detected by
    ``path is None or cost > 1e39`` (never float equality; a slipped sentinel would render 1e400
    seconds as the detour).
  - ``Lane.setPermissions(())`` mutations are live (permissions recomputed per call). NEVER call
    ``net.initRoutingCache`` — it memoizes Dijkstra frontiers with no invalidation on mutation.
  - sumolib has NO public speed setter — the speed_factor mutation pokes the private
    ``Edge._speed`` (what the fastest-path cost reads), guarded in the PRODUCTION path so a SUMO
    upgrade produces a loud crash pointing here, never a quietly-unmodified speed.
  - ``Edge.getSpeed()`` returns the LAST-parsed (highest-index) lane's speed — fine for the
    uniform car lanes this corridor has; documented, not assumed.
"""

from __future__ import annotations

import json
from pathlib import Path

import run_sim  # puts SUMO_HOME/tools on sys.path
import sumolib
from contract_models import Change

FRAMING = "estimated added response-route time; free-flow routing, not a dispatch model"
LOWER_BOUND_NOTE = ("free-flow estimate; does not include congestion the incident induces — "
                    "a lower bound on added response time")

PROBES_PATH = Path(__file__).parent / "response_probes.json"
ORIGIN_MATCH_RADIUS_M = 150.0
_UNREACHABLE_COST = 1e39  # threshold, NOT equality — sumolib's sentinel is (None, 1e400)


def load_probes(path: Path = PROBES_PATH) -> list[dict]:
    """Reads ONLY the "probes" array — underscore-prefixed TOP-LEVEL keys (_provenance, _retired,
    any future _notes) are documentation and must never be folded in (a name-special-cased loader
    would silently resurrect the retired origins)."""
    return json.loads(path.read_text(encoding="utf-8"))["probes"]


def origins_note(path: Path = PROBES_PATH) -> str | None:
    """The reader-facing sentence for WHAT the origins are + the dispatch-misreading guard: real
    station names invite "this is the response time" / "the nearest station responds" — neither is
    computed. Built from the file's _provenance so the retrieval date can't drift from the data."""
    prov = json.loads(path.read_text(encoding="utf-8")).get("_provenance")
    if not isinstance(prov, dict):
        return None
    return (f"probe origins are Toronto Fire Services station locations (Toronto Open Data, "
            f"retrieved {prov.get('retrieved_at', 'date unknown')}); routes are computed from every "
            f"station and do not indicate which station would respond")


def origin_edge(net, lon: float, lat: float):
    """Nearest car-permitted edge to a probe point (None if nothing within the radius).
    getNeighboringEdges does NOT permission-filter — we do (the count_inventory.match_edge
    lesson); min over (dist, id) keeps the pick deterministic."""
    x, y = net.convertLonLat2XY(lon, lat)
    cands = [(d, e) for e, d in net.getNeighboringEdges(x, y, r=ORIGIN_MATCH_RADIUS_M)
             if e.allows("passenger")]
    if not cands:
        return None
    return min(cands, key=lambda de: (de[0], de[1].getID()))[1]


MAX_ANCHOR_HOPS = 15  # bound the downstream walk past pass-through shape-split nodes


def destination_edge(net, target_edge_id: str, modified: set[str]) -> tuple[str | None, str]:
    """The response DESTINATION: a deterministic passenger edge at the first DOWNSTREAM junction
    that has an ALTERNATE approach (an incoming passenger edge other than the walked corridor
    chain / modified edges). Two properties make the fact load-bearing:
      - anchoring DOWNSTREAM of the target means routes to the destination traverse the target
        when it is the fast approach, so the during-window mutation actually moves the number
        (a near-side destination could never route over the target — identically-zero fact);
      - requiring an ALTERNATE approach walks past pure pass-through shape-split nodes (1-in/
        1-out), whose only approach IS the target — anchoring there would degrade every full
        closure to a blanket "unreachable" instead of a detour number.
    Lexicographically-smallest ids break every tie (deterministic). Same edge for BOTH nets.
    Returns (edge_id | None, note naming the rule that fired)."""
    target = net.getEdge(target_edge_id)
    chain = {target_edge_id}
    cur = target
    node = target.getToNode()
    for _hop in range(MAX_ANCHOR_HOPS):
        alt_in = [e for e in node.getIncoming()
                  if e.allows("passenger") and e.getID() not in chain and e.getID() not in modified]
        if alt_in:  # a real junction — anchor here
            def _ok(e) -> bool:
                return (e.getID() not in modified and e.getID() != target_edge_id
                        and e.allows("passenger"))
            outgoing = sorted((e for e in node.getOutgoing() if _ok(e)), key=lambda e: e.getID())
            if outgoing:
                return outgoing[0].getID(), (
                    f"first outgoing passenger edge at the first downstream junction with an "
                    f"alternate approach ({_hop} hop(s) past the changed road)")
            fallback = sorted(alt_in, key=lambda e: e.getID())
            return fallback[0].getID(), (
                f"fallback: an alternate approach edge at the first downstream junction "
                f"({_hop} hop(s) past the changed road; no onward edge)")
        nxt = sorted((e for e in node.getOutgoing()
                      if e.allows("passenger") and e.getID() not in chain), key=lambda e: e.getID())
        if not nxt:
            return None, "dead-end downstream of the changed road — detour not computable"
        cur = nxt[0]
        chain.add(cur.getID())
        node = cur.getToNode()
    return None, (f"no downstream junction with an alternate approach within {MAX_ANCHOR_HOPS} "
                  f"hops of the changed road — detour not computable")


def apply_to_net(net, change: Change):
    """Mutate a THROWAWAY sumolib net instance to the change's during-window state; returns an
    ``undo()`` callable restoring the exact prior state (the test fixture shares instances)."""
    edge = net.getEdge(change.target_edge)
    lanes = edge.getLanes()
    prior_perms = [ln.getPermissions() for ln in lanes]
    prior_edge_speed = edge.getSpeed() if hasattr(edge, "_speed") else None

    if change.type == "road_closure":
        closed = list(range(len(lanes)))
    elif change.type == "lane_closure":
        closed = list(change.target_lanes)
    elif change.type == "incident" and change.effect and change.effect.blocked:
        closed = list(change.target_lanes)
    else:
        closed = []
    for i in closed:
        lanes[i].setPermissions(())  # live: Edge.allows recomputes per call (no routing cache)

    if change.type == "speed_limit" and change.value_mps:
        # V2.4b: a mixed composite's speed_limit member must shape the during-window net — its
        # edge already enters the exclusion set, so leaving its slowdown invisible to routing
        # would under-report added_s. Same pinned SUMO 1.27 internal as the factor poke below.
        if not hasattr(edge, "_speed"):
            raise RuntimeError(
                "sumolib Edge has no `_speed` — this poke is pinned to SUMO 1.27 internals (no "
                "public speed setter exists); the SUMO version changed — re-verify and re-pin "
                "before trusting speed_limit detours (a silent no-op here would quietly "
                "under-report response delay)."
            )
        edge._speed = change.value_mps

    factor = change.effect.speed_factor if (change.type == "incident" and change.effect) else None
    if factor is not None:
        if not hasattr(edge, "_speed"):
            raise RuntimeError(
                "sumolib Edge has no `_speed` — this poke is pinned to SUMO 1.27 internals (no "
                "public speed setter exists); the SUMO version changed — re-verify and re-pin "
                "before trusting speed_factor detours (a silent no-op here would quietly "
                "under-report response delay)."
            )
        edge._speed = edge._speed * factor  # SUMO 1.27 internal; no public speed setter exists; guarded because this WILL break on upgrade.

    def undo() -> None:
        for ln, perms in zip(lanes, prior_perms):
            ln.setPermissions(perms)
        if prior_edge_speed is not None and hasattr(edge, "_speed"):
            edge._speed = prior_edge_speed

    return undo


def _route_seconds(net, from_edge, to_edge) -> float | None:
    """Free-flow fastest-path seconds, or None when unreachable (sentinel detected by
    threshold, never float equality)."""
    path, cost = net.getOptimalPath(from_edge, to_edge, fastest=True, vClass="passenger")
    if path is None or cost > _UNREACHABLE_COST:
        return None
    return float(cost)


def detour_from_nets(base_net, scen_net, changes: list[Change], probes: list[dict]) -> dict:
    """Per-probe free-flow route times on the baseline vs the (already-mutated) scenario net.
    scen_net must be in the during-window state (apply_to_net)."""
    modified = {c.target_edge for c in changes}
    dest_id, dest_note = destination_edge(base_net, changes[0].target_edge, modified)
    out: dict = {"framing": FRAMING, "lower_bound_note": LOWER_BOUND_NOTE,
                 "destination_edge": dest_id, "destination_note": dest_note, "probes": []}
    # V2.4b: the exclusion set and the anchor are FACTS about the estimate — logged where the
    # number lives. The anchor choice is ORDER-DEPENDENT on composites (changes[0]); the note
    # says so out loud rather than leaving two same-edges-different-order runs unexplained.
    out["modified_edges"] = sorted(modified)
    out["destination_anchor"] = changes[0].target_edge
    if len(changes) > 1:
        out["anchor_note"] = ("destination anchored to the first change; with multiple modified "
                              "edges this choice is arbitrary and affects the estimate")
    note = origins_note()
    if note:
        out["origins_note"] = note
    if dest_id is None:
        return out
    blocked_only = any(
        (c.type in ("lane_closure",) or (c.type == "incident" and c.effect and c.effect.blocked))
        and not (c.type == "incident" and c.effect and c.effect.speed_factor is not None)
        for c in changes)
    for p in probes:
        o_base = origin_edge(base_net, p["lon"], p["lat"])
        represents = p.get("represents")
        if o_base is None:
            out["probes"].append({"label": p["label"], "origin_edge": None, "baseline_s": None,
                                  "scenario_s": None, "added_s": None,
                                  **({"represents": represents} if represents else {}),
                                  "note": "no car-permitted road within the match radius of this probe point"})
            continue
        base_s = _route_seconds(base_net, o_base, base_net.getEdge(dest_id))
        scen_s = _route_seconds(scen_net, scen_net.getEdge(o_base.getID()), scen_net.getEdge(dest_id))
        # Round FIRST, then derive added_s from the ROUNDED pair: the stored triple must be
        # arithmetically self-consistent (verify_facts recomputes from the rounded values, and so
        # would any reader — raw-minus-raw can straddle a rounding boundary; caught live).
        row: dict = {"label": p["label"], "origin_edge": o_base.getID(),
                     **({"represents": represents} if represents else {}),
                     "baseline_s": round(base_s, 1) if base_s is not None else None,
                     "scenario_s": round(scen_s, 1) if scen_s is not None else None,
                     "added_s": None, "note": None}
        if base_s is not None and scen_s is not None:
            row["added_s"] = round(row["scenario_s"] - row["baseline_s"], 1)
            if row["added_s"] == 0.0:
                # an honest zero always carries its explanation (station origins commonly route
                # around the changed stretch entirely — a bare 0 would read as "no impact found")
                row["note"] = (
                    "the changed road stays passable at unchanged free-flow speed on this route — "
                    "no added time under free-flow routing" if blocked_only else
                    "the fastest route from this origin does not use the changed road under "
                    "free-flow conditions")
        elif scen_s is None and base_s is not None:
            row["note"] = "destination unreachable from this origin during the window"
        elif base_s is None:
            row["note"] = "destination unreachable from this origin even in baseline"
        out["probes"].append({k: v for k, v in row.items() if v is not None or k in
                              ("baseline_s", "scenario_s", "added_s", "origin_edge")})
    return out


def compute_response_detour(changes: list[Change], net_path: Path = None,
                            probes: list[dict] | None = None) -> dict:
    """The full fact: two fresh net reads (~5 s each — an analysis-stage cost), scenario instance
    mutated to the during-window state. Seed-independent static routing — compute ONCE per run."""
    net_path = net_path or run_sim.NET
    probes = probes if probes is not None else load_probes()
    base_net = sumolib.net.readNet(str(net_path))
    scen_net = sumolib.net.readNet(str(net_path))
    for c in changes:
        # V2.4b: EVERY member shapes the during-window net (a speed_limit member's slowdown is
        # real free-flow routing input); the gate for computing the fact at all stays
        # any_capacity_event upstream.
        apply_to_net(scen_net, c)
    return detour_from_nets(base_net, scen_net, changes, probes)
