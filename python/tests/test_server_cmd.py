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


# ---------------------------------------------------------------- V2.2b: incidents


def test_incident_cmd_full_flag_set() -> None:
    ch = server.SimChange(type="incident", target_edge="-9#0", target_lanes=[1, 2],
                          effect=server.EffectReq(blocked=True, speed_factor=0.5),
                          position_m=120.0,
                          window=server.WindowReq(start_s=600.0, end_s=1800.0))
    c = server._build_harness_cmd(ch, "TS", "d")
    assert c[c.index("--change-type") + 1] == "incident"
    assert "--target-edge=-9#0" in c
    assert c[c.index("--target-lanes") + 1] == "1,2"
    assert "--blocked" in c
    assert c[c.index("--speed-factor") + 1] == "0.5"
    assert c[c.index("--position-m") + 1] == "120.0"
    assert c[c.index("--window-start") + 1] == "600.0" and c[c.index("--window-end") + 1] == "1800.0"


def test_incident_cmd_speed_only_omits_absent_flags() -> None:
    ch = server.SimChange(type="incident", target_edge="e1",
                          effect=server.EffectReq(speed_factor=0.5),
                          window=server.WindowReq(start_s=0.0, end_s=1200.0))
    c = server._build_harness_cmd(ch, "TS", "d")
    assert "--blocked" not in c and "--target-lanes" not in c and "--position-m" not in c
    assert c[c.index("--speed-factor") + 1] == "0.5"
    assert "--window-start" in c  # incident windows must never be silently dropped


def test_post_incident_without_window_rejected() -> None:
    from fastapi import HTTPException

    edge, lanes = _real_edge_with_2_car_lanes()
    with pytest.raises(HTTPException) as ei:
        _post_simulate({"type": "incident", "target_edge": edge, "target_lanes": lanes[:1],
                        "effect": {"blocked": True}})
    assert ei.value.status_code == 400 and "incident requires a window" in ei.value.detail


def test_post_incident_effect_matrix() -> None:
    from fastapi import HTTPException

    edge, lanes = _real_edge_with_2_car_lanes()
    w = {"start_s": 600.0, "end_s": 1800.0}
    cases = [
        ({"type": "incident", "target_edge": edge, "window": w},
         "incident requires an effect: blocked and/or speed_factor"),
        ({"type": "incident", "target_edge": edge, "window": w, "effect": {"blocked": True}},
         "requires non-empty target_lanes"),
        ({"type": "incident", "target_edge": edge, "window": w, "target_lanes": lanes[:1],
          "effect": {"speed_factor": 0.5}},
         "without effect.blocked"),
        ({"type": "incident", "target_edge": edge, "window": w, "effect": {"speed_factor": 1.5}},
         "cannot raise the speed"),
        ({"type": "incident", "target_edge": edge, "window": w, "effect": {"speed_factor": 0.0}},
         "must be > 0"),
    ]
    for change_kw, needle in cases:
        with pytest.raises(HTTPException) as ei:
            _post_simulate(change_kw)
        assert ei.value.status_code == 400 and needle in ei.value.detail, (change_kw, ei.value.detail)


def test_post_settled_incident_rejected_as_windowed() -> None:
    from fastapi import HTTPException

    import change_scheduler as cs
    edge, lanes = _real_edge_with_2_car_lanes()
    with pytest.raises(HTTPException) as ei:
        _post_simulate({"type": "incident", "target_edge": edge, "target_lanes": lanes[:1],
                        "effect": {"blocked": True}, "window": {"start_s": 600.0, "end_s": 1800.0}},
                       assignment="settled")
    assert ei.value.status_code == 400 and ei.value.detail == cs.REASON_WINDOWED_SETTLED


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


# ---------------------------------------------------------------- V2.2d: the composite POST

def test_new_road_via_rejected_400() -> None:
    """V2.6c: via is CONTRACT CAPACITY only — the POST refuses it loudly BEFORE any junction
    resolution (an ignored via would emit an artifact whose change lies about the simulated
    geometry; netconvert threading is BACKLOG)."""
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as ei:
        _post_simulate({"type": "new_road", "target_edge": "nr_A_B", "from_junction": "A",
                        "to_junction": "B", "lanes": 1, "speed_mps": 13.9, "via": ["J_mid"]})
    assert ei.value.status_code == 400
    assert "via" in str(ei.value.detail)


