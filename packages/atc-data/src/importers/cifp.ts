/**
 * FAA CIFP importer — ARINC 424 (file `FAACIFP18`), US public domain.
 *
 * Reads the fixed-width 132-column records and produces pack content for an area:
 * airports (PA), runways (PG) with ILS (PI), terminal + enroute waypoints (PC, EA),
 * VHF navaids (D), NDBs (DB, PN), airways (ER), SIDs / STARs / approaches
 * (PD / PE / PF) and airspace: controlled (UC — Class B / C / D) and restrictive
 * (UR — restricted, prohibited, warning, alert, MOA, SFRA). Column positions were
 * verified against AIRAC 2611 data.
 *
 * Not imported yet: MSA, holding patterns (EP), company routes. CIFP has no
 * ARTCC / FIR boundaries (those are in NASR, or VATSpy for the simulator).
 *
 * Coverage: US airports with instrument procedures. For other countries the same
 * ARINC 424 parser can read any provider's file (see PAID-ALT notes in index.ts:
 * Navigraph, Jeppesen, UkSATSE).
 */
import {
  courseTo,
  destination,
  distanceM,
  distanceNm,
  declinationDeg,
  magToTrue,
  normDeg,
  M_PER_FT,
  type Airport,
  type Airway,
  type AltitudeConstraint,
  type Area,
  type AreaKind,
  type Fix,
  type FixKind,
  type LatLon,
  type Leg,
  type PackSource,
  type PathTerminator,
  type Procedure,
  type Runway,
} from '@atc-app/sim';
import { PATH_TERMINATORS } from '@atc-app/sim';

export const CIFP_SOURCE_URL =
  'https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/cifp/';

/** 1-based inclusive column slice, as written in the ARINC 424 specification. */
const col = (line: string, from: number, to: number): string => line.slice(from - 1, to);
const colT = (line: string, from: number, to: number): string => col(line, from, to).trim();

// ─── Field decoders ──────────────────────────────────────────────────────────

