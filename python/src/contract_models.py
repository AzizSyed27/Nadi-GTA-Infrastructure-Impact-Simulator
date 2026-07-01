"""Typed Python mirror of the frozen trajectory contract (``contract/trajectory_schema.json``).

These pydantic models are the Python side of the Python<->TS boundary. They MUST stay in lockstep
with the JSON Schema; ``trajectory_io`` validates every artifact against the schema file itself, so
this module is the ergonomic/typed view, not the source of truth.

v0.3.0 (additive over v0.2.0): adds optional top-level ``persons`` (pedestrian trajectories),
``conflicts`` (safety surrogates), and ``scorecard`` (per-stakeholder outcome); adds
``Change.target_lane``; adds an agent ``grounding`` discriminator ("sim" vs "inferred") with the
sim/inferred field-presence invariant enforced HERE (the schema stays loose, requiring ``grounding``
only for 0.3.0 artifacts). v0.2.0/v0.1.0 artifacts still load: ``grounding`` defaults to "sim", so a
grounding-less v0.2.0 agent (vehicle_id + outcome + trigger_t) parses and satisfies the invariant.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

# Current contract version emitted by new runs. The schema also accepts "0.1.0"/"0.2.0" for back-compat reads.
SCHEMA_VERSION: Literal["0.3.0"] = "0.3.0"

# A single geographic point: [lon, lat] in WGS84.
LonLat = tuple[float, float]


class Change(BaseModel):
    """The proposed infrastructure change. ``value_mps`` is optional (no scalar for e.g. a signal);
    ``target_lane`` (v0.3.0+) is optional (a lane index, e.g. the car lane converted to a bike lane)."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["speed_limit", "add_lane", "remove_lane", "new_signal", "bike_lane", "new_road"]
    target_edge: str
    target_lane: int | None = None  # v0.3.0+, optional (lane-scoped changes like bike_lane)
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
    """A vehicle trajectory. ``type`` is a free string: "car" or (v0.3.0+) "bicycle"."""

    model_config = ConfigDict(extra="forbid")

    id: str
    type: str
    path: list[list[float]] = Field(description="Ordered [lon, lat] points; index-aligned with timestamps/speeds")
    timestamps: list[float]
    speeds: list[float]


class Person(BaseModel):
    """v0.3.0+. A pedestrian trajectory — SAME per-entity shape as Vehicle, distinct population.
    ``type`` is a free string; pedestrians use "pedestrian"."""

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
    """A sampled stakeholder agent (NOT one per traveler). ``grounding`` (v0.3.0+) discriminates:
      - "sim":      pinned to a simulated traveler — exactly one of vehicle_id/person_id, plus outcome
                    and trigger_t.
      - "inferred": no simulated trip (a resident/business voice) — no pin, no outcome, no trigger_t.
    Schema stays loose (grounding required only for 0.3.0); this invariant is enforced in the model."""

    model_config = ConfigDict(extra="forbid")

    persona: Persona
    reaction: Reaction
    grounding: Literal["sim", "inferred"] = "sim"  # default keeps grounding-less v0.2.0 agents loadable
    vehicle_id: str | None = None
    person_id: str | None = None
    outcome: Outcome | None = None
    trigger_t: float | None = Field(default=None, ge=0, description="Sim time (s) the reaction is keyed to")

    @model_validator(mode="after")
    def _check_grounding(self) -> "Agent":
        pinned = [x for x in (self.vehicle_id, self.person_id) if x is not None]
        if self.grounding == "sim":
            if len(pinned) != 1:
                raise ValueError("sim-grounded agent requires exactly one of vehicle_id / person_id")
            if self.outcome is None or self.trigger_t is None:
                raise ValueError("sim-grounded agent requires both outcome and trigger_t")
        else:  # inferred
            if pinned or self.outcome is not None or self.trigger_t is not None:
                raise ValueError(
                    "inferred agent must NOT have vehicle_id/person_id/outcome/trigger_t"
                )
        return self


class Conflict(BaseModel):
    """v0.3.0+. A safety-SURROGATE event computed from trajectories (never a crash prediction).
    Deliberately under-constrained; 2.4 tightens."""

    model_config = ConfigDict(extra="forbid")

    t: float
    lon: float
    lat: float
    type: str
    severity: float  # uniform convention: higher = worse
    ttc: float | None = None
    pet: float | None = None
    entities: list[str] | None = None


class ScorecardGroup(BaseModel):
    """v0.3.0+. One stakeholder group's outcome. Uniform sign: POSITIVE = WORSE for the group.
    Deltas are optional & nullable (None = absent = no signal / no trip for this group)."""

    model_config = ConfigDict(extra="forbid")

    group: str
    grounding: Literal["sim", "inferred"]
    travel_time_delta: float | None = None
    safety_delta: float | None = None
    access_delta: float | None = None


class Scorecard(BaseModel):
    """v0.3.0+. Per-STAKEHOLDER outcome summary (who wins/loses per group), NOT a single ROI.
    ``bca`` is deliberately unshaped (under-constrained) — 2.4 defines it."""

    model_config = ConfigDict(extra="forbid")

    groups: list[ScorecardGroup]
    bca: dict | None = None


class TrajectoryArtifact(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Accept 0.1.0/0.2.0 on read for back-compat; new artifacts are constructed as SCHEMA_VERSION (0.3.0).
    schema_version: Literal["0.1.0", "0.2.0", "0.3.0"] = SCHEMA_VERSION
    meta: Meta
    vehicles: list[Vehicle]
    persons: list[Person] = Field(default_factory=list)  # v0.3.0+, optional
    agents: list[Agent] = Field(default_factory=list)  # v0.2.0+, optional
    conflicts: list[Conflict] = Field(default_factory=list)  # v0.3.0+, optional
    scorecard: Scorecard | None = None  # v0.3.0+, optional
