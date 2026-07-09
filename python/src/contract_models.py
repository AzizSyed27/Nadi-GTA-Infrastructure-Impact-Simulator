"""Typed Python mirror of the frozen trajectory contract (``contract/trajectory_schema.json``).

These pydantic models are the Python side of the Python<->TS boundary. They MUST stay in lockstep
with the JSON Schema; ``trajectory_io`` validates every artifact against the schema file itself, so
this module is the ergonomic/typed view, not the source of truth.

v0.3.0 (additive over v0.2.0): adds optional top-level ``persons`` (pedestrian trajectories),
``conflicts`` (safety surrogates), and ``scorecard`` (per-stakeholder outcome); adds
``Change.target_lane``; adds an agent ``grounding`` discriminator ("sim" vs "inferred") with the
sim/inferred field-presence invariant enforced HERE (the schema stays loose, requiring ``grounding``
only for 0.3.0/0.4.0 artifacts). v0.2.0/v0.1.0 artifacts still load: ``grounding`` defaults to "sim", so a
grounding-less v0.2.0 agent (vehicle_id + outcome + trigger_t) parses and satisfies the invariant.

v0.4.0 (additive over v0.3.0): adds optional ``Persona.mode`` / ``Persona.stakeholder`` (so the frontend
can DERIVE the stakeholder group from the artifact), and an optional top-level ``social`` block — the OASIS
opinion-propagation SECOND graph (graph edges, cascades of events, per-agent opinion trajectories,
argument reach). A PREVIEW, never a verdict. All v0.3.0 artifacts still load.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

# Current contract version emitted by new runs. The schema also accepts "0.1.0".."0.3.0" for back-compat reads.
SCHEMA_VERSION: Literal["0.4.0"] = "0.4.0"

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
    # 5.1: optional GEOMETRY for a new_road (snap to EXISTING junction ids). Schema stays loose; network_edit
    # validates their presence for type "new_road" (a new_road without geometry fails the pipeline, not the
    # schema). For new_road, target_edge is the MINTED new-edge id.
    from_junction: str | None = None
    to_junction: str | None = None
    lanes: int | None = Field(default=None, ge=1)
    speed_mps: float | None = Field(default=None, ge=0)
    bidirectional: bool | None = None


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
    mode: Literal["car", "bicycle", "pedestrian", "inferred"] | None = None  # v0.4.0+, optional
    stakeholder: str | None = None  # v0.4.0+, optional (mainly inferred personas)


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


class ScorecardCell(BaseModel):
    """v0.3.0+. One scorecard cell: a central ``value`` (POSITIVE = worse) plus an OPTIONAL
    ``affected_share`` (fraction of the group adversely affected, 0..1) that conveys CONCENTRATION —
    e.g. a median value near 0 with a high share = concentrated cost, not "no effect". ``confidence``
    (v0.3.0+) flags trust: ``"measured"`` (from the sim) vs ``"low"`` (heuristic/estimate/not-robust),
    with an optional ``note`` (e.g. a materiality cutoff or a robustness caveat). All fields optional &
    nullable so the whole cell can be None (no signal) and ``exclude_none`` stays safe."""

    model_config = ConfigDict(extra="forbid")

    value: float | None = None
    affected_share: float | None = Field(default=None, ge=0, le=1)
    confidence: Literal["measured", "low"] | None = None
    note: str | None = None


class ScorecardGroup(BaseModel):
    """v0.3.0+. One stakeholder group's outcome. Uniform sign: POSITIVE = WORSE for the group.
    Each delta is an optional & nullable ScorecardCell (None = no signal / no trip for this group)."""

    model_config = ConfigDict(extra="forbid")

    group: str
    grounding: Literal["sim", "inferred"]
    travel_time_delta: ScorecardCell | None = None
    safety_delta: ScorecardCell | None = None
    access_delta: ScorecardCell | None = None


class Scorecard(BaseModel):
    """v0.3.0+. Per-STAKEHOLDER outcome summary (who wins/loses per group), NOT a single ROI.
    ``bca`` is deliberately unshaped (under-constrained) — 2.4 defines it."""

    model_config = ConfigDict(extra="forbid")

    groups: list[ScorecardGroup]
    bca: dict | None = None


# ---- v0.4.0: the OASIS social-opinion-propagation block (the SECOND graph, NOT the report GraphRAG) ----
# Agent keys throughout use the frontend agentId convention: vehicle_id ?? person_id ?? persona.id.

class SocialEdge(BaseModel):
    """One social-graph edge. ``from`` is a Python keyword, so it is stored as ``from_`` with a wire alias —
    dump_artifact serializes with by_alias=True so it emits/reads "from"."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    from_: str = Field(alias="from")
    to: str
    kind: Literal["homophily", "geography", "cross"]


