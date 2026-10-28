import type { LevelConfig } from '@/types/game';
import { menuOrder, getAirportById, type Airport } from '@/game/config/airports.config';
import {
  SHIFTS,
  ENDLESS,
  PLATFORM_PROFILES,
  type ResolvedLevel,
  buildLevel,
  getShiftIdFromEnum,
} from '@/game/config/level.structure';

/**
 * Level configurations are now generated from the airport × shift composition.
 *
 * Each airport has 5 shifts (Red-Eye through Holiday Meltdown), yielding
 * 100 composed levels from 20 airports. Levels are ordered by airport first
 * (menu order: free airports, then paid), then by shift within each airport.
 *
 * The old hand-written level1–level6 array is replaced by buildAllLevels().
 * getLevelByNumber() still works — it just indexes into a longer array.
 *
 * PLANE TYPES — Fleet Registry (matches defaults_config.ts PLANE_TYPE_VARIANTS)
 * ─────────────────────────────────────────────────────────────────────────────
 *  1  Airbus A380-800          SUPER  — Largest airliner, slow turn, high speed
 *  2  Airbus A340-600          HEAVY  — Four-engine long-haul wide-body
 *  3  Airbus A320-200          MEDIUM — Workhorse narrow-body short/medium-haul
 *  4  Douglas DC-9             MEDIUM — Classic twin-engine short-haul
 *  5  Concorde                 HEAVY  — Supersonic; very fast, narrow wingspan
 *  6  Boeing 777-9 (777X)      HEAVY  — Modern twin-engine long-haul wide-body
 *  7  Boeing C-17 Globemaster  HEAVY  — Military strategic airlifter
 *  8  Antonov An-22            HEAVY  — Heavy turboprop airlifter, slow cruise
 *  9  Douglas MD-11            HEAVY  — Three-engine wide-body long-haul
 * 10  Cessna Citation 700      LIGHT  — Compact business jet, agile
 * 11  Embraer E195-E2          MEDIUM — Regional narrow-body airliner
 * 12  Boeing 747-8i            HEAVY  — Iconic quad-jet wide-body
 *
 * Suggested progression by difficulty:
 *   Easy   → [1, 3] or [3, 11]         (familiar shapes, moderate speeds)
 *   Normal → [1, 2, 3, 6, 12]          (mix of sizes and speeds)
 *   Hard   → [1, 2, 3, 4, 5, 6, 7, 9] (includes Concorde and military)
 *   Expert → all 12 types
 */

export const LEVELS: ResolvedLevel[] = buildAllLevelsFromConfig();

function buildAllLevelsFromConfig(): ResolvedLevel[] {
  const ordered = menuOrder();
  return ordered.flatMap((airport) =>
    SHIFTS.map((shift) => {
      const profile = PLATFORM_PROFILES.desktop;
      return buildLevel(airport, shift, profile);
    })
  );
}

export interface GameplayRouteParams {
  airportId: string;
  shiftId: string;
}

export function encodeGameplayRouteParams({
  airportId,
  shiftId,
}: GameplayRouteParams): GameplayRouteParams {
  return {
    airportId: encodeURIComponent(airportId),
    shiftId: encodeURIComponent(shiftId),
  };
}

export function decodeGameplayRouteParams({
  airportId,
  shiftId,
}: GameplayRouteParams): GameplayRouteParams {
  return {
    airportId: decodeURIComponent(airportId),
    shiftId: decodeURIComponent(shiftId),
  };
}

export function getLevelByAirportAndShift(
  airportId: string,
  shiftId: string
): ResolvedLevel | undefined {
  const normalizedAirportId = airportId.trim().toLowerCase();
  const normalizedShiftId = shiftId.trim().toLowerCase();
  if (normalizedShiftId === 'endless') {
    return getEndlessLevelByAirport(normalizedAirportId);
  }
  console.log('---LEVELS = ', LEVELS);
  console.log('---airportId = ', airportId);

  return LEVELS.find(
    (level) => level.airportId === normalizedAirportId && level.shiftId === normalizedShiftId
  );
}

