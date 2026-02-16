"""Wikidata SPARQL client for monument entity resolution."""

from __future__ import annotations

import logging
from typing import Any

from SPARQLWrapper import JSON, SPARQLWrapper

from pipeline.config import WIKIDATA_SPARQL_ENDPOINT, WIKIDATA_USER_AGENT

logger = logging.getLogger(__name__)

_MAIN_QUERY = """
SELECT ?item ?itemLabel ?coord ?inception ?architectLabel ?styleLabel
       ?countryLabel ?cityLabel ?unescoId ?image ?heritageLabel
WHERE {{
  ?item rdfs:label "{name}"@en .
  ?item wdt:P31/wdt:P279* ?type .
  FILTER(?type IN (wd:Q811979, wd:Q35112127, wd:Q381885, wd:Q16560,
                   wd:Q12518, wd:Q44539, wd:Q839954, wd:Q11303,
                   wd:Q751876, wd:Q2319498, wd:Q4989906))
  OPTIONAL {{ ?item wdt:P625 ?coord . }}
  OPTIONAL {{ ?item wdt:P571 ?inception . }}
  OPTIONAL {{ ?item wdt:P84 ?architect . }}
  OPTIONAL {{ ?item wdt:P149 ?style . }}
  OPTIONAL {{ ?item wdt:P17 ?country . }}
  OPTIONAL {{ ?item wdt:P131 ?city . }}
  OPTIONAL {{ ?item wdt:P757 ?unescoId . }}
  OPTIONAL {{ ?item wdt:P18 ?image . }}
  OPTIONAL {{ ?item wdt:P1435 ?heritage . }}
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
}}
LIMIT 5
"""

_RELAXED_QUERY = """
SELECT ?item ?itemLabel ?coord ?inception ?architectLabel ?styleLabel
       ?countryLabel ?cityLabel ?unescoId ?image ?heritageLabel
WHERE {{
  ?item rdfs:label "{name}"@en .
  OPTIONAL {{ ?item wdt:P625 ?coord . }}
  OPTIONAL {{ ?item wdt:P571 ?inception . }}
  OPTIONAL {{ ?item wdt:P84 ?architect . }}
  OPTIONAL {{ ?item wdt:P149 ?style . }}
  OPTIONAL {{ ?item wdt:P17 ?country . }}
  OPTIONAL {{ ?item wdt:P131 ?city . }}
  OPTIONAL {{ ?item wdt:P757 ?unescoId . }}
  OPTIONAL {{ ?item wdt:P18 ?image . }}
  OPTIONAL {{ ?item wdt:P1435 ?heritage . }}
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
}}
LIMIT 10
"""

_SUB_PARTS_QUERY = """
SELECT ?part ?partLabel ?coord
WHERE {{
  wd:{qid} wdt:P527 ?part .
  OPTIONAL {{ ?part wdt:P625 ?coord . }}
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
}}
"""

_DEEP_PROPERTIES_QUERY = """
SELECT ?prop ?propLabel ?value ?valueLabel
WHERE {{
  VALUES ?prop {{
    wdt:P793
    wdt:P186
    wdt:P2048
    wdt:P2049
  }}
  wd:{qid} ?prop ?value .
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
}}
"""


def _make_sparql() -> SPARQLWrapper:
    sparql = SPARQLWrapper(WIKIDATA_SPARQL_ENDPOINT)
    sparql.setReturnFormat(JSON)
    sparql.addCustomHttpHeader("User-Agent", WIKIDATA_USER_AGENT)
    return sparql


def _parse_coord(coord_str: str | None) -> tuple[float, float] | None:
    """Parse 'Point(lng lat)' WKT string to (lat, lng)."""
    if not coord_str:
        return None
    coord_str = coord_str.strip()
    if coord_str.startswith("Point("):
        inner = coord_str[6:].rstrip(")")
        parts = inner.split()
        if len(parts) == 2:
            return float(parts[1]), float(parts[0])  # lat, lng
    return None


