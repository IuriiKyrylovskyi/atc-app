import { describe, expect, it } from 'vitest';
import { destination, distanceM, type AirspacePack } from '@atc-app/sim';
import {
  airspacePackJsonSchema,
  importOurAirports,
  parseCsv,
  parseCsvRecords,
  validatePack,
} from '../src';

// ── Synthetic OurAirports fixture ────────────────────────────────────────────
// KTST at 40N 74W with runway 04/22: 3000 m long, true heading 040°, 500 ft
// displaced threshold on 04. Positions are computed, so expectations are exact.
const LE = { lat: 40, lon: -74 };
const HE = destination(LE, 40, 3000);
const LENGTH_FT = 3000 / 0.3048;

const airportsCsv = [
  '"id","ident","type","name","latitude_deg","longitude_deg","elevation_ft","continent","iso_country","iso_region","municipality","scheduled_service","icao_code","iata_code","gps_code","local_code"',
  '1,"KTST","large_airport","Test ""Intl"" Airport",40.0,-74.0,13,"NA","US","US-NY","Test","yes","KTST","TST","KTST","TST"',
  '2,"KOTH","medium_airport","Other Field",41.0,-73.0,100,"NA","US","US-CT","Other","no","KOTH","","KOTH",""',
  '3,"US-0001","heliport","Some Heliport",40.1,-74.1,10,"NA","US","US-NY","Heli","no","","","",""',
  '4,"KNOP","small_airport","No Position",,,50,"NA","US","US-NY","Nowhere","no","KNOP","","KNOP",""',
].join('\n');

const runwaysCsv = [
  '"id","airport_ref","airport_ident","length_ft","width_ft","surface","lighted","closed","le_ident","le_latitude_deg","le_longitude_deg","le_elevation_ft","le_heading_degT","le_displaced_threshold_ft","he_ident","he_latitude_deg","he_longitude_deg","he_elevation_ft","he_heading_degT","he_displaced_threshold_ft"',
  `10,1,"KTST",${LENGTH_FT},148,"ASP",1,0,"04",${LE.lat},${LE.lon},12,40,500,"22",${HE.lat},${HE.lon},14,220,`,
  `11,1,"KTST",5000,100,"ASP",1,1,"13",40.01,-74.01,12,,,"31",40.02,-74.02,14,,`,
  `12,1,"KTST",4000,,"ASP",1,0,"18",,,12,,,"36",40.03,-74.03,14,,`,
  // 6000 ft = 1829 m east-west at 41N ≈ 0.02177° of longitude.
  `13,2,"KOTH",6000,150,"ASP",1,0,"09",41.0,-73.010886,100,,,"27",41.0,-72.989114,100,,`,
].join('\r\n');

const imported = importOurAirports({ airportsCsv, runwaysCsv, retrieved: '2026-10-28' });

function packFrom(over: Partial<AirspacePack> = {}): AirspacePack {
  return {
    meta: {
      id: 'TEST',
      name: 'Test pack',
      airac: '2611',
      reference: LE,
      magVar: -13,
      sources: [imported.source],
    },
    airports: imported.airports,
    runways: imported.runways,
    fixes: [{ id: 'ALPHA', kind: 'waypoint', pos: { lat: 40.2, lon: -74.2 } }],
    ...over,
  };
}

describe('CSV parser', () => {
  it('handles quotes, escaped quotes, commas, CRLF and embedded newlines', () => {
    expect(parseCsv('a,"b,c","d ""e"""\r\n1,"line\nbreak",3')).toEqual([
      ['a', 'b,c', 'd "e"'],
      ['1', 'line\nbreak', '3'],
    ]);
  });

  it('maps rows to records by header and skips blank lines', () => {
    expect(parseCsvRecords('x,y\n1,2\n\n3,4\n')).toEqual([
      { x: '1', y: '2' },
      { x: '3', y: '4' },
    ]);
  });
});

