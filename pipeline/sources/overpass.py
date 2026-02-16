"""OpenStreetMap Overpass API client for discovering spots near a monument."""

from __future__ import annotations

import logging

import httpx

from pipeline.config import (
    HTTP_TIMEOUT_SECONDS,
    HTTP_USER_AGENT,
    OVERPASS_API_ENDPOINT,
    OVERPASS_RADIUS_METERS,
)

logger = logging.getLogger(__name__)

_QUERY_TEMPLATE = """
[out:json][timeout:30];
(
  node["tourism"~"attraction|artwork|information"]
    (around:{radius}, {lat}, {lng});
  node["historic"]
    (around:{radius}, {lat}, {lng});
  way["building"]["name"]
    (around:{radius}, {lat}, {lng});
);
out center body;
"""


async def fetch_nearby_spots(
    lat: float, lng: float, radius: int = OVERPASS_RADIUS_METERS
) -> list[dict]:
    """Query Overpass API for tourism/historic/building nodes near a point.

    Returns a list of dicts with keys: name, lat, lng, tags.
    """
    query = _QUERY_TEMPLATE.format(radius=radius, lat=lat, lng=lng)

    async with httpx.AsyncClient(
        timeout=HTTP_TIMEOUT_SECONDS,
        headers={"User-Agent": HTTP_USER_AGENT},
    ) as client:
        try:
            resp = await client.post(
                OVERPASS_API_ENDPOINT,
                data={"data": query},
            )
            resp.raise_for_status()
        except httpx.HTTPError:
            logger.exception("Overpass API request failed")
            return []

    data = resp.json()
    elements = data.get("elements", [])
    spots = []

    for el in elements:
        tags = el.get("tags", {})
        name = tags.get("name")
        if not name:
            continue

        # For ways, use the center coordinates
        if el.get("type") == "way":
            center = el.get("center", {})
            el_lat = center.get("lat")
            el_lng = center.get("lon")
        else:
            el_lat = el.get("lat")
            el_lng = el.get("lon")

        if el_lat is None or el_lng is None:
            continue

        spots.append({
            "name": name,
            "lat": el_lat,
            "lng": el_lng,
            "tags": tags,
        })

    logger.info("Overpass: found %d named spots within %dm", len(spots), radius)
    return spots
