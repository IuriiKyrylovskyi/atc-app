/**
 * packages/app/src/services/backgroundAssetService.ts
 *
 * Unified runtime loader for EVERY level's background — free and paid alike.
 * No level's background image ships in the app bundle; every ratio × dpr ×
 * format combination for every level used to be bundled for free levels,
 * which meant every device downloaded every variant even though it only
 * ever needs one — pure app-size waste, worse on mobile where install size
 * directly affects conversion. Now both tiers are downloaded on demand and
 * cached locally, same as paid always was. The only difference between
 * tiers is which bucket:
 *
 *   FREE airports (EGLC, WADD, KSDM/MMTJ) → PUBLIC_BUCKET
 *     No auth required — publicly readable. Manifest is small enough to
 *     stay bundled (packages/app/src/assets/backgrounds/manifest.json,
 *     a few KB of JSON, negligible) so resolving a free level's path never
 *     needs a network round-trip just for structure — only the binary
 *     image itself is fetched remotely.
 *
 *   PAID airports (all others) → PRIVATE_BUCKET
 *     Same bucket + RLS policy (is_premium = true) that already gates
 *     levels_full.json. Manifest (manifest-paid.json) is fetched remotely
 *     too, only after monetization.canAccessLevel() is true.
 *
 * FLOW (either tier)
 * ───────────────────
 *  1. getBackgroundForLevel(n) / getBackgroundForAirport(key) — call this from GameScene/BootScene.
 *     For paid airports, the caller must still have already
 *     confirmed monetization.canAccessLevel(n) — this function does not
 *     duplicate that check, it just won't succeed against RLS if the caller
 *     skipped it.
 *  2. Resolve the best variant for this device via resolveBackgroundVariants().
 *  3. Download that ONE file, verify its sha256 checksum, cache it locally,
 *     return a data: URI (base64) — ALWAYS, on every platform. Never a
 *     blob: object URL: Phaser's loader (this.load.image) fetches image
 *     URLs via XHR, and most CSPs' connect-src directive doesn't include
 *     blob:, so a blob: URL gets silently blocked with a CSP console error
 *     and the texture never registers. Callers MUST load the returned URL
 *     with `this.textures.addBase64(key, url)`, not `this.load.image()` —
 *     addBase64 uses an <img> element directly and never goes through the
 *     XHR-gated loader, so it's immune to this regardless of CSP config.
 *  4. On any candidate failing (network error, checksum mismatch, decode
 *     failure), fall through to the next-best candidate automatically.
 *
 * CACHING
 * ───────
 *  - Native (Capacitor): binary written to Directory.Data via Filesystem,
 *    read back as a base64 data URI.
 *  - Web/Electron: the Blob itself is cached in IndexedDB (space-efficient,
 *    no base64 overhead at rest), NOT the Cache Storage API — Cache Storage
 *    requires a secure context (https/wss/localhost) and is NOT reliably
 *    available when Electron loads the built app via file://. IndexedDB has
 *    no such restriction. The blob is converted to a data: URI on read/write
 *    before being returned to the caller — see the note in §3 above for why
 *    it's never a blob: object URL despite the Blob being what's stored.
 *  - The paid manifest is cached as text (Filesystem vs localStorage),
 *    same pattern as LevelManager's readCachedLevels/writeCachedLevels.
 *    The free manifest doesn't need this — it's bundled, not fetched.
 *
 * DEV/PROD: identical code path. Both always hit the real Supabase bucket
 * (public or private). There is currently no local-dev override — see
 * PROJECT_STATUS.md Piece 5 for the planned VITE_LOCAL_BACKGROUNDS_URL flag.
 */
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';
import { supabase } from '@/lib/supabase';
import { NetworkTimeoutError } from '@/utils/fetchWithTimeout';
import { getDeviceInfo } from '@/game/utils/deviceInfo';
import { FREE_LEVEL_LIMIT } from '@/stores/monetization';
import { getLevelByNumber } from '@/game/config/levels.config';
import { useGameStore } from '@/stores/game';
import {
  resolveBackgroundVariants,
  backgroundTextureKey,
  backgroundTextureKeyForAirport,
  resolveAirportKey,
  type BackgroundManifestEntry,
} from '@/game/utils/backgroundVariantResolver';
// Bundled — free airports' manifest only (a few KB of JSON). The actual image
// binaries are NOT bundled; this just tells us which file to fetch from
// PUBLIC_BUCKET for the current device.
import freeManifest from '@/assets/backgrounds/manifest.json';

