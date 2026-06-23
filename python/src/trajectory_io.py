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


def dump_artifact(artifact: TrajectoryArtifact, path: str | Path | None = None) -> Path:
    """Serialize -> validate against the schema -> write JSON. Returns the path written.

    If ``path`` is omitted, writes to ``contract/runs/<run_id>.json``.
    """
    data = artifact.model_dump(mode="json")
    validate_artifact(data)  # never write an artifact that violates the frozen contract
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
