/**
 * Point-mass kinematic flight model, one fixed step at a time.
 *
 * Phase 0 scope: heading hold and turns (standard rate, bank-limited), direct-to a
 * fix with wind correction, climb/descent to a target altitude, speed changes with
 * accel/decel limits, 250 kt below 10 000 ft, uniform wind. Procedures (ARINC 424
 * legs), VNAV and approaches arrive with the FMS in Phase 4.
 */
import { casToMach, machToCas, casToTas } from '../atmo/isa';
import { courseTo, destination, distanceM, type LatLon } from '../geo/geodesy';
import { angleDiffDeg, DEG, G0, MS_PER_KT, normDeg } from '../units';
import type { AircraftState } from '../model/types';
import type { PerformanceProfile } from './performance';

/** Standard rate turn, °/s. */
export const STANDARD_RATE_DEG_S = 3;
/** Below this altitude ATC speed limit applies (ICAO / FAA 250 kt rule). */
export const SPEED_LIMIT_ALT_FT = 10_000;
export const SPEED_LIMIT_KT = 250;
/** Distance at which a direct-to fix counts as reached. */
const FIX_CAPTURE_M = 0.3 * 1852;

export interface Wind {
  /** Direction the wind blows FROM, degrees true. */
  fromDeg: number;
  speedKt: number;
}

export interface StepEnv {
  dtS: number;
  perf: PerformanceProfile;
  wind: Wind;
  fixPos(id: string): LatLon | undefined;
}

export interface StepResult {
  fixReached?: string;
}

function approach(current: number, target: number, maxStep: number): number {
  if (Math.abs(target - current) <= maxStep) return target;
  return current + Math.sign(target - current) * maxStep;
}

/** Turn rate (°/s) achievable at this TAS without exceeding the bank limit. */
export function turnRateDegS(tasKt: number, maxBankDeg: number): number {
  const tasMs = Math.max(tasKt * MS_PER_KT, 1);
  const bankLimited = ((G0 * Math.tan(maxBankDeg * DEG)) / tasMs) / DEG;
  return Math.min(STANDARD_RATE_DEG_S, bankLimited);
}

/** Heading that makes good `trackDeg` in this wind (wind-correction angle applied). */
export function headingForTrack(trackDeg: number, tasKt: number, wind: Wind): number {
  if (wind.speedKt <= 0 || tasKt <= 0) return normDeg(trackDeg);
  const ratio = (wind.speedKt * Math.sin((wind.fromDeg - trackDeg) * DEG)) / tasKt;
  const wca = Math.asin(Math.max(-1, Math.min(1, ratio))) / DEG;
  return normDeg(trackDeg + wca);
}

/** Ground track and speed from heading, TAS and wind. */
export function groundVector(headingDeg: number, tasKt: number, wind: Wind): { trackDeg: number; gsKt: number } {
  const toDeg = wind.fromDeg + 180;
  const vx = tasKt * Math.sin(headingDeg * DEG) + wind.speedKt * Math.sin(toDeg * DEG);
  const vy = tasKt * Math.cos(headingDeg * DEG) + wind.speedKt * Math.cos(toDeg * DEG);
  return { trackDeg: normDeg(Math.atan2(vx, vy) / DEG), gsKt: Math.hypot(vx, vy) };
}

/** Advances one aircraft by `env.dtS` seconds. Mutates `ac`. */
export function stepAircraft(ac: AircraftState, env: StepEnv): StepResult {
  const { dtS: dt, perf, wind } = env;
  const result: StepResult = {};
  const t = ac.target;

  // ── Speed ────────────────────────────────────────────────────────────────
  let targetCas = t.mach !== null ? machToCas(t.mach, ac.altFt) : t.casKt;
  if (ac.altFt < SPEED_LIMIT_ALT_FT) targetCas = Math.min(targetCas, SPEED_LIMIT_KT);
  targetCas = Math.min(Math.max(targetCas, perf.minCasKt), perf.maxCasKt);
  const rate = targetCas > ac.casKt ? perf.accelKtPerS : perf.decelKtPerS;
  ac.casKt = approach(ac.casKt, targetCas, rate * dt);
  ac.tasKt = casToTas(ac.casKt, ac.altFt);
  ac.mach = casToMach(ac.casKt, ac.altFt);

  // ── Lateral ──────────────────────────────────────────────────────────────
  let desiredHeading: number | null = t.headingTrue;
  if (t.directFix) {
    const fix = env.fixPos(t.directFix);
    if (fix) {
      if (distanceM(ac.pos, fix) <= Math.max(FIX_CAPTURE_M, ac.gsKt * MS_PER_KT * dt)) {
        // Reached: keep flying the current heading until the next clearance.
        result.fixReached = t.directFix;
        t.directFix = null;
        t.headingTrue = ac.headingTrue;
        desiredHeading = ac.headingTrue;
      } else {
        desiredHeading = headingForTrack(courseTo(ac.pos, fix), ac.tasKt, wind);
      }
    }
  }
  if (desiredHeading !== null) {
    let delta = angleDiffDeg(ac.headingTrue, desiredHeading);
    if (t.turn === 'right' && delta < 0) delta += 360;
    if (t.turn === 'left' && delta > 0) delta -= 360;
    const maxTurn = turnRateDegS(ac.tasKt, perf.maxBankDeg) * dt;
    if (Math.abs(delta) <= maxTurn) {
      ac.headingTrue = normDeg(desiredHeading);
      t.turn = null;
    } else {
      ac.headingTrue = normDeg(ac.headingTrue + Math.sign(delta) * maxTurn);
    }
  }

  // ── Vertical ─────────────────────────────────────────────────────────────
  const dAlt = t.altFt - ac.altFt;
  if (dAlt === 0) {
    ac.vsFpm = 0;
  } else {
    const nominal =
      dAlt > 0 ? (ac.altFt < SPEED_LIMIT_ALT_FT ? perf.climbFpmLow : perf.climbFpmHigh) : perf.descentFpm;
    const fpm = t.vsFpm ?? nominal;
    const step = (fpm / 60) * dt;
    const next = approach(ac.altFt, t.altFt, step);
    // Levelling off this step: report level flight, not the last partial step.
    ac.vsFpm = next === t.altFt ? 0 : ((next - ac.altFt) / dt) * 60;
    ac.altFt = next;
  }

  // ── Position ─────────────────────────────────────────────────────────────
  const g = groundVector(ac.headingTrue, ac.tasKt, wind);
  ac.trackTrue = g.trackDeg;
  ac.gsKt = g.gsKt;
  ac.pos = destination(ac.pos, ac.trackTrue, ac.gsKt * MS_PER_KT * dt);

  return result;
}
