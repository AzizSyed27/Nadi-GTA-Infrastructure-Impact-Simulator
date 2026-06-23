"""Typed Python mirror of the frozen trajectory contract (``contract/trajectory_schema.json``).

These pydantic models are the Python side of the Python<->TS boundary. They MUST stay in lockstep
with the JSON Schema; ``trajectory_io`` validates every artifact against the schema file itself, so
this module is the ergonomic/typed view, not the source of truth.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

SCHEMA_VERSION: Literal["0.1.0"] = "0.1.0"

# A single geographic point: [lon, lat] in WGS84.
LonLat = tuple[float, float]


class Meta(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_id: str
    network: str
    bbox: list[float] = Field(min_length=4, max_length=4, description="[minLon, minLat, maxLon, maxLat]")
    sim_start: float
    sim_end: float
    step_length: float = Field(gt=0)
    created_at: str  # ISO-8601 UTC


class Vehicle(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    type: str
    path: list[list[float]] = Field(description="Ordered [lon, lat] points; index-aligned with timestamps/speeds")
    timestamps: list[float]
    speeds: list[float]


class TrajectoryArtifact(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["0.1.0"] = SCHEMA_VERSION
    meta: Meta
    vehicles: list[Vehicle]
