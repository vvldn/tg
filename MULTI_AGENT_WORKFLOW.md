# Multi-Agent Build Workflow

## The Core Problem

Three codebases, two languages, one shared data contract. The critical path is:

```
Define contracts (schemas, APIs, WS protocol)
        │
        │  contracts locked
        │
        ├─────────────────────────────────────┐
        │                  │                  │
        ▼                  ▼                  ▼
   Pipeline (Py)     Backend (TS)      Frontend (RN)
   builds bundles    serves tours       renders tour
        │                  │                  │
        └──────────┬───────┘                  │
                   │                          │
              Integration                     │
            (bundle → BE)                     │
                   │                          │
                   └──────────┬───────────────┘
                              │
                         Full E2E
```

Contracts must be defined BEFORE parallel work begins. Everything else is independent.

---

## Team Structure

```
┌───────────────────────────────────────────────────────────────┐
│                                                               │
│   TEAM LEAD (you / orchestrator agent)                        │
│   ──────────────────────────────────                          │
│   Owns: contracts/, CLAUDE.md, task list                      │
│   Does: defines schemas, API specs, reviews, integrates       │
│   Starts: Phase 0 (contracts)                                 │
│   Unblocks: everyone else                                     │
│                                                               │
│   ┌─────────────────┐ ┌──────────────────┐ ┌───────────────┐ │
│   │  pipeline-dev   │ │   backend-dev    │ │  frontend-dev │ │
│   │  ─────────────  │ │  ──────────────  │ │  ───────────  │ │
│   │  Lang: Python   │ │  Lang: TypeScript│ │  Lang: TS/RN  │ │
│   │  Owns: pipeline/│ │  Owns: BE/       │ │  Owns: FE/    │ │
│   │  Reads:         │ │  Reads:          │ │  Reads:       │ │
│   │   contracts/    │ │   contracts/     │ │   contracts/  │ │
│   │   bundle.schema │ │   bundle.schema  │ │   api.spec    │ │
│   │                 │ │   api.spec       │ │   ws.spec     │ │
│   │  Writes:        │ │   ws.spec        │ │               │ │
│   │   data/bundles/ │ │                  │ │  Writes:      │ │
│   │                 │ │  Writes:         │ │   screens     │ │
│   │  Does NOT touch:│ │   REST endpoints │ │   WS client   │ │
│   │   BE/ or FE/    │ │   WS server      │ │   camera/mic  │ │
│   │                 │ │   LLM integration│ │               │ │
│   └─────────────────┘ │   TTS/STT proxy  │ │  Does NOT     │ │
│                       │                  │ │  touch:       │ │
│                       │  Does NOT touch: │ │   BE/ or      │ │
│                       │   pipeline/ or   │ │   pipeline/   │ │
│                       │   FE/            │ │               │ │
│                       └──────────────────┘ └───────────────┘ │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

### Why This Split

| Agent | Why isolated | Failure blast radius |
|---|---|---|
| pipeline-dev | Python-only. No runtime dependencies. Output is a JSON file. | Can't break BE or FE. Worst case: bad bundle data. |
| backend-dev | Node/TS. Consumes bundles, exposes APIs. | Can't break pipeline. FE depends on API shape (locked by contract). |
| frontend-dev | React Native. Consumes APIs, renders UI. | Can't break BE or pipeline. Only reads contracts. |

---

## Phase 0: Contracts (Team Lead, before anyone else starts)

The team lead creates all shared contracts in a `contracts/` directory. These are the **source of truth** that all agents reference. No agent may deviate from these without team lead approval.

### Directory

```
contracts/
├── bundle.schema.json          # JSON Schema for bundle.json
├── bundle.types.ts             # TypeScript types (copy into BE/FE)
├── bundle.types.py             # Pydantic models (copy into pipeline)
├── rest-api.md                 # REST endpoint specs
├── websocket-protocol.md       # WS message specs
└── test-fixtures/
    ├── humayuns-tomb.bundle.json   # A realistic test bundle (handcrafted)
    └── minimal.bundle.json         # Minimal valid bundle (1 spot)