export function getEndlessLevelByAirport(airportId: string): ResolvedLevel | undefined {
  const airport = getAirportById(airportId.trim().toLowerCase());
  return airport ? buildLevel(airport, ENDLESS, PLATFORM_PROFILES.desktop) : undefined;
}

export function getGameplayLevelById(levelId: string): ResolvedLevel | undefined {
  return getLevelById(levelId) ?? getEndlessLevelByAirport(levelId.split(':')[0] ?? '');
}

export function getLevelNumberById(levelId: string): number | null {
  const normalized = normalizeLevelId(levelId);
  const finiteIndex = LEVELS.findIndex((level) => level.id === normalized);
  if (finiteIndex !== -1) return finiteIndex + 1;

  const [airportId, shiftId] = normalized.split(':');
  if (!airportId || shiftId !== 'endless') return null;
  const middayMix = LEVELS.find(
    (level) => level.airportId === airportId && level.shiftId === 'midday-mix'
  );
  return middayMix ? LEVELS.indexOf(middayMix) + 1 : null;
}

export const TRAINING_LEVELS: LevelConfig[] = [
  {
    id: 'training1',
    name: 'Training 1: Basic Vectoring',
    difficulty: 'hard',
    maxPlanes: 10,
    minPlanes: 1,
    spawnRate: 0.002,
    planesTarget: 30,
    targetScore: 200,
    timeLimit: null,
    backgroundImage: 'level-3',
    allowedPlaneTypes: [1],
    minDepartureIntervalMs: 6000,
    minRandomSpawnIntervalMs: 5000,
    runways: [
      {
        id: 'training1-rwy09',
        rwNumber: '09',
        oppositeRwNumber: '27',
        masterWidth: 80,
        allowedColors: ['orange', 'violet', 'pink', 'blue', 'green', 'yellow'],
        masterX1: 2313,
        masterY1: 1537,
        masterX2: 3315,
        masterY2: 1587,
      },
    ],
    waypoints: [],
  },
  {
    id: 'training2',
    name: 'Training 2: Approach Handling',
    difficulty: 'easy',
    maxPlanes: 3,
    minPlanes: 1,
    spawnRate: 0.003,
    planesTarget: 5,
    targetScore: 300,
    timeLimit: null,
    backgroundImage: 'level-3',
    allowedPlaneTypes: [1, 3, 12],
    minDepartureIntervalMs: 5000,
    minRandomSpawnIntervalMs: 4500,
    runways: [
      {
        id: 'training2-rwy11',
        rwNumber: '11',
        oppositeRwNumber: '29',
        masterWidth: 65,
        allowedColors: ['blue', 'green', 'yellow', 'pink', 'violet'],
        masterX1: 2265,
        masterY1: 2360,
        masterX2: 3470,
        masterY2: 2543,
      },
      {
        id: 'training2-rwy10',
        rwNumber: '10',
        oppositeRwNumber: '28',
        masterWidth: 54,
        allowedColors: ['green', 'blue', 'yellow', 'pink', 'violet'],
        masterX1: 1939,
        masterY1: 969,
        masterX2: 2959,
        masterY2: 1069,
      },
    ],
    waypoints: [
      {
        name: 'JANJO',
        x: 0.97,
        y: 0.5,
        description: 'Traffic queue to Europe →',
        allowedColors: ['orange', 'yellow', 'green'],
      },
      {
        name: 'BIMBO',
        x: 0.03,
        y: 0.15,
        description: 'Arrivals from North ←',
        allowedColors: ['pink', 'violet', 'blue'],
      },
    ],
  },
  {
    id: 'training3',
    name: 'Training 3: Enroute Handling',
    difficulty: 'easy',
    maxPlanes: 4,
    minPlanes: 1,
    spawnRate: 0.003,
    planesTarget: 8,
    targetScore: 500,
    timeLimit: null,
    backgroundImage: 'level-3',
    allowedPlaneTypes: [1, 3, 10, 12],
    minDepartureIntervalMs: 5000,
    minRandomSpawnIntervalMs: 4000,
    runways: [
      {
        id: 'training3-rwy09',
        rwNumber: '09',
        oppositeRwNumber: '27',
        masterWidth: 80,
        allowedColors: ['orange', 'violet', 'pink'],
        masterX1: 2300,
        masterY1: 1537,
        masterX2: 3555,
        masterY2: 1597,
      },
    ],
    waypoints: [
      {
        name: 'ALPHA',
        x: 0.6,
        y: 0.9,
        description: 'Exit to Europe →',
        allowedColors: ['blue', 'green', 'yellow'],
      },
      {
        name: 'BRAVO',
        x: 0.2,
        y: 0.3,
        description: 'North transit ↑',
        allowedColors: ['orange', 'yellow', 'violet'],
      },
    ],
  },
  {
    id: 'training4',
    name: 'Training 4: Vertical Separation',
    difficulty: 'normal',
    maxPlanes: 5,
    minPlanes: 2,
    spawnRate: 0.004,
    planesTarget: 10,
    targetScore: 800,
    timeLimit: null,
    backgroundImage: 'level-3',
    allowedPlaneTypes: [1, 3, 2, 12],
    minDepartureIntervalMs: 4000,
    minRandomSpawnIntervalMs: 3500,
    runways: [
      {
        id: 'training4-rw06',
        rwNumber: '06',
        oppositeRwNumber: '24',
        masterWidth: 678,
        allowedColors: ['blue', 'green', 'violet'],
        masterX1: 2875,
        masterY1: 1650,
        masterX2: 3550,
        masterY2: 1713,
      },
      {
        id: 'training4-rw24',
        rwNumber: '24',
        oppositeRwNumber: '06',
        masterWidth: 46,
        allowedColors: ['yellow', 'orange'],
        masterX1: 4124,
        masterY1: 990,
        masterX2: 3466,
        masterY2: 610,
      },
      {
        id: 'training4-rw15',
        rwNumber: '15',
        oppositeRwNumber: '33',
        masterWidth: 40,
        allowedColors: ['pink'],
        masterX1: 2286,
        masterY1: 1010,
        masterX2: 2460,
        masterY2: 1658,
      },
    ],
    waypoints: [
      {
        name: 'DELTA',
        x: 0.95,
        y: 0.3,
        description: 'International route →',
        allowedColors: ['orange', 'yellow', 'violet'],
      },
      {
        name: 'ECHO',
        x: 0.05,
        y: 0.7,
        description: 'Domestic arrivals ←',
        allowedColors: ['blue', 'green', 'pink'],
      },
    ],
  },
  {
    id: 'training5',
    name: 'Training 5: Speed Adjustment',
    difficulty: 'normal',
    maxPlanes: 6,
    minPlanes: 2,
    spawnRate: 0.005,
    planesTarget: 12,
    targetScore: 1000,
    timeLimit: null,
    backgroundImage: 'level-5',
    allowedPlaneTypes: [1, 2, 3, 10, 12],
    minDepartureIntervalMs: 3500,
    minRandomSpawnIntervalMs: 3000,
    runways: [
      {
        id: 'training5-rwy09',
        rwNumber: '09',
        oppositeRwNumber: '27',
        masterWidth: 40,
        allowedColors: ['blue', 'green'],
        masterX1: -1184,
        masterY1: 756,
        masterX2: -736,
        masterY2: 756,
      },
      {
        id: 'training5-rwy27',
        rwNumber: '27',
        oppositeRwNumber: '09',
        masterWidth: 40,
        allowedColors: ['yellow', 'orange'],
        masterX1: 1184,
        masterY1: -648,
        masterX2: 736,
        masterY2: -648,
      },
      {
        id: 'training5-rwy09R',
        rwNumber: '09',
        oppositeRwNumber: '27',
        masterWidth: 40,
        allowedColors: ['blue', 'green'],
        masterX1: 2149,
        masterY1: 1334,
        masterX2: 2597,
        masterY2: 1334,
      },
      {
        id: 'training5-rwy27L',
        rwNumber: '27',
        oppositeRwNumber: '09',
        masterWidth: 40,
        allowedColors: ['yellow', 'orange'],
        masterX1: 1184,
        masterY1: -756,
        masterX2: 736,
        masterY2: -756,
      },
    ],
    waypoints: [
      {
        name: 'FOXTROT',
        x: 0.97,
        y: 0.5,
        description: 'East departure →',
        allowedColors: ['violet', 'pink'],
      },
      {
        name: 'GOLF',
        x: 0.03,
        y: 0.5,
        description: 'West arrival ←',
        allowedColors: ['violet', 'pink'],
      },
      {
        name: 'HOTEL',
        x: 0.5,
        y: 0.03,
        description: 'North transit ↑',
        allowedColors: ['blue', 'green'],
      },
    ],
  },
  {
    id: 'training6',
    name: 'Training 6: Emergency Procedures',
    difficulty: 'normal',
    maxPlanes: 7,
    minPlanes: 3,
    spawnRate: 0.006,
    planesTarget: 15,
    targetScore: 1200,
    timeLimit: null,
    backgroundImage: 'level-6',
    allowedPlaneTypes: [1, 2, 3, 4, 10, 12],
    minDepartureIntervalMs: 3500,
    minRandomSpawnIntervalMs: 2800,
    runways: [
      {
        id: 'training6-rw08',
        rwNumber: '08',
        oppositeRwNumber: '26',
        masterWidth: 40,
        allowedColors: ['blue', 'green', 'violet'],
        masterX1: -1427,
        masterY1: 446,
        masterX2: -973,
        masterY2: 634,
      },
      {
        id: 'training6-rw26',
        rwNumber: '26',
        oppositeRwNumber: '08',
        masterWidth: 40,
        allowedColors: ['yellow', 'orange', 'pink'],
        masterX1: 1427,
        masterY1: -446,
        masterX2: 973,
        masterY2: -634,
      },
      {
        id: 'training6-rw17',
        rwNumber: '17',
        oppositeRwNumber: '35',
        masterWidth: 40,
        allowedColors: ['violet', 'pink'],
        masterX1: 58,
        masterY1: -648,
        masterX2: -58,
        masterY2: -216,
      },
      {
        id: 'training6-rw35',
        rwNumber: '35',
        oppositeRwNumber: '17',
        masterWidth: 40,
        allowedColors: ['blue', 'green'],
        masterX1: -216,
        masterY1: 490,
        masterX2: 216,
        masterY2: 374,
      },
    ],
    waypoints: [
      {
        name: 'INDIA',
        x: 0.95,
        y: 0.2,
        description: 'Northeast route →',
        allowedColors: ['orange', 'yellow'],
      },
      {
        name: 'JULIET',
        x: 0.95,
        y: 0.8,
        description: 'Southeast route →',
        allowedColors: ['violet', 'pink'],
      },
      {
        name: 'KILO',
        x: 0.05,
        y: 0.5,
        description: 'West corridor ←',
        allowedColors: ['blue', 'green'],
      },
      {
        name: 'LIMA',
        x: 0.5,
        y: 0.05,
        description: 'North transit ↑',
        allowedColors: ['orange', 'pink', 'violet'],
      },
    ],
  },
];

