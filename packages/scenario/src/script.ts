/**
 * Scripted scenarios: hand-written traffic for a pack, timed in sim seconds.
 *
 * A script is plain data (no pack positions inside), so the same file works with
 * every AIRAC build of its pack; `buildScenario` resolves it against the loaded
 * pack. The automated generator (§14.4) will emit the same `ScenarioScript`.
 */
import { courseTo, type AircraftSpawn, type AirspacePack, type SimConfig, type Wind } from '@atc-app/sim';
import { arrivalOnStar, type ArrivalSpec } from './star';

export interface ScriptedArrival extends ArrivalSpec {
  /** Sim time the aircraft appears, s. */
  atS: number;
}

/** Any flight on a fix-to-fix route (overflights, departures, conflict set-ups). */
export interface ScriptedFlight {
  atS: number;
  callsign: string;
  icaoType: string;
  wake?: AircraftSpawn['wake'];
  squawk?: string;
  /** The aircraft appears over this fix, heading for the first route fix. */
  fromFix: string;
  route: string[];
  altFt: number;
  casKt: number;
  clearedAltFt?: number;
  destination?: string;
}

export interface ScenarioScript {
  id: string;
  name: string;
  packId: string;
  seed: number;
  wind?: Wind;
  arrivals: ScriptedArrival[];
  flights?: ScriptedFlight[];
}

export interface BuiltScenario {
  config: SimConfig;
  traffic: { atS: number; spawn: AircraftSpawn }[];
}

/** A spawn over `fromFix`, flying `route`. */
export function flightOnRoute(pack: AirspacePack, spec: Omit<ScriptedFlight, 'atS'>): AircraftSpawn {
  if (spec.route.length === 0) throw new Error(`${spec.callsign}: empty route`);
  const pos = (id: string) => {
    const f = pack.fixes.find((x) => x.id === id);
    if (!f) throw new Error(`${spec.callsign}: fix ${id} is not in pack ${pack.meta.id}`);
    return f.pos;
  };
  const start = pos(spec.fromFix);
  return {
    callsign: spec.callsign,
    icaoType: spec.icaoType,
    ...(spec.wake ? { wake: spec.wake } : {}),
    ...(spec.squawk ? { squawk: spec.squawk } : {}),
    origin: 'scenario',
    pos: start,
    altFt: spec.altFt,
    headingTrue: courseTo(start, pos(spec.route[0]!)),
    casKt: spec.casKt,
    route: [...spec.route],
    ...(spec.clearedAltFt !== undefined ? { clearedAltFt: spec.clearedAltFt } : {}),
    ...(spec.destination ? { destination: spec.destination } : {}),
  };
}

/** Resolves a script against its pack: the sim config plus timed spawns. */
export function buildScenario(script: ScenarioScript, pack: AirspacePack): BuiltScenario {
  if (pack.meta.id !== script.packId) {
    throw new Error(`Scenario ${script.id} is for pack ${script.packId}, not ${pack.meta.id}`);
  }
  const timed: { atS: number; make: (squawk: string) => AircraftSpawn; squawk?: string }[] = [
    ...script.arrivals.map(({ atS, ...spec }) => ({
      atS,
      squawk: spec.squawk,
      make: (squawk: string) => arrivalOnStar(pack, { ...spec, squawk }),
    })),
    ...(script.flights ?? []).map(({ atS, ...spec }) => ({
      atS,
      squawk: spec.squawk,
      make: (squawk: string) => flightOnRoute(pack, { ...spec, squawk }),
    })),
  ];
  // Discrete squawks in a terminal code block, in spawn order, unless the script sets them.
  let code = 0o2101;
  const traffic = timed
    .sort((a, b) => a.atS - b.atS)
    .map((t) => ({ atS: t.atS, spawn: t.make(t.squawk ?? (code++).toString(8).padStart(4, '0')) }));
  return {
    config: { seed: script.seed, pack, ...(script.wind ? { wind: script.wind } : {}) },
    traffic,
  };
}
