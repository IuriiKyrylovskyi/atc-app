/**
 * PROPOSED LEVEL ARCHITECTURE — Airport × Shift composition
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * PROBLEM WITH THE CURRENT SHAPE
 * ------------------------------
 * levels.config.ts stores geometry + difficulty in one flat object per level.
 * Consequences visible in the current file:
 *
 *   - level1 and level3 are both EGLC with the same runway, copy-pasted.
 *     The coordinates have already drifted (masterX2 3315 vs 3555) — two
 *     sources of truth for one piece of art.
 *   - level4-rw15 carries a TODO noting it shares a master point with
 *     level5-rw09L on a *different* master image. Classic copy-paste decay.
 *   - Retuning the global difficulty curve means editing every level object.
 *   - Adding an airport means authoring N full level objects by hand.
 *
 * THE FIX
 * -------
 *   Airport  = content. Hand-authored, expensive, stable. All runways, all
 *              waypoints, the background master, the plausible fleet.
 *   Shift    = rules. A row in a table. Plane cap, speed, target, mode.
 *   Platform = device budget. Concurrency + pacing multipliers.
 *
 *   buildLevel(airport, shift, platform) -> LevelConfig
 *
 * Downstream code is untouched: LEVELS is still exported as a flat array,
 * just generated instead of hand-written. getLevelById / getLevelByNumber /
 * getNextLevel keep working.
 *
 * Progressive disclosure comes from minShift on each runway and waypoint,
 * so the designer decides explicitly which geometry appears when — rather
 * than "take the first 2 runways", which produces arbitrary results.
 */

import type { LevelConfig, PlaneColor } from '@/types/game';
import type { Airport, AirportRunway, AirportWaypoint } from './airports.config';

export type { Airport, AirportRunway, AirportWaypoint };

// ═══════════════════════════════════════════════════════════════════════════
// 2. RULES — the difficulty curve, in one editable table.
// ═══════════════════════════════════════════════════════════════════════════

export type TrafficMode = 'arrivals' | 'departures' | 'mixed';

export interface Shift {
  tier: number;
  id: string;
  name: string;
  blurb: string;

  /** Concurrent aircraft. Session ramps minPlanes -> maxPlanes. */
  minPlanes: number;
  maxPlanes: number;

  /** Applied to每 plane type's base speed from defaults.config. */
  speedMultiplier: number;

  /** Aircraft that must be handled (landed + routed) to clear the shift. */
  trafficTarget: number;

  trafficMode: TrafficMode;

  /** How many entries of airport.fleet to use. */
  fleetSize: number;

  /** Base spawn pacing, before platform + ramp adjustment. */
  spawnIntervalMs: number;
  minDepartureIntervalMs: number;

  /**
   * Seconds over which concurrency eases from minPlanes to maxPlanes.
   * Without this, tier 5 opens with 20 aircraft and is unlearnable.
   */
  rampSeconds: number;
}