const PUBLIC_BUCKET = 'game_assets_public';
const PRIVATE_BUCKET = 'game_assets';
const PRIVATE_MANIFEST_OBJECT_PATH = 'backgrounds/manifest-paid.json';
const PRIVATE_MANIFEST_CACHE_KEY = 'atc-app_bg_manifest_paid';
const PRIVATE_MANIFEST_CACHE_FILE = 'atc-app_bg_manifest_paid.json';
const PREFERRED_FORMATS = ['webp'];
const IDB_NAME = 'atc-app-backgrounds';
const IDB_STORE = 'assets';
const IDB_VERSION = 1;

const FREE_AIRPORT_KEYS = ['eglc', 'wadd', 'ksdm/mmtj'];

interface RemoteManifest {
  generatedAt: number;
  scriptVersion: string;
  entries: BackgroundManifestEntry[];
}

export interface ResolvedBackgroundAsset {
  /** Stable Phaser texture key, e.g. "level-4-20x9" or "bg-EGLC-20x9" — matches the bundled-asset convention. */
  key: string;
  /** Always a data: URI (base64) — never a blob: object URL, which most CSPs block via connect-src. Load with textures.addBase64(), not load.image(). */
  url: string;
  entry: BackgroundManifestEntry;
}

// ── IndexedDB blob cache (web/Electron — NOT Cache Storage API, see header) ──

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) {
        req.result.createObjectStore(IDB_STORE);
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key: string): Promise<Blob | null> {
  try {
    const db = await openIdb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve((req.result as Blob) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function idbSet(key: string, blob: Blob): Promise<void> {
  try {
    const db = await openIdb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(blob, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('⚠️ Could not write background to IndexedDB:', err);
  }
}

// ── Paid manifest fetch + cache (mirrors LevelManager's pattern) ──────────

async function readCachedPaidManifest(): Promise<RemoteManifest | null> {
  if (!Capacitor.isNativePlatform()) {
    try {
      const raw = localStorage.getItem(PRIVATE_MANIFEST_CACHE_KEY);
      return raw ? (JSON.parse(raw) as RemoteManifest) : null;
    } catch {
      return null;
    }
  }
  try {
    const file = await Filesystem.readFile({
      path: PRIVATE_MANIFEST_CACHE_FILE,
      directory: Directory.Data,
      encoding: 'utf8' as any,
    });
    return JSON.parse(file.data as string) as RemoteManifest;
  } catch {
    return null;
  }
}

async function writeCachedPaidManifest(text: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    try {
      localStorage.setItem(PRIVATE_MANIFEST_CACHE_KEY, text);
    } catch {
      console.warn('⚠️ Could not cache paid background manifest in localStorage');
    }
    return;
  }
  try {
    await Filesystem.writeFile({
      path: PRIVATE_MANIFEST_CACHE_FILE,
      directory: Directory.Data,
      data: text,
      encoding: 'utf8' as any,
      recursive: true,
    });
  } catch (err) {
    console.warn('⚠️ Could not cache paid background manifest to filesystem:', err);
  }
}

/** Only ever called for paid airports, after the caller confirmed premium access. */
async function getPaidManifest(forceRefresh = false): Promise<RemoteManifest | null> {
  if (!forceRefresh) {
    const cached = await readCachedPaidManifest();
    if (cached) return cached;
  }
  try {
    const { data, error } = await supabase.storage
      .from(PRIVATE_BUCKET)
      .download(PRIVATE_MANIFEST_OBJECT_PATH);
    if (error || !data) {
      console.error('❌ Failed to download paid background manifest:', error?.message);
      return await readCachedPaidManifest();
    }
    const text = await data.text();
    await writeCachedPaidManifest(text);
    return JSON.parse(text) as RemoteManifest;
  } catch (err) {
    console.error('❌ Paid background manifest fetch error:', err);
    return await readCachedPaidManifest();
  }
}

// ── Binary asset download + checksum + cache ──────────────────────────────

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function bufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function mimeForFormat(format: string): string {
  if (format === 'webp') return 'image/webp';
  if (format === 'png') return 'image/png';
  if (format === 'jpg' || format === 'jpeg') return 'image/jpeg';
  return 'application/octet-stream';
}

function timeout<T>(ms: number): Promise<T> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new NetworkTimeoutError(`Background download timed out after ${ms}ms`)), ms)
  );
}