def _post_composite(changes_kw: list[dict], tags=None, **req_kw):
    import asyncio

    from fastapi import BackgroundTasks

    req = server.SimulateReq(changes=[server.SimChange(**c) for c in changes_kw], tags=tags, **req_kw)
    bg = BackgroundTasks()
    return asyncio.run(server.simulate(req, bg)), bg


def _three_zone_members(window=True) -> list[dict]:
    edges = [e["id"] for e in server._edges_by_id().values() if e["car_lane_indices"]][:3]
    assert len(edges) == 3
    w = {"window": {"start_s": 600.0, "end_s": 1200.0}} if window else {}
    return [{"type": "speed_limit", "target_edge": e, "value_mps": 8.33, **w} for e in edges]


def test_post_change_xor_changes() -> None:
    import asyncio

    from fastapi import BackgroundTasks, HTTPException

    both = server.SimulateReq(change=server.SimChange(type="speed_limit", target_edge="e1", value_mps=8.0),
                              changes=[server.SimChange(type="speed_limit", target_edge="e1", value_mps=8.0)])
    with pytest.raises(HTTPException) as ei:
        asyncio.run(server.simulate(both, BackgroundTasks()))
    assert ei.value.status_code == 400 and "not both" in ei.value.detail
    neither = server.SimulateReq()
    with pytest.raises(HTTPException) as ei2:
        asyncio.run(server.simulate(neither, BackgroundTasks()))
    assert ei2.value.status_code == 400


def _mixed_members() -> list[dict]:
    """V2.4b: one member of each composable capacity shape + a road closure — REAL edges with >=2
    car lanes (the lane_closure member closes a strict subset). Windows deliberately DIFFER."""
    edges = [e for e in server._edges_by_id().values() if len(e["car_lane_indices"]) >= 2][:3]
    assert len(edges) == 3
    return [
        {"type": "road_closure", "target_edge": edges[0]["id"],
         "window": {"start_s": 600.0, "end_s": 1200.0}},
        {"type": "lane_closure", "target_edge": edges[1]["id"],
         "target_lanes": [edges[1]["car_lane_indices"][0]],
         "window": {"start_s": 900.0, "end_s": 1500.0}},
        {"type": "incident", "target_edge": edges[2]["id"],
         "effect": {"speed_factor": 0.5}, "window": {"start_s": 600.0, "end_s": 1800.0}},
    ]


def test_post_composite_member_type_gate_names_index() -> None:
    # V2.4b: the member gate is WINDOWABLE_TYPES — bike_lane and new_road stay out, with the
    # single-source reason naming why.
    from fastapi import HTTPException

    import change_scheduler as cs
    members = _three_zone_members()
    members[1] = {"type": "bike_lane", "target_edge": members[1]["target_edge"]}
    with pytest.raises(HTTPException) as ei:
        _post_composite(members)
    assert ei.value.status_code == 400
    assert "change 1" in ei.value.detail and cs.REASON_COMPOSITE_MEMBER in ei.value.detail
    members2 = _three_zone_members()
    members2[0] = {"type": "new_road", "from_junction": "J1", "to_junction": "J2"}
    with pytest.raises(HTTPException) as ei2:
        _post_composite(members2)
    assert ei2.value.status_code == 400
    assert "change 0" in ei2.value.detail and cs.REASON_COMPOSITE_MEMBER in ei2.value.detail


