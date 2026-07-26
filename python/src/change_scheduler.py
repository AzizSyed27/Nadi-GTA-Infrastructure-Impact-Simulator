"""V2.2a — the runtime change SCHEDULER: windowed changes apply at ``window.start_s`` and REVERT at
``window.end_s`` inside the harness step loop, restoring the EXACT captured prior state.

Composite semantics (documented + tested in ``test_change_scheduler.py``):
  - applies fire in ``changes[]`` order, reverts in REVERSE order (LIFO), and at an equal timestamp
    reverts fire BEFORE applies — so same-edge windows compose when they are DISJOINT (including
    boundary-touching: a closure phase ending exactly as another begins) or properly NESTED (the
    container applies first). Each apply captures the state it found (possibly another change's
    intermediate), and LIFO revert unwinds back through those captures. Any other shape (crossing
    windows, a container applying after its contained change) cannot be restored correctly and is
    rejected at build time via a per-edge LIFO well-formedness check on the RAW (unclipped) windows.

SUMO 1.27 permission facts this module is built on (probed against the live binary, 2026-07-21;
see test_change_scheduler.py's FakeConn header):
  - permissions are ONE bitmask; getAllowed/getDisallowed are two views of it.
  - ``setDisallowed(lane, ["all"])`` closes a lane; getDisallowed then returns the EXPANDED
    33-class list ("passenger" in it), while getAllowed returns ``()`` — the same shape a
    fully-open (SVCAll) lane gives in 1.27, so closure checks MUST read getDisallowed.
  - ``setDisallowed(lane, captured_disallowed)`` round-trips the exact bitmask; a fully-open
    lane captures ``()`` and ``setDisallowed(lane, [])`` correctly reopens it. ``setAllowed`` is
    NEVER called here: ``setAllowed(lane, [])`` parses to permissions 0 (CLOSED), so replaying a
    captured getAllowed through it would silently close an open lane. (Quirk removed on SUMO
    main — revisit if SUMO is ever bumped past 1.27.)
  - ``edge.setMaxSpeed`` hits ALL lanes; per-lane fidelity needs lane.getMaxSpeed/setMaxSpeed.

Module-level imports stay light (contract_models only) so ``server.py`` can import the reason
strings and pure validators without dragging SUMO in.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass

from contract_models import Change

# Shared verbatim by POST /api/simulate (HTTP 400) and the harness CLI (SystemExit) — single source.
REASON_WINDOWED_SETTLED = "temporary events have no equilibrium; use day-one response"
REASON_SETTLED_SEVERED = (
    "closures can strand trips that start or end on the closed road; equilibrium assignment "
    "cannot honestly settle a severed network — use day-one response"
)
# V2.2d composites — same single-source convention. Members are speed_limit-only this step
# (bike_lane is structurally non-composable: no per-member target_lane on the wire), and the
# settled runtime path expresses a change TWICE (netconvert patch + TraCI) for exactly one change.
REASON_COMPOSITE_MEMBER = "composite scenarios support speed_limit members only in this step"
REASON_COMPOSITE_SETTLED = ("composite scenarios preview the day-one response only in this step; "
                            "settled assignment supports a single change")

# Types the scheduler can apply AND revert. bike_lane stays unwindowed-only (a temporary lane
# conversion has no ratified semantics). incident (V2.2b) = a CAPACITY event, never a crash
# simulation: effect.blocked closes target_lanes for the window; effect.speed_factor scales
# every lane's speed; both combinable. position_m is accepted + stored on the artifact but
# UNUSED this rung (rung-2 refinement: along-edge placement).
WINDOWABLE_TYPES = ("speed_limit", "lane_closure", "road_closure", "incident")


def validate_target_lanes(target_lanes: list[int] | None, car_lane_indices: list[int],
                          edge_id: str, kind: str = "lane_closure") -> str | None:
    """None if valid, else the human reason (the ``bike_lane_reason`` single-source pattern).

    Rules: non-empty, no duplicates, and a SUBSET of the edge's CAR-lane indices — closing a
    sidewalk or bike-only lane is nonsense (road_closure closes ALL lanes). ``kind`` only names
    the change in the wording (default keeps the V2.2a lane_closure strings byte-identical).
    """
    if not target_lanes:
        return f"{kind} requires non-empty target_lanes on edge {edge_id!r}"
    if len(set(target_lanes)) != len(target_lanes):
        return f"target_lanes has duplicate lane indices {target_lanes} on edge {edge_id!r}"
    bad = [i for i in target_lanes if i not in car_lane_indices]
    if bad:
        return (
            f"target_lanes {bad} are not car lanes on edge {edge_id!r} (car lanes: "
            f"{car_lane_indices}) — {kind} only closes car lanes; use road_closure to close the road"
        )
    return None


def incident_rejection_reason(effect_blocked: bool | None, speed_factor: float | None,
                              target_lanes: list[int] | None, car_lane_indices: list[int],
                              edge_id: str) -> str | None:
    """None if valid, else the human reason — shared verbatim by POST (400) and the harness
    (SystemExit). Plain args so server.py can call it on request DTOs without contract imports."""
    if not effect_blocked and speed_factor is None:
        return "incident requires an effect: blocked and/or speed_factor"
    if speed_factor is not None and speed_factor <= 0:
        return "incident speed_factor must be > 0 (a full stop is effect.blocked, not a factor)"
    if speed_factor is not None and speed_factor > 1:
        return "incident speed_factor must be <= 1 (an incident cannot raise the speed)"
    if effect_blocked:
        if not target_lanes:
            return f"incident with effect.blocked requires non-empty target_lanes on edge {edge_id!r}"
        return validate_target_lanes(target_lanes, car_lane_indices, edge_id,
                                     kind="incident (effect.blocked)")
    if target_lanes:
        return "incident target_lanes given without effect.blocked — set blocked: true or drop target_lanes"
    return None


def invalidates_routes(change_type: str, effect_blocked: bool | None = None) -> bool:
    """Changes that make existing routes INVALID (hard permission removal) — drives
    --ignore-route-errors + the non_completions surfacing. A speed-only incident can never strand
    a traveler, so claiming non-completions for it would overreach."""
    if change_type in ("lane_closure", "road_closure"):
        return True
    return change_type == "incident" and bool(effect_blocked)


def capacity_event(change_type: str) -> bool:
    """Changes that reduce corridor capacity (closures + ALL incidents) — drives the
    emergency-response detour fact + the temporary-event surfaces. A slowed edge genuinely
    diverts a free-flow response route even without blocking it."""
    return change_type in ("lane_closure", "road_closure", "incident")


def any_invalidates_routes(changes: list[Change]) -> bool:
    """V2.2d composites: the route-invalidation gate folds over the member list — ONE stranding
    member makes the whole pair run --ignore-route-errors (symmetric, a no-op in baseline)."""
    return any(invalidates_routes(c.type, c.effect.blocked if c.effect else None) for c in changes)


def any_capacity_event(changes: list[Change]) -> bool:
    """V2.2d composites: the response-detour gate folds over the member list."""
    return any(capacity_event(c.type) for c in changes)


def incident_base_desc(target_lanes: list[int] | None, speed_factor: float | None,
                       edge_id: str) -> str:
    """The MECHANICAL incident description (no crash words, no asserted benefit) — shared
    verbatim by the server and harness defaults; callers append fmt_window."""
    parts = []
    if target_lanes:
        n = len(target_lanes)
        parts.append(f"Blocked {n} car lane{'s' if n != 1 else ''}")
    if speed_factor is not None:
        verb = "reduced" if parts else "Reduced"
        parts.append(f"{verb} speed to {speed_factor * 100:.0f}%")
    return f"{' and '.join(parts)} on edge {edge_id} (incident)"


def assignment_rejection_reason(assignment: str, change_type: str, windowed: bool,
                                closes_all_car_lanes: bool) -> str | None:
    """The D1 + severing matrix, shared verbatim by POST and the harness.

    settled + windowed (ANY type)                -> REASON_WINDOWED_SETTLED
    settled + road_closure                       -> REASON_SETTLED_SEVERED
    settled + lane_closure closing ALL car lanes -> REASON_SETTLED_SEVERED
    (duaIterate on a severed net is not honest: default halts the iteration loop on the first
    unroutable trip; --continue-on-unbuild silently drops those trips every iteration.)
    """
    if assignment != "settled":
        return None
    if windowed:
        return REASON_WINDOWED_SETTLED
    if change_type == "road_closure":
        return REASON_SETTLED_SEVERED
    if change_type == "lane_closure" and closes_all_car_lanes:
        return REASON_SETTLED_SEVERED
    return None


# ---------------------------------------------------------------------------------------------
# Capture / apply / revert primitives — the SINGLE source for both the apply-once path
# (run_sim.apply_change, unwindowed closures) and the windowed path (ChangeScheduler).
# ---------------------------------------------------------------------------------------------

@dataclass(frozen=True)
class LaneState:
    """Exact prior state of one lane. ``disallowed`` is the RESTORE vector (round-trips the
    bitmask); ``allowed`` is ASSERT-ONLY and never replayed (the 1.27 getAllowed quirk)."""

    lane_id: str
    allowed: tuple[str, ...]
    disallowed: tuple[str, ...]
    max_speed: float


def capture_lanes(conn, edge_id: str, lane_indices: list[int] | None = None) -> list[LaneState]:
    """Capture (allowed, disallowed, max_speed) per lane. None = all lanes of the edge."""
    idxs = list(range(conn.edge.getLaneNumber(edge_id))) if lane_indices is None else lane_indices
    out = []
    for i in idxs:
        lane = f"{edge_id}_{i}"
        out.append(LaneState(lane, tuple(conn.lane.getAllowed(lane)),
                             tuple(conn.lane.getDisallowed(lane)), conn.lane.getMaxSpeed(lane)))
    return out


def apply_closure(conn, edge_id: str, lane_indices: list[int]) -> None:
    """Close lanes: ``setDisallowed(lane, ["all"])`` — the canonical closure idiom (permissions
    bitmask -> 0). Idempotent, so the settled double-expression (patched net + TraCI) is safe."""
    for i in lane_indices:
        conn.lane.setDisallowed(f"{edge_id}_{i}", ["all"])


def apply_speed(conn, edge_id: str, value_mps: float) -> None:
    conn.edge.setMaxSpeed(edge_id, value_mps)  # sets ALL lanes of the edge


def apply_speed_factor(conn, captured: list[LaneState], factor: float) -> None:
    """Scale every lane's speed FROM the captured value (exact + idempotent under re-apply;
    preserves heterogeneous per-lane speeds — revert_lanes restores them per lane)."""
    for s in captured:
        conn.lane.setMaxSpeed(s.lane_id, s.max_speed * factor)


def revert_lanes(conn, captured: list[LaneState]) -> None:
    """Restore the exact captured state — via setDisallowed ONLY (never setAllowed; see module
    docstring) plus per-lane speed."""
    for s in captured:
        conn.lane.setDisallowed(s.lane_id, list(s.disallowed))
        conn.lane.setMaxSpeed(s.lane_id, s.max_speed)


def assert_restored(conn, captured: list[LaneState]) -> None:
    """restored == captured, per lane, or die loudly naming the lane (requirement 1)."""
    for s in captured:
        got = (tuple(conn.lane.getAllowed(s.lane_id)), tuple(conn.lane.getDisallowed(s.lane_id)),
               conn.lane.getMaxSpeed(s.lane_id))
        want = (s.allowed, s.disallowed, s.max_speed)
        assert got == want, (
            f"revert readback on lane {s.lane_id}: restored state {got} != captured {want}"
        )


def closed_lane_indices(conn, edge_id: str) -> list[int]:
    """Lanes that are FULLY closed (permissions 0): getAllowed() == () AND 'passenger' in
    getDisallowed (a sidewalk still allows pedestrians; a fully-open SVCAll lane reads () / ()).
    Needed for the settled double-expression: on a runtime-PATCHED net the target lanes are
    already closed, so the idempotent TraCI re-apply must count them as valid targets."""
    out = []
    for i in range(conn.edge.getLaneNumber(edge_id)):
        lane = f"{edge_id}_{i}"
        if not conn.lane.getAllowed(lane) and "passenger" in conn.lane.getDisallowed(lane):
            out.append(i)
    return out


def assert_closed(conn, edge_id: str, lane_indices: list[int]) -> None:
    """Closure readback: 'passenger' must be in getDisallowed for every closed lane.
    (NOT getAllowed()==() — in 1.27 that shape is ambiguous between fully-open and closed.)"""
    for i in lane_indices:
        lane = f"{edge_id}_{i}"
        dis = conn.lane.getDisallowed(lane)
        assert "passenger" in dis, (
            f"closure readback: lane {lane} still allows cars (getDisallowed={tuple(dis)!r})"
        )


# ---------------------------------------------------------------------------------------------
# The scheduler
# ---------------------------------------------------------------------------------------------

_PHASE_REVERT, _PHASE_APPLY = 0, 1  # revert sorts BEFORE apply at an equal timestamp


class ChangeScheduler:
    """Applies windowed changes at ``start_s`` and reverts them at ``end_s`` inside the step loop.

    Unwindowed changes are NOT scheduled — they land in ``self.unwindowed`` for the caller to run
    through today's apply-once path byte-identically (requirement 4). Windows clip to the sim
    bounds: ``start_s < 0`` applies at t=0; ``start_s >= max_t`` never applies; ``end_s >= max_t``
    never reverts (both logged + noted in the proof log, requirement 2). Event resolution is one
    sim step: an event fires on the first tick with ``t >= its time``.
    """

    def __init__(self, conn, changes: list[Change], *, max_t: float, log=print):
        self.conn = conn
        self.max_t = max_t
        self.log = log
        self._changes = list(changes)
        self.unwindowed = [c for c in self._changes if c.window is None]
        self._windowed = [(i, c) for i, c in enumerate(self._changes) if c.window is not None]
        self.captured: dict[int, list[LaneState]] = {}
        self._proof: dict[int, dict] = {}

        for i, c in self._windowed:
            if c.type not in WINDOWABLE_TYPES:
                raise ValueError(
                    f"windowed {c.type!r} is not supported (windowable types: {WINDOWABLE_TYPES})"
                )

        self._validate_lifo()

        events: list[tuple[float, int, int, int]] = []  # (time, phase, order, change_idx)
        for i, c in self._windowed:
            w = c.window
            self._proof[i] = {
                "change_idx": i, "type": c.type, "target_edge": c.target_edge,
                "window": {"start_s": w.start_s, "end_s": w.end_s},
                "applied_t": None, "reverted_t": None, "restored_ok": None, "note": None,
            }
            start = max(0.0, w.start_s)
            if start >= max_t:
                self._proof[i]["note"] = (
                    f"window starts at {w.start_s:g}s, at/after the sim ceiling {max_t:g}s — never applied"
                )
                self.log(f"[scheduler] change {i} ({c.type} on {c.target_edge}): {self._proof[i]['note']}")
                continue
            if w.end_s <= start:
                # end>start holds on the RAW window (pydantic), but clipping start to 0 can empty it
                # (e.g. a window entirely before t=0). Skip — a queued revert without its apply
                # would be an unmatched pop at start().
                self._proof[i]["note"] = (
                    f"window [{w.start_s:g}, {w.end_s:g}]s is empty after clipping to the sim bounds — never applied"
                )
                self.log(f"[scheduler] change {i} ({c.type} on {c.target_edge}): {self._proof[i]['note']}")
                continue
            events.append((start, _PHASE_APPLY, i, i))
            if w.end_s < max_t:
                events.append((w.end_s, _PHASE_REVERT, -i, i))
            else:
                self.log(
                    f"[scheduler] change {i} ({c.type} on {c.target_edge}): window end {w.end_s:g}s "
                    f"is at/after the sim ceiling {max_t:g}s — will never revert (permanent for this run)"
                )
        events.sort(key=lambda e: (e[0], e[1], e[2]))
        self._queue = deque(events)

    def _validate_lifo(self) -> None:
        """Per-edge LIFO well-formedness on the RAW (unclipped) windows: replay the event
        sequence with a stack; every revert must pop its own apply from the top. Rejects
        crossing windows AND a container applying after its contained change — clipping must
        not change a scenario's legality."""
        raw: list[tuple[float, int, int, int]] = []
        for i, c in self._windowed:
            raw.append((c.window.start_s, _PHASE_APPLY, i, i))
            raw.append((c.window.end_s, _PHASE_REVERT, -i, i))
        raw.sort(key=lambda e: (e[0], e[1], e[2]))
        stacks: dict[str, list[int]] = {}
        for _t, phase, _order, idx in raw:
            edge = self._changes[idx].target_edge
            st = stacks.setdefault(edge, [])
            if phase == _PHASE_APPLY:
                st.append(idx)
            elif not st or st[-1] != idx:
                raise ValueError(
                    f"windows on the same edge ({edge!r}) must be disjoint or nested — crossing "
                    f"windows cannot be reverted correctly (LIFO revert restores captured state)"
                )
            else:
                st.pop()

    def start(self) -> None:
        """Fire applies due at t<=0 (after conn.start, before the first step) — a window
        starting at 0 is in force from the first step, like the apply-once path."""
        self.tick(0.0)

    def tick(self, t: float) -> None:
        """Fire every event due at sim-time ``t``. Call once per step, right after the step's
        time is read."""
        while self._queue and self._queue[0][0] <= t:
            _time, phase, _order, idx = self._queue.popleft()
            change = self._changes[idx]
            if phase == _PHASE_APPLY:
                self._apply(idx, change, t)
            else:
                self._revert(idx, change, t)

    def _lane_indices(self, change: Change) -> list[int]:
        if change.type == "lane_closure":
            return list(change.target_lanes)
        return list(range(self.conn.edge.getLaneNumber(change.target_edge)))

    def _apply(self, idx: int, change: Change, t: float) -> None:
        edge = change.target_edge
        lanes = self._lane_indices(change)
        # Capture BEFORE apply, AT apply time — for a nested composite this is another change's
        # intermediate state, which LIFO revert unwinds back through correctly.
        self.captured[idx] = capture_lanes(self.conn, edge, lanes)
        if change.type == "speed_limit":
            apply_speed(self.conn, edge, change.value_mps)
            got = self.conn.lane.getMaxSpeed(f"{edge}_0")
            assert abs(got - change.value_mps) < 1e-6, (
                f"apply readback: speed {got} != intended {change.value_mps} on {edge}"
            )
        elif change.type == "incident":
            # A CAPACITY event: blocked -> close target_lanes; speed_factor -> scale every lane
            # from the captured speeds. One capture (all lanes), one LIFO slot; the shared revert
            # path restores permissions AND per-lane speeds. position_m: stored, UNUSED this rung.
            eff = change.effect
            if eff.blocked:
                blocked = list(change.target_lanes)
                apply_closure(self.conn, edge, blocked)
                assert_closed(self.conn, edge, blocked)
            if eff.speed_factor is not None:
                apply_speed_factor(self.conn, self.captured[idx], eff.speed_factor)
                for s in self.captured[idx]:  # readback EVERY lane (blocked lanes keep speeds too)
                    got = self.conn.lane.getMaxSpeed(s.lane_id)
                    want = s.max_speed * eff.speed_factor
                    assert abs(got - want) < 1e-6, (
                        f"apply readback: lane {s.lane_id} speed {got} != captured*factor {want}"
                    )
        else:
            apply_closure(self.conn, edge, lanes)
            assert_closed(self.conn, edge, lanes)
        self._proof[idx]["applied_t"] = t
        self.log(f"[scheduler] t={t:g}s APPLY change {idx}: {change.type} on {edge} lanes {lanes}")

    def _revert(self, idx: int, change: Change, t: float) -> None:
        captured = self.captured.pop(idx)
        revert_lanes(self.conn, captured)
        assert_restored(self.conn, captured)  # restored == captured, or die (requirement 1)
        self._proof[idx]["reverted_t"] = t
        self._proof[idx]["restored_ok"] = True
        self.log(
            f"[scheduler] t={t:g}s REVERT change {idx}: {change.type} on {change.target_edge} — "
            f"restored state verified == captured"
        )

    def finalize(self, sim_end: float) -> list[dict]:
        """No TraCI calls — annotate never-fired reverts and return the proof log (one entry per
        windowed change, in changes[] order) for the outcomes sidecar / report."""
        for i, c in self._windowed:
            p = self._proof[i]
            if p["applied_t"] is not None and p["reverted_t"] is None:
                if c.window.end_s >= self.max_t:
                    p["note"] = (
                        f"window end {c.window.end_s:g}s is at/after the sim ceiling "
                        f"{self.max_t:g}s — never reverted (permanent for this run)"
                    )
                else:
                    p["note"] = (
                        f"sim drained at {sim_end:g}s before the window end {c.window.end_s:g}s — never reverted"
                    )
                self.log(f"[scheduler] change {i}: {p['note']}")
        return [self._proof[i] for i, _ in self._windowed]
