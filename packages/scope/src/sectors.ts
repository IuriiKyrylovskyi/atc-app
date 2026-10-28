/**
 * Sectors on the scope: geometry (projected polygons + vertical limits),
 * traffic ownership seen from the active sector, and route / ETO paths.
 *
 * Ownership is geometric for now: an aircraft inside the active sector's
 * volume is "owned", one predicted to enter it within the look-ahead is
 * "incoming", everything else is "other". Handoffs and track assumption
 * (Phase 3, multi-sector) will make ownership explicit instead.
 */
import {
  distanceNm,
  type AircraftState,
  type AreaKind,
  type LatLon,
  type LocalXY,
  type StereographicProjection,
} from '@atc-app/sim';
import type { Ownership } from './systems';

export interface MapArea {
  id: string;
  kind: AreaKind;
  name?: string;
  polygon: LocalXY[];
  floorFt: number;
  ceilingFt: number;
  /** Where to put the label: area centroid. */
  labelAt: LocalXY;
}

/** Area-weighted centroid of a simple polygon (vertex mean if degenerate). */
export function centroid(poly: readonly LocalXY[]): LocalXY {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const cross = p.x * q.y - q.x * p.y;
    a += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  if (Math.abs(a) < 1e-9) {
    return {
      x: poly.reduce((s, p) => s + p.x, 0) / poly.length,
      y: poly.reduce((s, p) => s + p.y, 0) / poly.length,
    };
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

/** Even-odd ray casting. */
export function pointInPolygon(p: LocalXY, poly: readonly LocalXY[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Inside the volume: lateral polygon, floor inclusive, ceiling exclusive. */
export function inVolume(area: MapArea, xy: LocalXY, altFt: number): boolean {
  return altFt >= area.floorFt && altFt < area.ceilingFt && pointInPolygon(xy, area.polygon);
}

/** How far ahead "incoming" looks, s, and the sample step. */
export const INCOMING_LOOKAHEAD_S = 300;
const SAMPLE_S = 15;

/** Altitude after `t` s at the current rate, stopping at the cleared level. */
function altitudeAt(ac: AircraftState, t: number): number {
  const z = ac.altFt + (ac.vsFpm / 60) * t;
  const target = ac.target.altFt;
  if (ac.vsFpm > 0) return Math.min(z, Math.max(target, ac.altFt));
  if (ac.vsFpm < 0) return Math.max(z, Math.min(target, ac.altFt));
  return ac.altFt;
}

/**
 * Ownership of one aircraft from the active sector's point of view. No active
 * sector ("all sectors") means the controller works everything.
 */
export function ownershipOf(ac: AircraftState, xy: LocalXY, active: MapArea | null): Ownership {
  if (!active) return 'owned';
  if (inVolume(active, xy, ac.altFt)) return 'owned';
  const v = (ac.gsKt * 1852) / 3600; // m/s
  const tr = (ac.trackTrue * Math.PI) / 180;
  for (let t = SAMPLE_S; t <= INCOMING_LOOKAHEAD_S; t += SAMPLE_S) {
    const p = { x: xy.x + v * t * Math.sin(tr), y: xy.y + v * t * Math.cos(tr) };
    if (inVolume(active, p, altitudeAt(ac, t))) return 'incoming';
  }
  return 'other';
}

/** Sector the aircraft is in (first match), for labels. */
export function sectorOf(ac: AircraftState, xy: LocalXY, sectors: readonly MapArea[]): MapArea | undefined {
  return sectors.find((s) => inVolume(s, xy, ac.altFt));
}

/** "000–170": vertical limits in hundreds of feet. */
export const verticalLimits = (a: Pick<MapArea, 'floorFt' | 'ceilingFt'>) =>
  `${String(Math.round(a.floorFt / 100)).padStart(3, '0')}–${String(Math.round(a.ceilingFt / 100)).padStart(3, '0')}`;

// ── Route + ETO ─────────────────────────────────────────────────────────────

export interface RoutePoint {
  id: string;
  xy: LocalXY;
  /** Estimated time over, sim seconds. */
  etoS: number;
}

export interface RoutePath {
  callsign: string;
  points: RoutePoint[];
}

/**
 * The aircraft's remaining route (direct fix, then route fixes, then the runway
 * threshold when cleared for an approach) with estimated times over each point
 * at the current ground speed.
 */
export function routePath(
  ac: AircraftState,
  nowS: number,
  projection: StereographicProjection,
  fixPos: (id: string) => LatLon | undefined,
  threshold?: { id: string; pos: LatLon }
): RoutePath {
  const ids = [ac.target.directFix, ...ac.target.route].filter((x): x is string => !!x);
  const stops = ids.flatMap((id) => {
    const pos = fixPos(id);
    return pos ? [{ id, pos }] : [];
  });
  if (threshold) stops.push(threshold);
  const speed = Math.max(ac.gsKt, 60);
  let from = ac.pos;
  let nm = 0;
  const points = stops.map((s) => {
    nm += distanceNm(from, s.pos);
    from = s.pos;
    return { id: s.id, xy: projection.toLocal(s.pos), etoS: nowS + (nm / speed) * 3600 };
  });
  return { callsign: ac.callsign, points };
}

/** Sim seconds as HH:MM:SS. */
export function clockTime(s: number): string {
  const t = Math.max(0, Math.round(s));
  const hh = String(Math.floor(t / 3600) % 24).padStart(2, '0');
  const mm = String(Math.floor((t % 3600) / 60)).padStart(2, '0');
  const ss = String(t % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}
