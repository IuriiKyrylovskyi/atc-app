/**
 * AIRPORTS CONFIG — replaces levels.config.ts
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHAT CHANGED
 * ------------
 * Each former `levelX` entry is now an AIRPORT. The difficulty knobs that
 * used to live on it (maxPlanes, spawnRate, planesTarget, targetScore,
 * allowedPlaneTypes, intervals) have moved to the shift table. What stays
 * here is only what is genuinely per-place: geometry, art, and fleet.
 *
 * Playable levels are produced by buildLevel(airport, shift, platform).
 * Five shifts per airport, so this file's 20 airports yield 100 levels.
 *
 * ID SCHEME
 * ---------
 *   Airport          lowercase ICAO                 eglc
 *   Runway           {airport}-rwy{number}          eglc-rwy09
 *   Waypoint         5-letter name, globally unique ALPHA
 *   Composed level   {airport}:{shift}              eglc:red-eye
 *   Background       {airport}                      eglc
 *
 * The old `levelN-` runway prefix is gone on purpose: it encoded array
 * POSITION, which is precisely what broke when levels were renumbered —
 * see the two "renumbered from the old level 4" comments in the file this
 * replaces. ICAO does not move when the menu is reordered.
 *
 * PROGRESSIVE DISCLOSURE
 * ----------------------
 * Every runway and waypoint carries `minShift` (1-5). Red-Eye sees only
 * minShift 1 geometry; Holiday Meltdown sees everything. This is how one
 * airport supplies five distinct levels without five copies of its layout.
 *
 * Rule when authoring: minShift 1 must be solvable with one runway and one
 * exit. If an airport has no such reduction, it is not a tier-1 airport.
 */

import type { PlaneColor } from '@/types/game';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface AirportRunway {
  id: string;
  rwNumber: string;
  oppositeRwNumber: string;
  masterWidth: number;
  masterX1: number;
  masterY1: number;
  masterX2: number;
  masterY2: number;
  allowedColors: PlaneColor[];
  /** Lowest shift tier at which this runway is open. */
  minShift: 1 | 2 | 3 | 4 | 5;
}

export interface AirportWaypoint {
  name: string;
  x: number; // 0..1 of viewport
  y: number; // 0..1 of viewport
  description: string;
  allowedColors: PlaneColor[];
  /** Lowest shift tier at which this waypoint is active. */
  minShift: 1 | 2 | 3 | 4 | 5;
}

export interface Airport {
  id: string;
  icao: string;
  city: string;
  displayName: string;
  /** Master image key. Matches airport id by convention. Paired airports use slash format: 'icao1/icao2'. */
  backgroundImage: string;

  tier: 'free' | 'paid';
  /** Store SKU. Omitted for free airports. */
  sku?: string;
  /** Store card copy. */
  pitch: string;
  /** The geometry problem this field poses. Drives store copy and ordering. */
  signature: string;
  /** One-line fact for store/info. */
  brief: string;
  /** One-liner joke/flavour for store/info. */
  funny: string;

  runways: AirportRunway[];
  waypoints: AirportWaypoint[];

  /**
   * Fleet, ordered most to least characteristic of this field. Shifts take
   * a prefix (fleetSize), so early shifts show few silhouettes and late
   * shifts show the full mix. This is also where realism lives: EGLC is a
   * short urban field and cannot take an A380, so type 1 is simply absent.
   *
   * 1 A380 · 2 A340 · 3 A320 · 4 DC-9 · 5 Concorde · 6 777X
   * 7 C-17 · 8 An-22 · 9 MD-11 · 10 Citation · 11 E195 · 12 747-8i
   */
  fleet: number[];

