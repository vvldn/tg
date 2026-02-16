"""Agent 0: Monument Historian — produces monument-level overview, timeline, and figures."""

from __future__ import annotations

import json
import logging

import anthropic

from pipeline.config import ANTHROPIC_API_KEY, CLAUDE_MODEL_ENRICHMENT
from pipeline.utils.narration_budget import estimate_duration_seconds

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT = """You are a historian and expert tour guide narrator. You produce structured content for audio-guided monument tours.

Your output must be valid JSON matching exactly this schema:
{
  "overview_narration": "string (300-450 words, warm conversational tour-guide voice)",
  "timeline": [
    {"year": "string", "event": "string", "description": "string", "source": "string"}
  ],
  "figures": [
    {"name": "string", "role": "string", "description": "string", "source": "string"}
  ],
  "cultural_significance": "string (2-3 paragraphs)"
}

Rules:
- ONLY use facts from the provided sources. Do NOT invent facts.
- If sources conflict, note the conflict in the relevant description.
- Cite which source each major fact comes from (wikipedia, unesco, wikidata, etc.)
- Write narration for spoken delivery, not reading — use contractions, direct address, conversational tone.
- The overview narration should cover: what this place is, who built it, when, why it matters.
- Timeline should cover from construction to present day, including major restorations.
- Figures should include builders, architects, rulers, and other notable people connected to the site.
- Return ONLY valid JSON, no markdown fences, no extra text."""


def _build_user_prompt(monument_name: str, raw_content: dict[str, str]) -> str:
    parts = [f"Monument: {monument_name}\n\nSource materials:\n"]
    for source_name, text in raw_content.items():
        if text:
            # Truncate very long sources to stay within context
            truncated = text[:8000] if len(text) > 8000 else text
            parts.append(f"--- {source_name} ---\n{truncated}\n")
    return "\n".join(parts)


async def run_historian(monument_name: str, raw_content: dict[str, str]) -> dict:
    """Run the historian agent to produce monument overview, timeline, and figures.

    Args:
        monument_name: The monument's canonical name.
        raw_content: Dict mapping source names to their text content.

    Returns:
        Dict with keys: overview_narration, timeline, figures, cultural_significance,
        narration_duration_seconds.
    """
    if not ANTHROPIC_API_KEY:
        logger.warning("[%s] Historian: no API key, returning placeholder", monument_name)
        return _placeholder(monument_name)

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    user_prompt = _build_user_prompt(monument_name, raw_content)

    try:
        response = client.messages.create(
            model=CLAUDE_MODEL_ENRICHMENT,
            max_tokens=4096,
            system=_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
        )
    except Exception:
        logger.exception("[%s] Historian agent failed", monument_name)
        return _placeholder(monument_name)

    text = response.content[0].text.strip()

    # Strip markdown code fences if present
    if text.startswith("```"):
        lines = text.split("\n")
        text = "\n".join(lines[1:])
        if text.endswith("```"):
            text = text[:-3].strip()

    try:
        result = json.loads(text)
    except json.JSONDecodeError:
        logger.error("[%s] Historian: failed to parse JSON response", monument_name)
        return _placeholder(monument_name)

    # Add duration estimate
    narration = result.get("overview_narration", "")
    result["narration_duration_seconds"] = estimate_duration_seconds(narration)

    logger.info(
        "[%s]   -> Agent 0 (historian): overview + timeline (%d events, %d figures)",
        monument_name,
        len(result.get("timeline", [])),
        len(result.get("figures", [])),
    )
    return result


def _placeholder(monument_name: str) -> dict:
    """Return a minimal placeholder when the LLM is unavailable."""
    narration = (
        f"Welcome to {monument_name}. This is a historically significant site "
        f"with rich architectural and cultural heritage. As we explore this monument "
        f"together, you will discover the stories of the people who built it, the "
        f"events that shaped it, and the artistic traditions it represents. "
        f"Let us begin our journey through history."
    )
    return {
        "overview_narration": narration,
        "narration_duration_seconds": estimate_duration_seconds(narration),
        "timeline": [],
        "figures": [],
        "cultural_significance": f"{monument_name} is a site of significant historical and cultural importance.",
    }
