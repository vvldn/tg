"""Pipeline configuration — API keys, rate limits, defaults."""

from __future__ import annotations

import os
from pathlib import Path

# --- Directories ---

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data"
RAW_DIR = DATA_DIR / "raw"
BUNDLES_DIR = DATA_DIR / "bundles"
LOGS_DIR = DATA_DIR / "logs"

# --- Pipeline metadata ---

PIPELINE_VERSION = "0.1.0"

# --- API keys (from environment) ---

GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY", "")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

# --- Wikidata ---

WIKIDATA_SPARQL_ENDPOINT = "https://query.wikidata.org/sparql"
WIKIDATA_USER_AGENT = "TravelGuidePipeline/0.1 (monument onboarding)"

# --- Wikipedia ---

WIKIPEDIA_API_ENDPOINT = "https://en.wikipedia.org/w/api.php"

# --- Overpass (OSM) ---

OVERPASS_API_ENDPOINT = "https://overpass-api.de/api/interpreter"
OVERPASS_RADIUS_METERS = 300

# --- Google Places ---

GOOGLE_PLACES_ENDPOINT = (
    "https://maps.googleapis.com/maps/api/place/nearbysearch/json"
)
GOOGLE_PLACES_RADIUS_METERS = 300

# --- Google Knowledge Graph ---

GOOGLE_KG_ENDPOINT = "https://kgsearch.googleapis.com/v1/entities:search"

# --- Google Geocoding ---

GOOGLE_GEOCODING_ENDPOINT = (
    "https://maps.googleapis.com/maps/api/geocode/json"
)

# --- Nominatim (OSM Geocoder) ---

NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/search"

# --- UNESCO ---

UNESCO_BASE_URL = "https://whc.unesco.org/en/list"

# --- Wikimedia Commons ---

WIKIMEDIA_COMMONS_ENDPOINT = "https://commons.wikimedia.org/w/api.php"

# --- Claude LLM ---

CLAUDE_MODEL_ENRICHMENT = "claude-sonnet-4-5-20250929"
CLAUDE_MODEL_LIGHTWEIGHT = "claude-haiku-4-5-20251001"

# --- HTTP client defaults ---

HTTP_TIMEOUT_SECONDS = 30
HTTP_USER_AGENT = "TravelGuidePipeline/0.1 (monument onboarding; contact: dev@example.com)"

# --- Spot deduplication ---

DEDUP_PROXIMITY_METERS = 20

# --- Narration budget (words) ---

NARRATION_BUDGET = {
    "primary": (750, 900),
    "major": (450, 600),
    "minor": (300, 450),
    "transitional": (150, 300),
}
