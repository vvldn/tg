import type { FastifyInstance } from "fastify";
import { getBundle } from "../tour/bundle-loader.js";
import { getLLMResponse } from "../llm/claude.js";
import {
  buildQuestionContext,
  buildCameraQuestionContext,
} from "../llm/context-builder.js";
import type { AskRequest, AskResponse, ApiError } from "../types/bundle.js";

export async function askRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: AskRequest }>("/api/ask", async (request, reply) => {
    const { tour_id, spot_id, question, image, conversation_history } =
      request.body ?? ({} as any);

    if (!tour_id || !spot_id || !question) {
      return reply.status(400).send({
        error: "missing_fields",
        message: "tour_id, spot_id, and question are required",
      } satisfies ApiError);
    }

    const bundle = getBundle(tour_id);
    if (!bundle) {
      return reply.status(404).send({
        error: "bundle_not_found",
        message: `No bundle with id '${tour_id}'`,
      } satisfies ApiError);
    }

    const spot = bundle.spots.find((s) => s.id === spot_id);
    if (!spot) {
      return reply.status(404).send({
        error: "spot_not_found",
        message: `No spot with id '${spot_id}' in bundle '${tour_id}'`,
      } satisfies ApiError);
    }

    const history = conversation_history ?? [];

    try {
      const messages = image
        ? buildCameraQuestionContext(bundle, spot_id, image, question, history)
        : buildQuestionContext(bundle, spot_id, question, history);

      const answer = await getLLMResponse(messages);

      const response: AskResponse = { answer };
      return reply.send(response);
    } catch (err: any) {
      console.error("[ask] LLM error:", err?.message ?? err);
      return reply.status(500).send({
        error: "llm_error",
        message: "Failed to get LLM response. Please try again.",
      } satisfies ApiError);
    }
  });
}
