"""UNESCO World Heritage Centre scraper."""

from __future__ import annotations

import logging

import httpx
from bs4 import BeautifulSoup

from pipeline.config import HTTP_TIMEOUT_SECONDS, HTTP_USER_AGENT, UNESCO_BASE_URL

logger = logging.getLogger(__name__)


async def fetch_unesco_page(unesco_id: str) -> str | None:
    """Fetch and extract text content from a UNESCO WHC page.

    Returns extracted text (description, OUV, criteria), or None on failure.
    """
    url = f"{UNESCO_BASE_URL}/{unesco_id}/"

    async with httpx.AsyncClient(
        timeout=HTTP_TIMEOUT_SECONDS,
        headers={"User-Agent": HTTP_USER_AGENT},
        follow_redirects=True,
    ) as client:
        try:
            resp = await client.get(url)
            resp.raise_for_status()
        except httpx.HTTPError:
            logger.exception("UNESCO fetch failed for ID %s", unesco_id)
            return None

    soup = BeautifulSoup(resp.text, "lxml")
    sections: list[str] = []

    # Try to extract key sections
    for selector in [
        "#brief-description",
        ".field-name-field-brief-description",
        "#ouv",
        ".outstanding-universal-value",
        "#description",
        ".field-name-body",
    ]:
        el = soup.select_one(selector)
        if el:
            text = el.get_text(separator="\n", strip=True)
            if text:
                sections.append(text)

    # Fallback: grab main content area
    if not sections:
        main = soup.select_one("main") or soup.select_one("#content") or soup.select_one(".main-content")
        if main:
            # Remove nav, header, footer
            for tag in main.select("nav, header, footer, script, style"):
                tag.decompose()
            text = main.get_text(separator="\n", strip=True)
            if text:
                sections.append(text)

    if not sections:
        logger.warning("UNESCO: no content extracted for ID %s", unesco_id)
        return None

    result = "\n\n".join(sections)
    logger.info("UNESCO: extracted %d words for ID %s", len(result.split()), unesco_id)
    return result
