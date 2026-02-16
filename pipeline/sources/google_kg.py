"""Google Knowledge Graph API client."""

from __future__ import annotations

import logging

import httpx

from pipeline.config import GOOGLE_API_KEY, GOOGLE_KG_ENDPOINT, HTTP_TIMEOUT_SECONDS

logger = logging.getLogger(__name__)


async def fetch_knowledge_graph(query: str) -> dict | None:
    """Search Google Knowledge Graph for an entity.

    Returns a dict with keys: name, description, detailed_description, url,
    or None if not found or API key is not configured.
    """
    if not GOOGLE_API_KEY:
        logger.info("Google KG: skipped (no API key)")
        return None

    params = {
        "query": query,
        "key": GOOGLE_API_KEY,
        "limit": 1,
        "indent": "true",
    }

    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS) as client:
        try:
            resp = await client.get(GOOGLE_KG_ENDPOINT, params=params)
            resp.raise_for_status()
        except httpx.HTTPError:
            logger.exception("Google KG request failed for '%s'", query)
            return None

    data = resp.json()
    elements = data.get("itemListElement", [])
    if not elements:
        logger.debug("Google KG: no results for '%s'", query)
        return None

    item = elements[0].get("result", {})
    detailed = item.get("detailedDescription", {})

    result = {
        "name": item.get("name", ""),
        "description": item.get("description", ""),
        "detailed_description": detailed.get("articleBody", ""),
        "url": detailed.get("url", ""),
    }

    logger.info("Google KG: found '%s' for '%s'", result["name"], query)
    return result