def test_post_composite_mixed_members_spec_carries_per_type_truth() -> None:
    # V2.4b: the serializer must carry each member's defining fields (the old one hardcoded the
    # speed_limit shape and silently DROPPED target_lanes/effect) — and must not leak SimChange's
    # non-None new_road defaults (lanes/speed_mps/bidirectional) into members.
    import json as _json

    import run_state
    members = _mixed_members()
    try:
        out, bg = _post_composite(members)
        run_id = out["run_id"]
        spec_path = run_state.STATE_DIR / f"{run_id}.composite.json"
        spec = _json.loads(spec_path.read_text(encoding="utf-8"))
        rc, lc, inc = spec["changes"]
        assert rc["type"] == "road_closure" and rc["window"] == {"start_s": 600.0, "end_s": 1200.0}
        assert rc["description"].startswith("Closed edge ") and "(all lanes)" in rc["description"]
        assert lc["type"] == "lane_closure" and lc["target_lanes"] == members[1]["target_lanes"]
        assert lc["description"].startswith("Closed 1 of ")
        assert inc["type"] == "incident" and inc["effect"] == {"speed_factor": 0.5}
        assert inc["window"] == {"start_s": 600.0, "end_s": 1800.0}
        assert "(incident)" in inc["description"]
        for c in spec["changes"]:
            for leaked in ("value_mps", "lanes", "speed_mps", "bidirectional", "from_junction"):
                assert leaked not in c, (c["type"], leaked)
        st = run_state.read(run_id)
        assert st["description"].startswith("3 changes on the corridor")
        assert len(st["changes"]) == 3
        for p in (spec_path, run_state.STATE_DIR / f"{run_id}.json"):
            p.unlink(missing_ok=True)
    finally:
        run_state.release()


def test_post_composite_member_matrix_prefixes_index() -> None:
    # V2.4b: the per-member rejection matrix speaks the shared strings with the change index.
    from fastapi import HTTPException

    members = _mixed_members()
    members[1]["target_lanes"] = [99]
    with pytest.raises(HTTPException) as ei:
        _post_composite(members)
    assert ei.value.status_code == 400
    assert ei.value.detail.startswith("change 1: ") and "not car lanes" in ei.value.detail

    members2 = _mixed_members()
    del members2[2]["window"]
    with pytest.raises(HTTPException) as ei2:
        _post_composite(members2)
    assert ei2.value.status_code == 400
    assert ei2.value.detail.startswith("change 2: ") and "incident requires a window" in ei2.value.detail


def test_post_composite_settled_rejected_with_exact_reason() -> None:
    from fastapi import HTTPException

    import change_scheduler as cs
    with pytest.raises(HTTPException) as ei:
        _post_composite(_three_zone_members(), assignment="settled")
    assert ei.value.status_code == 400 and ei.value.detail == cs.REASON_COMPOSITE_SETTLED


def test_post_composite_bad_member_edge_names_index() -> None:
    from fastapi import HTTPException

    members = _three_zone_members()
    members[2]["target_edge"] = "no_such_edge_xyz"
    with pytest.raises(HTTPException) as ei:
        _post_composite(members)
    assert ei.value.status_code == 400 and "change 2" in ei.value.detail


def test_post_composite_member_window_sanity() -> None:
    from fastapi import HTTPException

    members = _three_zone_members()
    members[0]["window"] = {"start_s": 1200.0, "end_s": 600.0}
    with pytest.raises(HTTPException) as ei:
        _post_composite(members)
    assert ei.value.status_code == 400 and "change 0" in ei.value.detail and "end_s" in ei.value.detail


def test_post_composite_success_writes_spec_and_composite_cmd() -> None:
    import json as _json

    import run_state
    members = _three_zone_members()
    try:
        out, bg = _post_composite(members, tags=["school_zone"])
        run_id = out["run_id"]
        spec_path = run_state.STATE_DIR / f"{run_id}.composite.json"
        assert spec_path.is_file()
        spec = _json.loads(spec_path.read_text(encoding="utf-8"))
        assert len(spec["changes"]) == 3 and spec["tags"] == ["school_zone"]
        # the server fills every member description (Change.description is contract-required)
        assert all(c.get("description") for c in spec["changes"])
        # exactly one queued background job whose cmd hands off via --composite
        (task,) = bg.tasks
        _, cmds, _ = task.args
        (cmd,) = cmds
        assert "--composite" in cmd and str(spec_path) in cmd
        assert "--change-type" not in cmd  # the composite path never uses the single-change flag
        # run-state carries the school-zone description + the member list + tags
        st = run_state.read(run_id)
        assert st["stage"] == "queued" and st["tags"] == ["school_zone"]
        assert len(st["changes"]) == 3 and "School zone" in st["description"]
        # cleanup
        for p in (spec_path, run_state.STATE_DIR / f"{run_id}.json"):
            p.unlink(missing_ok=True)
    finally:
        run_state.release()


