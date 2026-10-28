/**
 * Default game settings and constants
 * All other configurations should derive from these base values
 */

// =============================================================================
// SCREEN & DISPLAY DEFAULTS
// =============================================================================

// =============================================================================
// PATH DRAWING CONFIGURATION
// These values control how player-drawn plane paths look and behave.
// Adjust freely — no other file needs to change.
// =============================================================================

export const PATH_CONFIG = {
  /**
   * Distance (world-local units) between consecutive normalised path dots.
   * Larger value → dots farther apart (sparser, lighter-looking path).
   */
  NORMALIZED_STEP: 10,

  /**
   * Minimum pointer travel distance (world-local units) before a new raw
   * sample is recorded. Should be ≤ NORMALIZED_STEP.
   */
  RAW_SIMPLIFY_THRESHOLD: 10,

  /**
   * Maximum heading change ALLOWED between consecutive path dots, in degrees.
   * This prevents aircraft from making instant sharp turns when the player
   * draws a jagged or looping line.
   *   5°  → very gradual, airline-like curves
   *  15°  → moderate, general-aviation style
   *  30°  → sharp but not instant
   * Raise this value if planes feel sluggish to re-route.
   */
  MAX_TURN_DEGREES: 35,

  /**
   * How far ahead of the plane (as a fraction of the plane's visual size) the
   * drawn path starts.  Setting this to 0 would start the path at the plane's
   * centre, causing an instant direction-snap to wherever the player first
   * touched.  A value of 1/3 means the first path point is placed 1/3 of the
   * plane's diameter in front of its nose — the flight then continues smoothly
   * from there rather than jerking back through the centre.
   *   0.0  → path starts at plane centre (legacy, causes jerk)
   *   0.33 → 1/3 plane size ahead (recommended)
   *   1.0  → one full plane-diameter ahead
   */
  // Dots start this many plane-radii ahead of the centre in the nose direction.
  // 0.5 = half the icon diameter ahead — dots begin just in front of the nose tip.
  PATH_START_AHEAD_FACTOR: 0,

  /**
   * Visual radius of each path dot in canvas pixels.
   * Kept intentionally thin — just a subtle guide, not a bold line.
   */
  DOT_RADIUS: 2,

  /**
   * Opacity of path dots (0 = invisible, 1 = fully opaque).
   */
  DOT_ALPHA: 0.35,
} as const;

export const DISPLAY_DEFAULTS = {
  // LANDSCAPE ONLY - No portrait mode allowed
  ASPECT_RATIO_LANDSCAPE: 16 / 9, // Standard landscape aspect ratio
  ORIENTATION_LOCK: 'landscape' as const, // Force landscape orientation

  // Reference screen sizes (px) - ALL LANDSCAPE
  DESKTOP_REFERENCE: {
    width: 1920, // MacBook Pro 16" / Standard desktop
    height: 1080,
  },
  MOBILE_LANDSCAPE_REFERENCE: {
    width: 844, // iPhone 15 Pro landscape
    height: 390,
  },
  TABLET_LANDSCAPE_REFERENCE: {
    width: 1024, // iPad landscape
    height: 768,
  },

  // Minimum viable canvas size (landscape only)
  MIN_WIDTH: 568, // iPhone SE landscape width
  MIN_HEIGHT: 320, // iPhone SE landscape height

  // Maximum canvas size (performance limit)
  MAX_WIDTH: 3840, // 4K
  MAX_HEIGHT: 2160,

  // Fullscreen settings
  FULLSCREEN_REQUIRED_MOBILE: true, // Mobile MUST be fullscreen
  FULLSCREEN_DEFAULT_DESKTOP: true, // Desktop defaults to fullscreen
  ALLOW_RESIZE_DESKTOP: true, // Desktop can exit fullscreen
  ALLOW_RESIZE_MOBILE: false, // Mobile CANNOT resize/exit fullscreen

  // UI Safe zones (percentage of screen)
  SAFE_ZONE_TOP: 0.03, // Notches, status bars (landscape notches smaller)
  SAFE_ZONE_BOTTOM: 0.03, // Home indicators
  SAFE_ZONE_SIDES: 0.05, // Side notches (iPhone landscape)

  // Pixel density handling
  TARGET_DPR: 2, // Target device pixel ratio
  MAX_DPR: 3, // Cap for performance (iPhone 15 Pro = 3x)
  MIN_DPR: 1,
} as const;

// =============================================================================
// DEFAULT PLANE TYPE (TYPE 1 - BASELINE)
// =============================================================================

export const DEFAULT_PLANE_TYPE = {
  ID: 1,
  NAME: 'Cessna 172 (Small Aircraft)',

  // Visual size (px) - base sprite size before scaling
  BASE_SIZE: 100, // Default plane sprite display size (2x for better visibility)

  // Collision detection - EQUAL TO IMAGE SIZE
  // Collision radius = BASE_SIZE * COLLISION_PERCENTAGE
  COLLISION_PERCENTAGE: 1.0, // 100% of plane image size (collision = full sprite)
  WARNING_PERCENTAGE: 1.4, // 140% of plane image size (35px for 25px plane)
  DANGER_PERCENTAGE: 2.4, // 240% of plane image size (60px for 25px plane)

  // Calculated radii (for reference, at 25px base size)
  COLLISION_RADIUS: 25, // BASE_SIZE * 1.0 = full sprite size
  WARNING_RADIUS: 35, // BASE_SIZE * 1.4
  DANGER_RADIUS: 60, // BASE_SIZE * 2.4

  // Movement
  BASE_SPEED: 0.4, // pixels per frame at 60fps (~24 px/s)
  TURN_RATE: 0.03, // Radians per frame (lower = slower turn)

  // Acceleration (for future smooth speed changes)
  ACCELERATION: 0.01,
  DECELERATION: 0.015,

  // Path following
  PATH_ACCURACY: 10, // Distance to waypoint before advancing (px)

  // Weight class for separation rules
  WEIGHT_CLASS: 'light' as 'light' | 'medium' | 'heavy' | 'super',
} as const;

// =============================================================================
// DEVICE SCALE FACTORS
// =============================================================================

export const DEVICE_SCALE_DEFAULTS = {
  // Base scale multipliers for different devices (LANDSCAPE ONLY)
  DESKTOP: 1.0, // 1:1 scale on desktop
  TABLET: 0.85, // Slightly smaller on tablets
  MOBILE_LANDSCAPE: 0.7, // Smaller on mobile landscape

  // Auto-detection thresholds (px) - landscape width
  MOBILE_MAX_WIDTH: 768, // Below this = mobile
  TABLET_MAX_WIDTH: 1024, // Below this = tablet
} as const;

