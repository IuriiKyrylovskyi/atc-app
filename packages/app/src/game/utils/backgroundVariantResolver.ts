/**
 * packages/app/src/game/utils/backgroundVariantResolver.ts
 *
 * Shared fallback/selection algorithm for background asset variants.
 * Used by BOTH:
 *   - assetLoader.ts        (bundled, free-level backgrounds)
 *   - backgroundAssetService.ts (remote, paid-level backgrounds)
 * so free and paid levels resolve device-variant selection identically.
 *
 * See BACKGROUND_ASSETS.md §3 for the human-readable spec this implements.
 * Entry shape matches manifest.json / manifest-paid.json written by
 * scripts/process-backgrounds.ts.
 */

export interface BackgroundManifestEntry {
  level: string;
  levelNumber: number | null;
  airportKey: string;
  ratio: string;
  dpr: number;
  format: string;
  isFallback: boolean;
  file: string;
  /** Path relative to the backgrounds root (bundled) or bucket prefix (remote). */
  path: string;
  width: number;
  height: number;
  size: number;
  checksum: string;
  zoom: number;
  crop: { left: number; top: number; width: number; height: number };
  sourceFile: string;
  generatedAt: number;
  scriptVersion: string;
}

/** Numeric aspect-ratio value for each supported ratio folder key. Keep in sync with deviceInfo.ts RATIO_BUCKETS. */
const RATIO_VALUES: Record<string, number> = {
  '21x9': 21 / 9,
  '20x9': 20 / 9,
  '19_5x9': 19.5 / 9,
  '19x9': 19 / 9,
  '18_5x9': 18.5 / 9,
  '18x9': 18 / 9,
  '16x9': 16 / 9,
  '16x10': 16 / 10,
  '3x2': 3 / 2,
  '4x3': 4 / 3,
};

function ratioDistance(a: string, b: string): number {
  const va = RATIO_VALUES[a];
  const vb = RATIO_VALUES[b];
  if (va === undefined || vb === undefined) return Infinity;
  return Math.abs(va - vb);
}

export interface ResolveOptions {
  levelNumber: number;
  /** Device's resolved aspectRatioKey, e.g. from getDeviceInfo(). */
  ratio: string;
  /** Device pixel ratio — rounded to the nearest available bucket. */
  dpr: number;
  /** Format priority order, most-preferred first. Defaults to ['webp']. */
  formats?: string[];
  /** Optional airport key to filter entries (new airport-keyed system). */
  airportKey?: string;
}

/**
 * Returns manifest entries for `levelNumber` (and optionally `airportKey`),
 * ordered best-first:
 *   1. exact ratio + requested dpr (rounded), preferred format(s) in order
 *   2. same ratio, next-closest available dpr (prefers a lower dpr over higher)
 *   3. next-closest ratio (by numeric aspect distance) at requested dpr
 *   4. next-closest ratio + next-closest dpr
 *   5. baseline: 16x9 @ 1x — guaranteed to exist since it's always generated
 *
 * Fallback-format entries (isFallback: true, e.g. PNG) always sort after
 * preferred-format entries for the same (ratio, dpr) pair, never before.
 *
 * The caller should try candidates in order and advance to the next one on
 * a load failure (corrupt file, unsupported format, network/404 error) —
 * this list is a priority-ordered attempt queue, not just a single answer.
 */