```

### Contract 1: `bundle.schema.json`

This is the single most important file in the project. The pipeline writes it, the backend reads it.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "MonumentBundle",
  "type": "object",
  "required": ["version", "generated_at", "monument", "overview", "spots", "route", "sources", "quality"],
  "properties": {
    "version": { "type": "string", "const": "1.0" },
    "generated_at": { "type": "string", "format": "date-time" },
    "pipeline_version": { "type": "string" },

    "monument": {
      "type": "object",
      "required": ["id", "name", "center"],
      "properties": {
        "id":                  { "type": "string", "pattern": "^[a-z0-9-]+$" },
        "name":                { "type": "string" },
        "wikidata_qid":        { "type": ["string", "null"] },
        "center":              { "$ref": "#/$defs/LatLng" },
        "city":                { "type": ["string", "null"] },
        "country":             { "type": ["string", "null"] },
        "inception":           { "type": ["string", "null"] },
        "architect":           { "type": ["string", "null"] },
        "architectural_style": { "type": ["string", "null"] },
        "unesco_id":           { "type": ["string", "null"] },
        "heritage_status":     { "type": ["string", "null"] }
      }
    },

    "overview": {
      "type": "object",
      "required": ["narration_text", "narration_duration_seconds"],
      "properties": {
        "narration_text":             { "type": "string", "minLength": 100 },
        "narration_duration_seconds": { "type": "integer", "minimum": 30 },
        "cultural_significance":      { "type": ["string", "null"] },
        "timeline": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["year", "event"],
            "properties": {
              "year":        { "type": "string" },
              "event":       { "type": "string" },
              "description": { "type": "string" },
              "source":      { "type": "string" }
            }
          }
        },
        "figures": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["name", "role"],
            "properties": {
              "name":        { "type": "string" },
              "role":        { "type": "string" },
              "description": { "type": "string" },
              "source":      { "type": "string" }
            }
          }
        }
      }
    },

    "spots": {
      "type": "array",
      "minItems": 1,
      "items": { "$ref": "#/$defs/Spot" }
    },

    "route": {
      "type": "object",
      "required": ["spot_order"],
      "properties": {
        "total_walking_minutes":   { "type": "number" },
        "total_narration_minutes": { "type": "number" },
        "total_tour_minutes":      { "type": "number" },
        "spot_order":              { "type": "array", "items": { "type": "string" } }
      }
    },

    "sources": {
      "type": "object",
      "additionalProperties": {
        "type": "object",
        "properties": {
          "url":        { "type": "string" },
          "fetched_at": { "type": "string" },
          "qid":        { "type": "string" }
        }
      }
    },

    "quality": {
      "type": "object",
      "properties": {
        "confidence":             { "type": "string", "enum": ["high", "medium", "low"] },
        "total_source_words":     { "type": "integer" },
        "total_narration_words":  { "type": "integer" },
        "spots_with_thin_content":{ "type": "array", "items": { "type": "string" } },
        "unverified_claims":      { "type": "array", "items": { "type": "string" } },
        "human_reviewed":         { "type": "boolean" }
      }
    }
  },

  "$defs": {
    "LatLng": {
      "type": "object",
      "required": ["lat", "lng"],
      "properties": {
        "lat": { "type": "number", "minimum": -90, "maximum": 90 },
        "lng": { "type": "number", "minimum": -180, "maximum": 180 }
      }
    },
    "Story": {
      "type": "object",
      "required": ["title", "narration_text", "type"],
      "properties": {
        "title":            { "type": "string" },
        "narration_text":   { "type": "string" },
        "type":             { "type": "string", "enum": ["history", "architecture", "legend", "anecdote"] },
        "duration_seconds": { "type": "integer" },
        "sources":          { "type": "array", "items": { "type": "string" } }
      }
    },
    "Spot": {
      "type": "object",
      "required": ["id", "name", "lat", "lng", "narration_order", "narration_text", "narration_duration_seconds"],
      "properties": {
        "id":                             { "type": "string", "pattern": "^[a-z0-9-]+$" },
        "name":                           { "type": "string" },
        "lat":                            { "type": "number" },
        "lng":                            { "type": "number" },
        "narration_order":                { "type": "integer", "minimum": 1 },
        "walking_from_previous":          { "type": ["string", "null"] },
        "walking_seconds_from_previous":  { "type": "integer" },
        "narration_text":                 { "type": "string", "minLength": 50 },
        "narration_duration_seconds":     { "type": "integer" },
        "stories":                        { "type": "array", "items": { "$ref": "#/$defs/Story" } },
        "architectural_notes":            { "type": ["string", "null"] },
        "visual_anchors":                 { "type": "array", "items": { "type": "string" } },
        "visitor_context":                { "type": ["string", "null"] }
      }
    }
  }
}
```

