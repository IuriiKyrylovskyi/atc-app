// =============================================================================
// CollisionSystem.ts
// =============================================================================
//
// Self-contained collision and proximity-warning logic for the ATC game.
//
// ── RESPONSIBILITIES ──────────────────────────────────────────────────────────
//
//   1. RESOLUTION ADVISORY (RA) — hard collision
//      Two planes whose centre-to-centre distance falls below the sum of their
//      collision radii have physically overlapped.  This is a fatal event:
//      the level fails immediately.
//
//      Detection threshold: (r1 + r2) / 2.2
//      The /2 is intentional — it is a design choice that requires planes to
//      overlap by at least half their combined radii before a collision fires.
//      This gives the player a small grace window and avoids false positives
//      near the boundary.
//
//   2. TRAFFIC ADVISORY (TA) — proximity warning
//      Planes whose centres are within the combined warning radii receive an
//      orange pulsing halo.  No game-over; purely informational.
//
//      Detection threshold: (r1 + r2) / 2.2  (same formula, different radii)
//
// ── ELIGIBILITY RULES ─────────────────────────────────────────────────────────
//
//   A plane participates in collision checks only when:
//     • It is NOT in departure-delay   (blinks on runway, not yet moving)
//     • It is NOT in departure-scaling  (growing from 70 % → 100 % scale)
//
//   Landing planes (isApproachingLanding / isLanding) are ALWAYS eligible —
//   they must collide with other traffic even as their visual scale shrinks.
//   The old guard `baseScale >= departureTargetScale` wrongly excluded them
//   because landing lowers baseScale below the departure target.
//
//   Only planes at the SAME altitude level (-1 / 0 / +1) can collide.
//   Vertical separation is assumed between different levels.
//
//   Both planes must be inside the visible viewport with zero margin — only
//   planes whose centres are on-screen are eligible. This prevents off-screen
//   collisions at world-edge spawn points and ensures every fatal event is
//   visible to the player.
//
//   ⚠️  CRITICAL FIX — DO NOT REVERT: this file uses isInViewport(x, y, 0, ...)
//       with an explicit ZERO margin, NOT the isPlaneInViewport(plane, ...)
//       helper from WorldTransform.ts. That helper adds the plane's own
//       collision radius as a margin AROUND the screen edge, which let planes
//       that were still physically off-screen participate in collision
//       checks — the player could see a fatal "game over" triggered by two
//       planes they never saw collide. If a future refactor swaps this back
//       to isPlaneInViewport() "for consistency", that regression returns.
//       Search for "isInViewport(" (three call sites: both check() loop
//       guards and drawCircles()) before changing this.
//
// ── INTEGRATION ───────────────────────────────────────────────────────────────
//
//   GameScene owns:
//     • collidedPlanes: Set<number>   — ids of planes involved in a collision
//     • isGameOver: boolean           — prevents re-entry after level fails
//
//   GameScene calls every frame (inside update()):
//     CollisionSystem.check(params)
//
//   On collision the system:
//     1. Adds both plane ids to collidedPlanes
//     2. Emits  plane:collision  (for stats / VFX)
//     3. Pauses the Phaser scene  (freezes everything)
//     4. Emits  level:failed      (picked up by AirTrafficCanvas overlay)
//
//   On "Try Again":
//     AirTrafficCanvas emits  game:restart
//     GameScene listens and calls scene.resume() then scene.restart()
//     → shutdown() clears collidedPlanes and isGameOver
//     → create() rebuilds everything fresh
//
// =============================================================================

import Phaser from 'phaser';
import type { Plane } from '@/game/objects/Plane';
import { gameEventBus } from '@/services/EventBus';
import { isInViewport } from '@/game/systems/WorldTransform';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal scene interface — only what CollisionSystem needs from GameScene. */
export interface CollisionSceneContext {
  /** Live plane list for this frame. */
  planes: Plane[];

  /**
   * Phaser ScenePlugin (the `this.scene` property of a Phaser.Scene subclass).
   * Used to pause the scene on collision: `scene.pause()`.
   */
  scene: Phaser.Scenes.ScenePlugin;

  /** Cache of planes that have already collided (persists until restart). */
  collidedPlanes: Set<number>;

  /** Guard: true once a collision has been detected this session. */
  isGameOver: boolean;

  /** Cached world-to-screen scale (set at top of update()). */
  _cachedScale: number;

  /** Cached world container screen-X (set at top of update()). */
  _cachedCX: number;

  /** Cached world container screen-Y (set at top of update()). */
  _cachedCY: number;

  /** Cached conflict count (warnings), consumed by stats emitter. */
  _cachedConflictCount: number;

  /** Viewport bounds in screen-pixel space. */
  viewportBounds: Phaser.Geom.Rectangle;
}

// ---------------------------------------------------------------------------
// Result type — returned to the caller so it can update its own state
// ---------------------------------------------------------------------------

export interface CollisionCheckResult {
  /** true if a fatal collision was detected this frame. */
  collisionDetected: boolean;

