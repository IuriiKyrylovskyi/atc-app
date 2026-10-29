import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { destination, distanceM, normDeg, type AirspacePack } from '@atc-app/sim';
import {
  buildPack,
  diffPacks,
  importCifpArea,
  parsePackDefinition,
  readCifpRecords,
  sectorArea,
  sectorDefinitionSchema,
  summarizeDiff,
  vatspyRings,
  vatspySource,
  type PackDefinition,
} from '../src';

describe('sector definitions', () => {
  const C = { lat: 40.64, lon: -73.78 };
  const lookup = (id: string) => (id === 'CTR' ? C : id === 'NORTH' ? destination(C, 0, 10 * 1852) : undefined);
  const parse = (s: unknown) => sectorDefinitionSchema.parse(s);

  it('builds a wedge from the centre between two bearings', () => {
    const a = sectorArea(parse({ id: 'E', name: 'East', floorFt: 0, ceilingFt: 17000, wedge: { centre: 'CTR', fromDeg: 30, toDeg: 150, outerNm: 20 } }), lookup);
    expect(a).toMatchObject({ id: 'E', kind: 'sector', name: 'East', floorFt: 0, ceilingFt: 17000 });
    expect(a.polygon[0]).toEqual(C);
    // 120° in 5° steps: 25 arc points after the centre.
    expect(a.polygon).toHaveLength(26);
    for (const p of a.polygon.slice(1)) expect(distanceM(C, p) / 1852).toBeCloseTo(20, 3);
  });

  it('wraps through north, builds rings and full circles', () => {
    const wrap = sectorArea(parse({ id: 'N', name: 'N', floorFt: 0, ceilingFt: 1, wedge: { centre: 'CTR', fromDeg: 330, toDeg: 90, outerNm: 20 } }), lookup);
    expect(wrap.polygon).toHaveLength(26);
    const ring = sectorArea(parse({ id: 'R', name: 'R', floorFt: 0, ceilingFt: 1, wedge: { centre: 'CTR', fromDeg: 0, toDeg: 90, innerNm: 5, outerNm: 20 } }), lookup);
    expect(ring.polygon).toHaveLength(38); // 19 outer + 19 inner points
    const full = sectorArea(parse({ id: 'F', name: 'F', floorFt: 0, ceilingFt: 1, wedge: { centre: 'CTR', fromDeg: 0, toDeg: 360, outerNm: 20 } }), lookup);
    expect(full.polygon).toHaveLength(72);
  });

  it('takes polygons of fixes and coordinates, and rejects bad definitions', () => {
    const p = sectorArea(parse({ id: 'P', name: 'P', floorFt: 0, ceilingFt: 1, polygon: ['CTR', 'NORTH', { lat: 40.7, lon: -73.6 }] }), lookup);
    expect(p.polygon).toHaveLength(3);
    expect(() => sectorArea(parse({ id: 'X', name: 'X', floorFt: 0, ceilingFt: 1, polygon: ['CTR', 'NOPE', 'NORTH'] }), lookup)).toThrow(/unknown point NOPE/);
    expect(sectorDefinitionSchema.safeParse({ id: 'B', name: 'B', floorFt: 5, ceilingFt: 1, polygon: ['CTR', 'NORTH', 'CTR'] }).success).toBe(false);
    expect(sectorDefinitionSchema.safeParse({ id: 'B', name: 'B', floorFt: 0, ceilingFt: 1 }).success).toBe(false);
  });

  it('takes a whole FIR border, or the union of airspace areas clipped to the sector limits', () => {
    const ring = [C, destination(C, 90, 20 * 1852), destination(C, 180, 20 * 1852), C];
    const fir = sectorArea(parse({ id: 'ZNY', name: 'ZNY', floorFt: 0, ceilingFt: 60000, border: 'KZNY', exclude: ['N90'] }), lookup, undefined, (id) =>
      id === 'KZNY' ? ring : undefined
    );
    expect(fir.polygon).toEqual(ring.slice(0, -1)); // GeoJSON closing point dropped
    expect(fir.exclude).toEqual(['N90']);

    const box = (nm: number) => [0, 90, 180, 270].map((b) => destination(C, b, nm * 1852));
    const areas = new Map([
      ['B-A', { id: 'B-A', kind: 'TMA' as const, polygon: box(5), floorFt: 0, ceilingFt: 7000 }],
      ['B-B', { id: 'B-B', kind: 'TMA' as const, polygon: box(10), floorFt: 1500, ceilingFt: 7000 }],
      ['B-C', { id: 'B-C', kind: 'TMA' as const, polygon: box(15), floorFt: 6000, ceilingFt: 7000 }],
    ]);
    const n90 = sectorArea(
      parse({ id: 'N90', name: 'N90', floorFt: 0, ceilingFt: 5000, areas: ['B-A', 'B-B', 'B-C'] }),
      lookup,
      undefined,
      undefined,
      (id) => areas.get(id)
    );
    expect(n90).toMatchObject({ polygon: box(5), floorFt: 0, ceilingFt: 5000 });
    expect(n90.parts).toEqual([{ polygon: box(10), floorFt: 1500, ceilingFt: 5000 }]); // B-C is above 5000 ft
    expect(() => sectorArea(parse({ id: 'X', name: 'X', floorFt: 0, ceilingFt: 1, areas: ['NOPE'] }), lookup)).toThrow(/unknown area NOPE/);
    expect(sectorDefinitionSchema.safeParse({ id: 'X', name: 'X', floorFt: 0, ceilingFt: 1, border: 'A', areas: ['B'] }).success).toBe(false);
  });
});

