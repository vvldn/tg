"""Archaeological Survey of India (ASI) scraper.

ASI's website is poorly structured and unreliable. This source is
supplementary and may yield thin results. Failures are expected and
logged gracefully.
"""

from __future__ import annotations

import logging

import httpx
from bs4 import BeautifulSoup

from pipeline.config import HTTP_TIMEOUT_SECONDS, HTTP_USER_AGENT

logger = logging.getLogger(__name__)

ASI_SEARCH_URL = "https://asi.nic.in/"


async def fetch_asi_content(monument_name: str) -> str | None:
    """Attempt to find and extract content about a monument from ASI's website.

    Returns extracted text or None. Failures are expected and handled gracefully.
    """
    async with httpx.AsyncClient(
        timeout=HTTP_TIMEOUT_SECONDS,
        headers={"User-Agent": HTTP_USER_AGENT},
        follow_redirects=True,
    ) as client:
        # Try direct search
        try:
            resp = await client.get(
                ASI_SEARCH_URL,
                params={"s": monument_name},
            )
            resp.raise_for_status()
        except httpx.HTTPError:
            logger.info("ASI: site unreachable or search failed for '%s'", monument_name)
            return None

    soup = BeautifulSoup(resp.text, "lxml")

    # Try to find content in search results
    content_el = soup.select_one(".entry-content") or soup.select_one("article") or soup.select_one("#content")
    if content_el:
        for tag in content_el.select("nav, header, footer, script, style, .sidebar"):
            tag.decompose()
        text = content_el.get_text(separator="\n", strip=True)
        if text and len(text.split()) > 50:
            logger.info("ASI: extracted %d words for '%s'", len(text.split()), monument_name)
            return text

    logger.info("ASI: no useful content found for '%s'", monument_name)
    return None
