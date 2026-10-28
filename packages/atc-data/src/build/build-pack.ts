/**
 * Builds one airspace pack from free sources:
 *
 *   FAA CIFP  → airports, runways + ILS, fixes, navaids, airways, procedures
 *   OurAirports → requested airports CIFP does not have + optional VFR airports
 *                 in the area, and an independent second source for runway
 *                 thresholds (cross-check report)
 *
 * The result is validated; publishing is refused when validation has errors.
 */
import {
  angleDiffDeg,
  destination,
  distanceM,
  distanceNm,
  type AirspacePack,
  type Airport,
  type Area,
  type LatLon,
  type PackSource,
  type Runway,
} from '@atc-app/sim';
import { importCifpArea, readCifpRecords, type CifpRecords } from '../importers/cifp';
import { importOurAirports, type OurAirportsType } from '../importers/ourairports';
import { runwayGeometryIssues, validatePack, type ValidationResult } from '../validate';
import type { PackDefinition, SectorDefinition } from './definition';

export interface BuildInputs {
  /** FAACIFP18 text or records already read (to share one parse across packs). */
  cifp: string | CifpRecords;
  ourAirports?: { airportsCsv: string; runwaysCsv: string; retrieved: string };
  /** ISO date the CIFP file was downloaded. */
  retrieved: string;
}

export interface RunwayCrossCheck {
  airport: string;
  runway: string;
  /** Threshold distance CIFP ↔ OurAirports, metres. */
  thresholdDiffM: number;
  /** True heading difference, degrees. */
  headingDiffDeg: number;
}

export interface CrossCheckReport {
  compared: number;
  /** Runways present in CIFP but not in OurAirports (or without coordinates there). */
  missing: string[];
  medianDiffM: number | null;
  maxDiffM: number | null;
  /** Runways whose thresholds differ by more than `flagAboveM`. */
  flagged: RunwayCrossCheck[];
  flagAboveM: number;
}

export interface BuildResult {
  pack: AirspacePack;
  validation: ValidationResult;
  crossCheck: CrossCheckReport | null;
  /** Importer messages (non-fatal). */
  warnings: string[];
}

export interface BuildOptions {
  /** Threshold differences above this are listed in the cross-check report. */
  flagAboveM?: number;
}

