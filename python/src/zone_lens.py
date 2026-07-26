"""V2.2d — the tag-driven ZONE LENS: ped-vehicle crossing conflicts on zone streets during the
window, counted IDENTICALLY on the baseline and scenario FULL conflict lists (never the capped
render sample). A code-rendered PAIR with no valence — the report renders both figures and lets
neither imply a direction.

PURE module: the point→zone distance function is INJECTED (production wiring builds it from the
sumolib net via ``net_dist_fn``), so the count rule is unit-testable without a net.

HONESTY LOCKS (user-locked, 2026-07-26):
  - ``population_note`` NAMES the measured population per demand profile (synthetic demo demand /
    TMC-anchored calibrated demand) — never modeled schoolchildren; the student demand segment is
    deferred (BACKLOG.md).
  - ``variation_note`` ships with the pair ALWAYS — the pair lives outside the scorecard, so it
    gets no CellRange / sign_stable / SIGN? machinery; at small event counts a rendered "7 vs 4"
    invites subtraction a different seed would plausibly reverse. Never conditional on the counts.
"""

from __future__ import annotations

from typing import Callable

from contract_models import Change

RADIUS_M = 25.0  # distance to ANY zone edge (never nearest-edge∈zone — boundary flapping)

VARIATION_NOTE = ("single-seed counts; at these small event counts the difference between the two "
                  "figures is within run-to-run variation and does not establish a direction")
SPAN_WINDOW_NOTE = "members carry differing windows; zone facts use the spanning window"
FULL_RUN_WINDOW_NOTE = "no member carries a window; zone facts cover the full simulated period"
_POPULATION_BY_PROFILE = {
    "calibrated_am_peak": "pedestrian entities from the TMC-anchored calibrated demand",
    "synthetic_demo": "pedestrian entities from the synthetic demo demand",
}


def method_note() -> str:
    return (f"ped-vehicle crossing conflicts within {RADIUS_M:g} m of a zone street during the "
            f"window; surrogate near-miss measures, not crash prediction")


def population_note(demand_profile: str) -> str:
    pop = _POPULATION_BY_PROFILE.get(demand_profile, _POPULATION_BY_PROFILE["synthetic_demo"])
    return (f"{pop} during the window — not modeled schoolchildren; "
            f"student travel demand is deferred (see BACKLOG.md)")


def resolve_window(changes: list[Change]) -> tuple[dict | None, str | None]:
    """Shared window → use it; differing → the SPANNING window + a note; none windowed → full run
    + a note. A soft fallback by design — NEVER an assert (this runs at the END of a multi-hour
    quant pipeline; refusing to compute a lens must not throw the run away)."""
    windows = [c.window for c in changes if c.window is not None]
    if not windows:
        return None, FULL_RUN_WINDOW_NOTE
    pairs = {(w.start_s, w.end_s) for w in windows}
    if len(pairs) == 1:
        w = windows[0]
        return {"start_s": w.start_s, "end_s": w.end_s}, None
    return ({"start_s": min(w.start_s for w in windows),
             "end_s": max(w.end_s for w in windows)}, SPAN_WINDOW_NOTE)


def _in_window(t: float, window: dict | None) -> bool:
    if window is None:  # full-run fallback
        return True
    return window["start_s"] <= t <= window["end_s"]  # inclusive on both bounds


def count_zone_conflicts(conflicts: list[dict], window: dict | None,
                         dist_to_zone: Callable[[float, float], float]) -> int:
    """The count rule: crossing-type AND a ped entity AND inside the window (inclusive) AND within
    RADIUS_M of any zone edge. Identical for baseline and scenario lists."""
    n = 0
    for c in conflicts:
        if c.get("type") != "crossing":
            continue
        if not any(str(e).startswith("ped") for e in c.get("entities") or []):
            continue
        if not _in_window(c["t"], window):
            continue
        if dist_to_zone(c["lon"], c["lat"]) <= RADIUS_M:
            n += 1
    return n


def compute_zone_facts(conf_base: list[dict], conf_scen: list[dict], changes: list[Change],
                       tags: list[str] | None, *, dist_to_zone: Callable[[float, float], float],
                       demand_profile: str) -> dict | None:
    """The zone_facts sidecar block, or None when the run carries no school_zone tag."""
    if not tags or "school_zone" not in tags:
        return None
    window, window_note = resolve_window(changes)
    facts: dict = {
        "tag": "school_zone",
        "zone_edges": [c.target_edge for c in changes],
        "n_edges": len(changes),
        "window": window,
        **({"window_note": window_note} if window_note else {}),
        "ped_vehicle_conflicts": {
            "baseline": count_zone_conflicts(conf_base, window, dist_to_zone),
            "scenario": count_zone_conflicts(conf_scen, window, dist_to_zone),
        },
        "method_note": method_note(),
        "variation_note": VARIATION_NOTE,  # ALWAYS — never conditional on the counts
        "population_note": population_note(demand_profile),
    }
    return facts


def _dist_point_to_polyline(px: float, py: float, shape: list) -> float:
    """Min distance (m) from (px,py) to a polyline of (x,y) points (scenario_harness's helper,
    duplicated so this module stays import-pure — zone_lens must not import the harness)."""
    best = float("inf")
    for (ax, ay), (bx, by) in zip(shape, shape[1:]):
        dx, dy = bx - ax, by - ay
        seg2 = dx * dx + dy * dy
        u = 0.0 if seg2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / seg2))
        cx, cy = ax + u * dx, ay + u * dy
        best = min(best, ((px - cx) ** 2 + (py - cy) ** 2) ** 0.5)
    return best


def net_dist_fn(net, zone_edge_ids: list[str]) -> Callable[[float, float], float]:
    """The production distance function: lon/lat → net XY → min distance over the zone edges'
    shapes. Deterministic, no spatial index needed (conflicts × edges is small)."""
    shapes = [net.getEdge(e).getShape() for e in zone_edge_ids]

    def dist(lon: float, lat: float) -> float:
        x, y = net.convertLonLat2XY(lon, lat)
        return min((_dist_point_to_polyline(x, y, s) for s in shapes), default=float("inf"))

    return dist