### Contract 2: REST API (`rest-api.md`)

```
## POST /api/tour/nearest

Find the nearest monument with an onboarded tour.

Request:
  Content-Type: application/json
  {
    "lat": 28.5933,
    "lng": 77.2508
  }

Response 200:
  {
    "tour_id": "humayuns-tomb",
    "name": "Humayun's Tomb",
    "center": { "lat": 28.5933, "lng": 77.2508 },
    "distance_meters": 142,
    "city": "New Delhi",
    "country": "India",
    "heritage_status": "UNESCO World Heritage Site",
    "estimated_duration_minutes": 38,
    "spot_count": 7,
    "thumbnail_url": null
  }

Response 404:
  {
    "error": "no_tours_nearby",
    "message": "No tours found within 50km"
  }

---

## GET /api/tour/:tourId

Get full tour metadata (for Tour Ready screen). Does NOT include
narration content — that comes via WebSocket.

Response 200:
  {
    "tour_id": "humayuns-tomb",
    "name": "Humayun's Tomb",
    "center": { "lat": 28.5933, "lng": 77.2508 },
    "city": "New Delhi",
    "country": "India",
    "heritage_status": "UNESCO World Heritage Site",
    "inception": "1572",
    "architect": "Mirak Mirza Ghiyas",
    "architectural_style": "Mughal architecture",
    "estimated_duration_minutes": 38,
    "spot_count": 7,
    "spots_preview": [
      { "id": "main-gateway", "name": "Main Gateway (West Gate)", "order": 1 },
      { "id": "isa-khans-tomb", "name": "Isa Khan's Tomb", "order": 2 }
    ],
    "overview_text": "Humayun's Tomb is a...(first 200 chars)...",
    "thumbnail_url": null
  }

Response 404:
  {
    "error": "tour_not_found",
    "message": "No tour with id 'xyz'"
  }
```

### Contract 3: WebSocket Protocol (`websocket-protocol.md`)

```
## Connection

  URL: ws://<host>/ws/tour/:tourId
  No auth for MVP. Future: pass JWT as query param.

## Client → Server Messages

All messages are JSON with a `type` field.

### interrupt:voice
  {
    "type": "interrupt:voice",
    "id": "<uuid>",
    "audio": "<base64-encoded audio>",
    "format": "wav",
    "duration_ms": 3200,
    "sample_rate": 16000
  }

### interrupt:camera
  {
    "type": "interrupt:camera",
    "id": "<uuid>",
    "frame": "<base64-encoded jpeg>",
    "lat": 28.5933,
    "lng": 77.2508,
    "heading": 127.5,
    "text": "What am I looking at?"
  }
  Note: `text` is optional. If absent, backend uses default
  prompt "Describe what the user is looking at."

### interrupt:action
  {
    "type": "interrupt:action",
    "id": "<uuid>",
    "action": "pause" | "resume" | "repeat" | "skip" | "details"
  }

### location_update
  {
    "type": "location_update",
    "lat": 28.5933,
    "lng": 77.2508,
    "heading": 127.5,
    "speed": 1.2,
    "accuracy": 8.5
  }
  Sent every 5 seconds while touring. NOT an interrupt.
  Does not stop narration.

### tour_end
  {
    "type": "tour_end"
  }

---

## Server → Client Messages

### tour_start
  Sent immediately after WebSocket connects.
  {
    "type": "tour_start",
    "tour_id": "humayuns-tomb",
    "name": "Humayun's Tomb",
    "spots": [
      { "id": "main-gateway", "name": "Main Gateway", "order": 1 },
      ...
    ],
    "estimated_duration_minutes": 38
  }

### narration
  Streamed chunks of pre-baked narration text (from bundle).
  {
    "type": "narration",
    "seq": 1,
    "chunk": "Welcome to Humayun's Tomb, one of the finest ",
    "spot_id": "main-gateway",
    "is_final": false
  }
  `is_final: true` on the last chunk of a spot's narration.

### response
  Streamed chunks of LLM response to an interrupt.
  {
    "type": "response",
    "seq": 15,
    "chunk": "Great question! That dome uses a ",
    "ref_interrupt_id": "<uuid of the interrupt being answered>",
    "is_final": false
  }

### ack_interrupt
  Sent immediately when server receives an interrupt.
  {
    "type": "ack_interrupt",
    "interrupt_id": "<uuid>",
    "seq_stopped": 14
  }
  Client should discard any buffered chunks with seq > seq_stopped.

### stop_arrived
  Sent when location_update indicates user is within 20m of next spot.
  {
    "type": "stop_arrived",
    "spot_id": "isa-khans-tomb",
    "name": "Isa Khan's Tomb",
    "order": 2
  }
  After this, narration transitions to the new spot's content.

### tour_complete
  {
    "type": "tour_complete",
    "summary": {
      "duration_minutes": 42,
      "spots_visited": ["main-gateway", "isa-khans-tomb", "main-tomb"],
      "interactions": 12
    }
  }

### error
  {
    "type": "error",
    "code": "stt_failed" | "llm_timeout" | "invalid_message" | "internal",
    "message": "Speech-to-text failed. Please try again."
  }

---

## Audio Streaming (Server → Client)

Audio is sent as binary WebSocket frames (not JSON).
Each audio frame is preceded by a JSON metadata message:

### audio_meta
  {
    "type": "audio_meta",
    "seq": 15,
    "format": "mp3",
    "sample_rate": 24000,
    "chunk_index": 0,
    "is_final": false,
    "ref_type": "narration" | "response"
  }

The next binary frame after an audio_meta is the audio data.
Client plays audio chunks sequentially.

On interrupt: client stops audio playback immediately.
```

