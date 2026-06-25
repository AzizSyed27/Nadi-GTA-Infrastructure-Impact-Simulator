"""Car-commuter persona archetypes for the stakeholder-reaction layer.

The persona SET is data (``personas.json``) so Phase 2 can expand or replace it without code changes.
``PersonaSpec`` is the rich, internal view (carries the ``description`` used to build the Step-1.4 LLM
prompt and a ``delay_sensitivity`` weight). It is DISTINCT from ``contract_models.Persona``, which is
the trimmed ``{id, label}`` actually written into the frozen trajectory contract's ``agents[]``.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field

PERSONAS_PATH = Path(__file__).resolve().parent / "personas.json"


class PersonaSpec(BaseModel):
    """One persona archetype. ``description`` feeds the LLM prompt; ``delay_sensitivity`` ∈ [0,1]."""

    model_config = ConfigDict(extra="forbid")

    id: str
    label: str
    description: str
    delay_sensitivity: float = Field(ge=0.0, le=1.0)


@lru_cache(maxsize=1)
def load_personas() -> list[PersonaSpec]:
    """Load and cache the persona set from ``personas.json`` (preserves file order)."""
    data = json.loads(PERSONAS_PATH.read_text(encoding="utf-8"))
    personas = [PersonaSpec.model_validate(p) for p in data["personas"]]
    if not personas:
        raise RuntimeError(f"no personas defined in {PERSONAS_PATH}")
    return personas
