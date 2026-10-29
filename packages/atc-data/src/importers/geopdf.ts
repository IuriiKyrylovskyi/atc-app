/**
 * GeoPDF georeferencing (ISO 32000-2 geospatial: page /VP → /Measure /GCS) for
 * charts drawn in a Lambert conformal conic projection, as EUROCONTROL's ERC
 * GeoPDFs are ("EC_Lambert_Conformal_Conic", WGS 84). Page coordinates →
 * projected metres by an affine fit to the four control points (GPTS / LPTS),
 * then the inverse projection to latitude / longitude.
 */
import type { LatLon } from '@atc-app/sim';

const WGS84_A = 6378137.0;
const WGS84_F = 1 / 298.257223563;
const DEG = Math.PI / 180;

export interface LccParams {
  /** Latitude of origin, central meridian, standard parallels, degrees. */
  lat0: number;
  lon0: number;
  sp1: number;
  sp2: number;
  falseEasting?: number;
  falseNorthing?: number;
}

export interface Projection {
  forward(p: LatLon): { x: number; y: number };
  inverse(x: number, y: number): LatLon;
}

/** Lambert conformal conic, two standard parallels, ellipsoidal (Snyder 1987, §15). */
export function lambertConformalConic(p: LccParams, a = WGS84_A, f = WGS84_F): Projection {
  const e = Math.sqrt(2 * f - f * f);
  const m = (phi: number) => Math.cos(phi) / Math.sqrt(1 - e * e * Math.sin(phi) ** 2);
  const t = (phi: number) => {
    const s = Math.sin(phi);
    return Math.tan(Math.PI / 4 - phi / 2) / ((1 - e * s) / (1 + e * s)) ** (e / 2);
  };
  const [phi1, phi2, phi0, lam0] = [p.sp1 * DEG, p.sp2 * DEG, p.lat0 * DEG, p.lon0 * DEG];
  const n = phi1 === phi2 ? Math.sin(phi1) : (Math.log(m(phi1)) - Math.log(m(phi2))) / (Math.log(t(phi1)) - Math.log(t(phi2)));
  const F = m(phi1) / (n * t(phi1) ** n);
  const rho0 = a * F * t(phi0) ** n;
  const fe = p.falseEasting ?? 0;
  const fn = p.falseNorthing ?? 0;
  return {
    forward({ lat, lon }) {
      const rho = a * F * t(lat * DEG) ** n;
      const theta = n * (lon * DEG - lam0);
      return { x: fe + rho * Math.sin(theta), y: fn + rho0 - rho * Math.cos(theta) };
    },
    inverse(x, y) {
      const dx = x - fe;
      const dy = rho0 - (y - fn);
      const rho = Math.sign(n) * Math.hypot(dx, dy);
      const theta = n > 0 ? Math.atan2(dx, dy) : Math.atan2(-dx, -dy);
      const tt = (rho / (a * F)) ** (1 / n);
      let phi = Math.PI / 2 - 2 * Math.atan(tt);
      for (let i = 0; i < 12; i++) {
        const s = Math.sin(phi);
        phi = Math.PI / 2 - 2 * Math.atan(tt * ((1 - e * s) / (1 + e * s)) ** (e / 2));
      }
      return { lat: phi / DEG, lon: (theta / n + lam0) / DEG };
    },
  };
}

/** LCC parameters from an ESRI / OGC WKT PROJCS (only Lambert_Conformal_Conic on WGS 84). */
export function lccFromWkt(wkt: string): LccParams {
  if (!/PROJECTION\["Lambert_Conformal_Conic(_2SP)?"\]/i.test(wkt)) throw new Error(`unsupported projection: ${wkt.slice(0, 80)}`);
  if (!/WGS_?1984|WGS 84/i.test(wkt)) throw new Error('unsupported datum (WGS 84 only)');
  const param = (...names: string[]) => {
    for (const nm of names) {
      const m = new RegExp(`PARAMETER\\["${nm}",\\s*(-?[\\d.]+)\\]`, 'i').exec(wkt);
      if (m) return Number(m[1]);
    }
    return undefined;
  };
  const need = (v: number | undefined, what: string) => {
    if (v === undefined) throw new Error(`WKT without ${what}`);
    return v;
  };
  return {
    lat0: need(param('Latitude_Of_Origin', 'latitude_of_origin'), 'latitude of origin'),
    lon0: need(param('Central_Meridian', 'central_meridian'), 'central meridian'),
    sp1: need(param('Standard_Parallel_1', 'standard_parallel_1'), 'standard parallel 1'),
    sp2: param('Standard_Parallel_2', 'standard_parallel_2') ?? need(param('Standard_Parallel_1'), 'standard parallel'),
    falseEasting: param('False_Easting', 'false_easting') ?? 0,
    falseNorthing: param('False_Northing', 'false_northing') ?? 0,
  };
}

