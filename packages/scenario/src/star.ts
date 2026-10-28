/**
 * Arrival routes from the pack's STAR procedures.
 *
 * Phase 0 flies a STAR as a plain fix sequence (direct fix to fix): enroute
 * transition → common route → runway transition. Leg types, altitude and speed
 * constraints ("descend via") belong to the FMS in Phase 4; the route ends at the
 * first leg without a fix to fly to (FM / VM: expect vectors).
 */
import { courseTo, type AircraftSpawn, type AirspacePack, type Procedure } from '@atc-app/sim';

export interface StarRef {
  airport: string;
  /** Procedure id as published in the pack, e.g. `CAMRN5`. */
  star: string;
  /** Enroute transition (e.g. `PVD`); omitted = start at the common route. */
  transition?: string;
  /** Runway transition, e.g. `04B` or `04L`. */
  runway?: string;
}

const isCommon = (p: Procedure) => !p.runway && (p.transition === undefined || p.transition === 'ALL');

/** The STAR as an ordered list of fix ids (consecutive duplicates removed). */
export function starRoute(pack: AirspacePack, ref: StarRef): string[] {
  const all = (pack.procedures ?? []).filter(
    (p) => p.kind === 'STAR' && p.airport === ref.airport && p.id === ref.star
  );
  if (all.length === 0) throw new Error(`STAR ${ref.star} not found for ${ref.airport}`);

  const segments: Procedure[] = [];
  if (ref.transition) {
    const t = all.find((p) => !p.runway && p.transition === ref.transition);
    if (!t) throw new Error(`${ref.star}: no transition ${ref.transition}`);
    segments.push(t);
  }
  segments.push(...all.filter(isCommon));
  if (ref.runway) {
    const rw = all.find((p) => p.runway === ref.runway || p.transition === `RW${ref.runway}`);
    if (!rw) throw new Error(`${ref.star}: no runway transition ${ref.runway}`);
    segments.push(rw);
  }

  const fixes: string[] = [];
  for (const seg of segments) {
    for (const leg of seg.legs) {
      if (leg.missedApproach) break;
      if (!leg.fix) continue;
      if (fixes[fixes.length - 1] !== leg.fix) fixes.push(leg.fix);
      // From-fix legs end the route: after this fix the pilot expects vectors.
      if (leg.type === 'FM' || leg.type === 'VM') break;
    }
  }
  return fixes;
}

export interface ArrivalSpec extends StarRef {
  callsign: string;
  icaoType: string;
  wake?: AircraftSpawn['wake'];
  squawk?: string;
  /** The aircraft appears over this route fix, heading for the next one. */
  fromFix: string;
  altFt: number;
  casKt: number;
  clearedAltFt?: number;
  clearedCasKt?: number;
}

/** A spawn over `fromFix`, flying the rest of the STAR. */
export function arrivalOnStar(pack: AirspacePack, spec: ArrivalSpec): AircraftSpawn {
  const route = starRoute(pack, spec);
  const at = route.indexOf(spec.fromFix);
  if (at < 0) throw new Error(`${spec.callsign}: ${spec.fromFix} is not on ${spec.star}`);
  const rest = route.slice(at + 1);
  if (rest.length === 0) throw new Error(`${spec.callsign}: nothing left of ${spec.star} after ${spec.fromFix}`);

  const pos = (id: string) => {
    const f = pack.fixes.find((x) => x.id === id);
    if (!f) throw new Error(`${spec.callsign}: fix ${id} is not in pack ${pack.meta.id}`);
    return f.pos;
  };
  const start = pos(spec.fromFix);
  return {
    callsign: spec.callsign,
    icaoType: spec.icaoType,
    ...(spec.wake ? { wake: spec.wake } : {}),
    ...(spec.squawk ? { squawk: spec.squawk } : {}),
    origin: 'scenario',
    pos: start,
    altFt: spec.altFt,
    headingTrue: courseTo(start, pos(rest[0]!)),
    casKt: spec.casKt,
    route: rest,
    ...(spec.clearedAltFt !== undefined ? { clearedAltFt: spec.clearedAltFt } : {}),
    ...(spec.clearedCasKt !== undefined ? { clearedCasKt: spec.clearedCasKt } : {}),
    destination: spec.airport,
  };
}
