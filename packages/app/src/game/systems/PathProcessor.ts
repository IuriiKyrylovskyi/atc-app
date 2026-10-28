// =============================================================================
// PathProcessor.ts
// =============================================================================
//
// Pure mathematical utilities for flight path construction and analysis.
// No Phaser dependencies. No side effects. Every function is a pure transform:
// data in → data out.
//
// Previously these functions lived as private methods on GameScene (duplicated
// in Plane.ts). Extracting them here gives us:
//   • a single source of truth — Plane.ts and GameScene both import from here
//   • easy unit testing — pure functions need no mocks
//   • clear documentation of the path pipeline in one place
//
// ── PATH PIPELINE (called in this order during pointer-move) ─────────────────
//
//   raw pointer points (screen space)
//         │
//         ▼  screenToWorld()  [WorldTransform — not here]
//   raw points (world-local space)
//         │
//         ▼  normalizeByDistance()
//   evenly-spaced points, PATH_CONFIG.NORMALIZED_STEP apart
//         │
//         ▼  smoothDirections()
//   turn-limited points — no heading jump > MAX_TURN_DEGREES per step
//         │  (snap endpoint restored here if runway/waypoint snap is active)
//         │
//         ▼  findClosestIndex()
//   start index (closest to plane nose) — path following begins here
//
// =============================================================================

import type { Point } from '@/types/game';
import { PATH_CONFIG } from '@/game/config/defaults.config';

// =============================================================================
// Geometry primitives
// =============================================================================

/**
 * Euclidean distance between two world-local points.
 *
 * Used for:
 *   - raw path simplification (skip pointer samples closer than threshold)
 *   - runway/waypoint snap detection
 *   - collision distance (see CollisionSystem — it has its own copy to stay
 *     independent of imports; keep them in sync if you change the formula)
 */
