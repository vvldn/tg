"""Phase 4: Enrich — LLM agent orchestration for content enrichment."""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from pipeline.agents.historian import run_historian
from pipeline.agents.route_planner import run_route_planner
from pipeline.agents.spot_narrator import run_spot_narrator
from pipeline.config import RAW_DIR
from pipeline.models.raw import DiscoveredSpot, FetchManifest, ResolvedEntity

logger = logging.getLogger(__name__)


async def run_enrich(
    entity: ResolvedEntity,
    spots: list[DiscoveredSpot],
    manifest: FetchManifest,
) -> dict:
    """Run LLM enrichment agents to produce structured tour content.

    Returns a dict with keys:
      - historian: monument overview, timeline, figures, cultural_significance
      - spot_narrations: list of per-spot enrichment dicts
      - route: walking route with transitions
    """
    logger.info("[%s] Phase 4: Enriching with LLM agents...", entity.name)

    # Load raw content from disk
    raw_content = _load_raw_content(entity.slug)

    # --- Agent 0: Historian (must run first, provides context for spot agents) ---
    historian_result = await run_historian(entity.name, raw_content)
    overview_narration = historian_result.get("overview_narration", "")
    logger.info("[%s]   -> Agent 0 (historian): overview + timeline", entity.name)

    # --- Agent 1-N: Spot Narrators (run in parallel) ---
    all_raw_text = raw_content.get("wikipedia", "") or ""

    spot_tasks = []
    for spot in spots:
        spot_raw = _load_spot_content(entity.slug, spot.id)
        task = run_spot_narrator(
            monument_name=entity.name,
            spot=spot,
            monument_overview=overview_narration,
            spot_raw_content=spot_raw,
            all_raw_content=all_raw_text,
        )
        spot_tasks.append(task)

    spot_results = await asyncio.gather(*spot_tasks, return_exceptions=True)

    spot_narrations = []
    for i, result in enumerate(spot_results):
        if isinstance(result, Exception):
            logger.error("[%s]   -> Spot narrator failed for %s: %s", entity.name, spots[i].name, result)
            from pipeline.agents.spot_narrator import _placeholder
            from pipeline.utils.narration_budget import get_target_words
            min_words, _ = get_target_words(spots[i].importance)
            spot_narrations.append(_placeholder(spots[i], min_words))
        else:
            spot_narrations.append(result)

    logger.info(
        "[%s]   -> Agent 1-%d (spot narrators): %d/%d complete (parallel)",
        entity.name,
        len(spots),
        sum(1 for r in spot_results if not isinstance(r, Exception)),
        len(spots),
    )

    # --- Agent N+1: Route Planner ---
    route_result = await run_route_planner(entity.name, spots)
    logger.info("[%s]   -> Agent (route planner): walking route", entity.name)

    return {
        "historian": historian_result,
        "spot_narrations": spot_narrations,
        "route": route_result,
    }


def _load_raw_content(slug: str) -> dict[str, str]:
    """Load raw content files from data/raw/<slug>/ into a dict."""
    raw_dir = RAW_DIR / slug
    content: dict[str, str] = {}

    text_files = {
        "wikipedia": "wikipedia_monument.txt",
        "unesco": "unesco.txt",
        "asi": "asi.txt",
        "sahapedia": "sahapedia.txt",
    }

    for key, filename in text_files.items():
        path = raw_dir / filename
        if path.exists():
            content[key] = path.read_text(encoding="utf-8")

    # Also load wikidata JSON as formatted text
    wikidata_path = raw_dir / "wikidata.json"
    if wikidata_path.exists():
        import json
        try:
            data = json.loads(wikidata_path.read_text(encoding="utf-8"))
            content["wikidata"] = json.dumps(data, indent=2)
        except json.JSONDecodeError:
            pass

    # Load knowledge graph text
    kg_path = raw_dir / "knowledge_graph.json"
    if kg_path.exists():
        import json
        try:
            data = json.loads(kg_path.read_text(encoding="utf-8"))
            content["knowledge_graph"] = data.get("detailed_description", "")
        except json.JSONDecodeError:
            pass

    return content


def _load_spot_content(slug: str, spot_id: str) -> str | None:
    """Load Wikipedia content for a specific spot, if available."""
    path = RAW_DIR / slug / "wikipedia_spots" / f"{spot_id}.txt"
    if path.exists():
        return path.read_text(encoding="utf-8")
    return None
