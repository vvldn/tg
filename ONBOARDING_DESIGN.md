# Monument Data Onboarding Pipeline — Technical Design Document

## 1. Purpose

This document describes the offline pipeline that crawls, enriches, and packages monument data into **bundles** that the Travel Guide backend serves at runtime. The pipeline runs ahead of time — hours or days before a user visits a monument. The output is a self-contained JSON bundle per monument, containing everything the backend needs to narrate a 30-40 minute guided tour with per-spot lat/lng, stories, and visual context for image recognition.

---

## 2. Relationship to Runtime

The PRD describes the runtime system: WebSocket narration, interrupts, voice/camera input. This pipeline feeds that system.

```
This pipeline (offline)              Runtime (PRD)
─────────────────────               ──────────────
Crawls data from APIs               Serves narration from bundle
Enriches with LLM                   Handles user interrupts
Produces monument bundles ────────► Backend loads bundle into
                                     Tour Engine + LLM context
```

The runtime LLM does NOT generate monument facts from scratch. It narrates and responds using the pre-onboarded bundle as its grounding context. This prevents hallucination and ensures factual consistency.

---

## 3. Tech Stack Decision

The onboarding pipeline and the runtime backend are **separate systems with different requirements**. They do NOT share a tech stack. The only contract between them is the `bundle.json` schema.

```
Onboarding Pipeline (Python)         Runtime Backend (Node.js/TypeScript)
────────────────────────────         ────────────────────────────────────
Runs offline, from CLI               Always-on server
Crawls APIs, scrapes HTML            Holds WebSocket connections
Calls LLM to enrich content          Streams narration, proxies LLM calls
Writes JSON bundle files              Reads JSON bundle files
                  │                              │
                  └──────► bundle.json ◄─────────┘
                           (the contract)
```

### Onboarding Pipeline: Python

| Concern | Choice | Why |
|---------|--------|-----|
| Language | **Python 3.11+** | Best-in-class scraping, data wrangling, and LLM SDK ecosystem |
| HTTP client | **httpx** (async) | Parallel fetching across 7+ sources simultaneously via `asyncio` |
| HTML parsing | **BeautifulSoup + lxml** | Unmatched for scraping UNESCO, ASI, Sahapedia pages |
| SPARQL | **SPARQLWrapper** | Standard library for Wikidata queries |
| LLM | **anthropic** (Python SDK) | First-class Claude support, structured output, streaming |
| CLI framework | **click** | Clean argument parsing, progress bars, help text |
| Data validation | **pydantic** | Validates bundle schema, catches malformed agent output |

**Key dependencies:**
```
anthropic          # Claude API
httpx[http2]       # async HTTP client
beautifulsoup4     # HTML parsing
lxml               # fast HTML/XML parser
SPARQLWrapper      # Wikidata queries
click              # CLI framework
pydantic           # data validation / bundle schema
python-slugify     # monument name → URL-safe slug
```

### Runtime Backend: Node.js / TypeScript

| Concern | Choice | Why |
|---------|--------|-----|
| Language | **TypeScript** | Shared types with React Native frontend |
| Framework | **Fastify** | Fast, low-overhead, plugin ecosystem |
| WebSocket | **fastify-websocket** or **ws** | Battle-tested for thousands of concurrent connections |
| LLM | **@anthropic-ai/sdk** | First-class Claude streaming + AbortController support |
| Database | **PostgreSQL + PostGIS** | Geospatial nearest-monument queries |
| DB client | **pg** or **Drizzle ORM** | Type-safe queries |
| STT | **Whisper API** or **Deepgram** | Speech-to-text for voice interrupts |
| TTS | **ElevenLabs** or **OpenAI TTS** | Text-to-speech for narration playback |

### Why Two Languages

| Alternative | Problem |
|-------------|---------|
| Both in Node.js | Scraping/parsing ecosystem is weak (cheerio is limited vs BeautifulSoup). SPARQL libraries are immature. You'd write 3x more code for the pipeline. |
| Both in Python | WebSocket streaming is less natural. Python's GIL complicates high-concurrency connection handling. Node's event loop is purpose-built for this. |

The bottleneck at runtime is **LLM API latency** (~2-4s per call), not server compute. Node's event loop handles thousands of idle WebSocket connections effortlessly while waiting on Claude responses. For the pipeline, Python's scraping and data processing libraries are unmatched.

---

## 4. Pipeline Overview

```
CLI Input: ["Humayun's Tomb", "Red Fort", "Qutub Minar"]
     │
     ▼
┌─────────────────────────────────────────────────────────┐
│  PHASE 1: RESOLVE                                       │
│  Entity resolution → Wikidata QID, coordinates,         │
│  canonical name, basic metadata                         │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│  PHASE 2: DISCOVER SPOTS                                │
│  Find sub-locations within the monument complex         │
│  with individual lat/lng coordinates                    │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│  PHASE 3: FETCH RAW CONTENT                             │
│  Crawl multiple sources in parallel for each monument   │
│  and each spot                                          │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│  PHASE 4: ENRICH (LLM Agents)                           │
│  Structure, narrate, and generate stories from          │
│  raw content using Claude                               │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│  PHASE 5: VALIDATE & ASSEMBLE                           │
│  Cross-check facts, compute walking route,              │
│  verify narration budget, package final bundle          │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
                 Output: monument bundle JSONs
                 Stored in: data/bundles/<monument-slug>/
```

Each monument is processed independently. Multiple monuments run in parallel.

---

## 5. Phase 1: Resolve Entity

### Goal
Turn a human-readable monument name into a canonical, structured identity.

### Data Source: Wikidata SPARQL API

**Endpoint:** `https://query.wikidata.org/sparql`

