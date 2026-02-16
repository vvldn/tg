"""Narration word count targets per spot importance level."""

from __future__ import annotations

from pipeline.config import NARRATION_BUDGET

# Approximate words per minute for spoken narration
WORDS_PER_MINUTE = 150


def get_target_words(importance: str) -> tuple[int, int]:
    """Return (min_words, max_words) for a spot importance level."""
    return NARRATION_BUDGET.get(importance, NARRATION_BUDGET["minor"])


def get_target_minutes(importance: str) -> tuple[float, float]:
    """Return (min_minutes, max_minutes) for a spot importance level."""
    min_words, max_words = get_target_words(importance)
    return min_words / WORDS_PER_MINUTE, max_words / WORDS_PER_MINUTE


def estimate_duration_seconds(text: str) -> int:
    """Estimate spoken duration in seconds from word count."""
    word_count = len(text.split())
    return round(word_count / WORDS_PER_MINUTE * 60)
