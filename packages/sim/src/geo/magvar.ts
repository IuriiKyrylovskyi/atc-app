/**
 * Magnetic variation (declination) from the World Magnetic Model.
 *
 * Free: NOAA/NCEI WMM coefficients (public domain) via the `geomagnetism` package
 * (Apache-2.0), which bundles WMM-2025 (valid 2024-11 … 2029-11). Accuracy of WMM
 * declination is ~0.3–0.5° — enough to turn published magnetic headings/courses
 * into true ones for the sim.
 *
 * PAID-ALT: NOAA High Definition Geomagnetic Model (HDGM).
 *   Why better: adds the crustal field (degree 790+), declination error ≈ 0.1–0.2°,
 *   matches local charted variation more closely.
 *   Price: commercial licence from NOAA/CIRES — quote only.
 *
 * Note: published procedures use the variation printed on the chart (an epoch
 * value), not today's model value. Packs store that charted `magVar` and the sim
 * prefers it; this module fills in where a pack has none.
 */
import geomagnetism from 'geomagnetism';
import { normDeg } from '../units';
import type { LatLon } from './geodesy';

/** Declination in degrees, positive east. `altitudeFt` defaults to sea level. */
export function declinationDeg(p: LatLon, date: Date, altitudeFt = 0): number {
  const model = geomagnetism.model(date, { allowOutOfBoundsModel: true });
  return model.point([p.lat, p.lon, (altitudeFt * 0.3048) / 1000]).decl;
}

/** Magnetic heading/course → true, given declination (positive east). */
export const magToTrue = (magDeg: number, declinationEastDeg: number): number =>
  normDeg(magDeg + declinationEastDeg);

/** True heading/course → magnetic, given declination (positive east). */
export const trueToMag = (trueDeg: number, declinationEastDeg: number): number =>
  normDeg(trueDeg - declinationEastDeg);
