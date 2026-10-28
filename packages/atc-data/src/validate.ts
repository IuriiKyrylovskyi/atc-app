/**
 * Pack validation: schema, licences, referential integrity and geometry.
 *
 * Errors block publishing; warnings are reported for review (e.g. a procedure
 * that references a fix not in this pack yet).
 */
import { courseTo, distanceM, distanceNm, angleDiffDeg, type AirspacePack } from '@atc-app/sim';
import { airspacePackSchema, PUBLISHABLE_LICENCES } from './schema';

export interface PackIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  pack?: AirspacePack;
  errors: PackIssue[];
  warnings: PackIssue[];
}

export interface ValidateOptions {
  /** Allow sources whose licence is not publishable (local experiments only). */
  allowUnpublishableLicences?: boolean;
  /** Runway length tolerance: the larger of this many metres … */
  runwayLengthToleranceM?: number;
  /** … and this fraction of the runway length. */
  runwayLengthToleranceFraction?: number;
  /** Max difference between published true heading and threshold→end course. */
  runwayHeadingToleranceDeg?: number;
  /** Warn when an airport lies further than this from the pack reference point. */
  maxAirportDistanceNm?: number;
}

const DEFAULTS: Required<ValidateOptions> = {
  allowUnpublishableLicences: false,
  runwayLengthToleranceM: 30,
  runwayLengthToleranceFraction: 0.01,
  runwayHeadingToleranceDeg: 1,
  maxAirportDistanceNm: 300,
};

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const v of values) (seen.has(v) ? dup : seen).add(v);
  return [...dup];
}

export function validatePack(input: unknown, options: ValidateOptions = {}): ValidationResult {
  const opt = { ...DEFAULTS, ...options };
  const errors: PackIssue[] = [];
  const warnings: PackIssue[] = [];

  const parsed = airspacePackSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push({ path: issue.path.join('.'), message: issue.message });
    }
    return { ok: false, errors, warnings };
  }
  const pack = parsed.data as AirspacePack;

  // ── Licences ─────────────────────────────────────────────────────────────
  pack.meta.sources.forEach((s, i) => {
    if (!(PUBLISHABLE_LICENCES as readonly string[]).includes(s.licence)) {
      const issue = {
        path: `meta.sources.${i}.licence`,
        message: `licence "${s.licence}" is not publishable (allowed: ${PUBLISHABLE_LICENCES.join(', ')})`,
      };
      (opt.allowUnpublishableLicences ? warnings : errors).push(issue);
    }
    if (s.licence === 'ODbL-1.0') {
      warnings.push({
        path: `meta.sources.${i}.licence`,
        message: 'ODbL source: the pack database must be shared under ODbL with attribution',
      });
    }
  });

  // ── Unique identifiers ───────────────────────────────────────────────────
  for (const d of duplicates(pack.airports.map((a) => a.icao))) {
    errors.push({ path: 'airports', message: `duplicate airport ${d}` });
  }
  for (const d of duplicates(pack.fixes.map((f) => f.id))) {
    errors.push({ path: 'fixes', message: `duplicate fix ${d}` });
  }
  for (const d of duplicates(pack.runways.map((r) => `${r.airport}/${r.id}`))) {
    errors.push({ path: 'runways', message: `duplicate runway ${d}` });
  }

  // ── Airports ─────────────────────────────────────────────────────────────
  const airports = new Set(pack.airports.map((a) => a.icao));
  pack.airports.forEach((a, i) => {
    const d = distanceNm(pack.meta.reference, a.arp);
    if (d > opt.maxAirportDistanceNm) {
      warnings.push({
        path: `airports.${i}`,
        message: `${a.icao} is ${d.toFixed(0)} NM from the reference point (projection error grows)`,
      });
    }
  });

  // ── Runway geometry ──────────────────────────────────────────────────────
  pack.runways.forEach((r, i) => {
    const path = `runways.${i}`;
    if (!airports.has(r.airport)) {
      errors.push({ path, message: `runway ${r.id} references unknown airport ${r.airport}` });
    }
    const expected = r.lengthM - (r.displacedM ?? 0);
    const actual = distanceM(r.threshold, r.end);
    const tol = Math.max(opt.runwayLengthToleranceM, r.lengthM * opt.runwayLengthToleranceFraction);
    if (Math.abs(actual - expected) > tol) {
      errors.push({
        path,
        message: `${r.airport}/${r.id}: threshold→end is ${actual.toFixed(0)} m, expected ${expected.toFixed(0)} m (±${tol.toFixed(0)})`,
      });
    }
    const dHdg = Math.abs(angleDiffDeg(r.headingTrue, courseTo(r.threshold, r.end)));
    if (dHdg > opt.runwayHeadingToleranceDeg) {
      errors.push({
        path,
        message: `${r.airport}/${r.id}: heading ${r.headingTrue}° differs from threshold→end course by ${dHdg.toFixed(2)}°`,
      });
    }
  });

  // ── References from procedures / airways ─────────────────────────────────
  const fixes = new Set(pack.fixes.map((f) => f.id));
  pack.procedures?.forEach((p, i) => {
    p.legs.forEach((leg, j) => {
      for (const ref of [leg.fix, leg.centre]) {
        if (ref && !fixes.has(ref)) {
          warnings.push({ path: `procedures.${i}.legs.${j}`, message: `${p.id}: unknown fix ${ref}` });
        }
      }
    });
  });
  pack.airways?.forEach((a, i) => {
    a.segments.forEach((s, j) => {
      for (const ref of [s.from, s.to]) {
        if (!fixes.has(ref)) {
          warnings.push({ path: `airways.${i}.segments.${j}`, message: `${a.id}: unknown fix ${ref}` });
        }
      }
    });
  });

  // ── Areas ────────────────────────────────────────────────────────────────
  pack.areas?.forEach((a, i) => {
    if (a.floorFt >= a.ceilingFt) {
      errors.push({ path: `areas.${i}`, message: `${a.id}: floor ${a.floorFt} ft is not below ceiling ${a.ceilingFt} ft` });
    }
  });

  return { ok: errors.length === 0, pack, errors, warnings };
}
