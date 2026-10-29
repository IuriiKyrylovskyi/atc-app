import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { courseTo, declinationDeg, distanceNm, normDeg } from '@atc-app/sim';
import {
  airacOf,
  alongBorder,
  buildOpenPack,
  eaipRows,
  importEaipNavaids,
  importEaipPoints,
  importEaipRoutes,
  parseDms,
  parsePackDefinition,
  sectorArea,
  sectorDefinitionSchema,
} from '../src';

/** eAIP value span + hidden AIXM parameter span, as the pages publish them. */
const sd = (v: string, p: string) => `<span class="SD">${v}</span><span class="sdParams" style="display: none;">${p}</span>`;

describe('eAIP tables', () => {
  it('parses coordinates in both published forms', () => {
    expect(parseDms('135337N 1003546E')).toEqual({ lat: 13 + 53 / 60 + 37 / 3600, lon: 100 + 35 / 60 + 46 / 3600 });
    const p = parseDms('135452.0N1003620.0E')!;
    expect(p.lat).toBeCloseTo(13.914444, 6);
    expect(parseDms('nope')).toBeNull();
  });

  it('drops hidden parameter spans, even when their opening tag is malformed', () => {
    // Thailand ENR 4.1 (BRM): `<span class="sdParams" style="display: none;"TVOR;GEO_LAT;87</span>`.
    const html = `<table><tr><td>${sd('BURI RAM', 'TVOR;TXT_NAME;87')} DVOR/DME</td><td>${sd('BRM', 'TVOR;CODE_ID;87')}</td>` +
      `<td>117.2</td><td>H24</td><td><span class="SD">151422N</span><span class="sdParams" style="display: none;"TVOR;GEO_LAT;87</span> ` +
      `${sd('1031532E', 'TNAVAID;GEO_LONG;117')}</td></tr></table>`;
    expect(eaipRows(html)[0]).toEqual(['BURI RAM DVOR/DME', 'BRM', '117.2', 'H24', '151422N 1031532E']);
    expect(importEaipNavaids(html)).toEqual([{ id: 'BRM', kind: 'vor', pos: parseDms('151422N 1031532E') }]);
  });

  it('reads points (ENR 4.4) and routes (ENR 3.x) as fix sequences', () => {
    const points = `<table><tr><td>${sd('ROBKA', 'TDESIGNATED_POINT;CODE_ID;235')}</td><td>${sd('141043N', 'x')} ${sd('1012508E', 'y')}</td><td>A1</td></tr>
      <tr><td>Name-code designator</td><td>Co-ordinates</td></tr></table>`;
    expect(importEaipPoints(points)).toEqual([{ id: 'ROBKA', kind: 'waypoint', pos: parseDms('141043N 1012508E') }]);

    const route = `<table>
      <tr><td>${sd('A1', 'TEN_ROUTE_RTE;TXT_DESIG;114')}</td><td>Route availability: (1) H24</td></tr>
      <tr><td>▲</td><td>BANGKOK DVOR/DME ( ${sd('BKK', 'TVOR;CODE_ID;86')} )</td><td>135337N 1003546E</td><td></td><td></td></tr>
      <tr><td></td><td>071 °</td></tr>
      <tr><td>▲</td><td>${sd('ROBKA', 'p')}</td><td>141043N 1012508E</td><td></td><td></td></tr>
      <tr><td>▲</td><td>${sd('SELKA', 'p')}</td><td>142020N 1015311E</td><td></td><td></td></tr>
      <tr><td>${sd('W1', 'TEN_ROUTE_RTE;TXT_DESIG;2')}</td><td>Route availability: (1) H24</td></tr>
      <tr><td>△</td><td>${sd('SELKA', 'p')}</td><td>142020N 1015311E</td><td></td><td></td></tr>
      <tr><td>△</td><td>${sd('TOPER', 'p')}</td><td>143000N 1020000E</td><td></td><td></td></tr>
    </table>`;
    const r = importEaipRoutes(route);
    expect(r.airways).toEqual([
      { id: 'A1', segments: [{ from: 'BKK', to: 'ROBKA' }, { from: 'ROBKA', to: 'SELKA' }] },
      { id: 'W1', segments: [{ from: 'SELKA', to: 'TOPER' }] },
    ]);
    expect(r.points.map((p) => [p.id, p.kind])).toEqual([['BKK', 'vor'], ['ROBKA', 'waypoint'], ['SELKA', 'waypoint'], ['TOPER', 'waypoint']]);
  });
});

