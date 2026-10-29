import { describe, expect, it } from 'vitest';
import { destination, M_PER_NM, type AircraftState, type AirspacePack, type Conflict, type Snapshot } from '@atc-app/sim';
import {
  buildVideoMap,
  conflictLabel,
  dataBlockLines,
  DECLUTTER,
  DEFAULT_TRAFFIC_OPTIONS,
  findSystem,
  GENERIC_SYSTEM,
  hitTest,
  hitTestDetail,
  inVolume,
  INDRA_SYSTEM,
  leaderVector,
  ownershipOf,
  pointInPolygon,
  routePath,
  ScopeRenderer,
  ScopeView,
  SELEX_SYSTEM,
  selexLabel,
  selexSelectedLabel,
  TrafficPicture,
  verticalLimits,
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

type FakeCtx = Ctx2D & { texts: string[]; dashes: number[][]; fills: string[]; rects: string[] };

function fakeCtx(): FakeCtx {
  const texts: string[] = [];
  const dashes: number[][] = [];
  const fills: string[] = [];
  const rects: string[] = [];
  const noop = () => undefined;
  const ctx = {
    texts, dashes, fills, rects,
    setTransform: noop, beginPath: noop, moveTo: noop, lineTo: noop, stroke: noop,
    arc: noop, closePath: noop, save: noop, restore: noop,
    fill: () => void fills.push(String(ctx.fillStyle)),
    fillRect: () => void rects.push(String(ctx.fillStyle)),
    setLineDash: (d: number[]) => void dashes.push([...d]),
    fillText: (t: string) => void texts.push(t),
    measureText: (t: string) => ({ width: t.length * 7 }) as TextMetrics,
    fillStyle: '' as unknown, strokeStyle: '', lineWidth: 1, font: '', textBaseline: 'middle', textAlign: 'left',
  };
  return ctx as unknown as FakeCtx;
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
  const snap = (t: number, list: AircraftState[], conflicts: Snapshot['conflicts'] = []): Snapshot => ({
    t,
    aircraft: list,
    conflicts,
    events: [],
  });

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

  it('tags conflicting aircraft with a blinking CA and labels the pair', () => {
    const pic = new TrafficPicture(map.projection);
    const other = aircraft({ callsign: 'UAL1', pos: destination(REF, 10, 10 * M_PER_NM) });
    const predicted: Conflict = { a: 'DAL1192', b: 'UAL1', kind: 'predicted', inS: 46, lateralNm: 1.7, verticalFt: 0 };
    pic.update(snap(0, [aircraft(), other], [predicted]));
    expect(pic.conflicts).toEqual([predicted]);
    const view = new ScopeView({ widthPx: 1000, heightPx: 800, rangeNm: 20 });

    const on = fakeCtx();
    new ScopeRenderer(on).drawTraffic(view, pic.list(), DEFAULT_TRAFFIC_OPTIONS, pic.conflicts);
    expect(on.texts).toEqual(expect.arrayContaining(['CA 46s', 'DAL1192 CA', 'UAL1 CA']));

    const off = fakeCtx();
    new ScopeRenderer(off).drawTraffic(view, pic.list(), { ...DEFAULT_TRAFFIC_OPTIONS, blinkOn: false }, pic.conflicts);
    expect(off.texts).toEqual(expect.arrayContaining(['CA 46s', 'DAL1192', 'UAL1']));
    expect(off.texts).not.toContain('DAL1192 CA');

    expect(conflictLabel({ ...predicted, kind: 'loss', lateralNm: 2.43, verticalFt: 600 })).toBe('2.4 NM 06');
  });
});