  /** Number of active proximity-warning pairs (not counting fatal pairs). */
  conflictCount: number;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Euclidean distance between two world-local points.
 */
function worldDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// ---------------------------------------------------------------------------
// CollisionSystem — stateless, functional API
// ---------------------------------------------------------------------------

export const CollisionSystem = {
  /**
   * Run one full collision + warning pass over the active plane list.
   *
   * Call this once per game-loop frame, after all plane positions have been
   * updated and before drawing.
   *
   * The method is a no-op when `ctx.isGameOver` is already true, so it is
   * safe to call even during the teardown frame after a collision.
   *
   * @returns CollisionCheckResult — caller should store conflictCount for stats.
   */
  check(ctx: CollisionSceneContext): CollisionCheckResult {
    // ── Guard: already failed, don't re-fire ─────────────────────────────
    if (ctx.isGameOver) {
      return { collisionDetected: false, conflictCount: ctx._cachedConflictCount };
    }

    // ── Reset per-frame warnings ──────────────────────────────────────────
    ctx.planes.forEach((p) => (p.warning = null));

    let conflictCount = 0;
    let collisionDetected = false;

    // ── O(n²) pair scan ──────────────────────────────────────────────────
    //
    // n is small (≤ 7 by default MAX_PLANES) so O(n²) is fine.
    // We iterate i < j to check each pair exactly once.
    //
    outer: for (let i = 0; i < ctx.planes.length; i++) {
      const p1 = ctx.planes[i];

      // Skip planes whose centre is outside the visible screen.
      // Margin = 0: only planes fully visible to the player can collide.
      const p1ScreenX = ctx._cachedCX + p1.x * ctx._cachedScale;
      const p1ScreenY = ctx._cachedCY + p1.y * ctx._cachedScale;
      if (!isInViewport(p1ScreenX, p1ScreenY, 0, ctx.viewportBounds)) continue;

      // Skip planes still materialising on the runway
      if (!p1.isActiveForCollisions()) continue;

      for (let j = i + 1; j < ctx.planes.length; j++) {
        const p2 = ctx.planes[j];

        const p2ScreenX = ctx._cachedCX + p2.x * ctx._cachedScale;
        const p2ScreenY = ctx._cachedCY + p2.y * ctx._cachedScale;
        if (!isInViewport(p2ScreenX, p2ScreenY, 0, ctx.viewportBounds)) continue;
        if (!p2.isActiveForCollisions()) continue;

        // ── Vertical separation ──────────────────────────────────────────
        // Planes at different altitude levels (-1 / 0 / +1) are vertically
        // separated and cannot collide regardless of horizontal proximity.
        if (p1.level !== p2.level) continue;

        const dist = worldDistance(p1, p2);

        // ── Resolution Advisory threshold ────────────────────────────────
        // The /2 is intentional (see file header). Planes must overlap by
        // at least half their combined radii before a collision is recorded.
        const raDist = (p1.getCollisionRadius() + p2.getCollisionRadius()) / 2.2;

        // ── Traffic Advisory threshold ───────────────────────────────────
        const taDist = (p1.getWarningRadius() + p2.getWarningRadius()) / 2.2;

        if (dist < raDist) {
          // ── COLLISION DETECTED ────────────────────────────────────────

          ctx.collidedPlanes.add(p1.id);
          ctx.collidedPlanes.add(p2.id);
          ctx.isGameOver = true;
          conflictCount++;
          collisionDetected = true;

          // Notify listeners (VFX, stats, etc.)
          gameEventBus.emit('plane:collision', {
            plane1Id: p1.id,
            plane2Id: p2.id,
            position: { x: (p1.x + p2.x) / 2.2, y: (p1.y + p2.y) / 2.2 },
          });

          // Freeze the scene so planes stop moving.
          // AirTrafficCanvas will show the retry overlay on level:failed.
          ctx.scene.pause();
          gameEventBus.emit('level:failed', 'collision');

          // Stop scanning — one collision is enough to end the level.
          break outer;
        } else if (dist < taDist) {
          // ── PROXIMITY WARNING ─────────────────────────────────────────
          p1.warning = { color: 'orange' };
          p2.warning = { color: 'orange' };
          conflictCount++;
        }
      }
    }

    return { collisionDetected, conflictCount };
  },

  /**
   * Draw pulsing red collision circles for every plane in collidedPlanes.
   *
   * Called each frame from GameScene even after the scene is paused so the
   * red circles remain visible while the overlay is shown.
   *
   * @param graphics  — the dedicated collision Phaser.GameObjects.Graphics layer
   * @param ctx       — same context passed to check()
   * @param now       — current scene time in ms (for pulse animation)
   */
  drawCircles(
    graphics: Phaser.GameObjects.Graphics,
    ctx: CollisionSceneContext,
    now: number
  ): void {
    graphics.clear();

    ctx.collidedPlanes.forEach((planeId) => {
      const plane = ctx.planes.find((p) => p.id === planeId);
      if (!plane) return;

      const screenX = ctx._cachedCX + plane.x * ctx._cachedScale;
      const screenY = ctx._cachedCY + plane.y * ctx._cachedScale;

      if (!isInViewport(screenX, screenY, 0, ctx.viewportBounds)) return;

      // Pulsing animation — radius oscillates ±20 % at ~1.67 Hz
      const pulsePhase = (now % 600) / 600;
      const pulseScale = 1 + Math.sin(pulsePhase * Math.PI * 2) * 0.2;

      const radius = plane.getCollisionRadius() * pulseScale * ctx._cachedScale;

      graphics.lineStyle(3, 0xff0000, 0.9);
      graphics.fillStyle(0xff0000, 0.3);
      graphics.strokeCircle(screenX, screenY, radius);
      graphics.fillCircle(screenX, screenY, radius);
    });
  },
};
