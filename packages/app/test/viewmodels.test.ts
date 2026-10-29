import { describe, expect, it } from 'vitest';
import type { AircraftState, AirspacePack, Conflict, SimEvent } from '@atc-app/sim';
import {
  aircraftDetail,
  aircraftFromSim,
  airspaceFromPack,
  areaOptions,
  clockHms,
  clockMs,
  cursorReadout,
  flightLevel,
  heading3,
  latLonDm,
  logEntriesFromSim,
  runwayKey,
  trafficSummary,
} from '@/viewmodels';

const aircraft = (over: Partial<AircraftState> = {}): AircraftState => ({
  callsign: 'DAL1192', icaoType: 'B739', wake: 'M', squawk: '2101', origin: 'scenario',
  pos: { lat: 40.8, lon: -73.78 }, altFt: 16_040, headingTrue: 180, trackTrue: 180,
  casKt: 290.4, tasKt: 370, gsKt: 287.2, mach: 0.6, vsFpm: -2000, destination: 'KJFK',
  target: { altFt: 11_000, headingTrue: null, turn: null, casKt: 290, mach: null, vsFpm: null, directFix: 'CRI', route: ['ROBER', 'ASALT', 'DPK', 'KJFK1'] },
  ...over,
});

describe('format', () => {
  it('prints levels, headings, positions and clocks like the scope', () => {
    expect(flightLevel(16_040)).toBe('160');
    expect(flightLevel(4_960)).toBe('050');
    expect(heading3(0.2)).toBe('360');
    expect(heading3(-315)).toBe('045');
    expect(latLonDm({ lat: 40.64, lon: -73.78 })).toBe("N40°38.4' W073°46.8'");
    expect(latLonDm({ lat: -1.5, lon: 30.25 })).toBe("S01°30.0' E030°15.0'");
    expect(clockHms(3725.9)).toBe('01:02:05');
    expect(clockMs(125)).toBe('02:05');
  });

  it('reads the cursor out as position, magnetic bearing and distance', () => {
    // 1° of latitude due north of the reference, 13° west variation: bearing 013 magnetic.
    expect(cursorReadout({ lat: 41.64, lon: -73.78 }, { lat: 40.64, lon: -73.78 }, -13)).toBe(
      "N41°38.4' W073°46.8'   013° 60.0 NM"
    );
  });
});

describe('airspace view-model', () => {
  const pack = {
    meta: {
      id: 'test', name: 'Test TMA', airac: '2611', reference: { lat: 40.64, lon: -73.78 }, magVar: -13,
      sources: [{ name: 'FAA CIFP', licence: 'Public-Domain', url: 'https://x', retrieved: '2026-10-01' }],
    },
    airports: [],
    runways: [
      { id: '22L', airport: 'KJFK', threshold: { lat: 40.65, lon: -73.76 }, end: { lat: 40.62, lon: -73.79 }, headingTrue: 211, lengthM: 3460, widthM: 60, thresholdElevFt: 12, ils: { courseTrue: 211, glideslopeDeg: 3 } },
      { id: '04R', airport: 'KJFK', threshold: { lat: 40.62, lon: -73.79 }, end: { lat: 40.65, lon: -73.76 }, headingTrue: 31, lengthM: 3460, widthM: 60, thresholdElevFt: 12 },
    ],
    fixes: [{ id: 'CRI', kind: 'vor', pos: { lat: 40.61, lon: -73.82 } }],
  } as AirspacePack;
  const sectors = [{ id: 'N90A', name: 'Approach', floorFt: 0, ceilingFt: 17_500 }, { id: 'ZNY', floorFt: 18_000, ceilingFt: 60_000 }];
  const vm = airspaceFromPack(pack, { sectors } as never);

  it('keeps the pack identity, sources and sector labels', () => {
    expect(vm).toMatchObject({ id: 'test', name: 'Test TMA', airac: '2611', magVar: -13 });
    expect(vm.sources).toEqual([{ name: 'FAA CIFP', licence: 'Public-Domain', url: 'https://x', retrieved: '2026-10-01' }]);
    expect(vm.sectors).toEqual([
      { id: 'N90A', name: 'Approach', limits: '000–175', label: 'N90A Approach 000–175' },
      { id: 'ZNY', limits: '180–600', label: 'ZNY  180–600' },
    ]);
  });

  it('looks up fixes, ILS runways and thresholds', () => {
    expect(vm.fixes.get('CRI')).toEqual({ lat: 40.61, lon: -73.82 });
    expect(vm.ilsRunways.has(runwayKey('KJFK', '22L'))).toBe(true);
    expect(vm.ilsRunways.has(runwayKey('KJFK', '04R'))).toBe(false);
    expect(vm.thresholds.get(runwayKey('KJFK', '04R'))).toEqual({ id: 'RW04R', pos: { lat: 40.62, lon: -73.79 } });
  });
});

