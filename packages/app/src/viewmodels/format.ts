/**
 * Display formatting shared by the view-models: flight levels, headings,
 * positions and clocks, as the scope panels print them.
 */
import { courseTo, distanceNm, normDeg, type LatLon } from '@atc-app/sim';

/** Altitude in hundreds of feet, three digits: 16 000 ft → "160". */
export const flightLevel = (ft: number): string => String(Math.round(ft / 100)).padStart(3, '0');

/** Heading or bearing, three digits, 360 for north: 0.2° → "360", 45° → "045". */
export const heading3 = (deg: number): string =>
  String(Math.round(normDeg(deg)) || 360).padStart(3, '0');

/** Degrees and decimal minutes: 40.5 → "N40°30.0'". */
function dm(value: number, pos: string, neg: string, degDigits: number): string {
  const v = Math.abs(value);
  const deg = Math.floor(v);
  const min = (v - deg) * 60;
  return `${value >= 0 ? pos : neg}${String(deg).padStart(degDigits, '0')}°${min
    .toFixed(1)
    .padStart(4, '0')}'`;
}

/** "N40°38.4' W073°46.8'". */
export const latLonDm = (p: LatLon): string =>
  `${dm(p.lat, 'N', 'S', 2)} ${dm(p.lon, 'E', 'W', 3)}`;

/** Cursor readout: position, then magnetic bearing and distance from the reference. */
export function cursorReadout(cursor: LatLon, reference: LatLon, magVar: number): string {
  const brgMag = courseTo(reference, cursor) - magVar;
  return `${latLonDm(cursor)}   ${heading3(brgMag)}° ${distanceNm(reference, cursor).toFixed(
    1
  )} NM`;
}

/** Sim time as "hh:mm:ss". */
export function clockHms(t: number): string {
  const s = Math.floor(t);
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

/** Sim time as "mm:ss" (comms log). */
export function clockMs(t: number): string {
  const s = Math.floor(t);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