/**
 * Get training level by number (1-based)
 */
export function getTrainingLevelByNumber(levelNumber: number): LevelConfig | undefined {
  return TRAINING_LEVELS[levelNumber - 1];
}

/**
 * Convert percentage-based positions to pixel coordinates
 */
export function convertLevelToPixels(
  level: LevelConfig,
  width: number,
  height: number
): LevelConfig {
  return {
    ...level,
    runways: level.runways.map((runway) => ({
      ...runway,
      centerX: runway.centerX != null ? runway.centerX * width : undefined,
      centerY: runway.centerY != null ? runway.centerY * height : undefined,
    })),
    waypoints: level.waypoints.map((waypoint) => ({
      ...waypoint,
      x: waypoint.x * width,
      y: waypoint.y * height,
    })),
  };
}

/**
 * Get level by ID
 */
export function getLevelById(levelId: string): ResolvedLevel | undefined {
  return LEVELS.find((level) => level.id === normalizeLevelId(levelId));
}

/**
 * Normalize a stored level id to the canonical `[airport]:[shiftId]` form.
 *
 * `profiles.last_passed_level` stores the numeric SHIFT_ENUM (e.g.
 * `WADD:4`) for compactness and rename-safety, but every level in LEVELS is
 * keyed by the shift's string `id` (e.g. `WADD:evening-rush`). This converts
 * the enum half back to the id half so `getLevelById` /
 * `getNextLevelInAirport` can resolve a stored cursor. A value that is already
 * in id form (or unresolvable) is returned unchanged.
 */