describe('aircraft view-model', () => {
  it('turns a sim aircraft into display values', () => {
    const vm = aircraftFromSim(aircraft(), -13);
    expect(vm).toMatchObject({
      callsign: 'DAL1192', icaoType: 'B739', wake: 'M', destination: 'KJFK', origin: 'scenario',
      level: '160', clearedLevel: '110', iasKt: 290, gsKt: 287, mach: '.60', heading: '193',
      route: 'DCT CRI ROBER ASALT DPK', established: false,
    });
    expect(vm.approach).toBeUndefined();
    expect(aircraftDetail(vm)).toEqual({
      head: 'DAL1192  B739/M  KJFK  SQ 2101',
      alt: 'ALT 160 → 110',
      spd: 'IAS 290  GS 287  M.60',
      hdg: 'HDG 193',
      nav: 'DCT CRI ROBER ASALT DPK',
    });
  });

  it('drops a cleared level the aircraft is already at, and shows vectors and approaches', () => {
    const vectored = aircraftFromSim(
      aircraft({ altFt: 10_980, target: { ...aircraft().target, altFt: 11_000, headingTrue: 240, directFix: null, route: [] } }),
      0
    );
    expect(vectored.clearedLevel).toBeUndefined();
    expect(vectored.route).toBe('VECTORS');

    const armed = aircraft({ target: { ...aircraft().target, approach: { type: 'ILS', airport: 'KJFK', runway: '22L', phase: 'armed' } } });
    expect(aircraftDetail(aircraftFromSim(armed, 0)).nav).toBe('DCT CRI ROBER ASALT DPK · ILS 22L CLEARED');
    const onGs = aircraft({ target: { ...aircraft().target, approach: { type: 'ILS', airport: 'KJFK', runway: '22L', phase: 'glideslope' } } });
    expect(aircraftDetail(aircraftFromSim(onGs, 0)).nav).toBe('ILS 22L LOC GS');
  });
});

describe('comms log view-model', () => {
  it('prints the events that belong in the log and skips the rest', () => {
    const events: SimEvent[] = [
      { t: 10, type: 'fix_reached', callsign: 'DAL1192', fix: 'CRI' },
      { t: 11, type: 'conflict_alert', a: 'DAL1192', b: 'UAL1', inS: 45.6 },
      { t: 12, type: 'separation_lost', a: 'DAL1192', b: 'UAL1', lateralNm: 2.94, verticalFt: 600 },
      { t: 13, type: 'landed', callsign: 'UAL1', airport: 'KJFK', runway: '22L' },
      { t: 14, type: 'message_rejected', message: { to: 'XYZ1', clearances: [] }, reason: 'unknown aircraft' },
    ];
    expect(logEntriesFromSim(events)).toEqual([
      { t: 11, kind: 'alert', who: 'CA', text: 'DAL1192 / UAL1 loss in 46 s' },
      { t: 12, kind: 'alert', who: 'LOS', text: 'DAL1192 / UAL1 2.9 NM 600 ft' },
      { t: 13, kind: 'info', who: 'UAL1', text: 'landed KJFK 22L' },
      { t: 14, kind: 'error', who: 'XYZ1', text: 'unknown aircraft' },
    ]);
  });
});

describe('traffic summary and areas', () => {
  it('counts aircraft by ownership and the alerting pairs', () => {
    const conflicts = [{ a: 'A', b: 'B', kind: 'predicted', inS: 30, lateralNm: 3, verticalFt: 0 }] as Conflict[];
    expect(trafficSummary([{ ownership: 'owned' }, { ownership: 'incoming' }, { ownership: 'other' }, { ownership: 'owned' }], conflicts)).toEqual({
      aircraft: 4, owned: 2, incoming: 1, conflicts: 1,
    });
  });

  it('offers areas whose pack is built, development-only packs only in development', () => {
    const areas = [
      { packId: 'ny', name: 'New York', note: '' },
      { packId: 'kyiv', name: 'Kyiv', note: '' },
      { packId: 'none', name: 'Nowhere', note: '' },
    ];
    const entry = { name: '', airac: '2611', file: '', bytes: 0, sha256: '', counts: {} };
    const manifest = { ny: { ...entry, id: 'ny' }, kyiv: { ...entry, id: 'kyiv', devOnly: true } };
    const avail = (dev: boolean) => areaOptions(areas, manifest, dev).map((a) => a.available);
    expect(avail(true)).toEqual([true, true, false]);
    expect(avail(false)).toEqual([true, false, false]);
    expect(areaOptions(areas, null, false).every((a) => a.available)).toBe(true);
  });
});
