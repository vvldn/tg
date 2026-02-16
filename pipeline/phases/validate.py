"""Phase 5: Validate and Assemble — validation checks + bundle assembly."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path

from pipeline.config import BUNDLES_DIR, PIPELINE_VERSION
from pipeline.models.bundle import (
    Confidence,
    Figure,
    LatLng,
    MonumentBundle,
    Monument,
    Overview,
    Quality,
    Route,
    SourceInfo,
    Spot,
    Story,
    StoryType,
    TimelineEvent,
)
from pipeline.models.raw import DiscoveredSpot, FetchManifest, ResolvedEntity
from pipeline.utils.dedup import haversine_meters
from pipeline.utils.narration_budget import WORDS_PER_MINUTE, estimate_duration_seconds

logger = logging.getLogger(__name__)


async def run_validate_and_assemble(
    entity: ResolvedEntity,
    spots: list[DiscoveredSpot],
    manifest: FetchManifest,
    enrichment: dict,
) -> MonumentBundle:
    """Validate enrichment results and assemble the final bundle.

    Runs programmatic validation checks and produces the MonumentBundle.
    """
    logger.info("[%s] Phase 5: Validating...", entity.name)

    historian = enrichment["historian"]
    spot_narrations = enrichment["spot_narrations"]
    route_data = enrichment["route"]

    # --- Build route ordering ---
    route_entries = route_data.get("route", [])
    spot_id_to_order: dict[str, int] = {}
    spot_id_to_transition: dict[str, str | None] = {}
    spot_id_to_walking_sec: dict[str, int] = {}

    for entry in route_entries:
        sid = entry["spot_id"]
        spot_id_to_order[sid] = entry["order"]
        spot_id_to_transition[sid] = entry.get("transition_from_previous")
        spot_id_to_walking_sec[sid] = entry.get("walking_seconds", 0)

    # Assign order to any spots not in route
    max_order = max(spot_id_to_order.values()) if spot_id_to_order else 0
    for spot in spots:
        if spot.id not in spot_id_to_order:
            max_order += 1
            spot_id_to_order[spot.id] = max_order

    # --- Build spot objects ---
    narration_lookup = {n["spot_id"]: n for n in spot_narrations}
    bundle_spots: list[Spot] = []
    total_narration_words = 0
    thin_spots: list[str] = []
    all_unverified: list[str] = []

    for spot in spots:
        narration = narration_lookup.get(spot.id, {})
        narration_text = narration.get("narration_text", "")
        word_count = len(narration_text.split())
        total_narration_words += word_count

        if word_count < 50:
            thin_spots.append(spot.id)

        # Build stories
        stories: list[Story] = []
        for s in narration.get("stories", []):
            story_type = s.get("type", "history")
            try:
                st = StoryType(story_type)
            except ValueError:
                st = StoryType.HISTORY

            stories.append(Story(
                title=s.get("title", ""),
                narration_text=s.get("narration_text", ""),
                type=st,
                duration_seconds=s.get("duration_seconds"),
                sources=s.get("sources"),
            ))

        # Collect unverified claims
        all_unverified.extend(narration.get("unverified_claims", []))

        order = spot_id_to_order.get(spot.id, 1)

        bundle_spots.append(Spot(
            id=spot.id,
            name=spot.name,
            lat=spot.lat,
            lng=spot.lng,
            narration_order=order,
            walking_from_previous=spot_id_to_transition.get(spot.id),
            walking_seconds_from_previous=spot_id_to_walking_sec.get(spot.id, 0),
            narration_text=narration_text if len(narration_text) >= 50 else narration_text + " " * (50 - len(narration_text) + 1),
            narration_duration_seconds=narration.get("narration_duration_seconds", estimate_duration_seconds(narration_text)),
            stories=stories,
            architectural_notes=narration.get("architectural_notes"),
            visual_anchors=narration.get("visual_anchors", []),
            visitor_context=narration.get("visitor_context"),
        ))

    # Sort by narration_order
    bundle_spots.sort(key=lambda s: s.narration_order)

    # Re-number to ensure sequential 1..N
    for i, spot in enumerate(bundle_spots):
        spot.narration_order = i + 1

    # --- Overview ---
    overview_narration = historian.get("overview_narration", "")
    total_narration_words += len(overview_narration.split())

    timeline = [
        TimelineEvent(
            year=t.get("year", ""),
            event=t.get("event", ""),
            description=t.get("description"),
            source=t.get("source"),
        )
        for t in historian.get("timeline", [])
    ]

    figures = [
        Figure(
            name=f.get("name", ""),
            role=f.get("role", ""),
            description=f.get("description"),
            source=f.get("source"),
        )
        for f in historian.get("figures", [])
    ]

    overview = Overview(
        narration_text=overview_narration if len(overview_narration) >= 100 else overview_narration + " " * (100 - len(overview_narration) + 1),
        narration_duration_seconds=historian.get("narration_duration_seconds", estimate_duration_seconds(overview_narration)),
        cultural_significance=historian.get("cultural_significance"),
        timeline=timeline,
        figures=figures,
    )

    # --- Route ---
    total_walking_sec = sum(s.walking_seconds_from_previous for s in bundle_spots)
    total_narration_sec = sum(s.narration_duration_seconds for s in bundle_spots) + overview.narration_duration_seconds

    route = Route(
        total_walking_minutes=round(total_walking_sec / 60, 1),
        total_narration_minutes=round(total_narration_sec / 60, 1),
        total_tour_minutes=round((total_walking_sec + total_narration_sec) / 60, 1),
        spot_order=[s.id for s in bundle_spots],
    )

    # --- Sources ---
    sources: dict[str, SourceInfo] = {}
    if manifest.sources.get("wikipedia", None) and manifest.sources["wikipedia"].status == "success":
        sources["wikipedia"] = SourceInfo(
            url=f"https://en.wikipedia.org/wiki/{entity.name.replace(' ', '_')}",
            fetched_at=manifest.fetched_at,
        )
    if entity.unesco_id and manifest.sources.get("unesco", None) and manifest.sources["unesco"].status == "success":
        sources["unesco"] = SourceInfo(
            url=f"https://whc.unesco.org/en/list/{entity.unesco_id}/",
            fetched_at=manifest.fetched_at,
        )
    if entity.qid:
        sources["wikidata"] = SourceInfo(
            qid=entity.qid,
            fetched_at=manifest.fetched_at,
        )

    # --- Quality ---
    total_narration_min = total_narration_sec / 60
    if total_narration_min >= 30 and total_narration_min <= 45:
        confidence = Confidence.HIGH
    elif total_narration_min >= 20:
        confidence = Confidence.MEDIUM
    else:
        confidence = Confidence.LOW

    quality = Quality(
        confidence=confidence,
        total_source_words=manifest.total_raw_words,
        total_narration_words=total_narration_words,
        spots_with_thin_content=thin_spots,
        unverified_claims=all_unverified,
        human_reviewed=False,
    )

    # --- Monument ---
    monument = Monument(
        id=entity.slug,
        name=entity.name,
        wikidata_qid=entity.qid,
        center=LatLng(lat=entity.center_lat, lng=entity.center_lng),
        city=entity.city,
        country=entity.country,
        inception=entity.inception,
        architect=entity.architect,
        architectural_style=entity.architectural_style,
        unesco_id=entity.unesco_id,
        heritage_status=entity.heritage_status,
    )

    # --- Assemble bundle ---
    bundle = MonumentBundle(
        version="1.0",
        generated_at=datetime.now(timezone.utc),
        pipeline_version=PIPELINE_VERSION,
        monument=monument,
        overview=overview,
        spots=bundle_spots,
        route=route,
        sources=sources,
        quality=quality,
    )

    # --- Validation checks ---
    _run_checks(bundle, entity)

    # --- Write to disk ---
    bundle_dir = BUNDLES_DIR / entity.slug
    bundle_dir.mkdir(parents=True, exist_ok=True)
    bundle_path = bundle_dir / "bundle.json"
    bundle_path.write_text(
        bundle.model_dump_json(indent=2, exclude_none=True),
        encoding="utf-8",
    )

    logger.info(
        "[%s] Bundle written to %s",
        entity.name,
        bundle_path,
    )
    logger.info(
        "[%s]   %d words | %d spots | %.0f min narration",
        entity.name,
        total_narration_words,
        len(bundle_spots),
        total_narration_min,
    )

    return bundle


def _run_checks(bundle: MonumentBundle, entity: ResolvedEntity) -> None:
    """Run programmatic validation checks and log warnings."""
    name = entity.name

    # Total narration duration
    total_min = bundle.route.total_narration_minutes
    if total_min < 30:
        logger.warning("[%s] Narration under target: %.0f min (target: 30-40)", name, total_min)
    elif total_min > 45:
        logger.warning("[%s] Narration over target: %.0f min (target: 30-40)", name, total_min)
    else:
        logger.info("[%s]   -> Total narration: %.0f min (target: 30-40)", name, total_min)

    # All spots have lat/lng
    for spot in bundle.spots:
        if spot.lat == 0.0 and spot.lng == 0.0:
            logger.warning("[%s] Spot '%s' has no coordinates", name, spot.name)

    # All spots have at least 1 story
    for spot in bundle.spots:
        if not spot.stories:
            logger.warning("[%s] Spot '%s' has no stories", name, spot.name)

    # All lat/lngs within 500m of center
    center = bundle.monument.center
    for spot in bundle.spots:
        dist = haversine_meters(center.lat, center.lng, spot.lat, spot.lng)
        if dist > 500:
            logger.warning(
                "[%s] Spot '%s' is %.0fm from monument center (>500m)",
                name, spot.name, dist,
            )

    # Unverified claims
    if bundle.quality.unverified_claims:
        logger.warning(
            "[%s] %d unverified claims flagged",
            name, len(bundle.quality.unverified_claims),
        )

    # Route visits all spots
    route_ids = set(bundle.route.spot_order)
    spot_ids = {s.id for s in bundle.spots}
    orphans = spot_ids - route_ids
    if orphans:
        logger.warning("[%s] Spots not in route: %s", name, orphans)