/** "N40382374" → 40.639928 (DD MM SS.ss); "W073464329" → −73.778692 (DDD MM SS.ss). */
export function parseArincLat(v: string): number | null {
  const m = /^([NS])(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(v);
  if (!m) return null;
  const deg = +m[2]! + +m[3]! / 60 + (+m[4]! + +m[5]! / 100) / 3600;
  return m[1] === 'S' ? -deg : deg;
}

export function parseArincLon(v: string): number | null {
  const m = /^([EW])(\d{3})(\d{2})(\d{2})(\d{2})$/.exec(v);
  if (!m) return null;
  const deg = +m[2]! + +m[3]! / 60 + (+m[4]! + +m[5]! / 100) / 3600;
  return m[1] === 'W' ? -deg : deg;
}

function parsePos(line: string, latFrom: number, lonFrom: number): LatLon | null {
  const lat = parseArincLat(col(line, latFrom, latFrom + 8));
  const lon = parseArincLon(col(line, lonFrom, lonFrom + 9));
  return lat === null || lon === null ? null : { lat, lon };
}

/** "W0130" → −13.0, "E0133" → 13.3 (tenths of a degree, positive east). */
export function parseMagVar(v: string): number | null {
  const m = /^([EWT])(\d{4})$/.exec(v);
  if (!m) return null;
  if (m[1] === 'T') return 0;
  const val = +m[2]! / 10;
  return m[1] === 'W' ? -val : val;
}

const int = (v: string): number | null => {
  const t = v.trim();
  return /^-?\d+$/.test(t) ? Number(t) : null;
};

/** Altitude field: "05000" ft, "FL180" flight level, blank → null. */
export function parseAltitude(v: string): number | null {
  const t = v.trim();
  const fl = /^FL(\d{3})$/.exec(t);
  if (fl) return Number(fl[1]) * 100;
  return /^-?\d{1,5}$/.test(t) ? Number(t) : null;
}

/** Magnetic course in tenths ("0438" → 43.8); "T" suffix marks true courses. */
function parseCourse(v: string): { deg: number; isTrue: boolean } | null {
  const t = v.trim();
  if (/^\d{4}$/.test(t)) return { deg: Number(t) / 10, isTrue: false };
  if (/^\d{3}T$/.test(t)) return { deg: Number(t.slice(0, 3)), isTrue: true };
  return null;
}

/** Altitude description (col 83) + alt1 / alt2 → constraint. */
function altitudeConstraint(desc: string, a1: number | null, a2: number | null): AltitudeConstraint | undefined {
  if (a1 === null) return undefined;
  switch (desc) {
    case '+':
    case 'H': // at or above alt1, glideslope alt in alt2
    case 'J': // at or above alt1, GS intercept alt in alt2
    case 'V': // stepdown: at or above
      return { type: 'atOrAbove', ft: a1 };
    case '-':
    case 'Y':
      return { type: 'atOrBelow', ft: a1 };
    case 'B': // between: at or above alt2, at or below alt1
      return a2 !== null ? { type: 'between', ft: a2, ft2: a1 } : { type: 'atOrBelow', ft: a1 };
    default: // ' ', '@', 'G', 'I', 'X'
      return { type: 'at', ft: a1 };
  }
}

/** "04L" → "22R"; "13" → "31"; "18C" → "36C". */
export function reciprocalRunway(id: string): string | null {
  const m = /^(\d{2})([LCR]?)$/.exec(id);
  if (!m) return null;
  let n = (Number(m[1]) + 18) % 36;
  if (n === 0) n = 36;
  const side = m[2] === 'L' ? 'R' : m[2] === 'R' ? 'L' : m[2]!;
  return `${String(n).padStart(2, '0')}${side}`;
}

/** Primary records only: continuation number 0 or 1 at the given column. */
const isPrimary = (line: string, contCol: number): boolean => '01'.includes(col(line, contCol, contCol));

// ─── Raw record extraction ───────────────────────────────────────────────────

interface RawAirport extends Airport {
  magVar: number;
}

interface RawRunway {
  airport: string;
  id: string;
  lengthFt: number;
  bearingMag: number | null;
  threshold: LatLon;
  thresholdElevFt: number;
  displacedFt: number;
  widthFt: number | null;
  tchFt: number | null;
  locIdent: string;
}

interface RawIls {
  airport: string;
  ident: string;
  runway: string;
  bearingMag: number | null;
  gsDeg: number | null;
  tchFt: number | null;
}

interface RawLeg {
  airport: string;
  kind: Procedure['kind'];
  ident: string;
  routeType: string;
  transition: string;
  seq: number;
  line: string;
}

interface RawAirwayPoint {
  route: string;
  seq: number;
  fix: string;
  endOfAirway: boolean;
  minAltFt: number | null;
  maxAltFt: number | null;
}

/** One boundary point of a UC / UR airspace (records of one volume share `key`). */
interface RawAirspacePoint {
  /** Section + ICAO code + type + centre / designation + multiple code. */
  key: string;
  airspaceClass: CifpAirspaceClass;
  /** Class B / C / D: the airport ("KJFK"); restrictive: type + designation ("R5002A", "W105A"). */
  designation: string;
  /** Sub-area letter ("A" for NEW YORK AREA A); blank for a single volume. */
  multiple: string;
  seq: number;
  /** Boundary via: G / H line, R / L clockwise / counter-clockwise arc, C circle; then E = last point. */
  via: string;
  pos: LatLon | null;
  arcOrigin: LatLon | null;
  arcNm: number | null;
  lower: string;
  upper: string;
  name: string;
}

export interface CifpRecords {
  airac: string | null;
  airports: Map<string, RawAirport>;
  runways: RawRunway[];
  ils: RawIls[];
  /** All candidate fixes keyed by ident (several per ident across regions). */
  fixes: Map<string, Fix[]>;
  legs: RawLeg[];
  airways: RawAirwayPoint[];
  airspace: RawAirspacePoint[];
}

function addFix(map: Map<string, Fix[]>, fix: Fix): void {
  const list = map.get(fix.id);
  if (list) list.push(fix);
  else map.set(fix.id, [fix]);
}

/** One pass over the file; keeps only what the importer needs. */
export function readCifpRecords(text: string): CifpRecords {
  const out: CifpRecords = {
    airac: null,
    airports: new Map(),
    runways: [],
    ils: [],
    fixes: new Map(),
    legs: [],
    airways: [],
    airspace: [],
  };

  for (const raw of text.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (line.startsWith('HDR01')) {
      out.airac = /(\d{4})\s+\d{2}-[A-Z]{3}-\d{4}/.exec(line)?.[1] ?? null;
      continue;
    }
    if (line.length < 132 || line[0] !== 'S') continue;

    const section = col(line, 5, 5);
    if (section === 'P') {
      const airport = colT(line, 7, 10);
      const sub = col(line, 13, 13);
      if (sub === 'A' && isPrimary(line, 22)) {
        const arp = parsePos(line, 33, 42);
        if (!arp) continue;
        const tl = parseAltitude(col(line, 76, 80));
        const ta = parseAltitude(col(line, 71, 75));
        out.airports.set(airport, {
          icao: airport,
          name: colT(line, 94, 123) || airport,
          arp,
          elevationFt: int(col(line, 57, 61)) ?? 0,
          magVar: parseMagVar(col(line, 52, 56)) ?? 0,
          ...(colT(line, 14, 16) ? { iata: colT(line, 14, 16) } : {}),
          ...(ta !== null ? { transitionAltFt: ta } : {}),
          ...(tl !== null ? { transitionLevel: Math.round(tl / 100) } : {}),
        });
      } else if (sub === 'G' && isPrimary(line, 22)) {
        const threshold = parsePos(line, 33, 42);
        const id = colT(line, 14, 18).replace(/^RW/, '');
        const lengthFt = int(col(line, 23, 27));
        if (!threshold || !lengthFt) continue;
        const brg = parseCourse(col(line, 28, 31));
        out.runways.push({
          airport,
          id,
          lengthFt,
          bearingMag: brg && !brg.isTrue ? brg.deg : null,
          threshold,
          thresholdElevFt: int(col(line, 67, 71)) ?? 0,
          displacedFt: int(col(line, 72, 75)) ?? 0,
          tchFt: int(col(line, 76, 77)),
          widthFt: int(col(line, 78, 80)),
          locIdent: colT(line, 82, 85),
        });
        addFix(out.fixes, { id: `${airport}.RW${id}`, kind: 'runway', pos: threshold });
      } else if (sub === 'I' && isPrimary(line, 22)) {
        const brg = parseCourse(col(line, 52, 55));
        const gs = int(col(line, 88, 90));
        out.ils.push({
          airport,
          ident: colT(line, 14, 17),
          runway: colT(line, 28, 32).replace(/^RW/, ''),
          bearingMag: brg && !brg.isTrue ? brg.deg : null,
          gsDeg: gs !== null && gs > 0 ? gs / 100 : null,
          tchFt: int(col(line, 96, 97)),
        });
      } else if (sub === 'C' && isPrimary(line, 22)) {
        const pos = parsePos(line, 33, 42);
        if (pos) addFix(out.fixes, { id: colT(line, 14, 18), kind: 'waypoint', pos });
      } else if (sub === 'N' && isPrimary(line, 22)) {
        const pos = parsePos(line, 33, 42);
        if (pos) addFix(out.fixes, { id: colT(line, 14, 17), kind: 'ndb', pos });
      } else if ('DEF'.includes(sub) && isPrimary(line, 39)) {
        out.legs.push({
          airport,
          kind: sub === 'D' ? 'SID' : sub === 'E' ? 'STAR' : 'IAP',
          ident: colT(line, 14, 19),
          routeType: col(line, 20, 20),
          transition: colT(line, 21, 25),
          seq: int(col(line, 27, 29)) ?? 0,
          line,
        });
      }
    } else if (section === 'E') {
      const sub = col(line, 6, 6);
      if (sub === 'A' && isPrimary(line, 22)) {
        const pos = parsePos(line, 33, 42);
        if (pos) addFix(out.fixes, { id: colT(line, 14, 18), kind: 'waypoint', pos });
      } else if (sub === 'R' && isPrimary(line, 39)) {
        out.airways.push({
          route: colT(line, 14, 18),
          seq: int(col(line, 26, 29)) ?? 0,
          fix: colT(line, 30, 34),
          endOfAirway: col(line, 41, 41) === 'E',
          minAltFt: parseAltitude(col(line, 84, 88)),
          maxAltFt: parseAltitude(col(line, 94, 98)),
        });
      }
    } else if (section === 'D') {
      const sub = col(line, 6, 6);
      if (!isPrimary(line, 22)) continue;
      const id = colT(line, 14, 17);
      if (sub === ' ') {
        const vor = parsePos(line, 33, 42);
        const dme = parsePos(line, 56, 65);
        const pos = vor ?? dme;
        const kind: FixKind = vor ? 'vor' : 'dme';
        if (pos) addFix(out.fixes, { id, kind, pos });
      } else if (sub === 'B') {
        const pos = parsePos(line, 33, 42);
        if (pos) addFix(out.fixes, { id, kind: 'ndb', pos });
      }
    } else if (section === 'U') {
      const sub = col(line, 6, 6);
      const via = col(line, 31, 32);
      // Continuation records (time of operation, controlling agency) carry no boundary.
      if ((sub !== 'C' && sub !== 'R') || via.trim() === '') continue;
      const type = col(line, 9, 9);
      const controlled = sub === 'C';
      out.airspace.push({
        key: col(line, 5, 20),
        airspaceClass: controlled ? (CONTROLLED_CLASS[type] ?? 'other') : (RESTRICTIVE_CLASS[type] ?? 'other'),
        // Restrictive: type letter + designation ("R" + "5002A"); U (SFRA, …) has none.
        designation: controlled ? colT(line, 10, 14) : `${type === 'U' ? '' : type}${colT(line, 10, 19)}`,
        multiple: colT(line, 20, 20),
        seq: int(col(line, 21, 24)) ?? 0,
        via,
        pos: parsePos(line, 33, 42),
        arcOrigin: parsePos(line, 52, 61),
        arcNm: int(col(line, 71, 74)) === null ? null : int(col(line, 71, 74))! / 10,
        lower: colT(line, 82, 87),
        upper: colT(line, 88, 93),
        name: colT(line, 94, 123),
      });
    }
  }
  return out;
}

// ─── Airspace (UC / UR) ──────────────────────────────────────────────────────

export type CifpAirspaceClass =
  | 'classB' | 'classC' | 'classD' | 'restricted' | 'prohibited' | 'warning' | 'alert' | 'moa' | 'other';

/** UC airspace type (column 9) as the FAA codes it. */
const CONTROLLED_CLASS: Record<string, CifpAirspaceClass> = { T: 'classB', A: 'classC', Z: 'classD' };
/** UR restrictive type (column 9); U = special flight rules / national security areas. */
const RESTRICTIVE_CLASS: Record<string, CifpAirspaceClass> = { R: 'restricted', P: 'prohibited', W: 'warning', A: 'alert', M: 'moa' };

const AREA_KIND: Record<CifpAirspaceClass, AreaKind> = {
  classB: 'TMA',
  classC: 'TMA',
  classD: 'CTR',
  restricted: 'restricted',
  prohibited: 'prohibited',
  warning: 'danger',
  alert: 'danger',
  moa: 'TSA',
  other: 'restricted',
};

const CLASS_LABEL: Partial<Record<CifpAirspaceClass, string>> = { classB: 'Class B', classC: 'Class C', classD: 'Class D' };

/** "UNLTD" and the like: shown as FL600. */
const UNLIMITED_FT = 60000;
/** Arcs and circles get a point every this many degrees. */
const AIRSPACE_ARC_STEP_DEG = 5;

/**
 * "GND  M" → 0, "07000M" → 7000, "UNLTDM" → 60000; the last character is the
 * unit (M = MSL, A = AGL). AGL limits are taken as MSL: the simulator has no
 * terrain, and around New York the error is a few hundred feet at most.
 */
export function parseAirspaceLimit(v: string, fallback: number): number {
  const value = v.slice(0, 5).trim();
  if (value === 'GND') return 0;
  if (value.startsWith('UNL')) return UNLIMITED_FT;
  if (/^\d+$/.test(value)) return Number(value);
  return fallback;
}

export interface CifpAirspaceOptions {
  /** Pack reference point. */
  reference: LatLon;
  /** Airspace with any boundary point within this distance is imported. */
  radiusNm: number;
  /** Which kinds; default all. */
  classes?: readonly CifpAirspaceClass[];
}

/**
 * Controlled and restrictive airspace near the reference as pack areas: one area
 * per volume (Class B sub-area, R-5002A, …) with its own vertical limits; arcs
 * and circles are densified.
 */
export function importCifpAirspace(rec: CifpRecords, options: CifpAirspaceOptions): { areas: Area[]; warnings: string[] } {
  const wanted = options.classes ? new Set(options.classes) : null;
  const groups = new Map<string, RawAirspacePoint[]>();
  for (const p of rec.airspace) {
    if (wanted && !wanted.has(p.airspaceClass)) continue;
    const g = groups.get(p.key);
    if (g) g.push(p);
    else groups.set(p.key, [p]);
  }

  const areas: Area[] = [];
  const warnings: string[] = [];
  const ids = new Set<string>();
  // Sub-area letters only where a designation has several volumes.
  const volumes = new Map<string, number>();
  for (const [p] of groups.values()) volumes.set(p!.key.slice(0, 15), (volumes.get(p!.key.slice(0, 15)) ?? 0) + 1);
  for (const points of groups.values()) {
    points.sort((a, b) => a.seq - b.seq);
    const first = points[0]!;
    const polygon = airspaceRing(points);
    if (polygon.length < 3) {
      warnings.push(`CIFP airspace ${first.designation} ${first.multiple}: fewer than 3 boundary points — skipped`);
      continue;
    }
    if (!polygon.some((p) => distanceNm(options.reference, p) <= options.radiusNm)) continue;

    const label = CLASS_LABEL[first.airspaceClass];
    // "KJFK B-A" (Class B area A), "KTEB D", "R5002A"; a letter only where a designation has several volumes.
    const sub = first.multiple && volumes.get(first.key.slice(0, 15))! > 1 ? `-${first.multiple}` : '';
    let id = label ? `${first.designation} ${first.airspaceClass.slice(-1)}${sub}` : `${first.designation}${sub}`;
    for (let n = 2; ids.has(id); n++) id = `${id.replace(/#\d+$/, '')}#${n}`;
    ids.add(id);
    const name = first.name || first.designation;
    areas.push({
      id,
      kind: AREA_KIND[first.airspaceClass],
      name: label ? `${label} ${name}` : name,
      polygon,
      floorFt: parseAirspaceLimit(first.lower, 0),
      ceilingFt: parseAirspaceLimit(first.upper, UNLIMITED_FT),
    });
  }
  return { areas, warnings };
}

/** Boundary records of one volume → closed ring (closing point implied). */
function airspaceRing(points: readonly RawAirspacePoint[]): LatLon[] {
  const out: LatLon[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const kind = p.via[0];
    if (kind === 'C') {
      if (!p.arcOrigin || !p.arcNm) continue;
      for (let b = 0; b < 360; b += AIRSPACE_ARC_STEP_DEG) out.push(destination(p.arcOrigin, b, p.arcNm * 1852));
      continue;
    }
    if (!p.pos) continue;
    out.push(p.pos);
    if ((kind === 'R' || kind === 'L') && p.arcOrigin) {
      // Arc from this point to the next one (or back to the first after the last).
      const next = p.via[1] === 'E' ? points[0]! : points[i + 1];
      const to = next?.pos;
      if (!to) continue;
      const b0 = courseTo(p.arcOrigin, p.pos);
      const b1 = courseTo(p.arcOrigin, to);
      const span = kind === 'R' ? (b1 - b0 + 360) % 360 : -((b0 - b1 + 360) % 360);
      const nm = p.arcNm ?? distanceNm(p.arcOrigin, p.pos);
      const n = Math.max(1, Math.ceil(Math.abs(span) / AIRSPACE_ARC_STEP_DEG));
      for (let k = 1; k < n; k++) out.push(destination(p.arcOrigin, b0 + (span * k) / n, nm * 1852));
    }
  }
  return out;
}

// ─── Area import ─────────────────────────────────────────────────────────────

export interface CifpAreaOptions {
  /** Airports whose runways are imported (ICAO). The first is the main airport. */
  airports: string[];
  /** Airports whose procedures are imported too; default: all of `airports`. */
  proceduresFor?: string[];
  /** Fixes and airways within this distance of the pack reference are included. */
  radiusNm: number;
  /** Area centre; default: the first airport's reference point. */
  reference?: LatLon;
  /** ISO date the file was downloaded (recorded in the pack sources). */
  retrieved: string;
}

export interface CifpImportResult {
  airac: string | null;
  reference: LatLon;
  magVar: number;
  airports: Airport[];
  runways: Runway[];
  fixes: Fix[];
  airways: Airway[];
  procedures: Procedure[];
  source: PackSource;
  warnings: string[];
}

const PT = new Set<string>(PATH_TERMINATORS);

export function importCifpArea(text: string | CifpRecords, options: CifpAreaOptions): CifpImportResult {
  const rec = typeof text === 'string' ? readCifpRecords(text) : text;
  const warnings: string[] = [];

  // ── Airports ─────────────────────────────────────────────────────────────
  const airports: RawAirport[] = [];
  for (const icao of options.airports) {
    const a = rec.airports.get(icao.toUpperCase());
    if (a) airports.push(a);
    else warnings.push(`${icao}: not in CIFP`);
  }
  const first = airports[0];
  if (!first && !options.reference) {
    throw new Error('none of the requested airports are in the CIFP file and no reference point was given');
  }
  const reference = options.reference ?? first!.arp;
  // Charted variation of the main airport; WMM when the area has no CIFP airport.
  const magVar = first ? first.magVar : Math.round(declinationDeg(reference, new Date(options.retrieved)) * 10) / 10;
  const inArea = (p: LatLon) => distanceNm(reference, p) <= options.radiusNm;
  const wanted = new Set(airports.map((a) => a.icao));

  // ── Fix resolution: same ident can exist in several regions; take the one
  //    nearest the area (CIFP idents are unique within the US in practice). ──
  const nearest = (id: string): Fix | undefined => {
    const list = rec.fixes.get(id);
    if (!list) return undefined;
    let best = list[0]!;
    for (const f of list) if (distanceM(reference, f.pos) < distanceM(reference, best.pos)) best = f;
    return best;
  };
  const fixes = new Map<string, Fix>();
  const useFix = (id: string): Fix | undefined => {
    if (!id) return undefined;
    const existing = fixes.get(id);
    if (existing) return existing;
    const f = nearest(id);
    if (f) fixes.set(id, { ...f, pos: { ...f.pos } });
    return f;
  };

  // ── Runways (+ ILS), end point from the reciprocal threshold ─────────────
  const rawByKey = new Map(rec.runways.map((r) => [`${r.airport}/${r.id}`, r]));
  const ilsByRunway = new Map(rec.ils.map((i) => [`${i.airport}/${i.runway}`, i]));
  const runways: Runway[] = [];
  for (const r of rec.runways) {
    if (!wanted.has(r.airport)) continue;
    const airport = rec.airports.get(r.airport)!;
    const recip = reciprocalRunway(r.id);
    const opp = recip ? rawByKey.get(`${r.airport}/${recip}`) : undefined;
    let headingTrue: number;
    let end: LatLon;
    const displacedM = r.displacedFt * M_PER_FT;
    const lengthM = r.lengthFt * M_PER_FT;
    if (opp) {
      headingTrue = courseTo(r.threshold, opp.threshold);
      // Physical far end = opposite threshold moved back by its own displacement.
      end = destination(opp.threshold, headingTrue, opp.displacedFt * M_PER_FT);
    } else if (r.bearingMag !== null) {
      headingTrue = magToTrue(r.bearingMag, airport.magVar);
      end = destination(r.threshold, headingTrue, lengthM - displacedM);
      warnings.push(`${r.airport}/${r.id}: no reciprocal runway, far end computed from bearing`);
    } else {
      warnings.push(`${r.airport}/${r.id}: no reciprocal runway and no bearing, skipped`);
      continue;
    }
    const ils = ilsByRunway.get(`${r.airport}/${r.id}`);
    runways.push({
      id: r.id,
      airport: r.airport,
      threshold: r.threshold,
      end,
      headingTrue: normDeg(headingTrue),
      lengthM,
      widthM: (r.widthFt ?? 150) * M_PER_FT,
      thresholdElevFt: r.thresholdElevFt,
      ...(displacedM > 0 ? { displacedM } : {}),
      ...(ils && ils.bearingMag !== null
        ? {
            ils: {
              courseTrue: magToTrue(ils.bearingMag, airport.magVar),
              glideslopeDeg: ils.gsDeg ?? 3,
              ...(ils.tchFt !== null ? { tchFt: ils.tchFt } : r.tchFt !== null ? { tchFt: r.tchFt } : {}),
            },
          }
        : {}),
    });
    fixes.set(`${r.airport}.RW${r.id}`, { id: `${r.airport}.RW${r.id}`, kind: 'runway', pos: r.threshold });
  }

  // ── Procedures ───────────────────────────────────────────────────────────
  const groups = new Map<string, RawLeg[]>();
  const withProcedures = new Set((options.proceduresFor ?? options.airports).map((a) => a.toUpperCase()));
  for (const l of rec.legs) {
    if (!withProcedures.has(l.airport)) continue;
    const key = `${l.airport}|${l.kind}|${l.ident}|${l.routeType}|${l.transition}`;
    const g = groups.get(key);
    if (g) g.push(l);
    else groups.set(key, [l]);
  }
  const procedures: Procedure[] = [];
  for (const legs of groups.values()) {
    legs.sort((a, b) => a.seq - b.seq);
    const first = legs[0]!;
    const airport = rec.airports.get(first.airport)!;
    let inMissed = false;
    const out: Leg[] = [];
    for (const l of legs) {
      const line = l.line;
      const type = col(line, 48, 49);
      if (!PT.has(type)) {
        warnings.push(`${first.airport} ${first.ident}: unknown path terminator "${type}"`);
        continue;
      }
      const fixSection = col(line, 37, 38);
      const rawFix = colT(line, 30, 34);
      // Runway thresholds are stored per airport ("KJFK.RW04L"); legs may also end
      // at the airport reference point itself (section PA).
      const fixId = fixSection === 'PG' ? `${first.airport}.${rawFix}` : rawFix;
      if (fixSection === 'PA' && rawFix) {
        const apt = rec.airports.get(rawFix);
        if (apt) fixes.set(rawFix, { id: rawFix, kind: 'airport', pos: { ...apt.arp } });
      } else if (rawFix && fixSection !== 'PG' && !useFix(rawFix)) {
        warnings.push(`${first.airport} ${first.ident}: fix ${rawFix} not found`);
      }
      if (col(line, 42, 42) === 'M') inMissed = true;
      const crs = parseCourse(col(line, 71, 74));
      const dist = colT(line, 75, 78);
      const turnCode = col(line, 44, 44);
      // Cols 107–111 carry the arc centre only on RF legs (elsewhere: TAA / other refs).
      const centre = type === 'RF' ? colT(line, 107, 111) : '';
      if (centre) useFix(centre);
      const navaid = colT(line, 51, 54);
      if (navaid) useFix(navaid);
      const arc = int(col(line, 57, 62));
      const speed = int(col(line, 100, 102));
      const vpa = int(col(line, 103, 106));
      const alt = altitudeConstraint(col(line, 83, 83), parseAltitude(col(line, 85, 89)), parseAltitude(col(line, 90, 94)));
      out.push({
        type: type as PathTerminator,
        ...(rawFix ? { fix: fixId } : {}),
        ...(crs ? { courseTrue: crs.isTrue ? crs.deg : magToTrue(crs.deg, airport.magVar) } : {}),
        ...(centre ? { centre } : {}),
        ...(arc ? { radiusNm: arc / 1000 } : {}),
        ...(alt ? { altitude: alt } : {}),
        ...(speed ? { speedKt: speed } : {}),
        ...(col(line, 41, 41) === 'Y' ? { flyOver: true } : {}),
        ...(turnCode === 'L' ? { turn: 'left' as const } : turnCode === 'R' ? { turn: 'right' as const } : {}),
        ...(/^\d{4}$/.test(dist) ? { distanceNm: Number(dist) / 10 } : {}),
        ...(/^T\d{3}$/.test(dist) ? { holdMinutes: Number(dist.slice(1)) / 10 } : {}),
        ...(navaid ? { navaid } : {}),
        ...(vpa ? { vpaDeg: vpa / 100 } : {}),
        ...(inMissed ? { missedApproach: true } : {}),
      });
    }
    if (out.length === 0) continue;
    const runwayFromTransition = /^RW(\d{2}[LCRB]?)$/.exec(first.transition)?.[1];
    const runwayFromApproach = first.kind === 'IAP' ? /^[A-Z](\d{2}[LCR]?)/.exec(first.ident)?.[1] : undefined;
    const runway = runwayFromTransition ?? runwayFromApproach;
    procedures.push({
      id: first.ident,
      kind: first.kind,
      airport: first.airport,
      ...(runway ? { runway } : {}),
      ...(first.transition ? { transition: first.transition } : {}),
      legs: out,
    });
  }

  // ── Airways crossing the area ────────────────────────────────────────────
  const byRoute = new Map<string, RawAirwayPoint[]>();
  for (const p of rec.airways) {
    const list = byRoute.get(p.route);
    if (list) list.push(p);
    else byRoute.set(p.route, [p]);
  }
  const airways: Airway[] = [];
  for (const [route, points] of byRoute) {
    points.sort((a, b) => a.seq - b.seq);
    const segments: Airway['segments'] = [];
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i]!;
      const b = points[i + 1]!;
      if (a.endOfAirway) continue;
      const fa = nearest(a.fix);
      const fb = nearest(b.fix);
      if (!fa || !fb || !(inArea(fa.pos) || inArea(fb.pos))) continue;
      useFix(a.fix);
      useFix(b.fix);
      segments.push({
        from: a.fix,
        to: b.fix,
        ...(a.minAltFt !== null ? { minAltFt: a.minAltFt } : {}),
        ...(a.maxAltFt !== null ? { maxAltFt: a.maxAltFt } : {}),
      });
    }
    if (segments.length) airways.push({ id: route, segments });
  }

  // ── Remaining fixes inside the area (excluding other airports' runways) ──
  for (const [id, list] of rec.fixes) {
    if (fixes.has(id)) continue;
    const f = list.find((x) => x.kind !== 'runway' && inArea(x.pos));
    if (f) fixes.set(id, { ...f, pos: { ...f.pos } });
  }

  return {
    airac: rec.airac,
    reference,
    magVar,
    airports: airports.map(({ magVar: mv, ...a }) => ({ ...a, magVar: mv })),
    runways,
    fixes: [...fixes.values()],
    airways,
    procedures,
    warnings,
    source: {
      name: `FAA CIFP${rec.airac ? ` AIRAC ${rec.airac}` : ''}`,
      licence: 'Public-Domain',
      url: CIFP_SOURCE_URL,
      retrieved: options.retrieved,
    },
  };
}