// =============================================================================
// REAL-WORLD AIRCRAFT DATA
//
// Source of truth for physical characteristics.
// A380 is the normalization reference — all other aircraft express their
// measurements relative to it.
//
// To add a new aircraft:
//   1. Add an entry here (wingspan_m, length_m, cruiseSpeed_kmh, weightClass).
//   2. Call defineAircraft() in PLANE_TYPE_VARIANTS with the same data.
//   3. Add icon files N-<color>.png and N-shadow.png to src/assets/planes/.
//   That is all — every multiplier is calculated automatically.
// =============================================================================

export const REAL_WORLD_AIRCRAFT = {
  /**
   * Airbus A380-800 — normalization reference (all ratios = 1.0).
   * Maps to plane type id 2.  Icons: 2-<color>.png, 2-shadow.png
   */
  A380: {
    icaoCode: 'A388',
    manufacturer: 'Airbus',
    model: 'A380-800',
    wingspan_m: 80,
    length_m: 73,
    cruiseSpeed_kmh: 950,
    weightClass: 'super' as const,
  },

  /**
   * Airbus A320-200 — narrow-body short/medium-haul airliner.
   * Maps to plane type id 3.  Icons: 3-<color>.png, 3-shadow.png
   */
  A320: {
    icaoCode: 'A320',
    manufacturer: 'Airbus',
    model: 'A320-200',
    wingspan_m: 34,
    length_m: 44,
    cruiseSpeed_kmh: 870,
    weightClass: 'medium' as const,
  },
} as const;

// =============================================================================
// REAL-WORLD → GAME UNIT ANCHOR
//
// Defines what A380's real-world values (ratio = 1.0) map to in Phaser units.
// Every other aircraft multiplies these anchors by its own ratios.
//
//   sizeMultiplier      = ANCHOR.SIZE × (wingspan_m / A380.wingspan_m)
//   speedMultiplier     = ANCHOR.SPEED      × (cruiseSpeed_kmh  / A380.cruiseSpeed_kmh)
//   turnRateMultiplier  = ANCHOR.TURN_RATE  / (wingspanRatio ^ TURN_WINGSPAN_EXP
//                                              × speedRatio   ^ TURN_SPEED_EXP)
//
// To rescale all real-world aircraft at once, change SIZE or SPEED here.
// To adjust how aggressively size / speed penalise turn rate, change the exponents.
// =============================================================================

/**
 * Required longest-axis size (px) for every plane icon PNG.
 *
 * Plane.ts normalises sprites with: textureScale = baseSize / max(canvas_w, canvas_h)
 * When every icon shares the same canvas_max, sizeMultiplier maps cleanly to
 * rendered pixels with no per-file compensation:
 *
 *   rendered_px ≈ ICON_CANVAS_MAX × fill% × sizeMultiplier × BASE_SIZE / ICON_CANVAS_MAX
 *               ≈ fill% × sizeMultiplier × BASE_SIZE
 *
 * See PlaneIcons.md for the full export spec.
 */
export const ICON_CANVAS_MAX = 690;

export const REAL_WORLD_GAME_ANCHOR = {
  /**
   * A380 visual size multiplier — the reference anchor for all aircraft.
   * Every other type's sizeMultiplier is derived as:
   *   defineSizeMultiplier(wingspan_m) = SIZE × (wingspan_m / A380.wingspan_m)
   *
   * 1.3 → A380 renders at 130 px on desktop (before device-scale factor)
   *        when its icon is exported at the standard ICON_CANVAS_MAX (690 px).
   *
   * DO NOT change this value — it is calibrated to the shipped A380 icon.
   * Changing it rescales every aircraft in the game simultaneously.
   */
  SIZE: 1.3,

  /**
   * A380 speed relative to DEFAULT_PLANE_TYPE.BASE_SPEED (0.4 px/frame).
   * 1.5 → A380 moves at 0.60 px/frame at 60 fps.
   */
  SPEED: 1.5,

  /**
   * A380 turn-rate multiplier — the physics-derived anchor for all aircraft.
   * Smaller aircraft will automatically receive a higher turn rate than this.
   */
  TURN_RATE: 0.5,

  /**
   * How strongly wingspan affects turn rate.
   * 0.6 means a 10 % wider aircraft turns ≈ 6 % slower.
   * Raise toward 1.0 to make size a stronger penalty; lower to soften it.
   */
  TURN_WINGSPAN_EXP: 0.6,

  /**
   * How strongly cruise speed affects turn rate.
   * 0.4 means a 10 % faster aircraft turns ≈ 4 % slower.
   * Raise toward 1.0 to make speed a stronger penalty; lower to soften it.
   */
  TURN_SPEED_EXP: 0.4,
} as const;

// =============================================================================
// PLANE TYPE VARIANTS (Relative to Default)
// =============================================================================

export interface PlaneTypeVariant {
  id: number;
  name: string;
  manufacturer: string;
  sizeMultiplier: number; // × DEFAULT_PLANE_TYPE.BASE_SIZE
  speedMultiplier: number; // × DEFAULT_PLANE_TYPE.BASE_SPEED
  turnRateMultiplier: number; // × DEFAULT_PLANE_TYPE.TURN_RATE
  weightClass: 'light' | 'medium' | 'heavy' | 'super';
  description: string;
}

// =============================================================================
// MULTIPLIER CALCULATION FUNCTIONS
//
// Usage — adding Boeing 737 MAX (id 4 in this example):
//
//   defineAircraft({
//     id: 4,
//     name: 'Boeing 737 MAX 8',
//     manufacturer: 'Boeing',
//     wingspan_m: 35.9,
//     length_m: 39.5,
//     cruiseSpeed_kmh: 839,
//     weightClass: 'medium',
//     description: 'Short/medium-haul narrow-body. Wingspan 35.9 m, cruise 839 km/h.',
//   })
//
// That single call computes and returns a ready-to-use PlaneTypeVariant.
// =============================================================================

/**
 * Raw real-world data you supply for one aircraft.
 * All three measurement fields drive the three multipliers — nothing else needed.
 */
