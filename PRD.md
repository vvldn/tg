# Travel Guide App - PRD

## Overview

A real-time, AI-powered travel guide app. On launch, the app locates the user, fetches the nearest tour from the backend, and begins a guided narration. The user can interact via voice, camera, or button — any of which **interrupt** the current narration and shift context. The experience should feel like talking to a knowledgeable human guide walking beside you.

---

## Core User Flow

```
App Open
  │
  ▼
[LOCATING] ── get GPS ── send lat/long to backend
  │
  ▼
Backend returns nearest tour site + metadata
  │
  ▼
[TOUR READY] ── show tour card (name, distance, photo, "Start Tour")
  │
  ▼
User taps "Start Tour"
  │
  ▼
[TOURING] ── WebSocket opens ── backend begins streaming narration
  │
  ├── User speaks ──────► interrupt ► backend processes speech ► resumes/redirects narration
  ├── User points camera ► interrupt ► backend processes frame  ► describes what's seen
  ├── User taps button ──► interrupt ► backend pauses/resumes or triggers action
  │
  ▼
User ends tour or leaves geofence → [TOUR ENDED]
```

---

## Screens

### 1. Locating Screen
- Full-screen map or subtle animation
- Requests location permission on first launch
- Sends `{ lat, long }` to `POST /api/tour/nearest`
- Backend responds with tour site object

### 2. Tour Ready Screen
- Tour name, thumbnail, estimated duration, distance
- "Start Tour" button
- Backend can pre-load context/assets while user reads

### 3. Active Tour Screen (the main screen)
```
┌─────────────────────────────┐
│  [Tour Title]    [End Tour] │
│                             │
│  ┌───────────────────────┐  │
│  │                       │  │
│  │    Camera Viewfinder  │  │
│  │    (toggleable)       │  │
│  │                       │  │
│  └───────────────────────┘  │
│                             │
│  ┌───────────────────────┐  │
│  │ Live transcript /     │  │
│  │ narration text        │  │
│  │ (scrolling, streamed) │  │
│  └───────────────────────┘  │
│                             │
│  [🎤 Hold to Talk]  [📷]   │
│                             │
└─────────────────────────────┘
```

- **Camera toggle**: opens viewfinder; pointing at a landmark sends a frame to backend for identification
- **Mic button**: push-to-talk or voice-activity-detection (VAD); audio streams to backend
- **Transcript area**: shows what the guide is saying in real time (streamed chunks)

### 4. Tour Ended Screen
- Summary of places covered
- Option to rate, save, or share

---

## State Machine

```
                    ┌──────────────────────────────────┐
                    │          TOURING                  │
                    │                                   │
  ┌──────┐   ┌─────┴─────┐   ┌───────────┐            │
  │LOCATING├──►TOUR_READY ├──►│ NARRATING │◄─┐         │
  └──────┘   └───────────┘   └─────┬─────┘  │         │
                                    │        │         │
                          interrupt │        │ response│
                            (any)   │        │ done    │
                                    ▼        │         │
                              ┌───────────┐  │         │
                              │PROCESSING ├──┘         │
                              └───────────┘            │
                                                       │
                    └──────────────────┬───────────────┘
                                       │ end tour
                                       ▼
                                 ┌───────────┐
                                 │ TOUR_ENDED│
                                 └───────────┘
```

### States

| State | Description |
|---|---|
| `LOCATING` | Acquiring GPS, sending to backend |
| `TOUR_READY` | Tour fetched, waiting for user to start |
| `NARRATING` | Backend is streaming narration chunks over WebSocket |
| `PROCESSING` | An interrupt was sent; backend is processing new input (voice/camera/button) |
| `TOUR_ENDED` | Tour complete or user exited |

**Key rule**: `NARRATING` and `PROCESSING` are sub-states of `TOURING`. The app is always in one of these two while a tour is active.

---

## Real-Time Communication Protocol

### Why WebSocket (not REST)

REST is request-response. This app needs:
- Server-initiated streaming (narration)
- Client-initiated interrupts at any moment
- Low latency bidirectional flow

A single persistent WebSocket connection handles all of this.

### Connection Lifecycle

