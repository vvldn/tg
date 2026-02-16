import type { WebSocket } from "ws";
import type { MonumentBundle, Spot } from "../types/bundle.js";

export interface ConversationEntry {
  role: "user" | "assistant" | "system";
  content: string | Array<{ type: string; [key: string]: any }>;
}

export interface TourSession {
  sessionId: string;
  tourId: string;
  bundle: MonumentBundle;
  ws: WebSocket;

  // Tour state
  currentSpotIndex: number;
  spotsVisited: string[];
  seq: number;
  startedAt: number;
  interactionCount: number;

  // Narration state
  isPaused: boolean;
  narrationPosition: number; // sentence index within current spot
  activeAbortController: AbortController | null;
  narrationTimer: ReturnType<typeof setTimeout> | null;

  // Conversation history
  conversationHistory: ConversationEntry[];

  // Spot summaries (compressed history from previous spots)
  spotSummaries: Map<string, string>;
}

const sessions = new Map<string, TourSession>();

export function createSession(
  sessionId: string,
  tourId: string,
  bundle: MonumentBundle,
  ws: WebSocket
): TourSession {
  const session: TourSession = {
    sessionId,
    tourId,
    bundle,
    ws,
    currentSpotIndex: 0,
    spotsVisited: [],
    seq: 0,
    startedAt: Date.now(),
    interactionCount: 0,
    isPaused: false,
    narrationPosition: 0,
    activeAbortController: null,
    narrationTimer: null,
    conversationHistory: [],
    spotSummaries: new Map(),
  };
  sessions.set(sessionId, session);
  return session;
}

export function getSession(sessionId: string): TourSession | undefined {
  return sessions.get(sessionId);
}

export function removeSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (session) {
    cancelActiveStream(session);
    sessions.delete(sessionId);
  }
}

export function getActiveSessionCount(): number {
  return sessions.size;
}

export function nextSeq(session: TourSession): number {
  return ++session.seq;
}

export function getCurrentSpot(session: TourSession): Spot {
  const order = session.bundle.route.spot_order;
  const spotId = order[session.currentSpotIndex];
  const spot = session.bundle.spots.find((s) => s.id === spotId);
  if (!spot) {
    throw new Error(`Spot not found: ${spotId}`);
  }
  return spot;
}

export function getOrderedSpots(session: TourSession): Spot[] {
  return session.bundle.route.spot_order
    .map((id) => session.bundle.spots.find((s) => s.id === id))
    .filter((s): s is Spot => s !== undefined);
}

export function cancelActiveStream(session: TourSession): void {
  if (session.activeAbortController) {
    session.activeAbortController.abort();
    session.activeAbortController = null;
  }
  if (session.narrationTimer) {
    clearTimeout(session.narrationTimer);
    session.narrationTimer = null;
  }
}

export function addToHistory(
  session: TourSession,
  role: "user" | "assistant",
  content: string | Array<{ type: string; [key: string]: any }>
): void {
  session.conversationHistory.push({ role, content });
  // Sliding window: keep last 20 entries (10 exchanges)
  if (session.conversationHistory.length > 20) {
    session.conversationHistory = session.conversationHistory.slice(-20);
  }
}

export function compressSpotHistory(
  session: TourSession,
  spotId: string
): void {
  const spot = session.bundle.spots.find((s) => s.id === spotId);
  if (!spot) return;

  // Summarize interactions at this spot
  const userMessages = session.conversationHistory
    .filter((e) => e.role === "user" && typeof e.content === "string")
    .map((e) => e.content as string);

  if (userMessages.length > 0) {
    const summary = `At ${spot.name}, visitor asked about: ${userMessages.slice(0, 3).join("; ")}`;
    session.spotSummaries.set(spotId, summary);
  }

  // Clear history for new spot context
  session.conversationHistory = [];
}
