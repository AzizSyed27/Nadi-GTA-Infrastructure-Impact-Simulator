"""V2.5b rung-2 — the emergency-response REACHABILITY fact: per capacity-event member, per
segment END NODE, per station — can a response vehicle still reach addresses ON the changed
segment, and from which direction? Free-flow cost to each end = min over the end's incoming
passenger approaches (NO manual exclusions — the mutated nets encode member state; arriving via
the segment itself in baseline is real; a reverse partner is just another approach), baseline
net vs the ONE during-window net with ALL members applied. This REPLACED the V2.2b single
downstream-anchor walk: the anchor arbitrariness is gone by construction, and shape-split ends
are embraced (an end whose only approach is the closed segment IS unreachable — that is the
answer, not a degradation). Old sidecars keep the legacy ``probes`` shape and render as-is.
Since the V2.2d prelim the origins are 4 REAL Toronto Fire Services stations inside the
corridor bbox (Toronto Open Data; provenance in response_probes.json — the 5th in-bbox station,
221, is documented-dropped: 381 m from the nearest modeled car edge). Routes are computed from
EVERY station — the fact never claims which station would respond (origins_note carries that
guard wherever the numbers render). A routing computation, not a simulation — cheap,
deterministic, and honest about what it is (the honesty sentences below ship with every payload
and render wherever the numbers do).

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
WINDOW_COINCIDENCE_NOTE = (
    "the during-window estimate applies every change simultaneously; where change windows "
    "differ, the figure reflects the most-constrained moment")


def window_coincidence_note(changes: list[Change]) -> str | None:
    """V2.5a: the during-window net applies EVERY member (compute_response_detour), which
    overstates constraint whenever some member is inactive at a moment inside the described
    period — exactly when the WINDOWED members carry >1 distinct window (the
    build_scope_disclosure ``differing`` shape). One windowed member + permanents is EXACT:
    every member is genuinely active during the one window. Conservative in the safe
    direction either way; this sentence says so out loud."""
    if len(changes) <= 1:
        return None
    distinct = {(c.window.start_s, c.window.end_s) for c in changes if c.window is not None}
    return WINDOW_COINCIDENCE_NOTE if len(distinct) > 1 else None


# --- V2.5b rung-2: per-member END-NODE reachability — the honesty sentences (single-sourced;
# each rides the payload and is verify-pinned wherever its numbers render) -------------------
END_METHOD_NOTE = ("cost to a segment end is the fastest available approach to that end in each "
                   "net; baseline and during-window routes may use different approaches")
PROBED_MEMBERS_NOTE = ("reachability is probed for capacity-event members (closures and "
                       "incidents); permanent members shape the routing but are not separately "
                       "probed")
HONEST_ZERO_END_NOTE = ("no added time under free-flow routing — the fastest approach to this "
                        "end is unaffected during the window")
ORIGIN_CLOSED_NOTE = ("this station's origin street is closed during the window — no route from "
                      "it is computable")
END_UNREACHABLE_NOTE = "unreachable from this origin during the window"
END_BASELINE_UNREACHABLE_NOTE = "this end is not reachable from this origin even in baseline"
NO_APPROACH_NOTE = ("no passenger-road approach exists at this end of the segment — reachability "
                    "not probeable")
ORIGIN_UNMATCHED_NOTE = "no car-permitted road within the match radius of this probe point"
DEGENERATE_DIST_M = 5.0  # end-node chord below this → neutral "end A"/"end B" labels

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


def end_entries(edge) -> list[tuple[str, str]]:
    """A member segment's two ends as ``[(node_id, label), ...]`` in STRUCTURAL order
    [from-end, to-end] (order carries topology; labels carry geography). Labels come from the
    dominant axis of the node-to-node CHORD in UTM coords (x east, y north) — approximately right
    on diagonals, deliberately simple: the label answers "which end geographically", not "which
    way traffic flows". |Δx| == |Δy| ties break to east/west (deterministic). Degenerate shapes:
    a loop edge (from == to) gets ONE entry; a chord under DEGENERATE_DIST_M (U-shaped segment)
    gets neutral "end A"/"end B" ordered by node id."""
    f, t = edge.getFromNode(), edge.getToNode()
    if f.getID() == t.getID():
        return [(f.getID(), "both ends (loop segment)")]
    (fx, fy), (tx, ty) = f.getCoord(), t.getCoord()
    dx, dy = tx - fx, ty - fy
    if (dx * dx + dy * dy) ** 0.5 < DEGENERATE_DIST_M:
        by_id = {n.getID(): lbl for n, lbl in zip(sorted((f, t), key=lambda n: n.getID()),
                                                  ("end A", "end B"))}
        return [(f.getID(), by_id[f.getID()]), (t.getID(), by_id[t.getID()])]
    if abs(dx) >= abs(dy):
        f_label, t_label = ("west end", "east end") if dx > 0 else ("east end", "west end")
    else:
        f_label, t_label = ("south end", "north end") if dy > 0 else ("north end", "south end")
    return [(f.getID(), f_label), (t.getID(), t_label)]


def _approach_edges(node) -> list:
    """Incoming passenger edges at an end node, sorted by id — ALL of them, excluding NOTHING
    (ratified V2.5b): the nets already encode member state (a closed segment can't route in the
    scenario net; arriving via the segment itself in baseline is real; a reverse partner is just
    another approach). Manual exclusion lists were the anchor walk's hand-rule — retired."""
    return sorted((e for e in node.getIncoming() if e.allows("passenger")),
                  key=lambda e: e.getID())


