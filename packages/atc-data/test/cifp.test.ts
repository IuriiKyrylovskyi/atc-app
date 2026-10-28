import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { angleDiffDeg, distanceM, type AirspacePack } from '@atc-app/sim';
import {
  importCifpArea,
  parseAltitude,
  parseArincLat,
  parseArincLon,
  parseMagVar,
  readCifpRecords,
  reciprocalRunway,
  validatePack,
  type CifpImportResult,
} from '../src';

// Real FAA CIFP AIRAC 2611 records (public domain): KJFK airport, runways, ILS,
// terminal waypoints, ILS 04L / DEEZZ6 / CAMRN5, airways B24 + J95 and their fixes.
const fixture = readFileSync(fileURLToPath(new URL('./fixtures/cifp-kjfk-2611.txt', import.meta.url)), 'latin1');
const fullFile = fileURLToPath(new URL('../../../db/faa-cifp/FAACIFP18', import.meta.url));

const toPack = (r: CifpImportResult): AirspacePack => ({
  meta: {
    id: 'TEST',
    name: 'test',
    airac: r.airac ?? '0000',
    reference: r.reference,
    magVar: r.magVar,
    sources: [r.source],
  },
  airports: r.airports,
  runways: r.runways,
  fixes: r.fixes,
  airways: r.airways,
  procedures: r.procedures,
});

describe('ARINC 424 field decoding', () => {
  it('decodes coordinates (DD MM SS.ss)', () => {
    expect(parseArincLat('N40382374')).toBeCloseTo(40 + 38 / 60 + 23.74 / 3600, 9);
    expect(parseArincLon('W073464329')).toBeCloseTo(-(73 + 46 / 60 + 43.29 / 3600), 9);
    expect(parseArincLat('S33565900')).toBeLessThan(0);
    expect(parseArincLat('         ')).toBeNull();
  });

  it('decodes magnetic variation and altitudes', () => {
    expect(parseMagVar('W0130')).toBe(-13);
    expect(parseMagVar('E0133')).toBeCloseTo(13.3, 9);
    expect(parseAltitude('05000')).toBe(5000);
    expect(parseAltitude('FL180')).toBe(18000);
    expect(parseAltitude('     ')).toBeNull();
  });

  it('finds reciprocal runways', () => {
    expect(reciprocalRunway('04L')).toBe('22R');
    expect(reciprocalRunway('13')).toBe('31');
    expect(reciprocalRunway('18C')).toBe('36C');
    expect(reciprocalRunway('36R')).toBe('18L');
  });
});

