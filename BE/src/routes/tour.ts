import type { FastifyInstance } from "fastify";
import { getBundle, getAllBundles, getBundleSize } from "../tour/bundle-loader.js";
import { findNearest } from "../geo/nearest.js";
import type {
  NearestTourRequest,
  NearestTourResponse,
  TourDetailResponse,
  BundleCatalogEntry,
  ApiError,
} from "../types/bundle.js";

export async function tourRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: NearestTourRequest }>(
    "/api/tour/nearest",
    async (request, reply) => {
      const { lat, lng } = request.body ?? ({} as any);

      if (
        typeof lat !== "number" ||
        typeof lng !== "number" ||
        lat < -90 ||
        lat > 90 ||
        lng < -180 ||
        lng > 180
      ) {
        return reply.status(400).send({
          error: "invalid_coordinates",
          message:
            "lat must be between -90 and 90, lng must be between -180 and 180",
        } satisfies ApiError);
      }

      const result = findNearest({ lat, lng }, getAllBundles());

      if (!result) {
        return reply.status(404).send({
          error: "no_tours_nearby",
          message: "No tours found within 50km",
        } satisfies ApiError);
      }

      const m = result.bundle.monument;
      const r = result.bundle.route;

      const response: NearestTourResponse = {
        tour_id: m.id,
        name: m.name,
        center: m.center,
        distance_meters: Math.round(result.distanceMeters),
        city: m.city,
        country: m.country,
        heritage_status: m.heritage_status,
        estimated_duration_minutes: r.total_tour_minutes,
        spot_count: result.bundle.spots.length,
        thumbnail_url: null,
      };

      return reply.send(response);
    }
  );

  // --- Bundle Catalog ---
  app.get("/api/bundles", async (_request, reply) => {
    const bundles = getAllBundles();
    const catalog: BundleCatalogEntry[] = bundles.map((b) => ({
      tour_id: b.monument.id,
      name: b.monument.name,
      center: b.monument.center,
      city: b.monument.city,
      country: b.monument.country,
      heritage_status: b.monument.heritage_status,
      estimated_duration_minutes: b.route.total_tour_minutes,
      spot_count: b.spots.length,
      bundle_size_bytes: getBundleSize(b.monument.id) ?? 0,
      generated_at: b.generated_at,
    }));
    return reply.send(catalog);
  });

  // --- Bundle Download ---
  app.get<{ Params: { tourId: string } }>(
    "/api/bundles/:tourId",
    async (request, reply) => {
      const { tourId } = request.params;
      const bundle = getBundle(tourId);

      if (!bundle) {
        return reply.status(404).send({
          error: "bundle_not_found",
          message: `No bundle with id '${tourId}'`,
        } satisfies ApiError);
      }

      reply.header("ETag", `"${bundle.generated_at}"`);
      reply.header("Cache-Control", "public, max-age=3600");

      // Support conditional GET
      const ifNoneMatch = request.headers["if-none-match"];
      if (ifNoneMatch === `"${bundle.generated_at}"`) {
        return reply.status(304).send();
      }

      return reply.send(bundle);
    }
  );

  app.get<{ Params: { tourId: string } }>(
    "/api/tour/:tourId",
    async (request, reply) => {
      const { tourId } = request.params;
      const bundle = getBundle(tourId);

      if (!bundle) {
        return reply.status(404).send({
          error: "tour_not_found",
          message: `No tour with id '${tourId}'`,
        } satisfies ApiError);
      }

      const m = bundle.monument;
      const spots = bundle.spots
        .slice()
        .sort((a, b) => a.narration_order - b.narration_order);

      const response: TourDetailResponse = {
        tour_id: m.id,
        name: m.name,
        center: m.center,
        city: m.city,
        country: m.country,
        heritage_status: m.heritage_status,
        inception: m.inception,
        architect: m.architect,
        architectural_style: m.architectural_style,
        estimated_duration_minutes: bundle.route.total_tour_minutes,
        spot_count: spots.length,
        spots_preview: spots.map((s) => ({
          id: s.id,
          name: s.name,
          order: s.narration_order,
        })),
        overview_text: bundle.overview.narration_text.slice(0, 200),
        thumbnail_url: null,
      };

      return reply.send(response);
    }
  );
}
