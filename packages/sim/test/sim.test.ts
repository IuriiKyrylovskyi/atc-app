import { describe, expect, it } from 'vitest';
import {
  angleDiffDeg,
  assessPair,
  createPortPair,
  destination,
  distanceNm,
  groundVector,
  headingForTrack,
  serveSimulation,
  SimClient,
  Simulation,
  turnRateDegS,
  type AircraftState,
  type AirspacePack,
  type SimConfig,
} from '../src';

const ORIGIN = { lat: 40, lon: -74 };

const pack: AirspacePack = {
  meta: {
    id: 'TEST',
    name: 'Test sector',
    airac: '2611',
    reference: ORIGIN,
    magVar: 0,
    sources: [{ name: 'unit test', licence: 'Public-Domain', url: '', retrieved: '2026-10-28' }],
  },
  airports: [],
  runways: [],
  fixes: [{ id: 'NORTH', kind: 'waypoint', pos: destination(ORIGIN, 0, 20 * 1852) }],
};

const instant: SimConfig = { seed: 42, pack, pilotDelayS: [0, 0] };

function oneAircraft(config: SimConfig = instant, over: Partial<{ altFt: number; casKt: number; headingTrue: number }> = {}) {
  const sim = new Simulation(config);
  sim.addAircraft({
    callsign: 'TST1',
    icaoType: 'A320',
    pos: ORIGIN,
    altFt: over.altFt ?? 0,
    headingTrue: over.headingTrue ?? 90,
    casKt: over.casKt ?? 160,
  });
  return sim;
}

describe('flight model', () => {
  it('flies straight: 160 kt for 60 s covers 2.67 NM', () => {
    const sim = oneAircraft();
    sim.advance(60);
    const ac = sim.getAircraft('TST1')!;
    expect(distanceNm(ORIGIN, ac.pos)).toBeCloseTo(160 / 60, 2);
    expect(ac.headingTrue).toBeCloseTo(90, 9);
  });

  it('turns at standard rate: 90° right takes 30 s at 160 kt', () => {
    const sim = oneAircraft();
    sim.issue({ to: 'TST1', clearances: [{ kind: 'heading', headingMag: 180 }] });
    sim.advance(29);
    expect(sim.getAircraft('TST1')!.headingTrue).toBeLessThan(180);
    sim.advance(1.5);
    expect(sim.getAircraft('TST1')!.headingTrue).toBeCloseTo(180, 9);
  });

  it('honours an explicit turn direction (left the long way: 270° in 90 s)', () => {
    const sim = oneAircraft();
    sim.issue({ to: 'TST1', clearances: [{ kind: 'heading', headingMag: 180, turn: 'left' }] });
    sim.advance(60);
    expect(sim.getAircraft('TST1')!.headingTrue).toBeCloseTo(270, 6);
    sim.advance(30.5);
    expect(sim.getAircraft('TST1')!.headingTrue).toBeCloseTo(180, 9);
  });

  it('limits turn rate by bank angle at high TAS', () => {
    expect(turnRateDegS(160, 25)).toBeCloseTo(3, 9);
    expect(turnRateDegS(450, 25)).toBeLessThan(1.3);
  });

  it('climbs at the cleared rate and levels off', () => {
    const sim = oneAircraft(instant, { altFt: 10_000, casKt: 250 });
    sim.issue({ to: 'TST1', clearances: [{ kind: 'altitude', altFt: 12_000, vsFpm: 2000 }] });
    sim.advance(59);
    expect(sim.getAircraft('TST1')!.altFt).toBeLessThan(12_000);
    sim.advance(1.5);
    const ac = sim.getAircraft('TST1')!;
    expect(ac.altFt).toBe(12_000);
    expect(ac.vsFpm).toBe(0);
  });

  it('keeps 250 kt below 10 000 ft', () => {
    const sim = oneAircraft(instant, { altFt: 5_000, casKt: 240 });
    sim.issue({ to: 'TST1', clearances: [{ kind: 'speed', casKt: 300 }] });
    sim.advance(120);
    expect(sim.getAircraft('TST1')!.casKt).toBe(250);
  });

  it('flies direct to a fix and reports reaching it', () => {
    const sim = oneAircraft();
    sim.issue({ to: 'TST1', clearances: [{ kind: 'direct', fix: 'NORTH' }] });
    sim.advance(600);
    const reached = sim.eventLog.find((e) => e.type === 'fix_reached');
    expect(reached).toBeDefined();
    // 30 s turn + ~20 NM at 160 kt (450 s)
    expect(reached!.t).toBeGreaterThan(440);
    expect(reached!.t).toBeLessThan(500);
  });

  it('rejects impossible clearances with a reason', () => {
    const sim = oneAircraft();
    sim.issue({ to: 'TST1', clearances: [{ kind: 'direct', fix: 'NOWHERE' }, { kind: 'squawk', code: '7800' }] });
    sim.advance(1);
    const rejected = sim.eventLog.filter((e) => e.type === 'clearance_rejected');
    expect(rejected).toHaveLength(2);
    expect(sim.issue({ to: 'GHOST', clearances: [] }).ok).toBe(false);
  });
});

