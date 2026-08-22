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

import math
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# Current contract version emitted by new runs. The schema also accepts "0.1.0".."0.9.0" for back-compat reads.
SCHEMA_VERSION: Literal["0.10.0"] = "0.10.0"

# Versions that may carry mandate-grounded agents (v0.9.0+). EXTEND this tuple on every future bump —
# a literal `== "0.9.0"` at a consumer is the classic enum-plus-gates trap (it would silently disable
# the institutional surfaces, or crash the enrich, the moment SCHEMA_VERSION moves past 0.9.0).
# Review-caught; the TS mirror is web/lib/types.ts MANDATE_VERSIONS.
MANDATE_VERSIONS: tuple[str, ...] = ("0.9.0", "0.10.0")

# V2.6c — versions whose trajectories use the 0.10.0 payload encoding (per-entity EITHER-shape
# timestamps, speeds dropped). EXTEND on every future bump — the MANDATE_VERSIONS convention.
COMPACT_TRAJECTORY_VERSIONS: tuple[str, ...] = ("0.10.0",)

# The compact-eligibility comparison rule — SINGLE SOURCE for both languages (the TS twin
# web/lib/compactTime.ts carries the same literal + the same closed-form formula;
# lockstep-pinned by test_compact_rule_lockstep_with_ts). The write-time check and every reader
# use the SAME `t0 + i * dt` comparison within this eps — never incremental accumulation (float
# drift over ~1800 steps) and never a different tolerance per side (an exact-write/tolerant-read
# divergence would let an entity pass write and misread).
COMPACT_DT_EPS = 1e-6

# V2.6c/D6c — coordinate precision applied at RECORD time (~11 cm). Rounding lives in the
# WRITERS, never in dump_artifact (committed older samples must round-trip byte-identically).
COORD_DECIMALS = 6


def compact_encoding(timestamps: list[float], step_length: float) -> tuple[float, float] | None:
    """(t0, dt) iff the series is EXACTLY regular under the closed-form rule; None = keep the
    explicit array. This IS the write-time regularity check: teleport-gapped entities keep their
    TRUE holes (lossless by construction — positions are never fabricated through a gap)."""
    n = len(timestamps)
    if n == 0:
        return None
    t0 = timestamps[0]
    if n == 1:
        return (t0, float(step_length))
    dt = timestamps[1] - t0
    if dt <= 0:
        return None
    for i, t in enumerate(timestamps):
        if abs(t - (t0 + i * dt)) > COMPACT_DT_EPS:
            return None
    return (t0, dt)


def expand_timestamps(t0: float, dt: float, n: int) -> list[float]:
    """The reader's reconstruction — the SAME closed form the eligibility check compared against."""
    return [t0 + i * dt for i in range(n)]


def encode_trajectory_fields(timestamps: list[float], step_length: float) -> dict:
    """Builder helper (D6b): one entity's wire time-fields — compact when eligible, else explicit."""
    enc = compact_encoding(timestamps, step_length)
    if enc is None:
        return {"timestamps": timestamps}
    return {"t0": enc[0], "dt": enc[1]}


# A single geographic point: [lon, lat] in WGS84.
LonLat = tuple[float, float]


class Window(BaseModel):
    """v0.5.0+. A time window in simulation seconds a change is active. Absent = active the whole run.
    ``end_s > start_s`` is a semantic invariant enforced HERE (the schema stays loose)."""

    model_config = ConfigDict(extra="forbid")

    start_s: float
    end_s: float

    @model_validator(mode="after")
    def _check_window(self) -> "Window":
        if self.end_s <= self.start_s:
            raise ValueError("window.end_s must be > start_s")
        return self


class Effect(BaseModel):
    """v0.5.0+. A partial/incident effect on the target: a multiplicative speed factor and/or a hard block."""

    model_config = ConfigDict(extra="forbid")

    speed_factor: float | None = Field(default=None, ge=0)
    blocked: bool | None = None