  /** Menu ordering within its tier. */
  order: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// FREE — available from boot, Red-Eye open on all three
// ═══════════════════════════════════════════════════════════════════════════

/** was: level1 (+ the training1/training3 runway copies) */
export const EGLC: Airport = {
  id: 'eglc',
  icao: 'EGLC',
  city: 'London',
  displayName: 'London City',
  backgroundImage: 'eglc', // was 'level-1'

  tier: 'free',
  pitch: 'One runway, one exit, no excuses.',
  signature: 'Single runway. Fundamentals: pathing, alignment, spacing.',
  brief: 'Shortest commercial runway in London, 1,508 m.',
  funny: 'Runway shorter than a Walmart parking lot.',
  order: 1,

  runways: [
    {
      // Single source of truth. level3 previously held a second, diverging
      // copy of this runway (masterX2 3555 vs 3315) — see EGLC_ALT below.
      id: 'eglc-rwy09',
      rwNumber: '09',
      oppositeRwNumber: '27',
      masterWidth: 80,
      masterX1: 2313,
      masterY1: 1537,
      masterX2: 3315,
      masterY2: 1587,
      allowedColors: ['orange', 'violet', 'pink'],
      minShift: 1,
    },
  ],

  waypoints: [
    {
      name: 'ALPHA',
      x: 0.6,
      y: 0.9,
      description: 'Exit to Europe →',
      allowedColors: ['blue', 'green', 'yellow'],
      minShift: 1,
    },
    // TODO(author): the three below are provisional screen-edge positions —
    // BRAVO is carried from the old training3, the other two are new.
    // Verify against the eglc master art before shipping tiers 3+.
    {
      name: 'BRAVO',
      x: 0.2,
      y: 0.3,
      description: 'North transit ↑',
      allowedColors: ['orange', 'yellow', 'violet'],
      minShift: 3,
    },
    {
      name: 'CHARL',
      x: 0.97,
      y: 0.25,
      description: 'Northeast corridor →',
      allowedColors: ['pink', 'violet'],
      minShift: 4,
    },
    {
      name: 'DELTA',
      x: 0.03,
      y: 0.55,
      description: 'West arrivals ←',
      allowedColors: ['blue', 'green'],
      minShift: 5,
    },
  ],

  // Short urban field: regionals and bizjets. No A380 (type 1) — it cannot
  // physically use London City, and the old level1 config allowed it.
  fleet: [11, 3, 10, 4, 6, 9, 2, 12, 5, 7],
};

/** was: level2 (+ the training2 runway copies) */
export const EGLL: Airport = {
  id: 'egll',
  icao: 'EGLL',
  city: 'London',
  displayName: 'Heathrow',
  backgroundImage: 'egll', // was 'level-2'

  tier: 'paid',
  sku: 'airport.egll',
  pitch: 'Two parallels and a queue that never ends.',
  signature:
    'Parallel runways. Teaches allocation — which runway, and colour matching starts to bite.',
  brief: "World's busiest international airport by passenger volume.",
  funny: 'The unofficial fifth runway is the M4 motorway.',
  order: 20,

  runways: [
    {
      id: 'egll-rwy11',
      rwNumber: '11',
      oppositeRwNumber: '29',
      masterWidth: 65,
      masterX1: 2265,
      masterY1: 2360,
      masterX2: 3470,
      masterY2: 2543,
      allowedColors: ['blue', 'green', 'yellow', 'pink', 'violet'],
      minShift: 1,
    },
    {
      // Second parallel opens at Midday Mix — this is the moment the player
      // first has to choose a runway rather than just find one.
      id: 'egll-rwy10',
      rwNumber: '10',
      oppositeRwNumber: '28',
      masterWidth: 54,
      masterX1: 1939,
      masterY1: 969,
      masterX2: 2959,
      masterY2: 1069,
      allowedColors: ['green', 'blue', 'yellow', 'pink', 'violet'],
      minShift: 3,
    },
    // NOTE: the old level2 had RWY18L and RWY13 commented out, on the
    // superseded centerX/centerY + positionOverrides form. If that art still
    // has them, re-author with `pnpm runway pick` and add here at minShift 4
    // and 5 — this airport wants two more runways for its top tiers.
  ],

  waypoints: [
    {
      name: 'JANJO',
      x: 0.97,
      y: 0.5,
      description: 'Traffic queue to Europe →',
      allowedColors: ['orange', 'yellow', 'green'],
      minShift: 1,
    },
    {
      name: 'BIMBO',
      x: 0.03,
      y: 0.15,
      description: 'Arrivals from North ←',
      allowedColors: ['pink', 'violet', 'blue'],
      minShift: 2,
    },
  ],

  fleet: [3, 12, 1, 6, 11, 9, 2, 4, 5, 7, 10, 8],
};

/** was: level4 (+ the training4 runway copies) */
export const KJFK: Airport = {
  id: 'kjfk',
  icao: 'KJFK',
  city: 'New York',
  displayName: 'JFK',
  backgroundImage: 'kjfk', // was 'level-4'

  tier: 'paid',
  sku: 'airport.kjfk',
  pitch: 'Runways that all want to cross each other.',
  signature: 'Crossing runways, multiple corridors. Teaches conflict geometry at intersections.',
  brief: 'Gateway to America, four runways, 60+ airlines.',
  funny: 'Named after a president nobody can find on the map.',
  order: 5,

  runways: [
    {
      id: 'kjfk-rwy06',
      rwNumber: '06',
      oppositeRwNumber: '24',
      // TODO(author): original level4 had masterWidth 678 — almost certainly
      // a typo (every other runway is 40-80). Fixed to 45.
      masterWidth: 45,
      masterX1: 2875,
      masterY1: 1650,
      masterX2: 3550,
      masterY2: 1713,
      allowedColors: ['blue', 'green', 'violet'],
      minShift: 1,
    },
    {
      id: 'kjfk-rwy24',
      rwNumber: '24',
      oppositeRwNumber: '06',
      masterWidth: 46,
      masterX1: 4124,
      masterY1: 990,
      masterX2: 3466,
      masterY2: 610,
      allowedColors: ['yellow', 'orange'],
      minShift: 3,
    },
    {
      id: 'kjfk-rwy15',
      rwNumber: '15',
      oppositeRwNumber: '33',
      // RESOLVED: level4-rw15 previously shared the master point (2373,1334)
      // with level5-rw09L despite being on a different master image —
      // flagged as copy-paste in the old file. The values below are level4's
      // own. Still worth re-picking:
      //   pnpm runway pick kjfk 16x9 <pixelX> <pixelY>
      masterWidth: 40,
      masterX1: 2286,
      masterY1: 1010,
      masterX2: 2460,
      masterY2: 1658,
      allowedColors: ['pink'],
      minShift: 4,
    },
  ],

  waypoints: [
    {
      name: 'DELTX',
      x: 0.95,
      y: 0.3,
      description: 'International route →',
      allowedColors: ['orange', 'yellow', 'pink'],
      minShift: 1,
    },
    {
      name: 'ECHOS',
      x: 0.05,
      y: 0.7,
      description: 'Domestic arrivals ←',
      allowedColors: ['blue', 'green', 'pink'],
      minShift: 2,
    },
  ],

  fleet: [12, 1, 6, 9, 3, 2, 11, 4, 10, 5, 7, 8],
};

// ═══════════════════════════════════════════════════════════════════════════
// PAID
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// FREE (additional)
// ═══════════════════════════════════════════════════════════════════════════

/** JSON order 2. Bali Ngurah Rai — Denpasar, Indonesia */
export const WADD: Airport = {
  id: 'wadd',
  icao: 'WADD',
  city: 'Denpasar',
  displayName: 'Bali Ngurah Rai',
  backgroundImage: 'wadd',

  tier: 'free',
  pitch: 'One runway over the sea, heavy traffic at sunset.',
  signature: 'Single runway with long ocean approach. Teaches timing over water.',
  brief: "Indonesia's island gateway, one runway over the sea.",
  funny: 'The airport is closer to the beach than the hotels.',
  order: 2,

  runways: [
    {
      id: 'wadd-rwy09',
      rwNumber: '09',
      oppositeRwNumber: '27',
      masterWidth: 60,
      masterX1: 2200,
      masterY1: 1500,
      masterX2: 3200,
      masterY2: 1580,
      allowedColors: ['blue', 'green', 'yellow', 'pink'],
      minShift: 1,
    },
  ],

  waypoints: [
    {
      name: 'ALPHB',
      x: 0.5,
      y: 0.9,
      description: 'Ocean approach →',
      allowedColors: ['orange', 'violet'],
      minShift: 1,
    },
    {
      name: 'BRAVJ',
      x: 0.05,
      y: 0.4,
      description: 'West arrival ←',
      allowedColors: ['blue', 'pink', 'orange'],
      minShift: 3,
    },
  ],

  fleet: [3, 6, 1, 10, 9, 12, 4, 2, 5, 11, 7, 8],
};

/** JSON order 3. San Diego / Tijuana — paired field */
export const KSDM_MMTJ: Airport = {
  id: 'ksdm/mmtj',
  icao: 'KSDM',
  city: 'San Diego / Tijuana',
  displayName: 'San Diego / Tijuana',
  backgroundImage: 'ksdm/mmtj',

  tier: 'free',
  pitch: 'Two airports on opposite sides of the border.',
  signature: 'Paired airports sharing one airspace. Teaches cross-border handoffs.',
  brief: 'GA field next to the border; Tijuana sits 300 m from the wall.',
  funny: 'You can land and be in another country before deplaning.',
  order: 3,

  runways: [
    {
      id: 'ksdm/mmtj-rwy08L',
      rwNumber: '08L',
      oppositeRwNumber: '26R',
      masterWidth: 40,
      masterX1: 2200,
      masterY1: 1200,
      masterX2: 2800,
      masterY2: 1240,
      allowedColors: ['blue', 'green'],
      minShift: 1,
    },
    {
      id: 'ksdm/mmtj-rwy08R',
      rwNumber: '08R',
      oppositeRwNumber: '26L',
      masterWidth: 40,
      masterX1: 2200,
      masterY1: 1400,
      masterX2: 2800,
      masterY2: 1440,
      allowedColors: ['yellow', 'orange'],
      minShift: 2,
    },
    {
      id: 'ksdm/mmtj-rwy09',
      rwNumber: '09',
      oppositeRwNumber: '27',
      masterWidth: 40,
      masterX1: 1200,
      masterY1: 1800,
      masterX2: 1800,
      masterY2: 1840,
      allowedColors: ['pink', 'violet'],
      minShift: 3,
    },
  ],

  waypoints: [
    {
      name: 'ALPHK',
      x: 0.5,
      y: 0.9,
      description: 'South departure →',
      allowedColors: ['orange', 'yellow', 'pink', 'violet'],
      minShift: 1,
    },
    {
      name: 'BRAVK',
      x: 0.05,
      y: 0.3,
      description: 'North arrival ←',
      allowedColors: ['blue', 'pink', 'violet'],
      minShift: 2,
    },
    {
      name: 'CHARJ',
      x: 0.95,
      y: 0.4,
      description: 'East corridor →',
      allowedColors: ['green', 'orange'],
      minShift: 4,
    },
  ],

  fleet: [3, 4, 6, 10, 11, 12, 9, 2, 1, 5, 7, 8],
};

/** was: level5 */
export const YSSY: Airport = {
  id: 'yssy',
  icao: 'YSSY',
  city: 'Sydney',
  displayName: 'Kingsford Smith',
  backgroundImage: 'yssy', // was 'level-5'

  tier: 'paid',
  sku: 'airport.yssy',
  pitch: 'Four runways over a harbour.',
  signature: 'Two runway pairs at right angles. Long overwater legs make mistakes slow to correct.',
  brief: "Australia's busiest, three runways over Botany Bay.",
  funny: 'Botany Bay planespotting: bring sunglasses and a stiff drink.',
  order: 4,

  runways: [
    // ⚠️ TODO(author): only yssy-rwy09L has real authored coordinates. The
    // other three carry negative masterX/masterY, which is the unmigrated
    // centerX/centerY fallback — 16x9-accurate at best, drifting on every
    // other ratio. Re-pick all three:
    //   pnpm runway pick yssy 16x9 <pixelX> <pixelY>
    {
      id: 'yssy-rwy09L',
      rwNumber: '09',
      oppositeRwNumber: '27',
      masterWidth: 40,
      masterX1: 2149,
      masterY1: 1334,
      masterX2: 2597,
      masterY2: 1334,
      allowedColors: ['blue', 'green'],
      minShift: 1,
    },
    {
      id: 'yssy-rwy27L',
      rwNumber: '27',
      oppositeRwNumber: '09',
      masterWidth: 40,
      masterX1: 1834,
      masterY1: 800,
      masterX2: 2292,
      masterY2: 800,
      allowedColors: ['yellow', 'orange'],
      minShift: 2,
    },
    {
      id: 'yssy-rwy09R',
      rwNumber: '09',
      oppositeRwNumber: '27',
      masterWidth: 40,
      masterX1: 866,
      masterY1: 2256,
      masterX2: 1324,
      masterY2: 2256,
      allowedColors: ['blue', 'green'],
      minShift: 3,
    },
    {
      id: 'yssy-rwy27R',
      rwNumber: '27',
      oppositeRwNumber: '09',
      masterWidth: 40,
      masterX1: 1834,
      masterY1: 2756,
      masterX2: 2292,
      masterY2: 2756,
      allowedColors: ['yellow', 'orange'],
      minShift: 4,
    },
  ],

  waypoints: [
    {
      name: 'FOXTR',
      x: 0.97,
      y: 0.5,
      description: 'East departure →',
      allowedColors: ['violet', 'pink', 'yellow', 'orange'],
      minShift: 1,
    },
    {
      name: 'GOLFY',
      x: 0.03,
      y: 0.5,
      description: 'West arrival ←',
      allowedColors: ['violet', 'pink'],
      minShift: 2,
    },
    {
      name: 'HOTEL',
      x: 0.5,
      y: 0.03,
      description: 'North transit ↑',
      allowedColors: ['blue', 'green'],
      minShift: 3,
    },
  ],

  fleet: [1, 2, 3, 4, 10, 12, 6, 9, 11, 5, 7, 8],
};

/** was: level6 */
export const VHHH: Airport = {
  id: 'vhhh',
  icao: 'VHHH',
  city: 'Hong Kong',
  displayName: 'Chek Lap Kok',
  backgroundImage: 'vhhh', // was 'level-6'

  tier: 'paid',
  sku: 'airport.vhhh',
  pitch: 'Water on three sides, no room for error.',
  signature:
    'Crossing runways in a tight basin. The full twelve-type fleet, including superheavies.',
  brief: 'Built on reclaimed land, surrounded by water on three sides.',
  funny: 'Built on an island that was not there in 1990.',
  order: 8,

  runways: [
    // ⚠️ TODO(author): none of these four have authored master coordinates.
    // All are on the 16x9-only fallback. Re-pick all four before ship — this
    // is the flagship paid airport and currently the least accurate one in
    // the project.
    {
      id: 'vhhh-rwy08',
      rwNumber: '08',
      oppositeRwNumber: '26',
      masterWidth: 40,
      masterX1: 2027,
      masterY1: 1446,
      masterX2: 2481,
      masterY2: 1634,
      allowedColors: ['blue', 'green', 'violet'],
      minShift: 1,
    },
    {
      id: 'vhhh-rwy26',
      rwNumber: '26',
      oppositeRwNumber: '08',
      masterWidth: 40,
      masterX1: 3573,
      masterY1: 1006,
      masterX2: 3121,
      masterY2: 634,
      allowedColors: ['yellow', 'orange', 'pink'],
      minShift: 2,
    },
    {
      id: 'vhhh-rwy17',
      rwNumber: '17',
      oppositeRwNumber: '35',
      masterWidth: 40,
      masterX1: 2358,
      masterY1: 802,
      masterX2: 2242,
      masterY2: 1248,
      allowedColors: ['violet', 'pink'],
      minShift: 4,
    },
    {
      id: 'vhhh-rwy35',
      rwNumber: '35',
      oppositeRwNumber: '17',
      masterWidth: 40,
      masterX1: 2242,
      masterY1: 1690,
      masterX2: 2416,
      masterY2: 1574,
      allowedColors: ['blue', 'green'],
      minShift: 5,
    },
  ],

  waypoints: [
    {
      name: 'INDIA',
      x: 0.95,
      y: 0.2,
      description: 'Northeast route →',
      allowedColors: ['orange', 'yellow', 'pink', 'violet'],
      minShift: 1,
    },
    {
      name: 'JULIE',
      x: 0.95,
      y: 0.8,
      description: 'Southeast route →',
      allowedColors: ['violet', 'pink'],
      minShift: 2,
    },
    {
      name: 'KILOS',
      x: 0.05,
      y: 0.5,
      description: 'West corridor ←',
      allowedColors: ['blue', 'green'],
      minShift: 3,
    },
    {
      name: 'LIMAX',
      x: 0.5,
      y: 0.05,
      description: 'North transit ↑',
      allowedColors: ['orange', 'pink', 'violet'],
      minShift: 4,
    },
  ],

  fleet: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
};

/** JSON order 6. Dubai / Sharjah — paired field */
export const OMDB_OMSJ: Airport = {
  id: 'omdb/omsj',
  icao: 'OMDB',
  city: 'Dubai / Sharjah',
  displayName: 'Dubai / Sharjah',
  backgroundImage: 'omdb/omsj',

  tier: 'paid',
  sku: 'airport.omdb-omsj',
  pitch: 'Two hubs bookending the desert.',
  signature: 'Parallel runways with long desert legs. Teaches speed management on final.',
  brief: "World's second-busiest by traffic; Sharjah is Air Arabia's base.",
  funny: 'Two airports, one mirage, zero rain.',
  order: 6,

  runways: [
    {
      id: 'omdb/omsj-rwy12L',
      rwNumber: '12L',
      oppositeRwNumber: '30R',
      masterWidth: 60,
      masterX1: 2200,
      masterY1: 1400,
      masterX2: 2950,
      masterY2: 1460,
      allowedColors: ['blue', 'green'],
      minShift: 1,
    },
    {
      id: 'omdb/omsj-rwy12R',
      rwNumber: '12R',
      oppositeRwNumber: '30L',
      masterWidth: 60,
      masterX1: 2200,
      masterY1: 1650,
      masterX2: 2950,
      masterY2: 1710,
      allowedColors: ['yellow', 'orange'],
      minShift: 2,
    },
    {
      id: 'omdb/omsj-rwy12',
      rwNumber: '12',
      oppositeRwNumber: '30',
      masterWidth: 50,
      masterX1: 1200,
      masterY1: 1900,
      masterX2: 1800,
      masterY2: 1950,
      allowedColors: ['violet', 'pink'],
      minShift: 3,
    },
  ],

  waypoints: [
    {
      name: 'INDID',
      x: 0.5,
      y: 0.9,
      description: 'Desert approach →',
      allowedColors: ['orange', 'yellow', 'pink', 'violet'],
      minShift: 1,
    },
    {
      name: 'JULID',
      x: 0.05,
      y: 0.4,
      description: 'West arrival ←',
      allowedColors: ['blue', 'pink', 'violet'],
      minShift: 2,
    },
    {
      name: 'KILID',
      x: 0.95,
      y: 0.3,
      description: 'East corridor →',
      allowedColors: ['green', 'orange'],
      minShift: 4,
    },
  ],

  fleet: [1, 2, 3, 6, 12, 9, 4, 10, 11, 5, 7, 8],
};

/** JSON order 7. Tokyo Haneda */
export const RJTT: Airport = {
  id: 'rjtt',
  icao: 'RJTT',
  city: 'Tokyo',
  displayName: 'Haneda',
  backgroundImage: 'rjtt',

  tier: 'paid',
  sku: 'airport.rjtt',
  pitch: 'Four runways tangled over Tokyo Bay.',
  signature: 'Cross-and-parallel tangle. Teaches early runway assignment under pressure.',
  brief: 'Four runways in a cross-and-parallel tangle over Tokyo Bay.',
  funny: 'Four runways and still only one exit.',
  order: 7,

  runways: [
    {
      id: 'rjtt-rwy16L',
      rwNumber: '16L',
      oppositeRwNumber: '34R',
      masterWidth: 45,
      masterX1: 2100,
      masterY1: 1400,
      masterX2: 2700,
      masterY2: 1445,
      allowedColors: ['blue', 'green'],
      minShift: 1,
    },
    {
      id: 'rjtt-rwy16R',
      rwNumber: '16R',
      oppositeRwNumber: '34L',
      masterWidth: 45,
      masterX1: 2100,
      masterY1: 1650,
      masterX2: 2700,
      masterY2: 1695,
      allowedColors: ['yellow', 'orange'],
      minShift: 2,
    },
    {
      id: 'rjtt-rwy04',
      rwNumber: '04',
      oppositeRwNumber: '22',
      masterWidth: 40,
      masterX1: 1800,
      masterY1: 900,
      masterX2: 2350,
      masterY2: 940,
      allowedColors: ['violet', 'pink'],
      minShift: 4,
    },
  ],

  waypoints: [
    {
      name: 'OSAKA',
      x: 0.95,
      y: 0.3,
      description: 'Bay departure →',
      allowedColors: ['orange', 'yellow', 'pink', 'violet'],
      minShift: 1,
    },
    {
      name: 'NAGOYA',
      x: 0.05,
      y: 0.7,
      description: 'West arrival ←',
      allowedColors: ['blue', 'pink', 'violet'],
      minShift: 2,
    },
    {
      name: 'TOKYO',
      x: 0.5,
      y: 0.05,
      description: 'North transit ↑',
      allowedColors: ['green', 'orange'],
      minShift: 3,
    },
  ],

  fleet: [3, 12, 6, 1, 10, 9, 2, 4, 11, 5, 7, 8],
};

/** JSON order 9. Madrid Barajas */
export const LEMD: Airport = {
  id: 'lemd',
  icao: 'LEMD',
  city: 'Madrid',
  displayName: 'Barajas',
  backgroundImage: 'lemd',

  tier: 'paid',
  sku: 'airport.lemd',
  pitch: 'Four runways fanning from a central terminal.',
  signature:
    'Dual parallel pairs with staggered thresholds. Teaches spacing across multiple flight paths.',
  brief: "Spain's main hub, four runways, 600 m elevation.",
  funny: 'So big it has its own weather and zip code.',
  order: 9,

  runways: [
    {
      id: 'lemd-rwy14L',
      rwNumber: '14L',
      oppositeRwNumber: '32R',
      masterWidth: 45,
      masterX1: 2100,
      masterY1: 1400,
      masterX2: 2700,
      masterY2: 1445,
      allowedColors: ['blue', 'green'],
      minShift: 1,
    },
    {
      id: 'lemd-rwy14R',
      rwNumber: '14R',
      oppositeRwNumber: '32L',
      masterWidth: 45,
      masterX1: 2100,
      masterY1: 1650,
      masterX2: 2700,
      masterY2: 1695,
      allowedColors: ['yellow', 'orange'],
      minShift: 2,
    },
    {
      id: 'lemd-rwy18L',
      rwNumber: '18L',
      oppositeRwNumber: '36R',
      masterWidth: 45,
      masterX1: 1800,
      masterY1: 900,
      masterX2: 2350,
      masterY2: 945,
      allowedColors: ['violet', 'pink'],
      minShift: 3,
    },
  ],

  waypoints: [
    {
      name: 'MADRID',
      x: 0.95,
      y: 0.3,
      description: 'East departure →',
      allowedColors: ['orange', 'yellow', 'pink', 'violet'],
      minShift: 1,
    },
    {
      name: 'BARAJ',
      x: 0.05,
      y: 0.7,
      description: 'West arrival ←',
      allowedColors: ['blue', 'pink', 'violet'],
      minShift: 2,
    },
    {
      name: 'CASTEL',
      x: 0.5,
      y: 0.05,
      description: 'North transit ↑',
      allowedColors: ['green', 'orange'],
      minShift: 4,
    },
  ],

  fleet: [3, 6, 12, 1, 10, 9, 2, 4, 11, 5, 7, 8],
};

/** JSON order 10. San Francisco */
export const KSFO: Airport = {
  id: 'ksfo',
  icao: 'KSFO',
  city: 'San Francisco',
  displayName: 'San Francisco',
  backgroundImage: 'ksfo',

  tier: 'paid',
  sku: 'airport.ksfo',
  pitch: 'Four runways over water, with wake turbulence for days.',
  signature:
    'Parallel runways over San Francisco Bay. Teaches wake separation and wind shear awareness.',
  brief: 'Four runways over San Francisco Bay, heavy wake turbulence.',
  funny: 'Geese file flight plans before the airlines do.',
  order: 10,

  runways: [
    {
      id: 'ksfo-rwy10L',
      rwNumber: '10L',
      oppositeRwNumber: '28R',
      masterWidth: 60,
      masterX1: 2200,
      masterY1: 1400,
      masterX2: 2950,
      masterY2: 1460,
      allowedColors: ['blue', 'green'],
      minShift: 1,
    },
    {
      id: 'ksfo-rwy10R',
      rwNumber: '10R',
      oppositeRwNumber: '28L',
      masterWidth: 60,
      masterX1: 2200,
      masterY1: 1650,
      masterX2: 2950,
      masterY2: 1710,
      allowedColors: ['yellow', 'orange'],
      minShift: 2,
    },
    {
      id: 'ksfo-rwy01L',
      rwNumber: '01L',
      oppositeRwNumber: '19R',
      masterWidth: 60,
      masterX1: 1200,
      masterY1: 1900,
      masterX2: 1800,
      masterY2: 1960,
      allowedColors: ['pink', 'violet'],
      minShift: 4,
    },
  ],

  waypoints: [
    {
      name: 'SFOBAY',
      x: 0.5,
      y: 0.9,
      description: 'Bay approach →',
      allowedColors: ['orange', 'yellow', 'pink', 'violet'],
      minShift: 1,
    },
    {
      name: 'SFOBRG',
      x: 0.05,
      y: 0.4,
      description: 'West arrival ←',
      allowedColors: ['blue', 'pink', 'violet'],
      minShift: 2,
    },
    {
      name: 'SFOSND',
      x: 0.95,
      y: 0.3,
      description: 'East corridor →',
      allowedColors: ['green', 'orange'],
      minShift: 4,
    },
  ],

  fleet: [12, 6, 1, 3, 10, 9, 2, 4, 11, 5, 7, 8],
};

/** JSON order 11. Galeão International */
export const SBJL: Airport = {
  id: 'sbjl',
  icao: 'SBJL',
  city: 'Rio de Janeiro',
  displayName: 'Galeão',
  backgroundImage: 'sbjl',

  tier: 'paid',
  sku: 'airport.sbjl',
  pitch: 'Two runways on a coastal spit, wind always shifting.',
  signature: 'Tidal reach and sea breeze changes. Teaches adapting to shifting wind patterns.',
  brief: '',
  funny: '',
  order: 11,

  runways: [
    {
      id: 'sbjl-rwy15',
      rwNumber: '15',
      oppositeRwNumber: '33',
      masterWidth: 45,
      masterX1: 2200,
      masterY1: 1400,
      masterX2: 2800,
      masterY2: 1445,
      allowedColors: ['blue', 'green'],
      minShift: 1,
    },
    {
      id: 'sbjl-rwy10',
      rwNumber: '10',
      oppositeRwNumber: '28',
      masterWidth: 45,
      masterX1: 1800,
      masterY1: 900,
      masterX2: 2350,
      masterY2: 945,
      allowedColors: ['yellow', 'orange'],
      minShift: 2,
    },
  ],

  waypoints: [
    {
      name: 'RIOSEA',
      x: 0.5,
      y: 0.9,
      description: 'Coastal approach →',
      allowedColors: ['orange', 'yellow', 'pink', 'violet'],
      minShift: 1,
    },
    {
      name: 'RIOBRG',
      x: 0.05,
      y: 0.5,
      description: 'West arrival ←',
      allowedColors: ['blue', 'pink', 'violet'],
      minShift: 2,
    },
    {
      name: 'RAPOSA',
      x: 0.95,
      y: 0.3,
      description: 'East corridor →',
      allowedColors: ['green', 'orange'],
      minShift: 4,
    },
  ],

  fleet: [3, 12, 6, 9, 10, 2, 1, 4, 11, 5, 7, 8],
};

/** JSON order 12. Toronto Pearson */
export const CYYZ: Airport = {
  id: 'cyyz',
  icao: 'CYYZ',
  city: 'Toronto',
  displayName: 'Toronto Pearson',
  backgroundImage: 'cyyz',

  tier: 'paid',
  sku: 'airport.cyyz',
  pitch: 'Five runways in two complexes, all under one tower.',
  signature: 'Diverse runway orientations, staggered peaks. Teaches rapid heading changes.',
  brief: "Canada's busiest, five runways in two complexes.",
  funny: 'The IATA code is the same as a WWII RAF squadron.',
  order: 12,

  runways: [
    {
      id: 'cyyz-rwy05',
      rwNumber: '05',
      oppositeRwNumber: '23',
      masterWidth: 45,
      masterX1: 2200,
      masterY1: 1400,
      masterX2: 2850,
      masterY2: 1445,
      allowedColors: ['blue', 'green'],
      minShift: 1,
    },
    {
      id: 'cyyz-rwy06L',
      rwNumber: '06L',
      oppositeRwNumber: '24R',
      masterWidth: 60,
      masterX1: 2200,
      masterY1: 1650,
      masterX2: 2950,
      masterY2: 1710,
      allowedColors: ['yellow', 'orange'],
      minShift: 2,
    },
    {
      id: 'cyyz-rwy15L',
      rwNumber: '15L',
      oppositeRwNumber: '33R',
      masterWidth: 60,
      masterX1: 1800,
      masterY1: 900,
      masterX2: 2400,
      masterY2: 960,
      allowedColors: ['pink', 'violet'],
      minShift: 4,
    },
  ],

  waypoints: [
    {
      name: 'TORONTO',
      x: 0.5,
      y: 0.9,
      description: 'North approach →',
      allowedColors: ['orange', 'yellow', 'pink', 'violet'],
      minShift: 1,
    },
    {
      name: 'CNTRK',
      x: 0.05,
      y: 0.5,
      description: 'West arrival ←',
      allowedColors: ['blue', 'pink', 'violet'],
      minShift: 2,
    },
    {
      name: 'GTO',
      x: 0.95,
      y: 0.3,
      description: 'East corridor →',
      allowedColors: ['green', 'orange'],
      minShift: 4,
    },
  ],

  fleet: [3, 6, 12, 1, 10, 9, 2, 4, 11, 5, 7, 8],
};

/** JSON order 13. Seoul Incheon */
export const RKSI: Airport = {
  id: 'rksi',
  icao: 'RKSI',
  city: 'Seoul',
  displayName: 'Incheon',
  backgroundImage: 'rksi',

  tier: 'paid',
  sku: 'airport.rksi',
  pitch: 'Four parallels stretching to the east sea.',
  signature: 'Dual parallel pairs with long finals. Teaches endurance under sustained pressure.',
  brief: 'Four parallel runways, Koreas main gateway since 2001.',
  funny: 'Built on an island that was mostly swamp and stubbornness.',
  order: 13,

  runways: [
    {
      id: 'rksi-rwy15L',
      rwNumber: '15L',
      oppositeRwNumber: '33R',
      masterWidth: 60,
      masterX1: 2200,
      masterY1: 1400,
      masterX2: 2950,
      masterY2: 1460,
      allowedColors: ['blue', 'green'],
      minShift: 1,
    },
    {
      id: 'rksi-rwy15R',
      rwNumber: '15R',
      oppositeRwNumber: '33L',
      masterWidth: 60,
      masterX1: 2200,
      masterY1: 1650,
      masterX2: 2950,
      masterY2: 1710,
      allowedColors: ['yellow', 'orange'],
      minShift: 2,
    },
    {
      id: 'rksi-rwy16L',
      rwNumber: '16L',
      oppositeRwNumber: '34R',
      masterWidth: 60,
      masterX1: 1800,
      masterY1: 900,
      masterX2: 2400,
      masterY2: 960,
      allowedColors: ['pink', 'violet'],
      minShift: 3,
    },
  ],

  waypoints: [
    {
      name: 'SEOUL',
      x: 0.5,
      y: 0.9,
      description: 'Eastern approach →',
      allowedColors: ['orange', 'yellow', 'pink', 'violet'],
      minShift: 1,
    },
    {
      name: 'INCHN',
      x: 0.05,
      y: 0.4,
      description: 'West arrival ←',
      allowedColors: ['blue', 'pink', 'violet'],
      minShift: 2,
    },
    {
      name: 'BICHE',
      x: 0.95,
      y: 0.3,
      description: 'East corridor →',
      allowedColors: ['green', 'orange'],
      minShift: 4,
    },
  ],

  fleet: [3, 6, 12, 1, 10, 9, 2, 4, 11, 5, 7, 8],
};

/** JSON order 14. Venice Marco Polo */
export const LIPZ: Airport = {
  id: 'lipz',
  icao: 'LIPZ',
  city: 'Venice',
  displayName: 'Marco Polo',
  backgroundImage: 'lipz',

  tier: 'paid',
  sku: 'airport.lipz',
  pitch: 'Island field with lagoon approaches.',
  signature: 'Constrained by water on three sides. Teaches precision in tight airspace.',
  brief: 'Lagoon airport with water on three sides, no room for error.',
  funny: 'Arrive by plane, leave by gondola.',
  order: 14,

  runways: [
    {
      id: 'lipz-rwy04L',
      rwNumber: '04L',
      oppositeRwNumber: '22R',
      masterWidth: 40,
      masterX1: 2200,
      masterY1: 1400,
      masterX2: 2750,
      masterY2: 1440,
      allowedColors: ['blue', 'green'],
      minShift: 1,
    },
    {
      id: 'lipz-rwy04R',
      rwNumber: '04R',
      oppositeRwNumber: '22L',
      masterWidth: 40,
      masterX1: 2200,
      masterY1: 1650,
      masterX2: 2750,
      masterY2: 1690,
      allowedColors: ['yellow', 'orange'],
      minShift: 2,
    },
  ],

  waypoints: [
    {
      name: 'VENICE',
      x: 0.5,
      y: 0.9,
      description: 'Lagoon approach →',
      allowedColors: ['orange', 'yellow', 'pink', 'violet'],
      minShift: 1,
    },
    {
      name: 'VENBRG',
      x: 0.05,
      y: 0.5,
      description: 'West arrival ←',
      allowedColors: ['blue', 'pink', 'violet'],
      minShift: 2,
    },
    {
      name: 'VENEZ',
      x: 0.95,
      y: 0.3,
      description: 'East corridor →',
      allowedColors: ['green', 'orange'],
      minShift: 4,
    },
  ],

  fleet: [3, 12, 6, 10, 9, 11, 2, 4, 1, 5, 7, 8],
};

/** JSON order 15. San Diego */
export const KSAN: Airport = {
  id: 'ksan',
  icao: 'KSAN',
  city: 'San Diego',
  displayName: 'San Diego',
  backgroundImage: 'ksan',

  tier: 'paid',
  sku: 'airport.ksan',
  pitch: 'Single runway squeezed between bay and city.',
  signature:
    'Short-field single runway with urban overrun. Teaches precision in constrained spaces.',
  brief: 'Busiest single-runway airport in the United States.',
  funny: 'Planes land so low they blot out the sun from the boardwalk.',
  order: 15,

  runways: [
    {
      id: 'ksan-rwy09',
      rwNumber: '09',
      oppositeRwNumber: '27',
      masterWidth: 60,
      masterX1: 2200,
      masterY1: 1400,
      masterX2: 3100,
      masterY2: 1460,
      allowedColors: ['blue', 'green', 'yellow', 'pink'],
      minShift: 1,
    },
  ],

  waypoints: [
    {
      name: 'SANBAY',
      x: 0.5,
      y: 0.9,
      description: 'Bay approach →',
      allowedColors: ['orange', 'violet'],
      minShift: 1,
    },
    {
      name: 'SANBRG',
      x: 0.05,
      y: 0.4,
      description: 'West arrival ←',
      allowedColors: ['blue', 'pink', 'violet'],
      minShift: 3,
    },
    {
      name: 'SANDIEGO',
      x: 0.95,
      y: 0.3,
      description: 'East corridor →',
      allowedColors: ['green', 'orange', 'yellow'],
      minShift: 4,
    },
  ],

  fleet: [3, 6, 12, 10, 9, 11, 2, 4, 1, 5, 7, 8],
};

/** JSON order 16. Rome Fiumicino */
export const LIRF: Airport = {
  id: 'lirf',
  icao: 'LIRF',
  city: 'Rome',
  displayName: 'Fiumicino',
  backgroundImage: 'lirf',

  tier: 'paid',
  sku: 'airport.lirf',
  pitch: 'Three parallels and a cross runway.',
  signature:
    'Parallel cluster with intersecting traffic. Teaches deconfliction at busy intersections.',
  brief: "Italy's busiest, three parallel runways, 43 million passengers.",
  funny: 'The IATA code says "fiumicino", the traffic says "chaos".',
  order: 16,

  runways: [
    {
      id: 'lirf-rwy16L',
      rwNumber: '16L',
      oppositeRwNumber: '34R',
      masterWidth: 60,
      masterX1: 2200,
      masterY1: 1400,
      masterX2: 2950,
      masterY2: 1460,
      allowedColors: ['blue', 'green'],
      minShift: 1,
    },
    {
      id: 'lirf-rwy16R',
      rwNumber: '16R',
      oppositeRwNumber: '34L',
      masterWidth: 60,
      masterX1: 2200,
      masterY1: 1650,
      masterX2: 2950,
      masterY2: 1710,
      allowedColors: ['yellow', 'orange'],
      minShift: 2,
    },
    {
      id: 'lirf-rwy07',
      rwNumber: '07',
      oppositeRwNumber: '25',
      masterWidth: 40,
      masterX1: 1400,
      masterY1: 1100,
      masterX2: 1850,
      masterY2: 1140,
      allowedColors: ['pink', 'violet'],
      minShift: 4,
    },
  ],

  waypoints: [
    {
      name: 'ROME',
      x: 0.5,
      y: 0.9,
      description: 'South approach →',
      allowedColors: ['orange', 'yellow', 'pink', 'violet'],
      minShift: 1,
    },
    {
      name: 'ROMBRG',
      x: 0.05,
      y: 0.4,
      description: 'West arrival ←',
      allowedColors: ['blue', 'pink', 'violet'],
      minShift: 2,
    },
    {
      name: 'COLOSS',
      x: 0.95,
      y: 0.3,
      description: 'East corridor →',
      allowedColors: ['green', 'orange'],
      minShift: 4,
    },
  ],

  fleet: [12, 6, 1, 3, 10, 9, 2, 4, 11, 5, 7, 8],
};

/** JSON order 17. Los Angeles */
export const KLAX: Airport = {
  id: 'klax',
  icao: 'KLAX',
  city: 'Los Angeles',
  displayName: 'Los Angeles',
  backgroundImage: 'klax',

  tier: 'paid',
  sku: 'airport.klax',
  pitch: 'Four parallels stretched across the basin.',
  signature: 'Wide single-direction parallels. Teaches long-queue management.',
  brief: 'Busiest airport in the US, four parallel runways.',
  funny: 'The parking structure has more floors than some skyscrapers.',
  order: 17,

  runways: [
    {
      id: 'klax-rwy06L',
      rwNumber: '06L',
      oppositeRwNumber: '24R',
      masterWidth: 60,
      masterX1: 2200,
      masterY1: 1400,
      masterX2: 2950,
      masterY2: 1460,
      allowedColors: ['blue', 'green'],
      minShift: 1,
    },
    {
      id: 'klax-rwy06R',
      rwNumber: '06R',
      oppositeRwNumber: '24L',
      masterWidth: 60,
      masterX1: 2200,
      masterY1: 1650,
      masterX2: 2950,
      masterY2: 1710,
      allowedColors: ['yellow', 'orange'],
      minShift: 2,
    },
    {
      id: 'klax-rwy07L',
      rwNumber: '07L',
      oppositeRwNumber: '25R',
      masterWidth: 60,
      masterX1: 1800,
      masterY1: 900,
      masterX2: 2400,
      masterY2: 960,
      allowedColors: ['pink', 'violet'],
      minShift: 3,
    },
  ],

  waypoints: [
    {
      name: 'LAXBAY',
      x: 0.5,
      y: 0.9,
      description: 'Pacific approach →',
      allowedColors: ['orange', 'yellow', 'pink', 'violet'],
      minShift: 1,
    },
    {
      name: 'LAXBRG',
      x: 0.05,
      y: 0.4,
      description: 'West arrival ←',
      allowedColors: ['blue', 'pink', 'violet'],
      minShift: 2,
    },
    {
      name: 'LAXHILL',
      x: 0.95,
      y: 0.3,
      description: 'East corridor →',
      allowedColors: ['green', 'orange'],
      minShift: 4,
    },
  ],

  fleet: [1, 2, 12, 6, 10, 9, 3, 4, 11, 5, 7, 8],
};

/** JSON order 18. Lisbon Humberto Delgado */
export const LPPT: Airport = {
  id: 'lppt',
  icao: 'LPPT',
  city: 'Lisbon',
  displayName: 'Lisbon Humberto Delgado',
  backgroundImage: 'lppt',

  tier: 'paid',
  sku: 'airport.lppt',
  pitch: 'Single runway with a city in the approach path.',
  signature: 'Tight final over the city. Teaches energy management on short final.',
  brief: 'Runway 17/35 closed, single runway over the city.',
  funny: 'Runway 17/35 is so closed it is a bike path.',
  order: 18,

  runways: [
    {
      id: 'lppt-rwy02',
      rwNumber: '02',
      oppositeRwNumber: '20',
      masterWidth: 45,
      masterX1: 2200,
      masterY1: 1400,
      masterX2: 2850,
      masterY2: 1445,
      allowedColors: ['blue', 'green'],
      minShift: 1,
    },
  ],

  waypoints: [
    {
      name: 'LISBON',
      x: 0.5,
      y: 0.9,
      description: 'River approach →',
      allowedColors: ['orange', 'violet', 'yellow', 'pink'],
      minShift: 1,
    },
    {
      name: 'LISBRG',
      x: 0.05,
      y: 0.5,
      description: 'West arrival ←',
      allowedColors: ['blue', 'pink', 'violet', 'yellow'],
      minShift: 3,
    },
    {
      name: 'TOWER',
      x: 0.95,
      y: 0.3,
      description: 'East corridor →',
      allowedColors: ['green', 'orange', 'yellow'],
      minShift: 4,
    },
  ],

  fleet: [3, 6, 12, 10, 9, 11, 2, 4, 1, 5, 7, 8],
};

/** JSON order 19. Paris Charles de Gaulle */
export const LFPG: Airport = {
  id: 'lfpg',
  icao: 'LFPG',
  city: 'Paris',
  displayName: 'Charles de Gaulle',
  backgroundImage: 'lfpg',

  tier: 'paid',
  sku: 'airport.lfpg',
  pitch: 'Four runways fanning from the terminal maze.',
  signature: 'Staggered parallel pairs with diverse approach paths. Teaches sector management.',
  brief: "Europe's second-busiest airport, four main runways.",
  funny: 'Named after the man, not the cheese.',
  order: 19,

  runways: [
    {
      id: 'lfpg-rwy08L',
      rwNumber: '08L',
      oppositeRwNumber: '26R',
      masterWidth: 60,
      masterX1: 2200,
      masterY1: 1400,
      masterX2: 2950,
      masterY2: 1460,
      allowedColors: ['blue', 'green'],
      minShift: 1,
    },
    {
      id: 'lfpg-rwy08R',
      rwNumber: '08R',
      oppositeRwNumber: '26L',
      masterWidth: 60,
      masterX1: 2200,
      masterY1: 1650,
      masterX2: 2950,
      masterY2: 1710,
      allowedColors: ['yellow', 'orange'],
      minShift: 2,
    },
    {
      id: 'lfpg-rwy09L',
      rwNumber: '09L',
      oppositeRwNumber: '27R',
      masterWidth: 60,
      masterX1: 1800,
      masterY1: 900,
      masterX2: 2400,
      masterY2: 960,
      allowedColors: ['pink', 'violet'],
      minShift: 3,
    },
  ],

  waypoints: [
    {
      name: 'PARIS',
      x: 0.5,
      y: 0.9,
      description: 'East approach →',
      allowedColors: ['orange', 'yellow', 'pink', 'violet'],
      minShift: 1,
    },
    {
      name: 'PABRG',
      x: 0.05,
      y: 0.4,
      description: 'West arrival ←',
      allowedColors: ['blue', 'pink', 'violet'],
      minShift: 2,
    },
    {
      name: 'CHARLOT',
      x: 0.95,
      y: 0.3,
      description: 'Northeast corridor →',
      allowedColors: ['green', 'orange'],
      minShift: 4,
    },
  ],

  fleet: [1, 2, 12, 6, 10, 9, 3, 4, 11, 5, 7, 8],
};
// ═══════════════════════════════════════════════════════════════════════════

export const AIRPORTS: Airport[] = [
  EGLC,
  WADD,
  KSDM_MMTJ,
  YSSY,
  KJFK,
  OMDB_OMSJ,
  RJTT,
  VHHH,
  LEMD,
  KSFO,
  SBJL,
  CYYZ,
  RKSI,
  LIPZ,
  KSAN,
  LIRF,
  KLAX,
  LPPT,
  LFPG,
  EGLL,
];

export const FREE_AIRPORTS = AIRPORTS.filter((a) => a.tier === 'free');
export const PAID_AIRPORTS = AIRPORTS.filter((a) => a.tier === 'paid');

export function getAirportById(id: string): Airport | undefined {
  return AIRPORTS.find((a) => a.id === id);
}

export function getAirportByIcao(icao: string): Airport | undefined {
  return AIRPORTS.find((a) => a.icao === icao);
}

/** Menu order: free first, then paid, each by their own `order`. */
export function menuOrder(): Airport[] {
  const byOrder = (a: Airport, b: Airport) => a.order - b.order;
  return [...FREE_AIRPORTS].sort(byOrder).concat([...PAID_AIRPORTS].sort(byOrder));
}

/** Geometry visible at a given shift tier. */
export function geometryForShift(airport: Airport, tier: number) {
  return {
    runways: airport.runways.filter((r) => r.minShift <= tier),
    waypoints: airport.waypoints.filter((w) => w.minShift <= tier),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Save-data migration
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Existing saves store progress under 'level1'..'level6' and
 * 'training1'..'training6'. Map them on load, once, then write back in the
 * new format. Without this, every existing player loses their stars on
 * update — which reads as a bug and generates refunds.
 *
 * Old levels map to the shift whose plane count is closest to what that
 * level actually ran, so a player who cleared level6 (12 planes) is credited
 * with Evening Rush rather than being handed Meltdown for free.
 */
export const LEGACY_LEVEL_MAP: Record<string, string> = {
  level1: 'eglc:red-eye', //  3 planes, target 5
  level2: 'egll:early-bird', //  7 planes, target 15
  level3: 'eglc:midday-mix', //  7 planes, target 50
  level4: 'kjfk:midday-mix', //  9 planes, target 20
  level5: 'yssy:midday-mix', // 10 planes, target 20
  level6: 'vhhh:evening-rush', // 12 planes, target 25
};

/**
 * Old training levels do NOT map onto the new scenario lessons — they were
 * random-spawn levels wearing a training label, not scripted tutorials.
 * (training2 even drew EGLL's runways on the level-3 background.) Credit
 * anyone who cleared any of them as tutorial-complete and never show it again.
 */
export const LEGACY_TRAINING_IDS = [
  'training1',
  'training2',
  'training3',
  'training4',
  'training5',
  'training6',
] as const;

export function migrateLegacyProgress(old: Record<string, number>): {
  stars: Record<string, number>;
  tutorialComplete: boolean;
} {
  const stars: Record<string, number> = {};
  let tutorialComplete = false;

  for (const [key, value] of Object.entries(old)) {
    if ((LEGACY_TRAINING_IDS as readonly string[]).includes(key)) {
      if (value > 0) tutorialComplete = true;
      continue;
    }
    const mapped = LEGACY_LEVEL_MAP[key];
    if (mapped) stars[mapped] = Math.max(stars[mapped] ?? 0, value);
  }

  return { stars, tutorialComplete };
}

// ═══════════════════════════════════════════════════════════════════════════
// Validation — run in CI
// ═══════════════════════════════════════════════════════════════════════════

const ALL_COLORS: PlaneColor[] = ['blue', 'green', 'yellow', 'pink', 'violet', 'orange'];

export function validateAirports(): string[] {
  const errors: string[] = [];
  const seenIds = new Set<string>();
  const seenWaypoints = new Set<string>();
  const seenRunwayIds = new Set<string>();

  AIRPORTS.forEach((a) => {
    if (seenIds.has(a.id)) errors.push(`duplicate airport id: ${a.id}`);
    seenIds.add(a.id);

    if (a.tier === 'paid' && !a.sku) errors.push(`${a.id}: paid airport has no sku`);
    if (a.tier === 'free' && a.sku) errors.push(`${a.id}: free airport has a sku`);

    // Tier 1 must be solvable: at least one runway and one exit at minShift 1.
    if (!a.runways.some((r) => r.minShift === 1)) {
      errors.push(`${a.id}: no runway open at shift 1`);
    }
    if (!a.waypoints.some((w) => w.minShift === 1)) {
      errors.push(`${a.id}: no waypoint open at shift 1`);
    }

    // A single exit at tier 5 is a jam, not a challenge.
    if (a.waypoints.length < 2) {
      errors.push(`${a.id}: only ${a.waypoints.length} waypoint(s) at shift 5 — needs 2+`);
    }

    a.runways.forEach((r) => {
      if (seenRunwayIds.has(r.id)) errors.push(`duplicate runway id: ${r.id}`);
      seenRunwayIds.add(r.id);

      if (!r.id.startsWith(`${a.id}-rwy`)) {
        errors.push(`${r.id}: does not follow {airport}-rwy{number}`);
      }
      if (!r.allowedColors.length) errors.push(`${r.id}: no allowed colors`);

      // Negative master coords mean unmigrated centerX/centerY fallback.
      if (r.masterX1 < 0 || r.masterY1 < 0 || r.masterX2 < 0 || r.masterY2 < 0) {
        errors.push(`${r.id}: negative master coords — unmigrated, re-pick`);
      }
      if (r.masterWidth < 20 || r.masterWidth > 120) {
        errors.push(`${r.id}: masterWidth ${r.masterWidth} outside 20-120, likely a typo`);
      }
    });

    a.waypoints.forEach((w) => {
      if (seenWaypoints.has(w.name)) {
        errors.push(`duplicate waypoint name across airports: ${w.name}`);
      }
      seenWaypoints.add(w.name);

      if (w.x < 0 || w.x > 1) errors.push(`${w.name}: x out of range`);
      if (w.y < 0 || w.y > 1) errors.push(`${w.name}: y out of range`);
      if (!w.allowedColors.length) errors.push(`${w.name}: no allowed colors`);
    });

    // Every colour must be landable or routable somewhere, at EVERY tier, or
    // aircraft of that colour spawn with nowhere legal to go. This is the
    // check that catches a bad minShift assignment — the old flat config had
    // no way to get this wrong because nothing was ever hidden.
    for (let tier = 1; tier <= 5; tier++) {
      const { runways, waypoints } = geometryForShift(a, tier);
      const reachable = new Set<string>([
        ...runways.flatMap((r) => r.allowedColors),
        ...waypoints.flatMap((w) => w.allowedColors),
      ]);
      const orphaned = ALL_COLORS.filter((c) => !reachable.has(c));
      if (orphaned.length) {
        errors.push(`${a.id} tier ${tier}: colors with no destination: ${orphaned.join(', ')}`);
      }
    }
  });

  return errors;
}