describe('wind', () => {
  const wind = { fromDeg: 270, speedKt: 30 };

  it('drifts the track downwind', () => {
    const g = groundVector(0, 160, wind);
    expect(g.trackDeg).toBeCloseTo((Math.atan2(30, 160) * 180) / Math.PI, 6);
    expect(g.gsKt).toBeCloseTo(Math.hypot(160, 30), 6);
  });

  it('wind correction makes good the desired track', () => {
    for (const track of [0, 45, 135, 250]) {
      const heading = headingForTrack(track, 160, wind);
      expect(angleDiffDeg(track, groundVector(heading, 160, wind).trackDeg)).toBeCloseTo(0, 6);
    }
  });
});

describe('determinism, pilot delay, save/restore', () => {
  const script = (sim: Simulation) => {
    sim.issue({ to: 'TST1', clearances: [{ kind: 'heading', headingMag: 30 }] });
    sim.advance(45);
    sim.issue({ to: 'TST1', clearances: [{ kind: 'altitude', altFt: 6000 }, { kind: 'speed', casKt: 210 }] });
    sim.advance(120);
  };

  it('draws pilot delays from the seeded RNG within range', () => {
    const sim = oneAircraft({ seed: 7, pack });
    const r = sim.issue({ to: 'TST1', clearances: [{ kind: 'heading', headingMag: 360 }] });
    expect(r.applyAt).toBeGreaterThanOrEqual(2);
    expect(r.applyAt).toBeLessThan(6);
  });

  it('same seed + same messages ⇒ identical state and log', () => {
    const a = oneAircraft({ seed: 99, pack });
    const b = oneAircraft({ seed: 99, pack });
    script(a);
    script(b);
    expect(JSON.stringify(b.saveState())).toBe(JSON.stringify(a.saveState()));
  });

  it('restore continues exactly like the original run', () => {
    const config = { seed: 5, pack };
    const a = oneAircraft(config);
    a.advance(30);
    const saved = a.saveState();
    script(a);
    const b = Simulation.restore(config, saved);
    script(b);
    expect(JSON.stringify(b.saveState())).toBe(JSON.stringify(a.saveState()));
  });

  it('advance() carries fractional time between calls', () => {
    const a = oneAircraft();
    for (let i = 0; i < 10; i++) a.advance(0.3);
    expect(a.time).toBeCloseTo(3, 9);
  });
});

describe('bridge', () => {
  it('drives a simulation through a port pair', async () => {
    const [uiPort, simPort] = createPortPair();
    serveSimulation(simPort);
    const client = new SimClient(uiPort);
    await client.call({ op: 'init', config: instant });
    await client.call({
      op: 'addAircraft',
      spawn: { callsign: 'BRG1', icaoType: 'B738', pos: ORIGIN, altFt: 0, headingTrue: 0, casKt: 160 },
    });
    const issued = await client.call({ op: 'issue', message: { to: 'BRG1', clearances: [{ kind: 'altitude', altFt: 3000 }] } });
    expect(issued.ok).toBe(true);
    const snap = await client.call({ op: 'advance', seconds: 60 });
    expect(snap.t).toBe(60);
    expect(snap.aircraft[0]!.altFt).toBeGreaterThan(0);
    expect(snap.events.some((e) => e.type === 'clearance_applied')).toBe(true);
    await expect(client.call({ op: 'issue', message: { to: 'X', clearances: [] } })).resolves.toMatchObject({ ok: false });
    client.dispose();
  });
});

