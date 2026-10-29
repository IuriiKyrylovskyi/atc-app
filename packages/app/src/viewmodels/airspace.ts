/**
 * Airspace view-model: what the screens need from a loaded pack, whatever
 * built it (FAA CIFP, a state eAIP, EUROCONTROL ERC, OurAirports, VATSpy —
 * the atc-data importers all end in the same `AirspacePack`).
 */
import type { AirspacePack, LatLon } from '@atc-app/sim';
import { verticalLimits, type VideoMap } from '@atc-app/scope';

export interface SectorVM {
  id: string;
  name?: string;
  /** Vertical limits as the scope prints them, e.g. "275–660". */
  limits: string;
  /** Dropdown text: id, name, limits. */
  label: string;
}

export interface SourceVM {
  name: string;
  licence: string;
  url: string;
  retrieved: string;
}

export interface RunwayEndVM {
  /** "RW04L". */
  id: string;
  pos: LatLon;
}

export interface AirspaceVM {
  id: string;
  name: string;
  airac: string;
  reference: LatLon;
  /** Degrees east (negative = west). */
  magVar: number;
  sources: SourceVM[];
  /** Control sectors, in pack order. */
  sectors: SectorVM[];
  /** Fix positions by id (command validation, route paths). */
  fixes: ReadonlyMap<string, LatLon>;
  /** Runways with an ILS, keyed by `runwayKey`. */
  ilsRunways: ReadonlySet<string>;
  /** Runway thresholds, keyed by `runwayKey`. */
  thresholds: ReadonlyMap<string, RunwayEndVM>;
}

export const runwayKey = (airport: string, runway: string): string => `${airport}|${runway}`;

export function sectorLabel(s: {
  id: string;
  name?: string;
  floorFt: number;
  ceilingFt: number;
}): string {
  return `${s.id} ${s.name ?? ''} ${verticalLimits(s)}`;
}

/** Builds the airspace view-model of a pack and its video map (sectors come from the map). */
export function airspaceFromPack(pack: AirspacePack, map: Pick<VideoMap, 'sectors'>): AirspaceVM {
  return {
    id: pack.meta.id,
    name: pack.meta.name,
    airac: pack.meta.airac,
    reference: pack.meta.reference,
    magVar: pack.meta.magVar,
    sources: pack.meta.sources.map((s) => ({
      name: s.name,
      licence: s.licence,
      url: s.url,
      retrieved: s.retrieved,
    })),
    sectors: map.sectors.map((s) => ({
      id: s.id,
      ...(s.name ? { name: s.name } : {}),
      limits: verticalLimits(s),
      label: sectorLabel(s),
    })),
    fixes: new Map(pack.fixes.map((f) => [f.id, f.pos])),
    ilsRunways: new Set(pack.runways.filter((r) => r.ils).map((r) => runwayKey(r.airport, r.id))),
    thresholds: new Map(
      pack.runways.map((r) => [runwayKey(r.airport, r.id), { id: `RW${r.id}`, pos: r.threshold }])
    ),
  };
}