def test_build_composite_cmd_flags_byte_stable_defaults() -> None:
    from pathlib import Path as _P
    cmd = server._build_composite_cmd(_P("spec.json"), "TS")
    assert cmd[2:] == ["--composite", "spec.json", "--run-ts", "TS"]
    full = server._build_composite_cmd(_P("spec.json"), "TS", demand_profile="calibrated_am_peak",
                                       assignment="day_one", n_seeds=3)
    assert "--demand-profile" in full and "--n-seeds" in full and "--assignment" not in full


# ---------------------------------------------------------------- V2.2d review fixes

def test_run_state_list_all_skips_composite_specs_and_junk(tmp_path, monkeypatch) -> None:
    """BLOCKER (review-caught, reproduced live): the composite spec file lives in STATE_DIR, so
    list_all's *.json glob picked it up, read() re-resolved '<id>.composite' back to the SAME file
    (valid JSON, no run_id), and GET /api/runs 500'd for EVERY run until the file was hand-deleted.
    list_all must skip spec files structurally AND read() must refuse run_id-less JSON."""
    import json as _json

    import run_state
    monkeypatch.setattr(run_state, "STATE_DIR", tmp_path)
    run_state.set_stage("run-a", "done", "ok")
    (tmp_path / "run-b.composite.json").write_text(_json.dumps({"changes": [], "tags": []}), encoding="utf-8")
    (tmp_path / "junk.json").write_text(_json.dumps({"not": "state"}), encoding="utf-8")
    # V2.4c: the THIRD file class under the same glob — the identity sidecar (user fold-in: every
    # new file class in this dir re-proves coexistence, since the composite spec 500'd live once)
    run_state.set_identity("run-a", name="My run")
    rows = run_state.list_all()
    assert [r["run_id"] for r in rows] == ["run-a"]  # never crashes, never lists non-state files
    assert "name" not in rows[0]  # list_all stays identity-free (the server merges)
    assert run_state.read("junk") is None
    assert run_state.read("run-b.composite") is None
    assert run_state.read("run-a.identity") is None  # the sidecar can never masquerade as state


def test_post_composite_then_api_runs_still_serves(tmp_path) -> None:
    """The live-repro shape of the blocker: after a composite POST writes its spec file, the REAL
    /api/runs handler must still serve (and list the new run)."""
    import asyncio

    import run_state
    members = _three_zone_members()
    try:
        out, _bg = _post_composite(members, tags=["school_zone"])
        run_id = out["run_id"]
        runs = asyncio.run(server.runs())  # crashed KeyError 'run_id' before the fix
        assert any(r["id"] == run_id for r in runs["runs"])
    finally:
        run_state.release()
        for p in (run_state.STATE_DIR / f"{out['run_id']}.composite.json",
                  run_state.STATE_DIR / f"{out['run_id']}.json"):
            p.unlink(missing_ok=True)


def test_post_composite_same_edge_crossing_windows_rejected_cleanly() -> None:
    """Review nit: same-edge crossing windows used to slip POST validation and die mid-SUMO-run as
    a raw scheduler ValueError; the LIFO rule now runs at POST time (and in the harness spec load)."""
    from fastapi import HTTPException

    edge, _ = _real_edge_with_2_car_lanes()
    members = [
        {"type": "speed_limit", "target_edge": edge, "value_mps": 8.33,
         "window": {"start_s": 600.0, "end_s": 1800.0}},
        {"type": "speed_limit", "target_edge": edge, "value_mps": 5.0,
         "window": {"start_s": 1200.0, "end_s": 2400.0}},  # crosses the first
    ]
    with pytest.raises(HTTPException) as ei:
        _post_composite(members)
    assert ei.value.status_code == 400 and "disjoint or nested" in ei.value.detail
    # NESTED windows on the same edge stay legal (LIFO-revertible) — must not be over-rejected
    import run_state
    nested = [
        {"type": "speed_limit", "target_edge": edge, "value_mps": 8.33,
         "window": {"start_s": 600.0, "end_s": 2400.0}},
        {"type": "speed_limit", "target_edge": edge, "value_mps": 5.0,
         "window": {"start_s": 900.0, "end_s": 1200.0}},
    ]
    try:
        out, _bg = _post_composite(nested)
        assert out["run_id"]
    finally:
        run_state.release()
        for p in (run_state.STATE_DIR / f"{out['run_id']}.composite.json",
                  run_state.STATE_DIR / f"{out['run_id']}.json"):
            p.unlink(missing_ok=True)