describe('AIP sector boundaries', () => {
  const VTBD = { lat: 13.914444, lon: 100.605556 };
  const BKK = parseDms('135337N 1003546E')!;
  const lookup = (id: string) => (id === 'BKK' ? BKK : undefined);
  const date = new Date('2026-10-29T00:00:00Z');

  it('places radial / DME points with the magnetic variation applied', () => {
    const s = sectorDefinitionSchema.parse({
      id: 'T', name: 'T', floorFt: 0, ceilingFt: 1,
      boundary: [{ dms: '135452N 1003620E' }, { radial: 'BKK', deg: 35, nm: 51.3 }, { radial: 'BKK', deg: 100, nm: 50.3 }],
    });
    const a = sectorArea(s, lookup, date);
    const p = a.polygon[1]!;
    expect(distanceNm(BKK, p)).toBeCloseTo(51.3, 2);
    expect(normDeg(courseTo(BKK, p) - declinationDeg(BKK, date))).toBeCloseTo(35, 1);
  });

  it('follows a clockwise arc between published points', () => {
    const s = sectorDefinitionSchema.parse({
      id: 'PIE', name: 'pie', floorFt: 0, ceilingFt: 16000, exclude: ['ARR'],
      boundary: [
        { dms: '135452N 1003620E' },
        { radial: 'BKK', deg: 35, nm: 51.3 },
        { arc: { centre: { dms: '135452N 1003620E' }, radiusNm: 50, dir: 'cw' }, to: { radial: 'BKK', deg: 100, nm: 50.3 } },
      ],
    });
    const a = sectorArea(s, lookup, date);
    expect(a.exclude).toEqual(['ARR']);
    // ~65° of arc in 5° steps: start + 13 intermediate + end + centre.
    expect(a.polygon.length).toBeGreaterThan(12);
    for (const p of a.polygon.slice(2, -1)) expect(distanceNm(VTBD, p)).toBeCloseTo(50, 1);
    // Clockwise from NE to E: every arc point east of the centre.
    for (const p of a.polygon.slice(1)) expect(p.lon).toBeGreaterThan(VTBD.lon);
  });

  it('rejects definitions with two shapes or an arc without a start', () => {
    expect(sectorDefinitionSchema.safeParse({ id: 'X', name: 'x', floorFt: 0, ceilingFt: 1, polygon: ['A', 'B', 'C'], boundary: ['A', 'B', 'C'] }).success).toBe(false);
    const s = sectorDefinitionSchema.parse({
      id: 'X', name: 'x', floorFt: 0, ceilingFt: 1,
      boundary: [{ arc: { centre: 'BKK', radiusNm: 5, dir: 'cw' }, to: 'BKK' }, 'BKK', 'BKK'],
    });
    expect(() => sectorArea(s, lookup, date)).toThrow(/arc needs a previous point/);
  });

  // A 4 × 4° "FIR" drawn counter-clockwise (as GeoJSON may give it), corners on the degree.
  const FIR = [
    { lat: 10, lon: 100 }, { lat: 10, lon: 104 }, { lat: 14, lon: 104 }, { lat: 14, lon: 100 }, { lat: 10, lon: 100 },
  ];

  it('walks a FIR border clockwise or counter-clockwise between two points on it', () => {
    const west = { lat: 12, lon: 100 };
    const north = { lat: 14, lon: 102 };
    // Clockwise from the west side to the north side: through the NW corner only.
    expect(alongBorder(FIR, west, north, 'cw')).toEqual([{ lat: 14, lon: 100 }]);
    // The other way round: SW, SE, NE corners.
    expect(alongBorder(FIR, west, north, 'ccw')).toEqual([{ lat: 10, lon: 100 }, { lat: 10, lon: 104 }, { lat: 14, lon: 104 }]);
    // Same side, no corner in between.
    expect(alongBorder(FIR, west, { lat: 13, lon: 100 }, 'cw')).toEqual([]);
  });

  it('builds "along" steps and extra volumes (parts) from the border source', () => {
    const s = sectorDefinitionSchema.parse({
      id: 'NW', name: 'nw', floorFt: 0, ceilingFt: 46000,
      boundary: [{ dms: '120000N 1000000E' }, { along: 'TEST', dir: 'cw', to: { dms: '140000N 1020000E' } }, { dms: '120000N 1020000E' }],
      parts: [{ boundary: [{ dms: '100000N 1000000E' }, { dms: '110000N 1000000E' }, { dms: '110000N 1010000E' }], floorFt: 0, ceilingFt: 27000 }],
    });
    const a = sectorArea(s, lookup, date, (id) => (id === 'TEST' ? FIR : undefined));
    expect(a.polygon).toEqual([{ lat: 12, lon: 100 }, { lat: 14, lon: 100 }, { lat: 14, lon: 102 }, { lat: 12, lon: 102 }]);
    expect(a.parts).toEqual([{ polygon: [{ lat: 10, lon: 100 }, { lat: 11, lon: 100 }, { lat: 11, lon: 101 }], floorFt: 0, ceilingFt: 27000 }]);
    expect(() => sectorArea(s, lookup, date)).toThrow(/no border "TEST"/);
  });
});