export function resolveBackgroundVariants(
  entries: BackgroundManifestEntry[],
  opts: ResolveOptions
): BackgroundManifestEntry[] {
  const { levelNumber, ratio, formats = ['webp'], airportKey } = opts;
  const dpr = Math.max(1, Math.round(opts.dpr || 1));

  let forLevel = entries.filter((e) => e.levelNumber === levelNumber);
  if (airportKey) {
    forLevel = forLevel.filter((e) => e.airportKey === airportKey);
  }
  if (forLevel.length === 0) return [];

  const availableDprs = Array.from(new Set(forLevel.map((e) => e.dpr)));
  const availableRatios = Array.from(new Set(forLevel.map((e) => e.ratio)));

  const rankedRatios = [...availableRatios].sort(
    (a, b) => ratioDistance(a, ratio) - ratioDistance(b, ratio)
  );
  // Always end with 16x9 as an absolute baseline even if ratio-distance ranked it earlier/later.
  if (availableRatios.includes('16x9')) {
    const withoutBaseline = rankedRatios.filter((r) => r !== '16x9');
    withoutBaseline.push('16x9');
    rankedRatios.length = 0;
    rankedRatios.push(...withoutBaseline);
  }

  // Requested dpr first, then closest-below, then closest-above.
  const rankedDprs = [...availableDprs].sort((a, b) => {
    if (a === dpr) return -1;
    if (b === dpr) return 1;
    const aBelow = a <= dpr;
    const bBelow = b <= dpr;
    if (aBelow !== bBelow) return aBelow ? -1 : 1; // prefer downscale-available over upscale
    return aBelow ? b - a : a - b;
  });

  const seen = new Set<string>();
  const ordered: BackgroundManifestEntry[] = [];

  for (const r of rankedRatios) {
    for (const d of rankedDprs) {
      const matches = forLevel
        .filter((e) => e.ratio === r && e.dpr === d)
        .sort((a, b) => {
          if (a.isFallback !== b.isFallback) return a.isFallback ? 1 : -1; // preferred formats first
          const aIdx = formats.indexOf(a.format);
          const bIdx = formats.indexOf(b.format);
          return (aIdx === -1 ? formats.length : aIdx) - (bIdx === -1 ? formats.length : bIdx);
        });
      for (const e of matches) {
        const key = `${e.ratio}__${e.dpr}__${e.format}`;
        if (!seen.has(key)) {
          seen.add(key);
          ordered.push(e);
        }
      }
    }
  }

  return ordered;
}

/** Convenience: best single entry, or null if nothing matches this level at all. */
export function resolveBestBackgroundVariant(
  entries: BackgroundManifestEntry[],
  opts: ResolveOptions
): BackgroundManifestEntry | null {
  const [best] = resolveBackgroundVariants(entries, opts);
  return best ?? null;
}

/** Stable Phaser texture key — independent of dpr/format, matches the existing convention used across GameScene/assetLoader. */
export function backgroundTextureKey(levelNumber: number, ratio: string): string {
  return `level-${levelNumber}-${ratio}`;
}

export function normalizeAirportTextureKey(airportKey: string): string {
  return airportKey.replace(/[/:\\]/g, '_');
}

/** Stable Phaser texture key for airport-keyed system. */
export function backgroundTextureKeyForAirport(airportKey: string, ratio: string): string {
  return `bg-${normalizeAirportTextureKey(airportKey)}-${ratio}`;
}

/** Resolve airport key from level number (legacy support) or use directly. */
export function resolveAirportKey(
  levelOrAirport: number | string,
  entries: BackgroundManifestEntry[]
): string | null {
  if (typeof levelOrAirport === 'string') {
    const match = entries.find((e) => e.airportKey === levelOrAirport);
    return match?.airportKey ?? levelOrAirport;
  }
  const match = entries.find((e) => e.levelNumber === levelOrAirport);
  if (match) return match.airportKey;

  const airportNumber = Math.ceil(levelOrAirport / 5);
  const baseLevelNumber = (airportNumber - 1) * 5 + 1;
  const baseMatch = entries.find((e) => e.levelNumber === baseLevelNumber);
  return baseMatch?.airportKey ?? null;
}

/** Get level number from airport key (legacy support). */
export function getLevelNumberForAirportKey(
  airportKey: string,
  entries: BackgroundManifestEntry[]
): number | null {
  const match = entries.find((e) => e.airportKey === airportKey);
  return match?.levelNumber ?? null;
}