const fixture = readFileSync(fileURLToPath(new URL('./fixtures/cifp-kjfk-2611.txt', import.meta.url)), 'latin1');
const rec = readCifpRecords(fixture);
const RETRIEVED = '2026-10-28';

const jfk: PackDefinition = parsePackDefinition({ id: 'jfk-test', name: 'JFK test', airports: ['KJFK'], radiusNm: 40 });

// ── OurAirports fixture derived from the CIFP 04L/22R geometry ───────────────
// OurAirports stores physical runway ends + displaced threshold; reproduce that
// from CIFP so the cross-check should find ~0 m differences.
const cifpJfk = importCifpArea(rec, { airports: ['KJFK'], radiusNm: 40, retrieved: RETRIEVED });
const r04l = cifpJfk.runways.find((r) => r.id === '04L')!;
const r22r = cifpJfk.runways.find((r) => r.id === '22R')!;
const le = destination(r04l.threshold, normDeg(r04l.headingTrue + 180), r04l.displacedM ?? 0);
const he = r04l.end;
const vfr = destination(r04l.threshold, 90, 15 * 1852); // 15 NM east
const vfrEnd = destination(vfr, 90, 1000);

const airportsCsv = [
  'id,ident,type,name,latitude_deg,longitude_deg,elevation_ft,continent,iso_country,iso_region,municipality,scheduled_service,icao_code,iata_code,gps_code,local_code',
  `1,KJFK,large_airport,John F Kennedy International Airport,40.639,-73.779,13,NA,US,US-NY,New York,yes,KJFK,JFK,KJFK,JFK`,
  `2,KVFR,medium_airport,VFR Field,${vfr.lat},${vfr.lon},20,NA,US,US-NY,Somewhere,no,KVFR,,KVFR,`,
  `3,KBAD,medium_airport,Bad Data Field,${vfr.lat + 0.05},${vfr.lon},20,NA,US,US-NY,Somewhere,no,KBAD,,KBAD,`,
  `4,KFAR,medium_airport,Far Field,${vfr.lat + 3},${vfr.lon},20,NA,US,US-NY,Far,no,KFAR,,KFAR,`,
  `5,KSML,small_airport,Small Strip,${vfr.lat - 0.05},${vfr.lon},20,NA,US,US-NY,Small,no,KSML,,KSML,`,
].join('\n');
const runwaysCsv = [
  'id,airport_ref,airport_ident,length_ft,width_ft,surface,lighted,closed,le_ident,le_latitude_deg,le_longitude_deg,le_elevation_ft,le_heading_degT,le_displaced_threshold_ft,he_ident,he_latitude_deg,he_longitude_deg,he_elevation_ft,he_heading_degT,he_displaced_threshold_ft',
  `10,1,KJFK,12079,200,ASP,1,0,04L,${le.lat},${le.lon},12,${r04l.headingTrue},460,22R,${he.lat},${he.lon},13,${r22r.headingTrue},${(r22r.displacedM ?? 0) / 0.3048}`,
  `20,2,KVFR,${1000 / 0.3048},100,ASP,1,0,09,${vfr.lat},${vfr.lon},20,90,,27,${vfrEnd.lat},${vfrEnd.lon},20,270,`,
  // 5000 ft claimed, ends only ~1000 m apart → dropped by the builder
  `30,3,KBAD,5000,100,ASP,1,0,09,${vfr.lat + 0.05},${vfr.lon},20,90,,27,${vfrEnd.lat + 0.05},${vfrEnd.lon},20,270,`,
].join('\n');
const ourAirports = { airportsCsv, runwaysCsv, retrieved: RETRIEVED };