describe('AIRAC cycles', () => {
  it('numbers 28-day cycles within the year', () => {
    expect(airacOf('2026-01-22')).toBe('2601');
    expect(airacOf('2026-10-29')).toBe('2611');
    expect(airacOf('2026-11-25')).toBe('2611');
    expect(airacOf('2026-11-26')).toBe('2612');
    expect(airacOf('2026-12-31')).toBe('2613');
    expect(airacOf('2027-01-21')).toBe('2701');
  });
});

// ── The real Thai eAIP and the Bangkok pack definition, if downloaded ───────
const eaipDir = fileURLToPath(new URL('../../../db/eaip-th/', import.meta.url));
const oaDir = fileURLToPath(new URL('../../../db/ourairports/', import.meta.url));
const edition = existsSync(eaipDir) ? readdirSync(eaipDir).filter((d) => /^\d{4}-/.test(d)).sort().pop() : undefined;
const vatspyFile = fileURLToPath(new URL('../../../db/vatspy/Boundaries.geojson', import.meta.url));

const haveBangkok = !!edition && existsSync(`${oaDir}airports.csv`) && existsSync(vatspyFile);

describe.skipIf(!haveBangkok)('Bangkok pack from the Thai eAIP (db/)', () => {
  // A skipped describe still runs its body to collect tests: read nothing then.
  if (!haveBangkok) return;
  const page = (p: string) => readFileSync(`${eaipDir}${edition}/VT-${p}-en-GB.html`, 'utf8');
  const def = parsePackDefinition(JSON.parse(readFileSync(fileURLToPath(new URL('../../../packs/bangkok.pack.json', import.meta.url)), 'utf8')));
  const geo = JSON.parse(readFileSync(vatspyFile, 'utf8')) as {
    features: { properties: { id?: string }; geometry: { type: string; coordinates: number[][][][] } }[];
  };
  const vtbb = geo.features.find((f) => f.properties.id === 'VTBB')!;
  const outer = (vtbb.geometry.type === 'Polygon' ? vtbb.geometry.coordinates[0]! : vtbb.geometry.coordinates[0]![0]!) as unknown as number[][];
  const VTBB = outer.map(([lon, lat]) => ({ lat: lat!, lon: lon! }));
  const r = buildOpenPack(def, {
    ourAirports: {
      airportsCsv: readFileSync(`${oaDir}airports.csv`, 'utf8'),
      runwaysCsv: readFileSync(`${oaDir}runways.csv`, 'utf8'),
      retrieved: edition!,
    },
    eaip: { edition: edition!, stateName: 'Thailand', url: '', enr31: page('ENR-3.1'), enr33: page('ENR-3.3'), enr41: page('ENR-4.1'), enr44: page('ENR-4.4') },
    borders: {
      ring: (id) => (id === 'VTBB' ? VTBB : undefined),
      source: { name: 'VATSpy data project FIR borders', licence: 'CC-BY-SA-4.0', url: '', retrieved: edition! },
    },
    retrieved: edition!,
  });

  it('builds a valid development-only pack with points, navaids, routes and sectors', () => {
    expect(r.validation.ok).toBe(true);
    expect(r.devOnly).toBe(true);
    expect(r.pack.airports.map((a) => a.icao)).toEqual(expect.arrayContaining(['VTBS', 'VTBD']));
    expect(r.pack.fixes.find((f) => f.id === 'BKK')).toMatchObject({ kind: 'vor' });
    expect(r.pack.airways!.some((a) => a.id === 'A1')).toBe(true);
    expect(r.pack.areas!.map((a) => a.id)).toEqual([
      'DSB', 'ARR', 'DDP', 'DAR', 'APE1', 'APE2', 'APS1', 'APS2', 'APW', 'APN',
      '1N', '2N', '3N', '4N', '5N', '6N', '1S', '2S', '3S', '4S', '5S', '6S',
    ]);
    expect(r.pack.meta.sources.some((s) => s.licence === 'CC-BY-SA-4.0')).toBe(true);
  });

  it('tiles the FIR with the twelve ACC sectors at FL300 (along-border stretches from VATSpy)', () => {
    // Planar area in NM², good enough to catch a sector walking the wrong way round the border.
    const nm2 = (ring: readonly { lat: number; lon: number }[]) => {
      let a = 0;
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i]!;
        const q = ring[(i + 1) % ring.length]!;
        const k = Math.cos((((p.lat + q.lat) / 2) * Math.PI) / 180);
        a += (p.lon * k * q.lat - q.lon * k * p.lat) * 3600;
      }
      return Math.abs(a / 2);
    };
    const acc = r.pack.areas!.filter((a) => /^\d[NS]$/.test(a.id) && a.floorFt <= 30000 && a.ceilingFt > 30000);
    expect(acc).toHaveLength(12);
    const sum = acc.reduce((s, a) => s + nm2(a.polygon), 0);
    expect(sum / nm2(VTBB)).toBeGreaterThan(0.97);
    expect(sum / nm2(VTBB)).toBeLessThan(1.03);
    // Below FL270, 3S and 6S also take the 2S footprint.
    for (const id of ['3S', '6S']) expect(r.pack.areas!.find((a) => a.id === id)!.parts).toHaveLength(1);
  });

  it('closes the TMA ring: the six approach pies meet on the 50 NM arc', () => {
    const pies = ['APE1', 'APE2', 'APS1', 'APS2', 'APW', 'APN'].map((id) => r.pack.areas!.find((a) => a.id === id)!);
    const VTBD = { lat: 13.914444, lon: 100.605556 };
    for (const p of pies) {
      const far = Math.max(...p.polygon.map((q) => distanceNm(VTBD, q)));
      expect(far).toBeGreaterThan(49);
      expect(far).toBeLessThan(52);
    }
  });
});