/** A page viewport's georeference, as stored in the PDF. */
export interface GeoPdfViewport {
  /** /VP /BBox: x1, y1, x2, y2 in page units. */
  bbox: number[];
  /** /Measure /GPTS: lat, lon pairs. */
  gpts: number[];
  /** /Measure /LPTS: x, y pairs in the unit square of the bbox. */
  lpts: number[];
  /** /GCS /WKT. */
  wkt: string;
}

/** Least squares for x·[a b c] ≈ target over (x, y, 1) rows. */
function fitPlane(rows: [number, number][], target: number[]): [number, number, number] {
  const ata = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const atb = [0, 0, 0];
  rows.forEach(([x, y], i) => {
    const r = [x, y, 1];
    for (let a = 0; a < 3; a++) {
      atb[a]! += r[a]! * target[i]!;
      for (let b = 0; b < 3; b++) ata[a]![b]! += r[a]! * r[b]!;
    }
  });
  // Gauss-Jordan on the 3×3 normal equations.
  const m = ata.map((row, i) => [...row, atb[i]!]);
  for (let i = 0; i < 3; i++) {
    let p = i;
    for (let k = i + 1; k < 3; k++) if (Math.abs(m[k]![i]!) > Math.abs(m[p]![i]!)) p = k;
    [m[i], m[p]] = [m[p]!, m[i]!];
    for (let k = 0; k < 3; k++) {
      if (k === i) continue;
      const f = m[k]![i]! / m[i]![i]!;
      for (let c = i; c < 4; c++) m[k]![c]! -= f * m[i]![c]!;
    }
  }
  return [m[0]![3]! / m[0]![0]!, m[1]![3]! / m[1]![1]!, m[2]![3]! / m[2]![2]!];
}

/**
 * Page coordinates → latitude / longitude. The LPTS origin is the bbox's top or
 * bottom edge depending on the writer; both are tried and the better fit kept
 * (`residualM`: worst control point, metres).
 */
export function geoPdfTransform(vp: GeoPdfViewport): { toLatLon(x: number, y: number): LatLon; residualM: number } {
  const proj = lambertConformalConic(lccFromWkt(vp.wkt));
  const [x1, y1, x2, y2] = vp.bbox as [number, number, number, number];
  const [xl, xh, yl, yh] = [Math.min(x1, x2), Math.max(x1, x2), Math.min(y1, y2), Math.max(y1, y2)];
  const control = Array.from({ length: vp.gpts.length / 2 }, (_, i) => ({
    ll: { lat: vp.gpts[2 * i]!, lon: vp.gpts[2 * i + 1]! },
    u: vp.lpts[2 * i]!,
    v: vp.lpts[2 * i + 1]!,
  }));
  let best: { residualM: number; ex: [number, number, number]; ny: [number, number, number] } | null = null;
  for (const fromTop of [false, true]) {
    const rows = control.map((c): [number, number] => [xl + c.u * (xh - xl), fromTop ? yh - c.v * (yh - yl) : yl + c.v * (yh - yl)]);
    const xy = control.map((c) => proj.forward(c.ll));
    const ex = fitPlane(rows, xy.map((p) => p.x));
    const ny = fitPlane(rows, xy.map((p) => p.y));
    const residualM = Math.max(
      ...rows.map(([x, y], i) => Math.hypot(ex[0] * x + ex[1] * y + ex[2] - xy[i]!.x, ny[0] * x + ny[1] * y + ny[2] - xy[i]!.y))
    );
    if (!best || residualM < best.residualM) best = { residualM, ex, ny };
  }
  const { ex, ny, residualM } = best!;
  return {
    toLatLon: (x, y) => proj.inverse(ex[0] * x + ex[1] * y + ex[2], ny[0] * x + ny[1] * y + ny[2]),
    residualM,
  };
}