describe('pack definitions', () => {
  it('accepts a valid definition and fills defaults', () => {
    const d = parsePackDefinition({ id: 'a-b', name: 'x', airports: ['KJFK'], radiusNm: 30, vfrAirports: { radiusNm: 20 } });
    expect(d.vfrAirports!.types).toEqual(['large_airport', 'medium_airport']);
  });

  it('rejects bad ids, empty airport lists and unknown fields', () => {
    expect(() => parsePackDefinition({ id: 'NY TMA', name: 'x', airports: ['KJFK'], radiusNm: 30 })).toThrow();
    expect(() => parsePackDefinition({ id: 'ny', name: 'x', airports: [], radiusNm: 30 })).toThrow();
    expect(() => parsePackDefinition({ id: 'ny', name: 'x', airports: ['KJFK'], radiusNm: 30, foo: 1 })).toThrow();
  });
});

describe('buildPack', () => {
  it('builds a valid CIFP-only pack', () => {
    const r = buildPack(jfk, { cifp: rec, retrieved: RETRIEVED });
    expect(r.validation.errors).toEqual([]);
    expect(r.pack.meta).toMatchObject({ id: 'jfk-test', airac: '2611', magVar: -13 });
    expect(r.pack.meta.sources.map((s) => s.name)).toEqual(['FAA CIFP AIRAC 2611']);
    expect(r.crossCheck).toBeNull();
  });

  it('cross-checks CIFP thresholds against OurAirports', () => {
    const r = buildPack(jfk, { cifp: rec, ourAirports, retrieved: RETRIEVED });
    expect(r.crossCheck!.compared).toBe(2);
    expect(r.crossCheck!.maxDiffM!).toBeLessThan(0.5);
    expect(r.crossCheck!.missing).toHaveLength(6);
    // OurAirports only used for checking ⇒ not listed as a data source.
    expect(r.pack.meta.sources.map((s) => s.name)).toEqual(['FAA CIFP AIRAC 2611']);
  });

  it('flags runways whose thresholds disagree beyond the limit', () => {
    const shifted = runwaysCsv.replace(`04L,${le.lat}`, `04L,${le.lat + 0.001}`);
    const r = buildPack(jfk, { cifp: rec, ourAirports: { ...ourAirports, runwaysCsv: shifted }, retrieved: RETRIEVED }, { flagAboveM: 50 });
    expect(r.crossCheck!.flagged.map((f) => `${f.airport}/${f.runway}`)).toEqual(['KJFK/04L']);
    expect(r.crossCheck!.flagged[0]!.thresholdDiffM).toBeGreaterThan(100);
  });

  it('adds VFR airports of the right type within range, dropping bad runways', () => {
    const def = parsePackDefinition({ ...jfk, vfrAirports: { radiusNm: 30 } });
    const r = buildPack(def, { cifp: rec, ourAirports, retrieved: RETRIEVED });
    const icaos = r.pack.airports.map((a) => a.icao);
    expect(icaos).toEqual(['KJFK', 'KVFR', 'KBAD']); // KSML is small, KFAR out of range
    expect(r.pack.runways.filter((x) => x.airport === 'KVFR').map((x) => x.id)).toEqual(['09', '27']);
    expect(r.pack.runways.some((x) => x.airport === 'KBAD')).toBe(false);
    expect(r.warnings.some((w) => w.includes('KBAD/09') && w.includes('skipped'))).toBe(true);
    expect(r.pack.meta.sources.map((s) => s.name)).toEqual(['FAA CIFP AIRAC 2611', 'OurAirports']);
    expect(r.validation.errors).toEqual([]);
  });

  it('takes requested airports CIFP does not have from OurAirports', () => {
    const def = parsePackDefinition({ ...jfk, airports: ['KJFK', 'KVFR'] });
    const r = buildPack(def, { cifp: rec, ourAirports, retrieved: RETRIEVED });
    expect(r.pack.airports.map((a) => a.icao)).toEqual(['KJFK', 'KVFR']);
    expect(r.validation.ok).toBe(true);
  });

  it('warns about airports found nowhere', () => {
    const def = parsePackDefinition({ ...jfk, airports: ['KJFK', 'KZZZ'] });
    const r = buildPack(def, { cifp: rec, ourAirports, retrieved: RETRIEVED });
    expect(r.warnings).toContain('KZZZ: in neither CIFP nor OurAirports');
  });
});

