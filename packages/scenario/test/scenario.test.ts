import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { destination, Simulation, type AirspacePack, type Procedure } from '@atc-app/sim';
import {
  arrivalOnStar,
  buildScenario,
  flightOnRoute,
  NY_ARRIVALS,
  NY_CONFLICTS,
  scenariosForPack,
  starRoute,
  type ScenarioScript,
} from '../src';

const REF = { lat: 40, lon: -74 };
const fix = (id: string, brg: number, nm: number) => ({ id, kind: 'waypoint' as const, pos: destination(REF, brg, nm * 1852) });
const tf = (f: string) => ({ type: 'TF' as const, fix: f });
const star = (over: Partial<Procedure> & { legs: Procedure['legs'] }): Procedure => ({
  id: 'TEST1',
  kind: 'STAR',
  airport: 'KTST',
  ...over,
});

const pack: AirspacePack = {
  meta: {
    id: 'test',
    name: 'Test',
    airac: '2611',
    reference: REF,
    magVar: 0,
    sources: [{ name: 'unit test', licence: 'Public-Domain', url: '', retrieved: '2026-10-29' }],
  },
  airports: [],
  runways: [],
  fixes: [fix('ENTRY', 0, 60), fix('MIDDL', 0, 40), fix('MERGE', 0, 25), fix('FINAL', 0, 10), fix('ALTRN', 30, 30)],
  procedures: [
    star({ transition: 'ENTRY', legs: [{ type: 'IF', fix: 'ENTRY' }, tf('MIDDL'), tf('MERGE')] }),
    star({ transition: 'ALL', legs: [{ type: 'IF', fix: 'MERGE' }, tf('FINAL'), { type: 'FM', fix: 'FINAL', courseTrue: 180 }] }),
    star({ transition: 'RW18', runway: '18', legs: [{ type: 'IF', fix: 'FINAL' }, tf('ALTRN'), { type: 'VM' }] }),
    star({ id: 'OTHER1', legs: [{ type: 'IF', fix: 'ALTRN' }, tf('MERGE'), { type: 'VM', fix: 'MERGE' }, tf('ENTRY')] }),
  ],
};

describe('starRoute', () => {
  it('joins enroute transition + common route, dropping repeated fixes', () => {
    expect(starRoute(pack, { airport: 'KTST', star: 'TEST1', transition: 'ENTRY' })).toEqual([
      'ENTRY', 'MIDDL', 'MERGE', 'FINAL',
    ]);
  });

  it('starts at the common route without a transition, and appends a runway transition', () => {
    expect(starRoute(pack, { airport: 'KTST', star: 'TEST1' })).toEqual(['MERGE', 'FINAL']);
    expect(starRoute(pack, { airport: 'KTST', star: 'TEST1', runway: '18' })).toEqual(['MERGE', 'FINAL', 'ALTRN']);
  });

  it('ends at a from-fix (FM / VM) leg: the pilot expects vectors there', () => {
    expect(starRoute(pack, { airport: 'KTST', star: 'OTHER1' })).toEqual(['ALTRN', 'MERGE']);
  });

  it('names what is missing', () => {
    expect(() => starRoute(pack, { airport: 'KTST', star: 'NOPE1' })).toThrow(/NOPE1 not found/);
    expect(() => starRoute(pack, { airport: 'KTST', star: 'TEST1', transition: 'XX' })).toThrow(/no transition XX/);
    expect(() => starRoute(pack, { airport: 'KTST', star: 'TEST1', runway: '36' })).toThrow(/no runway transition 36/);
  });
});

describe('arrivalOnStar / buildScenario', () => {
  const base = { airport: 'KTST', star: 'TEST1', transition: 'ENTRY', icaoType: 'A320', altFt: 15_000, casKt: 280 };

  it('spawns over the from-fix, pointing at the next fix, with the rest as route', () => {
    const s = arrivalOnStar(pack, { ...base, callsign: 'A1', fromFix: 'MIDDL', clearedAltFt: 9000 });
    expect(s.pos).toEqual(pack.fixes[1]!.pos);
    // MIDDL (40 NM north) → MERGE (25 NM north): inbound, due south.
    expect(s.headingTrue).toBeCloseTo(180, 3);
    expect(s.route).toEqual(['MERGE', 'FINAL']);
    expect(s.clearedAltFt).toBe(9000);
    expect(s.destination).toBe('KTST');
    expect(() => arrivalOnStar(pack, { ...base, callsign: 'A2', fromFix: 'ALTRN' })).toThrow(/not on TEST1/);
    expect(() => arrivalOnStar(pack, { ...base, callsign: 'A3', fromFix: 'FINAL' })).toThrow(/nothing left/);
  });

  it('orders traffic by time and hands out discrete squawks', () => {
    const script: ScenarioScript = {
      id: 's',
      name: 's',
      packId: 'test',
      seed: 3,
      arrivals: [
        { ...base, atS: 60, callsign: 'B2', fromFix: 'MIDDL' },
        { ...base, atS: 0, callsign: 'B1', fromFix: 'ENTRY' },
        { ...base, atS: 30, callsign: 'B3', fromFix: 'ENTRY', squawk: '4321' },
      ],
    };
    const built = buildScenario(script, pack);
    expect(built.traffic.map((t) => [t.atS, t.spawn.callsign, t.spawn.squawk])).toEqual([
      [0, 'B1', '2101'],
      [30, 'B3', '4321'],
      [60, 'B2', '2102'],
    ]);
    expect(built.config.seed).toBe(3);
    expect(() => buildScenario({ ...script, packId: 'other' }, pack)).toThrow(/for pack other/);
  });
});