export function normalizeLevelId(levelId: string): string {
  if (!levelId) return levelId;
  const [airportId, shiftPart] = levelId.split(':');
  if (!airportId || shiftPart === undefined) return levelId;

  // Already a string id — no conversion needed.
  if (isNaN(Number(shiftPart))) return levelId;

  const shiftEnum = Number(shiftPart);
  const shiftId = getShiftIdFromEnum(shiftEnum);
  return shiftId ? `${airportId}:${shiftId}` : levelId;
}

/**
 * Get level by index (1-based)
 */
export function getLevelByNumber(levelNumber: number): ResolvedLevel | undefined {
  return LEVELS[levelNumber - 1];
}

/**
 * Get total number of levels
 */
export function getTotalLevels(): number {
  return LEVELS.length;
}

/**
 * Check if level exists
 */
export function levelExists(levelId: string): boolean {
  return LEVELS.some((level) => level.id === levelId);
}

/**
 * Get next level
 */
export function getNextLevel(currentLevelId: string): ResolvedLevel | null {
  const currentIndex = LEVELS.findIndex((level) => level.id === currentLevelId);
  if (currentIndex === -1 || currentIndex === LEVELS.length - 1) {
    return null;
  }
  return LEVELS[currentIndex + 1];
}

export function getPreviousLevelInAirport(currentLevelId: string): ResolvedLevel | null {
  const currentLevel = getLevelById(currentLevelId);
  if (!currentLevel || currentLevel.shiftId === 'endless') return null;

  const airportLevels = LEVELS.filter((level) => level.airportId === currentLevel.airportId);
  const currentIndex = airportLevels.findIndex((level) => level.id === currentLevel.id);
  return currentIndex > 0 ? airportLevels[currentIndex - 1] : null;
}