describe('diffPacks', () => {
  const base = buildPack(jfk, { cifp: rec, retrieved: RETRIEVED }).pack;
  const clone = (p: AirspacePack): AirspacePack => JSON.parse(JSON.stringify(p));

  it('reports no changes for identical builds', () => {
    const d = diffPacks(base, clone(base));
    expect(d.unchanged).toBe(true);
    expect(summarizeDiff(d)).toBe('AIRAC 2611 → 2611: no changes');
  });

  it('finds added, removed, moved and changed items', () => {
    const next = clone(base);
    next.meta.airac = '2612';
    const moved = next.fixes.find((f) => f.id === 'AROKE')!;
    moved.pos = destination(moved.pos, 0, 20);
    next.fixes = next.fixes.filter((f) => f.id !== 'BARJR');
    next.fixes.push({ id: 'NEWFX', kind: 'waypoint', pos: { lat: 40.5, lon: -73.5 } });
    next.procedures![0]!.legs[0]!.speedKt = 210;
    next.runways = next.runways.filter((r) => r.id !== '31L');

    const d = diffPacks(base, next);
    expect(d.unchanged).toBe(false);
    expect(d.fixes.added).toEqual(['NEWFX']);
    expect(d.fixes.removed).toEqual(['BARJR']);
    expect(d.fixes.moved.map((m) => m.id)).toEqual(['AROKE']);
    expect(d.fixes.moved[0]!.movedM).toBeCloseTo(20, 1);
    expect(d.procedures.changed).toHaveLength(1);
    expect(d.runways.removed).toEqual(['KJFK/31L']);
    expect(summarizeDiff(d)).toMatch(/^AIRAC 2611 → 2612: fixes \+1\/−1\/moved 1 runways \+0\/−1\/~0 procedures \+0\/−0\/~1/);
  });
});

const fullCifp = fileURLToPath(new URL('../../../db/faa-cifp/FAACIFP18', import.meta.url));
const oaDir = fileURLToPath(new URL('../../../db/ourairports/', import.meta.url));
const vatspyFile = fileURLToPath(new URL('../../../db/vatspy/Boundaries.geojson', import.meta.url));
const haveFull = existsSync(fullCifp) && existsSync(`${oaDir}airports.csv`) && existsSync(vatspyFile);

describe.skipIf(!haveFull)('buildPack on the downloaded sources (db/)', () => {
  const rings = haveFull ? vatspyRings(readFileSync(vatspyFile, 'utf8')) : new Map();
  it('builds packs/ny-tma.pack.json: valid, CIFP thresholds within metres of OurAirports', () => {
    const def = parsePackDefinition(
      JSON.parse(readFileSync(fileURLToPath(new URL('../../../packs/ny-tma.pack.json', import.meta.url)), 'utf8'))
    );
    const r = buildPack(def, {
      cifp: readFileSync(fullCifp, 'latin1'),
      ourAirports: {
        airportsCsv: readFileSync(`${oaDir}airports.csv`, 'utf8'),
        runwaysCsv: readFileSync(`${oaDir}runways.csv`, 'utf8'),
        retrieved: RETRIEVED,
      },
      borders: { ring: (id) => rings.get(id), source: vatspySource('test', RETRIEVED) },
      retrieved: RETRIEVED,
    });
    expect(r.validation.errors).toEqual([]);
    expect(r.pack.airports.length).toBeGreaterThanOrEqual(3);
    expect(r.crossCheck!.compared).toBeGreaterThan(20);
    expect(r.crossCheck!.medianDiffM!).toBeLessThan(10);
    // every CIFP runway threshold lies within 1 km of OurAirports' (gross-error guard)
    expect(r.crossCheck!.maxDiffM!).toBeLessThan(1000);
    expect(distanceM(r.pack.meta.reference, r.pack.airports[0]!.arp)).toBe(0);

    // Sectors first, then CIFP airspace. N90 = the 16 Class B sub-areas; ZNY = KZNY minus N90.
    const areas = r.pack.areas!;
    expect(areas.slice(0, 2).map((a) => a.id)).toEqual(['N90', 'ZNY']);
    expect(areas[0]!.parts).toHaveLength(15);
    expect(areas[1]).toMatchObject({ exclude: ['N90'], floorFt: 0, ceilingFt: 60000 });
    expect(areas.filter((a) => a.id.startsWith('KJFK B-'))).toHaveLength(16);
    expect(areas.some((a) => a.kind === 'restricted')).toBe(true);
    expect(r.pack.meta.sources.map((s) => s.licence)).toContain('CC-BY-SA-4.0');
  });
});
