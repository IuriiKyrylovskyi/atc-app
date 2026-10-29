import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { distanceNm } from '@atc-app/sim';
import {
  buildOpenPack,
  ercLabelStacks,
  ercNavigation,
  ercSectors,
  geoPdfTransform,
  lambertConformalConic,
  lccFromWkt,
  parsePackDefinition,
  type ErcPath,
  type ErcSheet,
  type ErcText,
  type GeoPdfViewport,
} from '../src';

const EC_WKT =
  'PROJCS["EC_Lambert_Conformal_Conic",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],' +
  'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Lambert_Conformal_Conic"],PARAMETER["False_Easting",0.0],' +
  'PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",13.0],PARAMETER["Standard_Parallel_1",42.0],' +
  'PARAMETER["Standard_Parallel_2",57.0],PARAMETER["Latitude_Of_Origin",50.0],UNIT["Meter",1.0]]';

describe('GeoPDF georeference', () => {
  it('matches the published Lambert conformal conic example (Snyder 1987, p. 296)', () => {
    // Clarke 1866, standard parallels 33° / 45°, origin 23°N 96°W: 35°N 75°W.
    const p = lambertConformalConic({ lat0: 23, lon0: -96, sp1: 33, sp2: 45 }, 6378206.4, 1 / 294.9786982);
    const xy = p.forward({ lat: 35, lon: -75 });
    expect(xy.x).toBeCloseTo(1894410.9, 0);
    expect(xy.y).toBeCloseTo(1564649.5, 0);
    const back = p.inverse(xy.x, xy.y);
    expect(back.lat).toBeCloseTo(35, 9);
    expect(back.lon).toBeCloseTo(-75, 9);
  });

  it('reads the EUROCONTROL WKT and fits page → lat / lon through the control points', () => {
    expect(lccFromWkt(EC_WKT)).toMatchObject({ lat0: 50, lon0: 13, sp1: 42, sp2: 57 });
    expect(() => lccFromWkt('PROJCS["x",PROJECTION["Transverse_Mercator"]]')).toThrow(/unsupported/);
    // The real ERC-06 viewport (BBox written top-down, LPTS slightly outside the unit square).
    const vp: GeoPdfViewport = {
      bbox: [84.96483, 2749.7825, 3600.20471, 84.9585],
      gpts: [41.1757, 14.46344, 54.83369, 14.92321, 51.02947, 43.3992, 38.26013, 36.66542],
      lpts: [-0.04158, 0.99694, 0.003, -0.07241, 1.04158, 0.00306, 0.997, 1.07241],
      wkt: EC_WKT,
    };
    const t = geoPdfTransform(vp);
    expect(t.residualM).toBeLessThan(5);
    // Each control point, placed on the page from the top edge of the bbox, lands on its GPTS.
    for (let i = 0; i < 4; i++) {
      const [u, v] = [vp.lpts[2 * i]!, vp.lpts[2 * i + 1]!];
      const ll = t.toLatLon(84.96483 + u * (3600.20471 - 84.96483), 2749.7825 - v * (2749.7825 - 84.9585));
      expect(distanceNm(ll, { lat: vp.gpts[2 * i]!, lon: vp.gpts[2 * i + 1]! })).toBeLessThan(0.01);
    }
  });
});

// ── A synthetic sheet: page unit = 1 km of the projection around 50°N 30°E ──
const proj = lambertConformalConic({ lat0: 50, lon0: 30, sp1: 45, sp2: 55 });
const corners = [[0, 0], [0, 1000], [1000, 1000], [1000, 0]] as const;
const viewport: GeoPdfViewport = {
  bbox: [0, 0, 1000, 1000],
  gpts: corners.flatMap(([x, y]) => {
    const ll = proj.inverse((x - 500) * 1000, (y - 500) * 1000);
    return [ll.lat, ll.lon];
  }),
  lpts: corners.flatMap(([x, y]) => [x / 1000, y / 1000]),
  wkt: EC_WKT.replace('"Central_Meridian",13.0', '"Central_Meridian",30.0')
    .replace('"Standard_Parallel_1",42.0', '"Standard_Parallel_1",45.0')
    .replace('"Standard_Parallel_2",57.0', '"Standard_Parallel_2",55.0'),
};
const square = (x: number, y: number, s: number): ErcPath => ({
  layer: 'ATFM Sector Symbol',
  closed: true,
  pts: [x, y, x + s, y, x + s, y + s, x, y + s],
});
const text = (layer: string, str: string, x: number, y: number, w = str.length * 3): ErcText => ({ layer, str, x, y, w, size: 4.8, angle: 0 });
const ann = 'ATFM Sector Annotation';
const triangle = (x: number, y: number): ErcPath => ({ layer: 'Designated Point Symbol', closed: true, pts: [x - 3, y - 1.7, x + 3, y - 1.7, x, y + 3.4] });
const line = (layer: string, ...pts: number[]): ErcPath => ({ layer, closed: false, pts });

const upper: ErcSheet = {
  sheet: 'erc99h',
  edition: '2026-06-11',
  file: 'erc99h-11jun2026.pdf',
  viewport,
  paths: [
    square(400, 400, 100),
    square(500, 400, 100),
    triangle(420, 300),
    triangle(580, 300),
    line('Designated Point Annotation', 420, 300, 425, 292),
    line('Designated Point Annotation', 580, 300, 585, 292),
    // The route is broken around its label between x 490 and 510.
    line('ATS Route Symbol', 420, 300, 490, 300),
    line('ATS Route Symbol', 510, 300, 580, 300),
  ],
  texts: [
    text(ann, 'TSTAU', 420, 470),
    text(ann, '---------- 355', 420, 465),
    text(ann, 'TSTAL', 420, 460),
    text(ann, 'TSTBN', 520, 470),
    text(ann, 'XXXXQ', 900, 900),
    text('Designated Point Annotation', 'ALPHA', 426, 287),
    text('Designated Point Annotation', 'BRAVO', 586, 287),
    text('ATS Route Annotation', 'L99', 495, 299, 9),
  ],
};
const lower: ErcSheet = {
  ...upper,
  sheet: 'erc99l',
  file: 'erc99l-11jun2026.pdf',
  paths: [square(400, 400, 100), square(500, 400, 100)],
  texts: [text(ann, 'TSTAL', 420, 470), text(ann, 'TSTBN', 520, 470)],
};

