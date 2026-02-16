import type { TourSession } from "../tour/session.js";
import {
  cancelActiveStream,
  nextSeq,
  addToHistory,
} from "../tour/session.js";
import {
  resumeNarration,
  skipToNextSpot,
  repeatCurrentSpot,
  endTour,
  transitionToSpot,
} from "../tour/engine.js";
import {
  buildVoiceContext,
  buildCameraContext,
  buildDetailsContext,
} from "../llm/context-builder.js";
import { streamLLMResponse } from "../llm/claude.js";
import type {
  InterruptVoiceMessage,
  InterruptCameraMessage,
  InterruptActionMessage,
  AckInterruptMessage,
  LocationUpdateMessage,
  TourEndMessage,
} from "../types/bundle.js";
import { haversineDistance } from "../geo/nearest.js";

function sendJson(ws: import("ws").WebSocket, data: object): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function sendAck(session: TourSession, interruptId: string): void {
  const ack: AckInterruptMessage = {
    type: "ack_interrupt",
    interrupt_id: interruptId,
    seq_stopped: session.seq,
  };
  sendJson(session.ws, ack);
}

export async function handleVoiceInterrupt(
  session: TourSession,
  msg: InterruptVoiceMessage
): Promise<void> {
  cancelActiveStream(session);
  sendAck(session, msg.id);
  session.interactionCount++;

  // STT stub: for MVP, we echo back a placeholder transcription.
  // In production, this would call Whisper/Deepgram.
  const transcribedText = `[Voice input: ${msg.duration_ms}ms audio in ${msg.format} format]`;

  const messages = buildVoiceContext(session, transcribedText);

  const abortController = new AbortController();
  session.activeAbortController = abortController;

  const response = await streamLLMResponse(
    session,
    messages,
    msg.id,
    abortController
  );

  if (!abortController.signal.aborted) {
    addToHistory(session, "user", transcribedText);
    addToHistory(session, "assistant", response);
    session.activeAbortController = null;
    resumeNarration(session);
  }
}

export async function handleCameraInterrupt(
  session: TourSession,
  msg: InterruptCameraMessage
): Promise<void> {
  cancelActiveStream(session);
  sendAck(session, msg.id);
  session.interactionCount++;

  const messages = buildCameraContext(session, msg.frame, msg.text);

  const abortController = new AbortController();
  session.activeAbortController = abortController;

  const response = await streamLLMResponse(
    session,
    messages,
    msg.id,
    abortController
  );

  if (!abortController.signal.aborted) {
    addToHistory(session, "user", msg.text || "What am I looking at?");
    addToHistory(session, "assistant", response);
    session.activeAbortController = null;
    resumeNarration(session);
  }
}

export async function handleActionInterrupt(
  session: TourSession,
  msg: InterruptActionMessage
): Promise<void> {
  session.interactionCount++;

  switch (msg.action) {
    case "pause": {
      cancelActiveStream(session);
      sendAck(session, msg.id);
      session.isPaused = true;
      break;
    }

    case "resume": {
      sendAck(session, msg.id);
      session.isPaused = false;
      resumeNarration(session);
      break;
    }

    case "repeat": {
      cancelActiveStream(session);
      sendAck(session, msg.id);
      repeatCurrentSpot(session);
      break;
    }

    case "skip": {
      cancelActiveStream(session);
      sendAck(session, msg.id);
      skipToNextSpot(session);
      break;
    }

    case "details": {
      cancelActiveStream(session);
      sendAck(session, msg.id);

      const messages = buildDetailsContext(session);

      const abortController = new AbortController();
      session.activeAbortController = abortController;

      const response = await streamLLMResponse(
        session,
        messages,
        msg.id,
        abortController
      );

      if (!abortController.signal.aborted) {
        addToHistory(session, "user", "Tell me more about this spot.");
        addToHistory(session, "assistant", response);
        session.activeAbortController = null;
        resumeNarration(session);
      }
      break;
    }
  }
}

export function handleLocationUpdate(
  session: TourSession,
  msg: LocationUpdateMessage
): void {
  // Check if user has arrived at the next spot (within 20m)
  const spotOrder = session.bundle.route.spot_order;
  const nextIndex = session.currentSpotIndex + 1;

  if (nextIndex >= spotOrder.length) return;

  const nextSpotId = spotOrder[nextIndex];
  const nextSpot = session.bundle.spots.find((s) => s.id === nextSpotId);
  if (!nextSpot) return;

  const distance = haversineDistance(
    { lat: msg.lat, lng: msg.lng },
    { lat: nextSpot.lat, lng: nextSpot.lng }
  );

  if (distance <= 20) {
    // User has arrived at the next spot — trigger transition
    transitionToSpot(session, nextSpotId);
  }
}

export function handleTourEnd(session: TourSession, _msg: TourEndMessage): void {
  endTour(session);
}
