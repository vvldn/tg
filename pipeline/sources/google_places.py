"""Google Places API client for discovering spots near a monument."""

from __future__ import annotations

import logging

import httpx

from pipeline.config import (
    GOOGLE_API_KEY,
    GOOGLE_PLACES_ENDPOINT,
    GOOGLE_PLACES_RADIUS_METERS,
    HTTP_TIMEOUT_SECONDS,
)

logger = logging.getLogger(__name__)


async def fetch_nearby_places(
    lat: float,
    lng: float,
    radius: int = GOOGLE_PLACES_RADIUS_METERS,
) -> list[dict]:
    """Query Google Places Nearby Search for tourist attractions near a point.

    Returns a list of dicts with keys: name, lat, lng, place_id, rating, user_ratings_total.
    Returns empty list if GOOGLE_API_KEY is not configured.
    """
    if not GOOGLE_API_KEY:
        logger.info("Google Places: skipped (no API key)")
        return []

    params = {
        "location": f"{lat},{lng}",
        "radius": radius,
        "type": "tourist_attraction",
        "key": GOOGLE_API_KEY,
    }

    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS) as client:
        try:
            resp = await client.get(GOOGLE_PLACES_ENDPOINT, params=params)
            resp.raise_for_status()
        except httpx.HTTPError:
            logger.exception("Google Places API request failed")
            return []

    data = resp.json()
    if data.get("status") != "OK":
        logger.warning("Google Places API status: %s", data.get("status"))
        return []

    results = data.get("results", [])
    spots = []

    for r in results:
        geo = r.get("geometry", {}).get("location", {})
        spot_lat = geo.get("lat")
        spot_lng = geo.get("lng")
        if spot_lat is None or spot_lng is None:
            continue

        spots.append({
            "name": r.get("name", ""),
            "lat": spot_lat,
            "lng": spot_lng,
            "place_id": r.get("place_id"),
            "rating": r.get("rating"),
            "user_ratings_total": r.get("user_ratings_total", 0),
        })

    logger.info("Google Places: found %d spots within %dm", len(spots), radius)
    return spots
