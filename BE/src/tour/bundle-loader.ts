import { readFileSync, readdirSync, existsSync } from "fs";
import { join, basename } from "path";
import type { MonumentBundle } from "../types/bundle.js";

const bundles = new Map<string, MonumentBundle>();

const BUNDLE_DIRS = [
  join(process.cwd(), "data", "bundles"),
  join(process.cwd(), "..", "contracts", "test-fixtures"),
];

export function loadBundles(): void {
  for (const dir of BUNDLE_DIRS) {
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir).filter((f) => f.endsWith(".bundle.json"));
    for (const file of files) {
      const raw = readFileSync(join(dir, file), "utf-8");
      const bundle: MonumentBundle = JSON.parse(raw);
      const id = bundle.monument.id;
      if (!bundles.has(id)) {
        bundles.set(id, bundle);
        console.log(`[bundle-loader] Loaded bundle: ${id} (${file})`);
      }
    }
  }
  console.log(`[bundle-loader] Total bundles loaded: ${bundles.size}`);
}

export function getBundle(tourId: string): MonumentBundle | undefined {
  return bundles.get(tourId);
}

export function getAllBundles(): MonumentBundle[] {
  return Array.from(bundles.values());
}

export function getBundleCount(): number {
  return bundles.size;
}

export function getBundleSize(tourId: string): number | undefined {
  const bundle = bundles.get(tourId);
  if (!bundle) return undefined;
  return Buffer.byteLength(JSON.stringify(bundle), "utf-8");
}
