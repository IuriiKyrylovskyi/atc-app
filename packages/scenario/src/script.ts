/**
 * Scripted scenarios: hand-written traffic for a pack, timed in sim seconds.
 *
 * A script is plain data (no pack positions inside), so the same file works with
 * every AIRAC build of its pack; `buildScenario` resolves it against the loaded
 * pack. The automated generator (§14.4) will emit the same `ScenarioScript`.
 */
import type { AircraftSpawn, AirspacePack, SimConfig, Wind } from '@atc-app/sim';
import { arrivalOnStar, type ArrivalSpec } from './star';

export interface ScriptedArrival extends ArrivalSpec {
  /** Sim time the aircraft appears, s. */
  atS: number;
}

export interface ScenarioScript {
  id: string;
  name: string;
  packId: string;
  seed: number;
  wind?: Wind;
  arrivals: ScriptedArrival[];
}

export interface BuiltScenario {
  config: SimConfig;
  traffic: { atS: number; spawn: AircraftSpawn }[];
}

/** Resolves a script against its pack: the sim config plus timed spawns. */
export function buildScenario(script: ScenarioScript, pack: AirspacePack): BuiltScenario {
  if (pack.meta.id !== script.packId) {
    throw new Error(`Scenario ${script.id} is for pack ${script.packId}, not ${pack.meta.id}`);
  }
  // Discrete squawks in a terminal code block, in spawn order, unless the script sets them.
  let code = 0o2101;
  const traffic = [...script.arrivals]
    .sort((a, b) => a.atS - b.atS)
    .map(({ atS, ...spec }) => ({
      atS,
      spawn: arrivalOnStar(pack, { ...spec, squawk: spec.squawk ?? (code++).toString(8).padStart(4, '0') }),
    }));
  return {
    config: { seed: script.seed, pack, ...(script.wind ? { wind: script.wind } : {}) },
    traffic,
  };
}
