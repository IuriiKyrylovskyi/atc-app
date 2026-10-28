// =============================================================================
// depth.constants.ts
// =============================================================================
//
// Single source of truth for all depth (z-index) values inside worldContainer.
//
// ── LAYER STACK ───────────────────────────────────────────────────────────────
//
//   All objects listed here are worldContainer CHILDREN — their depth values
//   control render order within the container, not relative to scene-level
//   objects (HUD, collision circles, path dots) which have their own depths.
//
//   depth   0  — background sprite
//   depth   1  — brightness overlay (black rect, alpha 0–1; controlled by settings)
//   depth 100  — entry zone overlay (blocked corners + L-brackets)
//   depth 200  — runways / ground markings
//   depth 250  — waypoint markers
//   depth 300  — planes on the runway (departure delay + departure scaling)
//   depth 400  — (reserved — path dots are scene-level, not worldContainer)
//   depth 500  — plane shadows at altitude level -1  ┐ same Container;
//   depth 600  — planes at altitude level -1          ┘ shadow behind plane by child order
//   depth 700  — plane shadows at altitude level  0  ┐
//   depth 800  — planes at altitude level  0          ┘
//   depth 900  — plane shadows at altitude level +1  ┐
//   depth 1000 — planes at altitude level +1          ┘
//
// ── SHADOW NOTE ───────────────────────────────────────────────────────────────
//
//   The shadow sprite lives INSIDE the same Phaser.GameObjects.Container as the
//   plane sprite.  A Container has a single depth in the scene, so the shadow
//   and plane share that depth.  The shadow renders behind the plane because it
//   is added to the Container first (child index 0 < plane index 1).
//
//   The "shadow depth" entries (500 / 700 / 900) in the table above document the
//   INTENT — a level-0 plane's shadow should appear above a level-(-1) plane —
//   but since shadow and plane share a Container, the effective depth equals the
//   PLANE depth constant for that level.  Separating them into independent scene
//   children is a future refactor; for now the child-order guarantee is sufficient.
//
// ── SCENE-LEVEL (screen-space) depths ─────────────────────────────────────────
//
//   These are NOT worldContainer children:
//     400  — planePathGraphics / pathGraphics / projectionGraphics
//    2000  — collisionGraphics (above everything)
//
// =============================================================================

export const DEPTH = {
  // ── worldContainer children ─────────────────────────────────────────────────
  BACKGROUND: 0,
  BRIGHTNESS_OVERLAY: 1, // black rect, alpha 0–1, directly above background
  ENTRY_ZONES: 100,
  RUNWAYS: 200,
  WAYPOINTS: 250,

  // Planes — by state / altitude level
  PLANE_RUNWAY: 300, // departure delay + departure scaling (on the ground)
  PLANE_LEVEL_M1: 600, // approaching landing   (level -1, smaller scale)
  PLANE_LEVEL_0: 800, // cruising               (level  0, normal scale)
  PLANE_LEVEL_1: 1000, // connected to waypoint  (level +1, larger scale)

  // ── Scene-level (screen-space) ───────────────────────────────────────────────
  PATH_DOTS: 400, // per-plane dot graphics + projection graphics
  COLLISION: 2000, // pulsing red circles on fatal collision
} as const;

export type DepthKey = keyof typeof DEPTH;
