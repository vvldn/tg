"""Agent N+1: Route Planner — determines optimal walking order and writes transitions."""

from __future__ import annotations

import json
import logging
import math

import anthropic

from pipeline.config import ANTHROPIC_API_KEY, CLAUDE_MODEL_LIGHTWEIGHT
from pipeline.models.raw import DiscoveredSpot

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT = """You are a route planner for a walking tour of a monument complex.

Given a list of spots with their coordinates, determine the optimal walking order.

Your output must be valid JSON matching this schema:
{
  "route": [
    {
      "spot_id": "string",
      "order": integer (starting from 1),
      "transition_from_previous": "string or null (1-2 sentence walking direction)",
      "walking_seconds": integer
    }
  ]
}

Rules:
- Start at the main gate/entry point (usually the spot closest to the complex boundary or explicitly named as a gate/entry)
- End at or near the main monument (climax of the tour)
- Minimize backtracking
- Group nearby spots together
- Walking transitions should be brief, natural directions ("Head north along the path...")
- Estimate walking time assuming ~80 meters per minute (leisurely pace)
- The first spot should have transition_from_previous as null and walking_seconds as 0
- Return ONLY valid JSON, no markdown fences, no extra text."""


def _build_user_prompt(monument_name: str, spots: list[DiscoveredSpot]) -> str:
    parts = [f"Monument: {monument_name}\n\nSpots:"]
    for s in spots:
        parts.append(f"  - id: {s.id}, name: {s.name}, lat: {s.lat}, lng: {s.lng}, importance: {s.importance}")
    return "\n".join(parts)


async def run_route_planner(
    monument_name: str, spots: list[DiscoveredSpot]
) -> dict:
    """Plan the walking route through the monument's spots.

    Returns a dict with route list and total walking/narration minutes.
    """
    if len(spots) <= 1:
        return _simple_route(spots)

    if not ANTHROPIC_API_KEY:
        logger.warning("[%s] Route planner: no API key, using distance-based order", monument_name)
        return _distance_based_route(monument_name, spots)

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    user_prompt = _build_user_prompt(monument_name, spots)

    try:
        response = client.messages.create(
            model=CLAUDE_MODEL_LIGHTWEIGHT,
            max_tokens=2048,
            system=_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
        )
    except Exception:
        logger.exception("[%s] Route planner agent failed, using fallback", monument_name)
        return _distance_based_route(monument_name, spots)

    text = response.content[0].text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        text = "\n".join(lines[1:])
        if text.endswith("```"):
            text = text[:-3].strip()

    try:
        result = json.loads(text)
    except json.JSONDecodeError:
        logger.error("[%s] Route planner: failed to parse JSON, using fallback", monument_name)
        return _distance_based_route(monument_name, spots)

    logger.info("[%s]   -> Agent (route planner): %d stops planned", monument_name, len(result.get("route", [])))
    return result


def _simple_route(spots: list[DiscoveredSpot]) -> dict:
    """Create a trivial route for 0 or 1 spots."""
    route = []
    for i, s in enumerate(spots):
        route.append({
            "spot_id": s.id,
            "order": i + 1,
            "transition_from_previous": None,
            "walking_seconds": 0,
        })
    return {"route": route}


def _distance_based_route(monument_name: str, spots: list[DiscoveredSpot]) -> dict:
    """Create a route using nearest-neighbor heuristic (no LLM needed)."""
    # Find a starting spot — prefer one with "gate" or "entry" in the name
    remaining = list(spots)
    start = None
    for s in remaining:
        name_lower = s.name.lower()
        if any(kw in name_lower for kw in ["gate", "entry", "entrance"]):
            start = s
            break

    if not start:
        # Use the spot farthest from the center of the others
        start = remaining[0]

    ordered: list[DiscoveredSpot] = [start]
    remaining.remove(start)

    while remaining:
        last = ordered[-1]
        nearest = min(remaining, key=lambda s: _dist(last.lat, last.lng, s.lat, s.lng))
        ordered.append(nearest)
        remaining.remove(nearest)

    route = []
    for i, s in enumerate(ordered):
        walking_sec = 0
        if i > 0:
            dist_m = _dist_meters(ordered[i - 1].lat, ordered[i - 1].lng, s.lat, s.lng)
            walking_sec = max(30, int(dist_m / 80 * 60))

        route.append({
            "spot_id": s.id,
            "order": i + 1,
            "transition_from_previous": None if i == 0 else f"Walk to {s.name}.",
            "walking_seconds": walking_sec,
        })

    return {"route": route}


def _dist(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Simple Euclidean distance (for sorting, not accuracy)."""
    return math.sqrt((lat1 - lat2) ** 2 + (lng1 - lng2) ** 2)


def _dist_meters(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Haversine distance in meters."""
    from pipeline.utils.dedup import haversine_meters
    return haversine_meters(lat1, lng1, lat2, lng2)