def parse_via_item(item: str) -> tuple[float, float]:
    """V2.6d STRICT parse of one new_road.via item — the only gate between a malformed via and
    netconvert (the schema stays loose: array of string). Exactly two comma-separated finite
    floats, lon then lat. Raises ValueError with a plain sentence — the POST 400 and the harness
    SystemExit render it verbatim. A lat/lon SWAP parses here by design; the bbox-containment
    geometry rule (network_edit) catches it with the study-area sentence."""
    parts = item.split(",")
    if len(parts) != 2:
        raise ValueError(f"via item {item!r} must be 'lon,lat' — exactly two comma-separated "
                         f"numbers (got {len(parts)})")
    try:
        lon, lat = float(parts[0]), float(parts[1])
    except ValueError:
        bad = next(p for p in parts if not _is_float(p))
        raise ValueError(f"via item {item!r} must be 'lon,lat' — {bad.strip()!r} is not a number") from None
    if not (math.isfinite(lon) and math.isfinite(lat)):
        raise ValueError(f"via item {item!r} must be two finite numbers")
    return (lon, lat)


def _is_float(s: str) -> bool:
    try:
        float(s)
    except ValueError:
        return False
    return True


class Change(BaseModel):
    """The proposed infrastructure change. ``value_mps`` is optional (no scalar for e.g. a signal);
    ``target_lane`` (v0.3.0+) is optional (a lane index, e.g. the car lane converted to a bike lane).
    v0.5.0 adds ``window`` / ``target_lanes`` / ``effect`` / ``position_m`` (all optional) and the types
    ``lane_closure`` / ``road_closure`` / ``incident``. Semantic invariants (incident⇒window,
    lane_closure⇒target_lanes) are enforced HERE; network validity of a closure is left to the pipeline
    (a closure MAY sever — legitimate, unlike new_road's additive rule)."""

    model_config = ConfigDict(extra="forbid")

    type: Literal[
        "speed_limit", "add_lane", "remove_lane", "new_signal", "bike_lane", "new_road",
        "lane_closure", "road_closure", "incident",
    ]
    target_edge: str
    target_lane: int | None = None  # v0.3.0+, optional (lane-scoped changes like bike_lane)
    target_lanes: list[int] | None = None  # v0.5.0+, optional (lane-scoped, e.g. "close 2 of 4")
    value_mps: float | None = Field(default=None, ge=0)
    window: Window | None = None  # v0.5.0+, optional (absent = active whole run)
    effect: Effect | None = None  # v0.5.0+, optional (incident/partial effects)
    position_m: float | None = None  # v0.5.0+, optional (along-edge location, e.g. an incident)
    description: str
    # 5.1: optional GEOMETRY for a new_road (snap to EXISTING junction ids). Schema stays loose; network_edit
    # validates their presence for type "new_road" (a new_road without geometry fails the pipeline, not the
    # schema). For new_road, target_edge is the MINTED new-edge id.
    from_junction: str | None = None
    to_junction: str | None = None
    lanes: int | None = Field(default=None, ge=1)
    speed_mps: float | None = Field(default=None, ge=0)
    bidirectional: bool | None = None
    # V2.6d RECORDED DECISION: via carries 'lon,lat' COORDINATE-PAIR strings, NOT junction ids,
    # despite list[str] — 0.10.0 shipped via capacity-only (no producer ever emitted a
    # junction-id via), so coordinate semantics is the field's FIRST meaning, arriving when
    # V2.6d consumed the capacity; a 0.11.0 bump to list[list[float]] was deliberately declined
    # (a full contract ceremony for one field's type honesty). Strict parse = parse_via_item
    # (field-validated below); the geometry rules (cap / min-segment / self-intersection / bbox)
    # live in network_edit. Via points are SHAPE geometry, not junctions — nothing can connect
    # mid-curve. The SAME decision comment rides the schema description and web/lib/types.ts
    # (all three mirrors — a reader may hit any one first).
    via: list[str] | None = None

    @field_validator("via")
    @classmethod
    def _via_items_parse(cls, v: list[str] | None) -> list[str] | None:
        # Construction-time only — this model sets no validate_assignment, so tests must build
        # via kwargs, never assign after construction.
        if v:
            for item in v:
                parse_via_item(item)
        return v

    @model_validator(mode="after")
    def _check_semantics(self) -> "Change":
        # v0.5.0 semantic invariants (schema stays loose; these live in the model).
        if self.type == "incident" and self.window is None:
            raise ValueError("incident change requires a window")
        if self.type == "lane_closure" and not self.target_lanes:
            raise ValueError("lane_closure change requires target_lanes")
        return self


