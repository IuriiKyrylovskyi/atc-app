import { describe, expect, it } from 'vitest';
import {
  A0,
  atmosphere,
  casToMach,
  casToTas,
  crossoverAltitudeFt,
  machToCas,
  machToTas,
  tasToCas,
} from '../src';

describe('ISA', () => {
  it('matches sea-level values', () => {
    const sl = atmosphere(0);
    expect(sl.temperature).toBeCloseTo(288.15, 6);
    expect(sl.pressure).toBeCloseTo(101_325, 3);
    expect(sl.density).toBeCloseTo(1.225, 3);
    expect(A0).toBeCloseTo(340.294, 2);
  });

  it('matches the tropopause (11 000 m) and 20 000 m', () => {
    const trop = atmosphere(11_000 / 0.3048);
    expect(trop.temperature).toBeCloseTo(216.65, 2);
    expect(trop.pressure).toBeCloseTo(22_632, 0);
    const strat = atmosphere(20_000 / 0.3048);
    expect(strat.temperature).toBeCloseTo(216.65, 2);
    expect(strat.pressure).toBeCloseTo(5_474.9, 0);
  });

  it('applies a temperature deviation without changing pressure', () => {
    const std = atmosphere(10_000);
    const hot = atmosphere(10_000, 15);
    expect(hot.temperature - std.temperature).toBeCloseTo(15, 9);
    expect(hot.pressure).toBeCloseTo(std.pressure, 9);
    expect(hot.density).toBeLessThan(std.density);
  });
});

describe('airspeeds', () => {
  it('CAS equals TAS at sea level', () => {
    expect(casToTas(250, 0)).toBeCloseTo(250, 6);
  });

  it('Mach 1 at sea level is 661.47 kt CAS', () => {
    expect(machToCas(1, 0)).toBeCloseTo(661.47, 1);
    expect(casToMach(661.47, 0)).toBeCloseTo(1, 3);
  });

  it('TAS grows with altitude for a constant CAS', () => {
    expect(casToTas(250, 10_000)).toBeGreaterThan(285);
    expect(casToTas(250, 10_000)).toBeLessThan(295);
    expect(casToTas(250, 35_000)).toBeGreaterThan(casToTas(250, 20_000));
  });

  it('round-trips CAS ↔ Mach ↔ TAS', () => {
    for (const alt of [0, 5_000, 18_000, 29_000, 37_000]) {
      for (const cas of [140, 220, 290]) {
        expect(machToCas(casToMach(cas, alt), alt)).toBeCloseTo(cas, 6);
        expect(tasToCas(casToTas(cas, alt, 10), alt, 10)).toBeCloseTo(cas, 6);
      }
    }
  });

  it('Mach 0.78 at FL350 is about 450 kt TAS (ISA)', () => {
    // FL350 = 10 668 m → T = 218.81 K → a = 296.54 m/s → 0.78 × a = 231.30 m/s = 449.6 kt
    expect(machToTas(0.78, 35_000)).toBeCloseTo(449.6, 0);
  });

  it('finds the crossover altitude where CAS and Mach schedules meet', () => {
    const h = crossoverAltitudeFt(290, 0.78);
    expect(casToMach(290, h)).toBeCloseTo(0.78, 6);
    // A higher CAS for the same Mach crosses over lower down.
    expect(crossoverAltitudeFt(310, 0.78)).toBeLessThan(h);
    // Typical airliner schedules cross over around FL270–FL330.
    expect(h).toBeGreaterThan(27_000);
    expect(h).toBeLessThan(33_000);
  });
});
