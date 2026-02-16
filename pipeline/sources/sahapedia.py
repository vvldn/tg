"""Sahapedia scraper — Indian heritage content.

Only crawled for Indian monuments. Sahapedia has deep, unique content
including folk stories and cultural context. No public API exists.

Stubbed for MVP — scraping requires careful handling of their site structure.
"""

from __future__ import annotations

import logging

import httpx
from bs4 import BeautifulSoup

from pipeline.config import HTTP_TIMEOUT_SECONDS, HTTP_USER_AGENT

logger = logging.getLogger(__name__)


async def fetch_sahapedia_content(monument_name: str, country: str | None = None) -> str | None:
    """Fetch content about a monument from Sahapedia.

    Only attempts fetch for Indian monuments. Returns extracted text or None.
    """
    if country and country.lower() != "india":
        logger.debug("Sahapedia: skipped for non-Indian monument '%s'", monument_name)
        return None

    search_url = "https://www.sahapedia.org/search"

    async with httpx.AsyncClient(
        timeout=HTTP_TIMEOUT_SECONDS,
        headers={"User-Agent": HTTP_USER_AGENT},
        follow_redirects=True,
    ) as client:
        try:
            resp = await client.get(search_url, params={"search_api_fulltext": monument_name})
            resp.raise_for_status()
        except httpx.HTTPError:
            logger.info("Sahapedia: request failed for '%s'", monument_name)
            return None

    soup = BeautifulSoup(resp.text, "lxml")

    # Try to find article links in search results
    links = soup.select("a[href*='/']")
    article_url = None
    monument_lower = monument_name.lower()
    for link in links:
        text = link.get_text(strip=True).lower()
        href = link.get("href", "")
        if monument_lower.split()[0].lower() in text and href.startswith("http"):
            article_url = href
            break

    if not article_url:
        logger.info("Sahapedia: no article found for '%s'", monument_name)
        return None

    # Fetch the article page
    async with httpx.AsyncClient(
        timeout=HTTP_TIMEOUT_SECONDS,
        headers={"User-Agent": HTTP_USER_AGENT},
        follow_redirects=True,
    ) as client:
        try:
            resp = await client.get(article_url)
            resp.raise_for_status()
        except httpx.HTTPError:
            logger.info("Sahapedia: article fetch failed for '%s'", monument_name)
            return None

    soup = BeautifulSoup(resp.text, "lxml")
    content_el = soup.select_one("article") or soup.select_one(".field-name-body") or soup.select_one("#content")
    if content_el:
        for tag in content_el.select("nav, header, footer, script, style"):
            tag.decompose()
        text = content_el.get_text(separator="\n", strip=True)
        if text and len(text.split()) > 50:
            logger.info("Sahapedia: extracted %d words for '%s'", len(text.split()), monument_name)
            return text

    logger.info("Sahapedia: no useful content extracted for '%s'", monument_name)
    return None