describe('OurAirports importer', () => {
  it('keeps airport types by default filter and skips airports without position', () => {
    expect(imported.airports.map((a) => a.icao).sort()).toEqual(['KOTH', 'KTST']);
    expect(imported.warnings.some((w) => w.startsWith('KNOP'))).toBe(true);
    expect(imported.airports.find((a) => a.icao === 'KTST')).toMatchObject({
      name: 'Test "Intl" Airport',
      iata: 'TST',
      elevationFt: 13,
    });
  });

  it('creates both runway directions with displaced threshold applied', () => {
    const r04 = imported.runways.find((r) => r.airport === 'KTST' && r.id === '04')!;
    const r22 = imported.runways.find((r) => r.airport === 'KTST' && r.id === '22')!;
    expect(r04.headingTrue).toBe(40);
    expect(r22.headingTrue).toBe(220);
    expect(r04.lengthM).toBeCloseTo(3000, 6);
    expect(r04.widthM).toBeCloseTo(148 * 0.3048, 6);
    expect(r04.displacedM).toBeCloseTo(152.4, 6);
    expect(distanceM(LE, r04.threshold)).toBeCloseTo(152.4, 3);
    expect(distanceM(r04.threshold, r04.end)).toBeCloseTo(3000 - 152.4, 3);
    expect(r22.threshold).toEqual(HE);
    expect(r22.displacedM).toBeUndefined();
    expect(r22.thresholdElevFt).toBe(14);
  });

  it('skips closed runways and runways without both ends', () => {
    const ids = imported.runways.filter((r) => r.airport === 'KTST').map((r) => r.id);
    expect(ids).not.toContain('13');
    expect(ids).not.toContain('18');
    expect(imported.warnings.some((w) => w.includes('18/36'))).toBe(true);
  });

  it('derives heading from geometry when none is published', () => {
    const r09 = imported.runways.find((r) => r.airport === 'KOTH' && r.id === '09')!;
    expect(r09.headingTrue).toBeGreaterThan(89);
    expect(r09.headingTrue).toBeLessThan(91);
  });

  it('filters by ICAO code and by bounding box', () => {
    const byCode = importOurAirports({ airportsCsv, runwaysCsv, retrieved: '2026-10-28' }, { icao: ['koth'] });
    expect(byCode.airports.map((a) => a.icao)).toEqual(['KOTH']);
    expect(byCode.runways.every((r) => r.airport === 'KOTH')).toBe(true);
    const byBox = importOurAirports(
      { airportsCsv, runwaysCsv, retrieved: '2026-10-28' },
      { bbox: { minLat: 39.5, maxLat: 40.5, minLon: -74.5, maxLon: -73.5 } }
    );
    expect(byBox.airports.map((a) => a.icao)).toEqual(['KTST']);
  });

  it('records a public-domain source', () => {
    expect(imported.source).toEqual({
      name: 'OurAirports',
      licence: 'Public-Domain',
      url: 'https://ourairports.com/data/',
      retrieved: '2026-10-28',
    });
  });
});

describe('pack validation', () => {
  it('accepts a pack built from the importer', () => {
    const r = validatePack(packFrom());
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('reports schema errors with their path', () => {
    const bad = { ...packFrom(), fixes: [{ id: 'X', kind: 'waypoint', pos: { lat: 95, lon: 0 } }] };
    const r = validatePack(bad);
    expect(r.ok).toBe(false);
    expect(r.errors[0]!.path).toBe('fixes.0.pos.lat');
  });

  it('refuses unpublishable licences unless explicitly allowed', () => {
    const pack = packFrom();
    pack.meta.sources = [{ name: 'OpenAIP', licence: 'CC-BY-NC-4.0', url: '', retrieved: '2026-10-28' }];
    expect(validatePack(pack).ok).toBe(false);
    const relaxed = validatePack(pack, { allowUnpublishableLicences: true });
    expect(relaxed.ok).toBe(true);
    expect(relaxed.warnings.some((w) => w.message.includes('CC-BY-NC-4.0'))).toBe(true);
  });

  it('warns about ODbL share-alike', () => {
    const pack = packFrom();
    pack.meta.sources.push({ name: 'adsb.lol', licence: 'ODbL-1.0', url: '', retrieved: '2026-10-28' });
    expect(validatePack(pack).warnings.some((w) => w.message.includes('ODbL'))).toBe(true);
  });

  it('catches runway geometry that does not match length or heading', () => {
    const pack = packFrom();
    pack.runways = pack.runways.map((r) =>
      r.airport === 'KTST' && r.id === '04' ? { ...r, lengthM: 3500, headingTrue: 45 } : r
    );
    const messages = validatePack(pack).errors.map((e) => e.message).join('\n');
    expect(messages).toMatch(/04: threshold→end is 2848 m, expected 3348 m/);
    expect(messages).toMatch(/04: heading 45° differs/);
  });

  it('catches duplicates, unknown airports and inverted areas; warns on unknown fixes', () => {
    const pack = packFrom({
      fixes: [
        { id: 'ALPHA', kind: 'waypoint', pos: { lat: 40.2, lon: -74.2 } },
        { id: 'ALPHA', kind: 'vor', pos: { lat: 40.3, lon: -74.3 } },
      ],
      areas: [{ id: 'R-1', kind: 'restricted', polygon: [LE, HE, { lat: 40.1, lon: -74 }], floorFt: 5000, ceilingFt: 3000 }],
      procedures: [{ id: 'ARR1', kind: 'STAR', airport: 'KTST', legs: [{ type: 'IF', fix: 'BRAVO' }] }],
    });
    pack.runways = [...pack.runways, { ...pack.runways[0]!, airport: 'KXXX' }];
    const r = validatePack(pack);
    const errors = r.errors.map((e) => e.message).join('\n');
    expect(errors).toMatch(/duplicate fix ALPHA/);
    expect(errors).toMatch(/unknown airport KXXX/);
    expect(errors).toMatch(/R-1: floor 5000 ft is not below ceiling 3000 ft/);
    expect(r.warnings.map((w) => w.message)).toContain('ARR1: unknown fix BRAVO');
  });

  it('exports a JSON Schema', () => {
    const schema = airspacePackJsonSchema() as { type: string; properties: Record<string, unknown> };
    expect(schema.type).toBe('object');
    expect(Object.keys(schema.properties)).toEqual(
      expect.arrayContaining(['meta', 'airports', 'runways', 'fixes'])
    );
  });
});
