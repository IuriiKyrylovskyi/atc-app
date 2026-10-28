import type { ScenarioScript } from '../script';
import { NY_ARRIVALS } from './ny-arrivals';
import { NY_CONFLICTS } from './ny-conflicts';

export { NY_ARRIVALS, NY_CONFLICTS };

/** Built-in scripted scenarios. */
export const SCENARIOS: readonly ScenarioScript[] = [NY_ARRIVALS, NY_CONFLICTS];

export const scenariosForPack = (packId: string): ScenarioScript[] => SCENARIOS.filter((s) => s.packId === packId);

export const findScenario = (id: string): ScenarioScript | undefined => SCENARIOS.find((s) => s.id === id);