class SocialGraph(BaseModel):
    model_config = ConfigDict(extra="forbid")

    edges: list[SocialEdge] = Field(default_factory=list)


class SocialEvent(BaseModel):
    """One social action in a cascade step. ``content`` optional (likes carry none). ``exposed_via`` = how the
    actor came to see the target (follow edge vs recommender); None = origin/unprompted. ``audit_status``
    'excluded' = removed from the clean corpus by the immutability/audit guard (kept for provenance)."""

    model_config = ConfigDict(extra="forbid")

    agent: str
    action: Literal["post", "comment", "like", "repost", "follow"]
    target_agent: str | None = None
    target_post: str | None = None
    content: str | None = None
    exposed_via: Literal["follow", "recsys"] | None = None
    audit_status: Literal["clean", "excluded"]
    # v0.4.0 additive: when 'excluded', the audit-rule names that excluded it (per-rule provenance in-data).
    excluded_by: list[str] | None = None


class CascadeStep(BaseModel):
    model_config = ConfigDict(extra="forbid")

    step: int = Field(ge=0)
    events: list[SocialEvent] = Field(default_factory=list)


class Cascade(BaseModel):
    model_config = ConfigDict(extra="forbid")

    cascade_id: str
    steps: list[CascadeStep] = Field(default_factory=list)


class TrajectoryPoint(BaseModel):
    model_config = ConfigDict(extra="forbid")

    step: int = Field(ge=0)
    stance: Literal["supportive", "neutral", "opposed"]
    sentiment: float | None = Field(default=None, ge=-1, le=1)


class OpinionTrajectory(BaseModel):
    """Per-agent opinion movement over cascade steps — the MOVEMENT, not just final state."""

    model_config = ConfigDict(extra="forbid")

    agent: str
    derived_by: Literal["stance_scoring"] | None = None
    # v0.4.0 additive: which cascade this trajectory is scored over (absent = the reference cascade, so the
    # frozen sample stays valid). Lets divergence be shown per-cascade without a version bump.
    cascade_id: str | None = None
    points: list[TrajectoryPoint] = Field(default_factory=list)
    shifted: bool | None = None
    influenced_by: list[str] = Field(default_factory=list)


class ArgumentReach(BaseModel):
    model_config = ConfigDict(extra="forbid")

    argument: str
    cascade_id: str
    reached: int = Field(ge=0)
    # v0.4.0 additive: clean posts making this argument. reached/post_count = actions-per-post, which exposes
    # the volume-confound (engaged-reach partly tracks how much an argument was POSTED, not just its pull).
    post_count: int | None = Field(default=None, ge=0)


class Social(BaseModel):
    """v0.4.0+. Opinion propagation over a social graph (OASIS). A PREVIEW of who shifts whom, never a verdict."""

    model_config = ConfigDict(extra="forbid")

    mechanism: Literal["oasis", "neighbor_pass"]
    graph: SocialGraph | None = None
    cascades: list[Cascade] = Field(default_factory=list)
    trajectories: list[OpinionTrajectory] = Field(default_factory=list)
    argument_reach: list[ArgumentReach] = Field(default_factory=list)
    excluded_count: int | None = Field(default=None, ge=0)


class TrajectoryArtifact(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Accept 0.1.0..0.3.0 on read for back-compat; new artifacts are constructed as SCHEMA_VERSION (0.4.0).
    schema_version: Literal["0.1.0", "0.2.0", "0.3.0", "0.4.0"] = SCHEMA_VERSION
    meta: Meta
    vehicles: list[Vehicle]
    persons: list[Person] = Field(default_factory=list)  # v0.3.0+, optional
    agents: list[Agent] = Field(default_factory=list)  # v0.2.0+, optional
    conflicts: list[Conflict] = Field(default_factory=list)  # v0.3.0+, optional
    scorecard: Scorecard | None = None  # v0.3.0+, optional
    social: Social | None = None  # v0.4.0+, optional