```
Client                              Server
  │                                    │
  ├── ws://host/ws/tour/:tourId ──────►│
  │                                    │
  │◄── { type: "tour_start",          │
  │      meta: { name, stops, ... }}   │
  │                                    │
  │◄── { type: "narration",           │  ┐
  │      chunk: "Welcome to...",       │  │ server streams
  │      seq: 1 }                      │  │ chunks continuously
  │◄── { type: "narration",           │  │
  │      chunk: "This temple was...",  │  │
  │      seq: 2 }                      │  ┘
  │                                    │
  ├── { type: "interrupt",            │  ◄── client interrupts
  │     reason: "voice",               │
  │     data: <base64 audio> }  ──────►│
  │                                    │
  │◄── { type: "ack_interrupt",       │  server stops narration
  │      seq_stopped: 2 }             │  immediately
  │                                    │
  │◄── { type: "response",            │  ┐
  │      chunk: "Great question...",   │  │ server streams
  │      seq: 3 }                      │  │ response to interrupt
  │◄── { type: "response",            │  │
  │      chunk: "The answer is...",    │  │
  │      seq: 4 }                      │  ┘
  │                                    │
  │◄── { type: "narration",           │  server resumes tour
  │      chunk: "Continuing our...",   │  narration
  │      seq: 5 }                      │
  │                                    │
```

### Message Types

#### Client → Server

| Type | Payload | When |
|---|---|---|
| `interrupt:voice` | `{ audio: base64, duration_ms }` | User speaks (PTT released or VAD triggers) |
| `interrupt:camera` | `{ frame: base64_jpeg, lat, long, heading }` | User points camera and taps capture / auto-triggers |
| `interrupt:action` | `{ action: "pause" \| "repeat" \| "skip" \| "details" }` | User taps a UI button |
| `location_update` | `{ lat, long, heading, speed }` | Periodic GPS update (every ~5s) so backend knows where user is walking |
| `tour_end` | `{}` | User ends tour |

#### Server → Client

| Type | Payload | When |
|---|---|---|
| `tour_start` | `{ tour_id, name, stops, estimated_duration }` | On WS connect |
| `narration` | `{ chunk, seq, stop_id? }` | Streaming tour narration |
| `response` | `{ chunk, seq, ref_interrupt_id }` | Streaming response to an interrupt |
| `ack_interrupt` | `{ interrupt_id, seq_stopped }` | Confirms interrupt received, narration halted |
| `stop_arrived` | `{ stop_id, name, description }` | User has walked to a new point of interest |
| `tour_complete` | `{ summary }` | Tour narration finished |
| `error` | `{ code, message }` | Error |

---

## The Interrupt Model (Critical)

This is what makes the app feel real-time vs. clunky.

### Problem
The backend is streaming narration (like an LLM stream). The user does something (speaks, points camera, taps). The narration must **stop immediately** and the new input must be processed. No queuing, no "please wait".

### Solution: Interrupt-and-Replace

```
1. Client sends an `interrupt` message on the WebSocket
2. Client IMMEDIATELY:
   - Stops playing/displaying current narration
   - Shows a "thinking" indicator
   - Buffers any remaining narration chunks and discards them
3. Server receives interrupt:
   - Cancels the current LLM generation / narration stream (AbortController / cancel token)
   - Sends `ack_interrupt` back to client
   - Processes the new input (speech-to-text, image recognition, etc.)
   - Begins streaming the response
4. When response stream ends:
   - Server decides whether to resume narration from where it stopped
     or continue from a new contextual point
   - Sends new `narration` chunks
```

### Sequence Numbers (`seq`)

Every streamed chunk has an incrementing `seq`. When the server acks an interrupt, it includes `seq_stopped` — the last chunk it sent before stopping. This lets the client:
- Know exactly which chunks to keep and which to discard
- Resume transcript display cleanly

### Interrupt Priority

If multiple interrupts arrive in quick succession (e.g., user speaks then immediately points camera):

```
Rule: Latest interrupt wins. Previous pending interrupt is dropped.
```

The server maintains only ONE active processing task. A new interrupt cancels the previous one.

### Voice Interrupt Details

Two modes (user-configurable):

1. **Push-to-Talk (default)**: user holds mic button → audio records → on release, audio is sent as one chunk
2. **Voice Activity Detection (VAD)**: always-on mic, client detects speech onset → starts buffering → speech end → sends audio

In both cases, the interrupt is sent when the audio segment is complete (not while speaking), to avoid half-sentences.

### Camera Interrupt Details

1. User taps camera button → viewfinder opens
2. User frames what they want to ask about
3. User taps "capture" (or auto-capture after 2s of stability)
4. Client sends the JPEG frame + current GPS + compass heading
5. Backend runs vision model to identify the landmark/object
6. Backend streams description/info back

---

## Backend Architecture (High-Level)

