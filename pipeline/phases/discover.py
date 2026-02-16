"""Phase 2: Discover Spots — Find sub-locations within a monument complex."""

from __future__ import annotations

import asyncio
import logging

from pipeline.config import DEDUP_PROXIMITY_METERS
from pipeline.models.raw import DiscoveredSpot, ResolvedEntity
from pipeline.sources.geocoder import geocode
from pipeline.sources.google_places import fetch_nearby_places
from pipeline.sources.overpass import fetch_nearby_spots
from pipeline.sources.wikidata import fetch_sub_parts
from pipeline.utils.dedup import dedup_spots
from pipeline.utils.slugify import make_slug

logger = logging.getLogger(__name__)


async def run_discover(entity: ResolvedEntity) -> list[DiscoveredSpot]:
    """Discover spots within a monument complex from multiple sources.

    Runs Wikidata sub-parts, Overpass, and Google Places in parallel,
    then merges and deduplicates results.
    """
    logger.info("[%s] Phase 2: Discovering spots...", entity.name)

    all_spots: list[DiscoveredSpot] = []

    # --- Wikidata sub-parts (already have QIDs from Phase 1) ---
    wikidata_spots = _spots_from_wikidata(entity)
    all_spots.extend(wikidata_spots)

    # --- Overpass + Google Places in parallel ---
    if entity.center_lat and entity.center_lng:
        overpass_task = fetch_nearby_spots(entity.center_lat, entity.center_lng)
        places_task = fetch_nearby_places(entity.center_lat, entity.center_lng)
        overpass_raw, places_raw = await asyncio.gather(overpass_task, places_task)

        for raw in overpass_raw:
            all_spots.append(DiscoveredSpot(
                id=make_slug(raw["name"]),
                name=raw["name"],
                lat=raw["lat"],
                lng=raw["lng"],
                source="overpass",
            ))

        for raw in places_raw:
            all_spots.append(DiscoveredSpot(
                id=make_slug(raw["name"]),
                name=raw["name"],
                lat=raw["lat"],
                lng=raw["lng"],
                source="google_places",
            ))

    # --- Geocode any Wikidata spots that are missing coordinates ---
    for spot in all_spots:
        if spot.lat == 0.0 and spot.lng == 0.0 and entity.center_lat:
            coords = await geocode(
                f"{spot.name} {entity.name}",
                near_lat=entity.center_lat,
                near_lng=entity.center_lng,
            )
            if coords:
                spot.lat = coords[0]
                spot.lng = coords[1]

    # --- Filter: drop spots with no coordinates ---
    all_spots = [s for s in all_spots if s.lat != 0.0 or s.lng != 0.0]

    # --- Dedup by proximity ---
    merged = dedup_spots(all_spots, proximity_meters=DEDUP_PROXIMITY_METERS)

    # --- Determine importance ---
    for spot in merged:
        spot.importance = _classify_importance(spot, entity)

    # --- If no spots found, create a single spot at center ---
    if not merged and entity.center_lat and entity.center_lng:
        merged = [DiscoveredSpot(
            id=entity.slug,
            name=entity.name,
            lat=entity.center_lat,
            lng=entity.center_lng,
            source="fallback",
            importance="primary",
        )]

    logger.info(
        "[%s]   -> %d spots found (%d Wikidata, %d Overpass, %d Places -> %d unique)",
        entity.name,
        len(merged),
        len(wikidata_spots),
        len([s for s in all_spots if "overpass" in s.source]),
        len([s for s in all_spots if "google" in s.source]),
        len(merged),
    )

    return merged


def _spots_from_wikidata(entity: ResolvedEntity) -> list[DiscoveredSpot]:
    """Convert Wikidata sub-parts to DiscoveredSpot objects."""
    if not entity.qid or not entity.wikidata_sub_parts:
        return []

    parts = fetch_sub_parts(entity.qid)
    spots = []
    for p in parts:
        spots.append(DiscoveredSpot(
            id=make_slug(p["name"]),
            name=p["name"],
            lat=p.get("lat") or 0.0,
            lng=p.get("lng") or 0.0,
            source="wikidata",
            wikidata_qid=p["qid"],
            importance="major",
        ))
    return spots


def _classify_importance(spot: DiscoveredSpot, entity: ResolvedEntity) -> str:
    """Determine spot importance for narration budget allocation."""
    # The main monument itself
    if spot.name.lower() == entity.name.lower() or spot.id == entity.slug:
        return "primary"
    # Has a Wikidata QID -> likely notable
    if spot.wikidata_qid:
        return "major"
    # Default
    return "minor"
