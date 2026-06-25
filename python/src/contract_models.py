"""Typed Python mirror of the frozen trajectory contract (``contract/trajectory_schema.json``).

These pydantic models are the Python side of the Python<->TS boundary. They MUST stay in lockstep
with the JSON Schema; ``trajectory_io`` validates every artifact against the schema file itself, so
this module is the ergonomic/typed view, not the source of truth.

v0.2.0 (additive over v0.1.0): adds optional ``Meta.scenario`` and an optional top-level ``agents``
list. ``vehicles`` is unchanged. v0.1.0 artifacts still load (schema_version accepts both).
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# Current contract version emitted by new runs. The schema also accepts "0.1.0" for back-compat reads.
SCHEMA_VERSION: Literal["0.2.0"] = "0.2.0"

# A single geographic point: [lon, lat] in WGS84.
LonLat = tuple[float, float]


class Change(BaseModel):
    """The proposed infrastructure change. ``value_mps`` is optional (no scalar for e.g. a signal)."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["speed_limit", "add_lane", "remove_lane", "new_signal", "bike_lane", "new_road"]
    target_edge: str
    value_mps: float | None = Field(default=None, ge=0)
    description: str


class Scenario(BaseModel):
    """The scenario a run represents, vs. a baseline run. Absent for plain baseline runs."""

    model_config = ConfigDict(extra="forbid")

    baseline_run_id: str
    change: Change


class Meta(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_id: str
    network: str
    bbox: list[float] = Field(min_length=4, max_length=4, description="[minLon, minLat, maxLon, maxLat]")
    sim_start: float
    sim_end: float
    step_length: float = Field(gt=0)
    created_at: str  # ISO-8601 UTC
    scenario: Scenario | None = None  # v0.2.0+, optional


class Vehicle(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    type: str
    path: list[list[float]] = Field(description="Ordered [lon, lat] points; index-aligned with timestamps/speeds")
    timestamps: list[float]
    speeds: list[float]


class Persona(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    label: str


class Outcome(BaseModel):
    """Quantitative baseline-vs-scenario outcome for one traveler (seconds)."""

    model_config = ConfigDict(extra="forbid")

    baseline_duration: float
    scenario_duration: float
    delta_seconds: float
    baseline_timeloss: float
    scenario_timeloss: float


class Reaction(BaseModel):
    """The persona's anticipated reaction — a PREVIEW of texture/objection, never a verdict."""

    model_config = ConfigDict(extra="forbid")

    comment: str
    sentiment: float = Field(ge=-1, le=1, description="-1 strongly negative .. +1 strongly positive")
    stance: Literal["supportive", "neutral", "opposed"]


class Agent(BaseModel):
    """A sampled persona agent pinned to a specific simulated vehicle (NOT one per vehicle)."""

    model_config = ConfigDict(extra="forbid")

    vehicle_id: str
    persona: Persona
    outcome: Outcome
    reaction: Reaction
    trigger_t: float = Field(ge=0, description="Sim time (s) the reaction is keyed to during playback")


class TrajectoryArtifact(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Accept 0.1.0 on read for back-compat; new artifacts are constructed as SCHEMA_VERSION (0.2.0).
    schema_version: Literal["0.1.0", "0.2.0"] = SCHEMA_VERSION
    meta: Meta
    vehicles: list[Vehicle]
    agents: list[Agent] = Field(default_factory=list)  # v0.2.0+, optional
