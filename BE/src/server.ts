import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Load BE/.env first, then root .env as fallback (won't override existing vars)
config({ path: resolve(__dirname, "../../.env") });
config({ path: resolve(__dirname, "../../../.env") });
import Fastify from "fastify";
import fastifyWebSocket from "@fastify/websocket";
import fastifyCors from "@fastify/cors";
import { loadBundles, getBundleCount } from "./tour/bundle-loader.js";
import { getActiveSessionCount } from "./tour/session.js";
import { tourRoutes } from "./routes/tour.js";
import { registerWebSocket } from "./ws/handler.js";

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const HOST = process.env.HOST ?? "0.0.0.0";

async function main(): Promise<void> {
  const app = Fastify({ logger: true });

  // Plugins
  await app.register(fastifyCors, { origin: true });
  await app.register(fastifyWebSocket);

  // Load bundles into memory
  loadBundles();

  // Health check
  app.get("/api/health", async () => ({
    status: "ok",
    bundles_loaded: getBundleCount(),
    active_sessions: getActiveSessionCount(),
  }));

  // REST routes
  await app.register(tourRoutes);

  // WebSocket routes
  await app.register(registerWebSocket);

  // Start server
  await app.listen({ port: PORT, host: HOST });
  console.log(`Server listening on ${HOST}:${PORT}`);
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
