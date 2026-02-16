"""Wikimedia Commons API client for fetching image metadata."""

from __future__ import annotations

import logging

import httpx

from pipeline.config import HTTP_TIMEOUT_SECONDS, HTTP_USER_AGENT, WIKIMEDIA_COMMONS_ENDPOINT

logger = logging.getLogger(__name__)


async def fetch_image_metadata(monument_title: str) -> list[dict]:
    """Fetch image URLs and metadata from Wikimedia Commons for a monument.

    Returns a list of dicts with keys: url, description, categories.
    """
    params = {
        "action": "query",
        "generator": "images",
        "titles": monument_title,
        "prop": "imageinfo",
        "iiprop": "url|extmetadata",
        "iiurlwidth": 800,
        "format": "json",
        "gimlimit": 20,
    }

    async with httpx.AsyncClient(
        timeout=HTTP_TIMEOUT_SECONDS,
        headers={"User-Agent": HTTP_USER_AGENT},
    ) as client:
        try:
            resp = await client.get(WIKIMEDIA_COMMONS_ENDPOINT, params=params)
            resp.raise_for_status()
        except httpx.HTTPError:
            logger.exception("Wikimedia Commons request failed for '%s'", monument_title)
            return []

    data = resp.json()
    pages = data.get("query", {}).get("pages", {})
    images = []

    for page in pages.values():
        imageinfo = page.get("imageinfo", [])
        if not imageinfo:
            continue
        info = imageinfo[0]
        ext = info.get("extmetadata", {})

        description = ""
        desc_field = ext.get("ImageDescription", {})
        if desc_field:
            description = desc_field.get("value", "")

        categories = ""
        cat_field = ext.get("Categories", {})
        if cat_field:
            categories = cat_field.get("value", "")

        images.append({
            "url": info.get("thumburl") or info.get("url", ""),
            "description": description,
            "categories": categories,
        })

    logger.info("Wikimedia Commons: found %d images for '%s'", len(images), monument_title)
    return images
