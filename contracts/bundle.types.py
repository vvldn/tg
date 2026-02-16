"""
Pydantic models for the Monument Bundle schema.
Used by the onboarding pipeline to validate bundle output.

Source of truth: contracts/bundle.schema.json
DO NOT modify these models without updating the schema first.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field, field_validator


# --- Primitives ---


class LatLng(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


# --- Story ---


class StoryType(str, Enum):
    HISTORY = "history"
    ARCHITECTURE = "architecture"
    LEGEND = "legend"
    ANECDOTE = "anecdote"


class Story(BaseModel):
    title: str
    narration_text: str
    type: StoryType
    duration_seconds: int | None = None
    sources: list[str] | None = None


# --- Spot ---


class Spot(BaseModel):
    id: str = Field(pattern=r"^[a-z0-9-]+$")
    name: str
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    narration_order: int = Field(ge=1)
    walking_from_previous: str | None = None
    walking_seconds_from_previous: int = 0
    narration_text: str = Field(min_length=50)
    narration_duration_seconds: int
    stories: list[Story] = Field(default_factory=list)
    architectural_notes: str | None = None
    visual_anchors: list[str] = Field(default_factory=list)
    visitor_context: str | None = None


# --- Monument ---


class Monument(BaseModel):
    id: str = Field(pattern=r"^[a-z0-9-]+$")
    name: str
    wikidata_qid: str | None = None
    center: LatLng
    city: str | None = None
    country: str | None = None
    inception: str | None = None
    architect: str | None = None
    architectural_style: str | None = None
    unesco_id: str | None = None
    heritage_status: str | None = None


# --- Overview ---


class TimelineEvent(BaseModel):
    year: str
    event: str
    description: str | None = None
    source: str | None = None


class Figure(BaseModel):
    name: str
    role: str
    description: str | None = None
    source: str | None = None


class Overview(BaseModel):
    narration_text: str = Field(min_length=100)
    narration_duration_seconds: int = Field(ge=30)
    cultural_significance: str | None = None
    timeline: list[TimelineEvent] = Field(default_factory=list)
    figures: list[Figure] = Field(default_factory=list)


# --- Route ---


class Route(BaseModel):
    total_walking_minutes: float = 0
    total_narration_minutes: float = 0
    total_tour_minutes: float = 0
    spot_order: list[str]

    @field_validator("spot_order")
    @classmethod
    def spot_order_not_empty(cls, v: list[str]) -> list[str]:
        if not v:
            raise ValueError("spot_order must not be empty")
        return v


# --- Source ---


class SourceInfo(BaseModel):
    url: str | None = None
    fetched_at: str | None = None
    qid: str | None = None


# --- Quality ---


class Confidence(str, Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class Quality(BaseModel):
    confidence: Confidence = Confidence.MEDIUM
    total_source_words: int = 0
    total_narration_words: int = 0
    spots_with_thin_content: list[str] = Field(default_factory=list)
    unverified_claims: list[str] = Field(default_factory=list)
    human_reviewed: bool = False


# --- Bundle (top-level) ---


class MonumentBundle(BaseModel):
    version: Literal["1.0"] = "1.0"
    generated_at: datetime
    pipeline_version: str | None = None
    monument: Monument
    overview: Overview
    spots: list[Spot] = Field(min_length=1)
    route: Route
    sources: dict[str, SourceInfo] = Field(default_factory=dict)
    quality: Quality = Field(default_factory=Quality)

    @field_validator("spots")
    @classmethod
    def spots_have_unique_ids(cls, v: list[Spot]) -> list[Spot]:
        ids = [s.id for s in v]
        if len(ids) != len(set(ids)):
            dupes = [x for x in ids if ids.count(x) > 1]
            raise ValueError(f"Duplicate spot ids: {set(dupes)}")
        return v

    @field_validator("spots")
    @classmethod
    def spots_have_sequential_order(cls, v: list[Spot]) -> list[Spot]:
        orders = sorted(s.narration_order for s in v)
        expected = list(range(1, len(v) + 1))
        if orders != expected:
            raise ValueError(
                f"narration_order must be sequential 1..N, got {orders}"
            )
        return v