describe('ATC systems, sectors, ownership, routes', () => {
  const NM = M_PER_NM;
  // Two sectors: WEST (x < 0) and EAST (x > 0), 20 NM squares, SFC–170; HIGH above both.
  const square = (west: boolean) => {
    const x0 = west ? -20 : 0;
    const x1 = west ? 0 : 20;
    return [
      destination(destination(REF, 90, x0 * NM), 180, 20 * NM),
      destination(destination(REF, 90, x1 * NM), 180, 20 * NM),
      destination(destination(REF, 90, x1 * NM), 0, 20 * NM),
      destination(destination(REF, 90, x0 * NM), 0, 20 * NM),
    ].map((p) => (Math.abs(p.lon - REF.lon) < 1e-12 ? { ...p, lon: REF.lon } : p));
  };
  const sectorPack: AirspacePack = {
    ...pack,
    fixes: [...pack.fixes, { id: 'EFIX', kind: 'waypoint', pos: destination(REF, 90, 10 * NM) }],
    areas: [
      { id: 'WEST', kind: 'sector', name: 'West', polygon: square(true), floorFt: 0, ceilingFt: 17_000 },
      { id: 'EAST', kind: 'sector', name: 'East', polygon: square(false), floorFt: 0, ceilingFt: 17_000 },
      { id: 'R1', kind: 'restricted', polygon: square(false), floorFt: 0, ceilingFt: 5000 },
    ],
  };
  const map = buildVideoMap(sectorPack);
  const west = map.sectors.find((s) => s.id === 'WEST')!;
  const east = map.sectors.find((s) => s.id === 'EAST')!;
  const ac = (over: Partial<AircraftState> = {}): AircraftState => ({
    callsign: 'TST1', icaoType: 'A320', wake: 'M', squawk: '2101', origin: 'scenario',
    pos: destination(REF, 270, 10 * NM), altFt: 12_000, headingTrue: 270, trackTrue: 270,
    casKt: 250, tasKt: 300, gsKt: 300, mach: 0.5, vsFpm: 0, destination: 'KJFK',
    target: { altFt: 12_000, headingTrue: 270, turn: null, casKt: 250, mach: null, vsFpm: null, directFix: null, route: [] },
    ...over,
  });
  const xyOf = (a: AircraftState) => map.projection.toLocal(a.pos);

  it('splits pack areas into sectors and other areas, with labels and vertical limits', () => {
    expect(map.sectors.map((s) => [s.id, s.name])).toEqual([['WEST', 'West'], ['EAST', 'East']]);
    expect(map.areas.map((a) => a.kind)).toEqual(['restricted']);
    expect(west.labelAt.x).toBeLessThan(0);
    expect(verticalLimits(west)).toBe('000–170');
    expect(pointInPolygon({ x: -5 * NM, y: 0 }, west.polygon)).toBe(true);
    expect(pointInPolygon({ x: 5 * NM, y: 0 }, west.polygon)).toBe(false);
    // Floor inclusive, ceiling exclusive.
    expect(inVolume(west, { x: -5 * NM, y: 0 }, 0)).toBe(true);
    expect(inVolume(west, { x: -5 * NM, y: 0 }, 17_000)).toBe(false);
  });

  it('classifies owned / incoming / other from the active sector', () => {
    const inWest = ac();
    expect(ownershipOf(inWest, xyOf(inWest), west)).toBe('owned');
    expect(ownershipOf(inWest, xyOf(inWest), null)).toBe('owned'); // all sectors
    // In the west, flying east at 300 kt: enters EAST in ~2 min → incoming.
    const eastbound = ac({ headingTrue: 90, trackTrue: 90 });
    expect(ownershipOf(eastbound, xyOf(eastbound), east)).toBe('incoming');
    // Westbound away from EAST: other.
    expect(ownershipOf(inWest, xyOf(inWest), east)).toBe('other');
    // Above the sector, descending into it within the look-ahead: incoming.
    const descending = ac({ altFt: 19_000, vsFpm: -2000, target: { ...ac().target, altFt: 11_000 } });
    expect(ownershipOf(descending, xyOf(descending), west)).toBe('incoming');
    // Same, but cleared to stay above: other.
    const staying = ac({ altFt: 19_000, vsFpm: -2000, target: { ...ac().target, altFt: 18_000 } });
    expect(ownershipOf(staying, xyOf(staying), west)).toBe('other');
  });

  it('keeps ownership and sector on the traffic picture', () => {
    const pic = new TrafficPicture(map.projection);
    pic.setSectors(map.sectors, 'EAST');
    pic.update({ t: 0, aircraft: [ac(), ac({ callsign: 'TST2', headingTrue: 90, trackTrue: 90 })], conflicts: [], events: [] });
    expect(pic.get('TST1')).toMatchObject({ ownership: 'other', sector: 'WEST' });
    expect(pic.get('TST2')).toMatchObject({ ownership: 'incoming', sector: 'WEST' });
    pic.setSectors(map.sectors, null);
    expect(pic.list().map((t) => t.ownership)).toEqual(['owned', 'owned']);
    expect(pic.toggleRoute('TST1')).toBe(true);
    expect(pic.toggleRoute('TST1')).toBe(false);
  });

  it('computes the route with ETOs at the current ground speed', () => {
    // 10 NM west of REF, direct EFIX (10 NM east) then the runway threshold.
    const a = ac({ target: { ...ac().target, directFix: 'EFIX', route: [] }, gsKt: 300 });
    const fixPos = (id: string) => sectorPack.fixes.find((f) => f.id === id)?.pos;
    const r = routePath(a, 100, map.projection, fixPos, { id: 'RW04', pos: REF });
    expect(r.points.map((p) => p.id)).toEqual(['EFIX', 'RW04']);
    // 20 NM at 300 kt = 240 s; then back 10 NM = 120 s more.
    expect(r.points[0]!.etoS).toBeCloseTo(340, 0);
    expect(r.points[1]!.etoS).toBeCloseTo(460, 0);
  });

  it('formats labels per system', () => {
    const a = ac({ altFt: 34_100, vsFpm: -1800, gsKt: 449, target: { ...ac().target, altFt: 22_000, directFix: 'LIDNO' } });
    expect(selexLabel(a)).toEqual(['TST1', '341↓ 220', 'G449']);
    expect(selexSelectedLabel(a, { ownership: 'owned', sector: 'TC2', nextFix: 'LIDNO' })).toEqual([
      'TST1 M TC2', '341↓ 220 KJFK', 'G449 250 LIDNO', 'A320 2101',
    ]);
    // Indra: own traffic gets the next point on top, others two lines.
    expect(INDRA_SYSTEM.traffic.label(a, { ownership: 'owned', nextFix: 'DODE' })).toEqual(['DODE', 'TST1 449', '341↓ 220']);
    expect(INDRA_SYSTEM.traffic.label(a, { ownership: 'other', nextFix: 'DODE' })).toEqual(['TST1 449', '341↓ 220']);
    expect(INDRA_SYSTEM.traffic.selectedLabel(a, { ownership: 'owned', sector: 'KEN', nextFix: 'DODE' })).toEqual([
      'DODE', 'TST1 449 A320/M', '341↓ 220 KJFK', '250 KEN',
    ]);
    expect(GENERIC_SYSTEM.traffic.label(a, { ownership: 'owned' })[1]).toBe('341↓220 45');
    expect(findSystem('selex')).toBe(SELEX_SYSTEM);
    expect(findSystem('nope')).toBe(GENERIC_SYSTEM);
  });

  it('draws the active sector, boxed selected label, minute-dash vectors and ETOs', () => {
    const view = new ScopeView({ widthPx: 1000, heightPx: 800, rangeNm: 25 });
    const ctx = fakeCtx();
    const r = new ScopeRenderer(ctx);
    r.draw(view, map, undefined, SELEX_SYSTEM, { activeSector: 'EAST' });
    expect(ctx.fills).toEqual(expect.arrayContaining([SELEX_SYSTEM.map.airspace, SELEX_SYSTEM.map.activeSector, SELEX_SYSTEM.map.restrictedFill]));
    expect(ctx.texts).toEqual(expect.arrayContaining(['WEST', 'EAST', '000–170']));

    const pic = new TrafficPicture(map.projection);
    pic.setSectors(map.sectors, 'WEST');
    const a = ac({ target: { ...ac().target, directFix: 'EFIX' } });
    pic.update({ t: 60, aircraft: [a], conflicts: [], events: [] });
    const fixPos = (id: string) => sectorPack.fixes.find((f) => f.id === id)?.pos;
    const routes = [routePath(a, 60, map.projection, fixPos)];
    const tctx = fakeCtx();
    const res = new ScopeRenderer(tctx).drawTraffic(
      view, pic.list(), { ...DEFAULT_TRAFFIC_OPTIONS, vectorMinutes: 2, selected: 'TST1' }, [], SELEX_SYSTEM, routes
    );
    // Boxed label: black box, extended lines.
    expect(tctx.rects).toContain('#000000');
    expect(tctx.texts).toEqual(expect.arrayContaining(['TST1 M WEST', 'EFIX 00:05:00']));
    // 300 kt = 5 NM a minute; at 25 NM range on 800 px, 16 px/NM → 80 px dashes minus a 4 px gap.
    expect(tctx.dashes).toContainEqual([76, 4]);
    // Clicking the symbol is a "target" hit, the label a "label" hit.
    const s = view.toScreen(pic.get('TST1')!.xy);
    expect(hitTestDetail(res.hits, s)?.kind).toBe('target');
    expect(hitTestDetail(res.hits, { x: s.x + 30, y: s.y - 30 })?.kind).toBe('label');
    expect(hitTest(res.hits, s)).toBe('TST1');
  });
});
