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
  courseTo,
  declinationDeg,
  destination,
  distanceM,
  distanceNm,
  normDeg,
  type AirspacePack,
  type Airport,
  type Airway,
  type Area,
  type Fix,
  type LatLon,
  type PackSource,
  type Runway,
} from '@atc-app/sim';
import { importCifpArea, readCifpRecords, type CifpRecords } from '../importers/cifp';
import { importOurAirports, importOurAirportsNavaids, type OurAirportsType } from '../importers/ourairports';
import { importEaipNavaids, importEaipPoints, importEaipRoutes, parseDms } from '../importers/eaip';
import { runwayGeometryIssues, validatePack, type ValidationResult } from '../validate';
import { PUBLISHABLE_LICENCES } from '../schema';
import type { BoundaryPoint, BoundaryStep, PackDefinition, SectorDefinition } from './definition';

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
  /** Built from sources whose licence is not publishable (state AIP): development builds only. */
  devOnly?: boolean;
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
  addSectors(def, pack, inputs.retrieved);
  return { pack, validation: validatePack(pack), crossCheck, warnings };
}

/** Builds the definition's sectors into the pack (with their own source entry). */
/** FIR borders by id (outer ring, lat/lon) for `along` boundary steps, and where they come from. */
export interface BorderSource {
  ring(id: string): LatLon[] | undefined;
  source: PackSource;
}

function addSectors(def: PackDefinition, pack: AirspacePack, retrieved: string, borders?: BorderSource): void {
  if (!def.sectors?.length) return;
  const lookup = (id: string): LatLon | undefined =>
    pack.airports.find((a) => a.icao === id)?.arp ?? pack.fixes.find((f) => f.id === id)?.pos;
  const at = new Date(`${retrieved}T00:00:00Z`);
  let usedBorders = false;
  const ring = (id: string) => {
    usedBorders = true;
    return borders?.ring(id);
  };
  pack.areas = def.sectors.map((s) => sectorArea(s, lookup, at, ring));
  pack.meta.sources.push({
    name: def.sectorsSource ?? `${def.id} sector definitions (atc-app, synthetic)`,
    licence: def.sectorsLicence ?? 'CC0-1.0',
    url: def.sectorsUrl ?? '',
    retrieved,
  });
  if (usedBorders && borders) pack.meta.sources.push(borders.source);
}

export interface OpenBuildInputs {
  ourAirports: { airportsCsv: string; runwaysCsv: string; navaidsCsv?: string; retrieved: string };
  /** eAIP ENR pages of the definition's state (pnpm data:eaip <state>). */
  eaip?: { edition: string; stateName: string; url: string; enr31: string; enr33?: string; enr41: string; enr44: string };
  /** FIR borders for `along` sector steps (definition `boundaries: "vatspy"`). */
  borders?: BorderSource;
  /** ISO date of the build inputs. */
  retrieved: string;
}

/**
 * Builds a pack without FAA CIFP: airports / runways from OurAirports, points,
 * navaids and routes from the state's eAIP (or OurAirports navaids when there
 * is none), sectors from the definition. No procedures yet.
 */