### Contract 4: Test Fixtures

The team lead creates a realistic `humayuns-tomb.bundle.json` fixture by hand (or semi-manually). This fixture is used by all three agents:

- **pipeline-dev**: validates that their output matches this shape
- **backend-dev**: loads this fixture to test their server without needing the pipeline
- **frontend-dev**: gets realistic data to render without needing the backend

---

## Phase 1: Parallel Implementation

Once contracts are locked, all three agents start simultaneously.

### Task Breakdown by Agent

```
pipeline-dev                    backend-dev                     frontend-dev
────────────                    ───────────                     ────────────

P1: Pydantic models from        B1: TS types from               F1: Navigation setup
    bundle.schema.json              bundle.schema.json              (React Navigation)

P2: Phase 1 — Wikidata          B2: Fastify server scaffold     F2: Locating screen
    resolver (SPARQL)               + health check                  + GPS permission

P3: Phase 2 — Spot discovery    B3: Bundle loader               F3: Tour Ready screen
    (Overpass, Places, LLM)         (read JSON, cache in mem)       (from GET /tour/:id)

P4: Phase 3 — Content fetchers  B4: REST endpoints              F4: WebSocket client
    (Wikipedia, UNESCO, etc.)       POST /tour/nearest              + connection mgr
    all async parallel              GET /tour/:id

P5: Phase 4 — LLM enrichment   B5: WebSocket handler           F5: Active Tour screen
    (historian, narrators,          connection lifecycle,           transcript display
     route planner)                 message routing                 + state machine

P6: Phase 5 — Validation &     B6: Tour engine                 F6: Interrupt buttons
    bundle assembly                 narration streaming             (PTT, camera, actions)
                                    from bundle text

P7: CLI interface (click)       B7: Interrupt handler           F7: Camera integration
                                    voice → STT → LLM              viewfinder + capture
                                    camera → Vision → LLM           + send frame
                                    action → pause/skip/etc

P8: Run on Humayun's Tomb      B8: LLM integration             F8: Audio playback
    validate real output            Claude streaming                 play TTS chunks
    matches fixture shape           + AbortController cancel        stop on interrupt

                                B9: TTS integration             F9: Location updates
                                    text → ElevenLabs/OpenAI        send GPS every 5s
                                    → audio chunk streaming

                                B10: Session management         F10: Tour Ended screen
                                     history, spot transitions       summary display
                                     context window mgmt
```

### Dependency Graph Within Each Agent

```
pipeline-dev:    P1 → [P2, P3, P4 in parallel] → P5 → P6 → P7 → P8

backend-dev:     B1 → B2 → B3 → B4 → B5 → B6 → B7 → B8 → B9 → B10
                                  ↑
                          (needs test fixture from contracts/)

frontend-dev:    F1 → F2 → F3 → F4 → F5 → F6 → [F7, F8, F9 in parallel] → F10
```

