import type { MonumentBundle, LatLng } from "../types/bundle.js";

const EARTH_RADIUS_M = 6_371_000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineDistance(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export interface NearestResult {
  bundle: MonumentBundle;
  distanceMeters: number;
}

export function findNearest(
  userLocation: LatLng,
  bundles: MonumentBundle[],
  maxDistanceM: number = 50_000
): NearestResult | null {
  let best: NearestResult | null = null;

  for (const bundle of bundles) {
    const dist = haversineDistance(userLocation, bundle.monument.center);
    if (dist <= maxDistanceM && (!best || dist < best.distanceMeters)) {
      best = { bundle, distanceMeters: dist };
    }
  }

  return best;
}