def _extract_qid(uri: str) -> str:
    """Extract QID from a Wikidata entity URI."""
    return uri.rsplit("/", 1)[-1]


def _get_value(row: dict, key: str) -> str | None:
    """Safely extract a value from a SPARQL result binding."""
    binding = row.get(key)
    if binding:
        return binding.get("value")
    return None


def resolve_monument(name: str) -> dict[str, Any] | None:
    """Resolve a monument name to Wikidata structured data.

    Returns a dict with QID, coordinates, and metadata, or None if not found.
    """
    sparql = _make_sparql()

    # Try type-filtered query first, then relaxed
    for query_template in [_MAIN_QUERY, _RELAXED_QUERY]:
        query = query_template.format(name=name.replace('"', '\\"'))
        sparql.setQuery(query)

        try:
            results = sparql.query().convert()
        except Exception:
            logger.exception("SPARQL query failed for '%s'", name)
            continue

        bindings = results.get("results", {}).get("bindings", [])
        if not bindings:
            continue

        # Pick the best result (first one with coordinates preferred)
        best = None
        for row in bindings:
            coord = _parse_coord(_get_value(row, "coord"))
            if coord:
                best = row
                break
        if best is None:
            best = bindings[0]

        coord = _parse_coord(_get_value(best, "coord"))
        item_uri = _get_value(best, "item") or ""
        qid = _extract_qid(item_uri)

        inception_raw = _get_value(best, "inception")
        inception = None
        if inception_raw:
            # Could be a full datetime or just a year
            if "T" in inception_raw:
                inception = inception_raw[:4]
            else:
                inception = inception_raw[:4] if len(inception_raw) >= 4 else inception_raw

        image_url = _get_value(best, "image")
        image_filename = None
        if image_url:
            image_filename = image_url.rsplit("/", 1)[-1]

        return {
            "qid": qid,
            "name": _get_value(best, "itemLabel") or name,
            "center_lat": coord[0] if coord else None,
            "center_lng": coord[1] if coord else None,
            "country": _get_value(best, "countryLabel"),
            "city": _get_value(best, "cityLabel"),
            "inception": inception,
            "architect": _get_value(best, "architectLabel"),
            "architectural_style": _get_value(best, "styleLabel"),
            "unesco_id": _get_value(best, "unescoId"),
            "heritage_status": _get_value(best, "heritageLabel"),
            "image_filename": image_filename,
        }

    return None


def fetch_sub_parts(qid: str) -> list[dict[str, Any]]:
    """Fetch P527 'has part' sub-entities for a given QID."""
    sparql = _make_sparql()
    query = _SUB_PARTS_QUERY.format(qid=qid)
    sparql.setQuery(query)

    try:
        results = sparql.query().convert()
    except Exception:
        logger.exception("SPARQL sub-parts query failed for %s", qid)
        return []

    parts = []
    for row in results.get("results", {}).get("bindings", []):
        part_uri = _get_value(row, "part") or ""
        part_qid = _extract_qid(part_uri)
        coord = _parse_coord(_get_value(row, "coord"))
        parts.append({
            "qid": part_qid,
            "name": _get_value(row, "partLabel") or part_qid,
            "lat": coord[0] if coord else None,
            "lng": coord[1] if coord else None,
        })

    return parts


def fetch_deep_properties(qid: str) -> dict[str, Any]:
    """Fetch additional structured properties (events, materials, dimensions)."""
    sparql = _make_sparql()
    query = _DEEP_PROPERTIES_QUERY.format(qid=qid)
    sparql.setQuery(query)

    try:
        results = sparql.query().convert()
    except Exception:
        logger.exception("SPARQL deep properties query failed for %s", qid)
        return {}

    props: dict[str, list[str]] = {}
    for row in results.get("results", {}).get("bindings", []):
        prop_label = _get_value(row, "propLabel") or _get_value(row, "prop") or ""
        value_label = _get_value(row, "valueLabel") or _get_value(row, "value") or ""
        props.setdefault(prop_label, []).append(value_label)

    return props
