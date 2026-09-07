"""V2.7b C10a — labels and estimates that exist in two files, pinned across the seam.

Three constants in this project live in two places at once, and each pairing has a way of going
wrong quietly:

  * DEMAND PROFILE LABELS. `web/lib/provenance.ts` has said "synthetic demo demand" since V2.1;
    python had no label at all, so Act I's first beat rendered the raw identifier `synthetic_demo`
    at a reader. C10a gave python a label map — and two labels for one profile is exactly how a
    reader ends up believing they are two different things.
  * THE PROJECTION'S INPUTS. `server._project_interpretation` mirrors defaults that live in other
    modules' argparse (the sampler's per-mode sample sizes, propagation's steps and activation). A
    consent number computed from a stale mirror is worse than no number.

The technique is this repo's own: read the other file, extract the literal, assert. The precedent
is `test_event_vocabulary.py` (run_events -> runStream.ts), `test_bucket_labels_lockstep.py`
(report -> mergeSlots.ts) and `test_golden_trajectory.py`'s compactTime pin. No parsing, no Node.

Run: python -m pytest python/tests/test_display_label_lockstep.py -v
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "python" / "src"))

import demand_profiles  # noqa: E402

PROVENANCE_TS = REPO / "web" / "lib" / "provenance.ts"
SAMPLER_PY = REPO / "python" / "src" / "sampler.py"
PROPAGATION_PY = REPO / "python" / "src" / "propagation.py"


def _ts_demand_labels() -> set[str]:
    """The two label strings `demandLabel` can return."""
    src = PROVENANCE_TS.read_text(encoding="utf-8")
    body = src.split("export function demandLabel", 1)[1].split("}", 1)[0]
    return set(re.findall(r"'([^']+)'", body)) - {"calibrated_am_peak", "synthetic_demo"}


def test_the_python_labels_are_the_ones_the_client_already_shows() -> None:
    """THE PIN. A reader who fires a run sees Act I's beat (python) and the run document
    (TypeScript) within a minute of each other. They must not describe the same demand in two
    different phrasings."""
    assert _ts_demand_labels() == set(demand_profiles.DISPLAY_NAME.values()), (
        "demand_profiles.DISPLAY_NAME has drifted from web/lib/provenance.ts demandLabel")


def test_every_profile_has_a_label_and_none_is_the_raw_identifier() -> None:
    for name in demand_profiles.PROFILE_NAMES:
        label = demand_profiles.display_name(name)
        assert label and label != name, f"{name} still renders as its wire identifier"
    # an unknown profile falls back to the identifier rather than inventing a label for it
    assert demand_profiles.display_name("something_new") == "something_new"
    assert demand_profiles.display_name(None) == "unknown"


def _argparse_default(path: Path, flag: str) -> str:
    """The literal `default=` of one argparse flag, read out of the source."""
    src = path.read_text(encoding="utf-8")
    m = re.search(rf'add_argument\("{re.escape(flag)}".*?default=([0-9.]+)', src, re.S)
    assert m, f"{flag} not found in {path.name}"
    return m.group(1)


def test_the_projection_mirrors_the_defaults_it_claims_to_use() -> None:
    """`_project_interpretation` cannot import these — they are argparse defaults inside `main()` —
    so it mirrors them with the source named in a comment. This is what keeps the mirror honest."""
    import server

    sample = sum(int(_argparse_default(SAMPLER_PY, f"--n-{m}")) for m in ("car", "bike", "ped", "inferred"))
    assert server.DEFAULT_SAMPLE_TARGET == sample, (
        f"server.DEFAULT_SAMPLE_TARGET ({server.DEFAULT_SAMPLE_TARGET}) != sampler.py's per-mode "
        f"defaults ({sample}) — the pre-run cost estimate is computed from a stale number")
    assert server.CASCADE_STEPS == int(_argparse_default(PROPAGATION_PY, "--steps"))
    assert server.CASCADE_ACTIVATION == float(_argparse_default(PROPAGATION_PY, "--activation"))
