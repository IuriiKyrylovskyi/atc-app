/**
 * Geodesy on the WGS-84 ellipsoid (Karney's algorithms, GeographicLib — MIT).
 *
 * Accuracy: ~15 nanometres for distances, far beyond what ATC needs; there is no
 * flat-earth shortcut anywhere in the sim.
 *
 * No paid alternative is needed here.
 */
import * as GeographicLib from 'geographiclib-geodesic';
import { M_PER_NM, normDeg } from '../units';

export interface LatLon {
  /** Degrees, positive north. */
  lat: number;
  /** Degrees, positive east. */
  lon: number;
}

const wgs84 = GeographicLib.Geodesic.WGS84;

export interface InverseResult {
  /** Distance in metres. */
  distanceM: number;
  /** True course at the start point, degrees [0, 360). */
  initialCourse: number;
  /** True course arriving at the end point, degrees [0, 360). */
  finalCourse: number;
}

/** Distance and courses between two points. */
export function inverse(from: LatLon, to: LatLon): InverseResult {
  const r = wgs84.Inverse(from.lat, from.lon, to.lat, to.lon);
  return {
    distanceM: r.s12 ?? 0,
    initialCourse: normDeg(r.azi1 ?? 0),
    finalCourse: normDeg(r.azi2 ?? 0),
  };
}

export const distanceM = (from: LatLon, to: LatLon): number => inverse(from, to).distanceM;
export const distanceNm = (from: LatLon, to: LatLon): number => distanceM(from, to) / M_PER_NM;
export const courseTo = (from: LatLon, to: LatLon): number => inverse(from, to).initialCourse;

export interface DirectResult {
  point: LatLon;
  /** True course at the destination, degrees [0, 360). */
  finalCourse: number;
}

/** Point reached from `from` along true course `courseDeg` after `distanceM` metres. */
export function direct(from: LatLon, courseDeg: number, distanceMeters: number): DirectResult {
  const r = wgs84.Direct(from.lat, from.lon, courseDeg, distanceMeters);
  return {
    point: { lat: r.lat2 ?? from.lat, lon: r.lon2 ?? from.lon },
    finalCourse: normDeg(r.azi2 ?? courseDeg),
  };
}

export const destination = (from: LatLon, courseDeg: number, distanceMeters: number): LatLon =>
  direct(from, courseDeg, distanceMeters).point;
