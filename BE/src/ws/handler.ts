import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { v4 as uuidv4 } from "uuid";
import { getBundle } from "../tour/bundle-loader.js";
import { createSession, removeSession } from "../tour/session.js";
import { startNarration } from "../tour/engine.js";
import {
  handleVoiceInterrupt,
  handleCameraInterrupt,
  handleActionInterrupt,
  handleLocationUpdate,
  handleTourEnd,
} from "./interrupt.js";
import type {
  TourStartMessage,
  ErrorMessage,
  ClientMessage,
} from "../types/bundle.js";

function sendJson(ws: WebSocket, data: object): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

export async function registerWebSocket(app: FastifyInstance): Promise<void> {
  app.get(
    "/ws/tour/:tourId",
    { websocket: true },
    (socket: WebSocket, request) => {
      const { tourId } = request.params as { tourId: string };

      const bundle = getBundle(tourId);
      if (!bundle) {
        const err: ErrorMessage = {
          type: "error",
          code: "invalid_message",
          message: `No tour with id '${tourId}'`,
        };
        sendJson(socket, err);
        socket.close();
        return;
      }

      const sessionId = uuidv4();
      const session = createSession(sessionId, tourId, bundle, socket);

      console.log(
        `[ws] New session ${sessionId} for tour ${tourId}`
      );

      // Send tour_start immediately
      const spots = bundle.route.spot_order
        .map((id) => bundle.spots.find((s) => s.id === id))
        .filter((s) => s !== undefined)
        .map((s) => ({
          id: s!.id,
          name: s!.name,
          order: s!.narration_order,
        }));

      const tourStart: TourStartMessage = {
        type: "tour_start",
        tour_id: tourId,
        name: bundle.monument.name,
        spots,
        estimated_duration_minutes: bundle.route.total_tour_minutes,
      };
      sendJson(socket, tourStart);

      // Begin narrating the first spot
      startNarration(session);

      // Handle incoming messages
      socket.on("message", async (data: Buffer | string) => {
        let msg: ClientMessage;

        try {
          const raw = typeof data === "string" ? data : data.toString("utf-8");
          msg = JSON.parse(raw);
        } catch {
          sendJson(socket, {
            type: "error",
            code: "invalid_message",
            message: "Failed to parse message as JSON",
          } satisfies ErrorMessage);
          return;
        }

        try {
          switch (msg.type) {
            case "interrupt:voice":
              await handleVoiceInterrupt(session, msg);
              break;
            case "interrupt:camera":
              await handleCameraInterrupt(session, msg);
              break;
            case "interrupt:action":
              await handleActionInterrupt(session, msg);
              break;
            case "location_update":
              handleLocationUpdate(session, msg);
              break;
            case "tour_end":
              handleTourEnd(session, msg);
              break;
            default:
              sendJson(socket, {
                type: "error",
                code: "invalid_message",
                message: `Unknown message type: ${(msg as any).type}`,
              } satisfies ErrorMessage);
          }
        } catch (err: any) {
          console.error(`[ws] Error handling message:`, err);
          sendJson(socket, {
            type: "error",
            code: "internal",
            message: "Internal server error",
          } satisfies ErrorMessage);
        }
      });

      socket.on("close", () => {
        console.log(`[ws] Session ${sessionId} closed`);
        removeSession(sessionId);
      });

      socket.on("error", (err) => {
        console.error(`[ws] Session ${sessionId} error:`, err.message);
        removeSession(sessionId);
      });
    }
  );
}