export interface RealWorldAircraftInput {
  id: number;
  name: string;
  manufacturer: string;
  /** Top-down visual dimension — determines in-game sprite size. */
  wingspan_m: number;
  /** Used for record-keeping and future length-based features. */
  length_m: number;
  /** Typical cruise speed — determines in-game movement speed. */
  cruiseSpeed_kmh: number;
  weightClass: 'light' | 'medium' | 'heavy' | 'super';
  description: string;
  /**
   * Optional sizeMultiplier override.
   * Use ONLY as a temporary measure when an icon has not yet been re-exported
   * at ICON_CANVAS_MAX (690 px). Remove once the icon is compliant.
   * When absent, defineSizeMultiplier(length_m) is used automatically.
   */
  sizeMultiplier?: number;
}

/**
 * Calculates the sprite-size multiplier from real-world aircraft wingspan.
 *
 * Sizing is wingspan-based because it correctly handles variants of the same
 * airframe (e.g. A320ceo vs A320neo vs A320-300) which share the same fuselage
 * length but differ in wingspan — the dominant visual dimension in a top-down view.
 *
 * A380 wingspan (80 m) is the anchor = 1.0. All other aircraft are expressed
 * as a fraction of it:
 *
 *   result = ANCHOR.SIZE × (wingspan_m / A380.wingspan_m)
 *          = 1.3         × (wingspan_m / 80)
 *
 * This formula produces the correct on-screen proportions only when the icon
 * PNG is exported at ICON_CANVAS_MAX (690 px) on its longest axis with the
 * plane content filling ≥ 98 % of that axis. See PlaneIcons.md.
 *
 * Examples:
 *   A380     (80 m)  → 1.3 × (80/80) = 1.300
 *   A320     (34 m)  → 1.3 × (34/80) = 0.553
 *   A320neo  (35.8 m)→ 1.3 × (35.8/80) = 0.582
 *   B737 MAX (35.9 m)→ 1.3 × (35.9/80) = 0.584
 */
export function defineSizeMultiplier(wingspan_m: number): number {
  return REAL_WORLD_GAME_ANCHOR.SIZE * (wingspan_m / REAL_WORLD_AIRCRAFT.A380.wingspan_m);
}

/** @deprecated Use defineSizeMultiplier(wingspan_m) instead. */
export const calcSizeMultiplier = defineSizeMultiplier;

/**
 * Calculates the speed multiplier from real-world cruise speed.
 *
 *   result = ANCHOR.SPEED × (cruiseSpeed_kmh / A380.cruiseSpeed_kmh)
 *
 * Example: Boeing 737 MAX (839 km/h)
 *   = 1.5 × (839 / 950) = 1.5 × 0.883 ≈ 1.324
 */
export function calcSpeedMultiplier(cruiseSpeed_kmh: number): number {
  return (
    REAL_WORLD_GAME_ANCHOR.SPEED * (cruiseSpeed_kmh / REAL_WORLD_AIRCRAFT.A380.cruiseSpeed_kmh)
  );
}

/**
 * Calculates the turn-rate multiplier from real-world wingspan and cruise speed.
 *
 * Physics basis: larger wingspan → greater inertia → slower turn.
 *                higher speed   → larger turning radius → slower turn.
 *
 *   wingspanRatio = wingspan_m       / A380.wingspan_m       (80 m)
 *   speedRatio    = cruiseSpeed_kmh  / A380.cruiseSpeed_kmh  (950 km/h)
 *
 *   result = ANCHOR.TURN_RATE / (wingspanRatio ^ TURN_WINGSPAN_EXP
 *                                × speedRatio  ^ TURN_SPEED_EXP)
 *
 * A380 always produces exactly ANCHOR.TURN_RATE (0.50) because both ratios = 1.
 * Smaller / slower aircraft automatically receive a higher (more agile) value.
 *
 * Example: Boeing 737 MAX (35.9 m, 839 km/h)
 *   wingspanRatio = 35.9 / 80  = 0.449
 *   speedRatio    = 839  / 950 = 0.883
 *   denominator   = 0.449^0.6 × 0.883^0.4 ≈ 0.601 × 0.952 ≈ 0.572
 *   result        = 0.50 / 0.572 ≈ 0.874
 */
export function calcTurnRateMultiplier(wingspan_m: number, cruiseSpeed_kmh: number): number {
  const wingspanRatio = wingspan_m / REAL_WORLD_AIRCRAFT.A380.wingspan_m;
  const speedRatio = cruiseSpeed_kmh / REAL_WORLD_AIRCRAFT.A380.cruiseSpeed_kmh;
  const denominator =
    Math.pow(wingspanRatio, REAL_WORLD_GAME_ANCHOR.TURN_WINGSPAN_EXP) *
    Math.pow(speedRatio, REAL_WORLD_GAME_ANCHOR.TURN_SPEED_EXP);
  return REAL_WORLD_GAME_ANCHOR.TURN_RATE / denominator;
}

/**
 * Calculates all three multipliers at once.
 * Use this when you want to inspect the values before committing to defineAircraft().
 *
 * Example:
 *   calcAllMultipliers(35.9, 839)
 *   // → { sizeMultiplier: 0.584, speedMultiplier: 1.324, turnRateMultiplier: 0.874 }
 */
export function calcAllMultipliers(
  wingspan_m: number,
  cruiseSpeed_kmh: number
): { sizeMultiplier: number; speedMultiplier: number; turnRateMultiplier: number } {
  return {
    sizeMultiplier: defineSizeMultiplier(wingspan_m),
    speedMultiplier: calcSpeedMultiplier(cruiseSpeed_kmh),
    turnRateMultiplier: calcTurnRateMultiplier(wingspan_m, cruiseSpeed_kmh),
  };
}

/**
 * Builds a complete PlaneTypeVariant from real-world measurements.
 * This is the only function you need to call when adding a new aircraft.
 *
 * Example:
 *   defineAircraft({
 *     id: 4,
 *     name: 'Boeing 737 MAX 8',
 *     manufacturer: 'Boeing',
 *     wingspan_m: 35.9,
 *     length_m: 39.5,
 *     cruiseSpeed_kmh: 839,
 *     weightClass: 'medium',
 *     description: 'Short/medium-haul narrow-body. Wingspan 35.9 m, cruise 839 km/h.',
 *   })
 */
export function defineAircraft(input: RealWorldAircraftInput): PlaneTypeVariant {
  const multipliers = calcAllMultipliers(input.wingspan_m, input.cruiseSpeed_kmh);
  return {
    id: input.id,
    name: input.name,
    manufacturer: input.manufacturer,
    weightClass: input.weightClass,
    description: input.description,
    ...multipliers,
    // Canvas-aspect override: replaces the computed sizeMultiplier when
    // the icon canvas proportions would produce incorrect visual scaling.
    ...(input.sizeMultiplier !== undefined && { sizeMultiplier: input.sizeMultiplier }),
  };
}

