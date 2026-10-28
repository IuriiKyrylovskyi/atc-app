// =============================================================================
// EntryDotsSystem.ts
// =============================================================================
//
// Entry-indication dots drawn ahead of every plane still crossing the screen
// boundary.  Dots move with the plane icon each frame and vanish the instant
// the player draws a path OR ≥ 1/3 of the plane body is on-screen.
//
// ── VISUAL DESIGN ─────────────────────────────────────────────────────────────
//
//   14 dots are placed every PATH_STEP world-units ahead of the plane's nose,
//   aligned to the plane's current heading so they naturally follow any turns.
//
//   As the plane approaches from off-screen the canvas clips the dots that are
//   still beyond the edge, producing a natural 1 → 14 reveal.
//
//   A "travelling wave" sweeps from dot 1 (nearest nose) → dot 14 every
//   PULSE_PERIOD ms, lighting each dot in sequence:
//
//     wavePos  = (time % PULSE_PERIOD) / PULSE_PERIOD × DOT_COUNT   [0 .. 14)
//     bright_i = max(0,  1 − |wavePos − i| / PULSE_WIDTH)           [0 .. 1]
//
//   Each dot is drawn in three concentric layers (back → front):
//
//     Layer     Radius       Alpha
//     ──────    ──────       ──────────────────────────────────────────────────
//     Halo      r × 4.5      DIM_HALO   + bright × WAVE_HALO    (soft bloom)
//     Corona    r × 2.2      DIM_CORONA + bright × WAVE_CORONA
//     Core      r × 1.0      DIM_CORE   + bright × WAVE_CORE    (sharp point)
//
//   Color is the plane's connectionColor mapped to a hex integer.
//
// ── STOP CONDITIONS ───────────────────────────────────────────────────────────
//
//   Dots stop for a plane when EITHER:
//     a) Player draws a path  →  'plane:path-assigned' event
//     b) ≥ 1/3 of plane body has crossed the screen edge  →  isEntered()
//
// ── INTEGRATION ───────────────────────────────────────────────────────────────
//
//   GameScene.create()    → EntryDotsSystem.setup(scene)
//   GameScene.update()    → EntryDotsSystem.draw(time, planes, cx, cy, scale, bounds)
//   GameScene.shutdown()  → EntryDotsSystem.destroy()
//
// =============================================================================

import { gameEventBus } from '@/services/EventBus';
import { PATH_CONFIG } from '@/game/config/defaults.config';
import type { Plane } from '@/game/objects/Plane';

// =============================================================================
// Constants
// =============================================================================

const DOT_COUNT = 14;
const PULSE_PERIOD = 1400; // 900; // ms — one full wave sweep across all 14 dots
const PULSE_WIDTH = 2.8; //2.8; // dots — half-width of the travelling brightness peak

// Always-visible base alpha keeps the trail readable between pulses
const DIM_HALO = 0.03;
const DIM_CORONA = 0.1;
const DIM_CORE = 1; //0.3;

// Extra alpha added at the wave peak
const WAVE_HALO = 0.22;
const WAVE_CORONA = 0.52;
const WAVE_CORE = 0.7;

// connectionColor string → Phaser hex
// Slightly brighter than plane icons so dots read against any background
const COLOR_HEX: Record<string, number> = {
  blue: 0x55aaff,
  green: 0x44ee88,
  yellow: 0xffee22,
  pink: 0xff99dd,
  violet: 0xcc88ff,
  orange: 0xff9944,
  red: 0xff5555,
  white: 0xffffff,
  cyan: 0x11eeff,
};

// =============================================================================
// Module-level state  (one singleton per scene lifecycle)
// =============================================================================

let _graphics: Phaser.GameObjects.Graphics | null = null;
let _pathAssignedIds: Set<number> = new Set();
let _listener: ((id: number) => void) | null = null;

// =============================================================================
// Public API
// =============================================================================

