/**
 * OurAirports importer — airports and runway ends worldwide.
 *
 * Source: https://ourairports.com/data/ (airports.csv, runways.csv), released into
 * the public domain. Quality varies by airport (community-maintained), so packs
 * prefer FAA CIFP/NASR thresholds where they exist and use this as the fallback
 * and for non-US airports.
 *
 * PAID-ALT: Navigraph / Jeppesen airport + runway data.
 *   Why better: surveyed thresholds, displaced thresholds and elevations kept
 *   current every AIRAC cycle, worldwide.
 *   Price: Navigraph via each user's own subscription (≈ €10/month); Jeppesen
 *   enterprise licence, quote only.
 */
import { courseTo, destination, normDeg, M_PER_FT, type Airport, type PackSource, type Runway } from '@atc-app/sim';
import { parseCsvRecords } from '../csv';

export const OURAIRPORTS_SOURCE_URL = 'https://ourairports.com/data/';

export type OurAirportsType =
  | 'large_airport'
  | 'medium_airport'
  | 'small_airport'
  | 'heliport'
  | 'seaplane_base'
  | 'balloonport'
  | 'closed';

export interface OurAirportsFilter {
  /** Only these airports (ICAO / gps / ident codes). */
  icao?: string[];
  /** Only airports inside this box. */
  bbox?: { minLat: number; maxLat: number; minLon: number; maxLon: number };
  /** Airport types to keep. Default: large, medium and small airports. */
  types?: OurAirportsType[];
}

export interface OurAirportsInput {
  airportsCsv: string;
  runwaysCsv: string;
  /** ISO date the CSVs were downloaded (recorded in the pack sources). */
  retrieved: string;
}

export interface ImportResult {
  airports: Airport[];
  runways: Runway[];
  source: PackSource;
  warnings: string[];
}

const DEFAULT_TYPES: OurAirportsType[] = ['large_airport', 'medium_airport', 'small_airport'];
const DEFAULT_RUNWAY_WIDTH_M = 45;

const num = (v: string | undefined): number | null => {
  if (v === undefined || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** The code the rest of the system uses for an airport: ICAO, else GPS code, else OurAirports ident. */
function airportCode(r: Record<string, string>): string {
  return (r.icao_code || r.gps_code || r.ident || '').trim().toUpperCase();
}

export function importOurAirports(input: OurAirportsInput, filter: OurAirportsFilter = {}): ImportResult {
  const warnings: string[] = [];
  const types = new Set(filter.types ?? DEFAULT_TYPES);
  const wanted = filter.icao ? new Set(filter.icao.map((c) => c.toUpperCase())) : null;

  // ── Airports ─────────────────────────────────────────────────────────────
  const airports: Airport[] = [];
  const byIdent = new Map<string, Airport>();
  for (const r of parseCsvRecords(input.airportsCsv)) {
    if (!types.has(r.type as OurAirportsType)) continue;
    const code = airportCode(r);
    if (!code) continue;
    if (wanted && !wanted.has(code) && !wanted.has((r.ident ?? '').toUpperCase())) continue;
    const lat = num(r.latitude_deg);
    const lon = num(r.longitude_deg);
    if (lat === null || lon === null) {
      warnings.push(`${code}: missing position, skipped`);
      continue;
    }
    if (filter.bbox) {
      const b = filter.bbox;
      if (lat < b.minLat || lat > b.maxLat || lon < b.minLon || lon > b.maxLon) continue;
    }
    let elevationFt = num(r.elevation_ft);
    if (elevationFt === null) {
      warnings.push(`${code}: missing elevation, using 0 ft`);
      elevationFt = 0;
    }
    const airport: Airport = {
      icao: code,
      name: r.name || code,
      arp: { lat, lon },
      elevationFt,
      ...(r.iata_code ? { iata: r.iata_code } : {}),
    };
    airports.push(airport);
    byIdent.set((r.ident ?? '').toUpperCase(), airport);
  }

  // ── Runways (one OurAirports row = both directions) ──────────────────────
  const runways: Runway[] = [];
  for (const r of parseCsvRecords(input.runwaysCsv)) {
    const airport = byIdent.get((r.airport_ident ?? '').toUpperCase());
    if (!airport) continue;
    const label = `${airport.icao} ${r.le_ident}/${r.he_ident}`;
    if (r.closed === '1') continue;

    const le = { lat: num(r.le_latitude_deg), lon: num(r.le_longitude_deg) };
    const he = { lat: num(r.he_latitude_deg), lon: num(r.he_longitude_deg) };
    if (le.lat === null || le.lon === null || he.lat === null || he.lon === null) {
      warnings.push(`${label}: missing end coordinates, skipped`);
      continue;
    }
    const leEnd = { lat: le.lat, lon: le.lon };
    const heEnd = { lat: he.lat, lon: he.lon };
    const lengthFt = num(r.length_ft);
    if (lengthFt === null) {
      warnings.push(`${label}: missing length, skipped`);
      continue;
    }
    let widthFt = num(r.width_ft);
    if (widthFt === null) {
      warnings.push(`${label}: missing width, using ${DEFAULT_RUNWAY_WIDTH_M} m`);
      widthFt = DEFAULT_RUNWAY_WIDTH_M / M_PER_FT;
    }

    const directions = [
      { prefix: 'le', from: leEnd, to: heEnd },
      { prefix: 'he', from: heEnd, to: leEnd },
    ] as const;
    for (const d of directions) {
      const id = (r[`${d.prefix}_ident`] ?? '').trim().toUpperCase();
      if (!id) continue;
      const course = courseTo(d.from, d.to);
      const publishedHeading = num(r[`${d.prefix}_heading_degT`]);
      const displacedFt = num(r[`${d.prefix}_displaced_threshold_ft`]) ?? 0;
      const displacedM = displacedFt * M_PER_FT;
      runways.push({
        id,
        airport: airport.icao,
        threshold: displacedM > 0 ? destination(d.from, course, displacedM) : d.from,
        end: d.to,
        headingTrue: normDeg(publishedHeading ?? course),
        lengthM: lengthFt * M_PER_FT,
        widthM: widthFt * M_PER_FT,
        thresholdElevFt: num(r[`${d.prefix}_elevation_ft`]) ?? airport.elevationFt,
        ...(displacedM > 0 ? { displacedM } : {}),
      });
    }
  }

  return {
    airports,
    runways,
    warnings,
    source: {
      name: 'OurAirports',
      licence: 'Public-Domain',
      url: OURAIRPORTS_SOURCE_URL,
      retrieved: input.retrieved,
    },
  };
}
