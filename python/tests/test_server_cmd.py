"""Phase 5.3 — unit coverage for the server's harness-cmd construction (the reverse-edge-id argparse bug's only
prior coverage was the manual 5.2c smoke). SUMO edge ids can start with '-' (reverse edges); the cmd MUST use the
``--target-edge=<id>`` (=form) so argparse doesn't read the value as an option. server.py drags heavy deps
(FastAPI + report_agent's lightrag/torch + SUMO) — gate the import so this skips where they're unavailable."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "python" / "src"))

try:  # heavy: the whole server module (agent stack + SUMO). Skip cleanly if the env lacks them.
    import server  # noqa: E402
except Exception:  # pragma: no cover
    pytest.skip("server deps unavailable (SUMO / lightrag / torch)", allow_module_level=True)


def test_reverse_edge_id_uses_equals_form() -> None:
    ch = server.SimChange(type="speed_limit", target_edge="-1262503063#1", value_mps=8.0)
    cmd = server._build_harness_cmd(ch, "TS", "desc")
    # a single =form token — argparse can't mistake the leading '-' for an option (the 5.2c bug)
    assert "--target-edge=-1262503063#1" in cmd
    assert "--target-edge" not in cmd, "must NOT use the space-separated form for edge ids that can start with '-'"
    assert cmd[cmd.index("--change-type") + 1] == "speed_limit"
    assert cmd[cmd.index("--run-ts") + 1] == "TS"


def test_bike_lane_and_new_road_cmds() -> None:
    bl = server.SimChange(type="bike_lane", target_edge="-9#0", target_lane=1)
    c = server._build_harness_cmd(bl, "TS", "d")
    assert "--target-edge=-9#0" in c and "--target-lane" in c and c[c.index("--target-lane") + 1] == "1"

    nr = server.SimChange(type="new_road", from_junction="A", to_junction="B", lanes=2, speed_mps=13.9,
                          bidirectional=True)
    c2 = server._build_harness_cmd(nr, "TS", "d")
    assert "--from-junction" in c2 and "--to-junction" in c2 and "--bidirectional" in c2
    assert c2[c2.index("--from-junction") + 1] == "A"


def test_unsupported_type_raises() -> None:
    with pytest.raises(ValueError, match="unsupported change type"):
        server._build_harness_cmd(server.SimChange(type="new_signal", target_edge="e"), "TS", "d")


def test_demand_profile_flag() -> None:
    """V2.1b: --demand-profile appended ONLY for non-default profiles — the default cmd stays byte-stable."""
    ch = server.SimChange(type="speed_limit", target_edge="e1", value_mps=8.0)
    default_cmd = server._build_harness_cmd(ch, "TS", "d")
    assert "--demand-profile" not in default_cmd, "synthetic default must not change the cmd"
    cal_cmd = server._build_harness_cmd(ch, "TS", "d", demand_profile="calibrated_am_peak")
    assert cal_cmd[cal_cmd.index("--demand-profile") + 1] == "calibrated_am_peak"


def test_simulate_req_defaults_synthetic() -> None:
    req = server.SimulateReq(change=server.SimChange(type="speed_limit", target_edge="e", value_mps=8.0))
    assert req.demand_profile == "synthetic_demo"
    assert req.assignment == "day_one"
    assert req.n_seeds == 1


def test_assignment_flag() -> None:
    """V2.1c: --assignment appended ONLY for settled — the default cmd stays byte-stable."""
    ch = server.SimChange(type="speed_limit", target_edge="e1", value_mps=8.0)
    default_cmd = server._build_harness_cmd(ch, "TS", "d")
    assert "--assignment" not in default_cmd
    settled_cmd = server._build_harness_cmd(ch, "TS", "d", assignment="settled")
    assert settled_cmd[settled_cmd.index("--assignment") + 1] == "settled"
    both = server._build_harness_cmd(ch, "TS", "d", demand_profile="calibrated_am_peak", assignment="settled")
    assert "--demand-profile" in both and "--assignment" in both


# ---------------------------------------------------------------- V2.2a: closures + windows


def test_lane_closure_cmd_with_window() -> None:
    ch = server.SimChange(type="lane_closure", target_edge="-9#0", target_lanes=[0, 1],
                          window=server.WindowReq(start_s=600.0, end_s=2400.0))
    c = server._build_harness_cmd(ch, "TS", "d")
    assert "--target-edge=-9#0" in c
    assert c[c.index("--change-type") + 1] == "lane_closure"
    assert c[c.index("--target-lanes") + 1] == "0,1"
    assert c[c.index("--window-start") + 1] == "600.0"
    assert c[c.index("--window-end") + 1] == "2400.0"


def test_road_closure_cmd_unwindowed_has_no_lane_or_window_flags() -> None:
    ch = server.SimChange(type="road_closure", target_edge="-9#0")
    c = server._build_harness_cmd(ch, "TS", "d")
    assert c[c.index("--change-type") + 1] == "road_closure"
    assert "--target-edge=-9#0" in c
    assert "--target-lanes" not in c and "--window-start" not in c and "--window-end" not in c


def test_speed_limit_window_flags_appended_only_when_windowed() -> None:
    ch = server.SimChange(type="speed_limit", target_edge="e1", value_mps=8.0)
    assert "--window-start" not in server._build_harness_cmd(ch, "TS", "d")  # byte-stable default
    chw = server.SimChange(type="speed_limit", target_edge="e1", value_mps=8.0,
                           window=server.WindowReq(start_s=0.0, end_s=1800.0))
    c = server._build_harness_cmd(chw, "TS", "d")
    assert c[c.index("--window-start") + 1] == "0.0" and c[c.index("--window-end") + 1] == "1800.0"


def _post_simulate(change_kw: dict, **req_kw):
    """Drive the async simulate() handler directly; rejections raise HTTPException BEFORE any
    job/lock side effect, so this is a pure validation probe."""
    import asyncio

    from fastapi import BackgroundTasks, HTTPException  # noqa: F401

    req = server.SimulateReq(change=server.SimChange(**change_kw), **req_kw)
    return asyncio.run(server.simulate(req, BackgroundTasks()))


def _real_edge_with_2_car_lanes() -> tuple[str, list[int]]:
    for e in server._edges_by_id().values():
        if len(e["car_lane_indices"]) >= 2:
            return e["id"], e["car_lane_indices"]
    raise AssertionError("no >=2-car-lane edge in the network?")


def test_post_windowed_settled_rejected_with_exact_reason() -> None:
    from fastapi import HTTPException

    import change_scheduler as cs
    edge, lanes = _real_edge_with_2_car_lanes()
    with pytest.raises(HTTPException) as ei:
        _post_simulate({"type": "lane_closure", "target_edge": edge, "target_lanes": lanes[:1],
                        "window": {"start_s": 600.0, "end_s": 2400.0}}, assignment="settled")
    assert ei.value.status_code == 400 and ei.value.detail == cs.REASON_WINDOWED_SETTLED


def test_post_settled_road_closure_rejected_with_exact_reason() -> None:
    from fastapi import HTTPException

    import change_scheduler as cs
    edge, _ = _real_edge_with_2_car_lanes()
    with pytest.raises(HTTPException) as ei:
        _post_simulate({"type": "road_closure", "target_edge": edge}, assignment="settled")
    assert ei.value.status_code == 400 and ei.value.detail == cs.REASON_SETTLED_SEVERED
    # lane_closure closing ALL car lanes is the same severing case
    edge2, lanes2 = _real_edge_with_2_car_lanes()
    with pytest.raises(HTTPException) as ei2:
        _post_simulate({"type": "lane_closure", "target_edge": edge2, "target_lanes": lanes2},
                       assignment="settled")
    assert ei2.value.status_code == 400 and ei2.value.detail == cs.REASON_SETTLED_SEVERED


def test_post_lane_closure_bad_lanes_rejected() -> None:
    from fastapi import HTTPException

    edge, lanes = _real_edge_with_2_car_lanes()
    bogus = max(lanes) + 7
    with pytest.raises(HTTPException) as ei:
        _post_simulate({"type": "lane_closure", "target_edge": edge, "target_lanes": [bogus]})
    assert ei.value.status_code == 400 and "not car lanes" in ei.value.detail


def test_post_window_end_le_start_rejected() -> None:
    from fastapi import HTTPException

    edge, lanes = _real_edge_with_2_car_lanes()
    with pytest.raises(HTTPException) as ei:
        _post_simulate({"type": "lane_closure", "target_edge": edge, "target_lanes": lanes[:1],
                        "window": {"start_s": 2400.0, "end_s": 600.0}})
    assert ei.value.status_code == 400 and "end_s" in ei.value.detail


def test_n_seeds_flag() -> None:
    """V2.1d: --n-seeds appended ONLY when != 1 — the default cmd stays byte-stable."""
    ch = server.SimChange(type="speed_limit", target_edge="e1", value_mps=8.0)
    default_cmd = server._build_harness_cmd(ch, "TS", "d")
    assert "--n-seeds" not in default_cmd
    seeded_cmd = server._build_harness_cmd(ch, "TS", "d", n_seeds=3)
    assert seeded_cmd[seeded_cmd.index("--n-seeds") + 1] == "3"
    all_three = server._build_harness_cmd(ch, "TS", "d", demand_profile="calibrated_am_peak",
                                          assignment="settled", n_seeds=3)
    assert "--demand-profile" in all_three and "--assignment" in all_three and "--n-seeds" in all_three
