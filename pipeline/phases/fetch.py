"""Phase 3: Fetch — Crawl raw content from multiple sources in parallel."""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from pathlib import Path

import httpx

from pipeline.config import HTTP_TIMEOUT_SECONDS, HTTP_USER_AGENT, RAW_DIR
from pipeline.models.raw import DiscoveredSpot, FetchManifest, FetchManifestSource, ResolvedEntity
from pipeline.sources.asi import fetch_asi_content
from pipeline.sources.google_kg import fetch_knowledge_graph
from pipeline.sources.sahapedia import fetch_sahapedia_content
from pipeline.sources.unesco import fetch_unesco_page
from pipeline.sources.wikidata import fetch_deep_properties
from pipeline.sources.wikimedia import fetch_image_metadata
from pipeline.sources.wikipedia import fetch_article, search_and_fetch

logger = logging.getLogger(__name__)


async def run_fetch(
    entity: ResolvedEntity,
    spots: list[DiscoveredSpot],
    force: bool = False,
) -> FetchManifest:
    """Fetch raw content from all sources for a monument and its spots.

    Stores raw content in data/raw/<slug>/ and returns a manifest.
    If force=False and cached data exists, skips fetching.
    """
    logger.info("[%s] Phase 3: Fetching raw content...", entity.name)

    raw_dir = RAW_DIR / entity.slug
    raw_dir.mkdir(parents=True, exist_ok=True)
    spots_dir = raw_dir / "wikipedia_spots"
    spots_dir.mkdir(exist_ok=True)

    manifest_path = raw_dir / "fetch_manifest.json"
    if not force and manifest_path.exists():
        logger.info("[%s]   -> Using cached raw data (use --force-fetch to re-fetch)", entity.name)
        return FetchManifest.model_validate_json(manifest_path.read_text())

    now = datetime.now(timezone.utc).isoformat()
    manifest = FetchManifest(monument=entity.slug, fetched_at=now)
    total_words = 0

    # Run all sources in parallel
    results = await asyncio.gather(
        _fetch_wikipedia(entity, raw_dir),
        _fetch_wikipedia_spots(entity, spots, spots_dir),
        _fetch_wikidata_deep(entity, raw_dir),
        _fetch_unesco(entity, raw_dir),
        _fetch_asi(entity, raw_dir),
        _fetch_sahapedia(entity, raw_dir),
        _fetch_wikimedia(entity, raw_dir),
        _fetch_google_kg(entity, raw_dir),
        return_exceptions=True,
    )

    source_names = [
        "wikipedia", "wikipedia_spots", "wikidata",
        "unesco", "asi", "sahapedia", "wikimedia_commons", "knowledge_graph",
    ]

    for name, result in zip(source_names, results):
        if isinstance(result, Exception):
            logger.error("[%s]   -> %s: error (%s)", entity.name, name, result)
            manifest.sources[name] = FetchManifestSource(
                status="failed", error=str(result)
            )
        elif result is not None:
            manifest.sources[name] = result
            if result.word_count:
                total_words += result.word_count
        else:
            manifest.sources[name] = FetchManifestSource(status="skipped")

    manifest.total_raw_words = total_words

    # Write manifest
    manifest_path.write_text(manifest.model_dump_json(indent=2))

    logger.info("[%s]   -> Total raw: %d words", entity.name, total_words)
    return manifest


async def _fetch_wikipedia(entity: ResolvedEntity, raw_dir: Path) -> FetchManifestSource:
    """Fetch main Wikipedia article."""
    # Try exact name first, then search
    text = await fetch_article(entity.name)
    if not text:
        text = await search_and_fetch(entity.name)
    if not text:
        return FetchManifestSource(status="failed", error="no article found")

    path = raw_dir / "wikipedia_monument.txt"
    path.write_text(text, encoding="utf-8")
    wc = len(text.split())
    logger.info("[%s]   -> wikipedia: %d words", entity.name, wc)
    return FetchManifestSource(status="success", file="wikipedia_monument.txt", word_count=wc)


