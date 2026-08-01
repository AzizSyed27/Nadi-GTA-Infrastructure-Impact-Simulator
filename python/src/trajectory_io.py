"""(De)serialize trajectory artifacts and validate them against the frozen JSON Schema.

The canonical contract is ``contract/trajectory_schema.json``. Every write and every read passes
through ``jsonschema`` validation against that file, so the schema — not the pydantic model — is the
authority. The pydantic ``TrajectoryArtifact`` is used for typed construction on the Python side.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker

from contract_models import TrajectoryArtifact

# Repo root is two levels up from python/src/.  python/src/trajectory_io.py -> python/src -> python -> <root>
_REPO_ROOT = Path(__file__).resolve().parents[2]
CONTRACT_DIR = _REPO_ROOT / "contract"
SCHEMA_PATH = CONTRACT_DIR / "trajectory_schema.json"
RUNS_DIR = CONTRACT_DIR / "runs"


@lru_cache(maxsize=1)
def load_schema() -> dict:
    """Load and cache the canonical JSON Schema."""
    with SCHEMA_PATH.open("r", encoding="utf-8") as fh:
        return json.load(fh)


@lru_cache(maxsize=1)
def _validator() -> Draft202012Validator:
    # FormatChecker makes the "date-time" format actually enforced (it is advisory otherwise).
    return Draft202012Validator(load_schema(), format_checker=FormatChecker())


def validate_artifact(data: dict) -> None:
    """Validate a plain dict against the contract. Raises jsonschema.ValidationError on failure."""
    _validator().validate(data)


def audit_version_gate(data: dict) -> None:
    """Emitted-shape self-check: the version must match the version-gated shapes.

    v0.5.0+: a scenario carries ``changes`` (the list authority) and NO legacy ``change``; a pre-0.5.0
    scenario carries ``change`` and no ``changes``. v0.6.0: ``meta.demand_profile`` is REQUIRED (and,
    with render_sample, forbidden before 0.6.0). v0.7.0+: ``meta.assignment`` REQUIRED (forbidden
    before). v0.8.0+: scorecard-cell ``range`` allowed (forbidden before). v0.9.0: mandate-grounded
    agents allowed (forbidden before). Baseline runs (no scenario) skip the scenario check.
    Belt-and-suspenders over the schema ``if/then`` gates (and independent of them) so a mis-wrapped
    producer emission fails LOUDLY at write time. Raises ``ValueError`` on mismatch."""
    version = data.get("schema_version")
    meta = data.get("meta", {})
    if version in ("0.6.0", "0.7.0", "0.8.0", "0.9.0"):
        if not meta.get("demand_profile"):
            raise ValueError(f"version-gate: a {version} artifact's meta must declare demand_profile")
    elif "demand_profile" in meta or "render_sample" in meta:
        raise ValueError(
            f"version-gate: a {version} artifact must not carry meta.demand_profile/render_sample "
            "(v0.6.0 fields)"
        )
    if version in ("0.7.0", "0.8.0", "0.9.0"):
        if not meta.get("assignment"):
            raise ValueError(f"version-gate: a {version} artifact's meta must declare assignment "
                             "(day_one vs settled)")
    elif "assignment" in meta:
        raise ValueError(f"version-gate: a {version} artifact must not carry meta.assignment "
                         "(a v0.7.0 field)")
    # v0.8.0+: scorecard-cell range is optional but forbidden BEFORE 0.8.0 (mirror of the schema's
    # pre-0.8.0 gate — presence on an older version means a mis-wrapped emission). NB `not in`, never
    # a literal `!=` against one version — the classic bump trap.
    if version not in ("0.8.0", "0.9.0"):
        for grp in (data.get("scorecard") or {}).get("groups", []):
            for key in ("travel_time_delta", "safety_delta", "access_delta"):
                cell = grp.get(key)
                if isinstance(cell, dict) and "range" in cell:
                    raise ValueError(
                        f"version-gate: a {version} artifact's scorecard cell ({grp.get('group')}.{key}) "
                        "must not carry range (a v0.8.0 field)")
    # v0.9.0: mandate grounding + mandate/citations forbidden before (mirror of the schema's
    # pre-0.9.0 gate). `not in` tuple, never a literal `!=` — extend the tuple on the next bump.
    if version not in ("0.9.0",):
        for a in data.get("agents") or []:
            if a.get("grounding") == "mandate" or "mandate" in a or "citations" in a:
                raise ValueError(
                    f"version-gate: a {version} artifact must not carry mandate-grounded agents "
                    f"(v0.9.0 fields; agent persona={a.get('persona', {}).get('id')!r})")
    scenario = meta.get("scenario")
    if scenario is None:
        return
    has_change = "change" in scenario
    has_changes = "changes" in scenario
    if version in ("0.5.0", "0.6.0", "0.7.0", "0.8.0", "0.9.0"):
        if not has_changes or has_change:
            raise ValueError(
                f"version-gate: a {version} artifact's scenario must carry `changes` (the list authority) "
                f"and NOT the legacy `change` (got change={has_change}, changes={has_changes})"
            )
    else:  # pre-0.5.0
        if not has_change or has_changes:
            raise ValueError(
                f"version-gate: a {version} artifact's scenario must carry the legacy `change` and NOT "
                f"`changes` (got change={has_change}, changes={has_changes})"
            )


def dump_artifact(artifact: TrajectoryArtifact, path: str | Path | None = None) -> Path:
    """Serialize -> validate against the schema -> write JSON. Returns the path written.

    If ``path`` is omitted, writes to ``contract/runs/<run_id>.json``.
    """
    # exclude_none: optional fields (meta.scenario, change.value_mps) are OMITTED when absent rather
    # than emitted as JSON null — the schema types them as object/number, so null would fail validation.
    # by_alias: the v0.4.0 SocialEdge stores `from` as `from_` (a Python keyword) and must emit it as "from".
    data = artifact.model_dump(mode="json", exclude_none=True, by_alias=True)
    validate_artifact(data)  # never write an artifact that violates the frozen contract
    audit_version_gate(data)  # and never write one whose version disagrees with its scenario shape
    out = Path(path) if path is not None else RUNS_DIR / f"{artifact.meta.run_id}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
    return out


def load_artifact(path: str | Path) -> TrajectoryArtifact:
    """Read JSON -> validate against the schema -> parse into the typed model."""
    with Path(path).open("r", encoding="utf-8") as fh:
        data = json.load(fh)
    validate_artifact(data)
    return TrajectoryArtifact.model_validate(data)
