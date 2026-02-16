"""Phase 1: Resolve — Turn monument name into canonical structured identity."""

from __future__ import annotations

import logging

from pipeline.models.raw import ResolvedEntity
from pipeline.sources.wikidata import fetch_sub_parts, resolve_monument
from pipeline.utils.slugify import make_slug

logger = logging.getLogger(__name__)


async def run_resolve(monument_name: str) -> ResolvedEntity:
    """Resolve a monument name to a canonical entity with metadata.

    Tries Wikidata SPARQL first. If that fails, returns a minimal entity
    with just the name and slug (coordinates will be missing and must be
    provided manually or via a fallback source).
    """
    logger.info("[%s] Phase 1: Resolving entity...", monument_name)

    slug = make_slug(monument_name)
    data = resolve_monument(monument_name)

    if data is None:
        logger.warning(
            "[%s] Wikidata returned no results. Creating minimal entity.",
            monument_name,
        )
        return ResolvedEntity(
            name=monument_name,
            slug=slug,
            center_lat=0.0,
            center_lng=0.0,
        )

    qid = data.get("qid")
    sub_parts: list[str] = []
    if qid:
        parts = fetch_sub_parts(qid)
        sub_parts = [p["qid"] for p in parts]
        logger.info(
            "[%s]   -> Wikidata %s, coords %.4f, %.4f, %d sub-parts",
            monument_name,
            qid,
            data.get("center_lat") or 0,
            data.get("center_lng") or 0,
            len(sub_parts),
        )

    entity = ResolvedEntity(
        qid=qid,
        name=data.get("name") or monument_name,
        slug=slug,
        center_lat=data.get("center_lat") or 0.0,
        center_lng=data.get("center_lng") or 0.0,
        country=data.get("country"),
        city=data.get("city"),
        inception=data.get("inception"),
        architect=data.get("architect"),
        architectural_style=data.get("architectural_style"),
        unesco_id=data.get("unesco_id"),
        heritage_status=data.get("heritage_status"),
        wikidata_sub_parts=sub_parts,
        image_filename=data.get("image_filename"),
    )

    return entity