def _cost_to_end(net, origin, node) -> float | None:
    """Free-flow seconds from the origin edge to the END NODE = min over its approaches of
    _route_seconds (sorted iteration + strict < → the lowest-id approach wins exact ties).
    getOptimalPath's cost INCLUDES the from edge's and the approach edge's own traversal
    (v1_27_0 finalizeCost, source-verified: includeFromToCost adds the from edge; removeTo is 0
    when toPos is None) — "cost to arrive at the end via that approach", consistent across both
    nets; the slight bias toward short approach edges is shared by both legs.
    SEMANTIC CONSEQUENCES (the public-safety-number check, V2.5b follow-up): the approach edge
    is INCOMING to the end node, so its traversal ends AT the node — the returned cost is
    genuinely "time to arrive at the end", no phantom extra edge; and the from-edge inclusion is
    identical in both legs, so it CANCELS in added_s — unless the origin street itself is a
    modified member, in which case its contribution is real signal, not a systematic offset."""
    best = None
    for a in _approach_edges(node):
        c = _route_seconds(net, origin, a)
        if c is not None and (best is None or c < best):
            best = c
    return best


def baseline_routed(rows: list[dict]) -> list[dict]:
    """Rows with a finite baseline route — the ONLY rows a window-caused claim may count (a
    baseline-null/unmatched row was not made unreachable by the window; review-caught when the
    report render and the citation capstone disagreed about exactly this). SINGLE SOURCE for the
    production consumers (report render, institutions capstone); report.verify_facts keeps its
    own literal re-derivation on purpose — a recompute that reused this could not catch its bugs."""
    return [r for r in rows if r.get("baseline_s") is not None]


def _origin_status(scen_net, origin_edge_id: str) -> str | None:
    """ORIGIN_CLOSED_NOTE iff the station's own origin edge loses passenger permission in the
    during-window net — an EXPLICIT permission check, never sentinel inference: the doorstep
    case (a station on the closed street) must carry its CAUSE, not bare unreachable rows.
    Edge.allows recomputes from live lane permissions per call (pinned SUMO 1.27 behavior)."""
    if not scen_net.getEdge(origin_edge_id).allows("passenger"):
        return ORIGIN_CLOSED_NOTE
    return None


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