describe('CIFP importer (KJFK fixture, AIRAC 2611)', () => {
  const rec = readCifpRecords(fixture);
  const r = importCifpArea(rec, { airports: ['KJFK'], radiusNm: 40, retrieved: '2026-10-28' });

  it('reads the AIRAC cycle from the header', () => {
    expect(r.airac).toBe('2611');
    expect(r.source).toMatchObject({ name: 'FAA CIFP AIRAC 2611', licence: 'Public-Domain' });
  });

  it('imports the airport reference record', () => {
    expect(r.airports[0]).toMatchObject({
      icao: 'KJFK',
      iata: 'JFK',
      name: 'JOHN F KENNEDY INTL',
      elevationFt: 13,
      magVar: -13,
      transitionAltFt: 18000,
      transitionLevel: 180,
    });
    expect(r.airports[0]!.arp.lat).toBeCloseTo(40.639928, 5);
  });

  it('imports all eight runway directions with consistent geometry', () => {
    expect(r.runways.map((x) => x.id).sort()).toEqual(['04L', '04R', '13L', '13R', '22L', '22R', '31L', '31R']);
    const r04l = r.runways.find((x) => x.id === '04L')!;
    expect(r04l.lengthM).toBeCloseTo(12079 * 0.3048, 6);
    expect(r04l.displacedM).toBeCloseTo(460 * 0.3048, 6);
    expect(r04l.widthM).toBeCloseTo(200 * 0.3048, 6);
    expect(distanceM(r04l.threshold, r04l.end)).toBeCloseTo(r04l.lengthM - r04l.displacedM!, -1);
  });

  it('agrees with the published magnetic bearing (true = mag + variation)', () => {
    for (const rwy of r.runways) {
      const raw = rec.runways.find((x) => x.id === rwy.id)!;
      expect(Math.abs(angleDiffDeg(raw.bearingMag! - 13, rwy.headingTrue))).toBeLessThan(1);
    }
  });

  it('attaches the ILS with true course and glideslope', () => {
    const r04l = r.runways.find((x) => x.id === '04L')!;
    expect(r04l.ils).toBeDefined();
    expect(r04l.ils!.courseTrue).toBeCloseTo(43.8 - 13, 6);
    expect(r04l.ils!.glideslopeDeg).toBe(3);
    expect(Math.abs(angleDiffDeg(r04l.ils!.courseTrue, r04l.headingTrue))).toBeLessThan(1);
  });

  it('decodes the ILS 04L approach incl. missed approach and hold', () => {
    const iap = r.procedures.find((p) => p.kind === 'IAP' && p.id === 'I04L' && !p.transition)!;
    expect(iap.runway).toBe('04L');
    expect(iap.legs.map((l) => l.type)).toEqual(['IF', 'CF', 'CF', 'CA', 'CF', 'HM']);
    expect(iap.legs[0]).toMatchObject({ fix: 'AROKE', altitude: { type: 'atOrAbove', ft: 2000 } });
    expect(iap.legs[1]).toMatchObject({ fix: 'KRSTL', distanceNm: 6, navaid: 'IHIQ' });
    expect(iap.legs[2]).toMatchObject({ fix: 'KJFK.RW04L', vpaDeg: -3, altitude: { type: 'at', ft: 69 } });
    expect(iap.legs[2]!.missedApproach).toBeUndefined();
    expect(iap.legs[3]).toMatchObject({ missedApproach: true, altitude: { type: 'atOrAbove', ft: 2000 } });
    expect(iap.legs[4]).toMatchObject({ fix: 'DUFFY', flyOver: true, missedApproach: true });
    expect(iap.legs[5]).toMatchObject({ fix: 'DUFFY', turn: 'left', holdMinutes: 1 });
    expect(iap.legs[5]!.courseTrue).toBeCloseTo(242 - 13, 6);
  });

  it('decodes a SID runway transition and a STAR', () => {
    const sid = r.procedures.find((p) => p.kind === 'SID' && p.id === 'DEEZZ6' && p.transition === 'RW04L')!;
    expect(sid.runway).toBe('04L');
    expect(sid.legs[0]).toMatchObject({ type: 'VA', altitude: { type: 'atOrAbove', ft: 520 } });
    expect(sid.legs[0]!.courseTrue).toBeCloseTo(43.8 - 13, 6);
    expect(sid.legs[1]).toMatchObject({ type: 'DF', fix: 'PONAE', flyOver: true });
    const star = r.procedures.find((p) => p.kind === 'STAR' && p.id === 'CAMRN5' && p.transition === 'ALL')!;
    expect(star.legs[0]).toMatchObject({ type: 'IF', fix: 'SIE' });
    expect(r.fixes.find((f) => f.id === 'SIE')!.kind).toBe('vor');
  });

  it('builds airway segments touching the area', () => {
    expect(r.airways.length).toBeGreaterThan(0);
    for (const a of r.airways) for (const s of a.segments) {
      expect(r.fixes.some((f) => f.id === s.from)).toBe(true);
      expect(r.fixes.some((f) => f.id === s.to)).toBe(true);
    }
  });

  it('produces a pack that passes validation', () => {
    const v = validatePack(toPack(r));
    expect(v.errors).toEqual([]);
    expect(v.ok).toBe(true);
  });
});

describe.skipIf(!existsSync(fullFile))('CIFP importer (full AIRAC file in db/faa-cifp)', () => {
  it('imports the New York area (KJFK, KLGA, KEWR) into a valid pack', () => {
    const t0 = Date.now();
    const rec = readCifpRecords(readFileSync(fullFile, 'latin1'));
    const r = importCifpArea(rec, { airports: ['KJFK', 'KLGA', 'KEWR'], radiusNm: 60, retrieved: '2026-10-28' });
    const ms = Date.now() - t0;
    expect(r.airports).toHaveLength(3);
    // JFK 4 runways + LGA 2 + EWR 3 → 18 runway directions
    expect(r.runways).toHaveLength(18);
    expect(r.procedures.length).toBeGreaterThan(100);
    expect(r.fixes.length).toBeGreaterThan(300);
    expect(r.airways.length).toBeGreaterThan(10);
    expect(r.warnings).toEqual([]);
    const v = validatePack(toPack(r));
    expect(v.errors).toEqual([]);
    expect(v.warnings).toEqual([]);
    expect(ms).toBeLessThan(15_000);
  });
});
