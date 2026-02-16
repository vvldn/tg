"""Main orchestrator — runs all 5 phases for a single monument."""

from __future__ import annotations

import logging

from pipeline.models.bundle import MonumentBundle
from pipeline.phases.discover import run_discover
from pipeline.phases.enrich import run_enrich
from pipeline.phases.fetch import run_fetch
from pipeline.phases.resolve import run_resolve
from pipeline.phases.validate import run_validate_and_assemble

logger = logging.getLogger(__name__)


async def onboard_monument(
    name: str,
    skip_fetch: bool = False,
    force_fetch: bool = False,
    validate_only: bool = False,
) -> MonumentBundle:
    """Run the full onboarding pipeline for a single monument.

    Args:
        name: Human-readable monument name (e.g. "Humayun's Tomb").
        skip_fetch: If True, skip Phase 3 and use cached raw data.
        force_fetch: If True, re-fetch all sources even if cached.
        validate_only: If True, only validate an existing bundle.

    Returns:
        The assembled and validated MonumentBundle.
    """
    # Phase 1: Resolve
    entity = await run_resolve(name)

    if validate_only:
        # Load existing bundle and re-validate
        from pipeline.config import BUNDLES_DIR
        import json
        bundle_path = BUNDLES_DIR / entity.slug / "bundle.json"
        if not bundle_path.exists():
            raise FileNotFoundError(f"No existing bundle at {bundle_path}")
        bundle = MonumentBundle.model_validate_json(bundle_path.read_text())
        logger.info("[%s] Validate-only: bundle is valid", name)
        return bundle

    # Phase 2: Discover Spots
    spots = await run_discover(entity)

    # Phase 3: Fetch Raw Content
    manifest = await run_fetch(entity, spots, force=force_fetch)

    # Phase 4: Enrich with LLM
    enrichment = await run_enrich(entity, spots, manifest)

    # Phase 5: Validate & Assemble
    bundle = await run_validate_and_assemble(entity, spots, manifest, enrichment)

    return bundle