### Cross-Agent Dependencies

```
                pipeline-dev          backend-dev           frontend-dev
                     │                     │                     │
                     │    contracts/       │    contracts/       │
                     │◄───────────────────►│◄───────────────────►│
                     │  bundle.schema      │  rest-api.md        │
                     │  bundle.types.py    │  ws-protocol.md     │
                     │                     │  bundle.types.ts    │
                     │                     │                     │
   Phase 0 done ─────┼─────────────────────┼─────────────────────┤
                     │                     │                     │
                     ▼                     ▼                     ▼
                  PARALLEL              PARALLEL              PARALLEL
                  P1-P8                 B1-B10                F1-F10
                     │                     │                     │
                     │                     │                     │
                     │                     │                     │
   Integration ──────┼─────────────────────┤                     │
                     │                     │                     │
                     │  real bundle.json   │                     │
                     ├────────────────────►│                     │
                     │                     │                     │
                     │                     │  running server     │
                     │                     ├────────────────────►│
                     │                     │                     │
                     └─────────────────────┴─────────────────────┘
                                    E2E test
```

The key: **no agent blocks another during Phase 1.** They all work against the contracts and test fixtures. Real integration happens in Phase 2.

---

## Phase 2: Integration

### Step 1: Pipeline → Backend

```
pipeline-dev runs:
  $ python -m pipeline.onboard "Humayun's Tomb"
  → produces data/bundles/humayuns-tomb/bundle.json

backend-dev:
  → loads real bundle (not fixture)
  → verifies narration streaming works with real content
  → verifies LLM context building uses real spot data
```

### Step 2: Backend → Frontend

```
backend-dev starts server with real bundle loaded

frontend-dev:
  → points app at backend (localhost or LAN IP)
  → tests full flow:
    GPS spoof → nearest tour → start → narration displays
    → PTT interrupt → response streams
    → camera capture → vision response streams
    → end tour → summary
```

### Step 3: Full E2E

```
Pipeline → Bundle → Backend → Frontend → User

Test with GPX route simulation:
  1. Spoof GPS to monument entrance
  2. Start tour
  3. Narration plays (text + audio)
  4. Spoof walk to next spot
  5. stop_arrived triggers, narration transitions
  6. Point camera at Street View image
  7. Voice interrupt: "tell me more about the architect"
  8. Skip to next stop
  9. End tour
```

---

## Agent Instructions (what each agent's CLAUDE.md should say)

### pipeline-dev CLAUDE.md

```
You are building the monument data onboarding pipeline in Python.

YOUR SCOPE: pipeline/ directory and data/ directory only.
DO NOT modify BE/, FE/, or contracts/.

REFERENCE DOCS:
  - contracts/bundle.schema.json (your output MUST validate against this)
  - contracts/bundle.types.py (use these Pydantic models)
  - ONBOARDING_DESIGN.md (your full spec)

TECH STACK:
  Python 3.11+, httpx, BeautifulSoup, SPARQLWrapper, anthropic SDK,
  click, pydantic

VALIDATION RULE:
  After assembling a bundle, validate it against bundle.schema.json.
  If it fails, the pipeline should error — never produce invalid bundles.

TEST APPROACH:
  - Unit tests per source client (mock HTTP responses)
  - Unit tests per LLM agent (mock Claude responses)
  - Integration test: run pipeline on "Humayun's Tomb", validate output
    matches contracts/test-fixtures/humayuns-tomb.bundle.json structure
```

### backend-dev CLAUDE.md

```
You are building the runtime backend server in TypeScript.

YOUR SCOPE: BE/ directory only.
DO NOT modify pipeline/, FE/, or contracts/.

REFERENCE DOCS:
  - contracts/bundle.schema.json (you read these files)
  - contracts/bundle.types.ts (use these types)
  - contracts/rest-api.md (implement these endpoints exactly)
  - contracts/websocket-protocol.md (implement this protocol exactly)
  - PRD.md (understand the full user experience)
  - ONBOARDING_DESIGN.md sections 11-12 (runtime architecture)

TECH STACK:
  TypeScript, Fastify, ws (WebSocket), @anthropic-ai/sdk,
  pg + PostGIS (Drizzle ORM), node built-ins

BOOTSTRAP:
  Load contracts/test-fixtures/humayuns-tomb.bundle.json at startup
  for development. Real bundles come from data/bundles/ in production.

KEY BEHAVIORS:
  - Narration: stream bundle's narration_text as chunks (word-by-word
    or sentence-by-sentence), no LLM call needed
  - Interrupts: cancel active stream via AbortController, process
    new input, respond, then resume narration
  - Session isolation: each WebSocket = independent session with its
    own conversation history and position
  - Audio: call TTS API with text chunks, stream audio binary frames
    back to client after an audio_meta JSON frame
```

