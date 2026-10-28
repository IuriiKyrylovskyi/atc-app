/**
 * Cross-platform asset loader with aspect ratio support
 * Loads backgrounds based on device screen ratio.
 *
 * Aspect-ratio detection is delegated to getDeviceInfo() which reads
 * window.__DEVICE_INFO__ if the native main process (Capacitor/Electron)
 * injected it, or falls back to screen.width/height.
 */
import { getDeviceInfo } from '@/game/utils/deviceInfo';
import { getBackgroundForLevel, getBackgroundForAirport } from '@/services/backgroundAssetService';
import { normalizeAirportTextureKey } from '@/game/utils/backgroundVariantResolver';

/**
 * Load all plane sprites dynamically.
 *
 * NEW FOLDER STRUCTURE:
 *   @/assets/planes/[number]-[name]/[number]-[color].png
 *   e.g. @/assets/planes/1-a380/1-blue.png
 *
 * The Phaser texture key is derived from the filename only (not the folder),
 * so it stays "1-blue", "1-shadow", etc. — identical to what GameScene and
 * SpawnSystem expect. The folder is used only to locate the file.
 *
 * Key extraction:
 *   path  = ".../planes/1-a380/1-blue.png"
 *   folder = "1-a380"  (ignored at runtime — number already in filename)
 *   file   = "1-blue"  → key = "1-blue"  ✓
 */
export async function loadPlaneSprites(): Promise<{
  [key: string]: string;
}> {
  console.log('📄 Loading plane sprites from @/assets/planes/**/*.png...');

  // `query: '?url'` tells Vite to resolve each asset to its final hashed URL
  // (e.g. /assets/planes/1-a380/1-blue.abc123.png) rather than returning
  // the raw source path. `import: 'default'` returns the URL string directly.
  const planeModules = import.meta.glob('@/assets/planes/**/*.png', {
    query: '?url',
    import: 'default',
  });

  const sprites: { [key: string]: string } = {};

  for (const path in planeModules) {
    // Match: .../planes/<folder>/<filename>.png
    // e.g.   .../planes/1-a380/1-blue.png
    const match = path.match(/\/planes\/([^/]+)\/([^/]+)\.png$/);
    if (match) {
      // Use the filename as the Phaser texture key — folder is navigation only.
      const key = match[2]; // "1-blue", "2-shadow", etc.
      const url = await planeModules[path]();
      sprites[key] = url;
      console.log(`  ✅ Found: ${key} (${match[1]}/${match[2]}.png)`);
    }
  }

  console.log(`✅ Loaded ${Object.keys(sprites).length} plane sprites`);
  return sprites;
}

/**
 * Load ONE background for a level — delegates entirely to
 * backgroundAssetService.getBackgroundForLevel(), which resolves the best
 * device variant, downloads it (from the public bucket for free levels, the
 * private bucket for paid), verifies its checksum, and caches it locally.
 * No level's background binary ships in the app bundle anymore — see
 * backgroundAssetService.ts's header for why.
 *
 * Returns the same `{ [key]: url }` shape callers (BootScene) already
 * expect, and also the manifest entry (crop rect etc.) GameScene needs —
 * callers should prefer calling getBackgroundForLevel() directly if they
 * need that entry; this wrapper exists for preloadAllAssets() below.
 *
 * @param levelNumber  Level to load background for. Required — there's no
 *   "load everything" debug mode anymore now that nothing is bundled.
 */
export async function loadBackgroundImages(levelNumber: number): Promise<{
  [key: string]: string;
}> {
  const asset = await getBackgroundForLevel(levelNumber);
  if (!asset) {
    console.error(`❌ Could not load a background for level ${levelNumber}`);
    return {};
  }
  console.log(`  ✅ Loaded background: ${asset.key}`);
  return { [asset.key]: asset.url };
}

/**
 * Load ONE background for an airport key — delegates entirely to
 * backgroundAssetService.getBackgroundForAirport().
 *
 * @param airportKey  Airport key (e.g., "EGLC", "OMDB_OMSJ") to load background for.
 */
export async function loadBackgroundImagesForAirport(airportKey: string): Promise<{
  [key: string]: string;
}> {
  const asset = await getBackgroundForAirport(airportKey);
  if (!asset) {
    console.error(`❌ Could not load a background for airport ${airportKey}`);
    return {};
  }
  console.log(`  ✅ Loaded background: ${asset.key}`);
  return { [asset.key]: asset.url };
}

/**
 * Get background key for current device aspect ratio (legacy level-based).
 * Reads from window.__DEVICE_INFO__ (injected by native main process) if
 * available, otherwise derives from screen.width/height.
 *
 * Examples:
 * - Android 20:9 phone → 'level-1-20x9'
 * - Desktop 16:9       → 'level-1-16x9'
 */
export function getBackgroundKeyForDevice(levelNumber: number): string {
  const { aspectRatioKey } = getDeviceInfo();
  return `level-${levelNumber}-${aspectRatioKey}`;
}

/**
 * Get background key for current device aspect ratio (airport-keyed).
 *
 * Examples:
 * - Android 20:9 phone → 'bg-EGLC-20x9'
 * - Desktop 16:9       → 'bg-KJFK-16x9'
 */
