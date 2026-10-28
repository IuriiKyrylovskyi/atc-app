// =============================================================================
// DrawSystem.ts
// =============================================================================
//
// All non-input, non-path rendering that lives outside the Phaser game objects.
//
// ── RESPONSIBILITIES ──────────────────────────────────────────────────────────
//
//   1. ENTRY ZONE OVERLAY  (drawn once at create-time, lives in worldContainer)
//
//      The world edges are divided into entry bands and blocked corners.
//      DrawSystem allocates a Graphics object inside worldContainer and paints:
//        • White semi-transparent filled rectangles over the blocked corners
//        • Yellow L-shaped brackets at the inner edge of each entry band
//
//      Because the Graphics object is a worldContainer child it scales with
//      the world on resize — no redraw is needed when the screen rotates or
//      the window resizes.
//
//   2. COLLISION CIRCLES  (redrawn every frame during game-over state)
//
//      Delegates to CollisionSystem.drawCircles() — pulsing red circles on
//      the planes involved in the fatal collision.  DrawSystem wraps this call
//      so GameScene.update() only needs to call DrawSystem.drawCollisionCircles().
//
// ── ENTRY ZONE GEOMETRY ───────────────────────────────────────────────────────
//
//   The world is 1920 × 1080 world units, origin at centre.
//   Extents: X ∈ [−960, 960],  Y ∈ [−540, 540].
//
//   ENTRY_CORNERS defines four corner rectangles (world-local):
//
//     topLeft     ┌────────────────────────────────┐
//                 │  topLeft            topRight   │
//     leftBand ───┤                                ├─── rightBand
//                 │  bottomLeft      bottomRight   │
//                 └────────────────────────────────┘  bottomBand
//
//   Each corner has:
//     w — fraction of hw (960) blocked horizontally
//     h — fraction of hh (540) blocked vertically
//
//   Open entry band on each edge = full extent minus both adjacent corners:
//     Top/Bottom:  X ∈ [ −hw + leftCorner.w*hw,   hw − rightCorner.w*hw ]
//     Left/Right:  Y ∈ [ −hh + topCorner.h*hh,    hh − bottomCorner.h*hh ]
//
// ── L-BRACKET MARKERS ────────────────────────────────────────────────────────
//
//   At each inner corner of an entry band we draw a yellow L-bracket to
//   visually mark the boundary between the open entry band and the blocked
//   corner.  The bracket has:
//     T   = 4 world units   (stroke thickness)
//     ARM = 50 world units  (arm length)
//
//   bracket(sx, sy, hx, hy):
//     Horizontal arm: fillRect(sx,      sy − T/2,  hx*ARM, T)
//     Vertical   arm: fillRect(sx − T/2, sy,        T,     hy*ARM)
//
//   hx/hy are ±1 to point the arms inward toward the open entry band.
//
// ── DEPTH LAYERS ─────────────────────────────────────────────────────────────
//
//   entryZoneGraphics  depth = 0  (worldContainer child, behind everything)
//   collisionGraphics  depth = 2000 (screen-space, above all game objects)
//
// ── INTEGRATION ───────────────────────────────────────────────────────────────
//
//   GameScene calls:
//     DrawSystem.setupEntryZones(ctx)       — once in create()
//     DrawSystem.drawCollisionCircles(ctx)  — every frame in update()
//
//   DrawSystem reads entryZoneGraphics and collisionGraphics from the context.
//   Both are allocated by GameScene and stored on DrawContext fields.
//
// =============================================================================

import { CollisionSystem } from '@/game/systems/CollisionSystem';
import type { CollisionSceneContext } from '@/game/systems/CollisionSystem';

// =============================================================================
// DrawContext — what DrawSystem needs from GameScene
// =============================================================================

/**
 * Everything DrawSystem needs from GameScene.
 * GameScene passes `this` directly — all referenced fields must be public.
 */
export interface DrawContext extends CollisionSceneContext {
  /**
   * Graphics object for the entry zone overlay.
   * Must be a worldContainer child so it scales with the world on resize.
   * Allocated by GameScene.create() and passed here on setupEntryZones().
   */
  entryZoneGraphics: Phaser.GameObjects.Graphics;

  /**
   * Graphics object for collision circles.
   * Screen-space (NOT a worldContainer child) — drawn in camera pixels.
   * Allocated by GameScene.create().
   */
  collisionGraphics: Phaser.GameObjects.Graphics;

  /** Reference world width in world units (always 1920). */
  WORLD_W: number;

  /** Reference world height in world units (always 1080). */
  WORLD_H: number;

  /**
   * Per-corner blocked fractions used to compute entry band extents.
   * Same object read by SpawnSystem to determine valid spawn bands.
   */
  ENTRY_CORNERS: {
    topLeft: { w: number; h: number };
    topRight: { w: number; h: number };
    bottomLeft: { w: number; h: number };
    bottomRight: { w: number; h: number };
  };

  /** Phaser clock — provides time.now for the collision circle pulse animation. */
  time: Phaser.Time.Clock;
}

// =============================================================================
// Private helpers
// =============================================================================

