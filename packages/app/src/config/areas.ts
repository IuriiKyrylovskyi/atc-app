/**
 * Playable areas: what the scope's area dropdown offers, in order. Each area is
 * one airspace pack (`packs/<packId>.pack.json`, built by `pnpm pack:build`);
 * its sectors come from the pack.
 */
export interface AreaConfig {
  packId: string;
  name: string;
  /** What the area's data is, shown as a tooltip. */
  note: string;
}

export const AREAS: readonly AreaConfig[] = [
  {
    packId: 'ny-tma',
    name: 'New York',
    note: 'FAA CIFP navigation data (public domain); sectors synthetic until N90 / ZNY sector data is available',
  },
  {
    packId: 'kyiv',
    name: 'Kyiv',
    note: 'Airports, runways and navaids from OurAirports; waypoints, routes and Kyiv ACC sectors from EUROCONTROL ERC-06 (development only)',
  },
  {
    packId: 'bangkok',
    name: 'Bangkok',
    note: 'Thailand eAIP: points, navaids, routes; Bangkok TMA sectors and ACC sectors 3N / 6N (development only)',
  },
];