// ── The real NY scenario against the built pack (`pnpm pack:build`) ─────────
const distDir = fileURLToPath(new URL('../../../packs/dist/', import.meta.url));
const nyFile = existsSync(distDir) ? readdirSync(distDir).find((f) => /^ny-tma@\d{4}\.json$/.test(f)) : undefined;

describe.skipIf(!nyFile)('NY arrivals on the built ny-tma pack', () => {
  const ny = nyFile ? (JSON.parse(readFileSync(distDir + nyFile, 'utf8')) as AirspacePack) : null;

  it('is listed for the pack, resolves every arrival and flies them along their STARs', () => {
    expect(scenariosForPack('ny-tma').map((s) => s.id)).toContain('ny-arrivals');
    const built = buildScenario(NY_ARRIVALS, ny!);
    const sim = new Simulation(built.config);
    for (const t of built.traffic) sim.schedule(t.atS, t.spawn);
    sim.advance(600);
    const snap = sim.snapshot();
    expect(snap.aircraft).toHaveLength(NY_ARRIVALS.arrivals.length);
    for (const t of built.traffic) {
      const reached = sim.eventLog.filter((e) => e.type === 'fix_reached' && e.callsign === t.spawn.callsign);
      expect(reached.length, t.spawn.callsign).toBeGreaterThan(0);
      expect(reached[0]!.type === 'fix_reached' && reached[0]!.fix).toBe(t.spawn.route![0]);
    }
    // Everyone is descending towards (or at) the cleared level.
    for (const ac of snap.aircraft) expect(ac.altFt).toBeLessThan(19_000);
    // The arrival push is built conflict-free.
    expect(sim.eventLog.some((e) => e.type === 'conflict_alert')).toBe(false);
  });

  it('conflict drill: both set-ups lose separation if nobody acts, the control pair never alerts', () => {
    expect(scenariosForPack('ny-tma').map((s) => s.id)).toContain('ny-conflicts');
    const built = buildScenario(NY_CONFLICTS, ny!);
    const sim = new Simulation(built.config);
    for (const t of built.traffic) sim.schedule(t.atS, t.spawn);
    sim.advance(900);
    const pairs = (type: string) =>
      sim.eventLog.flatMap((e) => (e.type === type && 'a' in e ? [`${e.a}/${e.b}`] : []));
    expect(pairs('separation_lost').sort()).toEqual(['ASA8/FFT1427', 'NKS318/SWA2214']);
    expect(pairs('conflict_alert')).not.toContain('ENY3810/SKW5520');
    // STCA warns well before the loss.
    const alert = sim.eventLog.find((e) => e.type === 'conflict_alert' && e.a === 'NKS318');
    const lost = sim.eventLog.find((e) => e.type === 'separation_lost' && e.a === 'NKS318');
    expect(lost!.t - alert!.t).toBeGreaterThanOrEqual(60);
  });
});

describe('flightOnRoute', () => {
  it('spawns over the from-fix heading for the first route fix', () => {
    const s = flightOnRoute(pack, {
      callsign: 'OVR1', icaoType: 'B738', fromFix: 'ENTRY', route: ['MIDDL', 'FINAL'], altFt: 12_000, casKt: 250,
    });
    expect(s.pos).toEqual(pack.fixes[0]!.pos);
    expect(s.headingTrue).toBeCloseTo(180, 3);
    expect(s.route).toEqual(['MIDDL', 'FINAL']);
    expect(() => flightOnRoute(pack, { ...s, fromFix: 'ENTRY', route: [] })).toThrow(/empty route/);
    expect(() => flightOnRoute(pack, { ...s, fromFix: 'NOPE', route: ['FINAL'] })).toThrow(/NOPE is not in pack/);
  });
});