// =============================================================================
// FLEET ID → FOLDER NAME MAPPING
// =============================================================================
//
//   id  folder name       Aircraft
//   ─── ───────────────── ─────────────────────────────────────
//    1  1-a380            Airbus A380-800          (SUPER)
//    2  2-a340            Airbus A340-600          (HEAVY)
//    3  3-a320            Airbus A320-200          (MEDIUM)
//    4  4-dc9             Douglas DC-9             (MEDIUM)
//    5  5-concorde        Concorde                 (HEAVY)
//    6  6-b777            Boeing 777-9 (777X)      (HEAVY)
//    7  7-c17             Boeing C-17 Globemaster  (HEAVY)
//    8  8-an22            Antonov An-22            (HEAVY)
//    9  9-md11            Douglas MD-11            (HEAVY)
//   10  10-cessna-700     Cessna Citation 700      (LIGHT/MED)
//   11  11-e170           Embraer E195-E2          (MEDIUM)
//   12  12-b747           Boeing 747-8i            (HEAVY)
//
//   Source data: atc-app_aircraft_fleet_matrix.md
//   Cruise speeds converted from Mach using standard atmosphere @ FL350:
//     Mach 1.0 ≈ 1062 km/h  (used for Concorde supersonic cruise)
//     Mid-range Mach used for all subsonic types:
//       mid = (minMach + maxMach) / 2 × 1062
//   A380 remains the normalisation reference (ratio = 1.0).
// =============================================================================