**What we extract:**
| Field | Wikidata Property | Example |
|-------|------------------|---------|
| QID | (entity ID) | Q320005 |
| Canonical name | rdfs:label | Humayun's Tomb |
| Coordinates | P625 | 28.5933, 77.2508 |
| Country | P17 | India |
| City | P131 | New Delhi |
| Inception date | P571 | 1572 |
| Architectural style | P149 | Mughal architecture |
| Architect | P84 | Mirak Mirza Ghiyas |
| UNESCO ID | P757 | 232 |
| Heritage designation | P1435 | UNESCO World Heritage Site |
| "Has part" entities | P527 | Isa Khan's Tomb, Barber's Tomb, etc. |
| Image | P18 | (Wikimedia Commons filename) |
| Instance of | P31 | tomb, mausoleum |

**SPARQL query pattern:**
```sparql
SELECT ?item ?itemLabel ?coord ?inception ?architectLabel ?styleLabel
       ?countryLabel ?cityLabel ?unescoId ?image
WHERE {
  ?item rdfs:label "Humayun's Tomb"@en .
  OPTIONAL { ?item wdt:P625 ?coord . }
  OPTIONAL { ?item wdt:P571 ?inception . }
  OPTIONAL { ?item wdt:P84 ?architect . }
  OPTIONAL { ?item wdt:P149 ?style . }
  OPTIONAL { ?item wdt:P17 ?country . }
  OPTIONAL { ?item wdt:P131 ?city . }
  OPTIONAL { ?item wdt:P757 ?unescoId . }
  OPTIONAL { ?item wdt:P18 ?image . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
```

A second query fetches sub-parts (P527 "has part") to seed Phase 2.

**Fallback:** If Wikidata returns no result (monument not well-catalogued), use Google Knowledge Graph API as a secondary resolver:
- **Endpoint:** `https://kgsearch.googleapis.com/v1/entities:search?query=...&key=API_KEY`
- Extract: name, description, detailedDescription, geo coordinates

### Output of Phase 1
```json
{
  "qid": "Q320005",
  "name": "Humayun's Tomb",
  "slug": "humayuns-tomb",
  "center": { "lat": 28.5933, "lng": 77.2508 },
  "country": "India",
  "city": "New Delhi",
  "inception": "1572",
  "architect": "Mirak Mirza Ghiyas",
  "architectural_style": "Mughal architecture",
  "unesco_id": "232",
  "wikidata_sub_parts": ["Q6079589", "Q18748245"],
  "resolved_at": "2026-02-16T00:00:00Z"
}
```

---

## 6. Phase 2: Discover Spots

### Goal
Find all visitable sub-locations within the monument complex. Each spot gets its own lat/lng and will later get its own narration content.

### Data Sources (run in parallel, merge results)

#### Source A: Wikidata Sub-Parts
Already fetched in Phase 1 via P527. For each sub-part QID, query its coordinates (P625) and label.

#### Source B: OpenStreetMap Overpass API

**Endpoint:** `https://overpass-api.de/api/interpreter`

**What it gives us:** OSM nodes/ways tagged as tourism, historic, or building within a bounding box around the monument.

**Query pattern:**
```
[out:json][timeout:30];
(
  node["tourism"~"attraction|artwork|information"]
    (around:300, 28.5933, 77.2508);
  node["historic"]
    (around:300, 28.5933, 77.2508);
  way["building"]["name"]
    (around:300, 28.5933, 77.2508);
);
out center body;
```

The `around:300` gives a 300-meter radius from the monument center, which covers most monument complexes.

**What we extract per node:**
- name
- lat, lng
- tags (tourism type, historic type, building type)

#### Source C: Google Places API — Nearby Search

**Endpoint:** `https://maps.googleapis.com/maps/api/place/nearbysearch/json`

**Parameters:**
- `location=28.5933,77.2508`
- `radius=300`
- `type=tourist_attraction`
- `key=API_KEY`

**What we extract per result:**
- name
- lat, lng (from `geometry.location`)
- place_id (for later detail fetch if needed)
- rating, user_ratings_total (useful for prioritizing spots)

### Merging Strategy

Multiple sources will return overlapping results. Deduplication:

1. Cluster all discovered spots by proximity (within 20m = same spot)
2. Prefer Wikidata name > Google Places name > OSM name
3. Prefer Google Places lat/lng (most precise for navigation) > OSM > Wikidata
4. Keep union of all unique spots across sources
5. Discard spots clearly outside the monument (e.g., nearby restaurants)

### LLM-Assisted Spot Discovery (Agent 1: Spot Discoverer)

After API-based discovery, run an LLM pass to catch spots the APIs missed:

```
Agent: spot-discoverer
Model: Claude (Sonnet — fast, cheap, good enough for this)
Input: {
  monument_name,
  spots_found_so_far: [...names...],
  wikipedia_article_text (fetched in parallel)
}
Prompt: "Given this monument and the Wikipedia article about it,
         identify any notable sub-locations, buildings, gardens,
         gates, or structures within the complex that are NOT
         already in the list. For each, provide the commonly
         used name. Do NOT invent locations — only list those
         explicitly mentioned in the article."
Output: list of additional spot names (lat/lng looked up via geocoding)
```

For any new spots found this way, geocode them using:
- **Nominatim API** (free): `https://nominatim.openstreetmap.org/search?q=Isa+Khan+Tomb+Delhi&format=json`
- **Google Geocoding API** (fallback): `https://maps.googleapis.com/maps/api/geocode/json?address=...`

### Output of Phase 2
```json
{
  "monument_slug": "humayuns-tomb",
  "spots": [
    {
      "id": "main-gateway",
      "name": "Main Gateway (West Gate)",
      "lat": 28.5930,
      "lng": 77.2505,
      "source": "overpass+google_places",
      "wikidata_qid": null
    },
    {
      "id": "isa-khans-tomb",
      "name": "Isa Khan's Tomb",
      "lat": 28.5925,
      "lng": 77.2513,
      "source": "wikidata+google_places",
      "wikidata_qid": "Q6079589"
    },
    {
      "id": "main-tomb-chamber",
      "name": "Main Tomb of Humayun",
      "lat": 28.5934,
      "lng": 77.2508,
      "source": "wikidata+overpass+google_places",
      "wikidata_qid": null
    }
  ]
}
```

---

