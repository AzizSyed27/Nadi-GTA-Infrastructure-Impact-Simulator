"""Phase 0 backend spine: run the SUMO scenario headless and freeze a trajectory artifact.

Runs ``python/scenario/corridor.sumocfg`` to completion, recording every active vehicle's
GEOGRAPHIC position (lon/lat), speed, and type each step, then writes a versioned artifact to
``contract/runs/<run_id>.json`` (validated against the frozen schema).

CRITICAL: positions are converted from SUMO internal (x,y) to (lon,lat) via
``simulation.convertGeo`` before recording. Skipping that renders the dots in the ocean.

Phase 1 reuse: the run loop is factored into ``simulate()`` / ``apply_change()`` /
``build_artifact()`` so the two-run scenario harness (``scenario_harness.py``) can drive the SAME
extractor with a change applied and a tripinfo file emitted. ``run()`` (this module's entrypoint)
is unchanged in behaviour — it still produces a byte-identical ``corridor-<UTC>.json``.

Run as a script:  ``python python/src/run_sim.py``
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# --- paths: resolve everything from the repo root, never from cwd ---
ROOT = Path(__file__).resolve().parents[2]  # python/src/run_sim.py -> python/src -> python -> <root>
SUMO_HOME = Path(os.environ.get("SUMO_HOME", r"C:\Program Files (x86)\Eclipse\Sumo"))
CFG = ROOT / "python" / "scenario" / "corridor.sumocfg"
NET = ROOT / "python" / "scenario" / "corridor.net.xml"
SUMO_BINARY = SUMO_HOME / "bin" / "sumo.exe"

# Make the bundled SUMO python tools importable (traci, sumolib) without a pip install.
sys.path.insert(0, str(SUMO_HOME / "tools"))
# Sibling imports: this file runs as a script, so sys.path[0] is python/src/.
import trajectory_io  # noqa: E402
from contract_models import Assignment, Change, Meta, Scenario, TrajectoryArtifact, Vehicle  # noqa: E402

# libsumo-first, TraCI fallback. Both expose the identical .start/.simulationStep/.vehicle/.simulation/.close API.
# NOTE: the two-run harness calls start()/close() twice in one process. That is safe on TraCI (a fresh
# sumo subprocess per start) but UNRELIABLE on libsumo (global C++ state) — if a libsumo wheel is ever
# installed, run the baseline and scenario in separate processes.
try:
    import libsumo as conn  # noqa: E402

    BINDING = "libsumo"
except ImportError:
    import traci as conn  # noqa: E402

    BINDING = "traci"

import sumolib  # noqa: E402  (from SUMO_HOME/tools)

MAX_T = 3600.0  # safety ceiling — demand departs to ~897s; all vehicles arrive well before this.


def net_bbox(net_path: Path) -> list[float]:
    """Geographic bounds of the network as [minLon, minLat, maxLon, maxLat] (WGS84)."""
    net = sumolib.net.readNet(str(net_path))
    xmin, ymin, xmax, ymax = net.getBoundary()
    lon0, lat0 = net.convertXY2LonLat(xmin, ymin)
    lon1, lat1 = net.convertXY2LonLat(xmax, ymax)
    return [min(lon0, lon1), min(lat0, lat1), max(lon0, lon1), max(lat0, lat1)]


def _car_lane_indices(edge_id: str) -> list[int]:
    """Indices of lanes on ``edge_id`` that permit passenger cars, via the live ``conn`` permissions.

    A lane permits cars when ``passenger`` is in its allowed set, OR the allowed set is empty (SUMO's
    "all classes allowed") and ``passenger`` is not explicitly disallowed. Sidewalks (pedestrian-only)
    and any bike-only lanes are excluded.
    """
    out: list[int] = []
    for i in range(conn.edge.getLaneNumber(edge_id)):
        lane = f"{edge_id}_{i}"
        allowed = set(conn.lane.getAllowed(lane))
        disallowed = set(conn.lane.getDisallowed(lane))
        if "passenger" in allowed or (not allowed and "passenger" not in disallowed):
            out.append(i)
    return out


MIN_CAR_LANES_FOR_BIKE = 2  # a bike-lane conversion needs >= this many car lanes so >= 1 remains for cars


def bike_lane_reason(car_lane_indices: list[int], edge_id: str) -> str | None:
    """The SINGLE source of the bike-lane eligibility RULE. Returns None if the edge is eligible
    (>= ``MIN_CAR_LANES_FOR_BIKE`` car lanes), else the human reason it is not. BOTH the live enforcer
    (``apply_change``) and the static pre-check (``network_edit.edge_bike_eligibility`` — used by
    ``/api/edges`` + ``/api/simulate``) call this, so the rule and its wording can never diverge."""
    if len(car_lane_indices) < MIN_CAR_LANES_FOR_BIKE:
        return (
            f"bike_lane needs >= {MIN_CAR_LANES_FOR_BIKE} car lanes on edge {edge_id!r} so >= 1 remains for "
            f"cars; found {len(car_lane_indices)} ({car_lane_indices}). Refusing to block the edge."
        )
    return None


def apply_change(change: Change, target_lane: int | None = None) -> None:
    """Apply an infrastructure change to the live ``conn`` simulation. Open dispatch by ``type``.

    ``speed_limit`` (Phase 1) and ``bike_lane`` (Phase 2) are implemented; other types raise
    NotImplementedError so adding them later is a localized change, never a silent no-op. ``target_lane``
    is only consumed by lane-scoped changes (``bike_lane``); it is ignored by ``speed_limit`` so existing
    callers (``simulate``/``run``) are unaffected.
    """
    if change.type == "speed_limit":
        if change.value_mps is None:
            raise ValueError("speed_limit change requires value_mps (the new max speed in m/s)")
        if change.target_edge not in conn.edge.getIDList():
            raise ValueError(
                f"target_edge {change.target_edge!r} is not in the network — refusing to no-op silently"
            )
        lane0 = f"{change.target_edge}_0"
        before = conn.lane.getMaxSpeed(lane0)
        conn.edge.setMaxSpeed(change.target_edge, change.value_mps)  # sets ALL lanes of the edge (m/s)
        after = conn.lane.getMaxSpeed(lane0)
        print(
            f"[change] speed_limit on edge {change.target_edge!r}: "
            f"{before:.2f} -> {after:.2f} m/s ({before * 3.6:.1f} -> {after * 3.6:.1f} km/h)"
        )
    elif change.type == "bike_lane":
        # Convert one curbside CAR lane to bicycle-only. NEVER touch the sidewalk (pedestrian) lane, and
        # NEVER convert the last car lane (would block cars on the edge). target_lane defaults to the
        # curbside car lane (lowest car-lane index, just inside the sidewalk).
        if change.target_edge not in conn.edge.getIDList():
            raise ValueError(
                f"target_edge {change.target_edge!r} is not in the network — refusing to no-op silently"
            )
        car_lanes = _car_lane_indices(change.target_edge)
        reason = bike_lane_reason(car_lanes, change.target_edge)  # single-source rule (shared w/ the static check)
        if reason is not None:
            raise ValueError(reason)
        idx = car_lanes[0] if target_lane is None else target_lane
        if idx not in car_lanes:
            raise ValueError(
                f"target_lane {idx} is not a car lane on edge {change.target_edge!r} (car lanes: {car_lanes})"
            )
        if [i for i in car_lanes if i != idx] == []:
            raise ValueError(f"converting lane {idx} would leave 0 car lanes on {change.target_edge!r}")
        lane = f"{change.target_edge}_{idx}"
        before_a, before_d = conn.lane.getAllowed(lane), conn.lane.getDisallowed(lane)
        # bicycle-only, explicitly: setAllowed(lane, []) would CLOSE the lane (an empty class list
        # parses to permissions 0 in SUMO 1.27 — probed 2026-07-21), it does NOT mean "all".
        conn.lane.setAllowed(lane, ["bicycle"])
        after_a = conn.lane.getAllowed(lane)
        remaining = [i for i in car_lanes if i != idx]
        print(
            f"[change] bike_lane on edge {change.target_edge!r} lane {idx} (id {lane!r}): "
            f"allowed {tuple(before_a) or '(all)'} / disallowed {tuple(before_d) or '()'} "
            f"-> allowed {tuple(after_a)}; car lanes {car_lanes} -> remaining for cars {remaining}"
        )
    elif change.type in ("lane_closure", "road_closure"):
        # V2.2a: UNWINDOWED closures — apply once, in force for the whole run. Windowed closures
        # go through change_scheduler.ChangeScheduler instead (apply at start_s, revert at end_s);
        # both paths share the same primitives so the closure semantics can never diverge.
        import change_scheduler

        if change.target_edge not in conn.edge.getIDList():
            raise ValueError(
                f"target_edge {change.target_edge!r} is not in the network — refusing to no-op silently"
            )
        if change.type == "lane_closure":
            # Valid targets = car lanes OR already-fully-closed lanes: on a SETTLED leg the micro
            # run uses the runtime-PATCHED net (targets already closed), and this TraCI re-apply
            # must stay idempotent — while a sidewalk still refuses.
            car_lanes = _car_lane_indices(change.target_edge)
            closed = change_scheduler.closed_lane_indices(conn, change.target_edge)
            valid = sorted(set(car_lanes) | set(closed))
            reason = change_scheduler.validate_target_lanes(change.target_lanes, valid, change.target_edge)
            if reason is not None:
                raise ValueError(reason)
            lanes = list(change.target_lanes)
        else:
            lanes = list(range(conn.edge.getLaneNumber(change.target_edge)))
        before = change_scheduler.capture_lanes(conn, change.target_edge, lanes)
        change_scheduler.apply_closure(conn, change.target_edge, lanes)
        change_scheduler.assert_closed(conn, change.target_edge, lanes)
        closed = [s.lane_id for s in before]
        print(
            f"[change] {change.type} on edge {change.target_edge!r}: closed lanes {closed} "
            f"(setDisallowed 'all'; permanent for this run)"
        )
    else:
        raise NotImplementedError(f"change type {change.type!r} is not implemented yet")


def _read_tail(path: str | Path, n: int = 1500) -> str:
    """Tail of a SUMO --error-log, for attaching the real reason to a 'Connection closed by SUMO' failure."""
    try:
        txt = Path(path).read_text(encoding="utf-8", errors="replace").strip()
        return txt[-n:] if txt else "(error-log empty)"
    except Exception:  # noqa: BLE001
        return "(no error-log written)"


def simulate(
    change: Change | None = None,
    tripinfo_path: str | Path | None = None,
    net_override: str | Path | None = None,
) -> tuple[dict[str, dict], float, float]:
    """Run ``corridor.sumocfg`` headless and record per-vehicle lon/lat trajectories.

    If ``change`` is given it is applied once at sim start (in force from t=0). If ``tripinfo_path``
    is given, SUMO writes per-vehicle trip summaries there (finalized on close).

    Returns ``(records, sim_end, step_length)`` where ``records`` maps vehicle id -> dict with
    ``type``/``path``/``timestamps``/``speeds`` (path points are [lon, lat]).
    """
    if not CFG.is_file():
        raise FileNotFoundError(f"sumocfg not found: {CFG}")
    if not SUMO_BINARY.is_file():
        raise FileNotFoundError(f"sumo binary not found: {SUMO_BINARY} (set SUMO_HOME)")

    # Override the cfg's end=1000 so vehicles departing near 897s actually finish.
    args = [str(SUMO_BINARY), "-c", str(CFG), "--end", str(MAX_T)]
    if net_override is not None:  # 5.1: scenario runs on a per-run patched net (new_road); --net-file wins over cfg
        args += ["--net-file", str(net_override)]
    if tripinfo_path is not None:
        args += ["--tripinfo-output", str(tripinfo_path)]
    # Capture SUMO's own warnings+errors — else a rejected net surfaces only as an opaque "Connection closed".
    err_log = Path(f"{tripinfo_path}.sumoerr.log") if tripinfo_path else CFG.parent / "sumo.sumoerr.log"
    args += ["--error-log", str(err_log)]
    try:
        conn.start(args)
    except Exception as e:  # noqa: BLE001 — surface SUMO's real reason (e.g. a net-load rejection), not just "closed"
        raise RuntimeError(f"SUMO failed to start: {e} — SUMO error-log: {_read_tail(err_log)}") from e

    if change is not None:
        apply_change(change)  # after start, before stepping -> in effect from the first step

    step_length = conn.simulation.getDeltaT()

    records: dict[str, dict] = {}
    prev_t = -1.0
    try:
        while conn.simulation.getMinExpectedNumber() > 0:
            conn.simulationStep()
            t = conn.simulation.getTime()
            if t <= prev_t or t >= MAX_T:  # anti-hang: time stopped advancing or hit the ceiling
                break
            prev_t = t
            for vid in conn.vehicle.getIDList():
                x, y = conn.vehicle.getPosition(vid)
                lon, lat = conn.simulation.convertGeo(x, y)  # (lon, lat) — the conversion that matters
                rec = records.get(vid)
                if rec is None:
                    rec = records[vid] = {
                        "type": conn.vehicle.getTypeID(vid),
                        "path": [],
                        "timestamps": [],
                        "speeds": [],
                    }
                rec["path"].append([lon, lat])
                rec["timestamps"].append(round(t, 3))
                rec["speeds"].append(round(conn.vehicle.getSpeed(vid), 3))
        sim_end = conn.simulation.getTime()
    except Exception as e:  # noqa: BLE001 — a mid-run SUMO crash: attach its error-log so the reason isn't lost
        raise RuntimeError(f"SUMO run failed mid-sim: {e} — SUMO error-log: {_read_tail(err_log)}") from e
    finally:
        conn.close()  # ends the sim process; finalizes the tripinfo file

    if not records:
        raise RuntimeError("No vehicles were recorded — demand/config problem?")
    return records, sim_end, step_length


def build_artifact(
    records: dict[str, dict],
    sim_end: float,
    step_length: float,
    *,
    run_id: str,
    network: str,
    bbox: list[float],
    scenario: Scenario | None = None,
) -> TrajectoryArtifact:
    """Assemble + geo-check a TrajectoryArtifact from recorded trajectories. ``agents`` stays empty."""
    min_lon, min_lat, max_lon, max_lat = bbox

    # --- sample-coordinate-in-bbox sanity check (the ocean guard) ---
    first_id = next(iter(records))
    s_lon, s_lat = records[first_id]["path"][0]
    inside = (min_lon <= s_lon <= max_lon) and (min_lat <= s_lat <= max_lat)
    print(f"[geo-check] bbox = {bbox}")
    print(f"[geo-check] sample vehicle {first_id!r} first point -> lon {s_lon:.5f}, lat {s_lat:.5f}")
    print(f"[geo-check] INSIDE BBOX: {'yes' if inside else 'NO'}")
    if not inside:
        raise RuntimeError(
            f"Sample coordinate ({s_lon},{s_lat}) is OUTSIDE the corridor bbox {bbox}. "
            "Geo-conversion likely failed — refusing to write the artifact."
        )

    return TrajectoryArtifact(
        meta=Meta(
            run_id=run_id,
            network=network,
            bbox=bbox,
            sim_start=0.0,
            sim_end=sim_end,
            step_length=step_length,
            created_at=datetime.now(timezone.utc).isoformat(),
            demand_profile="synthetic_demo",  # v0.6.0: required — this entrypoint runs the demo demand
            assignment=Assignment(mode="day_one"),  # v0.7.0: required — this entrypoint never settles
            scenario=scenario,
        ),
        vehicles=[
            # V2.6c/D6a: speeds are recorded in memory but DROPPED from the wire (0.10.0)
            Vehicle(id=vid, type=r["type"], path=r["path"], timestamps=r["timestamps"])
            for vid, r in records.items()
        ],
    )


def run() -> Path:
    """Phase-0 entrypoint: a single baseline run -> ``contract/runs/corridor-<UTC>.json``."""
    bbox = net_bbox(NET)
    records, sim_end, step_length = simulate()
    run_id = "corridor-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    artifact = build_artifact(
        records, sim_end, step_length, run_id=run_id, network=NET.name, bbox=bbox
    )

    out_path = trajectory_io.dump_artifact(artifact)  # validates vs schema before writing
    print(f"[run] binding         : {BINDING}")
    print(f"[run] vehicles        : {len(artifact.vehicles)}")
    print(f"[run] sim window      : start={artifact.meta.sim_start}  end={sim_end}  step={step_length}")
    print(f"[run] artifact written: {out_path}")
    return out_path


if __name__ == "__main__":
    run()
