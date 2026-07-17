"""V2.1c — SETTLE: iterated traffic assignment via duaIterate (MESO iterations; the micro-final run is
the harness's normal leg, which measures everything that matters).

Scope honesty (mirrors contract v0.7.0 meta.assignment.scope="cars_only"): only CAR routes are
iterated. Bikes and pedestrians keep their fixed day-one routes — meso auto-downgrades pedestrians to
the nonInteracting model and ignores bike-only lanes in its congestion model, so iterating them would
be noise wearing a convergence costume. A settled run therefore means DRIVERS have adapted; ped/bike
rows reflect unadapted behavior, and every consumer surface says so.

Convergence (SUMO 1.27 has no native relative gap): duaIterate's own criterion — the relative standard
deviation of per-iteration average travel time over the last `conv_it` iterations, enabled via
--max-convergence-deviation. We record the per-iteration series + the final deviation + whether the
loop stopped early (converged) or hit the cap.

Workdirs live under %LOCALAPPDATA%/nadi-demand/settle/ (OneDrive-safe). duaIterate has no internal
parallelism; legs run sequentially.
"""

from __future__ import annotations

import os
import re
import statistics
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

import run_sim  # wires SUMO_HOME/tools; exposes SUMO_HOME

DUAITERATE = run_sim.SUMO_HOME / "tools" / "assign" / "duaIterate.py"
SETTLE_ROOT = Path(os.environ.get("LOCALAPPDATA") or os.environ.get("TMP") or ".") / "nadi-demand" / "settle"

DEFAULT_CAP = 12
DEFAULT_CONV_DEV = 0.02   # relative stddev of avg travel time — duaIterate's stopping criterion
DEFAULT_CONV_IT = 3       # window (iterations) the deviation is computed over


def _avg_tt(tripinfo: Path) -> float | None:
    """Average vehicle trip duration in one iteration's tripinfo — the same reduction duaIterate uses."""
    durations = [float(ti.get("duration", 0.0)) for ti in ET.parse(tripinfo).getroot().iter("tripinfo")]
    return round(statistics.fmean(durations), 3) if durations else None


def _route_ids(rou: Path) -> set[str]:
    return {v.get("id", "") for v in ET.parse(rou).getroot().iter("vehicle")}


def convergence_stats(avg_tts: list[float], conv_dev: float, conv_it: int,
                      iterations_run: int, cap: int) -> tuple[float | None, bool]:
    """(relative_deviation, converged) — duaIterate's own measure: relative stddev of the average
    travel time over the last ``conv_it`` iterations; converged means the deviation beat the threshold
    AND the loop stopped before the cap (a cap-hit is never claimed as convergence)."""
    tail = avg_tts[-conv_it:]
    rel_dev = round(statistics.pstdev(tail) / statistics.fmean(tail), 4) if len(tail) >= 2 else None
    converged = bool(rel_dev is not None and len(avg_tts) >= conv_it
                     and rel_dev < conv_dev and iterations_run < cap)
    return rel_dev, converged


def settle_leg(net_path: Path, car_routes: Path, out_dir: Path, *, cap: int = DEFAULT_CAP,
               conv_dev: float = DEFAULT_CONV_DEV, conv_it: int = DEFAULT_CONV_IT, seed: int = 42,
               max_t: float | None = None, on_iteration=None, first_iteration_only: bool = False) -> dict:
    """Run duaIterate (meso, cars only) for one leg. Returns {routes: Path|None, stats: dict}.

    ``first_iteration_only`` runs exactly ONE iteration — the calibrated-settle measurement gate
    (the projection must be surfaced before committing to a full settle).
    ``on_iteration(k, cap)`` fires as each iteration starts (run-state progress).
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    last = 1 if first_iteration_only else cap
    cmd = [sys.executable, str(DUAITERATE),
           "-n", str(net_path), "-r", str(car_routes),
           "-l", str(last), "--skip-first-routing", "--no-gzip",
           "--max-convergence-deviation", str(conv_dev),
           "--convergence-iterations", str(conv_it),
           "-m", "-j",                      # meso + junction control (signals matter on this corridor)
           "--meso-recheck", "30",
           # NOTE: duaIterate itself already passes --time-to-teleport (default 300) and --no-step-log
           # to every sumo call — passing them through again is a hard "already set" error.
           # glued pass-through form (validated by duaIterate against the installed binary's --help)
           "sumo--seed", str(seed),
           ]
    if max_t is not None:
        cmd += ["sumo--end", str(max_t)]

    t0 = time.perf_counter()
    iterations_seen = 0
    step_re = re.compile(r"> Executing step (\d+)")
    with (out_dir / "duaIterate.log").open("w", encoding="utf-8") as log:
        proc = subprocess.Popen([str(c) for c in cmd], cwd=str(out_dir), stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, text=True,
                                env={**os.environ, "SUMO_HOME": str(run_sim.SUMO_HOME)})
        assert proc.stdout is not None
        for line in proc.stdout:
            log.write(line)
            m = step_re.search(line)
            if m:
                iterations_seen = int(m.group(1)) + 1
                if on_iteration:
                    on_iteration(iterations_seen, last)
        proc.wait()
    wall = time.perf_counter() - t0
    if proc.returncode != 0:
        raise RuntimeError(f"duaIterate failed (exit {proc.returncode}) — see {out_dir / 'duaIterate.log'}")

    # per-iteration average travel time from each NNN/tripinfo_NNN.xml
    iter_dirs = sorted(d for d in out_dir.iterdir() if d.is_dir() and d.name.isdigit())
    avg_tts: list[float] = []
    for d in iter_dirs:
        ti = d / f"tripinfo_{d.name}.xml"
        if ti.is_file():
            v = _avg_tt(ti)
            if v is not None:
                avg_tts.append(v)
    # final relative deviation over the last conv_it iterations (duaIterate's own measure)
    rel_dev, converged = convergence_stats(avg_tts, conv_dev, conv_it, len(iter_dirs), last)

    # the LAST iteration's routes are the settled set
    routes: Path | None = None
    if iter_dirs:
        cand = sorted(iter_dirs[-1].glob("*.rou.xml"))
        routes = cand[0] if cand else None
    if routes is not None and not first_iteration_only:
        # the pair join depends on vehicle ids — Gawron keeps the same vehicles; verify, don't assume
        settled_ids = _route_ids(routes)
        original_ids = _route_ids(car_routes)
        assert settled_ids == original_ids, (
            f"settled routes lost/renamed vehicles: {len(original_ids - settled_ids)} missing, "
            f"{len(settled_ids - original_ids)} new — the baseline/scenario join would silently shrink")

    stats = {
        "engine": "duaIterate_meso",
        "iterations_run": len(iter_dirs),
        "cap": last,
        "avg_tt_per_iteration_s": avg_tts,
        "relative_deviation": rel_dev,
        "convergence_threshold": conv_dev,
        "convergence_window": conv_it,
        "converged": converged,
        "wall_clock_s": round(wall, 1),
    }
    return {"routes": routes, "stats": stats}
