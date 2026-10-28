/**
 * ILS approach: localizer intercept and tracking, glideslope capture, landing
 * and missed approach.
 *
 * Geometry is a local tangent frame at the threshold with WGS-84 degree lengths
 * (good to a few metres over a 30 NM final). The localizer course line runs through the threshold on
 * the published course; for an offset localizer (e.g. KJFK 22R) the real antenna
 * line differs by a few hundred metres at the threshold — close enough until
 * the FMS (Phase 4) flies the coded IAP legs.
 */
import { angleDiffDeg, DEG, M_PER_NM } from '../units';
import type { ApproachState, LatLon, Runway } from '../model/types';

export const FT_PER_NM = 6076.12;
/** Standard ILS reference datum height when the pack has none, ft. */
const DEFAULT_TCH_FT = 50;
/** Localizer is usable inside this distance, NM (standard service volume 18 NM, extended to 25). */
export const LOC_RANGE_NM = 25;
/** Intercept angles above this are not captured (aircraft is not heading in). */
const MAX_INTERCEPT_DEG = 90;
/** Tracking gain: degrees of correction per NM off course, and its limit. */
const LOC_GAIN_DEG_PER_NM = 40;
const LOC_MAX_CORRECTION_DEG = 30;
/** Must be this low over the threshold to land, ft above threshold elevation. */
export const LANDING_GATE_FT = 200;
/** Speed restrictions on final: 180 kt until 5 NM, then final approach speed. */
export const FINAL_SPEED_KT = 180;
export const FINAL_SPEED_UNTIL_NM = 5;

export interface LocalizerGeometry {
  /** Distance to the threshold measured along the course, NM (positive on the approach side). */
  alongNm: number;
  /** Lateral offset from the course, NM; positive = right of course looking inbound. */
  crossNm: number;
  /** Glideslope altitude at this distance, ft. */
  glideslopeFt: number;
}

export function localizerGeometry(pos: LatLon, rwy: Runway): LocalizerGeometry {
  const course = rwy.ils?.courseTrue ?? rwy.headingTrue;
  const gs = rwy.ils?.glideslopeDeg ?? 3;
  const tch = rwy.ils?.tchFt ?? DEFAULT_TCH_FT;
  // WGS-84 metres per degree at the threshold latitude (standard series), in NM.
  const phi = rwy.threshold.lat * DEG;
  const nmPerDegLat = (111132.954 - 559.822 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi)) / M_PER_NM;
  const nmPerDegLon = (111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi)) / M_PER_NM;
  const x = (pos.lon - rwy.threshold.lon) * nmPerDegLon;
  const y = (pos.lat - rwy.threshold.lat) * nmPerDegLat;
  const ux = Math.sin(course * DEG);
  const uy = Math.cos(course * DEG);
  const alongNm = -(x * ux + y * uy);
  const crossNm = x * uy - y * ux;
  const glideslopeFt = rwy.thresholdElevFt + tch + Math.max(0, alongNm) * FT_PER_NM * Math.tan(gs * DEG);
  return { alongNm, crossNm, glideslopeFt };
}

/** Track to fly on the localizer: the course, corrected towards the centreline. */
export function localizerTrack(rwy: Runway, crossNm: number): number {
  const course = rwy.ils?.courseTrue ?? rwy.headingTrue;
  const correction = Math.max(-LOC_MAX_CORRECTION_DEG, Math.min(LOC_MAX_CORRECTION_DEG, crossNm * LOC_GAIN_DEG_PER_NM));
  return course - correction;
}

/**
 * Whether an aircraft cleared for the approach captures the localizer now:
 * inside the service volume, heading in, and within the turn lead distance.
 */
export function capturesLocalizer(trackTrue: number, tasKt: number, turnRateDegS: number, rwy: Runway, g: LocalizerGeometry): boolean {
  if (g.alongNm <= 0 || g.alongNm > LOC_RANGE_NM) return false;
  const course = rwy.ils?.courseTrue ?? rwy.headingTrue;
  const intercept = Math.abs(angleDiffDeg(trackTrue, course));
  if (intercept >= MAX_INTERCEPT_DEG) return false;
  // Heading away from the centreline (e.g. right of course on a right-hand intercept): not yet.
  // angleDiffDeg(track, course) = course − track: positive when tracking left of the course,
  // which closes the centreline from the right (crossNm > 0).
  const towards = Math.sign(angleDiffDeg(trackTrue, course)) === Math.sign(g.crossNm) || Math.abs(g.crossNm) < 0.05;
  if (!towards && intercept > 1) return false;
  // Turn radius at this TAS and rate: r = V / ω.
  const radiusNm = tasKt / 3600 / (Math.max(turnRateDegS, 0.5) * DEG);
  const lead = radiusNm * (1 - Math.cos(intercept * DEG)) + 0.1;
  return Math.abs(g.crossNm) <= lead;
}

export const describeApproach = (a: ApproachState) => `ILS ${a.runway}`;