export const SHIFTS: Shift[] = [
  {
    tier: 1,
    id: 'red-eye',
    name: 'Red-Eye',
    blurb: 'Three in the morning. Nothing but arrivals and bad coffee.',
    minPlanes: 2,
    maxPlanes: 4,
    speedMultiplier: 0.7,
    trafficTarget: 20,
    trafficMode: 'arrivals',
    fleetSize: 2,
    spawnIntervalMs: 5000,
    minDepartureIntervalMs: 6000,
    rampSeconds: 40,
  },
  {
    tier: 2,
    id: 'early-bird',
    name: 'Early Bird',
    blurb: 'First wave out. Everyone wants a departure slot at once.',
    minPlanes: 3,
    maxPlanes: 6,
    speedMultiplier: 0.85,
    trafficTarget: 40,
    trafficMode: 'departures',
    fleetSize: 3,
    spawnIntervalMs: 4200,
    minDepartureIntervalMs: 4500,
    rampSeconds: 50,
  },
  {
    tier: 3,
    id: 'midday-mix',
    name: 'Midday Mix',
    blurb: 'Arrivals and departures sharing the same concrete.',
    minPlanes: 4,
    maxPlanes: 9,
    speedMultiplier: 1.05,
    trafficTarget: 70,
    trafficMode: 'mixed',
    fleetSize: 5,
    spawnIntervalMs: 3400,
    minDepartureIntervalMs: 3500,
    rampSeconds: 60,
  },
  {
    tier: 4,
    id: 'evening-rush',
    name: 'Evening Rush',
    blurb: 'Every inbound is late and every outbound is boarding.',
    minPlanes: 6,
    maxPlanes: 13,
    speedMultiplier: 1.35,
    trafficTarget: 120,
    trafficMode: 'mixed',
    fleetSize: 8,
    spawnIntervalMs: 2600,
    minDepartureIntervalMs: 2600,
    rampSeconds: 70,
  },
  {
    tier: 5,
    id: 'meltdown',
    name: 'Holiday Meltdown',
    blurb: 'The board is solid red. Good luck.',
    minPlanes: 8,
    maxPlanes: 20,
    speedMultiplier: 1.75,
    trafficTarget: 200,
    trafficMode: 'mixed',
    fleetSize: 12,
    spawnIntervalMs: 1900,
    minDepartureIntervalMs: 2000,
    rampSeconds: 90,
  },
];

/**
 * Endless is not a sixth shift — it is a mode. Unlocked per airport once
 * Midday Mix is cleared. Starts at tier-3 pressure and creeps toward
 * speed 2.0 / 24 aircraft with no target. This is where retention lives:
 * five finite shifts cap out, a personal best does not.
 */
export const ENDLESS: Omit<Shift, 'trafficTarget'> & { trafficTarget: null } = {
  tier: 99,
  id: 'endless',
  name: 'Endless Shift',
  blurb: 'No target. It only stops when you do.',
  minPlanes: 4,
  maxPlanes: 24,
  speedMultiplier: 2.0, // reached asymptotically, see resolveEndlessPressure
  trafficTarget: null,
  trafficMode: 'mixed',
  fleetSize: 12,
  spawnIntervalMs: 1700,
  minDepartureIntervalMs: 1800,
  rampSeconds: 600,
};

// ═══════════════════════════════════════════════════════════════════════════
// 3. PLATFORM BUDGET
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Collision radius is 100% of sprite size (planes.config.ts), and sprites do
 * not shrink proportionally with the viewport. So the same plane count is
 * genuinely denser on a phone than on a desktop — it is not a perception
 * issue, the airspace is physically tighter.
 *
 * Correct response: cap CONCURRENCY and stretch PACING. Do not cut
 * trafficTarget — that makes the same level mean different things on
 * different devices and breaks any cross-platform leaderboard. The mobile
 * session is a little longer instead, which is fine.
 */
export interface PlatformProfile {
  concurrencyMul: number;
  spawnIntervalMul: number;
  /** Hard ceiling regardless of tier — what fits legibly on the screen. */
  hardPlaneCap: number;
}

export const PLATFORM_PROFILES: Record<'desktop' | 'tablet' | 'mobile', PlatformProfile> = {
  desktop: { concurrencyMul: 1.0, spawnIntervalMul: 1.0, hardPlaneCap: 24 },
  tablet: { concurrencyMul: 0.8, spawnIntervalMul: 1.12, hardPlaneCap: 16 },
  mobile: { concurrencyMul: 0.6, spawnIntervalMul: 1.3, hardPlaneCap: 12 },
};

// Resulting maxPlanes per tier:
//   desktop   4   6   9  13  20
//   tablet    4   5   8  11  16
//   mobile    4   4   6   8  12
// Tier 1 stays at 4 everywhere — that is the floor the design assumes.

// ═══════════════════════════════════════════════════════════════════════════
// 4. COMPOSITION
// ═══════════════════════════════════════════════════════════════════════════

