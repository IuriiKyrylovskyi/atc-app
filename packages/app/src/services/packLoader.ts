/**
 * Loads airspace packs built by `pnpm pack:build`.
 *
 * Today packs are served with the app (`/packs/manifest.json` + `/packs/<id>@<airac>.json`,
 * see the airspace-packs Vite plugin). Every pack is validated on load, so a
 * corrupt or hand-edited file fails loudly instead of drawing nonsense.
 */
import { validatePack } from '@atc-app/atc-data';
import type { AirspacePack } from '@atc-app/sim';

export interface PackManifestEntry {
  id: string;
  name: string;
  airac: string;
  file: string;
  bytes: number;
  sha256: string;
  counts: Record<string, number>;
}

const BASE = 'packs/';

export async function loadPackManifest(): Promise<Record<string, PackManifestEntry>> {
  const res = await fetch(`${BASE}manifest.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`No pack manifest (HTTP ${res.status}) — run pnpm pack:build`);
  const json = (await res.json()) as { packs: Record<string, PackManifestEntry> };
  return json.packs;
}

export async function loadPack(id: string): Promise<{ pack: AirspacePack; entry: PackManifestEntry }> {
  const manifest = await loadPackManifest();
  const entry = manifest[id];
  if (!entry) throw new Error(`Pack "${id}" is not built (available: ${Object.keys(manifest).join(', ') || 'none'})`);
  const res = await fetch(BASE + entry.file);
  if (!res.ok) throw new Error(`Pack file ${entry.file}: HTTP ${res.status}`);
  const result = validatePack(await res.json());
  if (!result.ok || !result.pack) {
    throw new Error(`Pack ${entry.file} failed validation: ${result.errors[0]?.message ?? 'unknown error'}`);
  }
  return { pack: result.pack, entry };
}
