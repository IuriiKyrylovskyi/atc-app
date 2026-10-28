// =============================================================================
// WorldTransform.ts
// =============================================================================
//
// Pure mathematical utilities for the world ↔ screen coordinate transform.
//
// ── COORDINATE SPACES ────────────────────────────────────────────────────────
//
//   WORLD-LOCAL
//     Origin at the centre of worldContainer.
//     Extent: ±WORLD_W/2 (±960) on X, ±WORLD_H/2 (±540) on Y.
//     Plane positions, runway coords, waypoint positions, path points — all
//     expressed in world-local space.
//
//   SCREEN
//     Origin at top-left of the Phaser canvas.
//     Extent: camera.width × camera.height (DPR-scaled canvas pixels).
//     Pointer events, Graphics drawing commands, collision circles — all in
//     screen space.
//
// ── THE TRANSFORM ────────────────────────────────────────────────────────────
//
//   worldContainer is a Phaser Container that sits at the centre of the screen:
//     containerX = camW / 2
//     containerY = camH / 2
//
//   It is uniformly scaled by `worldScale` (the cover-fit factor) so the
//   reference world always fills the canvas without letterboxing:
//     worldScale = max(camW / WORLD_W, camH / WORLD_H)
//
//   Given these, the conversions are:
//
//     screen = containerPos + worldLocal × worldScale
//     worldLocal = (screen − containerPos) / worldScale
//
// ── PERFORMANCE CACHING ───────────────────────────────────────────────────────
//
//   `worldToScreen` uses pre-cached values (_cachedScale, _cachedCX, _cachedCY)
//   that GameScene refreshes once at the top of every update() tick.
//   This avoids reading camera properties inside tight dot-draw and collision
//   loops.
//
//   `screenToWorld` is only called from pointer handlers (once per event) so it
//   computes the scale fresh each time.
//
// ── INTEGRATION ───────────────────────────────────────────────────────────────
//
//   GameScene replaces its private methods with calls to these functions.
//   CollisionSystem imports isInViewport() here instead of maintaining its
//   own duplicate.
//
// =============================================================================

import type { Plane } from '@/game/objects/Plane';

// =============================================================================
// Scale
// =============================================================================

/**
 * Compute the cover-fit scale factor that maps the reference world rectangle
 * onto the camera canvas without letterboxing.
 *
 * ── WHY COVER ────────────────────────────────────────────────────────────────
 * "Contain" (fit-inside) would leave black bars on non-16:9 screens.
 * "Cover" (fill-outside) ensures the playfield always fills the canvas.
 * One axis fills 100 %; the other extends slightly beyond the camera edge.
 * Content near extreme world edges may be clipped on portrait / ultrawide
 * displays, but the playfield is always gap-free.
 *
 * @param camW    Camera (canvas) width in pixels
 * @param camH    Camera (canvas) height in pixels
 * @param worldW  Reference world width in world units (always 1920)
 * @param worldH  Reference world height in world units (always 1080)
 */
export function computeWorldScale(
  camW: number,
  camH: number,
  worldW: number,
  worldH: number
): number {
  return Math.max(camW / worldW, camH / worldH);
}

// =============================================================================
// Coordinate conversion
// =============================================================================

/**
 * Convert screen/pointer coordinates → world-local coordinates.
 *
 * Used in pointer event handlers (pointerdown, pointermove) to map the
 * player's touch/click position into the same space as planes and runways.
 *
 * Computes the scale fresh each call — pointer events are infrequent so the
 * extra camera read is not a performance concern.
 *
 * @param sx          Pointer X in screen pixels
 * @param sy          Pointer Y in screen pixels
 * @param containerX  worldContainer.x (screen-space position of world origin)
 * @param containerY  worldContainer.y
 * @param worldScale  Current cover-fit scale (from computeWorldScale)
 */
export function screenToWorld(
  sx: number,
  sy: number,
  containerX: number,
  containerY: number,
  worldScale: number
): { x: number; y: number } {
  return {
    x: (sx - containerX) / worldScale,
    y: (sy - containerY) / worldScale,
  };
}

/**
 * Convert world-local coordinates → screen coordinates.
 *
 * Uses the frame-cached transform values to avoid camera reads inside the
 * dot-draw and collision-circle loops that run for every plane every frame.
 *
 * Cache is updated once at the top of GameScene.update():
 *   _cachedScale = computeWorldScale(camW, camH, WORLD_W, WORLD_H)
 *   _cachedCX    = worldContainer.x
 *   _cachedCY    = worldContainer.y
 *
 * @param wx           World-local X coordinate
 * @param wy           World-local Y coordinate
 * @param cachedCX     Cached worldContainer.x (screen pixels)
 * @param cachedCY     Cached worldContainer.y (screen pixels)
 * @param cachedScale  Cached cover-fit scale factor
 */
export function worldToScreen(
  wx: number,
  wy: number,
  cachedCX: number,
  cachedCY: number,
  cachedScale: number
): { x: number; y: number } {
  return {
    x: cachedCX + wx * cachedScale,
    y: cachedCY + wy * cachedScale,
  };
}

// =============================================================================
// Viewport culling
// =============================================================================

/**
 * Returns true when a screen-space point lies within (or within `margin` px
 * of) the viewport rectangle.
 *
 * Used by:
 *   • CollisionSystem — skip off-screen planes in the O(n²) collision scan
 *   • GameScene.isPlaneInViewport — skip drawing circles for off-screen planes
 *
 * @param screenX   Screen-space X of the point to test
 * @param screenY   Screen-space Y of the point to test
 * @param margin    Extra pixels to add around the viewport before culling
 * @param bounds    Viewport rectangle (camera-space: origin at scrollX/scrollY)
 */
export function isInViewport(
  screenX: number,
  screenY: number,
  margin: number,
  bounds: { x: number; y: number; right: number; bottom: number }
): boolean {
  return (
    screenX >= bounds.x - margin &&
    screenX <= bounds.right + margin &&
    screenY >= bounds.y - margin &&
    screenY <= bounds.bottom + margin
  );
}

/**
 * Returns true when the screen-space projection of a plane's centre lies
 * within (or just outside by its collision radius) the viewport rectangle.
 *
 * The collision-radius margin prevents a plane from blinking out of collision
 * detection the instant its centre pixel leaves the visible area.
 *
 * @param plane        The plane to test
 * @param bounds       Viewport rectangle
 * @param cachedCX     Cached worldContainer.x
 * @param cachedCY     Cached worldContainer.y
 * @param cachedScale  Cached cover-fit scale factor
 */
export function isPlaneInViewport(
  plane: Plane,
  bounds: { x: number; y: number; right: number; bottom: number },
  cachedCX: number,
  cachedCY: number,
  cachedScale: number
): boolean {
  const screenX = cachedCX + plane.x * cachedScale;
  const screenY = cachedCY + plane.y * cachedScale;
  const margin = plane.getCollisionRadius() * cachedScale;
  return isInViewport(screenX, screenY, margin, bounds);
}