export const PLANE_TYPE_VARIANTS: readonly PlaneTypeVariant[] = [
  // ── Type 1: Airbus A380-800 ───────────────────────────────────────────────
  // Normalisation anchor — all ratios = 1.0.
  // Folder: 1-a380   Icons: 1-<color>.png, 1-shadow.png
  // calcAllMultipliers(79.8, 950):
  //   sizeMultiplier:     1.3 × (79.8/80) = 1.297 ≈ 1.300
  //   speedMultiplier:    1.5 × (950/950) = 1.500
  //   turnRateMultiplier: 0.50 / (1.0^0.6 × 1.0^0.4) = 0.500
  defineAircraft({
    id: 1,
    name: 'Airbus A380-800',
    manufacturer: 'Airbus',
    wingspan_m: REAL_WORLD_AIRCRAFT.A380.wingspan_m, // 80 m
    length_m: REAL_WORLD_AIRCRAFT.A380.length_m, // 73 m
    cruiseSpeed_kmh: REAL_WORLD_AIRCRAFT.A380.cruiseSpeed_kmh, // 950 km/h
    weightClass: REAL_WORLD_AIRCRAFT.A380.weightClass, // 'super'
    description: 'Largest commercial airliner. Wingspan 79.8 m, cruise Mach 0.85.',
  }),

  // ── Type 2: Airbus A340-600 ───────────────────────────────────────────────
  // Folder: 2-a340   Icons: 2-<color>.png, 2-shadow.png
  // Fleet matrix: wingspan 63.4 m, mid cruise Mach 0.82 → 870 km/h
  // calcAllMultipliers(63.4, 870):
  //   sizeMultiplier:     1.3 × (63.4/80) = 1.030
  //   speedMultiplier:    1.5 × (870/950) = 1.374
  //   turnRateMultiplier: 0.50 / (0.793^0.6 × 0.916^0.4) ≈ 0.613
  defineAircraft({
    id: 2,
    name: 'Airbus A340-600',
    manufacturer: 'Airbus',
    wingspan_m: 63.4,
    length_m: 75.3,
    cruiseSpeed_kmh: 870,
    weightClass: 'heavy',
    description: 'Four-engine wide-body long-haul. Wingspan 63.4 m, cruise Mach 0.82.',
    sizeMultiplier: 1.18, // TEMPORARY override — icon canvas is non-compliant (see PlaneIcons.md)
  }),

  // ── Type 3: Airbus A320-200 ───────────────────────────────────────────────
  // Folder: 3-a320   Icons: 3-<color>.png, 3-shadow.png
  // wingspan: 34 m (REAL_WORLD_AIRCRAFT.A320), cruise 870 km/h
  // calcAllMultipliers(34, 870):
  //   sizeMultiplier (formula): 1.3 × (34/80) = 0.553
  //   speedMultiplier:          1.5 × (870/950) = 1.374
  //   turnRateMultiplier:       0.50 / (0.425^0.6 × 0.916^0.4) ≈ 0.865
  //
  // ⚠️ TEMPORARY sizeMultiplier override — current icon is NON-COMPLIANT:
  //    canvas 767×690 px (canvas_max=767, should be 690)
  //    plane content fill ~48% (should be ≥98%)
  //
  //    Plane.ts renders: content_px = fill × canvas_max × textureScale
  //                                 = fill × baseSize
  //    So visual content = fill(0.48) × BASE_SIZE(100) × sizeMultiplier
  //    Intended visual   = BASE_SIZE × formula_sm = 100 × 0.553 = 55.25 px
  //    Solving: sm = 55.25 / (0.48 × 100) = 1.151
  //
  //    Old override was 1.0 → icon rendered at 48 px instead of 55 px (−13%).
  //    Corrected override 1.151 makes content render at the wingspan-correct size.
  //
  //    To fix permanently:
  //      1. Resize canvas to 690 px longest axis
  //      2. Crop so plane content fills ≥98% of that axis (≥676 px)
  //      3. Export RGBA, transparent background, nose right
  //      4. Run verification script in PlaneIcons.md — all checks must pass
  //      5. Delete the sizeMultiplier line below
  //      → defineAircraft will compute 1.3 × (34/80) = 0.553 automatically
  defineAircraft({
    id: 3,
    name: 'Airbus A320-200',
    manufacturer: 'Airbus',
    wingspan_m: REAL_WORLD_AIRCRAFT.A320.wingspan_m, // 34 m
    length_m: REAL_WORLD_AIRCRAFT.A320.length_m, // 44 m
    cruiseSpeed_kmh: REAL_WORLD_AIRCRAFT.A320.cruiseSpeed_kmh, // 870 km/h
    weightClass: REAL_WORLD_AIRCRAFT.A320.weightClass, // 'medium'
    description: 'Narrow-body short/medium-haul airliner. Wingspan 34 m, cruise 870 km/h.',
    sizeMultiplier: 0.95,
  }),

  // ── Type 4: Douglas DC-9 ─────────────────────────────────────────────────
  // Folder: 4-dc9   Icons: 4-<color>.png, 4-shadow.png
  // Fleet matrix: wingspan 28.5 m, mid cruise Mach 0.74 → 786 km/h
  // calcAllMultipliers(28.5, 786):
  //   sizeMultiplier:     1.3 × (28.5/80) = 0.463
  //   speedMultiplier:    1.5 × (786/950) = 1.241
  //   turnRateMultiplier: 0.50 / (0.356^0.6 × 0.828^0.4) ≈ 0.994
  defineAircraft({
    id: 4,
    name: 'Douglas DC-9',
    manufacturer: 'McDonnell Douglas',
    wingspan_m: 28.5,
    length_m: 31.8,
    cruiseSpeed_kmh: 786,
    weightClass: 'medium',
    description: 'Twin-engine short-haul narrow-body. Wingspan 28.5 m, cruise Mach 0.74.',
    sizeMultiplier: 0.98,
  }),

  // ── Type 5: Concorde ─────────────────────────────────────────────────────
  // Folder: 5-concorde   Icons: 5-<color>.png, 5-shadow.png
  // Fleet matrix: wingspan 25.6 m, cruise Mach 1.70 (mid) → 1805 km/h
  // calcAllMultipliers(25.6, 1805):
  //   sizeMultiplier:     1.3 × (25.6/80) = 0.416
  //   speedMultiplier:    1.5 × (1805/950) = 2.850
  //   turnRateMultiplier: 0.50 / (0.320^0.6 × 1.900^0.4) ≈ 0.354
  defineAircraft({
    id: 5,
    name: 'Concorde',
    manufacturer: 'Aérospatiale / BAC',
    wingspan_m: 25.6,
    length_m: 61.6,
    cruiseSpeed_kmh: 1200, //1805, // Mach 1.70 at altitude
    weightClass: 'heavy',
    description: 'Supersonic passenger jet. Wingspan 25.6 m, cruise Mach 2.04 max.',
    sizeMultiplier: 1.1,
  }),

  // ── Type 6: Boeing 777-9 (777X) ──────────────────────────────────────────
  // Folder: 6-b777   Icons: 6-<color>.png, 6-shadow.png
  // Fleet matrix: wingspan 71.8 m, mid cruise Mach 0.835 → 887 km/h
  // calcAllMultipliers(71.8, 887):
  //   sizeMultiplier:     1.3 × (71.8/80) = 1.167
  //   speedMultiplier:    1.5 × (887/950) = 1.400
  //   turnRateMultiplier: 0.50 / (0.898^0.6 × 0.934^0.4) ≈ 0.558
  defineAircraft({
    id: 6,
    name: 'Boeing 777-9 (777X)',
    manufacturer: 'Boeing',
    wingspan_m: 71.8,
    length_m: 76.7,
    cruiseSpeed_kmh: 887,
    weightClass: 'heavy',
    description: 'Twin-engine wide-body long-haul. Wingspan 71.8 m, cruise Mach 0.835.',
    sizeMultiplier: 1.18,
  }),

  // ── Type 7: Boeing C-17 Globemaster III ──────────────────────────────────
  // Folder: 7-c17   Icons: 7-<color>.png, 7-shadow.png
  // Fleet matrix: wingspan 51.8 m, mid cruise Mach 0.755 → 802 km/h
  // calcAllMultipliers(51.8, 802):
  //   sizeMultiplier:     1.3 × (51.8/80) = 0.842
  //   speedMultiplier:    1.5 × (802/950) = 1.266
  //   turnRateMultiplier: 0.50 / (0.648^0.6 × 0.844^0.4) ≈ 0.735
  defineAircraft({
    id: 7,
    name: 'Boeing C-17 Globemaster III',
    manufacturer: 'Boeing',
    wingspan_m: 51.8,
    length_m: 53.0,
    cruiseSpeed_kmh: 802,
    weightClass: 'heavy',
    description: 'Military strategic airlifter. Wingspan 51.8 m, cruise Mach 0.755.',
    sizeMultiplier: 1.1,
  }),

  // ── Type 8: Antonov An-22 ────────────────────────────────────────────────
  // Folder: 8-an22   Icons: 8-<color>.png, 8-shadow.png
  // Fleet matrix: wingspan 64.4 m, mid cruise Mach 0.475 → 504 km/h
  // calcAllMultipliers(64.4, 504):
  //   sizeMultiplier:     1.3 × (64.4/80) = 1.047
  //   speedMultiplier:    1.5 × (504/950) = 0.796
  //   turnRateMultiplier: 0.50 / (0.805^0.6 × 0.531^0.4) ≈ 0.785
  defineAircraft({
    id: 8,
    name: 'Antonov An-22',
    manufacturer: 'Antonov',
    wingspan_m: 64.4,
    length_m: 57.9,
    cruiseSpeed_kmh: 504, // Mach 0.475 at cruise altitude
    weightClass: 'heavy',
    description: 'Heavy turboprop strategic airlifter. Wingspan 64.4 m, cruise Mach 0.475.',
    sizeMultiplier: 1.1,
  }),

  // ── Type 9: Douglas MD-11 ────────────────────────────────────────────────
  // Folder: 9-md11   Icons: 9-<color>.png, 9-shadow.png
  // Fleet matrix: wingspan 51.7 m, mid cruise Mach 0.81 → 860 km/h
  // calcAllMultipliers(51.7, 860):
  //   sizeMultiplier:     1.3 × (51.7/80) = 0.840
  //   speedMultiplier:    1.5 × (860/950) = 1.358
  //   turnRateMultiplier: 0.50 / (0.646^0.6 × 0.905^0.4) ≈ 0.749
  defineAircraft({
    id: 9,
    name: 'Douglas MD-11',
    manufacturer: 'McDonnell Douglas',
    wingspan_m: 51.7,
    length_m: 61.2,
    cruiseSpeed_kmh: 860,
    weightClass: 'heavy',
    description: 'Three-engine wide-body long-haul. Wingspan 51.7 m, cruise Mach 0.81.',
    sizeMultiplier: 1.1,
  }),

  // ── Type 10: Cessna Citation (business jet) ───────────────────────────────
  // Folder: 10-cessna-700   Icons: 10-<color>.png, 10-shadow.png
  // Fleet matrix: wingspan 14.3 m, mid cruise Mach 0.635 → 674 km/h
  // calcAllMultipliers(14.3, 674):
  //   sizeMultiplier:     1.3 × (14.3/80) = 0.232
  //   speedMultiplier:    1.5 × (674/950) = 1.064
  //   turnRateMultiplier: 0.50 / (0.179^0.6 × 0.709^0.4) ≈ 1.643
  defineAircraft({
    id: 10,
    name: 'Cessna Citation 700',
    manufacturer: 'Cessna',
    wingspan_m: 21,
    length_m: 23,
    cruiseSpeed_kmh: 890,
    weightClass: 'medium',
    description: 'Business jet. Wingspan 21 m, cruise Mach 0.92.',
    sizeMultiplier: 0.8,
  }),

  // ── Type 11: Embraer E195-E2 ─────────────────────────────────────────────
  // Folder: 11-e170   Icons: 11-<color>.png, 11-shadow.png
  // Fleet matrix: wingspan 35.1 m, mid cruise Mach 0.785 → 834 km/h
  // calcAllMultipliers(35.1, 834):
  //   sizeMultiplier:     1.3 × (35.1/80) = 0.571
  //   speedMultiplier:    1.5 × (834/950) = 1.317
  //   turnRateMultiplier: 0.50 / (0.439^0.6 × 0.878^0.4) ≈ 0.877
  defineAircraft({
    id: 11,
    name: 'Embraer E195-E2',
    manufacturer: 'Embraer',
    wingspan_m: 35.1,
    length_m: 41.5,
    cruiseSpeed_kmh: 834,
    weightClass: 'medium',
    description: 'Regional narrow-body airliner. Wingspan 35.1 m, cruise Mach 0.785.',
    sizeMultiplier: 0.8,
  }),

  // ── Type 12: Boeing 747-8i ────────────────────────────────────────────────
  // Folder: 12-b747   Icons: 12-<color>.png, 12-shadow.png
  // Fleet matrix: wingspan 68.4 m, mid cruise Mach 0.85 → 903 km/h
  // calcAllMultipliers(68.4, 903):
  //   sizeMultiplier:     1.3 × (68.4/80) = 1.112
  //   speedMultiplier:    1.5 × (903/950) = 1.426
  //   turnRateMultiplier: 0.50 / (0.855^0.6 × 0.950^0.4) ≈ 0.575
  defineAircraft({
    id: 12,
    name: 'Boeing 747-8i',
    manufacturer: 'Boeing',
    wingspan_m: 68.4,
    length_m: 76.3,
    cruiseSpeed_kmh: 903,
    weightClass: 'heavy',
    description: 'Iconic wide-body quad-jet. Wingspan 68.4 m, cruise Mach 0.85.',
    sizeMultiplier: 1.16,
  }),
];

