"""Spot deduplication by geographic proximity."""

from __future__ import annotations

import math

from pipeline.models.raw import DiscoveredSpot


def haversine_meters(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Calculate distance in meters between two lat/lng points."""
    R = 6_371_000  # Earth radius in meters
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


# Priority order for name selection: wikidata > google_places > overpass > llm
_SOURCE_NAME_PRIORITY = {"wikidata": 0, "google_places": 1, "overpass": 2, "llm": 3, "geocoder": 4}

# Priority order for coordinate selection: google_places > overpass > wikidata > geocoder > llm
_SOURCE_COORD_PRIORITY = {"google_places": 0, "overpass": 1, "wikidata": 2, "geocoder": 3, "llm": 4}


def dedup_spots(spots: list[DiscoveredSpot], proximity_meters: float = 20.0) -> list[DiscoveredSpot]:
    """Merge spots that are within proximity_meters of each other.

    Merging rules:
    - Prefer Wikidata name > Google Places name > OSM name
    - Prefer Google Places coords > OSM coords > Wikidata coords
    - Keep union of all unique spots
    """
    if not spots:
        return []

    clusters: list[list[DiscoveredSpot]] = []

    for spot in spots:
        merged = False
        for cluster in clusters:
            representative = cluster[0]
            dist = haversine_meters(spot.lat, spot.lng, representative.lat, representative.lng)
            if dist <= proximity_meters:
                cluster.append(spot)
                merged = True
                break
        if not merged:
            clusters.append([spot])

    result: list[DiscoveredSpot] = []
    for cluster in clusters:
        # Pick best name (lowest source priority)
        best_name_spot = min(cluster, key=lambda s: _SOURCE_NAME_PRIORITY.get(s.source, 99))
        # Pick best coords (lowest coord priority)
        best_coord_spot = min(cluster, key=lambda s: _SOURCE_COORD_PRIORITY.get(s.source, 99))
        # Combine sources
        sources = "+".join(sorted({s.source for s in cluster}))
        # Prefer wikidata_qid if any spot in cluster has one
        qid = next((s.wikidata_qid for s in cluster if s.wikidata_qid), None)
        # Determine importance: best among cluster
        importance_order = {"primary": 0, "major": 1, "minor": 2, "transitional": 3}
        best_importance = min(cluster, key=lambda s: importance_order.get(s.importance, 99))

        merged_spot = DiscoveredSpot(
            id=best_name_spot.id,
            name=best_name_spot.name,
            lat=best_coord_spot.lat,
            lng=best_coord_spot.lng,
            source=sources,
            wikidata_qid=qid,
            importance=best_importance.importance,
        )
        result.append(merged_spot)

    return result