/**
 * Draw one L-shaped bracket.
 *
 * Used to mark the inner corner of an entry band — the point where the open
 * band meets the blocked corner rectangle.
 *
 * @param g   Graphics object (already has fillStyle set by caller)
 * @param sx  Corner tip X in world-local coords
 * @param sy  Corner tip Y in world-local coords
 * @param hx  Horizontal arm direction: +1 = right, −1 = left
 * @param hy  Vertical arm direction:   +1 = down,  −1 = up
 * @param T   Stroke thickness in world units
 * @param ARM Arm length in world units
 */
function bracket(
  g: Phaser.GameObjects.Graphics,
  sx: number,
  sy: number,
  hx: number,
  hy: number,
  T: number,
  ARM: number
): void {
  g.fillRect(sx, sy - T / 2, hx * ARM, T); // horizontal arm
  g.fillRect(sx - T / 2, sy, T, hy * ARM); // vertical arm
}

// =============================================================================
// DrawSystem — public stateless API
// =============================================================================

export const DrawSystem = {
  /**
   * Paint the entry zone overlay onto `ctx.entryZoneGraphics`.
   *
   * Draws white corner fills and yellow L-brackets that show the player
   * which screen edges planes can enter from.
   *
   * IMPORTANT: Call this once after `ctx.entryZoneGraphics` has been added to
   * worldContainer.  The Graphics is a container child — worldContainer.scale
   * propagates automatically on resize so this method never needs to be called
   * again after the initial draw.
   *
   * Call sequence in GameScene.create():
   *   1. ctx.entryZoneGraphics = this.add.graphics()
   *   2. this.worldContainer.add(ctx.entryZoneGraphics)
   *   3. this.worldContainer.sendToBack(ctx.entryZoneGraphics)
   *   4. DrawSystem.drawEntryZones(ctx)
   */
  drawEntryZones(ctx: DrawContext): void {
    const g = ctx.entryZoneGraphics;
    const hw = ctx.WORLD_W / 2; // 960
    const hh = ctx.WORLD_H / 2; // 540
    const c = ctx.ENTRY_CORNERS;

    g.clear();

    // ── Corner dimensions in world units ─────────────────────────────────────
    const tlW = c.topLeft.w * hw;
    const tlH = c.topLeft.h * hh;
    const trW = c.topRight.w * hw;
    const trH = c.topRight.h * hh;
    const blW = c.bottomLeft.w * hw;
    const blH = c.bottomLeft.h * hh;
    const brW = c.bottomRight.w * hw;
    const brH = c.bottomRight.h * hh;

    // ── White semi-transparent fills for no-entry corners ────────────────────
    //
    //   Origin is the centre of worldContainer (world-local coords):
    //     top-left  corner: (-hw, -hh)  extending right  by tlW, down  by tlH
    //     top-right corner: (hw−trW, −hh) extending right by trW, down by trH
    //     etc.
    g.fillStyle(0xffffff, 0.5);
    g.fillRect(-hw, -hh, tlW, tlH); // top-left
    g.fillRect(hw - trW, -hh, trW, trH); // top-right
    g.fillRect(-hw, hh - blH, blW, blH); // bottom-left
    g.fillRect(hw - brW, hh - brH, brW, brH); // bottom-right

    // ── Yellow L-brackets at inner entry-band corners ─────────────────────────
    //
    //   There are 8 bracket positions: 2 per edge × 4 edges.
    //   Each bracket tip is at the junction where the open band meets a blocked
    //   corner.  The arms point inward toward the open band.
    //
    //   Visual key (top edge, left side):
    //     X = bracket tip at (−hw + tlW, −hh)
    //     →  horizontal arm points right  (hx = +1)
    //     ↓  vertical   arm points down   (hy = +1)
    //
    const COL = 0xffdd00;
    const ALPH = 0.9;
    const T = 4; // thickness in world units
    const ARM = 50; // arm length in world units

    g.fillStyle(COL, ALPH);

    // Left edge entry band — inner corners
    bracket(g, -hw, -hh + tlH, +1, +1, T, ARM); // top inner
    bracket(g, -hw, hh - blH, +1, -1, T, ARM); // bottom inner

    // Right edge entry band — inner corners
    bracket(g, hw, -hh + trH, -1, +1, T, ARM);
    bracket(g, hw, hh - brH, -1, -1, T, ARM);

    // Top edge entry band — inner corners
    bracket(g, -hw + tlW, -hh, +1, +1, T, ARM); // left inner
    bracket(g, hw - trW, -hh, -1, +1, T, ARM); // right inner

    // Bottom edge entry band — inner corners
    bracket(g, -hw + blW, hh, +1, -1, T, ARM);
    bracket(g, hw - brW, hh, -1, -1, T, ARM);
  },

  /**
   * Draw pulsing red circles on the planes involved in a fatal collision.
   *
   * Delegates to CollisionSystem.drawCircles() — see CollisionSystem.ts for
   * the full circle animation design (pulse frequency, radius scaling, etc.).
   *
   * No-op when ctx.collisionGraphics is not yet allocated (early-frame guard).
   * Call every frame from GameScene.update() after checkCollisions().
   */
  drawCollisionCircles(ctx: DrawContext): void {
    if (!ctx.collisionGraphics) return;
    CollisionSystem.drawCircles(ctx.collisionGraphics, ctx, ctx.time.now);
  },
} as const;
