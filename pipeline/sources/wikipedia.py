"""Wikipedia API client for fetching article content."""

from __future__ import annotations

import logging
from urllib.parse import quote

import httpx

from pipeline.config import HTTP_TIMEOUT_SECONDS, HTTP_USER_AGENT, WIKIPEDIA_API_ENDPOINT

logger = logging.getLogger(__name__)


async def fetch_article(title: str, client: httpx.AsyncClient | None = None) -> str | None:
    """Fetch the plain text extract of a Wikipedia article.

    Returns the full article text, or None if not found.
    """
    params = {
        "action": "query",
        "titles": title,
        "prop": "extracts",
        "explaintext": "true",
        "format": "json",
    }

    should_close = client is None
    if client is None:
        client = httpx.AsyncClient(
            timeout=HTTP_TIMEOUT_SECONDS,
            headers={"User-Agent": HTTP_USER_AGENT},
        )

    try:
        resp = await client.get(WIKIPEDIA_API_ENDPOINT, params=params)
        resp.raise_for_status()
    except httpx.HTTPError:
        logger.exception("Wikipedia API request failed for '%s'", title)
        if should_close:
            await client.aclose()
        return None

    data = resp.json()
    if should_close:
        await client.aclose()

    pages = data.get("query", {}).get("pages", {})
    for page_id, page in pages.items():
        if page_id == "-1":
            logger.debug("Wikipedia: no article found for '%s'", title)
            return None
        text = page.get("extract", "")
        if text:
            logger.info("Wikipedia: fetched '%s' (%d words)", title, len(text.split()))
            return text

    return None


async def search_and_fetch(query: str, client: httpx.AsyncClient | None = None) -> str | None:
    """Search Wikipedia for a query and fetch the best matching article.

    Useful when the exact article title is unknown.
    """
    should_close = client is None
    if client is None:
        client = httpx.AsyncClient(
            timeout=HTTP_TIMEOUT_SECONDS,
            headers={"User-Agent": HTTP_USER_AGENT},
        )

    # Search first
    search_params = {
        "action": "query",
        "list": "search",
        "srsearch": query,
        "srlimit": 1,
        "format": "json",
    }

    try:
        resp = await client.get(WIKIPEDIA_API_ENDPOINT, params=search_params)
        resp.raise_for_status()
    except httpx.HTTPError:
        logger.exception("Wikipedia search failed for '%s'", query)
        if should_close:
            await client.aclose()
        return None

    data = resp.json()
    search_results = data.get("query", {}).get("search", [])
    if not search_results:
        if should_close:
            await client.aclose()
        return None

    title = search_results[0]["title"]
    result = await fetch_article(title, client)
    if should_close:
        await client.aclose()
    return result
