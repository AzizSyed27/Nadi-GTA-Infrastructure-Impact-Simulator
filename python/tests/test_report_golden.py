"""V2.2 closeout — the UNWINDOWED report is pinned byte-identical.

The windowed-scope disclosure (report.build_scope_disclosure) must change NOTHING for a run
with no windowed change: `golden_report_unwindowed.md` was captured from the pre-disclosure
renderer, and this test renders the same deterministic stub report and compares bytes.

The capture/regen helper STRUCTURALLY refuses a windowed source artifact — a windowed golden
would "prove" byte-identity for exactly the wrong case.

Run:        python -m pytest python/tests/test_report_golden.py -v
Regenerate: python python/tests/test_report_golden.py   (only for a DELIBERATE render change)
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "python" / "src"))
import report  # noqa: E402
from contract_models import (  # noqa: E402
    Change, Meta, Scenario, Scorecard, ScorecardCell, ScorecardGroup, TrajectoryArtifact, Vehicle,
)

GOLDEN_PATH = Path(__file__).resolve().parent / "golden_report_unwindowed.md"


# --------------------------------------------------------------------------------------------------
# The deterministic stub run — UNWINDOWED by construction (mirrors test_report._artifact).
# --------------------------------------------------------------------------------------------------

def _artifact() -> TrajectoryArtifact:
    change = Change(type="bike_lane", target_edge="E1", target_lane=1, value_mps=None,
                    description="Converted a car lane to a bike lane")
    meta = Meta(run_id="scen-GOLDEN", network="corridor.net.xml", bbox=[-79.3, 43.7, -79.1, 43.8],
                sim_start=0.0, sim_end=100.0, step_length=1.0, created_at="2026-07-04T00:00:00+00:00",
                scenario=Scenario(baseline_run_id="base-GOLDEN", change=change))
    groups = [
        ScorecardGroup(group="car_commuter", grounding="sim",
                       travel_time_delta=ScorecardCell(value=0.0, affected_share=0.033, confidence="measured", note="tt"),
                       safety_delta=ScorecardCell(value=6.5, confidence="low", note="safety unstable"),
                       access_delta=ScorecardCell(value=0.33, confidence="low", note="est")),
        ScorecardGroup(group="cyclist", grounding="sim",
                       travel_time_delta=ScorecardCell(value=0.0, affected_share=0.0, confidence="measured", note="tt"),
                       safety_delta=ScorecardCell(value=6.8, confidence="low", note="safety unstable"),
                       access_delta=ScorecardCell(value=-1.0, confidence="low", note="est")),
    ]
    return TrajectoryArtifact(schema_version="0.3.0", meta=meta,
                              vehicles=[Vehicle(id="c1", type="car", path=[[-79.2, 43.75], [-79.2, 43.76]],
                                                timestamps=[0.0, 1.0], speeds=[1.0, 1.0])],
                              scorecard=Scorecard(groups=groups, bca=None))


def _outcomes() -> dict:
    return {
        "scenario_run_id": "scen-GOLDEN", "baseline_run_id": "base-GOLDEN",
        "connectivity_severed_edges": [], "reroute": {"cars_rerouted": 0, "cars_matched": 300},
        "modes": {m: {"counts": {"total_demand": d}} for m, d in
                  (("car", 300), ("bicycle", 82), ("pedestrian", 129))},
    }


def _render() -> str:
    art, out = _artifact(), _outcomes()
    # GOLDEN PROVENANCE GUARD: this pin exists to prove the UNWINDOWED render never moves — a
    # windowed source here would capture (and then "protect") the wrong case.
    from contract_models import changes_of
    assert all(getattr(c, "window", None) is None for c in changes_of(art)), \
        "golden source artifact must carry NO windowed change"
    facts = report.gather_facts(art, out, verdict=None)
    report.verify_facts(facts, art, out)
    glosses = {gid: f"Stub gloss for {gid}." for gid in report.GROUP_ORDER}
    caveats = report.build_caveats(facts)
    meta = {"generated_at": "2026-07-28T00:00:00+00:00", "provider": "none", "model": "stub",
            "audit_summary": "stub (deterministic golden render — no LLM)"}
    return report.render_markdown(facts, "Stub framing paragraph.", glosses, {},
                                  "Stub caveat intro.", caveats, meta)


def test_unwindowed_report_is_byte_identical_to_golden():
    got = _render()
    assert GOLDEN_PATH.exists(), "golden missing — regenerate deliberately via __main__"
    want = GOLDEN_PATH.read_text(encoding="utf-8")
    assert got == want, ("UNWINDOWED report drifted from the golden. If the render change is "
                         "deliberate, regenerate: python python/tests/test_report_golden.py")


def test_unwindowed_report_carries_no_scope_disclosure():
    # belt to the golden's suspenders: the disclosure phrasing never appears for an unwindowed run
    got = _render()
    assert "Scorecard measures cover the full simulated period" not in got
    assert "active window" not in got


if __name__ == "__main__":
    GOLDEN_PATH.write_text(_render(), encoding="utf-8")
    print(f"wrote {GOLDEN_PATH}")
