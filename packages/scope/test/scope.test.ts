import { describe, expect, it } from 'vitest';
import { destination, M_PER_NM, type AircraftState, type AirspacePack, type Snapshot } from '@atc-app/sim';
import {
  buildVideoMap,
  dataBlockLines,
  DECLUTTER,
  DEFAULT_TRAFFIC_OPTIONS,
  hitTest,
  leaderVector,
  ScopeRenderer,
  ScopeView,
  TrafficPicture,
  type Ctx2D,
} from '../src';

const REF = { lat: 40.64, lon: -73.78 };

const pack: AirspacePack = {
  meta: { id: 't', name: 'Test', airac: '2611', reference: REF, magVar: -13, sources: [] },
  airports: [{ icao: 'KTST', name: 'Test', arp: REF, elevationFt: 13 }],
  runways: [
    {
      id: '04', airport: 'KTST', threshold: REF, end: destination(REF, 31, 3000), headingTrue: 31,
      lengthM: 3000, widthM: 60, thresholdElevFt: 12, ils: { courseTrue: 31, glideslopeDeg: 3 },
    },
    {
      id: '22', airport: 'KTST', threshold: destination(REF, 31, 3000), end: REF, headingTrue: 211,
      lengthM: 3000, widthM: 60, thresholdElevFt: 12,
    },
  ],
  fixes: [
    { id: 'ONRTE', kind: 'waypoint', pos: destination(REF, 0, 10 * M_PER_NM) },
    { id: 'OTHER', kind: 'waypoint', pos: destination(REF, 90, 10 * M_PER_NM) },
    { id: 'VOR', kind: 'vor', pos: destination(REF, 180, 10 * M_PER_NM) },
    { id: 'KTST.RW04', kind: 'runway', pos: REF },
  ],
  airways: [{ id: 'J1', segments: [{ from: 'ONRTE', to: 'VOR' }] }],
};

describe('ScopeView', () => {
  const view = () => new ScopeView({ widthPx: 1000, heightPx: 800, rangeNm: 40 });

  it('puts the centre in the middle and north up', () => {
    const v = view();
    expect(v.toScreen({ x: 0, y: 0 })).toEqual({ x: 500, y: 400 });
    expect(v.toScreen({ x: 0, y: 40 * M_PER_NM }).y).toBeCloseTo(0, 9); // range = to nearest edge (height)
    expect(v.pxPerNm).toBeCloseTo(10, 9);
  });

  it('round-trips screen ↔ local', () => {
    const v = view();
    v.centre = { x: 1234, y: -5678 };
    const p = { x: 25_000, y: 12_000 };
    const back = v.toLocal(v.toScreen(p));
    expect(back.x).toBeCloseTo(p.x, 6);
    expect(back.y).toBeCloseTo(p.y, 6);
  });

  it('pans with the pointer', () => {
    const v = view();
    const p = { x: 5000, y: 5000 };
    const before = v.toScreen(p);
    v.panBy(30, -20);
    const after = v.toScreen(p);
    expect(after.x - before.x).toBeCloseTo(30, 9);
    expect(after.y - before.y).toBeCloseTo(-20, 9);
  });

  it('zooms around the cursor and clamps the range', () => {
    const v = view();
    const at = { x: 700, y: 250 };
    const anchor = v.toLocal(at);
    v.zoomAt(0.5, at);
    expect(v.rangeNm).toBe(20);
    const s = v.toScreen(anchor);
    expect(s.x).toBeCloseTo(at.x, 9);
    expect(s.y).toBeCloseTo(at.y, 9);
    v.zoomAt(0.001, at);
    expect(v.rangeNm).toBe(2);
    v.rangeNm = 10_000;
    expect(v.rangeNm).toBe(300);
  });
});

