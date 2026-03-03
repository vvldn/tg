import type { TourSession } from "../tour/session.js";
import { getCurrentSpot } from "../tour/session.js";
import type { Spot, MonumentBundle } from "../types/bundle.js";

export interface LLMMessage {
  role: "user" | "assistant" | "system";
  content: string | Array<{ type: string; [key: string]: any }>;
}

function buildSystemPrompt(session: TourSession): string {
  const bundle = session.bundle;
  const spot = getCurrentSpot(session);
  const monument = bundle.monument;

  // Build spot summaries from previous visits
  const previousSummaries = Array.from(session.spotSummaries.entries())
    .map(([id, summary]) => `- ${summary}`)
    .join("\n");

  return `You are an expert tour guide at ${monument.name} in ${monument.city ?? "an unknown city"}, ${monument.country ?? "an unknown country"}.
You speak in a warm, conversational, knowledgeable tone — like a real human guide walking beside the visitor.
Keep responses concise (2-4 sentences for simple questions, up to a short paragraph for complex ones).
ONLY use information from the context below. If you don't know something, say so honestly.

=== Monument Overview ===
${bundle.overview.narration_text.slice(0, 500)}

=== Current Spot: ${spot.name} ===
Narration: ${spot.narration_text}

Architectural Notes: ${spot.architectural_notes ?? "None available."}

Visual Anchors: ${spot.visual_anchors.join(", ")}

Stories:
${spot.stories.map((s) => `- ${s.title}: ${s.narration_text.slice(0, 200)}`).join("\n")}

Visitor Context: ${spot.visitor_context ?? "None."}

${previousSummaries ? `=== Earlier in the Tour ===\n${previousSummaries}` : ""}`;
}

export function buildVoiceContext(
  session: TourSession,
  transcribedText: string
): LLMMessage[] {
  const messages: LLMMessage[] = [
    { role: "system", content: buildSystemPrompt(session) },
  ];

  // Add conversation history
  for (const entry of session.conversationHistory) {
    messages.push({
      role: entry.role,
      content: entry.content,
    });
  }

  messages.push({ role: "user", content: transcribedText });

  return messages;
}

export function buildCameraContext(
  session: TourSession,
  imageBase64: string,
  userText?: string
): LLMMessage[] {
  const messages: LLMMessage[] = [
    { role: "system", content: buildSystemPrompt(session) },
  ];

  // Add conversation history
  for (const entry of session.conversationHistory) {
    messages.push({
      role: entry.role,
      content: entry.content,
    });
  }

  const text =
    userText || "Describe what the user is looking at in this image.";

  messages.push({
    role: "user",
    content: [
      {
        type: "image",
        source: {
          type: "base64",
          media_type: "image/jpeg",
          data: imageBase64,
        },
      },
      { type: "text", text },
    ],
  });

  return messages;
}

export function buildDetailsContext(session: TourSession): LLMMessage[] {
  const spot = getCurrentSpot(session);
  const messages: LLMMessage[] = [
    { role: "system", content: buildSystemPrompt(session) },
  ];

  for (const entry of session.conversationHistory) {
    messages.push({
      role: entry.role,
      content: entry.content,
    });
  }

  messages.push({
    role: "user",
    content: `Tell me more about ${spot.name}. Share interesting details, stories, or architectural features that weren't covered in the main narration.`,
  });

  return messages;
}

// --- Session-less context builders (for REST Q&A endpoint) ---

function buildSystemPromptFromBundle(bundle: MonumentBundle, spot: Spot): string {
  const monument = bundle.monument;

  return `You are an expert tour guide at ${monument.name} in ${monument.city ?? "an unknown city"}, ${monument.country ?? "an unknown country"}.
You speak in a warm, conversational, knowledgeable tone — like a real human guide walking beside the visitor.
Keep responses concise (2-4 sentences for simple questions, up to a short paragraph for complex ones).
ONLY use information from the context below. If you don't know something, say so honestly.

=== Monument Overview ===
${bundle.overview.narration_text.slice(0, 500)}

=== Current Spot: ${spot.name} ===
Narration: ${spot.narration_text}

Architectural Notes: ${spot.architectural_notes ?? "None available."}

Visual Anchors: ${spot.visual_anchors.join(", ")}

Stories:
${spot.stories.map((s) => `- ${s.title}: ${s.narration_text.slice(0, 200)}`).join("\n")}

Visitor Context: ${spot.visitor_context ?? "None."}`;
}

export function buildQuestionContext(
  bundle: MonumentBundle,
  spotId: string,
  question: string,
  conversationHistory: Array<{ role: string; content: string }>
): LLMMessage[] {
  const spot = bundle.spots.find((s) => s.id === spotId);
  if (!spot) {
    throw new Error(`Spot '${spotId}' not found in bundle`);
  }

  const messages: LLMMessage[] = [
    { role: "system", content: buildSystemPromptFromBundle(bundle, spot) },
  ];

  for (const entry of conversationHistory) {
    messages.push({
      role: entry.role as "user" | "assistant",
      content: entry.content,
    });
  }

  messages.push({ role: "user", content: question });
  return messages;
}

export function buildCameraQuestionContext(
  bundle: MonumentBundle,
  spotId: string,
  imageBase64: string,
  question: string | undefined,
  conversationHistory: Array<{ role: string; content: string }>
): LLMMessage[] {
  const spot = bundle.spots.find((s) => s.id === spotId);
  if (!spot) {
    throw new Error(`Spot '${spotId}' not found in bundle`);
  }

  const messages: LLMMessage[] = [
    { role: "system", content: buildSystemPromptFromBundle(bundle, spot) },
  ];

  for (const entry of conversationHistory) {
    messages.push({
      role: entry.role as "user" | "assistant",
      content: entry.content,
    });
  }

  const text = question || "Describe what the user is looking at in this image.";

  messages.push({
    role: "user",
    content: [
      {
        type: "image",
        source: {
          type: "base64",
          media_type: "image/jpeg",
          data: imageBase64,
        },
      },
      { type: "text", text },
    ],
  });

  return messages;
}
