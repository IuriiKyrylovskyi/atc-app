/**
 * Area-picker view-model: the configured areas (config/areas.ts) checked
 * against the pack manifest — an area is selectable once its pack is built,
 * and a development-only pack only in development builds.
 */
import type { AreaConfig } from '@/config/areas';
import type { PackManifestEntry } from '@/services/packLoader';

export interface AreaOptionVM {
  packId: string;
  name: string;
  /** What the area's data is (tooltip). */
  note: string;
  available: boolean;
}

/**
 * `manifest` null = not loaded yet: every area is offered, and loading one
 * reports what is missing.
 */
export function areaOptions(
  areas: readonly AreaConfig[],
  manifest: Readonly<Record<string, PackManifestEntry>> | null,
  dev: boolean
): AreaOptionVM[] {
  return areas.map((a) => {
    const entry = manifest?.[a.packId];
    const available = manifest === null || Boolean(entry && (!entry.devOnly || dev));
    return { packId: a.packId, name: a.name, note: a.note, available };
  });
}