export function buildOpenPack(def: PackDefinition, inputs: OpenBuildInputs): BuildResult {
  const warnings: string[] = [];
  const oaAll = importOurAirports(inputs.ourAirports, { icao: def.airports, types: ['large_airport', 'medium_airport', 'small_airport'] });
  const main = oaAll.airports.find((a) => a.icao === def.airports[0]);
  const reference = def.reference ?? main?.arp;
  if (!reference) throw new Error(`${def.id}: main airport ${def.airports[0]} not in OurAirports`);
  for (const icao of def.airports) if (!oaAll.airports.some((a) => a.icao === icao)) warnings.push(`${icao}: not in OurAirports`);

  const box = bboxAround(reference, def.radiusNm);
  const extra = def.vfrAirports
    ? importOurAirports(inputs.ourAirports, { bbox: bboxAround(reference, def.vfrAirports.radiusNm), types: def.vfrAirports.types })
    : null;
  const airports: Airport[] = [...oaAll.airports];
  const runways: Runway[] = [];
  const add = (r: Runway) => {
    const issues = runwayGeometryIssues(r);
    if (issues.length) warnings.push(`OurAirports ${issues.join('; ')} — runway skipped`);
    else runways.push(r);
  };
  oaAll.runways.forEach(add);
  for (const a of extra?.airports ?? []) {
    if (airports.some((x) => x.icao === a.icao) || distanceNm(reference, a.arp) > def.vfrAirports!.radiusNm) continue;
    airports.push(a);
    extra!.runways.filter((r) => r.airport === a.icao).forEach(add);
  }

  const inArea = (p: LatLon) => distanceNm(reference, p) <= def.radiusNm;
  const fixes = new Map<string, Fix>();
  let airways: Airway[] = [];
  const sources: PackSource[] = [oaAll.source];
  if (inputs.eaip) {
    const e = inputs.eaip;
    // Navaids first: a route point that is also a navaid keeps the navaid kind.
    for (const f of [...importEaipNavaids(e.enr41), ...importEaipPoints(e.enr44)]) if (!fixes.has(f.id)) fixes.set(f.id, f);
    const routes = importEaipRoutes(e.enr31, ...(e.enr33 ? [e.enr33] : []));
    for (const f of routes.points) if (!fixes.has(f.id)) fixes.set(f.id, f);
    // Keep route segments touching the area, and every fix they use.
    airways = routes.airways
      .map((a) => ({
        id: a.id,
        segments: a.segments.filter((s) => [s.from, s.to].some((id) => { const p = fixes.get(id)?.pos; return p && inArea(p); })),
      }))
      .filter((a) => a.segments.length > 0);
    const used = new Set(airways.flatMap((a) => a.segments.flatMap((s) => [s.from, s.to])));
    for (const [id, f] of fixes) if (!inArea(f.pos) && !used.has(id)) fixes.delete(id);
    sources.push({ name: `${e.stateName} eAIP AIRAC ${e.edition} (ENR 3, 4.1, 4.4)`, licence: 'State-AIP-Development', url: e.url, retrieved: inputs.retrieved });
  } else if (inputs.ourAirports.navaidsCsv) {
    for (const f of importOurAirportsNavaids(inputs.ourAirports.navaidsCsv, box)) if (inArea(f.pos)) fixes.set(f.id, f);
  }

  const pack: AirspacePack = {
    meta: {
      id: def.id,
      name: def.name,
      airac: inputs.eaip ? airacOf(inputs.eaip.edition) : airacOf(inputs.retrieved),
      reference,
      magVar: Math.round(declinationDeg(reference, new Date(`${inputs.retrieved}T00:00:00Z`)) * 10) / 10,
      sources,
    },
    airports,
    runways,
    fixes: [...fixes.values()],
    airways,
  };
  addSectors(def, pack, inputs.retrieved, inputs.borders);
  const devOnly = pack.meta.sources.some((s) => !(PUBLISHABLE_LICENCES as readonly string[]).includes(s.licence));
  return { pack, validation: validatePack(pack, { allowUnpublishableLicences: devOnly }), crossCheck: null, warnings, devOnly };
}

const CYCLE_MS = 28 * 86_400_000;
/** Effective date of AIRAC 2601. */
const AIRAC_EPOCH = Date.UTC(2026, 0, 22);

/** AIRAC cycle "YYNN" in effect on a date: 28-day cycles, numbered from the first one starting in the year. */
export function airacOf(isoDate: string): string {
  const n = Math.floor((Date.parse(`${isoDate}T00:00:00Z`) - AIRAC_EPOCH) / CYCLE_MS);
  const start = AIRAC_EPOCH + n * CYCLE_MS;
  const year = new Date(start).getUTCFullYear();
  const firstOfYear = AIRAC_EPOCH + Math.ceil((Date.UTC(year, 0, 1) - AIRAC_EPOCH) / CYCLE_MS) * CYCLE_MS;
  const index = Math.round((start - firstOfYear) / CYCLE_MS) + 1;
  return `${String(year % 100).padStart(2, '0')}${String(index).padStart(2, '0')}`;
}

/** Wedge arcs are drawn with a point every this many degrees. */
const ARC_STEP_DEG = 5;

