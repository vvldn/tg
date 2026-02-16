# WebSocket Protocol Contract

## Connection

```
URL:      ws://<host>:<port>/ws/tour/:tourId
Auth:     None (MVP). Future: JWT as query param ?token=xxx
Encoding: JSON for control messages, binary for audio frames
```

On connect, server immediately sends a `tour_start` message. If the `tourId` is invalid, server sends an `error` message and closes the connection.

---

## Client → Server Messages

All messages are JSON with a `type` field. Unknown types are ignored with an `error` response.

### interrupt:voice

Sent when the user finishes speaking (PTT release or VAD end-of-speech).

```json
{
  "type": "interrupt:voice",
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "audio": "<base64-encoded audio bytes>",
  "format": "wav",
  "duration_ms": 3200,
  "sample_rate": 16000
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | yes | `"interrupt:voice"` |
| `id` | string (uuid) | yes | Client-generated unique ID for this interrupt |
| `audio` | string | yes | Base64-encoded audio data |
| `format` | string | yes | Audio format: `"wav"`, `"mp3"`, or `"ogg"` |
| `duration_ms` | number | yes | Duration of the audio clip in milliseconds |
| `sample_rate` | number | yes | Sample rate in Hz (e.g. 16000) |

### interrupt:camera

Sent when the user captures a camera frame.

```json
{
  "type": "interrupt:camera",
  "id": "550e8400-e29b-41d4-a716-446655440001",
  "frame": "<base64-encoded jpeg>",
  "lat": 28.5933,
  "lng": 77.2508,
  "heading": 127.5,
  "text": "What is this building?"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | yes | `"interrupt:camera"` |
| `id` | string (uuid) | yes | Client-generated unique ID |
| `frame` | string | yes | Base64-encoded JPEG image |
| `lat` | number | yes | Current latitude |
| `lng` | number | yes | Current longitude |
| `heading` | number | yes | Compass heading in degrees (0-360) |
| `text` | string | no | Optional question. Default: "Describe what the user is looking at." |

### interrupt:action

Sent when the user taps a UI control button.

```json
{
  "type": "interrupt:action",
  "id": "550e8400-e29b-41d4-a716-446655440002",
  "action": "skip"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | yes | `"interrupt:action"` |
| `id` | string (uuid) | yes | Client-generated unique ID |
| `action` | string | yes | One of: `"pause"`, `"resume"`, `"repeat"`, `"skip"`, `"details"` |

Action semantics:
- `pause`: stop narration, hold position
- `resume`: continue narration from where it paused
- `repeat`: replay the current spot's narration from the beginning
- `skip`: advance to the next spot
- `details`: tell me more about the current spot (triggers LLM call)

### location_update

Periodic GPS update. NOT an interrupt — does not stop narration.

```json
{
  "type": "location_update",
  "lat": 28.5933,
  "lng": 77.2508,
  "heading": 127.5,
  "speed": 1.2,
  "accuracy": 8.5
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | yes | `"location_update"` |
| `lat` | number | yes | Current latitude |
| `lng` | number | yes | Current longitude |
| `heading` | number | yes | Compass heading in degrees |
| `speed` | number | yes | Speed in m/s |
| `accuracy` | number | yes | GPS accuracy in meters |

Sent every 5 seconds while the tour is active. Server uses this to detect when the user has walked to a new spot (within 20m triggers `stop_arrived`).

### tour_end

User ends the tour.

```json
{
  "type": "tour_end"
}
```

Server responds with `tour_complete` and closes the WebSocket.

---

## Server → Client Messages

### tour_start

Sent immediately after WebSocket connects.

```json
{
  "type": "tour_start",
  "tour_id": "humayuns-tomb",
  "name": "Humayun's Tomb",
  "spots": [
    { "id": "main-gateway", "name": "Main Gateway (West Gate)", "order": 1 },
    { "id": "isa-khans-tomb", "name": "Isa Khan's Tomb", "order": 2 }
  ],
  "estimated_duration_minutes": 38
}
```

After `tour_start`, the server immediately begins streaming `narration` messages for the first spot.

### narration

Streamed chunks of pre-baked narration text from the bundle.

```json
{
  "type": "narration",
  "seq": 1,
  "chunk": "Welcome to Humayun's Tomb, one of the finest ",
  "spot_id": "main-gateway",
  "is_final": false
}
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | `"narration"` |
| `seq` | number | Monotonically increasing sequence number (global across the session) |
| `chunk` | string | Text chunk (typically a sentence or phrase) |
| `spot_id` | string | Which spot this narration belongs to |
| `is_final` | boolean | `true` on the last chunk of this spot's narration |

Chunks are sent at a pace that matches natural speech (~150 words/min). The client displays them as they arrive.

### response

Streamed chunks of LLM response to a user interrupt.

```json
{
  "type": "response",
  "seq": 15,
  "chunk": "Great question! That dome uses a ",
  "ref_interrupt_id": "550e8400-e29b-41d4-a716-446655440000",
  "is_final": false
}
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | `"response"` |
| `seq` | number | Sequence number (continues from narration seq) |
| `chunk` | string | Text chunk from LLM |
| `ref_interrupt_id` | string | UUID of the interrupt this responds to |
| `is_final` | boolean | `true` on the last chunk of this response |

After the final `response` chunk, the server resumes `narration` from an appropriate point.

### ack_interrupt

Sent immediately when server receives any interrupt message.

```json
{
  "type": "ack_interrupt",
  "interrupt_id": "550e8400-e29b-41d4-a716-446655440000",
  "seq_stopped": 14
}
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | `"ack_interrupt"` |
| `interrupt_id` | string | UUID of the interrupt being acknowledged |
| `seq_stopped` | number | Last seq number the server sent before stopping |

**Client behavior on receiving ack_interrupt:**
1. Stop audio playback immediately
2. Discard any buffered chunks with `seq > seq_stopped`
3. Show "thinking" / processing indicator
4. Wait for `response` messages

### stop_arrived

Sent when `location_update` indicates the user is within 20m of the next spot in the route.

```json
{
  "type": "stop_arrived",
  "spot_id": "isa-khans-tomb",
  "name": "Isa Khan's Tomb",
  "order": 2
}
```

After this message, the server transitions narration to the new spot's content. If narration for the previous spot was still in progress, the server finishes the current sentence and then transitions.

### tour_complete

Sent when the tour narration is finished or when the client sends `tour_end`.

```json
{
  "type": "tour_complete",
  "summary": {
    "duration_minutes": 42,
    "spots_visited": ["main-gateway", "isa-khans-tomb", "main-tomb"],
    "interactions": 12
  }
}
```

The WebSocket is closed by the server after sending this message.

### error

Sent when something goes wrong.

```json
{
  "type": "error",
  "code": "stt_failed",
  "message": "Speech-to-text failed. Please try again."
}
```

Error codes:
- `stt_failed`: Speech-to-text processing failed
- `llm_timeout`: LLM API timed out
- `invalid_message`: Client sent a malformed message
- `internal`: Unexpected server error

Errors do NOT close the WebSocket (except on `internal` which may). The tour continues.

---

## Audio Streaming

Audio (TTS output) is sent as binary WebSocket frames, preceded by a JSON metadata message.

### audio_meta

```json
{
  "type": "audio_meta",
  "seq": 15,
  "format": "mp3",
  "sample_rate": 24000,
  "chunk_index": 0,
  "is_final": false,
  "ref_type": "narration"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | `"audio_meta"` |
| `seq` | number | Matches the seq of the corresponding text chunk |
| `format` | string | Audio format: `"mp3"`, `"wav"`, or `"opus"` |
| `sample_rate` | number | Sample rate in Hz |
| `chunk_index` | number | Index within this seq (0-based, for multi-chunk audio) |
| `is_final` | boolean | `true` on the last audio chunk for this seq |
| `ref_type` | string | `"narration"` or `"response"` — what this audio belongs to |

**Protocol:**
1. Server sends `audio_meta` (JSON text frame)
2. Server sends audio data (binary frame)
3. Repeat for each audio chunk

**Client behavior:**
- Buffer audio chunks and play them sequentially
- On interrupt: stop playback immediately, discard buffered audio
- Match `audio_meta.seq` to text chunks for transcript sync

---

## Sequence Number Rules

1. `seq` is a **session-global** monotonically increasing integer starting at 1
2. Both `narration` and `response` messages share the same seq counter
3. `ack_interrupt.seq_stopped` is the last seq the server sent before halting
4. After an interrupt response completes, narration resumes with the next seq
5. `audio_meta.seq` matches the corresponding text message's seq

---

## Interrupt Behavior Summary

```
Client sends interrupt
    │
    ├─► Client immediately: stops playback, shows "thinking"
    │
    ▼
Server receives interrupt
    │
    ├─► Cancels active LLM stream / narration timer (AbortController)
    ├─► Sends ack_interrupt { seq_stopped }
    ├─► Processes input (STT / Vision / action logic)
    ├─► Streams response chunks
    ├─► On response complete: resumes narration from appropriate point
    │
    ▼
If another interrupt arrives during processing:
    └─► Previous processing is cancelled. New interrupt takes over.
        "Latest interrupt wins."
```

---

## Connection Lifecycle

```
Client                                    Server
  │                                         │
  ├─── WebSocket connect ─────────────────►│
  │    ws://host/ws/tour/humayuns-tomb      │
  │                                         │
  │◄── tour_start ──────────────────────────┤
  │                                         │
  │◄── narration { seq: 1, chunk: "..." } ──┤
  │◄── audio_meta { seq: 1 } ──────────────┤
  │◄── [binary audio] ─────────────────────┤
  │◄── narration { seq: 2, chunk: "..." } ──┤
  │    ...                                  │
  │                                         │
  │─── location_update ───────────────────►│  (every 5s)
  │                                         │
  │─── interrupt:voice { id: "abc" } ─────►│
  │◄── ack_interrupt { seq_stopped: 14 } ──┤
  │◄── response { seq: 15, chunk: "..." } ──┤
  │◄── response { seq: 16, is_final: true }─┤
  │                                         │
  │◄── narration { seq: 17, chunk: "..." } ─┤  (resumes)
  │    ...                                  │
  │                                         │
  │◄── stop_arrived { spot_id: "..." } ────┤  (user walked to next spot)
  │◄── narration { seq: 25, spot_id: "..." }┤  (new spot)
  │    ...                                  │
  │                                         │
  │─── tour_end ──────────────────────────►│
  │◄── tour_complete { summary: {...} } ───┤
  │                                         │
  │◄── [connection closed] ────────────────┤
```
