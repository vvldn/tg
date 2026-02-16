"""Geocoding via Nominatim (free) and Google Geocoding (fallback)."""

from __future__ import annotations

import asyncio
import logging

import httpx

from pipeline.config import (
    GOOGLE_API_KEY,
    GOOGLE_GEOCODING_ENDPOINT,
    HTTP_TIMEOUT_SECONDS,
    HTTP_USER_AGENT,
    NOMINATIM_ENDPOINT,
)

logger = logging.getLogger(__name__)

# Nominatim rate limit: 1 req/s
_nominatim_lock = asyncio.Lock()


async def geocode(query: str, near_lat: float | None = None, near_lng: float | None = None) -> tuple[float, float] | None:
    """Geocode a place name to (lat, lng). Tries Nominatim first, then Google.

    If near_lat/near_lng are provided, results far from that point are discarded.
    """
    result = await _geocode_nominatim(query)
    if result:
        if near_lat is not None and near_lng is not None:
            from pipeline.utils.dedup import haversine_meters
            dist = haversine_meters(result[0], result[1], near_lat, near_lng)
            if dist > 1000:
                logger.debug("Nominatim result for '%s' is %.0fm away, discarding", query, dist)
                result = None

    if result is None and GOOGLE_API_KEY:
        result = await _geocode_google(query)
        if result and near_lat is not None and near_lng is not None:
            from pipeline.utils.dedup import haversine_meters
            dist = haversine_meters(result[0], result[1], near_lat, near_lng)
            if dist > 1000:
                logger.debug("Google result for '%s' is %.0fm away, discarding", query, dist)
                result = None

    return result


async def _geocode_nominatim(query: str) -> tuple[float, float] | None:
    """Geocode using Nominatim (free, 1 req/s rate limit)."""
    async with _nominatim_lock:
        async with httpx.AsyncClient(
            timeout=HTTP_TIMEOUT_SECONDS,
            headers={"User-Agent": HTTP_USER_AGENT},
        ) as client:
            try:
                resp = await client.get(
                    NOMINATIM_ENDPOINT,
                    params={"q": query, "format": "json", "limit": 1},
                )
                resp.raise_for_status()
            except httpx.HTTPError:
                logger.exception("Nominatim geocoding failed for '%s'", query)
                return None

        results = resp.json()
        if not results:
            return None

        return float(results[0]["lat"]), float(results[0]["lon"])


async def _geocode_google(query: str) -> tuple[float, float] | None:
    """Geocode using Google Geocoding API (requires API key)."""
    if not GOOGLE_API_KEY:
        return None

    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS) as client:
        try:
            resp = await client.get(
                GOOGLE_GEOCODING_ENDPOINT,
                params={"address": query, "key": GOOGLE_API_KEY},
            )
            resp.raise_for_status()
        except httpx.HTTPError:
            logger.exception("Google Geocoding failed for '%s'", query)
            return None

    data = resp.json()
    results = data.get("results", [])
    if not results:
        return None

    loc = results[0].get("geometry", {}).get("location", {})
    lat = loc.get("lat")
    lng = loc.get("lng")
    if lat is None or lng is None:
        return None

    return lat, lng