### frontend-dev CLAUDE.md

```
You are building the React Native mobile app.

YOUR SCOPE: FE/ directory only.
DO NOT modify pipeline/, BE/, or contracts/.

REFERENCE DOCS:
  - contracts/rest-api.md (call these endpoints)
  - contracts/websocket-protocol.md (implement this client)
  - PRD.md (screens, state machine, UX)

TECH STACK:
  React Native 0.84, TypeScript, React Navigation,
  react-native-camera or expo-camera, expo-location,
  expo-av (audio playback), built-in WebSocket API

STATE MACHINE:
  LOCATING → TOUR_READY → TOURING (NARRATING | PROCESSING) → TOUR_ENDED

KEY BEHAVIORS:
  - On interrupt sent: immediately stop displaying/playing narration,
    show "thinking" state, discard buffered chunks
  - On ack_interrupt received: discard chunks with seq > seq_stopped
  - Audio playback: receive audio_meta JSON, then binary audio frame,
    queue and play seamlessly
  - Debounce: 300ms on all interrupt buttons
  - Location updates: send every 5s while TOURING

MOCK MODE (for development without backend):
  - Create a MockWebSocket class that replays canned messages
    from contracts/test-fixtures/
  - Toggle via DEV_MOCK_WS=true env var
```

---

## File Structure After Phase 0

```
tg/
├── PRD.md                              # existing
├── ONBOARDING_DESIGN.md                # existing
├── MULTI_AGENT_WORKFLOW.md             # this file
│
├── contracts/                          # TEAM LEAD creates all of this
│   ├── bundle.schema.json              # JSON Schema
│   ├── bundle.types.ts                 # shared TS types (BE + FE)
│   ├── bundle.types.py                 # shared Pydantic models (pipeline)
│   ├── rest-api.md                     # REST endpoint specs
│   ├── websocket-protocol.md           # WS message specs
│   └── test-fixtures/
│       ├── humayuns-tomb.bundle.json   # realistic fixture
│       └── minimal.bundle.json         # minimal valid fixture
│
├── pipeline/                           # pipeline-dev owns this
│   ├── ... (per ONBOARDING_DESIGN.md §16)
│   └── CLAUDE.md
│
├── BE/                                 # backend-dev owns this
│   ├── ... (per ONBOARDING_DESIGN.md §16)
│   └── CLAUDE.md
│
├── FE/                                 # frontend-dev owns this
│   ├── ... (existing RN project)
│   └── CLAUDE.md
│
└── data/                               # shared output directory
    ├── raw/                            # pipeline writes
    ├── bundles/                        # pipeline writes, BE reads
    └── logs/                           # pipeline writes
```

---

## Task List (for team lead to create)

### Phase 0: Contracts (team lead, sequential)

| ID | Task | Blocks |
|----|------|--------|
| C1 | Write `bundle.schema.json` | P1, B1 |
| C2 | Write `bundle.types.ts` from schema | B1 |
| C3 | Write `bundle.types.py` from schema | P1 |
| C4 | Write `rest-api.md` spec | B4, F3 |
| C5 | Write `websocket-protocol.md` spec | B5, F4 |
| C6 | Create `humayuns-tomb.bundle.json` test fixture | P8, B3, F5 |
| C7 | Create `minimal.bundle.json` test fixture | P8, B3 |

### Phase 1: Pipeline (pipeline-dev, partially parallel)

| ID | Task | Depends On | Blocks |
|----|------|-----------|--------|
| P1 | Set up pipeline/ scaffold + Pydantic models | C3 | P2-P4 |
| P2 | Implement Phase 1: Wikidata resolver | P1 | P3 |
| P3 | Implement Phase 2: Spot discovery | P2 | P5 |
| P4 | Implement Phase 3: Content fetchers (all sources) | P1 | P5 |
| P5 | Implement Phase 4: LLM enrichment agents | P3, P4 | P6 |
| P6 | Implement Phase 5: Validation + bundle assembly | P5 | P7 |
| P7 | Implement CLI interface | P6 | P8 |
| P8 | Run on "Humayun's Tomb", validate output | P7, C6 | Integration |