class Scenario(BaseModel):
    """The scenario a run represents, vs. a baseline run. Absent for plain baseline runs.

    v0.5.0: ``changes`` is the authority (a scenario may compose several changes); pre-0.5.0 artifacts
    carry the single legacy ``change``. Both are OPTIONAL on the model — the schema version-gate requires
    the right one per ``schema_version``, and ``changes_of`` normalizes either shape to a list. Read
    changes via ``changes_of(artifact)``, never ``.change`` directly."""

    model_config = ConfigDict(extra="forbid")

    baseline_run_id: str
    change: Change | None = None  # legacy single change (pre-0.5.0)
    changes: list[Change] | None = None  # v0.5.0+, the list authority
    tags: list[str] | None = None  # v0.5.0+, optional free-text scenario tags


class Assignment(BaseModel):
    """v0.7.0+. The traffic-assignment mode this run represents. day_one = today's route habits (all
    other fields null). settled = iterated assignment (duaIterate meso + micro final) until travel
    times stabilized. HONESTY-CRITICAL scope: the meso model iterates ONLY car routes — bikes/peds keep
    their fixed day-one routes — so a settled run's pedestrian scorecard row reflects UNadapted
    pedestrian behavior; without scope on the wire, a consumer reading that row would overstate what
    "settled" covers. scope is 'cars_only' (extensible Literal) on settled runs, None on day_one."""

    model_config = ConfigDict(extra="forbid")

    mode: Literal["day_one", "settled"]
    scope: Literal["cars_only"] | None = None
    iterations: int | None = Field(default=None, ge=0)
    relative_deviation: float | None = Field(default=None, ge=0)
    converged: bool | None = None
    engine: Literal["duaIterate_meso"] | None = None

    @model_validator(mode="after")
    def _check_scope(self) -> "Assignment":
        if self.mode == "settled" and self.scope is None:
            raise ValueError("assignment: a settled run must declare its scope (e.g. 'cars_only')")
        if self.mode == "day_one" and self.scope is not None:
            raise ValueError("assignment: a day_one run carries no settling scope")
        return self


class RenderSample(BaseModel):
    """v0.6.0+. Present ONLY when vehicles[]/persons[] are capped to a stratified render sample;
    outcomes/conflicts/scorecard stay full-population. rendered <= total per population."""

    model_config = ConfigDict(extra="forbid")

    strategy: Literal["outcome_stratified"]
    rendered_vehicles: int = Field(ge=0)
    total_vehicles: int = Field(ge=0)
    rendered_persons: int = Field(ge=0)
    total_persons: int = Field(ge=0)

    @model_validator(mode="after")
    def _check_bounds(self) -> "RenderSample":
        if self.rendered_vehicles > self.total_vehicles:
            raise ValueError("render_sample: rendered_vehicles exceeds total_vehicles")
        if self.rendered_persons > self.total_persons:
            raise ValueError("render_sample: rendered_persons exceeds total_persons")
        return self