describe('video map', () => {
  const map = buildVideoMap(pack);

  it('projects around the pack reference', () => {
    expect(map.airports[0]!.xy.x).toBeCloseTo(0, 6);
    const north = map.fixes.find((f) => f.id === 'ONRTE')!;
    expect(north.xy.y).toBeCloseTo(10 * M_PER_NM, -1);
    expect(Math.abs(north.xy.x)).toBeLessThan(1);
  });

  it('marks route fixes and leaves runway/airport fixes to their own layers', () => {
    expect(map.fixes.map((f) => [f.id, f.onRoute])).toEqual([
      ['ONRTE', true],
      ['OTHER', false],
      ['VOR', true],
    ]);
  });

  it('builds a 10 NM extended centreline with ticks for ILS runways only', () => {
    const r04 = map.runways.find((r) => r.id === '04')!;
    expect(r04.centreline!.ticks).toHaveLength(10);
    const d = Math.hypot(r04.centreline!.to.x - r04.threshold.x, r04.centreline!.to.y - r04.threshold.y);
    expect(d / M_PER_NM).toBeCloseTo(10, 2);
    // outbound = opposite the 031° landing course → south-west of the threshold
    expect(r04.centreline!.to.y).toBeLessThan(0);
    expect(map.runways.find((r) => r.id === '22')!.centreline).toBeUndefined();
    expect(map.airways).toHaveLength(1);
  });
});

function fakeCtx(): Ctx2D & { texts: string[] } {
  const texts: string[] = [];
  const noop = () => undefined;
  return {
    texts,
    setTransform: noop, fillRect: noop, beginPath: noop, moveTo: noop, lineTo: noop, stroke: noop,
    fill: noop, arc: noop, closePath: noop, setLineDash: noop, save: noop, restore: noop,
    fillText: (t: string) => void texts.push(t),
    measureText: (t: string) => ({ width: t.length * 7 }) as TextMetrics,
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textBaseline: 'middle', textAlign: 'left',
  } as unknown as Ctx2D & { texts: string[] };
}

describe('renderer declutter', () => {
  const map = buildVideoMap(pack);

  it('labels everything at short range', () => {
    const ctx = fakeCtx();
    const stats = new ScopeRenderer(ctx).draw(new ScopeView({ widthPx: 1000, heightPx: 800, rangeNm: 11 }), map);
    expect(ctx.texts).toEqual(expect.arrayContaining(['KTST', 'VOR', 'ONRTE', 'OTHER']));
    expect(stats.fixes).toBe(3);
  });

  it('drops off-route waypoints and their labels as range grows', () => {
    const ctx = fakeCtx();
    const view = new ScopeView({ widthPx: 1000, heightPx: 800, rangeNm: DECLUTTER.waypointOther + 10 });
    const stats = new ScopeRenderer(ctx).draw(view, map);
    expect(ctx.texts).toContain('VOR');
    expect(ctx.texts).not.toContain('OTHER');
    expect(ctx.texts).not.toContain('ONRTE'); // route labels stop at 25 NM
    expect(stats.fixes).toBe(2); // route waypoint symbol + VOR
  });

  it('never places overlapping labels', () => {
    const crowded: AirspacePack = {
      ...pack,
      fixes: Array.from({ length: 20 }, (_, i) => ({
        id: `F${String(i).padStart(4, '0')}`,
        kind: 'waypoint' as const,
        pos: destination(REF, 45, 2 * M_PER_NM + i * 5),
      })),
      airways: [],
    };
    const ctx = fakeCtx();
    new ScopeRenderer(ctx).draw(new ScopeView({ widthPx: 1000, heightPx: 800, rangeNm: 10 }), buildVideoMap(crowded));
    const fixLabels = ctx.texts.filter((t) => t.startsWith('F'));
    expect(fixLabels.length).toBe(1);
  });
});