```
┌────────────────────────────────────────────┐
│                 API Server                  │
│            (Node.js / Fastify)              │
│                                             │
│  REST Endpoints:                            │
│    POST /api/tour/nearest    (lat/long)     │
│    GET  /api/tour/:id        (tour detail)  │
│                                             │
│  WebSocket:                                 │
│    /ws/tour/:tourId                         │
│    - manages narration stream per client    │
│    - handles interrupts                     │
│    - maintains conversation context         │
│                                             │
│  ┌─────────────┐  ┌──────────────────────┐  │
│  │ Tour Engine  │  │  Interrupt Handler   │  │
│  │ - narration  │  │  - STT (Whisper)     │  │
│  │   generation │  │  - Vision (GPT-4V /  │  │
│  │ - stop mgmt  │  │    Claude Vision)    │  │
│  │ - context    │  │  - context merging   │  │
│  └──────┬──────┘  └──────────┬───────────┘  │
│         │                     │              │
│         ▼                     ▼              │
│  ┌─────────────────────────────────────┐    │
│  │         LLM (Claude / GPT)          │    │
│  │  - streaming responses              │    │
│  │  - cancellable via AbortController  │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │         Tour Database               │    │
│  │  - locations, stops, scripts        │    │
│  │  - geofences                        │    │
│  └─────────────────────────────────────┘    │
└────────────────────────────────────────────┘
```

### Cancellation Mechanism (Server-Side)

```
// Pseudocode for interrupt handling

let activeStream = null;

ws.on('message', async (msg) => {
  if (msg.type.startsWith('interrupt')) {

    // 1. Cancel current stream immediately
    if (activeStream) {
      activeStream.abort();
    }

    // 2. Ack the interrupt
    ws.send({ type: 'ack_interrupt', seq_stopped: currentSeq });

    // 3. Process new input
    const processedInput = await processInterrupt(msg);

    // 4. Start new stream (which becomes the new activeStream)
    activeStream = streamLLMResponse(processedInput, (chunk) => {
      ws.send({ type: 'response', chunk, seq: ++currentSeq });
    });

    // 5. When response done, resume narration
    await activeStream.done;
    activeStream = resumeNarration(currentContext);
  }
});
```

---

## Data Flow Summary

```
┌──────────┐         WebSocket          ┌──────────┐
│          │◄── narration chunks ───────│          │
│          │                            │          │
│  Mobile  │── interrupt:voice ────────►│  Server  │
│   App    │── interrupt:camera ───────►│          │
│          │── interrupt:action ───────►│          │
│          │── location_update ────────►│          │
│          │                            │          │
│          │◄── ack_interrupt ─────────│          │
│          │◄── response chunks ───────│          │
│          │◄── stop_arrived ──────────│          │
└──────────┘                            └──────────┘
```

---

## Permissions Required

| Permission | Platform | Why |
|---|---|---|
| Location (foreground) | iOS + Android | Find nearest tour, track walking progress |
| Location (background) | iOS + Android | Continue tour when app is backgrounded |
| Camera | iOS + Android | Point-and-identify landmarks |
| Microphone | iOS + Android | Voice questions to the guide |

---

## Edge Cases

| Scenario | Handling |
|---|---|
| Poor GPS accuracy | Show accuracy radius; require <50m before starting tour |
| User walks away from tour area | Backend detects via location updates; prompts "You've left the tour area" |
| Network drops mid-tour | Client buffers last known state; reconnects with `last_seq` to resume |
| Interrupt during interrupt processing | New interrupt cancels previous; latest wins |
| Camera pointed at nothing recognizable | Backend responds "I can't identify anything specific — want to keep going?" |
| User is silent for a long time | Backend continues narration naturally; no awkward pauses |
| Multiple rapid button taps | Debounce on client (300ms); only send one interrupt |

---

## Tech Stack (Recommended)

| Layer | Tech |
|---|---|
| Mobile App | React Native (already initialized) |
| Camera | `react-native-camera` / `expo-camera` |
| Location | `react-native-geolocation` / `expo-location` |
| Audio capture | `react-native-audio-recorder` |
| Audio playback | `expo-av` or `react-native-sound` |
| WebSocket client | Built-in `WebSocket` API in RN |
| Backend | Node.js + Fastify |
| WebSocket server | `ws` or `fastify-websocket` |
| LLM | Claude API (streaming) |
| Vision | Claude Vision API |
| STT | Whisper API or Deepgram |
| TTS | ElevenLabs or OpenAI TTS |
| Database | PostgreSQL + PostGIS (geospatial queries) |