export function getNextLevelInAirport(currentLevelId: string): ResolvedLevel | null {
  const currentLevel = getLevelById(currentLevelId);
  if (!currentLevel || currentLevel.shiftId === 'endless') return null;

  const airportLevels = LEVELS.filter((level) => level.airportId === currentLevel.airportId);
  const currentIndex = airportLevels.findIndex((level) => level.id === currentLevel.id);
  return currentIndex >= 0 && currentIndex < airportLevels.length - 1
    ? airportLevels[currentIndex + 1]
    : null;
}

/**
 * Get previous level
 */
export function getPreviousLevel(currentLevelId: string): ResolvedLevel | null {
  const currentIndex = LEVELS.findIndex((level) => level.id === currentLevelId);
  if (currentIndex <= 0) {
    return null;
  }
  return LEVELS[currentIndex - 1];
}

/**
 * Calculate stars earned for a level based on score
 */
export function calculateStars(level: LevelConfig, score: number): number {
  if (!level.targetScore) return 3;

  const percentage = (score / level.targetScore) * 100;

  if (percentage >= 150) return 3;
  if (percentage >= 100) return 2;
  if (percentage >= 50) return 1;

  return 0;
}

/**
 * Get background image path for a level
 */
export function getLevelBackgroundPath(levelId: string): string {
  const level = getLevelById(levelId);
  return level?.backgroundImage || 'level-1';
}

/**
 * Get runway heading as compass direction
 */
export function getRunwayHeading(direction: number): string {
  let degrees = (direction * 180) / Math.PI;
  while (degrees < 0) degrees += 360;
  while (degrees >= 360) degrees -= 360;
  const heading = Math.round(degrees / 10) % 36;
  return heading.toString().padStart(2, '0');
}

/**
 * Check if a plane type is allowed in a level
 */
export function isPlaneTypeAllowedInLevel(level: LevelConfig, planeTypeId: number): boolean {
  if (!level.allowedPlaneTypes || level.allowedPlaneTypes.length === 0) {
    return true; // If not specified, all types allowed
  }
  return level.allowedPlaneTypes.includes(planeTypeId);
}

