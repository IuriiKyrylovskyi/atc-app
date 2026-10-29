/**
 * VATSpy data project importer — FIR / UIR / ARTCC borders (`Boundaries.geojson`,
 * CC BY-SA 4.0, VATSIM community; `pnpm data:vatspy`). Community-drawn: used for
 * sector edges that follow a FIR border and for whole-centre volumes (ZNY) that
 * official sources (AIP prose, CIFP) do not give as coordinates.
 */
import type { LatLon, PackSource } from '@atc-app/sim';

export const VATSPY_SOURCE_URL = 'https://github.com/vatsimnetwork/vatspy-data-project';

interface Feature {
  properties: { id?: string; oceanic?: string };
  geometry: { type: string; coordinates: number[][][] | number[][][][] };
}

/**
 * Outer rings by id: the largest ring per id; an oceanic part sharing the id
 * ("KZNY") is available as "<id>:oceanic".
 */
export function vatspyRings(geojson: string): Map<string, LatLon[]> {
  const geo = JSON.parse(geojson) as { features: Feature[] };
  const rings = new Map<string, LatLon[]>();
  for (const f of geo.features) {
    if (!f.properties.id) continue;
    const id = f.properties.oceanic === '1' ? `${f.properties.id}:oceanic` : f.properties.id;
    const polys = (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates) as number[][][][];
    for (const poly of polys) {
      const outer = poly[0]!.map(([lon, lat]) => ({ lat: lat!, lon: lon! }));
      if (outer.length > (rings.get(id)?.length ?? 0)) rings.set(id, outer);
    }
  }
  return rings;
}

/** Pack source entry for VATSpy borders; `commit` = upstream commit (db/vatspy/SOURCE). */
export function vatspySource(commit: string, retrieved: string): PackSource {
  return {
    name: `VATSpy data project FIR borders (${commit.slice(0, 7) || 'unknown commit'})`,
    licence: 'CC-BY-SA-4.0',
    url: VATSPY_SOURCE_URL,
    retrieved,
  };
}
