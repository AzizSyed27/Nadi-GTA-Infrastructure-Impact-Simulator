"""The newest-pick resolver family fix — the twice-fired lexicographic ammunition ('V' > '2'):
report_agent.newest_index served a stale index for two silent days (V2.5a forensics);
reactions.newest_instrumented enriched a dead roster and burned a Groq day cap (V2.6c C6).

The rule that survived both counterexamples: DIGIT-FIRST name filtering (strict strptime would
reject the legitimate --run-ts seed probe `20260719T0500SEED1`; mtime is scrambled by OneDrive
resync — proven in this tree — and index-dir mtime tracks last CHAT, not last build). Skipped
non-timestamp names are WARNED by name on every resolution; a junk-only space exits LOUDLY
naming the files and the explicit flag — silence was the incident class.

SEVERITY REACHABILITY (confirmed by grep at implementation): no exit-bearing resolver is
reachable from a live FastAPI handler — server.py imports `report` for its AUDIT functions only
(never _resolve); reactions/sampler run as server-LAUNCHED subprocesses with EXPLICIT
--instrumented/--outcomes paths (server.py:925/:926 — a SystemExit there fails that one enrich
job loudly in run-state, the correct containment) or as bare CLI where a human watches stdout;
the redesigned newest_index returns None / falls back and runs in LIFESPAN, not a handler;
run_state.list_all (GET /api/runs) gains an ordering key only — no exit path. The
crash-loud-in-CLI vs named-error-in-request distinction is deliberate."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "python" / "src"))

import reactions  # noqa: E402
import report_agent  # noqa: E402
import run_state  # noqa: E402
import sampler  # noqa: E402
import settle  # noqa: E402
import trajectory_io  # noqa: E402

FRESH = "instrumented-20260820T233339Z.json"
JUNK = "instrumented-V22AACCEPT.json"


# ===================================================================================================
# The shared helper — literal incident pins
# ===================================================================================================


def test_helper_picks_timestamp_over_junk(tmp_path: Path, capsys) -> None:
    """THE EXACT C6 burn input: the junk name lexicographically outsorts the fresh timestamp —
    the helper must pick the timestamp file and NAME what it skipped."""
    (tmp_path / JUNK).write_text("{}", encoding="utf-8")
    (tmp_path / FRESH).write_text("{}", encoding="utf-8")
    p = trajectory_io.newest_ts_named(tmp_path, "instrumented-*.json", "instrumented-",
                                      none_msg="none here", flag_hint="--instrumented")
    assert p.name == FRESH
    out = capsys.readouterr().out
    assert "skipping 1 non-timestamp name" in out
    assert "instrumented-V22AACCEPT.json" in out
    assert "--instrumented" in out


def test_helper_seed_probe_stays_eligible(tmp_path: Path) -> None:
    """The strptime counterexample, pinned so the filter can never tighten into a parser by
    drift: `20260719T0500SEED1` is a REAL --run-ts seed-probe family and must stay eligible."""
    (tmp_path / "multimodal-scenario-20260719T0500SEED1.json").write_text("{}", encoding="utf-8")
    p = trajectory_io.newest_ts_named(tmp_path, "multimodal-scenario-*.json", "multimodal-scenario-",
                                      none_msg="none", flag_hint="--run-id")
    assert p.name == "multimodal-scenario-20260719T0500SEED1.json"


def test_helper_junk_only_exits_naming_files(tmp_path: Path) -> None:
    (tmp_path / JUNK).write_text("{}", encoding="utf-8")
    with pytest.raises(SystemExit) as ei:
        trajectory_io.newest_ts_named(tmp_path, "instrumented-*.json", "instrumented-",
                                      none_msg="none", flag_hint="--instrumented")
    msg = str(ei.value)
    assert "V22AACCEPT" in msg and "--instrumented" in msg


def test_helper_empty_uses_the_site_message(tmp_path: Path) -> None:
    with pytest.raises(SystemExit, match="no instrumented files at all"):
        trajectory_io.newest_ts_named(tmp_path, "instrumented-*.json", "instrumented-",
                                      none_msg="no instrumented files at all", flag_hint="--x")


# ===================================================================================================
# Call sites route through the helper (per-call-site proof, not helper-in-isolation)
# ===================================================================================================


def test_reactions_and_sampler_route_through_the_helper(tmp_path: Path, monkeypatch, capsys) -> None:
    monkeypatch.setattr(reactions, "RUNS_DIR", tmp_path)
    monkeypatch.setattr(sampler, "RUNS_DIR", tmp_path)
    for name in (JUNK, FRESH, "outcomes-V22AACCEPT.json", "outcomes-20260820T233339Z.json"):
        (tmp_path / name).write_text("{}", encoding="utf-8")
    assert reactions.newest_instrumented().name == FRESH
    assert sampler.newest_outcomes().name == "outcomes-20260820T233339Z.json"
    out = capsys.readouterr().out
    assert out.count("skipping 1 non-timestamp name") == 2  # both sites warn


# ===================================================================================================
# newest_index — alignment-first (the V2.5a drift class killed structurally)
# ===================================================================================================


def _index_root(tmp_path: Path) -> Path:
    root = tmp_path / "nadi-report-agent"
    (root / "index-V22AACCEPT").mkdir(parents=True)  # the junk dir that outsorted for 2 days
    (root / "index-20260702T044134Z").mkdir()
    return root


def test_newest_index_aligns_with_the_served_report(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(report_agent, "INDEX_ROOT", _index_root(tmp_path))
    rpt = tmp_path / "latest-report.json"
    rpt.write_text(json.dumps({"run": {"scenario_run_id": "multimodal-scenario-20260702T044134Z"}}),
                   encoding="utf-8")
    monkeypatch.setattr(report_agent, "LATEST_REPORT", rpt)
    got = report_agent.newest_index()
    assert got is not None
    d, ts = got
    assert d.name == "index-20260702T044134Z" and ts == "20260702T044134Z"


def test_newest_index_fallback_digit_first_and_is_dir(tmp_path: Path, monkeypatch, capsys) -> None:
    root = _index_root(tmp_path)
    (root / "index-zzz-strayfile").write_text("not a dir", encoding="utf-8")  # the stray-FILE trap
    monkeypatch.setattr(report_agent, "INDEX_ROOT", root)
    monkeypatch.setattr(report_agent, "LATEST_REPORT", tmp_path / "missing-report.json")
    got = report_agent.newest_index()
    assert got is not None
    d, ts = got
    assert d.name == "index-20260702T044134Z"  # digit-first beats the junk dir AND the stray file
    out = capsys.readouterr().out
    assert "latest-report" in out  # the unreadable-report state is EXPLICIT, never silent
    assert "V22AACCEPT" in out  # the skipped junk is named


def test_newest_index_aligned_report_but_no_matching_index_falls_back(tmp_path: Path, monkeypatch, capsys) -> None:
    monkeypatch.setattr(report_agent, "INDEX_ROOT", _index_root(tmp_path))
    rpt = tmp_path / "latest-report.json"
    rpt.write_text(json.dumps({"run": {"scenario_run_id": "multimodal-scenario-19990101T000000Z"}}),
                   encoding="utf-8")
    monkeypatch.setattr(report_agent, "LATEST_REPORT", rpt)
    got = report_agent.newest_index()
    assert got is not None
    assert got[0].name == "index-20260702T044134Z"  # fallback still digit-first
    assert "no index for the served report" in capsys.readouterr().out


def test_newest_index_empty_root_returns_none(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(report_agent, "INDEX_ROOT", tmp_path / "empty-root")
    monkeypatch.setattr(report_agent, "LATEST_REPORT", tmp_path / "missing.json")
    assert report_agent.newest_index() is None


# ===================================================================================================
# settle — the same bug in the numeric alphabet ('9' > '11' as strings)
# ===================================================================================================


def test_settle_iteration_dirs_sort_numerically(tmp_path: Path) -> None:
    """DEFAULT_CAP=12 → dirs 0..11; the string sort took iteration 9's routes (and scrambled the
    avg_tts sequence feeding convergence_stats). key=int fixes both."""
    for i in range(12):
        (tmp_path / str(i)).mkdir()
    dirs = settle._iteration_dirs(tmp_path)
    assert [d.name for d in dirs] == [str(i) for i in range(12)]
    assert dirs[-1].name == "11"


# ===================================================================================================
# run_state.list_all — ordering only, NEVER a filter (an inventory, not a resolver)
# ===================================================================================================


def test_list_all_orders_junk_last_and_never_filters(tmp_path: Path, monkeypatch) -> None:
    state = tmp_path / "state"
    state.mkdir()
    ids = ["multimodal-scenario-V22AACCEPT", "multimodal-scenario-20260101T000000Z",
           "multimodal-scenario-20260820T233339Z"]
    for rid in ids:
        (state / f"{rid}.json").write_text(json.dumps({"run_id": rid, "stage": "done"}),
                                           encoding="utf-8")
    monkeypatch.setattr(run_state, "STATE_DIR", state)
    out = run_state.list_all()
    listed = [s["run_id"] for s in out]
    # COMPLETENESS first (user note 2): every run listed, junk included — a planner may load it
    assert set(listed) == set(ids)
    # then the ordering: timestamp-shaped newest-first, junk LAST (was: junk pinned to the top)
    assert listed[0] == "multimodal-scenario-20260820T233339Z"
    assert listed[1] == "multimodal-scenario-20260101T000000Z"
    assert listed[-1] == "multimodal-scenario-V22AACCEPT"