/**
 * Get random allowed plane type for level
 */
export function getRandomAllowedPlaneType(level: LevelConfig): number {
  if (!level.allowedPlaneTypes || level.allowedPlaneTypes.length === 0) {
    // Default to type 1 if nothing specified
    return 1;
  }
  const randomIndex = Math.floor(Math.random() * level.allowedPlaneTypes.length);
  return level.allowedPlaneTypes[randomIndex];
}

/**
 * Validate level configuration
 */
export function validateLevelConfig(level: LevelConfig): string[] {
  const errors: string[] = [];

  level.runways.forEach((runway, index) => {
    if (runway.centerX != null && (runway.centerX < 0 || runway.centerX > 1)) {
      errors.push(`Runway ${index} centerX out of range: ${runway.centerX}`);
    }
    if (runway.centerY != null && (runway.centerY < 0 || runway.centerY > 1)) {
      errors.push(`Runway ${index} centerY out of range: ${runway.centerY}`);
    }
    if (!runway.allowedColors || runway.allowedColors.length === 0) {
      errors.push(`Runway ${index} has no allowed colors`);
    }
  });

  level.waypoints.forEach((waypoint, index) => {
    if (waypoint.x < 0 || waypoint.x > 1) {
      errors.push(`Waypoint ${index} x out of range: ${waypoint.x}`);
    }
    if (waypoint.y < 0 || waypoint.y > 1) {
      errors.push(`Waypoint ${index} y out of range: ${waypoint.y}`);
    }
    if (!waypoint.allowedColors || waypoint.allowedColors.length === 0) {
      errors.push(`Waypoint ${index} has no allowed colors`);
    }
  });

  return errors;
}

/**
 * Log level configuration
 */
export function logLevelConfig(levelId: string): void {
  const level = getLevelById(levelId);
  if (!level) {
    console.error(`❌ Level ${levelId} not found`);
    return;
  }

  console.log(`📋 Level Configuration: ${level.name}`);
  console.log(`   ID: ${level.id}`);
  console.log(`   Difficulty: ${level.difficulty}`);
  console.log(`   Background: ${level.backgroundImage}`);
  console.log(`   Max Planes: ${level.maxPlanes}`);
  console.log(`   Target Score: ${level.targetScore}`);
  console.log(`   Time Limit: ${level.timeLimit ? level.timeLimit + 's' : 'Unlimited'}`);
  console.log(`   Allowed Plane Types: ${level.allowedPlaneTypes?.join(', ') || 'All'}`);
  console.log(`   Min Departure Interval: ${level.minDepartureIntervalMs || 2000}ms`);
  console.log(`   Min Random Spawn Interval: ${level.minRandomSpawnIntervalMs || 2000}ms`);
  console.log(`   Runways (${level.runways.length}):`);

  level.runways.forEach((runway) => {
    const heading = runway.direction != null ? getRunwayHeading(runway.direction) : '—';
    const pos =
      runway.centerX != null && runway.centerY != null
        ? `@ (${(runway.centerX * 100).toFixed(1)}%, ${(runway.centerY * 100).toFixed(1)}%)`
        : '(two-endpoint form)';
    console.log(`      ${runway.id} ${pos} → RWY${heading}`);
    console.log(`         Colors: ${runway.allowedColors?.join(', ')}`);
  });

  console.log(`   Waypoints (${level.waypoints.length}):`);
  level.waypoints.forEach((waypoint) => {
    console.log(
      `      ${waypoint.name} @ (${(waypoint.x * 100).toFixed(1)}%, ${(waypoint.y * 100).toFixed(
        1
      )}%)`
    );
    console.log(`         ${waypoint.description}`);
    console.log(`         Colors: ${waypoint.allowedColors?.join(', ')}`);
  });

  const errors = validateLevelConfig(level);
  if (errors.length > 0) {
    console.warn(`   ⚠️ Validation errors:`, errors);
  } else {
    console.log(`   ✅ Configuration valid`);
  }
}
