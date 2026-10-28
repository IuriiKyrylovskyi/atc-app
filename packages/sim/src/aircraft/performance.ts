/**
 * Aircraft performance used by the flight model.
 *
 * Phase 0 ships one generic profile per wake category so the sim runs before the
 * performance database exists. Phase 1 replaces it with per-type data exported
 * from OpenAP (TU Delft, open source): altitude-dependent climb/descent rates,
 * speed schedules, accel/decel, approach speeds.
 *
 * PAID-ALT: EUROCONTROL BADA (Base of Aircraft Data) 3 / 4.
 *   Why better: industry-standard model used by ATC simulators, hundreds of types,
 *   validated thrust/drag/fuel, BADA 4 accurate across the whole envelope.
 *   Price: licence agreement with EUROCONTROL; terms restrict distribution inside
 *   a consumer app — quote/agreement required (consider for the Academy edition).
 */
import type { WakeCategory } from '../model/types';

export interface PerformanceProfile {
  /** Typical climb rate below FL100 / above, ft/min. */
  climbFpmLow: number;
  climbFpmHigh: number;
  /** Typical descent rate, ft/min. */
  descentFpm: number;
  accelKtPerS: number;
  decelKtPerS: number;
  maxBankDeg: number;
  minCasKt: number;
  maxCasKt: number;
  maxMach: number;
  ceilingFt: number;
  /** Final approach speed (Vapp), kt CAS. */
  approachKt: number;
}

const GENERIC: Record<WakeCategory, PerformanceProfile> = {
  L: {
    climbFpmLow: 900, climbFpmHigh: 600, descentFpm: 800, accelKtPerS: 1.0, decelKtPerS: 1.0,
    maxBankDeg: 30, minCasKt: 70, maxCasKt: 200, maxMach: 0.5, ceilingFt: 25_000, approachKt: 90,
  },
  M: {
    climbFpmLow: 2500, climbFpmHigh: 1500, descentFpm: 2000, accelKtPerS: 1.2, decelKtPerS: 0.8,
    maxBankDeg: 25, minCasKt: 130, maxCasKt: 340, maxMach: 0.82, ceilingFt: 41_000, approachKt: 140,
  },
  H: {
    climbFpmLow: 2000, climbFpmHigh: 1200, descentFpm: 2000, accelKtPerS: 1.0, decelKtPerS: 0.7,
    maxBankDeg: 25, minCasKt: 140, maxCasKt: 340, maxMach: 0.86, ceilingFt: 43_000, approachKt: 150,
  },
  J: {
    climbFpmLow: 1800, climbFpmHigh: 1000, descentFpm: 1800, accelKtPerS: 0.9, decelKtPerS: 0.6,
    maxBankDeg: 25, minCasKt: 150, maxCasKt: 340, maxMach: 0.87, ceilingFt: 43_000, approachKt: 155,
  },
};

/** Performance for a type. Phase 0: generic by wake category. */
export function performanceFor(_icaoType: string, wake: WakeCategory): PerformanceProfile {
  return GENERIC[wake];
}
