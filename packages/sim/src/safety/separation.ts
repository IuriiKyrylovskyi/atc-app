/**
 * Separation monitor and short-term conflict alert (STCA).
 *
 * Minima default to terminal radar separation: 3 NM lateral or 1 000 ft
 * vertical (FAA JO 7110.65 §5-5-4; ICAO Doc 4444 §8.7.3 allows 3 NM in
 * approach). A pair has lost separation when it is inside both at once.
 *
 * STCA prediction extrapolates both aircraft linearly (ground track and speed;
 * vertical rate until the cleared level, as modern STCA does with the
 * controller-entered CFL) and alerts when a loss is predicted within the
 * look-ahead. Lateral geometry is a local flat-earth approximation, which is
 * well under 0.1 % off over the few tens of NM that matter here.
 *
 * PAID-ALT: EUROCONTROL STCA reference implementation / ARTAS-class tracker.
 *   Why better: tuned alert logic (linear + current-turn prediction, fine
 *   filters per airspace), validated against operational data.
 *   Price: licence through EUROCONTROL / industry vendors — quote required.
 */
import type { AircraftState, Conflict } from '../model/types';

export interface SeparationConfig {
  lateralNm: number;
  verticalFt: number;
  /** STCA look-ahead, s. */
  lookaheadS: number;
}

export const TERMINAL_SEPARATION: SeparationConfig = { lateralNm: 3, verticalFt: 1000, lookaheadS: 120 };

/** Prediction sample step, s. */
const STEP_S = 2;
const NM_PER_DEG_LAT = 60;
const DEG = Math.PI / 180;

export interface PairGeometry {
  /** Separation lost right now. */
  loss: boolean;
  /** Seconds until a predicted loss (0 when lost now); null = none within look-ahead. */
  inS: number | null;
  lateralNm: number;
  verticalFt: number;
}

/** Altitude after `t` s: current vertical rate, stopping at the cleared level. */
function altitudeAt(ac: AircraftState, t: number): number {
  const z = ac.altFt + (ac.vsFpm / 60) * t;
  const target = ac.target.altFt;
  if (ac.vsFpm > 0) return Math.min(z, Math.max(target, ac.altFt));
  if (ac.vsFpm < 0) return Math.max(z, Math.min(target, ac.altFt));
  return ac.altFt;
}

/** Ground velocity in NM/s, (east, north). */
const velocity = (ac: AircraftState) => {
  const v = ac.gsKt / 3600;
  return { x: v * Math.sin(ac.trackTrue * DEG), y: v * Math.cos(ac.trackTrue * DEG) };
};

/** Current geometry and STCA prediction for one pair. */
export function assessPair(a: AircraftState, b: AircraftState, cfg: SeparationConfig = TERMINAL_SEPARATION): PairGeometry {
  const cosLat = Math.cos(((a.pos.lat + b.pos.lat) / 2) * DEG);
  const px = (b.pos.lon - a.pos.lon) * NM_PER_DEG_LAT * cosLat;
  const py = (b.pos.lat - a.pos.lat) * NM_PER_DEG_LAT;
  const lateralNm = Math.hypot(px, py);
  const verticalFt = Math.abs(b.altFt - a.altFt);
  const loss = lateralNm < cfg.lateralNm && verticalFt < cfg.verticalFt;
  if (loss) return { loss, inS: 0, lateralNm, verticalFt };

  const va = velocity(a);
  const vb = velocity(b);
  const vx = vb.x - va.x;
  const vy = vb.y - va.y;
  // Cheap reject: even closing head-on for the whole look-ahead they stay apart.
  if (lateralNm - Math.hypot(vx, vy) * cfg.lookaheadS >= cfg.lateralNm) {
    return { loss, inS: null, lateralNm, verticalFt };
  }
  for (let t = STEP_S; t <= cfg.lookaheadS; t += STEP_S) {
    const d = Math.hypot(px + vx * t, py + vy * t);
    if (d >= cfg.lateralNm) continue;
    if (Math.abs(altitudeAt(b, t) - altitudeAt(a, t)) < cfg.verticalFt) {
      return { loss, inS: t, lateralNm, verticalFt };
    }
  }
  return { loss, inS: null, lateralNm, verticalFt };
}

/** Persistent per-pair monitor state (part of the saved sim state). */
export interface PairState {
  a: string;
  b: string;
  alertSince: number;
  lossSince: number | null;
  /** Last time the pair was lost or predicted to lose separation. */
  lastActive: number;
  minLateralNm: number;
  minVerticalFt: number;
  current: Conflict;
}

/** An alert stays up this long after the prediction clears (no flicker). */
export const ALERT_HOLD_S = 6;

export const pairKey = (x: string, y: string): [string, string] => (x < y ? [x, y] : [y, x]);