function nativeCachePath(bucket: string, objectPath: string): string {
  return `backgrounds/${bucket}_${objectPath.replace(/\//g, '_')}`;
}

async function readCachedAsset(
  bucket: string,
  entry: BackgroundManifestEntry
): Promise<string | null> {
  const objectPath = `backgrounds/${entry.path}`;

  if (!Capacitor.isNativePlatform()) {
    const blob = await idbGet(`${bucket}:${objectPath}`);
    if (!blob) return null;
    // data: URI, NOT URL.createObjectURL(blob) — a blob: URL requires Phaser's
    // loader to XHR-fetch it, which most CSPs block (connect-src rarely
    // includes blob:). A data: URI needs no fetch at all — see
    // getBackgroundForLevel's caller (GameScene/BootScene), which loads it
    // via Phaser's textures.addBase64() instead of load.image(), bypassing
    // the XHR-based loader entirely.
    const buffer = await blob.arrayBuffer();
    return `data:${mimeForFormat(entry.format)};base64,${bufferToBase64(buffer)}`;
  }

  try {
    const file = await Filesystem.readFile({
      path: nativeCachePath(bucket, objectPath),
      directory: Directory.Data,
    });
    return `data:${mimeForFormat(entry.format)};base64,${file.data}`;
  } catch {
    return null;
  }
}

async function writeCachedAsset(
  bucket: string,
  entry: BackgroundManifestEntry,
  buffer: ArrayBuffer
): Promise<string> {
  const objectPath = `backgrounds/${entry.path}`;

  if (!Capacitor.isNativePlatform()) {
    // Blob storage in IndexedDB is still space-efficient (no base64 33%
    // overhead at rest) — only the URL handed back to the caller is base64,
    // built directly from the buffer we already have here.
    const blob = new Blob([buffer], { type: mimeForFormat(entry.format) });
    await idbSet(`${bucket}:${objectPath}`, blob);
    return `data:${mimeForFormat(entry.format)};base64,${bufferToBase64(buffer)}`;
  }

  const base64 = bufferToBase64(buffer);
  try {
    await Filesystem.writeFile({
      path: nativeCachePath(bucket, objectPath),
      directory: Directory.Data,
      data: base64,
      recursive: true,
    });
  } catch (err) {
    console.warn('⚠️ Could not write background to filesystem:', err);
  }
  return `data:${mimeForFormat(entry.format)};base64,${base64}`;
}

/**
 * Downloads (or returns cached) the binary for one manifest entry from the
 * given bucket. Verifies sha256 against the manifest's checksum; on
 * mismatch, the caller moves on to the next candidate.
 */