## 7. Phase 3: Fetch Raw Content

### Goal
For each monument (and where possible, each spot), collect raw textual content from multiple sources. Store raw — do NOT process yet.

### Sources and APIs

All sources are fetched **in parallel** per monument.

#### 6.1 Wikipedia API

**Endpoint:** `https://en.wikipedia.org/w/api.php`

**Two calls:**

1. **Full article text** (for the monument):
   - `action=query&titles=Humayun's_Tomb&prop=extracts&explaintext=true`
   - Returns: plain text of the full article (~2,000-5,000 words for major monuments)

2. **Individual spot articles** (for sub-locations that have their own Wikipedia pages):
   - Same API, different title (e.g., `Isa_Khan's_Tomb`)
   - Not all spots will have dedicated articles — that's fine

**What we store:** Full plain text per article.

#### 6.2 Wikidata Structured Data

Already partially fetched in Phase 1. In Phase 3, do a deeper pull:

- Timeline events connected to the monument (P793 "significant event")
- Notable people buried/associated (P119 "place of burial" reverse lookup)
- Materials used (P186)
- Dimensions (P2048 height, P2049 width)
- Architectural elements

#### 6.3 UNESCO World Heritage Centre

**Target URL pattern:** `https://whc.unesco.org/en/list/{unesco_id}/`

**Method:** HTTP fetch + HTML-to-text extraction (not a formal API).

**What we extract:**
- Brief description
- Statement of Outstanding Universal Value (OUV) — this is rich, curated content
- Criteria under which it was inscribed
- Integrity/authenticity assessments
- Date of inscription

**Rate limiting:** Be respectful — 1 request per monument, cache aggressively.

#### 6.4 Archaeological Survey of India (ASI)

**Target:** `https://asi.nic.in/` — search by monument name.

**Method:** HTTP fetch + HTML extraction. No formal API exists.

**What we extract:**
- Official ASI description
- Ticketed monument details
- Conservation notes

**Caveat:** ASI's site is poorly structured. This source may yield thin results for some monuments. It's supplementary, not primary.

#### 6.5 Google Knowledge Graph API

Already used in Phase 1 as fallback. If we got a result, store the `detailedDescription` field — it often contains a concise, well-written paragraph sourced from Wikipedia or other encyclopedias.

#### 6.6 Wikimedia Commons (Images & Metadata)

**Endpoint:** `https://commons.wikimedia.org/w/api.php`

**Query:** `action=query&generator=images&titles=Humayun's_Tomb&prop=imageinfo&iiprop=url|extmetadata`