describe('routes and scheduled traffic', () => {
  const at = (brg: number, nm: number) => destination(ORIGIN, brg, nm * 1852);
  const routePack: AirspacePack = {
    ...pack,
    fixes: [
      { id: 'AAA', kind: 'waypoint', pos: at(0, 10) },
      { id: 'BBB', kind: 'waypoint', pos: at(30, 20) },
      { id: 'CCC', kind: 'waypoint', pos: at(60, 25) },
    ],
  };
  const cfg: SimConfig = { seed: 7, pack: routePack, pilotDelayS: [0, 0] };
  const spawn = (sim: Simulation) =>
    sim.addAircraft({
      callsign: 'ARR1',
      icaoType: 'A320',
      pos: ORIGIN,
      altFt: 12_000,
      headingTrue: 0,
      casKt: 250,
      route: ['AAA', 'BBB', 'CCC'],
      clearedAltFt: 8_000,
      destination: 'KTST',
    });
  const fixesReached = (sim: Simulation) =>
    sim.eventLog.flatMap((e) => (e.type === 'fix_reached' ? [e.fix] : []));

  it('flies the route fix by fix, descends to the cleared altitude, then holds heading', () => {
    const sim = new Simulation(cfg);
    spawn(sim);
    expect(sim.getAircraft('ARR1')!.destination).toBe('KTST');
    sim.advance(900);
    expect(fixesReached(sim)).toEqual(['AAA', 'BBB', 'CCC']);
    expect(sim.eventLog.some((e) => e.type === 'route_ended' && e.fix === 'CCC')).toBe(true);
    const ac = sim.getAircraft('ARR1')!;
    expect(ac.altFt).toBe(8_000);
    expect(ac.target.directFix).toBeNull();
    expect(ac.target.headingTrue).not.toBeNull();
  });

  it('rejects a route with fixes the pack does not have', () => {
    const sim = new Simulation(cfg);
    expect(() =>
      sim.addAircraft({ callsign: 'X', icaoType: 'A320', pos: ORIGIN, altFt: 0, headingTrue: 0, casKt: 200, route: ['ZZZ'] })
    ).toThrow(/unknown route fix ZZZ/);
  });

  it('keeps the route under vectors and resumes it', () => {
    const sim = new Simulation(cfg);
    spawn(sim);
    sim.issue({ to: 'ARR1', clearances: [{ kind: 'heading', headingMag: 270 }] });
    sim.advance(60);
    let ac = sim.getAircraft('ARR1')!;
    expect(ac.target.directFix).toBeNull();
    expect(ac.target.route).toEqual(['AAA', 'BBB', 'CCC']);
    sim.issue({ to: 'ARR1', clearances: [{ kind: 'resume_own_navigation' }] });
    sim.advance(1);
    ac = sim.getAircraft('ARR1')!;
    expect(ac.target.directFix).toBe('AAA');
    expect(ac.target.route).toEqual(['BBB', 'CCC']);
  });

  it('direct to a later route fix shortcuts the route; resume while on it is rejected', () => {
    const sim = new Simulation(cfg);
    spawn(sim);
    sim.issue({ to: 'ARR1', clearances: [{ kind: 'direct', fix: 'BBB' }] });
    sim.advance(1);
    expect(sim.getAircraft('ARR1')!.target.route).toEqual(['CCC']);
    sim.issue({ to: 'ARR1', clearances: [{ kind: 'resume_own_navigation' }] });
    sim.advance(1);
    expect(sim.eventLog.some((e) => e.type === 'clearance_rejected' && e.reason === 'already on own navigation')).toBe(true);
  });

  it('spawns scheduled aircraft on time, and the schedule survives save/restore', () => {
    const sim = new Simulation(cfg);
    sim.schedule(30, { callsign: 'LATE1', icaoType: 'B738', pos: ORIGIN, altFt: 5000, headingTrue: 90, casKt: 220 });
    sim.advance(29.5);
    expect(sim.getAircraft('LATE1')).toBeUndefined();
    const restored = Simulation.restore(cfg, sim.saveState());
    restored.advance(0.5);
    expect(restored.getAircraft('LATE1')).toBeDefined();
    expect(restored.eventLog.find((e) => e.type === 'aircraft_added')!.t).toBe(30);
  });
});