async function fetchAssetForEntry(
  bucket: string,
  entry: BackgroundManifestEntry
): Promise<string | null> {
  const cachedUrl = await readCachedAsset(bucket, entry);
  if (cachedUrl) return cachedUrl;

  const objectPath = `backgrounds/${entry.path}`;
  let data: any = null;
  let error: any = null;
  try {
    const result = await Promise.race([
      supabase.storage.from(bucket).download(objectPath),
      timeout<{ data: any; error: any }>(12000),
    ]);
    data = result?.data ?? null;
    error = result?.error ?? null;
  } catch (err) {
    if (err instanceof NetworkTimeoutError) {
      console.warn(`⚠️ Background download timed out (12s) for ${bucket}/${objectPath} — falling through to next candidate`);
    } else {
      console.error(`❌ Unexpected error downloading ${bucket}/${objectPath}:`, err);
    }
    return null;
  }
  if (error || !data) {
    console.error(`❌ Failed to download ${bucket}/${objectPath}:`, error?.message);
    return null;
  }
  try {
    const buffer = await data.arrayBuffer();
    const checksum = await sha256Hex(buffer);
    if (checksum !== entry.checksum) {
      console.error(
        `❌ Checksum mismatch for ${bucket}/${objectPath} — got ${checksum}, expected ${entry.checksum}`
      );
      return null;
    }
    return await writeCachedAsset(bucket, entry, buffer);
  } catch (err) {
    console.error(`❌ Unexpected error processing ${bucket}/${objectPath}:`, err);
    return null;
  }
}

function isAirportFree(airportKey: string): boolean {
  return FREE_AIRPORT_KEYS.includes(airportKey.toLowerCase());
}

/**
 * Resolve + download + cache the single best-matching background for this
 * device and airport, from whichever bucket that airport's tier uses. Tries
 * candidates in resolver-priority order, falling through to the next one
 * on any failure. Returns null only if every candidate fails (caller
 * should show the level without a background rather than block gameplay).
 *
 * For paid airports, the caller must have already confirmed
 * monetization.canAccessLevel(levelNumber) — this function doesn't
 * duplicate that check (RLS enforces it server-side regardless, but
 * skipping the client-side check wastes a network round-trip on a
 * guaranteed-403).
 */
export async function getBackgroundForAirport(
  airportKey: string
): Promise<ResolvedBackgroundAsset | null> {
  const gameStore = useGameStore();
  const isTraining = gameStore.trainingLevel !== null;

  // Find level number for this airport from manifest entries
  const manifest: RemoteManifest | null = isAirportFree(airportKey)
    ? (freeManifest as RemoteManifest)
    : await getPaidManifest();

  if (!manifest) {
    console.error(`❌ No background manifest available for airport ${airportKey}`);
    return null;
  }

  // Find the level number for this airport key
  const entryWithAirport = manifest.entries.find((e) => e.airportKey === airportKey);
  const levelNumber = entryWithAirport?.levelNumber ?? 1;

  const isPaid = !isTraining && !isAirportFree(airportKey);
  const bucket = isPaid ? PRIVATE_BUCKET : PUBLIC_BUCKET;

  const { aspectRatioKey, dpr } = getDeviceInfo();
  const candidates = resolveBackgroundVariants(manifest.entries, {
    levelNumber,
    ratio: aspectRatioKey,
    dpr,
    formats: PREFERRED_FORMATS,
    airportKey,
  });

  if (candidates.length === 0) {
    console.error(`❌ No background manifest entries for airport ${airportKey} in ${bucket}`);
    return null;
  }

  for (const entry of candidates) {
    const url = await fetchAssetForEntry(bucket, entry);
    if (url) {
      const key = backgroundTextureKeyForAirport(airportKey, entry.ratio);
      return { key, url, entry };
    }
  }

  console.error(`❌ Every candidate background failed for airport ${airportKey} (${bucket})`);
  return null;
}

/**
 * Legacy support: get background by level number.
 * Maintains compatibility with existing call sites.
 */
