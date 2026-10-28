/** Unit conversions and physical constants used across the simulator (SI inside, aviation units at the edges). */

export const M_PER_NM = 1852;
export const M_PER_FT = 0.3048;
export const MS_PER_KT = 1852 / 3600;
export const FPM_PER_MS = 60 / M_PER_FT;

/** Standard gravity, m/s². */
export const G0 = 9.80665;

export const DEG = Math.PI / 180;

export const nmToM = (nm: number): number => nm * M_PER_NM;
export const mToNm = (m: number): number => m / M_PER_NM;
export const ftToM = (ft: number): number => ft * M_PER_FT;
export const mToFt = (m: number): number => m / M_PER_FT;
export const ktToMs = (kt: number): number => kt * MS_PER_KT;
export const msToKt = (ms: number): number => ms / MS_PER_KT;
export const fpmToMs = (fpm: number): number => fpm / FPM_PER_MS;
export const msToFpm = (ms: number): number => ms * FPM_PER_MS;

/** Flight level → feet (FL350 → 35000). */
export const flToFt = (fl: number): number => fl * 100;
export const ftToFl = (ft: number): number => ft / 100;

/** Normalises an angle to [0, 360). */
export function normDeg(deg: number): number {
  const d = deg % 360;
  return d < 0 ? d + 360 : d;
}

/** Signed smallest difference `to − from` in degrees, in (−180, 180]. */
export function angleDiffDeg(from: number, to: number): number {
  let d = normDeg(to) - normDeg(from);
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}