/** Turns a sector definition into a pack area (polygon of coordinates). */
export function sectorArea(
  s: SectorDefinition,
  lookup: (id: string) => LatLon | undefined,
  date = new Date(),
  border: (id: string) => LatLon[] | undefined = () => undefined
): Area {
  const at = (id: string) => {
    const p = lookup(id);
    if (!p) throw new Error(`sector ${s.id}: unknown point ${id}`);
    return p;
  };
  let polygon: LatLon[];
  if (s.polygon) {
    polygon = s.polygon.map((p) => (typeof p === 'string' ? at(p) : p));
  } else if (s.boundary) {
    polygon = boundaryPolygon(s.id, s.boundary, at, date, border);
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
  return {
    id: s.id,
    kind: 'sector',
    name: s.name,
    polygon,
    floorFt: s.floorFt,
    ceilingFt: s.ceilingFt,
    ...(s.exclude?.length ? { exclude: s.exclude } : {}),
    ...(s.parts?.length
      ? {
          parts: s.parts.map((p) => ({
            polygon: boundaryPolygon(s.id, p.boundary, at, date, border),
            floorFt: p.floorFt,
            ceilingFt: p.ceilingFt,
          })),
        }
      : {}),
  };
}

/**
 * Resolves one published boundary point. Radials are magnetic: converted with
 * the WMM declination at the navaid (the VOR's own station declination may
 * differ by a fraction of a degree until it is imported from ENR 4.1).
 */
function boundaryPoint(sector: string, p: BoundaryPoint, at: (id: string) => LatLon, date: Date): LatLon {
  if (typeof p === 'string') return at(p);
  if ('dms' in p) {
    const ll = parseDms(p.dms);
    if (!ll) throw new Error(`sector ${sector}: bad coordinates "${p.dms}"`);
    return ll;
  }
  if ('radial' in p) {
    const vor = at(p.radial);
    return destination(vor, normDeg(p.deg + declinationDeg(vor, date)), p.nm * 1852);
  }
  return p;
}

/** Boundary steps → polygon: points in order, arcs densified every ARC_STEP_DEG. */
function boundaryPolygon(
  sector: string,
  steps: BoundaryStep[],
  at: (id: string) => LatLon,
  date: Date,
  border: (id: string) => LatLon[] | undefined = () => undefined
): LatLon[] {
  const out: LatLon[] = [];
  for (const step of steps) {
    if (typeof step === 'object' && 'along' in step) {
      const from = out[out.length - 1];
      if (!from) throw new Error(`sector ${sector}: "along ${step.along}" needs a previous point`);
      const ring = border(step.along);
      if (!ring) throw new Error(`sector ${sector}: no border "${step.along}" (definition "boundaries" / pnpm data:vatspy)`);
      const to = boundaryPoint(sector, step.to, at, date);
      out.push(...alongBorder(ring, from, to, step.dir), to);
    } else if (typeof step === 'object' && 'arc' in step) {
      const from = out[out.length - 1];
      if (!from) throw new Error(`sector ${sector}: an arc needs a previous point`);
      const centre = boundaryPoint(sector, step.arc.centre, at, date);
      const to = boundaryPoint(sector, step.to, at, date);
      const b0 = courseTo(centre, from);
      const b1 = courseTo(centre, to);
      const span = step.arc.dir === 'cw' ? (b1 - b0 + 360) % 360 : -((b0 - b1 + 360) % 360);
      const n = Math.max(1, Math.ceil(Math.abs(span) / ARC_STEP_DEG));
      for (let i = 1; i < n; i++) out.push(destination(centre, b0 + (span * i) / n, step.arc.radiusNm * 1852));
      out.push(to);
    } else {
      out.push(boundaryPoint(sector, step as BoundaryPoint, at, date));
    }
  }
  // A closing point equal to the first is implied.
  const a = out[0]!;
  const z = out[out.length - 1]!;
  if (out.length > 3 && Math.abs(a.lat - z.lat) < 1e-9 && Math.abs(a.lon - z.lon) < 1e-9) out.pop();
  return out;
}

/** Signed area of a lat/lon ring (x = lon, y = lat): negative = clockwise. */
function signedArea(ring: readonly LatLon[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!;
    const q = ring[(i + 1) % ring.length]!;
    a += p.lon * q.lat - q.lon * p.lat;
  }
  return a / 2;
}

/** Nearest position on the ring: segment index (from vertex i to i+1) and fraction along it. */
function nearestOnRing(ring: readonly LatLon[], p: LatLon): { i: number; t: number; nm: number } {
  const k = Math.cos((p.lat * Math.PI) / 180);
  let best = { i: 0, t: 0, nm: Infinity };
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const ax = (a.lon - p.lon) * 60 * k;
    const ay = (a.lat - p.lat) * 60;
    const dx = (b.lon - a.lon) * 60 * k;
    const dy = (b.lat - a.lat) * 60;
    const len = dx * dx + dy * dy;
    const t = len > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
    const nm = Math.hypot(ax + t * dx, ay + t * dy);
    if (nm < best.nm) best = { i, t, nm };
  }
  return best;
}

/**
 * Border vertices strictly between two points that lie (nearly) on a FIR border,
 * walking the border clockwise or counter-clockwise. The published end points
 * themselves are kept exactly by the caller; only the stretch in between follows
 * the border source (VATSpy is community-drawn, typically within 0–5 NM).
 */
export function alongBorder(ring: readonly LatLon[], from: LatLon, to: LatLon, dir: 'cw' | 'ccw'): LatLon[] {
  const r = ring.length > 1 && ring[0]!.lat === ring[ring.length - 1]!.lat && ring[0]!.lon === ring[ring.length - 1]!.lon ? ring.slice(0, -1) : [...ring];
  const n = r.length;
  const forward = (dir === 'cw') === (signedArea(r) < 0);
  const a = nearestOnRing(r, from);
  const b = nearestOnRing(r, to);
  const out: LatLon[] = [];
  if (forward) {
    // Vertices a.i+1 … b.i (unless both on the same segment, a before b).
    if (a.i === b.i && b.t >= a.t) return out;
    for (let k = (a.i + 1) % n, steps = 0; steps < n; k = (k + 1) % n, steps++) {
      out.push(r[k]!);
      if (k === b.i) break;
    }
  } else {
    // Vertices a.i … b.i+1 walking backwards.
    if (a.i === b.i && b.t <= a.t) return out;
    for (let k = a.i, steps = 0; steps < n; k = (k - 1 + n) % n, steps++) {
      if (k === b.i) break;
      out.push(r[k]!);
    }
  }
  return out;
}
