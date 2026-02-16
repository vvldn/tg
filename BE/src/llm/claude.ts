import Anthropic from "@anthropic-ai/sdk";
import type { WebSocket } from "ws";
import type { LLMMessage } from "./context-builder.js";
import type { ResponseMessage } from "../types/bundle.js";
import type { TourSession } from "../tour/session.js";
import { nextSeq } from "../tour/session.js";

const client = new Anthropic();

function sendJson(ws: WebSocket, data: object): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

export async function streamLLMResponse(
  session: TourSession,
  messages: LLMMessage[],
  interruptId: string,
  abortController: AbortController
): Promise<string> {
  const systemMessage = messages.find((m) => m.role === "system");
  const nonSystemMessages = messages.filter((m) => m.role !== "system");

  let fullResponse = "";

  try {
    const stream = client.messages.stream(
      {
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 1024,
        system:
          typeof systemMessage?.content === "string"
            ? systemMessage.content
            : "",
        messages: nonSystemMessages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content as any,
        })),
      },
      { signal: abortController.signal }
    );

    // Buffer text and send in sentence-sized chunks
    let buffer = "";

    stream.on("text", (text: string) => {
      if (abortController.signal.aborted) return;

      buffer += text;
      fullResponse += text;

      // Check for sentence boundaries in buffer
      const sentenceEndings = /([.!?])\s/g;
      let lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = sentenceEndings.exec(buffer)) !== null) {
        const sentence = buffer.slice(lastIndex, match.index + 1).trim();
        if (sentence.length > 0) {
          const seq = nextSeq(session);
          const msg: ResponseMessage = {
            type: "response",
            seq,
            chunk: sentence,
            ref_interrupt_id: interruptId,
            is_final: false,
          };
          sendJson(session.ws, msg);
        }
        lastIndex = match.index + match[0].length;
      }

      // Keep remainder in buffer
      buffer = buffer.slice(lastIndex);
    });

    await stream.finalMessage();

    // Send any remaining buffer as final chunk
    if (!abortController.signal.aborted) {
      const finalChunk = buffer.trim();
      const seq = nextSeq(session);
      const msg: ResponseMessage = {
        type: "response",
        seq,
        chunk: finalChunk || ".",
        ref_interrupt_id: interruptId,
        is_final: true,
      };
      sendJson(session.ws, msg);
    }
  } catch (err: any) {
    if (err?.name === "AbortError" || abortController.signal.aborted) {
      // Aborted by a new interrupt — this is expected
      return fullResponse;
    }
    // Send error to client
    sendJson(session.ws, {
      type: "error",
      code: "llm_timeout",
      message: "LLM API error. Please try again.",
    });
    console.error("[claude] LLM error:", err?.message ?? err);
  }

  return fullResponse;
}