def members_from_nets(base_net, scen_net, changes: list[Change], probes: list[dict]) -> dict:
    """V2.5b rung-2: per-member END-NODE reachability on the baseline vs the (already-mutated)
    scenario net. Every capacity-event member's segment ends are probed from every station —
    the anchor arbitrariness of the retired downstream walk is gone BY CONSTRUCTION. A member's
    end-probes reflect the OTHER members' effects too (one during-window net, all members
    applied) — the window-coincidence sentence rides exactly for that; per-window nets are the
    recorded rung-3 non-goal. scen_net must be in the during-window state (apply_to_net)."""
    import change_scheduler

    modified = {c.target_edge for c in changes if c.target_edge}
    out: dict = {"framing": FRAMING, "lower_bound_note": LOWER_BOUND_NOTE,
                 "end_method_note": END_METHOD_NOTE, "modified_edges": sorted(modified)}
    wc = window_coincidence_note(changes)
    if wc:
        out["window_coincidence_note"] = wc
    note = origins_note()
    if note:
        out["origins_note"] = note
    probed = [c for c in changes if change_scheduler.capacity_event(c.type)]
    if len(probed) < len(changes):
        # the members list can be shorter than modified_edges — the gap names itself
        out["probed_members_note"] = PROBED_MEMBERS_NOTE

    # per-station identity ONCE (represents drives the citation noun rule; origin-level causes —
    # unmatched point, origin street closed — live here and repeat on each row they explain)
    origins: list[dict] = []
    origin_rows: list[tuple[str, object, str | None]] = []
    for p in probes:
        o_base = origin_edge(base_net, p["lon"], p["lat"])
        rec: dict = {"label": p["label"],
                     **({"represents": p["represents"]} if p.get("represents") else {}),
                     "origin_edge": o_base.getID() if o_base is not None else None}
        o_note = None
        if o_base is None:
            o_note = ORIGIN_UNMATCHED_NOTE
        else:
            o_note = _origin_status(scen_net, o_base.getID())
        if o_note:
            rec["note"] = o_note
        origins.append(rec)
        origin_rows.append((p["label"], o_base, o_note))
    out["origins"] = origins

    members: list[dict] = []
    for c in probed:
        m: dict = {"edge": c.target_edge, "type": c.type}
        if c.window is not None:
            m["window"] = {"start_s": c.window.start_s, "end_s": c.window.end_s}
        ends: list[dict] = []
        for node_id, label in end_entries(base_net.getEdge(c.target_edge)):
            base_node = base_net.getNode(node_id)
            if not _approach_edges(base_node):
                # structural: zero passenger approaches at this end (boundary stub) — a labeled
                # state, never four identical null rows (possible only at a from-node: the
                # segment itself is always an approach at its to-node)
                ends.append({"node": node_id, "label": label, "status": "no_approach",
                             "note": NO_APPROACH_NOTE})
                continue
            scen_node = scen_net.getNode(node_id)
            rows: list[dict] = []
            for st_label, o_base, o_note in origin_rows:
                if o_base is None:
                    rows.append({"label": st_label, "baseline_s": None, "scenario_s": None,
                                 "added_s": None, "note": ORIGIN_UNMATCHED_NOTE})
                    continue
                base_s = _cost_to_end(base_net, o_base, base_node)
                # an origin street closed during the window is DECLARED, not computed — routing
                # from a permission-stripped edge would be an undefined question
                scen_s = None if o_note == ORIGIN_CLOSED_NOTE else _cost_to_end(
                    scen_net, scen_net.getEdge(o_base.getID()), scen_node)
                # Round FIRST, then derive added_s from the ROUNDED pair (self-consistency —
                # verify_facts recomputes from the rounded values; caught live in V2.4b).
                row: dict = {"label": st_label,
                             "baseline_s": round(base_s, 1) if base_s is not None else None,
                             "scenario_s": round(scen_s, 1) if scen_s is not None else None,
                             "added_s": None, "note": None}
                if base_s is None:
                    row["note"] = END_BASELINE_UNREACHABLE_NOTE
                elif scen_s is None:
                    row["note"] = o_note or END_UNREACHABLE_NOTE
                else:
                    row["added_s"] = round(row["scenario_s"] - row["baseline_s"], 1)
                    if row["added_s"] == 0.0:
                        row["note"] = HONEST_ZERO_END_NOTE
                rows.append({k: v for k, v in row.items()
                             if v is not None or k in ("baseline_s", "scenario_s", "added_s")})
            ends.append({"node": node_id, "label": label, "probes": rows})
        m["ends"] = ends
        members.append(m)
    out["members"] = members
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
    return members_from_nets(base_net, scen_net, changes, probes)