// =============================================================================
// COLLISION & SAFETY DEFAULTS
// =============================================================================

export const COLLISION_DEFAULTS = {
  // Minimum separation distances (px)
  MIN_SEPARATION_SAME_LEVEL: DEFAULT_PLANE_TYPE.DANGER_RADIUS, // 120px
  MIN_SEPARATION_DIFF_LEVEL: 60, // Less strict when at different altitudes

  // Warning thresholds (px)
  WARNING_DISTANCE: DEFAULT_PLANE_TYPE.WARNING_RADIUS, // 70px (yellow)
  DANGER_DISTANCE: DEFAULT_PLANE_TYPE.DANGER_RADIUS, // 120px (red)

  // Near-miss detection (for bonus points)
  NEAR_MISS_DISTANCE: 150, // Passed within this range safely
  NEAR_MISS_BONUS: 25, // Score bonus

  // Collision grace period (ms)
  SPAWN_GRACE_PERIOD: 3000, // No collisions for first 3 seconds
  LEVEL_CHANGE_GRACE: 1000, // Brief immunity when changing altitude

  // Warning animation
  WARNING_PULSE_SPEED: 0.005,
  WARNING_OPACITY_MIN: 0.4,
  WARNING_OPACITY_MAX: 0.7,
} as const;

// =============================================================================
// VERTICAL SEPARATION (3-LEVEL SYSTEM)
// =============================================================================

export const LEVEL_DEFAULTS = {
  // Available flight levels
  LEVELS: [-1, 0, 1] as const, // Descending, Cruise, Climbing

  // Visual scale per level (for depth perception)
  LEVEL_SCALES: {
    '-1': 0.9, // Descending (smaller, lower)
    '0': 1.0, // Cruise (normal)
    '1': 1.2, // Climbing (larger, higher)
  },

  // Z-depth offsets for rendering order
  LEVEL_DEPTH_OFFSET: 100, // Added per level for z-sorting

  // Transition animation
  LEVEL_CHANGE_DURATION_MS: 2000,

  // Separation rules
  VERTICAL_SEPARATION_SAFE: true, // Different levels = no collision
} as const;

// =============================================================================
// PERFORMANCE DEFAULTS
// =============================================================================

export const PERFORMANCE_DEFAULTS = {
  // Target frame rate
  TARGET_FPS: 60,
  MIN_FPS: 30, // Below this, show performance warning

  // Physics update rate
  PHYSICS_STEP_MS: 16.67, // ~60 Hz

  // Particle/effect limits
  MAX_PARTICLES: 100,
  MAX_TRAILS: 20,
  MAX_WARNING_CIRCLES: 10,

  // Rendering optimizations
  CULL_OFFSCREEN_MARGIN: 200, // Don't render if this far offscreen (px)
  PATH_SIMPLIFICATION_THRESHOLD: 20, // Douglas-Peucker threshold

  // Asset loading
  PRELOAD_TIMEOUT_MS: 30000, // 30 seconds
} as const;

// =============================================================================
// INPUT & CONTROLS DEFAULTS
// =============================================================================

export const INPUT_DEFAULTS = {
  // Touch/Mouse sensitivity
  MIN_DRAG_DISTANCE: 5, // Minimum px to register as drag
  TAP_MAX_DURATION_MS: 300, // Max time for tap vs hold
  TAP_MAX_DISTANCE: 10, // Max movement for tap

  // Double-tap detection
  DOUBLE_TAP_WINDOW_MS: 300,

  // Path drawing
  PATH_POINT_INTERVAL: 15, // Add point every N pixels
  PATH_SMOOTHING_FACTOR: 0.3, // Bezier smoothing (0-1)

  // Plane selection
  SELECTION_RADIUS: DEFAULT_PLANE_TYPE.COLLISION_RADIUS, // 30px
  SELECTION_HIGHLIGHT_SCALE: 1.2,

  // Multitouch
  MAX_SIMULTANEOUS_TOUCHES: 3, // Support up to 3 planes at once
} as const;