export interface ResolvedLevel extends LevelConfig {
  airportId: string;
  shiftId: string;
  trafficMode: TrafficMode;
  speedMultiplier: number;
  rampSeconds: number;
}

export function makeLevelId(airport: Airport, shift: Pick<Shift, 'id'>): string {
  return `${airport.id}:${shift.id}`;
}

export function buildLevel(
  airport: Airport,
  shift: Omit<Shift, 'trafficTarget'> & { trafficTarget: number | null },
  profile: PlatformProfile
): ResolvedLevel {
  const runways = airport.runways.filter((r) => r.minShift <= shift.tier);
  const waypoints = airport.waypoints.filter((w) => w.minShift <= shift.tier);

  const maxPlanes = Math.max(
    4,
    Math.min(profile.hardPlaneCap, Math.round(shift.maxPlanes * profile.concurrencyMul))
  );
  const minPlanes = Math.min(maxPlanes, Math.round(shift.minPlanes * profile.concurrencyMul) || 1);

  return {
    id: makeLevelId(airport, shift),
    name: `${airport.displayName} — ${shift.name}`,
    airfieldName: airport.icao,
    difficulty: tierToLegacyDifficulty(shift.tier),
    backgroundImage: airport.backgroundImage,

    minPlanes,
    maxPlanes,
    planesTarget: shift.trafficTarget,
    targetScore: null, // stars derive from miss rate now — see rateShift()
    timeLimit: null,

    spawnRate: 1 / (shift.spawnIntervalMs * profile.spawnIntervalMul),
    minRandomSpawnIntervalMs: Math.round(shift.spawnIntervalMs * profile.spawnIntervalMul),
    minDepartureIntervalMs: Math.round(shift.minDepartureIntervalMs * profile.spawnIntervalMul),

    allowedPlaneTypes: airport.fleet.slice(0, shift.fleetSize),

    runways,
    waypoints,

    airportId: airport.id,
    shiftId: shift.id,
    trafficMode: shift.trafficMode,
    speedMultiplier: shift.speedMultiplier,
    rampSeconds: shift.rampSeconds,
  } as ResolvedLevel;
}

function tierToLegacyDifficulty(tier: number): 'easy' | 'normal' | 'hard' {
  if (tier <= 2) return 'easy';
  if (tier <= 4) return 'normal';
  return 'hard';
}

/**
 * Concurrency ramp. Call each frame from the spawner instead of reading
 * maxPlanes directly — this is what makes tier 5 approachable.
 */
export function currentPlaneCap(level: ResolvedLevel, elapsedSeconds: number): number {
  const t = Math.min(1, elapsedSeconds / level.rampSeconds);
  const eased = t * t * (3 - 2 * t); // smoothstep
  return Math.round(level.minPlanes + (level.maxPlanes - level.minPlanes) * eased);
}

/**
 * Endless pressure curve. Approaches maxPlanes / speed 2.0 without ever
 * quite arriving, so there is always a next personal best.
 */