**What we extract:**
- Image URLs (for spot matching and future UI use)
- Image descriptions/captions (sometimes contain useful historical notes)
- Categories (help identify what's depicted)

We do NOT use these images in the bundle directly — we store URLs and metadata for optional future use.

#### 6.7 Sahapedia (Indian Heritage — Conditional)

**Target:** `https://www.sahapedia.org/` — search by monument name.

**Method:** HTTP fetch. No public API.

**What we extract:**
- Long-form essays on cultural significance
- Architectural analysis
- Oral history / folk narratives

**Conditional:** Only crawl for Indian monuments. Sahapedia has deep, unique content not found elsewhere — especially folk stories and cultural context that add narration depth.

### Raw Content Storage

```
data/raw/<monument-slug>/
├── wikidata.json           # structured data from Wikidata
├── wikipedia_monument.txt  # full article text
├── wikipedia_spots/        # per-spot articles (where they exist)
│   ├── isa-khans-tomb.txt
│   └── ...
├── unesco.txt              # UNESCO description + OUV
├── asi.txt                 # ASI description
├── knowledge_graph.json    # Google KG result
├── wikimedia_commons.json  # image metadata
├── sahapedia.txt           # Sahapedia essay (if applicable)
└── fetch_manifest.json     # which sources succeeded/failed, timestamps
```

`fetch_manifest.json` tracks:
```json
{
  "monument": "humayuns-tomb",
  "fetched_at": "2026-02-16T10:30:00Z",
  "sources": {
    "wikidata": { "status": "success", "file": "wikidata.json" },
    "wikipedia": { "status": "success", "file": "wikipedia_monument.txt", "word_count": 3420 },
    "unesco": { "status": "success", "file": "unesco.txt", "word_count": 890 },
    "asi": { "status": "failed", "error": "404 not found" },
    "sahapedia": { "status": "success", "file": "sahapedia.txt", "word_count": 2100 }
  },
  "total_raw_words": 8230
}
```

---

## 8. Phase 4: LLM Enrichment (Agents)

### Goal
Transform raw content into structured, narration-ready content per spot. This is where the data becomes a tour.

### Agent Architecture

We spin up **multiple Claude agents**, each with a specific role. Agents run in parallel where possible.

```
                    ┌─────────────────────┐
                    │  Agent 0:           │
                    │  MONUMENT HISTORIAN  │
                    │                     │
                    │  Reads ALL raw      │
                    │  content. Produces  │
                    │  monument-level     │
                    │  overview, timeline,│
                    │  and figures list.  │
                    └──────────┬──────────┘
                               │
                               │ monument overview + timeline
                               │ (needed as shared context by spot agents)
                               ▼
        ┌──────────────────────────────────────────────┐
        │                                              │
        ▼                  ▼                  ▼        │
┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  Agent 1:    │  │  Agent 2:    │  │  Agent N:    │  │
│  SPOT        │  │  SPOT        │  │  SPOT        │  │
│  NARRATOR    │  │  NARRATOR    │  │  NARRATOR    │  │
│  (Main Gate) │  │  (Isa Khan)  │  │  (Tomb)      │  │
│              │  │              │  │              │  │
│  Per-spot    │  │  Per-spot    │  │  Per-spot    │  │
│  enrichment  │  │  enrichment  │  │  enrichment  │  │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘  │
       │                 │                 │           │
       └─────────────────┴─────────────────┘           │
                         │                             │
                         ▼                             │
               ┌──────────────────┐                    │
               │  Agent N+1:      │                    │
               │  ROUTE PLANNER   │◄───────────────────┘
               │                  │
               │  Orders spots,   │
               │  writes walking  │
               │  transitions     │
               └──────────────────┘
```

### Agent 0: Monument Historian

```
Model:   Claude Sonnet (fast, sufficient for summarization)
Input:   All raw content files for the monument
Output:  monument_overview.json

Prompt (summary):
  "You are a historian. Given the following source materials about
   {monument_name}, produce:

   1. overview_narration: A 2-3 minute spoken introduction to the
      monument (300-450 words). Written in a warm, conversational
      tour-guide voice. Cover: what this place is, who built it,
      when, why it matters.

   2. timeline: An array of {year, event, description} objects
      covering the monument's history from construction to present.

   3. figures: An array of {name, role, description} for key
      historical people connected to this monument.

   4. cultural_significance: 2-3 paragraphs on architectural
      influence, cultural meaning, and legacy.

   Rules:
   - ONLY use facts from the provided sources
   - If sources conflict, note the conflict
   - Cite which source each major fact comes from
   - Write narration for spoken delivery, not reading"
```

**Output schema:**
```json
{
  "overview_narration": "string (300-450 words)",
  "timeline": [
    { "year": "1565", "event": "Construction begins", "description": "...", "source": "wikipedia" }
  ],
  "figures": [
    { "name": "Mirak Mirza Ghiyas", "role": "architect", "description": "...", "source": "wikipedia" }
  ],
  "cultural_significance": "string",
  "confidence": "high|medium|low",
  "source_conflicts": []
}
```

### Agent 1-N: Spot Narrators (one per spot, run in parallel)

```
Model:   Claude Sonnet
Input:
  - Raw content mentioning this spot (extracted sections from Wikipedia, etc.)
  - Monument overview + timeline from Agent 0 (for shared context)
  - Spot metadata (name, lat/lng, type)
Output:  spot_enriched.json

Prompt (summary):
  "You are a tour guide narrator at {monument_name}. You are
   preparing content for the stop: {spot_name}.

   Monument context (for reference, do NOT repeat the overview):
   {monument_overview}
   {monument_timeline}

   Source material about this specific spot:
   {raw_content_for_spot}

   Produce:

   1. narration_text: A spoken narration for this spot.
      Duration target: {target_minutes} minutes (~{target_words} words).
      Make it vivid, conversational, and story-driven.

   2. stories: 2-4 distinct stories or anecdotes about this spot.
      Each story should have: title, narration_text, type
      (history | architecture | legend | anecdote), estimated
      duration in seconds, and source citations.

   3. architectural_notes: Physical description — materials,
      style, notable features, what to look at.

   4. visual_anchors: 5-8 short descriptions of things a visitor
      would photograph or notice at this spot. These are used to
      match user camera images to context.
      Examples: 'red sandstone and white marble facade',
      'pointed iwan arches', 'octagonal plan'.

   5. visitor_context: One-line practical note (e.g., 'shoes
      must be removed before entering').

   Rules:
   - ONLY use facts from the provided sources
   - Flag uncertain claims with [UNVERIFIED]
   - Write for spoken delivery, not reading
   - Do not start with 'Welcome to...' for every spot (vary openings)
   - Include sensory details (what you'd see, feel, hear)"
```

**Narration budget allocation per spot (passed as target_minutes):**

```
Spot importance     Target     Words
────────────────    ──────     ─────
Primary attraction  5-6 min    750-900
Major sub-site      3-4 min    450-600
Minor point         2-3 min    300-450
Transitional        1-2 min    150-300
```

Importance is determined by:
- Is it the main monument? → Primary
- Does it have its own Wikipedia article? → Major
- Does it have a Wikidata QID? → Major
- Found only via OSM/Places? → Minor

**Output schema per spot:**
```json
{
  "spot_id": "isa-khans-tomb",
  "spot_name": "Isa Khan's Tomb",
  "narration_text": "string (target word count)",
  "narration_duration_seconds": 240,
  "stories": [
    {
      "title": "The Noble Who Preceded the Emperor",
      "narration_text": "string",
      "type": "history",
      "duration_seconds": 90,
      "sources": ["wikipedia"]
    }
  ],
  "architectural_notes": "string",
  "visual_anchors": [
    "octagonal tomb with verandahs on each side",
    "grey quartzite and red sandstone exterior",
    "blue tile decoration on the dome"
  ],
  "visitor_context": "Open area, no entry restrictions",
  "confidence": "high",
  "unverified_claims": []
}
```

### Agent N+1: Route Planner

```
Model:   Claude Haiku (lightweight, this is a simple task)
Input:
  - All spots with lat/lng
  - Monument entry point (main gate) as starting spot
Output:  walking_route.json

Prompt (summary):
  "Given these spots at {monument_name} with their coordinates,
   determine the optimal walking order starting from the main
   entry point. For each transition between spots, write a brief
   walking direction (1-2 sentences) and estimate walking time
   in seconds.

   Spots: {spots_with_latlng}

   Constraints:
   - Start at the main gate/entry
   - End at or near the main monument (climax of the tour)
   - Minimize backtracking
   - Group nearby spots"
```

**Output:**
```json
{
  "route": [
    {
      "spot_id": "main-gateway",
      "order": 1,
      "transition_from_previous": null,
      "walking_seconds": 0
    },
    {
      "spot_id": "bu-halimas-garden",
      "order": 2,
      "transition_from_previous": "As you pass through the gateway, you'll see a garden to your right. Walk along the path — this is Bu Halima's Garden.",
      "walking_seconds": 60
    }
  ],
  "total_walking_minutes": 12,
  "total_tour_minutes_with_narration": 38
}
```

---

## 9. Phase 5: Validate and Assemble Bundle

### Validation Checks

Run programmatically (no LLM needed):

| Check | Action on Failure |
|-------|------------------|
| Total narration duration within 30-40 min target | If under: flag spots with thin content for re-enrichment with higher word target. If over: flag for trimming. |
| All spots have lat/lng | If missing: drop spot or geocode by name |
| All spots have at least 1 story | If missing: re-run spot narrator with broader context |
| All lat/lngs fall within 500m of monument center | If outside: likely wrong spot, drop it |
| No [UNVERIFIED] claims in primary narration | Flag for human review (don't block) |
| Walking route visits all spots | If orphan spots: re-run route planner |
| Source citations present on all major facts | Flag if missing |

### Assembly

Merge all agent outputs into a single bundle:

```
data/bundles/<monument-slug>/
├── bundle.json             # the complete bundle (see schema below)
├── raw/                    # symlink or copy of raw fetched content
└── enrichment_log.json     # agent run details, token usage, timing
```

---

## 10. Final Bundle Schema

```json
{
  "version": "1.0",
  "generated_at": "2026-02-16T12:00:00Z",
  "pipeline_version": "0.1.0",

  "monument": {
    "id": "humayuns-tomb",
    "name": "Humayun's Tomb",
    "wikidata_qid": "Q320005",
    "center": { "lat": 28.5933, "lng": 77.2508 },
    "city": "New Delhi",
    "country": "India",
    "inception": "1572",
    "architect": "Mirak Mirza Ghiyas",
    "architectural_style": "Mughal architecture",
    "unesco_id": "232",
    "heritage_status": "UNESCO World Heritage Site"
  },

  "overview": {
    "narration_text": "Welcome to Humayun's Tomb, one of the...",
    "narration_duration_seconds": 150,
    "cultural_significance": "...",
    "timeline": [
      { "year": "1565", "event": "Construction begins", "description": "..." }
    ],
    "figures": [
      { "name": "Humayun", "role": "Mughal Emperor (buried here)", "description": "..." },
      { "name": "Hamida Banu Begum", "role": "Commissioned the tomb", "description": "..." },
      { "name": "Mirak Mirza Ghiyas", "role": "Architect", "description": "..." }
    ]
  },

  "spots": [
    {
      "id": "main-gateway",
      "name": "Main Gateway (West Gate)",
      "lat": 28.5930,
      "lng": 77.2505,
      "narration_order": 1,
      "walking_from_previous": null,
      "walking_seconds_from_previous": 0,
      "narration_text": "...",
      "narration_duration_seconds": 180,
      "stories": [
        {
          "title": "...",
          "narration_text": "...",
          "type": "history",
          "duration_seconds": 90,
          "sources": ["wikipedia", "unesco"]
        }
      ],
      "architectural_notes": "...",
      "visual_anchors": [
        "tall double-height arched entrance",
        "red sandstone with white marble inlay"
      ],
      "visitor_context": "Entry point — tickets checked here"
    }
  ],

  "route": {
    "total_walking_minutes": 12,
    "total_narration_minutes": 36,
    "total_tour_minutes": 48,
    "spot_order": ["main-gateway", "bu-halimas-garden", "isa-khans-tomb", "..."]
  },

  "sources": {
    "wikipedia": { "url": "https://en.wikipedia.org/wiki/Humayun%27s_Tomb", "fetched_at": "..." },
    "unesco": { "url": "https://whc.unesco.org/en/list/232/", "fetched_at": "..." },
    "wikidata": { "qid": "Q320005", "fetched_at": "..." }
  },

  "quality": {
    "confidence": "high",
    "total_source_words": 8230,
    "total_narration_words": 5400,
    "spots_with_thin_content": [],
    "unverified_claims": [],
    "human_reviewed": false
  }
}
```

---

## 11. Runtime Architecture — Multi-User Concurrency

This section describes how the backend serves multiple concurrent users using the pre-onboarded bundles. It connects the onboarding pipeline (this document) to the PRD's WebSocket-based runtime.

### 10.1 Core Principle: Shared Bundle, Isolated Sessions

The bundle is **read-only shared data**. Each user gets their own **session** with independent state. The bundle is like a textbook — every student has the same textbook, but each is on a different page, asking different questions.

```
Monument Bundle (read-only, loaded once into memory)
┌─────────────────────────────────┐
│  humayuns-tomb/bundle.json      │
│  5,400 words, 7 spots           │
│  Same for ALL users             │
└─────────────────────────────────┘
        │
        │  referenced by
        │
        ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  Session A   │  │  Session B   │  │  Session C   │
│  (User 1)    │  │  (User 2)    │  │  (User 3)    │
│              │  │              │  │              │
│  WebSocket 1 │  │  WebSocket 2 │  │  WebSocket 3 │
│  LLM context │  │  LLM context │  │  LLM context │
│  Position    │  │  Position    │  │  Position    │
│  History     │  │  History     │  │  History     │
└──────────────┘  └──────────────┘  └──────────────┘
```

### 10.2 Session Object

When a user taps "Start Tour", the server creates a session:

```
Session {
  session_id:        "abc-123"
  user_id:           "user-456"
  monument_id:       "humayuns-tomb"
  websocket:         <ws connection>

  // Tour state
  current_spot_id:   "isa-khans-tomb"
  spots_visited:     ["main-gateway", "bu-halimas-garden", "isa-khans-tomb"]
  spots_remaining:   ["main-tomb", ...]
  narration_seq:     47

  // LLM conversation history (per-user, independent)
  conversation_history: [
    { role: "system", content: "<monument overview + current spot context>" },
    { role: "assistant", content: "Welcome to Humayun's Tomb..." },
    { role: "user", content: "Who is buried here besides Humayun?" },
    { role: "assistant", content: "Great question! Besides Humayun..." }
  ]

  // Active stream handle (for interrupt cancellation)
  active_stream:     <AbortController>
}
```

### 10.3 How LLM Calls Work Per User

Each LLM call is **stateless from the LLM's perspective**. There is no persistent context living on Claude's servers. The backend reconstructs context for every call:

```
User 2 asks "What's that dome?"
         │
         ▼
Server builds the LLM request for THIS user only:
{
  messages: [
    {
      role: "system",
      content: `
        You are a guide at Humayun's Tomb.
        Visitor is at: Isa Khan's Tomb.

        About this spot:
        ${bundle.spots["isa-khans-tomb"].narration_text}
        ${bundle.spots["isa-khans-tomb"].architectural_notes}

        Visual anchors:
        ${bundle.spots["isa-khans-tomb"].visual_anchors}
      `
    },
    // THIS user's conversation history only
    { role: "assistant", content: "This tomb predates Humayun's..." },
    { role: "user", content: "What's that dome?" }
  ],
  stream: true
}
         │
         ▼
Claude API returns a streaming response
         │
         ▼
Server pipes chunks to THIS user's WebSocket only
```

Every user triggers **independent LLM API calls**. User 1's question does not affect User 2's context. Completely isolated.

### 10.4 Bundle Loading and Caching

```
Server memory layout:

  Bundle cache (shared, read-only):
    "humayuns-tomb" → 50KB in memory (one copy, serves all users here)
    "red-fort"      → 55KB in memory (one copy)
    "qutub-minar"   → 45KB in memory (one copy)

  Active sessions (per-user):
    session-001 → { ws, history (3KB), state }  → User at Humayun's Tomb
    session-002 → { ws, history (5KB), state }  → User at Humayun's Tomb
    session-003 → { ws, history (2KB), state }  → User at Red Fort
    ...
    session-100 → { ws, history (4KB), state }  → User at Humayun's Tomb
```

Bundles are loaded into memory on first request for that monument (or at server startup for popular monuments). A bundle is ~50-100KB — even 1,000 monuments is only ~100MB of memory.

### 10.5 Conversation History Management

The conversation history per session cannot grow forever — it would blow up the context window and cost. Strategy:

```
conversation_history per session:

  ALWAYS included (rebuilt each call):
    - System prompt with current spot's bundle content
    - Monument overview (compressed to ~200 words)

  SLIDING WINDOW:
    - Last 10-15 exchanges (user question + assistant response)
    - Older exchanges are summarized or dropped

  WHEN USER MOVES TO NEW SPOT:
    - Spot context in system prompt swaps to new spot's data
    - History from previous spot compressed to a 1-line summary:
      "At Isa Khan's Tomb, you asked about the dome structure
       and learned it uses an octagonal design."
    - Keeps context relevant without blowing up token count
```

This keeps the context window per user roughly constant at **~3,000-4,000 tokens** regardless of how long the tour runs.

### 10.6 Scaling: 100+ Concurrent Users

```
100 users touring simultaneously
  → maybe 10 are actively triggering LLM calls at any moment
    (others are walking, listening to narration, idle)
  → 10 concurrent streaming requests to Claude API
```

| Resource | Impact | Notes |
|----------|--------|-------|
| Server memory | Minimal. 1,000 sessions ≈ 5-10MB. Bundles add ~50-100MB. | Not a bottleneck. |
| WebSocket connections | A single Node.js process handles 10,000+ concurrent connections easily. | Not a bottleneck. |
| LLM API concurrency | The real ceiling. Each active interaction = 1 streaming API call. | Claude API supports high concurrency per account. |
| LLM API cost | ~$0.01-0.03 per interaction (1-2K input tokens + 200-500 output tokens). | 1,000 interactions/day ≈ $10-30/day. |
| Latency | Each user gets their own streaming response. No queuing behind other users. | Independent calls, no contention. |

### 10.7 Horizontal Scaling

```
                    Load Balancer (sticky sessions)
                         │
           ┌─────────────┼─────────────┐
           ▼             ▼             ▼
      ┌─────────┐  ┌─────────┐  ┌─────────┐
      │ Server 1│  │ Server 2│  │ Server 3│
      │         │  │         │  │         │
      │ 300 ws  │  │ 300 ws  │  │ 300 ws  │
      │ sessions│  │ sessions│  │ sessions│
      └────┬────┘  └────┬────┘  └────┬────┘
           │             │             │
           │  Each server holds its    │
           │  sessions in memory       │
           │             │             │
           └─────────────┼─────────────┘
                         │
              ┌──────────┼──────────┐
              ▼          ▼          ▼
         Bundle       Claude      PostgreSQL
         Store        API         + PostGIS
         (Redis       (shared)    (shared)
          or S3)
                     Independent   Tour metadata,
         Shared      calls per    user accounts,
         across      session      session logs
         servers
```

**Key design choices:**
- **Sticky sessions**: WebSocket connections are long-lived. The load balancer routes a user to one server and they stay there for the tour duration. Session state lives in that server's memory.
- **Bundle store**: For single-server, bundles live on disk/memory. For multi-server, use Redis or S3 so all servers access the same bundles.
- **No shared session store needed** unless you need failover (user reconnects to a different server after disconnect). For MVP, sticky sessions + in-memory is sufficient.

### 10.8 Image Recognition at Runtime

When a user points their camera at something:

```
User points camera at a carved archway
         │
         ▼
┌──────────────────────────────┐
│ 1. Get user's lat/lng        │
│    → match to nearest spot   │
│    in bundle (within ~20m)   │
│    → "Main Tomb Chamber"     │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ 2. Build multimodal prompt:  │
│                              │
│  System: You are a guide at  │
│  {monument.name}. Visitor is │
│  at {current_spot.name}.     │
│                              │
│  Spot context:               │
│  {spot.narration_text}       │
│  {spot.architectural_notes}  │
│  {spot.stories[]}            │
│                              │
│  Visual anchors:             │
│  {spot.visual_anchors}       │
│                              │
│  Rules:                      │
│  - ONLY use info above       │
│  - If you can't match the    │
│    image to anything in your │
│    context, say so honestly  │
│                              │
│  User: [image] "What am I   │
│         looking at?"         │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ 3. Claude Vision responds:   │
│                              │
│  "That's one of the pointed  │
│  arches of the main chamber  │
│  — notice how it uses the    │
│  Persian 'iwan' form..."     │
│                              │
│  OR (if unrecognizable):     │
│                              │
│  "Hmm, I can't quite connect │
│  what I'm seeing to anything │
│  specific about this spot.   │
│  Try pointing at a carving   │
│  or architectural feature."  │
└──────────────────────────────┘
```

The **bundle's visual_anchors and architectural_notes** are what make this work. The model sees the image AND knows what's supposed to be at this location. No separate image recognition model needed — Claude Vision handles both visual understanding and contextual explanation in one call.

**GPS indoor accuracy workaround**: Inside a monument, GPS drifts. The server matches to the nearest spot within a 20m radius. If ambiguous, it includes context for 2-3 nearby spots in the prompt and lets the model figure out which one matches the image.

### 10.9 Cost Model at Runtime

| Interaction Type | Input Tokens | Output Tokens | Cost per Call |
|-----------------|-------------|---------------|---------------|
| Narration streaming (pre-baked, no LLM call) | 0 | 0 | $0.00 |
| Voice question | ~2,000 (system + history + STT text) | ~300 | ~$0.01 |
| Camera image query | ~3,000 (system + history + image) | ~300 | ~$0.02-0.03 |
| "Tell me more" / follow-up | ~2,000 | ~500 | ~$0.01 |

**Key insight**: The base narration (walking between spots, listening to pre-written narration text) does NOT require LLM calls. The bundle's narration_text is streamed directly. LLM calls only happen when the user **interacts** — asks a question, points the camera, or requests more detail. Most users will trigger 10-30 LLM calls per tour.

**Estimated cost per complete tour**: $0.10-0.50 per user (depending on how interactive they are).

---

## 12. How the Onboarding Pipeline Connects to Runtime

Summary of the full data flow from CLI input to user's earbuds:

```
ONBOARDING (this pipeline, runs offline)
─────────────────────────────────────────
CLI input: "Humayun's Tomb"
    → Phase 1-5 → bundle.json
    → Stored in data/bundles/ or uploaded to S3/Redis

DEPLOYMENT
──────────
bundle.json → loaded into backend server memory
monument center coords → inserted into PostGIS for nearest-tour queries

RUNTIME (PRD system, runs live)
───────────────────────────────
User opens app → GPS → POST /api/tour/nearest
    → PostGIS finds nearest monument → returns tour metadata
User taps "Start Tour" → WebSocket opens
    → Server loads bundle into session
    → Streams narration_text chunks from bundle (no LLM)
    → On interrupt (voice/camera) → LLM call with bundle context
    → On spot transition → swap to next spot's content
User ends tour → session destroyed
```

---

## 13. API Keys and Rate Limits

| Service | Auth | Free Tier | Rate Limit | Notes |
|---------|------|-----------|------------|-------|
| Wikidata SPARQL | None | Unlimited | Be polite (1 req/s) | Set a User-Agent header |
| Wikipedia API | None | Unlimited | 200 req/s | Set User-Agent |
| Overpass (OSM) | None | Unlimited | 2 concurrent, 10K/day | Use a local mirror for bulk |
| Google Places API | API Key | $200/mo free credit | 100 QPS | ~$0.032 per Nearby Search |
| Google Knowledge Graph | API Key | 100K calls/day free | 100 QPS | Very generous |
| Google Geocoding | API Key | $200/mo free credit | 50 QPS | $0.005 per request |
| Nominatim (OSM) | None | Free | 1 req/s strict | Use for small batches only |
| UNESCO WHC | None (scrape) | N/A | Be respectful | Cache aggressively |
| ASI | None (scrape) | N/A | Unreliable availability | Supplementary only |
| Sahapedia | None (scrape) | N/A | Be respectful | Indian monuments only |
| Claude API | API Key | N/A | Per-plan limits | Primary LLM for enrichment |
| Wikimedia Commons | None | Unlimited | 200 req/s | Set User-Agent |

**Estimated cost per monument:**
- Google APIs: ~$0.10-0.20 (Places + Geocoding)
- Claude (enrichment): ~$0.50-1.50 (depends on raw content volume and spot count)
- Everything else: Free
- **Total: ~$0.60-1.70 per monument**

---

## 14. Error Handling and Retry Strategy

| Failure | Strategy |
|---------|----------|
| Wikidata returns no result | Fall back to Knowledge Graph API. If that fails, ask user to provide Wikidata QID manually. |
| Wikipedia article doesn't exist | Monument is likely obscure. Proceed with whatever sources succeed. Flag as low-confidence. |
| Overpass API timeout | Retry once. If still fails, rely on Wikidata sub-parts + Google Places only. |
| Google Places returns no spots | The monument may be a single structure. Create a single spot at the center coordinates. |
| UNESCO page not found | Not all monuments are UNESCO sites. Skip gracefully. |
| ASI / Sahapedia scrape fails | These are supplementary. Log and continue. |
| LLM agent produces thin content | Check word count. If under target, re-run with explicit instruction to expand. Max 2 retries. |
| LLM agent hallucinates (invents facts) | The [UNVERIFIED] flagging helps. Validation phase catches unflagged issues by cross-referencing dates/names against Wikidata structured data. |
| Geocoding returns wrong location | Validate: result must be within 1km of monument center. If not, discard. |

---

## 15. CLI Interface

```
# Onboard a single monument
$ python -m pipeline.onboard "Humayun's Tomb"

# Onboard multiple monuments
$ python -m pipeline.onboard "Humayun's Tomb" "Red Fort" "Qutub Minar"

# Onboard from a file (one monument name per line)
$ python -m pipeline.onboard --file monuments.txt

# Re-enrich only (skip fetching, use cached raw data)
$ python -m pipeline.onboard "Humayun's Tomb" --skip-fetch

# Validate an existing bundle
$ python -m pipeline.onboard "Humayun's Tomb" --validate-only

# Force re-fetch all sources
$ python -m pipeline.onboard "Humayun's Tomb" --force-fetch
```

Output during execution:
```
[humayuns-tomb] Phase 1: Resolving entity...
[humayuns-tomb]   → Wikidata Q320005, coords 28.5933, 77.2508
[humayuns-tomb] Phase 2: Discovering spots...
[humayuns-tomb]   → 7 spots found (3 Wikidata, 5 Overpass, 4 Places → 7 unique)
[humayuns-tomb] Phase 3: Fetching raw content...
[humayuns-tomb]   → wikipedia: 3,420 words ✓
[humayuns-tomb]   → unesco: 890 words ✓
[humayuns-tomb]   → asi: failed (404) ✗
[humayuns-tomb]   → sahapedia: 2,100 words ✓
[humayuns-tomb]   → Total raw: 8,230 words
[humayuns-tomb] Phase 4: Enriching with LLM agents...
[humayuns-tomb]   → Agent 0 (historian): overview + timeline ✓ (1.2s)
[humayuns-tomb]   → Agent 1-7 (spot narrators): 7/7 complete ✓ (parallel, 4.8s)
[humayuns-tomb]   → Agent 8 (route planner): walking route ✓ (0.6s)
[humayuns-tomb] Phase 5: Validating...
[humayuns-tomb]   → Total narration: 36 min (target: 30-40) ✓
[humayuns-tomb]   → All spots have lat/lng ✓
[humayuns-tomb]   → All spots have stories ✓
[humayuns-tomb]   → 0 unverified claims ✓
[humayuns-tomb] ✓ Bundle written to data/bundles/humayuns-tomb/bundle.json
[humayuns-tomb]   5,400 words | 7 spots | 36 min narration | $0.82 cost
```

---

## 16. Directory Structure

```
pipeline/                           # Python — onboarding pipeline
├── __main__.py                     # CLI entry point (click)
├── onboard.py                      # main orchestrator
├── phases/
│   ├── resolve.py                  # Phase 1: entity resolution
│   ├── discover.py                 # Phase 2: spot discovery
│   ├── fetch.py                    # Phase 3: async raw content fetching
│   ├── enrich.py                   # Phase 4: LLM agent orchestration
│   └── validate.py                 # Phase 5: validation & assembly
├── agents/
│   ├── historian.py                # Agent 0: monument overview
│   ├── spot_narrator.py            # Agent 1-N: per-spot enrichment
│   └── route_planner.py            # Agent N+1: walking route
├── sources/
│   ├── wikidata.py                 # Wikidata SPARQL client (SPARQLWrapper)
│   ├── wikipedia.py                # Wikipedia API client (httpx)
│   ├── overpass.py                 # OpenStreetMap Overpass client (httpx)
│   ├── google_places.py            # Google Places API client (httpx)
│   ├── google_kg.py                # Google Knowledge Graph client (httpx)
│   ├── geocoder.py                 # Nominatim + Google Geocoding (httpx)
│   ├── unesco.py                   # UNESCO WHC scraper (httpx + BeautifulSoup)
│   ├── asi.py                      # ASI scraper (httpx + BeautifulSoup)
│   ├── sahapedia.py                # Sahapedia scraper (httpx + BeautifulSoup)
│   └── wikimedia.py                # Wikimedia Commons client (httpx)
├── models/
│   ├── bundle.py                   # Pydantic models for bundle schema
│   ├── spot.py                     # Pydantic models for spot data
│   └── raw.py                      # Pydantic models for raw fetch results
├── utils/
│   ├── dedup.py                    # Spot deduplication by proximity
│   ├── slugify.py                  # Name → URL-safe slug
│   └── narration_budget.py         # Word count targets per spot
├── config.py                       # API keys, rate limits, defaults
└── requirements.txt                # Python dependencies

BE/                                 # Node.js/TypeScript — runtime backend
├── src/
│   ├── server.ts                   # Fastify + WebSocket setup
│   ├── routes/
│   │   └── tour.ts                 # REST: POST /api/tour/nearest, GET /api/tour/:id
│   ├── ws/
│   │   ├── handler.ts              # WebSocket connection lifecycle
│   │   └── interrupt.ts            # Interrupt processing (voice/camera/action)
│   ├── tour/
│   │   ├── engine.ts               # Narration streaming, spot transitions
│   │   ├── session.ts              # Per-user session management
│   │   └── bundle-loader.ts        # Loads monument bundles into memory
│   ├── llm/
│   │   ├── claude.ts               # Claude API wrapper (streaming + abort)
│   │   └── context-builder.ts      # Builds LLM prompt from bundle + history
│   ├── geo/
│   │   └── nearest.ts              # PostGIS queries for nearest monument
│   └── types/
│       └── bundle.ts               # TypeScript types matching bundle.json schema
├── package.json
└── tsconfig.json

FE/                                 # React Native — mobile app (existing)
└── ...

data/
├── raw/                            # Phase 3 output (cached, written by pipeline)
│   └── <monument-slug>/
├── bundles/                        # Phase 5 output (read by BE at runtime)
│   └── <monument-slug>/
│       └── bundle.json
└── logs/                           # Per-run pipeline logs and cost tracking
```

---

## 17. Open Questions / Future Considerations

| Question | Notes |
|----------|-------|
| Should bundles be versioned? | If a monument's Wikipedia article updates, we might want to re-onboard. A version field + diff would help. |
| How to handle monuments with very little online data? | Some small monuments may only yield 500 words of raw content. The LLM can only narrate what it's given. Consider a minimum viability threshold (e.g., 1,000 raw words minimum to produce a bundle). |
| Multi-language support? | Wikipedia and Wikidata support many languages. The pipeline could fetch content in the user's language. This is a future enhancement — start with English. |
| Human review workflow? | The `quality.human_reviewed` flag exists in the bundle. A review tool could highlight [UNVERIFIED] claims, thin spots, and low-confidence sections for manual editing. |
| Audio pre-generation? | The PRD mentions TTS (ElevenLabs/OpenAI). Should we pre-generate audio during onboarding instead of runtime TTS? Tradeoff: larger bundles (~50MB with audio) vs. lower runtime latency. |
| Image reference library? | For better camera matching, we could download reference images from Wikimedia Commons during onboarding and include them in the bundle for visual similarity matching. |
