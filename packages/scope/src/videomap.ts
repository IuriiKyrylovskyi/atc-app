/**
 * Video map: everything static on the scope, projected once into local metres
 * so drawing a frame is only a scale + offset per point.
 */
import {
  destination,
  normDeg,
  StereographicProjection,
  M_PER_NM,
  type AirspacePack,
  type FixKind,
  type LatLon,
  type LocalXY,
} from '@atc-app/sim';
import { centroid, type MapArea } from './sectors';

export interface MapFix {
  id: string;
  kind: FixKind;
  xy: LocalXY;
  /** Used by an airway or procedure of the pack (shown at wider ranges). */
  onRoute: boolean;
}

export interface MapRunway {
  airport: string;
  id: string;
  threshold: LocalXY;
  end: LocalXY;
  widthM: number;
  /** Extended centreline (from threshold outwards) with 1 NM tick points; ILS runways only. */
  centreline?: { from: LocalXY; to: LocalXY; ticks: LocalXY[]; headingTrue: number };
}

export interface MapAirway {
  id: string;
  from: LocalXY;
  to: LocalXY;
}

export interface MapAirport {
  icao: string;
  name: string;
  xy: LocalXY;
}

export interface VideoMap {
  packId: string;
  name: string;
  airac: string;
  reference: LatLon;
  projection: StereographicProjection;
  airports: MapAirport[];
  runways: MapRunway[];
  fixes: MapFix[];
  airways: MapAirway[];
  /** Control sectors (kind "sector"). */
  sectors: MapArea[];
  /** Every other area: CTR / TMA, restricted, danger, … */
  areas: MapArea[];
}

export interface VideoMapOptions {
  /** Length of extended centrelines, NM. */
  centrelineNm?: number;
}

export function buildVideoMap(pack: AirspacePack, options: VideoMapOptions = {}): VideoMap {
  const proj = new StereographicProjection(pack.meta.reference);
  const L = (p: LatLon) => proj.toLocal(p);
  const centrelineNm = options.centrelineNm ?? 10;

  const fixPos = new Map(pack.fixes.map((f) => [f.id, f.pos]));
  const onRoute = new Set<string>();
  for (const a of pack.airways ?? []) for (const s of a.segments) onRoute.add(s.from).add(s.to);
  for (const p of pack.procedures ?? []) for (const l of p.legs) if (l.fix) onRoute.add(l.fix);

  const runways: MapRunway[] = pack.runways.map((r) => {
    const out: MapRunway = {
      airport: r.airport,
      id: r.id,
      threshold: L(r.threshold),
      end: L(r.end),
      widthM: r.widthM,
    };
    if (r.ils) {
      // Outbound from the threshold, opposite to the landing direction.
      const outbound = normDeg(r.ils.courseTrue + 180);
      const ticks: LocalXY[] = [];
      for (let nm = 1; nm <= centrelineNm; nm++) ticks.push(L(destination(r.threshold, outbound, nm * M_PER_NM)));
      out.centreline = {
        from: L(r.threshold),
        to: L(destination(r.threshold, outbound, centrelineNm * M_PER_NM)),
        ticks,
        headingTrue: r.ils.courseTrue,
      };
    }
    return out;
  });

  const airways: MapAirway[] = [];
  for (const a of pack.airways ?? []) {
    for (const s of a.segments) {
      const from = fixPos.get(s.from);
      const to = fixPos.get(s.to);
      if (from && to) airways.push({ id: a.id, from: L(from), to: L(to) });
    }
  }

  const areas: MapArea[] = (pack.areas ?? []).map((a) => {
    const polygon = a.polygon.map(L);
    return {
      id: a.id,
      kind: a.kind,
      ...(a.name ? { name: a.name } : {}),
      polygon,
      floorFt: a.floorFt,
      ceilingFt: a.ceilingFt,
      labelAt: centroid(polygon),
      ...(a.parts?.length
        ? { parts: a.parts.map((p) => ({ polygon: p.polygon.map(L), floorFt: p.floorFt, ceilingFt: p.ceilingFt })) }
        : {}),
    };
  });
  // "Excluding ARR sector, DSB sector": link the carved-out areas.
  (pack.areas ?? []).forEach((a, i) => {
    const excluded = (a.exclude ?? []).flatMap((id) => areas.filter((x) => x.id === id));
    if (excluded.length) areas[i]!.excluded = excluded;
  });

  return {
    packId: pack.meta.id,
    name: pack.meta.name,
    airac: pack.meta.airac,
    reference: pack.meta.reference,
    projection: proj,
    airports: pack.airports.map((a) => ({ icao: a.icao, name: a.name, xy: L(a.arp) })),
    runways,
    // Runway thresholds and airport points are drawn as runways / airports.
    fixes: pack.fixes
      .filter((f) => f.kind !== 'runway' && f.kind !== 'airport')
      .map((f) => ({ id: f.id, kind: f.kind, xy: L(f.pos), onRoute: onRoute.has(f.id) })),
    airways,
    sectors: areas.filter((a) => a.kind === 'sector'),
    areas: areas.filter((a) => a.kind !== 'sector'),
  };
}