describe('separation monitor / STCA', () => {
  const NM = 1852;
  const state = (over: Partial<AircraftState> & { altFt: number }): AircraftState => ({
    callsign: 'X', icaoType: 'A320', wake: 'M', squawk: '2000', origin: 'scenario',
    pos: ORIGIN, headingTrue: 0, trackTrue: 0, casKt: 250, tasKt: 300, gsKt: 300, mach: 0.5, vsFpm: 0,
    target: { altFt: over.altFt, headingTrue: 0, turn: null, casKt: 250, mach: null, vsFpm: null, directFix: null, route: [] },
    ...over,
  });
  // Head-on on the meridian: A northbound at the origin, B southbound 20 NM north.
  const north = (altFt: number, over: Partial<AircraftState> = {}) => state({ callsign: 'AAA1', altFt, ...over });
  const south = (altFt: number, over: Partial<AircraftState> = {}) =>
    state({ callsign: 'BBB2', altFt, pos: destination(ORIGIN, 0, 20 * NM), headingTrue: 180, trackTrue: 180, ...over });

  it('predicts a head-on loss when closing below 3 NM at the same level', () => {
    const g = assessPair(north(10_000), south(10_000));
    expect(g.loss).toBe(false);
    expect(g.lateralNm).toBeCloseTo(20, 1);
    // 600 kt closure: 17 NM to go = 102 s, sampled every 2 s.
    expect(g.inS).toBe(104);
  });

  it('keeps quiet at 1 000 ft apart and beyond the look-ahead', () => {
    expect(assessPair(north(10_000), south(11_000)).inS).toBeNull();
    const far = south(10_000, { pos: destination(ORIGIN, 0, 40 * NM) });
    expect(assessPair(north(10_000), far).inS).toBeNull(); // 222 s away > 120 s
  });

  it('uses the cleared level: a descent that stops 1 000 ft above is no conflict', () => {
    const stopping = south(13_000, { vsFpm: -2000, target: { ...south(0).target, altFt: 11_000 } });
    expect(assessPair(north(10_000), stopping).inS).toBeNull();
    const through = south(13_000, { vsFpm: -2000, target: { ...south(0).target, altFt: 8000 } });
    expect(assessPair(north(10_000), through).inS).not.toBeNull();
  });

  it('reports a loss right now', () => {
    const close = south(10_500, { pos: destination(ORIGIN, 90, 2 * NM) });
    expect(assessPair(north(10_000), close)).toMatchObject({ loss: true, inS: 0, verticalFt: 500 });
  });

  // 30 NM apart, ~580 kt closure: alert from ~47 s (120 s look-ahead), loss at ~167 s.
  it('logs alert → loss → restored → ended, and lists conflicts in the snapshot', () => {
    const sim = new Simulation({ seed: 1, pack, pilotDelayS: [0, 0] });
    sim.addAircraft({ callsign: 'BBB2', icaoType: 'A320', pos: destination(ORIGIN, 0, 30 * NM), altFt: 10_000, headingTrue: 180, casKt: 250 });
    sim.addAircraft({ callsign: 'AAA1', icaoType: 'A320', pos: ORIGIN, altFt: 10_000, headingTrue: 0, casKt: 250 });
    sim.advance(10);
    expect(sim.snapshot().conflicts).toEqual([]);

    sim.advance(90);
    const alerting = sim.snapshot().conflicts;
    expect(alerting).toHaveLength(1);
    expect(alerting[0]).toMatchObject({ a: 'AAA1', b: 'BBB2', kind: 'predicted' });

    sim.advance(400);
    const types = sim.eventLog
      .filter((e) => e.type.startsWith('conflict') || e.type.startsWith('separation'))
      .map((e) => e.type);
    expect(types).toEqual(['conflict_alert', 'separation_lost', 'separation_restored', 'conflict_ended']);
    const restored = sim.eventLog.find((e) => e.type === 'separation_restored');
    expect(restored!.type === 'separation_restored' && restored!.minLateralNm).toBeLessThan(0.5);
    expect(sim.snapshot().conflicts).toEqual([]);
  });

  it('a timely vertical clearance resolves the alert without a loss', () => {
    const sim = new Simulation({ seed: 1, pack, pilotDelayS: [0, 0] });
    sim.addAircraft({ callsign: 'BBB2', icaoType: 'A320', pos: destination(ORIGIN, 0, 30 * NM), altFt: 10_000, headingTrue: 180, casKt: 250 });
    sim.addAircraft({ callsign: 'AAA1', icaoType: 'A320', pos: ORIGIN, altFt: 10_000, headingTrue: 0, casKt: 250 });
    sim.advance(60);
    expect(sim.snapshot().conflicts).toHaveLength(1);
    sim.issue({ to: 'AAA1', clearances: [{ kind: 'altitude', altFt: 9000 }] });
    sim.advance(400);
    const types = sim.eventLog.map((e) => e.type);
    expect(types).toContain('conflict_alert');
    expect(types).not.toContain('separation_lost');
    expect(types).toContain('conflict_ended');
  });

  it('ends the pair when an aircraft leaves', () => {
    const sim = new Simulation({ seed: 1, pack, pilotDelayS: [0, 0] });
    sim.addAircraft({ callsign: 'AAA1', icaoType: 'A320', pos: ORIGIN, altFt: 10_000, headingTrue: 0, casKt: 250 });
    sim.addAircraft({ callsign: 'BBB2', icaoType: 'A320', pos: destination(ORIGIN, 90, 1 * NM), altFt: 10_000, headingTrue: 0, casKt: 250 });
    sim.advance(1);
    expect(sim.snapshot().conflicts[0]!.kind).toBe('loss');
    sim.removeAircraft('BBB2');
    expect(sim.snapshot().conflicts).toEqual([]);
    expect(sim.eventLog.slice(-2).map((e) => e.type)).toEqual(['separation_restored', 'conflict_ended']);
  });
});
