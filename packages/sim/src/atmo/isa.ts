/**
 * ICAO Standard Atmosphere (Doc 7488) up to 32 km, plus airspeed conversions.
 *
 * Altitudes passed in are **pressure altitudes** (what aircraft fly and what the
 * scope shows), treated as geopotential — the standard aviation simplification.
 * A temperature deviation (ISA + ΔT) changes temperature, density and speed of
 * sound; pressure at a pressure altitude is unchanged by definition.
 *
 * Free formulas, no paid alternative needed. (Real-world temperature/wind aloft
 * come later from the weather layer.)
 */
import { G0, M_PER_FT, MS_PER_KT } from '../units';

/** Specific gas constant for dry air, J/(kg·K). */
export const R_AIR = 287.05287;
export const GAMMA = 1.4;
export const T0 = 288.15;
export const P0 = 101_325;
export const RHO0 = 1.225;
/** Sea-level speed of sound, m/s. */
export const A0 = Math.sqrt(GAMMA * R_AIR * T0);

interface Layer {
  baseM: number;
  baseT: number;
  baseP: number;
  /** Temperature lapse rate, K/m. */
  lapse: number;
}

const LAYERS: Layer[] = [
  { baseM: 0, baseT: 288.15, baseP: 101_325, lapse: -0.0065 },
  { baseM: 11_000, baseT: 216.65, baseP: 22_632.06, lapse: 0 },
  { baseM: 20_000, baseT: 216.65, baseP: 5_474.889, lapse: 0.001 },
];
const TOP_M = 32_000;

function layerAt(hM: number): Layer {
  let layer = LAYERS[0]!;
  for (const l of LAYERS) if (hM >= l.baseM) layer = l;
  return layer;
}

export interface AtmosphereState {
  /** Kelvin (including ΔISA). */
  temperature: number;
  /** Pascal. */
  pressure: number;
  /** kg/m³. */
  density: number;
  /** Speed of sound, m/s. */
  speedOfSound: number;
}

/** Atmosphere at a pressure altitude (ft). `deltaIsaK` shifts temperature. */
export function atmosphere(altitudeFt: number, deltaIsaK = 0): AtmosphereState {
  const hM = Math.min(Math.max(altitudeFt * M_PER_FT, -610), TOP_M);
  const l = layerAt(hM);
  const dh = hM - l.baseM;
  const tIsa = l.baseT + l.lapse * dh;
  const pressure =
    l.lapse === 0
      ? l.baseP * Math.exp((-G0 * dh) / (R_AIR * l.baseT))
      : l.baseP * Math.pow(tIsa / l.baseT, -G0 / (l.lapse * R_AIR));
  const temperature = tIsa + deltaIsaK;
  return {
    temperature,
    pressure,
    density: pressure / (R_AIR * temperature),
    speedOfSound: Math.sqrt(GAMMA * R_AIR * temperature),
  };
}

/** Impact pressure for a calibrated airspeed (subsonic, compressible). */
function impactPressureFromCas(casMs: number): number {
  return P0 * (Math.pow(1 + 0.2 * (casMs / A0) ** 2, 3.5) - 1);
}

/** CAS (kt) → Mach at a pressure altitude. */
export function casToMach(casKt: number, altitudeFt: number): number {
  const { pressure } = atmosphere(altitudeFt);
  const qc = impactPressureFromCas(casKt * MS_PER_KT);
  return Math.sqrt(5 * (Math.pow(qc / pressure + 1, 2 / 7) - 1));
}

/** Mach → CAS (kt) at a pressure altitude. */
export function machToCas(mach: number, altitudeFt: number): number {
  const { pressure } = atmosphere(altitudeFt);
  const qc = pressure * (Math.pow(1 + 0.2 * mach * mach, 3.5) - 1);
  return (A0 * Math.sqrt(5 * (Math.pow(qc / P0 + 1, 2 / 7) - 1))) / MS_PER_KT;
}

/** Mach → TAS (kt). */
export function machToTas(mach: number, altitudeFt: number, deltaIsaK = 0): number {
  return (mach * atmosphere(altitudeFt, deltaIsaK).speedOfSound) / MS_PER_KT;
}

/** TAS (kt) → Mach. */
export function tasToMach(tasKt: number, altitudeFt: number, deltaIsaK = 0): number {
  return (tasKt * MS_PER_KT) / atmosphere(altitudeFt, deltaIsaK).speedOfSound;
}

/** CAS (kt) → TAS (kt). */
export function casToTas(casKt: number, altitudeFt: number, deltaIsaK = 0): number {
  return machToTas(casToMach(casKt, altitudeFt), altitudeFt, deltaIsaK);
}

/** TAS (kt) → CAS (kt). */
export function tasToCas(tasKt: number, altitudeFt: number, deltaIsaK = 0): number {
  return machToCas(tasToMach(tasKt, altitudeFt, deltaIsaK), altitudeFt);
}

/**
 * Crossover altitude (ft): where flying `casKt` gives exactly `mach`. Above it an
 * aircraft holding that speed schedule flies Mach, below it CAS.
 */
export function crossoverAltitudeFt(casKt: number, mach: number): number {
  let lo = 0;
  let hi = TOP_M / M_PER_FT;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (casToMach(casKt, mid) < mach) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