export const EntryDotsSystem = {
  /**
   * Allocate the Graphics layer and subscribe to 'plane:path-assigned'.
   * Call once from GameScene.create() after `this.add` is available.
   */
  setup(scene: Phaser.Scene): void {
    _graphics = scene.add.graphics();
    _graphics.setDepth(490); // below path dots (500), above world objects

    _pathAssignedIds = new Set();

    _listener = (id: number) => _pathAssignedIds.add(id);
    gameEventBus.on('plane:path-assigned', _listener);
  },

  /**
   * Redraw entry-indication dots for every qualifying plane.
   *
   * Call every frame from GameScene.update() — pass the cached transform
   * values computed at the top of update() so this system never reads the
   * camera directly.
   *
   * @param time    Phaser time.now in ms — drives the wave animation
   * @param planes  Live plane array (GameScene.planes)
   * @param cx      Cached worldContainer.x  (screen pixels)
   * @param cy      Cached worldContainer.y  (screen pixels)
   * @param scale   Cached cover-fit scale factor
   * @param bounds  Screen bounds in world-local coords from getScreenBoundsInWorld()
   */
  draw(
    time: number,
    planes: Plane[],
    cx: number,
    cy: number,
    scale: number,
    bounds: { left: number; right: number; top: number; bottom: number }
  ): void {
    if (!_graphics) return;
    _graphics.clear();

    const r = PATH_CONFIG.DOT_RADIUS * 1.5;
    const step = PATH_CONFIG.NORMALIZED_STEP;

    // Wave position: advances from 0 → DOT_COUNT over one PULSE_PERIOD
    const wavePos = ((time % PULSE_PERIOD) / PULSE_PERIOD) * DOT_COUNT;

    for (const plane of planes) {
      // ── Stop conditions ────────────────────────────────────────────────────
      if (plane.isDepartureDelayed) continue; // still on runway
      if (_pathAssignedIds.has(plane.id)) continue; // player drew a path
      if (_isEntered(plane, bounds)) continue; // ≥ 1/3 body on screen

      const hex = COLOR_HEX[plane.connectionColor] ?? 0xffffff;

      // Nose position in world-local space
      const noseOff = plane.getActualSize() * 0.5;
      const cos = Math.cos(plane.rotation);
      const sin = Math.sin(plane.rotation);
      const noseX = plane.x + cos * noseOff;
      const noseY = plane.y + sin * noseOff;

      for (let i = 1; i <= DOT_COUNT; i++) {
        // Screen position
        const px = cx + (noseX + cos * i * step) * scale;
        const py = cy + (noseY + sin * i * step) * scale;

        // Brightness: triangle peak centred on wave position
        const dist = Math.abs(wavePos - i);
        const b = Math.max(0, 1 - dist / PULSE_WIDTH);

        // Layer 1 — wide soft halo
        _graphics.fillStyle(hex, DIM_HALO + b * WAVE_HALO);
        _graphics.fillCircle(px, py, r * 4.5);

        // Layer 2 — focused corona
        _graphics.fillStyle(hex, DIM_CORONA + b * WAVE_CORONA);
        _graphics.fillCircle(px, py, r * 2.2);

        // Layer 3 — sharp bright core
        _graphics.fillStyle(hex, DIM_CORE + b * WAVE_CORE);
        _graphics.fillCircle(px, py, r);
      }
    }
  },

  /**
   * Destroy the graphics layer and unsubscribe from events.
   * Call from GameScene.shutdown().
   */
  destroy(): void {
    if (_listener) {
      gameEventBus.off('plane:path-assigned', _listener);
      _listener = null;
    }
    _graphics?.destroy();
    _graphics = null;
    _pathAssignedIds.clear();
  },
} as const;

// =============================================================================
// Private helpers
// =============================================================================

/**
 * Returns true when ≥ 1/3 of the plane body has crossed the screen edge.
 *
 * Derivation: body diameter = getActualSize(), centred on plane.x / plane.y.
 * 1/3 of body visible means the visible strip = size/3.
 * The strip starts at the screen edge, so the centre is (size/2 − size/3) =
 * size/6 inside the boundary when exactly 1/3 is showing.
 * We therefore test whether the centre is within (size/6) of any boundary.
 */
function _isEntered(
  plane: Plane,
  bounds: { left: number; right: number; top: number; bottom: number }
): boolean {
  const margin = plane.getActualSize() / 6;
  return (
    plane.x >= bounds.left - margin &&
    plane.x <= bounds.right + margin &&
    plane.y >= bounds.top - margin &&
    plane.y <= bounds.bottom + margin
  );
}
