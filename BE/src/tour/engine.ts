import type { WebSocket } from "ws";
import type {
  TourSession,
} from "./session.js";
import {
  nextSeq,
  getCurrentSpot,
  cancelActiveStream,
  compressSpotHistory,
} from "./session.js";
import type {
  NarrationMessage,
  StopArrivedMessage,
  TourCompleteMessage,
} from "../types/bundle.js";

// ~150 words per minute. Average word is ~5 chars + space = 6 chars.
// So ~150 * 6 = 900 chars per minute = 15 chars per second.
// For a sentence of N chars, delay = N / 15 * 1000 ms.
const CHARS_PER_SECOND = 15;

export function splitIntoSentences(text: string): string[] {
  // Split on sentence-ending punctuation followed by space or end of string.
  // Keep the punctuation with the sentence.
  const sentences: string[] = [];
  const regex = /[^.!?]*[.!?]+[\s]*/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const trimmed = match[0].trim();
    if (trimmed.length > 0) {
      sentences.push(trimmed);
    }
  }

  // If nothing matched (text without sentence-ending punctuation), return whole text
  if (sentences.length === 0 && text.trim().length > 0) {
    sentences.push(text.trim());
  }

  return sentences;
}

function sendJson(ws: WebSocket, data: object): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function calculateDelay(text: string): number {
  const chars = text.length;
  return Math.max(200, (chars / CHARS_PER_SECOND) * 1000);
}

export function startNarration(session: TourSession): void {
  const spot = getCurrentSpot(session);

  // Mark spot as visited
  if (!session.spotsVisited.includes(spot.id)) {
    session.spotsVisited.push(spot.id);
  }

  // Build sentence list: walking directions (if any) + narration text
  const sentences: string[] = [];
  if (spot.walking_from_previous) {
    sentences.push(...splitIntoSentences(spot.walking_from_previous));
  }
  sentences.push(...splitIntoSentences(spot.narration_text));

  session.narrationPosition = 0;

  streamSentences(session, sentences, spot.id);
}

export function resumeNarration(session: TourSession): void {
  if (session.isPaused) return;

  const spot = getCurrentSpot(session);
  const allSentences: string[] = [];
  if (spot.walking_from_previous) {
    allSentences.push(...splitIntoSentences(spot.walking_from_previous));
  }
  allSentences.push(...splitIntoSentences(spot.narration_text));

  // Resume from current position
  const remaining = allSentences.slice(session.narrationPosition);
  if (remaining.length === 0) {
    // This spot's narration is done, move to next
    advanceToNextSpot(session);
    return;
  }

  streamSentences(session, remaining, spot.id);
}

function streamSentences(
  session: TourSession,
  sentences: string[],
  spotId: string
): void {
  const abortController = new AbortController();
  session.activeAbortController = abortController;

  let index = 0;

  function sendNext(): void {
    if (abortController.signal.aborted) return;
    if (session.isPaused) return;
    if (index >= sentences.length) {
      // Done with this spot's narration
      session.activeAbortController = null;
      advanceToNextSpot(session);
      return;
    }

    const chunk = sentences[index];
    const isFinal = index === sentences.length - 1;
    const seq = nextSeq(session);

    const msg: NarrationMessage = {
      type: "narration",
      seq,
      chunk,
      spot_id: spotId,
      is_final: isFinal,
    };

    sendJson(session.ws, msg);
    session.narrationPosition++;
    index++;

    if (!isFinal) {
      const delay = calculateDelay(chunk);
      session.narrationTimer = setTimeout(sendNext, delay);
    } else {
      // Final sentence sent, advance after its delay
      const delay = calculateDelay(chunk);
      session.narrationTimer = setTimeout(() => {
        session.activeAbortController = null;
        advanceToNextSpot(session);
      }, delay);
    }
  }

  sendNext();
}

function advanceToNextSpot(session: TourSession): void {
  const spotOrder = session.bundle.route.spot_order;
  const nextIndex = session.currentSpotIndex + 1;

  if (nextIndex >= spotOrder.length) {
    // Tour is complete
    sendTourComplete(session);
    return;
  }

  // Compress history for current spot
  const currentSpot = getCurrentSpot(session);
  compressSpotHistory(session, currentSpot.id);

  // Move to next spot
  session.currentSpotIndex = nextIndex;
  session.narrationPosition = 0;

  const nextSpot = getCurrentSpot(session);

  const msg: StopArrivedMessage = {
    type: "stop_arrived",
    spot_id: nextSpot.id,
    name: nextSpot.name,
    order: nextSpot.narration_order,
  };
  sendJson(session.ws, msg);

  // Start narrating the new spot
  startNarration(session);
}

export function transitionToSpot(
  session: TourSession,
  spotId: string
): void {
  const spotOrder = session.bundle.route.spot_order;
  const targetIndex = spotOrder.indexOf(spotId);
  if (targetIndex === -1) return;

  cancelActiveStream(session);

  // Compress history for current spot
  const currentSpot = getCurrentSpot(session);
  compressSpotHistory(session, currentSpot.id);

  session.currentSpotIndex = targetIndex;
  session.narrationPosition = 0;

  const nextSpot = getCurrentSpot(session);

  const msg: StopArrivedMessage = {
    type: "stop_arrived",
    spot_id: nextSpot.id,
    name: nextSpot.name,
    order: nextSpot.narration_order,
  };
  sendJson(session.ws, msg);

  startNarration(session);
}

export function skipToNextSpot(session: TourSession): void {
  cancelActiveStream(session);
  advanceToNextSpot(session);
}

export function repeatCurrentSpot(session: TourSession): void {
  cancelActiveStream(session);
  session.narrationPosition = 0;
  startNarration(session);
}

function sendTourComplete(session: TourSession): void {
  const durationMinutes = Math.round(
    (Date.now() - session.startedAt) / 60_000
  );

  const msg: TourCompleteMessage = {
    type: "tour_complete",
    summary: {
      duration_minutes: durationMinutes,
      spots_visited: session.spotsVisited,
      interactions: session.interactionCount,
    },
  };

  sendJson(session.ws, msg);

  // Close the WebSocket after sending
  setTimeout(() => {
    if (session.ws.readyState === session.ws.OPEN) {
      session.ws.close();
    }
  }, 500);
}

export function endTour(session: TourSession): void {
  cancelActiveStream(session);
  sendTourComplete(session);
}