function bboxAround(c: LatLon, radiusNm: number) {
  const dLat = radiusNm / 60;
  const dLon = radiusNm / (60 * Math.max(0.1, Math.cos((c.lat * Math.PI) / 180)));
  return { minLat: c.lat - dLat, maxLat: c.lat + dLat, minLon: c.lon - dLon, maxLon: c.lon + dLon };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export function crossCheckRunways(cifp: Runway[], other: Runway[], flagAboveM: number): CrossCheckReport {
  const byKey = new Map(other.map((r) => [`${r.airport}/${r.id}`, r]));
  const rows: RunwayCrossCheck[] = [];
  const missing: string[] = [];
  for (const r of cifp) {
    const o = byKey.get(`${r.airport}/${r.id}`);
    if (!o) {
      missing.push(`${r.airport}/${r.id}`);
      continue;
    }
    rows.push({
      airport: r.airport,
      runway: r.id,
      thresholdDiffM: distanceM(r.threshold, o.threshold),
      headingDiffDeg: Math.abs(angleDiffDeg(r.headingTrue, o.headingTrue)),
    });
  }
  const diffs = rows.map((r) => r.thresholdDiffM);
  return {
    compared: rows.length,
    missing,
    medianDiffM: median(diffs),
    maxDiffM: diffs.length ? Math.max(...diffs) : null,
    flagged: rows.filter((r) => r.thresholdDiffM > flagAboveM).sort((a, b) => b.thresholdDiffM - a.thresholdDiffM),
    flagAboveM,
  };
}

export function buildPack(def: PackDefinition, inputs: BuildInputs, options: BuildOptions = {}): BuildResult {
  const rec = typeof inputs.cifp === 'string' ? readCifpRecords(inputs.cifp) : inputs.cifp;
  const warnings: string[] = [];

  // Requested airports CIFP does not know (no instrument procedures) come from
  // OurAirports; the area then needs an explicit or OurAirports-derived centre.
  const inCifp = def.airports.filter((a) => rec.airports.has(a));
  const notInCifp = def.airports.filter((a) => !rec.airports.has(a));

  let oa: ReturnType<typeof importOurAirports> | null = null;
  if (inputs.ourAirports) {
    const centre = def.reference ?? rec.airports.get(def.airports[0]!)?.arp;
    oa = importOurAirports(
      inputs.ourAirports,
      centre
        ? {
            bbox: bboxAround(centre, Math.max(def.radiusNm, def.vfrAirports?.radiusNm ?? 0)),
            types: ['large_airport', 'medium_airport', 'small_airport', 'heliport', 'seaplane_base'],
          }
        : { icao: def.airports, types: ['large_airport', 'medium_airport', 'small_airport', 'heliport', 'seaplane_base'] }
    );
  }
  const oaMain = oa?.airports.find((a) => a.icao === def.airports[0]);
  const reference = def.reference ?? rec.airports.get(def.airports[0]!)?.arp ?? oaMain?.arp;
  if (!reference) throw new Error(`${def.id}: main airport ${def.airports[0]} found in no source`);

  // Extra airports of the area (vfrAirports): CIFP data where the FAA has it
  // (surveyed thresholds, no procedures imported), OurAirports otherwise.
  const extra: string[] = [];
  if (oa && def.vfrAirports) {
    const vfrTypes = new Set<OurAirportsType>(def.vfrAirports.types);
    for (const a of oa.airports) {
      if (def.airports.includes(a.icao)) continue;
      if (!vfrTypes.has(oa.airportTypes[a.icao]!)) continue;
      if (distanceNm(reference, a.arp) <= def.vfrAirports.radiusNm) extra.push(a.icao);
    }
  }
  const extraInCifp = extra.filter((a) => rec.airports.has(a));
  const fromOurAirports = new Set([...notInCifp, ...extra.filter((a) => !rec.airports.has(a))]);

  const cifp = importCifpArea(rec, {
    airports: [...inCifp, ...extraInCifp],
    proceduresFor: inCifp,
    radiusNm: def.radiusNm,
    reference,
    retrieved: inputs.retrieved,
  });
  warnings.push(...cifp.warnings);

  const airports: Airport[] = [...cifp.airports];
  const runways: Runway[] = [...cifp.runways];
  const sources: PackSource[] = [cifp.source];
  let crossCheck: CrossCheckReport | null = null;

  if (oa) {
    const have = new Set(airports.map((a) => a.icao));
    let added = 0;
    for (const a of oa.airports) {
      if (have.has(a.icao) || !fromOurAirports.has(a.icao)) continue;
      airports.push(a);
      for (const r of oa.runways.filter((x) => x.airport === a.icao)) {
        // Community data: drop runways whose ends and length disagree.
        const issues = runwayGeometryIssues(r);
        if (issues.length) warnings.push(`OurAirports ${issues.join('; ')} — runway skipped`);
        else runways.push(r);
      }
      have.add(a.icao);
      added++;
    }
    for (const icao of notInCifp) {
      if (!have.has(icao)) warnings.push(`${icao}: in neither CIFP nor OurAirports`);
    }
    if (added > 0) sources.push(oa.source);
    crossCheck = crossCheckRunways(
      cifp.runways,
      oa.runways.filter((r) => cifp.airports.some((a) => a.icao === r.airport)),
      options.flagAboveM ?? 50
    );
  } else {
    for (const icao of notInCifp) warnings.push(`${icao}: not in CIFP and OurAirports not provided`);
  }

  const pack: AirspacePack = {
    meta: {
      id: def.id,
      name: def.name,
      airac: cifp.airac ?? '0000',
      reference,
      magVar: cifp.magVar,
      sources,
    },
    airports,
    runways,
    fixes: cifp.fixes,
    airways: cifp.airways,
    procedures: cifp.procedures,
  };
  if (def.sectors?.length) {
    const lookup = (id: string): LatLon | undefined =>
      pack.airports.find((a) => a.icao === id)?.arp ?? pack.fixes.find((f) => f.id === id)?.pos;
    pack.areas = def.sectors.map((s) => sectorArea(s, lookup));
    sources.push({
      name: def.sectorsSource ?? `${def.id} sector definitions (atc-app, synthetic)`,
      licence: 'CC0-1.0',
      url: '',
      retrieved: inputs.retrieved,
    });
  }
  return { pack, validation: validatePack(pack), crossCheck, warnings };
}

/** Wedge arcs are drawn with a point every this many degrees. */
const ARC_STEP_DEG = 5;

/** Turns a sector definition into a pack area (polygon of coordinates). */
export function sectorArea(s: SectorDefinition, lookup: (id: string) => LatLon | undefined): Area {
  const at = (id: string) => {
    const p = lookup(id);
    if (!p) throw new Error(`sector ${s.id}: unknown point ${id}`);
    return p;
  };
  let polygon: LatLon[];
  if (s.polygon) {
    polygon = s.polygon.map((p) => (typeof p === 'string' ? at(p) : p));
  } else {
    const w = s.wedge!;
    const centre = at(w.centre);
    const span = ((w.toDeg - w.fromDeg + 360) % 360) || 360;
    const steps = Math.max(1, Math.ceil(span / ARC_STEP_DEG));
    const arc = (nm: number) =>
      Array.from({ length: steps + 1 }, (_, i) => destination(centre, w.fromDeg + (span * i) / steps, nm * 1852));
    const outer = arc(w.outerNm);
    const full = span === 360;
    if (full) polygon = outer.slice(0, -1);
    else polygon = w.innerNm > 0 ? [...outer, ...arc(w.innerNm).reverse()] : [centre, ...outer];
  }
  return { id: s.id, kind: 'sector', name: s.name, polygon, floorFt: s.floorFt, ceilingFt: s.ceilingFt };
}
