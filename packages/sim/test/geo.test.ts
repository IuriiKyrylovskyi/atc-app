import { describe, expect, it } from 'vitest';
import {
  courseTo,
  declinationDeg,
  destination,
  distanceM,
  distanceNm,
  magToTrue,
  StereographicProjection,
  trueToMag,
} from '../src';

describe('geodesy (WGS-84)', () => {
  it('matches known meridian and equator arc lengths', () => {
    // 1° of latitude from the equator: 110 574.3 m; 1° of longitude on the equator: 111 319.5 m.
    expect(distanceM({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(110574.3, 0);
    expect(distanceM({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(111319.5, 0);
  });

  it('round-trips direct → inverse', () => {
    const start = { lat: 50.345, lon: 30.894 };
    for (const course of [0, 37, 90, 181, 270, 359]) {
      const end = destination(start, course, 92_600);
      expect(distanceNm(start, end)).toBeCloseTo(50, 6);
      expect(courseTo(start, end)).toBeCloseTo(course % 360, 6);
    }
  });

  it('gives cardinal courses', () => {
    const p = { lat: 40, lon: -74 };
    expect(courseTo(p, { lat: 41, lon: -74 })).toBeCloseTo(0, 6);
    expect(courseTo(p, { lat: 39, lon: -74 })).toBeCloseTo(180, 6);
  });
});

describe('stereographic projection', () => {
  const origin = { lat: 40.6413, lon: -73.7781 };
  const proj = new StereographicProjection(origin);

  it('maps the origin to (0, 0)', () => {
    const o = proj.toLocal(origin);
    expect(o.x).toBeCloseTo(0, 6);
    expect(o.y).toBeCloseTo(0, 6);
  });

  it('round-trips within a micro-degree', () => {
    const p = { lat: 41.2, lon: -72.9 };
    const back = proj.toGeo(proj.toLocal(p));
    expect(back.lat).toBeCloseTo(p.lat, 6);
    expect(back.lon).toBeCloseTo(p.lon, 6);
  });

  it('keeps distances within 0.1 % at 100 NM from the centre', () => {
    for (const course of [0, 45, 135, 250]) {
      const p = destination(origin, course, 185_200);
      const { x, y } = proj.toLocal(p);
      const planar = Math.hypot(x, y);
      expect(Math.abs(planar - 185_200) / 185_200).toBeLessThan(0.001);
    }
  });

  it('is north-up: due north has x ≈ 0, y > 0', () => {
    const { x, y } = proj.toLocal(destination(origin, 0, 50_000));
    expect(Math.abs(x)).toBeLessThan(1);
    expect(y).toBeGreaterThan(49_000);
  });
});

describe('magnetic variation (WMM-2025)', () => {
  const date = new Date('2026-10-28T00:00:00Z');

  it('is west in New York and east in San Francisco', () => {
    const ny = declinationDeg({ lat: 40.71, lon: -74.01 }, date);
    const sf = declinationDeg({ lat: 37.77, lon: -122.42 }, date);
    expect(ny).toBeGreaterThan(-14);
    expect(ny).toBeLessThan(-11);
    expect(sf).toBeGreaterThan(11.5);
    expect(sf).toBeLessThan(14);
  });

  it('converts magnetic ↔ true', () => {
    expect(magToTrue(90, -13)).toBeCloseTo(77, 9);
    expect(trueToMag(77, -13)).toBeCloseTo(90, 9);
    expect(magToTrue(355, 10)).toBeCloseTo(5, 9);
  });
});