async def _fetch_wikipedia_spots(
    entity: ResolvedEntity, spots: list[DiscoveredSpot], spots_dir: Path
) -> FetchManifestSource:
    """Fetch Wikipedia articles for individual spots."""
    total_words = 0
    fetched = 0

    async with httpx.AsyncClient(
        timeout=HTTP_TIMEOUT_SECONDS,
        headers={"User-Agent": HTTP_USER_AGENT},
    ) as client:
        for spot in spots:
            text = await fetch_article(spot.name, client)
            if not text:
                # Try with monument name appended
                text = await fetch_article(f"{spot.name} ({entity.city or entity.name})", client)
            if text:
                path = spots_dir / f"{spot.id}.txt"
                path.write_text(text, encoding="utf-8")
                total_words += len(text.split())
                fetched += 1

    if fetched == 0:
        return FetchManifestSource(status="skipped", word_count=0)
    return FetchManifestSource(status="success", file="wikipedia_spots/", word_count=total_words)


async def _fetch_wikidata_deep(entity: ResolvedEntity, raw_dir: Path) -> FetchManifestSource:
    """Fetch deep Wikidata properties."""
    if not entity.qid:
        return FetchManifestSource(status="skipped")

    props = fetch_deep_properties(entity.qid)
    if not props:
        return FetchManifestSource(status="success", file="wikidata.json", word_count=0)

    path = raw_dir / "wikidata.json"
    path.write_text(json.dumps(props, indent=2, ensure_ascii=False), encoding="utf-8")
    wc = sum(len(str(v).split()) for v in props.values())
    return FetchManifestSource(status="success", file="wikidata.json", word_count=wc)


async def _fetch_unesco(entity: ResolvedEntity, raw_dir: Path) -> FetchManifestSource:
    """Fetch UNESCO WHC page."""
    if not entity.unesco_id:
        return FetchManifestSource(status="skipped")

    text = await fetch_unesco_page(entity.unesco_id)
    if not text:
        return FetchManifestSource(status="failed", error="no content extracted")

    path = raw_dir / "unesco.txt"
    path.write_text(text, encoding="utf-8")
    wc = len(text.split())
    logger.info("[%s]   -> unesco: %d words", entity.name, wc)
    return FetchManifestSource(status="success", file="unesco.txt", word_count=wc)


async def _fetch_asi(entity: ResolvedEntity, raw_dir: Path) -> FetchManifestSource:
    """Fetch ASI content."""
    text = await fetch_asi_content(entity.name)
    if not text:
        return FetchManifestSource(status="failed", error="no content found")

    path = raw_dir / "asi.txt"
    path.write_text(text, encoding="utf-8")
    wc = len(text.split())
    logger.info("[%s]   -> asi: %d words", entity.name, wc)
    return FetchManifestSource(status="success", file="asi.txt", word_count=wc)


async def _fetch_sahapedia(entity: ResolvedEntity, raw_dir: Path) -> FetchManifestSource:
    """Fetch Sahapedia content."""
    text = await fetch_sahapedia_content(entity.name, entity.country)
    if not text:
        return FetchManifestSource(status="failed", error="no content found")

    path = raw_dir / "sahapedia.txt"
    path.write_text(text, encoding="utf-8")
    wc = len(text.split())
    logger.info("[%s]   -> sahapedia: %d words", entity.name, wc)
    return FetchManifestSource(status="success", file="sahapedia.txt", word_count=wc)


async def _fetch_wikimedia(entity: ResolvedEntity, raw_dir: Path) -> FetchManifestSource:
    """Fetch Wikimedia Commons image metadata."""
    images = await fetch_image_metadata(entity.name)
    if not images:
        return FetchManifestSource(status="skipped", word_count=0)

    path = raw_dir / "wikimedia_commons.json"
    path.write_text(json.dumps(images, indent=2, ensure_ascii=False), encoding="utf-8")
    return FetchManifestSource(status="success", file="wikimedia_commons.json", word_count=0)


async def _fetch_google_kg(entity: ResolvedEntity, raw_dir: Path) -> FetchManifestSource:
    """Fetch Google Knowledge Graph data."""
    result = await fetch_knowledge_graph(entity.name)
    if not result:
        return FetchManifestSource(status="skipped")

    path = raw_dir / "knowledge_graph.json"
    path.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    wc = len(result.get("detailed_description", "").split())
    return FetchManifestSource(status="success", file="knowledge_graph.json", word_count=wc)
