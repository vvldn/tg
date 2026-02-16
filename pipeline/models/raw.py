"""Pydantic models for intermediate pipeline data structures."""

from __future__ import annotations

from pydantic import BaseModel, Field


class ResolvedEntity(BaseModel):
    """Output of Phase 1: Resolve."""

    qid: str | None = None
    name: str
    slug: str
    center_lat: float
    center_lng: float
    country: str | None = None
    city: str | None = None
    inception: str | None = None
    architect: str | None = None
    architectural_style: str | None = None
    unesco_id: str | None = None
    heritage_status: str | None = None
    wikidata_sub_parts: list[str] = Field(default_factory=list)
    image_filename: str | None = None


class DiscoveredSpot(BaseModel):
    """A single spot found during Phase 2: Discover."""

    id: str
    name: str
    lat: float
    lng: float
    source: str  # e.g. "wikidata", "overpass", "google_places", "llm"
    wikidata_qid: str | None = None
    importance: str = "minor"  # primary | major | minor | transitional


class FetchManifestSource(BaseModel):
    """Status of a single source fetch."""

    status: str  # "success" | "failed" | "skipped"
    file: str | None = None
    word_count: int | None = None
    error: str | None = None


class FetchManifest(BaseModel):
    """Tracks which sources succeeded/failed during Phase 3."""

    monument: str
    fetched_at: str
    sources: dict[str, FetchManifestSource] = Field(default_factory=dict)
    total_raw_words: int = 0