// =============================================================================
// DIFFICULTY SCALING
// =============================================================================

export const DIFFICULTY_DEFAULTS = {
  EASY: {
    spawnRateMultiplier: 0.6,
    maxPlanesMultiplier: 0.7,
    scoreMultiplier: 0.8,
    collisionPenaltyMultiplier: 0.5,
    timeMultiplier: 1.5, // More time
  },
  NORMAL: {
    spawnRateMultiplier: 1.0,
    maxPlanesMultiplier: 1.0,
    scoreMultiplier: 1.0,
    collisionPenaltyMultiplier: 1.0,
    timeMultiplier: 1.0,
  },
  HARD: {
    spawnRateMultiplier: 1.4,
    maxPlanesMultiplier: 1.3,
    scoreMultiplier: 1.5,
    collisionPenaltyMultiplier: 1.5,
    timeMultiplier: 0.75, // Less time
  },
} as const;

// =============================================================================
// ANIMATION DEFAULTS
// =============================================================================

export const ANIMATION_DEFAULTS = {
  // Plane animations
  SPAWN_FADE_IN_MS: 1000,
  LANDING_DURATION_MS: 4000,
  WAYPOINT_PASSING_DURATION_MS: 2000,
  EXPLOSION_DURATION_MS: 800,

  // UI animations
  UI_FADE_MS: 300,
  SCORE_POPUP_DURATION_MS: 1500,
  LEVEL_TRANSITION_MS: 2000,

  // Easing functions
  DEFAULT_EASE: 'Power2.easeInOut' as const,
  BOUNCE_EASE: 'Bounce.easeOut' as const,
} as const;

// =============================================================================
// SCORING DEFAULTS
// =============================================================================

export const SCORING_DEFAULTS = {
  // Base scores
  PLANE_LANDED: 100,
  WAYPOINT_PASSED: 50,
  SAFE_PATH_BONUS: 10, // Per second of safe flying
  PERFECT_LANDING: 50, // Aligned with runway

  // Penalties
  COLLISION_PENALTY: -200,
  OFFSCREEN_PENALTY: -50,
  TIMEOUT_PENALTY: -30,

  // Multipliers
  COMBO_MULTIPLIER_INCREMENT: 0.1, // +10% per consecutive action
  MAX_COMBO_MULTIPLIER: 3.0,
  COMBO_TIMEOUT_MS: 5000, // Reset combo after 5s inactivity

  // Stars (for level completion)
  STAR_THRESHOLDS: {
    ONE_STAR: 0.5, // 50% of target score
    TWO_STARS: 1.0, // 100% of target score
    THREE_STARS: 1.5, // 150% of target score
  },
} as const;

// =============================================================================
// AUDIO DEFAULTS
// =============================================================================

export const AUDIO_DEFAULTS = {
  // Volume levels (0.0 - 1.0)
  MASTER_VOLUME: 0.7,
  SFX_VOLUME: 0.8,
  MUSIC_VOLUME: 0.5,
  UI_VOLUME: 0.6,

  // Fade durations
  FADE_IN_MS: 1000,
  FADE_OUT_MS: 500,

  // Spatial audio (future feature)
  MAX_AUDIO_DISTANCE: 1000, // Max distance for 3D audio (px)
  AUDIO_ROLLOFF: 0.5, // How quickly sound fades with distance
} as const;

// =============================================================================
// DEBUG DEFAULTS
// =============================================================================

// =============================================================================
// VISUAL / DISPLAY SETTINGS DEFAULTS
// =============================================================================

export const VISUAL_DEFAULTS = {
  // Background brightness overlay (depth 1 inside worldContainer)
  // 0   = fully transparent overlay → background at full brightness
  // 100 = solid black overlay      → background completely hidden
  BG_DIMMING_DEFAULT: 20, // matches existing settings store default
  BG_DIMMING_MIN: 0,
  BG_DIMMING_MAX: 100,
  BG_DIMMING_STEP: 5,
} as const;

// =============================================================================
// DEBUG DEFAULTS
// =============================================================================

export const DEBUG_DEFAULTS = {
  SHOW_FPS: true,
  SHOW_COLLISION_CIRCLES: false,
  SHOW_PATH_DOTS: true,
  SHOW_PLANE_IDS: false,
  SHOW_GRID: false,
  SHOW_PERFORMANCE_STATS: true,

  // Debug colors
  COLLISION_CIRCLE_COLOR: 0xff0000,
  WARNING_CIRCLE_COLOR: 0xffff00,
  PATH_COLOR: 0x00ff00,
  GRID_COLOR: 0x333333,
} as const;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get plane type configuration by ID
 */
export function getPlaneTypeById(id: number): PlaneTypeVariant | undefined {
  return PLANE_TYPE_VARIANTS.find((type) => type.id === id);
}

/**
 * Calculate actual plane properties based on type and device
 * Collision radii are automatically derived from plane size
 */
export function getActualPlaneProperties(planeTypeId: number, deviceScale: number = 1.0) {
  const variant = getPlaneTypeById(planeTypeId);
  if (!variant) {
    console.warn(`Unknown plane type: ${planeTypeId}, using default`);
    const actualSize = DEFAULT_PLANE_TYPE.BASE_SIZE * deviceScale;
    return {
      baseSize: actualSize,
      speed: DEFAULT_PLANE_TYPE.BASE_SPEED,
      turnRate: DEFAULT_PLANE_TYPE.TURN_RATE,
      collisionRadius: actualSize * DEFAULT_PLANE_TYPE.COLLISION_PERCENTAGE,
      warningRadius: actualSize * DEFAULT_PLANE_TYPE.WARNING_PERCENTAGE,
      dangerRadius: actualSize * DEFAULT_PLANE_TYPE.DANGER_PERCENTAGE,
      weightClass: DEFAULT_PLANE_TYPE.WEIGHT_CLASS,
    };
  }

  // Calculate actual size with all multipliers
  const actualSize = DEFAULT_PLANE_TYPE.BASE_SIZE * variant.sizeMultiplier * deviceScale;

  return {
    baseSize: actualSize,
    speed: DEFAULT_PLANE_TYPE.BASE_SPEED * variant.speedMultiplier,
    turnRate: DEFAULT_PLANE_TYPE.TURN_RATE * variant.turnRateMultiplier,
    // Collision radii scale proportionally with plane size
    collisionRadius: actualSize * DEFAULT_PLANE_TYPE.COLLISION_PERCENTAGE,
    warningRadius: actualSize * DEFAULT_PLANE_TYPE.WARNING_PERCENTAGE,
    dangerRadius: actualSize * DEFAULT_PLANE_TYPE.DANGER_PERCENTAGE,
    weightClass: variant.weightClass,
  };
}