describe('traffic', () => {
  const map = buildVideoMap(pack);
  const aircraft = (over: Partial<AircraftState> = {}): AircraftState => ({
    callsign: 'DAL1192', icaoType: 'B739', wake: 'M', squawk: '2101', origin: 'scenario',
    pos: destination(REF, 0, 10 * M_PER_NM), altFt: 16_040, headingTrue: 180, trackTrue: 180,
    casKt: 290, tasKt: 370, gsKt: 287, mach: 0.6, vsFpm: -2000, destination: 'KJFK',
    target: { altFt: 11_000, headingTrue: null, turn: null, casKt: 290, mach: null, vsFpm: null, directFix: 'X', route: [] },
    ...over,
  });
  const snap = (t: number, list: AircraftState[]): Snapshot => ({ t, aircraft: list, events: [] });

  it('formats the full data block', () => {
    expect(dataBlockLines(aircraft())).toEqual(['DAL1192', '160↓110 29', 'B739 KJFK']);
    const level = aircraft({ altFt: 11_000, vsFpm: 0, gsKt: 250 });
    expect(dataBlockLines(level)[1]).toBe('110  25');
    const climbing = aircraft({
      altFt: 5000, vsFpm: 1500, gsKt: 95, destination: undefined,
      target: { ...aircraft().target, altFt: 7000 },
    });
    expect(dataBlockLines(climbing)).toEqual(['DAL1192', '050↑070 10', 'B739']);
  });

  it('places leader positions like a numpad', () => {
    expect(leaderVector(8)).toEqual({ dx: 0, dy: -1 });
    expect(leaderVector(2)).toEqual({ dx: 0, dy: 1 });
    expect(leaderVector(6)).toEqual({ dx: 1, dy: 0 });
    const ne = leaderVector(9);
    expect(ne.dx).toBeCloseTo(Math.SQRT1_2, 9);
    expect(ne.dy).toBeCloseTo(-Math.SQRT1_2, 9);
  });

  it('keeps history per sweep, capped, and drops aircraft that leave', () => {
    const pic = new TrafficPicture(map.projection, 3);
    for (let i = 0; i < 5; i++) {
      pic.update(snap(i * 4.8, [aircraft({ pos: destination(REF, 0, (10 - i) * M_PER_NM) })]));
    }
    const t = pic.get('DAL1192')!;
    expect(t.history).toHaveLength(3);
    // Newest first: the previous sweep was 7 NM north.
    expect(t.history[0]!.y / M_PER_NM).toBeCloseTo(7, 1);
    expect(t.xy.y / M_PER_NM).toBeCloseTo(6, 1);
    pic.update(snap(30, [aircraft({ callsign: 'UAL1' })]));
    expect(pic.list().map((x) => x.callsign)).toEqual(['UAL1']);
    expect(pic.t).toBe(30);
  });

  it('draws data blocks, and hit-tests targets and blocks', () => {
    const pic = new TrafficPicture(map.projection);
    pic.update(snap(0, [aircraft(), aircraft({ callsign: 'FAR1', pos: destination(REF, 90, 200 * M_PER_NM) })]));
    const view = new ScopeView({ widthPx: 1000, heightPx: 800, rangeNm: 20 });
    const ctx = fakeCtx();
    const res = new ScopeRenderer(ctx).drawTraffic(view, pic.list(), { ...DEFAULT_TRAFFIC_OPTIONS, selected: 'DAL1192' });
    expect(res.drawn).toBe(1); // FAR1 is off screen
    expect(ctx.texts).toEqual(['DAL1192', '160↓110 29', 'B739 KJFK']);
    const target = view.toScreen(pic.get('DAL1192')!.xy);
    expect(hitTest(res.hits, target)).toBe('DAL1192');
    // Default leader 9: the block sits up and to the right.
    expect(hitTest(res.hits, { x: target.x + 30, y: target.y - 25 })).toBe('DAL1192');
    expect(hitTest(res.hits, { x: target.x - 40, y: target.y + 40 })).toBeNull();
    pic.setLeader('DAL1192', 1);
    const moved = new ScopeRenderer(fakeCtx()).drawTraffic(view, pic.list(), DEFAULT_TRAFFIC_OPTIONS);
    expect(hitTest(moved.hits, { x: target.x - 40, y: target.y + 25 })).toBe('DAL1192');
  });
});