class Meta(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_id: str
    network: str
    bbox: list[float] = Field(min_length=4, max_length=4, description="[minLon, minLat, maxLon, maxLat]")
    sim_start: float
    sim_end: float
    step_length: float = Field(gt=0)
    created_at: str  # ISO-8601 UTC
    # v0.6.0: REQUIRED at 0.6.0 (forbidden before) — which demand the run simulated. Optional on the
    # model for back-compat reads; the schema gate + audit_version_gate enforce presence per version.
    demand_profile: Literal["synthetic_demo", "calibrated_am_peak"] | None = None
    # v0.7.0: REQUIRED at 0.7.0 (forbidden before) — day-one vs settled assignment. Optional on the
    # model for back-compat reads; the schema gate + audit_version_gate enforce presence per version.
    assignment: Assignment | None = None
    render_sample: RenderSample | None = None  # v0.6.0+, optional (capped artifacts only)
    scenario: Scenario | None = None  # v0.2.0+, optional


def _entity_shape_error(t0: float | None, dt: float | None, timestamps: list[float] | None) -> str | None:
    """V2.6c per-entity shape rule (version-FREE half; version coherence lives on the artifact):
    {t0, dt} come as a pair, compact XOR explicit, at least one time shape present."""
    if (t0 is None) != (dt is None):
        return "t0 and dt come as a pair"
    if t0 is not None and timestamps is not None:
        return "compact {t0, dt} and explicit timestamps are exclusive (XOR)"
    if t0 is None and timestamps is None:
        return "an entity needs timestamps or {t0, dt}"
    return None


class Vehicle(BaseModel):
    """A vehicle trajectory. ``type`` is a free string: "car" or (v0.3.0+) "bicycle".
    v0.10.0: EITHER compact ``{t0, dt}`` (regular cadence, write-time-checked) XOR an explicit
    ``timestamps`` array (teleport-gapped entities keep TRUE holes); ``speeds`` is DROPPED.
    Pre-0.10.0 artifacts carry the two index-aligned arrays; version coherence is enforced at
    the artifact level."""

    model_config = ConfigDict(extra="forbid")

    id: str
    type: str
    path: list[list[float]] = Field(description="Ordered [lon, lat] points; index-aligned with the time series")
    timestamps: list[float] | None = None
    speeds: list[float] | None = None
    t0: float | None = None  # v0.10.0 compact: sim time (s) of path[0]
    dt: float | None = Field(default=None, gt=0)  # v0.10.0 compact: the regular step (s)

    @model_validator(mode="after")
    def _check_shape(self) -> "Vehicle":
        err = _entity_shape_error(self.t0, self.dt, self.timestamps)
        if err:
            raise ValueError(f"vehicle {self.id!r}: {err}")
        if self.t0 is not None and self.speeds is not None:
            raise ValueError(f"vehicle {self.id!r}: a compact entity cannot carry speeds")
        return self

    def timestamps_of(self) -> list[float]:
        """The uniform explicit view under either shape — the reader's single formula."""
        if self.timestamps is not None:
            return self.timestamps
        return expand_timestamps(self.t0, self.dt, len(self.path))  # type: ignore[arg-type]


class Person(BaseModel):
    """v0.3.0+. A pedestrian trajectory — SAME per-entity shape as Vehicle, distinct population.
    ``type`` is a free string; pedestrians use "pedestrian". v0.10.0 shape rules as Vehicle."""

    model_config = ConfigDict(extra="forbid")

    id: str
    type: str
    path: list[list[float]] = Field(description="Ordered [lon, lat] points; index-aligned with the time series")
    timestamps: list[float] | None = None
    speeds: list[float] | None = None
    t0: float | None = None  # v0.10.0 compact: sim time (s) of path[0]
    dt: float | None = Field(default=None, gt=0)  # v0.10.0 compact: the regular step (s)

    @model_validator(mode="after")
    def _check_shape(self) -> "Person":
        err = _entity_shape_error(self.t0, self.dt, self.timestamps)
        if err:
            raise ValueError(f"person {self.id!r}: {err}")
        if self.t0 is not None and self.speeds is not None:
            raise ValueError(f"person {self.id!r}: a compact entity cannot carry speeds")
        return self

    def timestamps_of(self) -> list[float]:
        """The uniform explicit view under either shape — the reader's single formula."""
        if self.timestamps is not None:
            return self.timestamps
        return expand_timestamps(self.t0, self.dt, len(self.path))  # type: ignore[arg-type]


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


class Mandate(BaseModel):
    """v0.9.0+. An institution's PUBLISHED mandate, quoted verbatim from a sourced page. ``mission``
    is NEVER reworded, truncated, or LLM-touched anywhere in the pipeline — for a real organization,
    paraphrase is misrepresentation (byte-identity test-pinned). ``retrieved`` is the reader's
    freshness signal and renders wherever the mandate renders."""

    model_config = ConfigDict(extra="forbid")

    institution: str
    mission: str
    source: str
    retrieved: str


class Citation(BaseModel):
    """v0.9.0+. One computed fact a mandate voice cites: ``key`` = the outcomes-sidecar fact key,
    ``text`` = the code-rendered fact sentence(s), ``notes`` = the verbatim honesty sentences that
    ride wherever the numbers render (e.g. the free-flow/lower-bound framing on the response detour)."""

    model_config = ConfigDict(extra="forbid")

    key: str
    text: str
    notes: list[str] | None = None


class Agent(BaseModel):
    """A sampled stakeholder agent (NOT one per traveler). ``grounding`` (v0.3.0+) discriminates:
      - "sim":      pinned to a simulated traveler — exactly one of vehicle_id/person_id, plus outcome
                    and trigger_t.
      - "inferred": no simulated trip (a resident/business voice) — no pin, no outcome, no trigger_t.
      - "mandate":  (v0.9.0+) an institutional voice — a sourced published mandate + citations of this
                    run's code-rendered facts; no pin/outcome/trigger_t; sentiment 0 and stance neutral
                    (institutions recite facts within mandate, never stances — the referendum guard at
                    the contract layer).
    Schema stays loose (grounding required only for 0.3.0+); these invariants are enforced in the model."""

    model_config = ConfigDict(extra="forbid")

    persona: Persona
    reaction: Reaction
    grounding: Literal["sim", "inferred", "mandate"] = "sim"  # default keeps grounding-less v0.2.0 agents loadable
    vehicle_id: str | None = None
    person_id: str | None = None
    outcome: Outcome | None = None
    trigger_t: float | None = Field(default=None, ge=0, description="Sim time (s) the reaction is keyed to")
    mandate: Mandate | None = None  # v0.9.0+, mandate agents only
    citations: list[Citation] | None = None  # v0.9.0+, mandate agents only

    @model_validator(mode="after")
    def _check_grounding(self) -> "Agent":
        pinned = [x for x in (self.vehicle_id, self.person_id) if x is not None]
        if self.grounding == "sim":
            if len(pinned) != 1:
                raise ValueError("sim-grounded agent requires exactly one of vehicle_id / person_id")
            if self.outcome is None or self.trigger_t is None:
                raise ValueError("sim-grounded agent requires both outcome and trigger_t")
        elif self.grounding == "mandate":
            if pinned or self.outcome is not None or self.trigger_t is not None:
                raise ValueError("mandate agent must NOT have vehicle_id/person_id/outcome/trigger_t")
            if self.mandate is None:
                raise ValueError("mandate agent requires the mandate block")
            if not self.citations:
                raise ValueError("mandate agent requires non-empty citations (no facts -> no voice)")
            if self.reaction.sentiment != 0.0 or self.reaction.stance != "neutral":
                raise ValueError(
                    "mandate agent must have sentiment 0.0 and stance 'neutral' — institutions "
                    "recite facts within mandate, never stances"
                )
        else:  # inferred
            if pinned or self.outcome is not None or self.trigger_t is not None:
                raise ValueError(
                    "inferred agent must NOT have vehicle_id/person_id/outcome/trigger_t"
                )
        if self.grounding != "mandate" and (self.mandate is not None or self.citations is not None):
            raise ValueError("mandate/citations are mandate-grounding fields only")
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


class CellRange(BaseModel):
    """v0.8.0+. Cross-seed robustness for one cell: [min, max] over the per-seed cell values (the
    seed-42 canonical value INCLUDED), n_seeds >= 2, and sign_stable=False iff the values STRICTLY
    straddle zero (min < 0 < max — a zero endpoint does not flip it). Deliberately NO cross-seed
    central aggregate: seed 42 IS the artifact (V1 robustness convention); probes contribute only
    this range. sign_stable exists ONLY here — a stability read on a rangeless cell is an
    attribute-error-by-construction, so consumers must guard on ``cell.range is not None``."""

    model_config = ConfigDict(extra="forbid")

    min: float
    max: float
    n_seeds: int = Field(ge=2)
    sign_stable: bool

    @model_validator(mode="after")
    def _check_bounds(self) -> CellRange:
        if self.min > self.max:
            raise ValueError("range.min must be <= range.max")
        return self


class ScorecardCell(BaseModel):
    """v0.3.0+. One scorecard cell: a central ``value`` (POSITIVE = worse) plus an OPTIONAL
    ``affected_share`` (fraction of the group adversely affected, 0..1) that conveys CONCENTRATION —
    e.g. a median value near 0 with a high share = concentrated cost, not "no effect". ``confidence``
    (v0.3.0+) flags trust: ``"measured"`` (from the sim) vs ``"low"`` (heuristic/estimate/not-robust),
    with an optional ``note`` (e.g. a materiality cutoff or a robustness caveat). All fields optional &
    nullable so the whole cell can be None (no signal) and ``exclude_none`` stays safe.
    v0.8.0 adds the optional ``range`` (cross-seed robustness; forbidden pre-0.8.0)."""

    model_config = ConfigDict(extra="forbid")

    value: float | None = None
    affected_share: float | None = Field(default=None, ge=0, le=1)
    confidence: Literal["measured", "low"] | None = None
    note: str | None = None
    range: CellRange | None = None

    @model_validator(mode="after")
    def _value_within_range(self) -> ScorecardCell:
        # The canonical value must lie inside its own cross-seed range. The aggregator computes
        # min/max over 3dp-rounded per-seed values (canonical included), so this holds EXACTLY.
        if self.range is not None and self.value is not None:
            if not (self.range.min <= self.value <= self.range.max):
                raise ValueError(
                    f"cell value {self.value} lies outside its cross-seed range "
                    f"[{self.range.min}, {self.range.max}]")
        return self


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

    # Accept 0.1.0..0.9.0 on read for back-compat; new artifacts are constructed as SCHEMA_VERSION.
    schema_version: Literal[
        "0.1.0", "0.2.0", "0.3.0", "0.4.0", "0.5.0", "0.6.0", "0.7.0", "0.8.0", "0.9.0", "0.10.0"
    ] = SCHEMA_VERSION
    meta: Meta
    vehicles: list[Vehicle]
    persons: list[Person] = Field(default_factory=list)  # v0.3.0+, optional
    agents: list[Agent] = Field(default_factory=list)  # v0.2.0+, optional
    conflicts: list[Conflict] = Field(default_factory=list)  # v0.3.0+, optional
    scorecard: Scorecard | None = None  # v0.3.0+, optional
    social: Social | None = None  # v0.4.0+, optional

    @model_validator(mode="after")
    def _check_trajectory_encoding_version(self) -> "TrajectoryArtifact":
        # V2.6c version-shape coherence (the model half; schema gates J/K + audit_version_gate
        # mirror it): 0.10.0 entities never carry speeds; pre-0.10.0 entities carry BOTH arrays
        # and never the compact fields. Keyed on COMPACT_TRAJECTORY_VERSIONS, never a literal.
        compact_era = self.schema_version in COMPACT_TRAJECTORY_VERSIONS
        for e in (*self.vehicles, *self.persons):
            if compact_era:
                if e.speeds is not None:
                    raise ValueError(
                        f"{self.schema_version} entity {e.id!r} carries speeds (dropped at v0.10.0)")
            else:
                if e.t0 is not None or e.dt is not None:
                    raise ValueError(
                        f"{self.schema_version} entity {e.id!r} carries compact t0/dt (v0.10.0 fields)")
                if e.timestamps is None or e.speeds is None:
                    raise ValueError(
                        f"{self.schema_version} entity {e.id!r} must carry timestamps + speeds")
        return self


# ---- v0.5.0: the change-list accessor (the migration mechanic) ----
# A scenario carries EITHER a legacy single `change` (pre-0.5.0) OR a `changes` list (0.5.0+). Every consumer
# reads the NORMALIZED list via these accessors — never `.change` directly — so a single-change artifact flows
# through as a list of one and both shapes are handled uniformly.

def changes_of(artifact: "TrajectoryArtifact") -> list[Change]:
    """Normalize a (typed) artifact's scenario change(s) to a list. Baseline runs (no scenario) → []."""
    sc = artifact.meta.scenario
    if sc is None:
        return []
    if sc.changes is not None:
        return sc.changes
    if sc.change is not None:
        return [sc.change]
    return []


def changes_of_scenario(scenario: dict) -> list[dict]:
    """Raw-dict twin of ``changes_of`` for consumers that operate on the un-parsed artifact dict
    (e.g. scorecard.py). ``scenario.get("changes") or [scenario["change"]]``."""
    changes = scenario.get("changes")
    if changes:
        return changes
    change = scenario.get("change")
    return [change] if change is not None else []
