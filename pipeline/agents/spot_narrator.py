"""Agent 1-N: Spot Narrator — produces per-spot narration, stories, and visual anchors."""

from __future__ import annotations

import json
import logging

import anthropic

from pipeline.config import ANTHROPIC_API_KEY, CLAUDE_MODEL_ENRICHMENT
from pipeline.models.raw import DiscoveredSpot
from pipeline.utils.narration_budget import estimate_duration_seconds, get_target_words

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT = """You are a tour guide narrator preparing spoken content for a single stop within a monument complex.

Your output must be valid JSON matching exactly this schema:
{{
  "narration_text": "string (spoken narration for this spot, target {min_words}-{max_words} words)",
  "stories": [
    {{
      "title": "string",
      "narration_text": "string",
      "type": "history|architecture|legend|anecdote",
      "duration_seconds": integer,
      "sources": ["string"]
    }}
  ],
  "architectural_notes": "string (physical description, materials, style, notable features)",
  "visual_anchors": ["string (5-8 short descriptions of things a visitor would photograph or notice)"],
  "visitor_context": "string (one-line practical note)"
}}

Rules:
- ONLY use facts from the provided sources. Do NOT invent facts.
- Flag uncertain claims with [UNVERIFIED] in the text.
- Write for spoken delivery, not reading — use contractions, direct address, sensory details.
- Do NOT start with "Welcome to..." for every spot — vary your openings.
- Include 2-4 distinct stories or anecdotes.
- Each story needs a type: history, architecture, legend, or anecdote.
- Visual anchors should describe physical features a camera would see.
- Return ONLY valid JSON, no markdown fences, no extra text."""


def _build_user_prompt(
    monument_name: str,
    spot: DiscoveredSpot,
    monument_overview: str,
    spot_raw_content: str,
    all_raw_content: str,
) -> str:
    parts = [
        f"Monument: {monument_name}",
        f"Current spot: {spot.name}",
        f"\n--- Monument overview (for shared context, do NOT repeat) ---",
        monument_overview[:2000] if monument_overview else "(no overview available)",
        f"\n--- Source material about this specific spot ---",
    ]
    if spot_raw_content:
        parts.append(spot_raw_content[:6000])
    else:
        # Extract relevant sections from the main article
        parts.append(f"\n--- Relevant sections from monument article ---")
        relevant = _extract_relevant_sections(spot.name, all_raw_content)
        parts.append(relevant[:6000] if relevant else "(no specific content found for this spot)")

    return "\n".join(parts)


def _extract_relevant_sections(spot_name: str, full_text: str) -> str:
    """Extract paragraphs from a larger text that mention the spot name."""
    if not full_text:
        return ""

    words = spot_name.lower().split()
    paragraphs = full_text.split("\n\n")
    relevant = []
    for p in paragraphs:
        p_lower = p.lower()
        if any(w in p_lower for w in words if len(w) > 3):
            relevant.append(p)

    return "\n\n".join(relevant) if relevant else ""


async def run_spot_narrator(
    monument_name: str,
    spot: DiscoveredSpot,
    monument_overview: str,
    spot_raw_content: str | None,
    all_raw_content: str,
) -> dict:
    """Run the spot narrator agent for a single spot.

    Returns a dict matching the spot enrichment schema.
    """
    min_words, max_words = get_target_words(spot.importance)

    if not ANTHROPIC_API_KEY:
        logger.warning("[%s/%s] Spot narrator: no API key, returning placeholder", monument_name, spot.name)
        return _placeholder(spot, min_words)

    system = _SYSTEM_PROMPT.format(min_words=min_words, max_words=max_words)
    user_prompt = _build_user_prompt(
        monument_name, spot, monument_overview,
        spot_raw_content or "", all_raw_content,
    )

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    try:
        response = client.messages.create(
            model=CLAUDE_MODEL_ENRICHMENT,
            max_tokens=4096,
            system=system,
            messages=[{"role": "user", "content": user_prompt}],
        )
    except Exception:
        logger.exception("[%s/%s] Spot narrator agent failed", monument_name, spot.name)
        return _placeholder(spot, min_words)

    text = response.content[0].text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        text = "\n".join(lines[1:])
        if text.endswith("```"):
            text = text[:-3].strip()

    try:
        result = json.loads(text)
    except json.JSONDecodeError:
        logger.error("[%s/%s] Spot narrator: failed to parse JSON response", monument_name, spot.name)
        return _placeholder(spot, min_words)

    # Add computed fields
    result["spot_id"] = spot.id
    result["spot_name"] = spot.name
    narration = result.get("narration_text", "")
    result["narration_duration_seconds"] = estimate_duration_seconds(narration)

    # Extract unverified claims
    unverified = []
    if "[UNVERIFIED]" in narration:
        unverified.append(f"Spot {spot.name}: contains unverified claims in narration")
    for story in result.get("stories", []):
        if "[UNVERIFIED]" in story.get("narration_text", ""):
            unverified.append(f"Spot {spot.name}, story '{story.get('title', '')}': contains unverified claims")
    result["unverified_claims"] = unverified

    return result


def _placeholder(spot: DiscoveredSpot, target_words: int) -> dict:
    """Return a minimal placeholder when the LLM is unavailable."""
    narration = (
        f"You are now at {spot.name}. This is a notable location within the monument complex. "
        f"Take a moment to observe the architectural details around you. The craftsmanship here "
        f"reflects the artistic traditions of its era, with careful attention to proportion and "
        f"decoration. Look for the distinctive features that set this structure apart from "
        f"others in the complex."
    )
    return {
        "spot_id": spot.id,
        "spot_name": spot.name,
        "narration_text": narration,
        "narration_duration_seconds": estimate_duration_seconds(narration),
        "stories": [
            {
                "title": f"About {spot.name}",
                "narration_text": f"{spot.name} is an integral part of this monument complex with its own unique history and architectural character.",
                "type": "history",
                "duration_seconds": 30,
                "sources": [],
            }
        ],
        "architectural_notes": f"Notable structure within the monument complex.",
        "visual_anchors": [f"The structure of {spot.name}"],
        "visitor_context": "Open area, observe from designated pathways.",
        "unverified_claims": [],
    }
