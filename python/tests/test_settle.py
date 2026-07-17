"""V2.1c — settle helpers (pure: convergence math, tripinfo reduction; NO duaIterate run) and the
net-gated runtime net patch with its readback gauntlet."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "python" / "src"))

try:
    import run_sim  # noqa: E402 — wires SUMO tools
    import sumolib  # noqa: E402
    import settle  # noqa: E402
    import network_edit  # noqa: E402
    from contract_models import Change  # noqa: E402
except Exception:  # pragma: no cover — SUMO not on this box
    pytest.skip("SUMO/sumolib unavailable (SUMO_HOME unset)", allow_module_level=True)

NET_GATED = pytest.mark.skipif(not run_sim.NET.is_file(), reason="corridor net unavailable")


# ---------------------------------------------------------------- pure convergence math

def test_convergence_stats_converged() -> None:
    # stable tail well under the threshold, stopped before the cap
    rel, conv = settle.convergence_stats([900, 700, 640, 636, 638], conv_dev=0.02, conv_it=3,
                                         iterations_run=5, cap=12)
    assert rel is not None and rel < 0.02 and conv is True


def test_convergence_stats_cap_hit_never_claims_convergence() -> None:
    rel, conv = settle.convergence_stats([900, 700, 640, 636, 638], conv_dev=0.02, conv_it=3,
                                         iterations_run=12, cap=12)
    assert conv is False, "a cap-hit run must not be reported as converged"


def test_convergence_stats_unstable() -> None:
    rel, conv = settle.convergence_stats([900, 700, 900, 600, 880], conv_dev=0.02, conv_it=3,
                                         iterations_run=5, cap=12)
    assert rel is not None and rel > 0.02 and conv is False


def test_convergence_stats_too_few_iterations() -> None:
    rel, conv = settle.convergence_stats([900.0], conv_dev=0.02, conv_it=3, iterations_run=1, cap=12)
    assert rel is None and conv is False


def test_avg_tt_reduction(tmp_path) -> None:
    ti = tmp_path / "tripinfo_000.xml"
    ti.write_text('<tripinfos><tripinfo id="a" duration="10.0"/><tripinfo id="b" duration="20.0"/>'
                  "</tripinfos>", encoding="utf-8")
    assert settle._avg_tt(ti) == 15.0
    empty = tmp_path / "tripinfo_001.xml"
    empty.write_text("<tripinfos></tripinfos>", encoding="utf-8")
    assert settle._avg_tt(empty) is None


# ---------------------------------------------------------------- net-gated runtime patch

@NET_GATED
def test_patch_runtime_net_speed_limit(tmp_path) -> None:
    """The patched net keeps its shape and the READBACK confirms the intended speed — never assumed."""
    change = Change(type="speed_limit", target_edge="42140001", value_mps=11.11, description="test")
    out = network_edit.patch_runtime_net(change, "_test_rt_speed")
    try:
        patched = sumolib.net.readNet(str(out))
        assert abs(patched.getEdge("42140001").getSpeed() - 11.11) < 1e-6
        canonical = sumolib.net.readNet(str(run_sim.NET))
        assert len(patched.getEdges(withInternal=False)) == len(canonical.getEdges(withInternal=False))
        assert abs(canonical.getEdge("42140001").getSpeed() - 11.11) > 1e-6, "canonical must be untouched"
    finally:
        out.unlink(missing_ok=True)


@NET_GATED
def test_patch_runtime_net_rejects_wrong_type() -> None:
    with pytest.raises(ValueError, match="speed_limit/bike_lane"):
        network_edit.patch_runtime_net(
            Change(type="new_road", target_edge="nr_A_B", description="x"), "_test_rt_bad")