export function getBackgroundKeyForAirport(airportKey: string): string {
  const { aspectRatioKey } = getDeviceInfo();
  return `bg-${normalizeAirportTextureKey(airportKey)}-${aspectRatioKey}`;
}

/**
 * Get plane sprite path by color and type
 */
export function getPlaneSpriteKey(type: number, color: string): string {
  return `${type}-${color}`;
}

/**
 * Get shadow sprite path by type
 */
export function getShadowSpriteKey(type: number): string {
  return `${type}-shadow`;
}

/**
 * Check if background exists for current aspect ratio (legacy level-based)
 */
export function hasBackgroundForDevice(
  levelNumber: number,
  loadedBackgrounds: { [key: string]: string }
): boolean {
  const key = getBackgroundKeyForDevice(levelNumber);
  return key in loadedBackgrounds;
}

/**
 * Check if background exists for current aspect ratio (airport-keyed)
 */
export function hasBackgroundForAirport(
  airportKey: string,
  loadedBackgrounds: { [key: string]: string }
): boolean {
  const key = getBackgroundKeyForAirport(airportKey);
  return key in loadedBackgrounds;
}

/**
 * Get fallback background if exact match doesn't exist (legacy level-based)
 * Priority: Current ratio → 16x9 → first available
 */
export function getFallbackBackgroundKey(
  levelNumber: number,
  loadedBackgrounds: { [key: string]: string }
): string | null {
  // Try current ratio
  const preferredKey = getBackgroundKeyForDevice(levelNumber);
  if (preferredKey in loadedBackgrounds) {
    return preferredKey;
  }

  console.warn(`⚠️ Background not found: ${preferredKey}`);

  // Try 16x9 (most common fallback)
  const fallback16x9 = `level-${levelNumber}-16x9`;
  if (fallback16x9 in loadedBackgrounds) {
    console.warn(`   Using fallback: ${fallback16x9}`);
    return fallback16x9;
  }

  // Try any variant for this level
  const anyVariant = Object.keys(loadedBackgrounds).find((key) =>
    key.startsWith(`level-${levelNumber}-`)
  );

  if (anyVariant) {
    console.warn(`   Using any available: ${anyVariant}`);
    return anyVariant;
  }

  console.error(`❌ No background found for level ${levelNumber}`);
  return null;
}

/**
 * Get fallback background if exact match doesn't exist (airport-keyed)
 * Priority: Current ratio → 16x9 → first available
 */
export function getFallbackBackgroundKeyForAirport(
  airportKey: string,
  loadedBackgrounds: { [key: string]: string }
): string | null {
  // Try current ratio
  const preferredKey = getBackgroundKeyForAirport(airportKey);
  if (preferredKey in loadedBackgrounds) {
    return preferredKey;
  }

  console.warn(`⚠️ Background not found: ${preferredKey}`);

  // Try 16x9 (most common fallback)
  const fallback16x9 = `bg-${normalizeAirportTextureKey(airportKey)}-16x9`;
  if (fallback16x9 in loadedBackgrounds) {
    console.warn(`   Using fallback: ${fallback16x9}`);
    return fallback16x9;
  }

  // Try any variant for this airport
  const normalizedAirportKey = normalizeAirportTextureKey(airportKey);
  const anyVariant = Object.keys(loadedBackgrounds).find((key) =>
    key.startsWith(`bg-${normalizedAirportKey}-`)
  );

  if (anyVariant) {
    console.warn(`   Using any available: ${anyVariant}`);
    return anyVariant;
  }

  console.error(`❌ No background found for airport ${airportKey}`);
  return null;
}

/**
 * Preload all game assets for a level: bundled plane sprites (unchanged) +
 * ONE background, downloaded via backgroundAssetService (see
 * loadBackgroundImages above — free or paid, decided automatically).
 */
export async function preloadAllAssets(levelNumber: number): Promise<{
  planes: { [key: string]: string };
  backgrounds: { [key: string]: string };
}> {
  console.log('📦 Preloading game assets...');

  const [planes, backgrounds] = await Promise.all([
    loadPlaneSprites(),
    loadBackgroundImages(levelNumber),
  ]);

  console.log('✅ Assets preloaded successfully!');
  console.log(`   Planes: ${Object.keys(planes).length}`);
  console.log(`   Backgrounds: ${Object.keys(backgrounds).length}`);

  return { planes, backgrounds };
}

/**
 * Preload all game assets for an airport: bundled plane sprites (unchanged) +
 * ONE background, downloaded via backgroundAssetService.
 */
export async function preloadAllAssetsForAirport(airportKey: string): Promise<{
  planes: { [key: string]: string };
  backgrounds: { [key: string]: string };
}> {
  console.log('📦 Preloading game assets...');

  const [planes, backgrounds] = await Promise.all([
    loadPlaneSprites(),
    loadBackgroundImagesForAirport(airportKey),
  ]);

  console.log('✅ Assets preloaded successfully!');
  console.log(`   Planes: ${Object.keys(planes).length}`);
  console.log(`   Backgrounds: ${Object.keys(backgrounds).length}`);

  return { planes, backgrounds };
}