export function distance(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Shortest angular difference between two headings, always positive.
 *
 * Returns a value in [0, π]. Handles wrap-around across the ±π boundary.
 *
 * Used for runway approach-angle tolerance check:
 *   if (angleDifference(approachAngle, runway.landingApproachAngle) < tolerance)
 */
export function angleDifference(a: number, b: number): number {
  let diff = b - a;
  // Normalise to (-π, π]
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  return Math.abs(diff);
}

// =============================================================================
// Path normalisation
// =============================================================================

/**
 * Re-sample a polyline so consecutive points are exactly `step` world units apart.
 *
 * ── WHY ──────────────────────────────────────────────────────────────────────
 * Raw pointer samples arrive at irregular intervals depending on device frame
 * rate and pointer speed.  The plane's path-following code advances one index
 * per frame when it gets within `pathAccuracy` of the current target.  If
 * samples are clustered close together the plane stutters; if they're far apart
 * it skips.  Normalisation makes every step identical so the plane moves at a
 * consistent speed regardless of how the player drew the path.
 *
 * ── ALGORITHM ────────────────────────────────────────────────────────────────
 * Walk each segment of the input polyline.  Place new points every `step`
 * units along the direction of each segment, carrying the "remainder" distance
 * forward when a segment ends mid-step.
 *
 * The first point of the input is always preserved as the first output point.
 * The last point of the input is NOT guaranteed to appear — the output ends at
 * the last full step.  Callers that need an exact endpoint (runway/waypoint
 * snap) must overwrite the final point after calling this function.
 *
 * @param path  Raw polyline (≥ 2 points required, otherwise returned as-is)
 * @param step  Desired distance between consecutive output points (world units)
 */
export function normalizeByDistance(path: Point[], step: number): Point[] {
  if (path.length < 2) return path;

  const result: Point[] = [path[0]];
  // remainingDist tracks how much of the current step was "consumed" by the
  // end of the previous segment, so we don't double-count that distance.
  let remainingDist = 0;

  for (let i = 0; i < path.length - 1; i++) {
    const start = path[i];
    const end = path[i + 1];

    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.sqrt(dx * dx + dy * dy);

    if (len === 0) continue; // degenerate segment — skip

    const dirX = dx / len;
    const dirY = dy / len;

    // Distance along this segment at which to place the first new point.
    // If remainingDist > 0 the previous segment ended before completing a step,
    // so we pick up from where we left off.
    let t = step - remainingDist;

    while (t < len) {
      result.push({
        x: start.x + dirX * t,
        y: start.y + dirY * t,
      });
      t += step;
    }

    // How much of the last step was covered by this segment.
    // Carry forward so the next segment doesn't restart from zero.
    remainingDist = len - (t - step);
  }

  return result;
}

// =============================================================================
// Turn smoothing
// =============================================================================

/**
 * Clamp the heading change between consecutive path points to `maxTurnDeg`.
 *
 * ── WHY ──────────────────────────────────────────────────────────────────────
 * Players can draw sharp corners or loop-backs.  Without smoothing, the plane
 * would snap its heading by 90°+ in a single frame.  Clamping the per-step
 * heading change produces a realistic banked turn instead.
 *
 * ── ALGORITHM ────────────────────────────────────────────────────────────────
 * Start from `startAngle` (the plane's current heading).  For each desired
 * point in the input, compute the angle toward it from the last output point.
 * Clamp the angular delta to ±maxTurnRad.  Advance along the clamped heading
 * by the same step distance used during normalisation so the output path
 * remains evenly spaced.
 *
 * ── IMPORTANT ────────────────────────────────────────────────────────────────
 * The output step size is PATH_CONFIG.NORMALIZED_STEP, not the distance between
 * input points.  Always call normalizeByDistance() BEFORE this function so the
 * input is already evenly spaced — otherwise the step size used here and the
 * one used in normalisation will differ.
 *
 * Snap endpoints (runway threshold / waypoint centre) must be restored by the
 * caller AFTER this function:
 *   const smoothed = smoothDirections(normalized, plane.rotation, MAX_TURN);
 *   if (snapPoint) smoothed[smoothed.length - 1] = snapPoint;
 *
 * @param path        Evenly-spaced path from normalizeByDistance()
 * @param startAngle  Plane's current heading in radians (seeds the first step)
 * @param maxTurnDeg  Maximum heading change per step in degrees
 */
export function smoothDirections(path: Point[], startAngle: number, maxTurnDeg: number): Point[] {
  if (path.length < 2) return path;

  const maxTurnRad = (maxTurnDeg * Math.PI) / 180;
  const step = PATH_CONFIG.NORMALIZED_STEP;
  const result: Point[] = [path[0]];
  let currentAngle = startAngle;

  for (let i = 1; i < path.length; i++) {
    const prev = result[result.length - 1];
    const desired = path[i];

    // Heading toward the player's intended point
    const desiredAngle = Math.atan2(desired.y - prev.y, desired.x - prev.x);

    // Angular delta, normalised to (-π, π], clamped to ±maxTurnRad
    let diff = desiredAngle - currentAngle;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    const clamped = Math.max(-maxTurnRad, Math.min(maxTurnRad, diff));

    currentAngle += clamped;

    result.push({
      x: prev.x + Math.cos(currentAngle) * step,
      y: prev.y + Math.sin(currentAngle) * step,
    });
  }

  return result;
}

// =============================================================================
// Path query
// =============================================================================

/**
 * Index of the point in `path` closest to `position` (squared-distance search).
 *
 * Uses squared distance (no sqrt) for performance — we only need the minimum,
 * not the actual distance value.
 *
 * Used in two places:
 *   1. After path assignment: find where the plane currently is on the new path
 *      so it starts following from the right point rather than the beginning.
 *   2. Finding the dot-draw start index: offset from the plane centre to the
 *      nose tip so dots appear ahead of the icon, not underneath it.
 *
 * @param position  Query point (plane centre or nose position)
 * @param path      Evenly-spaced path from normalizeByDistance()
 * @returns         Index into `path` of the closest point, or 0 if path is empty
 */
export function findClosestIndex(position: Point, path: Point[]): number {
  if (!path || path.length === 0) return 0;

  let closestIndex = 0;
  let minSq = Infinity;

  for (let i = 0; i < path.length; i++) {
    const dx = position.x - path[i].x;
    const dy = position.y - path[i].y;
    const sq = dx * dx + dy * dy;

    if (sq < minSq) {
      minSq = sq;
      closestIndex = i;
    }
  }

  return closestIndex;
}

// =============================================================================
// Convenience re-export of PATH_CONFIG defaults
// =============================================================================
//
// Callers that import from PathProcessor don't need a second import of
// PATH_CONFIG just to pass NORMALIZED_STEP or MAX_TURN_DEGREES.
// Re-export the values that are intrinsic to path processing here.

export const PATH_STEP = PATH_CONFIG.NORMALIZED_STEP;
export const PATH_SIMPLIFY = PATH_CONFIG.RAW_SIMPLIFY_THRESHOLD;
export const PATH_MAX_TURN = PATH_CONFIG.MAX_TURN_DEGREES;
export const PATH_AHEAD_FACTOR = PATH_CONFIG.PATH_START_AHEAD_FACTOR;
