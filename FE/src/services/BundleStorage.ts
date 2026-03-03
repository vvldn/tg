import AsyncStorage from '@react-native-async-storage/async-storage';
import type {MonumentBundle, BundleCatalogEntry} from '../types/bundle';
import {API_BASE} from '../config';

const BUNDLE_KEY_PREFIX = 'bundle:';
const META_KEY_PREFIX = 'bundle_meta:';

export interface BundleMeta {
  tour_id: string;
  generated_at: string;
  downloaded_at: string;
  size_bytes: number;
}

async function downloadBundleFromServer(
  tourId: string,
): Promise<MonumentBundle> {
  const res = await fetch(
    `${API_BASE}/api/bundles/${encodeURIComponent(tourId)}`,
  );
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function downloadBundle(
  tourId: string,
): Promise<MonumentBundle> {
  const bundle = await downloadBundleFromServer(tourId);
  const json = JSON.stringify(bundle);

  const meta: BundleMeta = {
    tour_id: tourId,
    generated_at: bundle.generated_at,
    downloaded_at: new Date().toISOString(),
    size_bytes: json.length,
  };

  await AsyncStorage.multiSet([
    [BUNDLE_KEY_PREFIX + tourId, json],
    [META_KEY_PREFIX + tourId, JSON.stringify(meta)],
  ]);

  return bundle;
}

export async function getBundle(
  tourId: string,
): Promise<MonumentBundle | null> {
  const json = await AsyncStorage.getItem(BUNDLE_KEY_PREFIX + tourId);
  if (!json) return null;
  return JSON.parse(json);
}

export async function isBundleStale(
  tourId: string,
  serverGeneratedAt: string,
): Promise<boolean> {
  const metaJson = await AsyncStorage.getItem(META_KEY_PREFIX + tourId);
  if (!metaJson) return true;
  const meta: BundleMeta = JSON.parse(metaJson);
  return meta.generated_at !== serverGeneratedAt;
}

export async function listDownloadedBundles(): Promise<BundleMeta[]> {
  const keys = await AsyncStorage.getAllKeys();
  const metaKeys = keys.filter(k => k.startsWith(META_KEY_PREFIX));
  if (metaKeys.length === 0) return [];

  const pairs = await AsyncStorage.multiGet(metaKeys);
  const metas: BundleMeta[] = [];
  for (const [, value] of pairs) {
    if (value) {
      metas.push(JSON.parse(value));
    }
  }
  return metas;
}

export async function deleteBundle(tourId: string): Promise<void> {
  await AsyncStorage.multiRemove([
    BUNDLE_KEY_PREFIX + tourId,
    META_KEY_PREFIX + tourId,
  ]);
}
