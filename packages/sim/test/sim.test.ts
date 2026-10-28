import { describe, expect, it } from 'vitest';
import {
  angleDiffDeg,
  createPortPair,
  destination,
  distanceNm,
  groundVector,
  headingForTrack,
  serveSimulation,
  SimClient,
  Simulation,
  turnRateDegS,
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