describe('ERC importer', () => {
  it('reads label stacks top to bottom with the levels between names', () => {
    const stacks = ercLabelStacks(upper.texts);
    expect(stacks.find((s) => s.names[0] === 'TSTAU')).toMatchObject({ names: ['TSTAU', 'TSTAL'], levels: [355] });
  });

  it('gives each ATFM name its outline and levels, merged across the upper and lower sheets', () => {
    const { areas, warnings } = ercSectors([upper, lower], { prefix: 'TST', label: 'Test ACC', splitFt: 27500 });
    expect(warnings).toEqual([]);
    expect(areas.map((a) => [a.id, a.name, a.floorFt, a.ceilingFt])).toEqual([
      ['TSTAL', 'Test ACC AL', 0, 35500], // lower sheet 0–FL275 + upper FL275–355, same outline
      ['TSTAU', 'Test ACC AU', 35500, 66000],
      ['TSTBN', 'Test ACC BN', 0, 66000],
    ]);
    expect(areas[0]!.polygon).toHaveLength(4);
    expect(areas[0]!.parts).toBeUndefined();
  });

  it('names symbols through their leader lines and joins routes broken around their labels', () => {
    const nav = ercNavigation([upper], () => true);
    expect(nav.points.map((p) => p.id).sort()).toEqual(['ALPHA', 'BRAVO']);
    const alpha = nav.points.find((p) => p.id === 'ALPHA')!.pos;
    const expected = proj.inverse((420 - 500) * 1000, (300 - 500) * 1000);
    expect(distanceNm(alpha, expected)).toBeLessThan(0.01);
    expect(nav.airways).toEqual([{ id: 'L99', segments: [{ from: 'ALPHA', to: 'BRAVO' }] }]);
  });
});

// ── The real ERC-06 extracts and the Kyiv pack definition, if present ───────
const ercDir = fileURLToPath(new URL('../../../db/erc/', import.meta.url));
const oaDir = fileURLToPath(new URL('../../../db/ourairports/', import.meta.url));
const haveKyiv = existsSync(`${ercDir}erc06h.json`) && existsSync(`${ercDir}erc06l.json`) && existsSync(`${oaDir}navaids.csv`);

describe.skipIf(!haveKyiv)('Kyiv pack from ERC-06 (db/erc)', () => {
  // A skipped describe still runs its body to collect tests: read nothing then.
  if (!haveKyiv) return;
  const def = parsePackDefinition(JSON.parse(readFileSync(fileURLToPath(new URL('../../../packs/kyiv.pack.json', import.meta.url)), 'utf8')));
  const sheets = ['erc06h', 'erc06l'].map((s) => JSON.parse(readFileSync(`${ercDir}${s}.json`, 'utf8')) as ErcSheet);
  const r = buildOpenPack(def, {
    ourAirports: {
      airportsCsv: readFileSync(`${oaDir}airports.csv`, 'utf8'),
      runwaysCsv: readFileSync(`${oaDir}runways.csv`, 'utf8'),
      navaidsCsv: readFileSync(`${oaDir}navaids.csv`, 'utf8'),
      retrieved: '2026-10-29',
    },
    erc: sheets,
    retrieved: '2026-10-29',
  });

  it('places chart navaids within a fraction of a mile of their published positions', () => {
    const nav = ercNavigation(sheets, (p) => distanceNm({ lat: 50.345, lon: 30.8947 }, p) < 150);
    const brp = nav.points.find((p) => p.id === 'BRP' && p.kind === 'navaid');
    expect(brp).toBeDefined();
    expect(distanceNm(brp!.pos, r.pack.fixes.find((f) => f.id === 'BRP')!.pos)).toBeLessThan(0.3);
  });

  it('builds a valid development-only pack with Kyiv ACC sectors, points and routes', () => {
    expect(r.validation.ok).toBe(true);
    expect(r.devOnly).toBe(true);
    const areas = r.pack.areas!;
    expect(areas.map((a) => a.id)).toEqual(expect.arrayContaining(['UKBVC', 'UKBVN', 'UKBVM', 'UKBVS', 'UKBVW', 'UKBVTC1', 'UKBVTC2']));
    expect(areas.every((a) => a.kind === 'sector' && a.id.startsWith('UKBV'))).toBe(true);
    expect(areas.find((a) => a.id === 'UKBVC')).toMatchObject({ floorFt: 27500, ceilingFt: 66000 });
    expect(areas.find((a) => a.id === 'UKBVL2')).toMatchObject({ floorFt: 0, ceilingFt: 32500 });
    // Navaids keep OurAirports' kind; waypoints come from the chart.
    expect(r.pack.fixes.find((f) => f.id === 'BRP')).toMatchObject({ kind: 'vor' });
    expect(r.pack.fixes.filter((f) => f.kind === 'waypoint').length).toBeGreaterThan(100);
    const m70 = r.pack.airways!.find((a) => a.id === 'M70');
    expect(m70?.segments.some((s) => s.from === 'SLV' || s.to === 'SLV')).toBe(true);
  });
});