export function resolveEndlessPressure(handled: number): { planeCap: number; speed: number } {
  const p = 1 - Math.exp(-handled / 120);
  return {
    planeCap: Math.round(4 + (ENDLESS.maxPlanes - 4) * p),
    speed: 1.05 + (2.0 - 1.05) * p,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. STARS — derived, not hand-tuned
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The current calculateStars() compares score to a per-level targetScore.
 * That is a second number to maintain per level and it drifts out of sync
 * with planesTarget the moment either is retuned.
 *
 * Miss rate needs no tuning, scales automatically to any target, and
 * rewards the skill the game is actually about: not losing aircraft.
 */
export function rateShift(handled: number, missed: number, target: number | null): number {
  if (target !== null && handled < target) return 0;
  const attempted = handled + missed;
  if (attempted === 0) return 0;
  const missRate = missed / attempted;
  if (missRate <= 0.03) return 3;
  if (missRate <= 0.1) return 2;
  return 1;
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. UNLOCKS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Two independent gates, on purpose:
 *
 *   Shifts  unlock linearly within an airport — clear tier N to see N+1.
 *           Sequential, because the traffic-mode progression teaches in order.
 *
 *   Airports unlock on TOTAL STARS, not on clearing the previous airport's
 *           hardest shift. A player stuck on Holiday Meltdown at EGLC can
 *           still move on to JFK and come back later. Hard-gating on the
 *           top tier is the single most common way level select kills a
 *           session — do not do it.
 *
 * With 5 shifts × 3 stars = 15 stars per airport, gating the next airport
 * at ~8 stars means clearing the first three shifts cleanly is enough.
 */
export interface Progress {
  stars: Record<string, number>; // levelId -> 0..3
  cleared: Record<string, boolean>;
}

export function totalStars(p: Progress): number {
  return Object.values(p.stars).reduce((a, b) => a + b, 0);
}

/**
 * Airport access is now entitlement-based (see liveops.config.ts), not
 * star-gated. Free airports unlock at boot; paid airports require purchase
 * or Tower Pass. Stars are pure vanity / completion tracking.
 *
 * Re-exported here for convenience — callers should prefer the version in
 * liveops.config.ts which has the full AirportMeta context.
 */
export { isAirportPlayable } from './liveops.config';

export function isShiftUnlocked(airport: Airport, shift: Shift, p: Progress): boolean {
  if (shift.tier === 1) return true;
  const prev = SHIFTS.find((s) => s.tier === shift.tier - 1);
  return prev ? !!p.cleared[`${airport.id}:${prev.id}`] : false;
}

export function isEndlessUnlocked(airport: Airport, p: Progress): boolean {
  return !!p.cleared[`${airport.id}:midday-mix`];
}

// ═══════════════════════════════════════════════════════════════════════════
// 7. BACKWARDS-COMPATIBLE FLAT EXPORT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Existing call sites (getLevelById, getLevelByNumber, getNextLevel) keep
 * working — LEVELS is now generated rather than authored. Migrate the menu
 * to the airport/shift model at leisure; the engine never has to know.
 */
export function buildAllLevels(airports: Airport[], profile: PlatformProfile): ResolvedLevel[] {
  return airports.flatMap((airport) => SHIFTS.map((shift) => buildLevel(airport, shift, profile)));
}

// ═══════════════════════════════════════════════════════════════════════════
// 8. SHIFT ENUM — stable numeric id for each shift
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Stable numeric id for each shift, derived from the SHIFTS array index.
 *
 * Why a number instead of the string `id`?
 *   `profiles.last_passed_level` is stored as `[airport]:[shift]`. Using the
 *   numeric enum there (e.g. `WADD:3`) makes the value compact, sortable, and
 *   immune to a future rename of a shift's `id` slug — a rename of
 *   `evening-rush` → `evening-peak` would otherwise silently break every
 *   stored `last_passed_level` value on every user's device and on the
 *   server. The enum is derived from the array position, so adding a new
 *   shift only extends the range without invalidating existing values.
 *
 * `endless` is deliberately absent — it has no completion screen and is never
 * recorded as a passed shift (see `markLevelPassed`).
 */
export const SHIFT_ENUM: Record<string, number> = Object.fromEntries(
  SHIFTS.map((shift, index) => [shift.id, index + 1])
);

export function getShiftEnum(shiftId: string): number | null {
  return SHIFT_ENUM[shiftId] ?? null;
}

export function getShiftIdFromEnum(enumValue: number): string | null {
  const entry = SHIFTS[enumValue - 1];
  return entry ? entry.id : null;
}

/**
 * Resolve a stored shift value (string id OR numeric enum) to a shift id.
 * Accepts both so a row migrated from the string-id era still works.
 */
export function resolveShiftId(value: string | number | null | undefined): string | null {
  if (value == null) return null;
  if (typeof value === 'number') return getShiftIdFromEnum(value);
  if (SHIFT_ENUM[value] !== undefined) return value;
  return null;
}