/**
 * Detect device type and return appropriate scale factor
 * LANDSCAPE ONLY - portrait detection removed
 */
export function getDeviceScaleFactor(): number {
  if (typeof window === 'undefined') return DEVICE_SCALE_DEFAULTS.DESKTOP;

  // Use screen.height (portrait axis) as the size discriminator — it stays
  // constant regardless of orientation and is reliable in Capacitor/Android.
  // A phone held landscape still has a small screen.height (≈390–430 CSS px).
  const shortAxis = Math.min(screen.width, screen.height);

  if (shortAxis <= DEVICE_SCALE_DEFAULTS.MOBILE_MAX_WIDTH) {
    return DEVICE_SCALE_DEFAULTS.MOBILE_LANDSCAPE;
  }

  if (shortAxis <= DEVICE_SCALE_DEFAULTS.TABLET_MAX_WIDTH) {
    return DEVICE_SCALE_DEFAULTS.TABLET;
  }

  return DEVICE_SCALE_DEFAULTS.DESKTOP;
}

/**
 * Get optimal canvas dimensions for current device
 * ALWAYS FULLSCREEN - fills entire viewport
 */
export function getOptimalCanvasDimensions(): { width: number; height: number } {
  if (typeof window === 'undefined') {
    return DISPLAY_DEFAULTS.DESKTOP_REFERENCE;
  }

  // FULLSCREEN: Use entire viewport
  const width = window.innerWidth;
  const height = window.innerHeight;

  // Ensure landscape orientation (width should be greater than height)
  if (width < height) {
    console.warn('⚠️ Device is in portrait mode! Game requires landscape orientation.');
  }

  // Clamp to min/max for performance
  const clampedWidth = Math.max(
    DISPLAY_DEFAULTS.MIN_WIDTH,
    Math.min(width, DISPLAY_DEFAULTS.MAX_WIDTH)
  );
  const clampedHeight = Math.max(
    DISPLAY_DEFAULTS.MIN_HEIGHT,
    Math.min(height, DISPLAY_DEFAULTS.MAX_HEIGHT)
  );

  return {
    width: clampedWidth,
    height: clampedHeight,
  };
}

/**
 * Check if device is in correct orientation
 */
export function isCorrectOrientation(): boolean {
  if (typeof window === 'undefined') return true;
  return window.innerWidth > window.innerHeight; // Landscape check
}

/**
 * Check if device is mobile
 */
export function isMobileDevice(): boolean {
  if (typeof window === 'undefined') return false;
  // Use the short axis of screen so landscape orientation doesn't fool the check
  return Math.min(screen.width, screen.height) <= DEVICE_SCALE_DEFAULTS.MOBILE_MAX_WIDTH;
}

/**
 * Request fullscreen mode.
 *
 * IMPORTANT: Browsers only allow this API inside a user-gesture handler
 * (click, touchstart, keydown, …).  Calling it at boot/load time will be
 * rejected with "API can only be initiated by a user gesture".
 *
 * Use `requestFullscreenOnUserGesture()` for deferred calls — it queues the
 * request and fires it on the next user interaction automatically.
 */
export async function requestFullscreen(element?: HTMLElement): Promise<boolean> {
  if (typeof document === 'undefined') return false;

  const elem = element || document.documentElement;

  try {
    if (elem.requestFullscreen) {
      await elem.requestFullscreen();
      return true;
    }
  } catch (error) {
    // NotAllowedError is expected when called outside a user gesture — log at
    // debug level only.  All other errors are genuine and logged as warnings.
    const isGestureError =
      error instanceof DOMException &&
      (error.name === 'NotAllowedError' || error.message.includes('user gesture'));

    if (isGestureError) {
      console.debug(
        '[Fullscreen] Deferred — no user gesture yet. Call requestFullscreenOnUserGesture() instead.'
      );
    } else {
      console.warn('Could not enter fullscreen:', error);
    }
    return false;
  }

  return false;
}

/**
 * Attach a one-time listener that requests fullscreen on the next user
 * interaction (click or touchstart).  Safe to call at any point during
 * boot — the actual fullscreen call fires only when the browser allows it.
 *
 * Use this instead of calling requestFullscreen() directly at boot time.
 *
 * @param element  Element to fullscreen (defaults to documentElement).
 * @returns  A promise that resolves to `true` when fullscreen is granted,
 *           `false` if it is rejected or the listener is cleaned up.
 */
export function requestFullscreenOnUserGesture(element?: HTMLElement): Promise<boolean> {
  if (typeof document === 'undefined') return Promise.resolve(false);

  // If we're already in a fullscreen context, resolve immediately.
  if (document.fullscreenElement) return Promise.resolve(true);

  return new Promise<boolean>((resolve) => {
    const gestures = ['click', 'touchstart', 'keydown'] as const;

    const handler = async () => {
      gestures.forEach((evt) => document.removeEventListener(evt, handler, { capture: true }));
      const ok = await requestFullscreen(element);
      resolve(ok);
    };

    gestures.forEach((evt) =>
      document.addEventListener(evt, handler, { once: true, capture: true })
    );
  });
}

/**
 * Exit fullscreen mode (only allowed on desktop)
 */
export async function exitFullscreen(): Promise<boolean> {
  if (typeof document === 'undefined') return false;

  // Prevent mobile from exiting fullscreen
  if (isMobileDevice() && DISPLAY_DEFAULTS.FULLSCREEN_REQUIRED_MOBILE) {
    console.warn('⚠️ Mobile devices must stay in fullscreen mode');
    return false;
  }

  try {
    if (document.exitFullscreen) {
      await document.exitFullscreen();
      return true;
    }
  } catch (error) {
    console.warn('Could not exit fullscreen:', error);
    return false;
  }

  return false;
}

/**
 * Calculate safe zones for UI elements
 */
export function getSafeZones() {
  const { width, height } = getOptimalCanvasDimensions();

  return {
    top: height * DISPLAY_DEFAULTS.SAFE_ZONE_TOP,
    bottom: height * DISPLAY_DEFAULTS.SAFE_ZONE_BOTTOM,
    left: width * DISPLAY_DEFAULTS.SAFE_ZONE_SIDES,
    right: width * DISPLAY_DEFAULTS.SAFE_ZONE_SIDES,
  };
}