### Phase 1: Backend (backend-dev, mostly sequential)

| ID | Task | Depends On | Blocks |
|----|------|-----------|--------|
| B1 | Set up BE/ scaffold (Fastify + TS config) + types | C2 | B2 |
| B2 | Health check endpoint + project structure | B1 | B3-B4 |
| B3 | Bundle loader (read JSON, cache, validate) | B2, C6 | B6 |
| B4 | REST endpoints (nearest + tour detail) | B2, C4 | Integration |
| B5 | WebSocket handler (connect, disconnect, routing) | B2, C5 | B6 |
| B6 | Tour engine: narration streaming from bundle text | B3, B5 | B7 |
| B7 | Interrupt handler: cancel + process + resume | B6 | B8 |
| B8 | LLM integration: Claude streaming + context builder | B7 | B9 |
| B9 | TTS integration: text → audio → binary WS frames | B8 | B10 |
| B10 | Session management: history, spot transitions | B8 | Integration |

### Phase 1: Frontend (frontend-dev, mostly sequential)

| ID | Task | Depends On | Blocks |
|----|------|-----------|--------|
| F1 | Navigation setup (React Navigation + screens) | - | F2 |
| F2 | Locating screen + GPS permission | F1 | F3 |
| F3 | Tour Ready screen (mock data, then REST) | F2, C4 | F4 |
| F4 | WebSocket client + connection manager | F3, C5 | F5 |
| F5 | Active Tour screen: transcript display + state machine | F4, C6 | F6 |
| F6 | Interrupt buttons (PTT mic, camera toggle, actions) | F5 | F7 |
| F7 | Camera integration (viewfinder + capture + send) | F6 | F10 |
| F8 | Audio playback (receive binary, queue, play, stop) | F5 | F10 |
| F9 | Location updates (send GPS every 5s) | F4 | F10 |
| F10 | Tour Ended screen + summary | F7, F8, F9 | Integration |

### Phase 2: Integration (team lead coordinates)

| ID | Task | Depends On |
|----|------|-----------|
| I1 | Pipeline produces real bundle, backend loads it | P8, B3 |
| I2 | Backend serves real narration, frontend displays it | I1, B6, F5 |
| I3 | Voice interrupt E2E (FE → BE STT → LLM → TTS → FE) | I2, B7, F6 |
| I4 | Camera interrupt E2E (FE → BE Vision → LLM → TTS → FE) | I2, B7, F7 |
| I5 | Location tracking E2E (FE GPS → BE spot transition → FE) | I2, B10, F9 |
| I6 | Full tour walkthrough with GPX spoofing | I3, I4, I5 |

---

## How to Launch This

```
Step 1: Team lead creates contracts/ (Phase 0)
        Estimated: 1-2 hours of focused work

Step 2: Spawn three agents in parallel:
        $ claude --team tg-build --name pipeline-dev  (general-purpose agent)
        $ claude --team tg-build --name backend-dev   (general-purpose agent)
        $ claude --team tg-build --name frontend-dev  (general-purpose agent)

Step 3: Assign Phase 1 tasks to each agent via task list

Step 4: Each agent works independently, referencing contracts/
        They do NOT need to communicate with each other.
        They only communicate with team lead if a contract is ambiguous.

Step 5: When all three complete Phase 1, team lead runs integration
```

---

## Risk Mitigation

| Risk | Mitigation |
|---|---|
| Contract turns out wrong mid-implementation | Team lead can update contracts/. Agents re-read. Changes should be additive (new fields) not breaking (renamed fields). |
| Pipeline produces bundles backend can't parse | JSON Schema validation on both sides. Pipeline validates output, backend validates input. Same schema. |
| WebSocket protocol mismatch between BE and FE | Both reference the same websocket-protocol.md. Test fixtures include sample message sequences. |
| One agent finishes way before others | Give them integration tasks or testing tasks for the slower agents' outputs. |
| Real API responses differ from test fixtures | Fixtures are based on real Wikidata/Wikipedia data. But always validate pipeline output against schema, not against fixture content. |
