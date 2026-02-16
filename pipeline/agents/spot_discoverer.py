"""Agent: Spot Discoverer — LLM-assisted discovery of spots from Wikipedia text.

Stubbed for MVP. When enabled, this agent reads the Wikipedia article and
identifies sub-locations not already found by API sources.
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


async def discover_spots_from_text(
    monument_name: str,
    existing_spot_names: list[str],
    wikipedia_text: str | None,
) -> list[str]:
    """Use LLM to find additional spot names from Wikipedia text.

    Returns a list of spot name strings that are NOT in existing_spot_names.

    Currently stubbed — returns empty list. To enable, set up Claude API
    and implement structured output parsing.
    """
    if not wikipedia_text:
        return []

    logger.info(
        "[%s] Spot discoverer: stubbed (returning no additional spots)",
        monument_name,
    )
    return []