export async function getBackgroundForLevel(
  levelNumber: number | string
): Promise<ResolvedBackgroundAsset | null> {
  const gameStore = useGameStore();
  const numericLevel =
    typeof levelNumber === 'string' ? parseInt(levelNumber.replace(/\D/g, ''), 10) : levelNumber;
  const isTraining = gameStore.trainingLevel !== null && gameStore.trainingLevel === numericLevel;

  // Find the airport key for this level number
  const manifest: RemoteManifest | null =
    numericLevel <= FREE_LEVEL_LIMIT ? (freeManifest as RemoteManifest) : await getPaidManifest();

  if (!manifest) {
    console.error(`❌ No background manifest available for level ${levelNumber}`);
    return null;
  }

  const levelConfig = getLevelByNumber(numericLevel);
  const airportKey =
    resolveAirportKey(numericLevel, manifest.entries) ?? levelConfig?.backgroundImage ?? null;
  if (!airportKey) {
    console.error(`❌ No airport key found for level ${numericLevel}`);
    return null;
  }

  const isPaid = !isTraining && numericLevel > FREE_LEVEL_LIMIT;
  const bucket = isPaid ? PRIVATE_BUCKET : PUBLIC_BUCKET;

  const { aspectRatioKey, dpr } = getDeviceInfo();
  const manifestLevelNumber =
    manifest.entries.find((e) => e.airportKey === airportKey)?.levelNumber ?? numericLevel;
  const candidates = resolveBackgroundVariants(manifest.entries, {
    levelNumber: manifestLevelNumber,
    ratio: aspectRatioKey,
    dpr,
    formats: PREFERRED_FORMATS,
    airportKey,
  });

  if (candidates.length === 0) {
    console.error(`❌ No background manifest entries for level ${numericLevel} in ${bucket}`);
    return null;
  }

  for (const entry of candidates) {
    const url = await fetchAssetForEntry(bucket, entry);
    if (url) {
      const key = backgroundTextureKey(numericLevel, entry.ratio);
      return { key, url, entry };
    }
  }

  console.error(`❌ Every candidate background failed for level ${numericLevel} (${bucket})`);
  return null;
}

/**
 * Fire-and-forget prefetch — same resolution/download/cache path, but never
 * throws and the caller doesn't await the result. Used to warm the cache for
 * the next level (free or paid) so entering it feels instant.
 */
export function prefetchBackground(levelNumber: number): void {
  getBackgroundForLevel(levelNumber)
    .then((asset) => {
      if (asset) {
        console.log(`✅ Prefetched background for level ${levelNumber}: ${asset.key}`);
      }
    })
    .catch((err) => console.warn(`⚠️ Prefetch failed for level ${levelNumber}:`, err));
}

/** Fire-and-forget prefetch for airport key. */
export function prefetchBackgroundForAirport(airportKey: string): void {
  getBackgroundForAirport(airportKey)
    .then((asset) => {
      if (asset) {
        console.log(`✅ Prefetched background for airport ${airportKey}: ${asset.key}`);
      }
    })
    .catch((err) => console.warn(`⚠️ Prefetch failed for airport ${airportKey}:`, err));
}

/** Clears the cached paid manifest after a content update. */
export async function clearPaidManifestCache(): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    localStorage.removeItem(PRIVATE_MANIFEST_CACHE_KEY);
    return;
  }
  try {
    await Filesystem.deleteFile({
      path: PRIVATE_MANIFEST_CACHE_FILE,
      directory: Directory.Data,
    });
  } catch {
    // Not cached yet — fine.
  }
}

// Back-compat aliases — existing call sites (GameScene.ts, monetization.ts)
// used these paid-specific names before free levels also went remote. Same
// function now handles both tiers internally.
export const getPaidBackgroundForLevel = getBackgroundForLevel;
export const prefetchPaidBackground = prefetchBackground;

export const backgroundAssetService = {
  getBackgroundForLevel,
  prefetchBackground,
  getBackgroundForAirport,
  prefetchBackgroundForAirport,
  getPaidBackgroundForLevel,
  prefetchPaidBackground,
  clearPaidManifestCache,
};
