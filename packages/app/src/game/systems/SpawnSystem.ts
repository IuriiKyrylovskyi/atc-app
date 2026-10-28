// =============================================================================
// SpawnSystem.ts
// =============================================================================
//
// Decides when and where new planes appear in the world.
//
// ── RESPONSIBILITIES ─────────────────────────────────────────────────────────
//
//   1. Plane type & colour selection
//      Picks a type allowed by the level config, then filters the loaded texture
//      map to colours valid for that type.
//
//   2. Runway departure
//      50 % of the time (when runways exist and the cooldown has elapsed) a
//      plane spawns at the departure end of a randomly chosen runway and calls
//      plane.startDeparture() to begin its scale-up animation.
//
//   3. Edge spawn
//      Otherwise a plane enters from a random screen edge.  The position on
//      that edge is constrained to the open band — corners are blocked by
//      ENTRY_CORNERS config so planes never spawn inside the HUD or waypoint
//      triangles.
//
//   4. Rate limiting
//      Two independent cooldowns prevent runaway spawning:
//        · minDepartureIntervalMs   — between consecutive runway departures
//        · minRandomSpawnIntervalMs — between consecutive edge spawns
//      Both fall back to module-level defaults when the level config omits them.
//
// ── ENTRY CORNER GEOMETRY ─────────────────────────────────────────────────────
//
//   The world is 1920 × 1080 units centred on the origin (hw = 960, hh = 540).
//   Each corner blocks a rectangle of one world edge:
//     w — fraction of hw blocked along the horizontal axis
//     h — fraction of hh blocked along the vertical axis
//
//   Open spawn bands:
//     Top / Bottom:  X ∈ [-hw + left.w·hw,   hw - right.w·hw]
//     Left / Right:  Y ∈ [-hh + top.h·hh,    hh - bottom.h·hh]
//
//   Example — topLeft = { w:0.4, h:0.2 }:
//     Top edge starts at X = -960 + 0.4·960 = -576   (40 % of left blocked)
//     Left edge starts at Y = -540 + 0.2·540 = -432   (20 % of top blocked)
//
// ── INTEGRATION ───────────────────────────────────────────────────────────────
//
//   GameScene.update() calls SpawnSystem.trySpawn(this) once per frame after
//   planes have been updated and offscreen ones removed.
//
//   All mutable state lives on GameScene (planes[], timing refs).
//   SpawnSystem receives it via SpawnContext, mutates it in place, then returns.
//   The system itself is stateless.
//
// =============================================================================

import Phaser from 'phaser';
import { Plane } from '@/game/objects/Plane';
import type { Runway } from '@/game/objects/Runway';
import type { LevelConfig } from '@/types/game';
import { getRandomPlaneType, getPlaneTypeById } from '@/game/config/planes.config';
import { normalizeByDistance, PATH_STEP } from '@/game/systems/PathProcessor';

// ─────────────────────────────────────────────────────────────────────────────
// SpawnContext
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Everything SpawnSystem needs from GameScene.
 * GameScene passes `this` directly — all referenced fields must be public.
 */
export interface SpawnContext {
  // Live game objects
  planes: Plane[];
  runways: Runway[];
  worldContainer: Phaser.GameObjects.Container;

  // Level config
  currentLevel: LevelConfig | null;
  planeTextures: { [color: string]: string };

  // Plane count limits
  MAX_PLANES: number;
  MIN_PLANES: number;

  // Rate-limit timestamps — mutated by SpawnSystem after each spawn
  lastDepartureTime: number;
  lastRandomSpawnTime: number;

  // World geometry (always 1920 × 1080)
  WORLD_W: number;
  WORLD_H: number;

  /**
   * Per-corner blocked fractions — used by DrawSystem for the visual entry zone overlay.
   * Spawn position is now controlled by SPAWN_EDGE_MARGIN_X / Y in SpawnSystem.ts.
   */
  ENTRY_CORNERS: {
    topLeft: { w: number; h: number };
    topRight: { w: number; h: number };
    bottomLeft: { w: number; h: number };
    bottomRight: { w: number; h: number };
  };

  /**
   * Phaser texture manager — GameScene inherits this from Phaser.Scene.
   * Used to verify a texture key is loaded before constructing a Plane.
   *
   * NOTE: Do NOT add a `scene: Phaser.Scene` field here. In any Phaser.Scene
   * subclass `this.scene` is already occupied by the ScenePlugin
   * (Phaser.Scenes.ScenePlugin), which has no `textures` or `time` on it.
   * Using `ctx.scene.textures` would be undefined and crash at runtime.
   * Instead, these fields are read directly off the GameScene instance.
   */
  textures: Phaser.Textures.TextureManager;

  /** Phaser clock — GameScene inherits this from Phaser.Scene. */
  time: Phaser.Time.Clock;
}

// ─────────────────────────────────────────────────────────────────────────────
// Module-level defaults and constants
// ─────────────────────────────────────────────────────────────────────────────

/** Fallback when level config omits minDepartureIntervalMs. */
const DEFAULT_DEPARTURE_INTERVAL_MS = 3000;

/** Fallback when level config omits minRandomSpawnIntervalMs. */
const DEFAULT_RANDOM_INTERVAL_MS = 2500;

/** Probability of picking runway departure over edge spawn each eligible frame. */
const DEPARTURE_PROBABILITY = 0.5;

/** World-unit length of the initial path segment given to runway-departing planes. */
const DEPARTURE_PATH_LENGTH = 150;

/** World units inward from the edge where an edge-spawned plane's first target sits. */
const EDGE_INSET = 200;

// ─────────────────────────────────────────────────────────────────────────────
// SPAWN EDGE MARGINS  — expressed in SCREEN PIXELS, not world units
// ─────────────────────────────────────────────────────────────────────────────
//
// Why screen pixels?
//   The world is cover-fit: on non-16:9 devices the world (1920×1080) overflows
//   the screen, so world-unit margins don't map to consistent screen positions.
//   HUD elements are positioned in CSS/screen pixels (top:20, left:20, etc.),
//   so the clearance must also be measured in screen pixels, then converted to
//   world units at runtime via worldScale.
//
//   margin_world = HUD_MARGIN_PX / worldScale
//   spawn_band_start = visibleLeft + margin_world
//
// HUD element screen-pixel footprints (from GameHUD.vue):
//
//   HUD_MARGIN_X_PX — horizontal clearance for top/bottom-edge spawns.
//     Stats panel:  top:20, left:20, ~200px wide, 12px padding → right edge ≈ 240px from left
//     Score panel:  top:20, right:20, ~210px wide              → right edge ≈ 240px from right
//     Use 240 px on each side (symmetric).
//
//   HUD_MARGIN_Y_PX — vertical clearance for left/right-edge spawns.
//     Top panels:   top:20, ~90px tall, 12px padding           → bottom edge ≈ 120px from top
//     Bottom btns:  bottom:30, 60px tall                       → top edge ≈ 110px from bottom
//     Use 120 px on each side (symmetric, covers both).
//
// Increase to push planes further from HUD elements; decrease to widen the band.
//
// ⚠️  CRITICAL FIX — DO NOT REVERT TO PERCENTAGE-OF-WORLD-SIZE MARGINS.
//     An earlier version used `SPAWN_EDGE_MARGIN_X/Y` as a PERCENTAGE OF
//     WORLD_W/WORLD_H (e.g. 15%). That looks reasonable but is WRONG: the
//     world is cover-fit, so on non-16:9 screens it overflows the visible
//     area by a different amount on every device. A percentage-of-world
//     margin can end up smaller than the actual HUD element it's supposed
//     to clear (verified: on a 4:3 tablet the old 15% margin left planes
//     spawning UNDER the stats panel). Screen-pixel margins, converted to
//     world units via worldScale at spawn time inside computeEdgeBands(),
//     are the only approach that stays correct on every aspect ratio.
//     See computeEdgeBands() below for the conversion — do not bypass it.
// ─────────────────────────────────────────────────────────────────────────────

/** Screen pixels to keep clear on LEFT and RIGHT for top/bottom-edge spawns. */
const HUD_MARGIN_X_PX = 240;

/** Screen pixels to keep clear on TOP and BOTTOM for left/right-edge spawns. */
const HUD_MARGIN_Y_PX = 120;

// ─────────────────────────────────────────────────────────────────────────────
// Private helpers
// ─────────────────────────────────────────────────────────────────────────────

type PlaneType = ReturnType<typeof getRandomPlaneType>;

/**
 * Pick a plane type allowed by the level config.
 * Falls back to a fully random type when the level has no restrictions.
 * Falls back to type 1 if a configured ID resolves to null (bad config).
 */
function selectPlaneType(currentLevel: LevelConfig | null): PlaneType {
  if (currentLevel?.allowedPlaneTypes?.length) {
    const ids = currentLevel.allowedPlaneTypes;
    const id = ids[Math.floor(Math.random() * ids.length)];
    const t = getPlaneTypeById(id);

    if (!t) {
      console.error(`❌ SpawnSystem: unknown plane type ID "${id}" in level config — using type 1`);
      return getPlaneTypeById(1)!;
    }
    return t;
  }
  return getRandomPlaneType();
}

/**
 * Pick a valid colour for the given plane type and return both the colour name
 * and the fully-qualified texture key (e.g. "2-blue" for A380 blue).
 *
 * BUG FIXED: previously returned `planeTextures[colour]` — a flat color→key
 * map where the LAST loaded type's textures silently overwrote all earlier ones.
 * Result: every spawn always used the last-loaded type's sprite regardless of
 * which type was selected.
 *
 * FIX: build the texture key as `${planeType.id}-${colour}` and verify it
 * exists in the Phaser cache via `planeTextures[key]`. The map now acts as
 * a set of loaded keys — if `planeTextures["2-blue"]` is truthy, the texture
 * is ready; we never read its value as the key itself.
 */
function selectColour(
  planeType: PlaneType,
  planeTextures: { [key: string]: string }
): { colour: string; textureKey: string; textureKeyWhite: string } | null {
  // Find colours for which this type's texture was actually loaded.
  // Texture keys follow the convention "{typeId}-{colour}" (e.g. "2-blue").
  const available = planeType.colors.filter((c) => planeTextures[`${planeType.id}-${c}`]);

  if (available.length === 0) {
    console.error(
      `❌ SpawnSystem: no loaded textures for plane type ${planeType.id} ` +
        `(expected keys like "${planeType.id}-blue" in planeTextures)`
    );
    return null;
  }

  const colour = available[Math.floor(Math.random() * available.length)];
  return {
    colour,
    textureKey: `${planeType.id}-${colour}`,
    textureKeyWhite: `${planeType.id}-white`,
  };
}

interface EdgeBands {
  topXmin: number;
  topXmax: number;
  botXmin: number;
  botXmax: number;
  leftYmin: number;
  leftYmax: number;
  rightYmin: number;
  rightYmax: number;
}

/**
 * Derive the open spawn band for each edge from the VISIBLE screen area.
 *
 * The world is cover-fit: on non-16:9 devices the 1920×1080 world overflows
 * the screen, so "world edge" ≠ "screen edge".  We derive the visible bounds
 * in world units from the camera and worldContainer scale, then subtract the
 * HUD clearance in screen pixels (converted to world units via worldScale).
 *
 * visibleLeft  = -camWidth  / (2 × worldScale)   [world units]
 * visibleTop   = -camHeight / (2 × worldScale)   [world units]
 * bandLeft     = visibleLeft  + HUD_MARGIN_X_PX / worldScale
 * bandTop      = visibleTop   + HUD_MARGIN_Y_PX / worldScale
 *
 * Results are clamped to [-hw, hw] / [-hh, hh] so we never spawn outside the
 * world even on very wide or very tall screens.
 */
function computeEdgeBands(hw: number, hh: number, ctx: SpawnContext): EdgeBands {
  const worldScale = ctx.worldContainer.scaleX;
  const cam = ctx.worldContainer.scene.cameras.main;

  // Visible world half-extents in world units
  const visHalfW = cam.width / (2 * worldScale);
  const visHalfH = cam.height / (2 * worldScale);

  // HUD clearance converted from screen pixels to world units
  const marginX = HUD_MARGIN_X_PX / worldScale;
  const marginY = HUD_MARGIN_Y_PX / worldScale;

  // Clamp to world bounds so we never place a spawn outside the world rectangle
  const xMin = Math.max(-hw, -visHalfW + marginX);
  const xMax = Math.min(hw, visHalfW - marginX);
  const yMin = Math.max(-hh, -visHalfH + marginY);
  const yMax = Math.min(hh, visHalfH - marginY);

  return {
    topXmin: xMin,
    topXmax: xMax,
    botXmin: xMin,
    botXmax: xMax,
    leftYmin: yMin,
    leftYmax: yMax,
    rightYmin: yMin,
    rightYmax: yMax,
  };
}

/**
 * Compute spawn position, initial heading, and first path target for an
 * edge spawn.
 *
 * Edge indices:
 *   0 = top    → sa = π/2       (fly downward)
 *   1 = right  → sa = π         (fly leftward)
 *   2 = bottom → sa = 3π/2      (fly upward)
 *   3 = left   → sa = 0         (fly rightward)
 */
function edgeSpawnGeometry(
  edge: number,
  hw: number,
  hh: number,
  spawnMargin: number,
  bands: EdgeBands
): { sx: number; sy: number; sa: number; tx: number; ty: number } {
  switch (edge) {
    case 0: {
      // Top
      const sx = bands.topXmin + Math.random() * (bands.topXmax - bands.topXmin);
      return { sx, sy: -hh - spawnMargin, sa: Math.PI / 2, tx: sx, ty: -hh + EDGE_INSET };
    }
    case 1: {
      // Right
      const sy = bands.rightYmin + Math.random() * (bands.rightYmax - bands.rightYmin);
      return { sx: hw + spawnMargin, sy, sa: Math.PI, tx: hw - EDGE_INSET, ty: sy };
    }
    case 2: {
      // Bottom
      const sx = bands.botXmin + Math.random() * (bands.botXmax - bands.botXmin);
      return { sx, sy: hh + spawnMargin, sa: (3 * Math.PI) / 2, tx: sx, ty: hh - EDGE_INSET };
    }
    default: {
      // Left
      const sy = bands.leftYmin + Math.random() * (bands.leftYmax - bands.leftYmin);
      return { sx: -hw - spawnMargin, sy, sa: 0, tx: -hw + EDGE_INSET, ty: sy };
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SpawnSystem
// ─────────────────────────────────────────────────────────────────────────────

export const SpawnSystem = {
  /** @internal One-shot flag — suppresses repeated "textures not ready" warnings. */
  _texturesMissingLogged: false,

  /**
   * Attempt to spawn one plane this frame.
   *
   * Called from GameScene.update() after:
   *   · plane.update() for every active plane
   *   · offscreen plane removal
   *   · the spawn-trigger condition check:
   *       planes.length < MIN_PLANES
   *       OR (planes.length < MAX_PLANES AND random() < spawnRate)
   *
   * At most one plane is spawned per call.  Decides between runway departure
   * and edge spawn based on runway availability, a random coin flip, and the
   * per-type cooldown.
   *
   * Side effects on ctx:
   *   · ctx.planes.push(newPlane)
   *   · ctx.worldContainer.add(newPlane)
   *   · ctx.lastDepartureTime   = now   (runway spawn only)
   *   · ctx.lastRandomSpawnTime = now   (edge spawn only)
   */
  trySpawn(ctx: SpawnContext): void {
    // ── 1. Guard: already at capacity ────────────────────────────────────────
    if (ctx.planes.length >= ctx.MAX_PLANES) return;

    // ── 2. Textures must be loaded ───────────────────────────────────────────
    if (Object.keys(ctx.planeTextures).length === 0) {
      // Textures are registered inside async create(); update() may fire a few
      // frames before create() finishes.  This is a transient race, not a bug —
      // log once at warn level and bail until the next frame.
      if (!SpawnSystem._texturesMissingLogged) {
        console.warn('⏳ SpawnSystem: planeTextures not ready yet — will retry next frame');
        SpawnSystem._texturesMissingLogged = true;
      }
      return;
    }
    // Reset the flag so a genuine "textures disappeared" regression is re-logged.
    SpawnSystem._texturesMissingLogged = false;

    // ── 3. Cooldown intervals from level config (or module defaults) ─────────
    const minDepartureInterval =
      ctx.currentLevel?.minDepartureIntervalMs ?? DEFAULT_DEPARTURE_INTERVAL_MS;
    const minRandomInterval =
      ctx.currentLevel?.minRandomSpawnIntervalMs ?? DEFAULT_RANDOM_INTERVAL_MS;

    // ── 4. Plane type and colour ─────────────────────────────────────────────
    const planeType = selectPlaneType(ctx.currentLevel);
    const selected = selectColour(planeType, ctx.planeTextures);
    if (!selected) return;

    const { colour, textureKey, textureKeyWhite } = selected;

    if (!ctx.textures.exists(textureKey)) {
      console.error(`❌ SpawnSystem: texture key "${textureKey}" not found in Phaser cache`);
      return;
    }

    const now = ctx.time.now;
    const hw = ctx.WORLD_W / 2; // 960
    const hh = ctx.WORLD_H / 2; // 540

    // ── 5. Runway departure ──────────────────────────────────────────────────
    //
    // All three conditions must pass:
    //   · at least one runway exists in this level
    //   · random coin flip passes DEPARTURE_PROBABILITY (50 %)
    //   · departure cooldown has elapsed since the last departure
    const canDepart =
      ctx.runways.length > 0 &&
      Math.random() < DEPARTURE_PROBABILITY &&
      now - ctx.lastDepartureTime > minDepartureInterval;

    if (canDepart) {
      const runway = ctx.runways[Math.floor(Math.random() * ctx.runways.length)];

      // getDeparturePointWorld() returns world-local coords — the runway lives
      // inside worldContainer so its position is in the same space as planes.
      const dep = runway.getDeparturePointWorld();

      const plane = new Plane({
        scene: ctx as unknown as Phaser.Scene,
        x: dep.x,
        y: dep.y,
        angle: runway.departureAngle,
        texture: textureKey,
        textureWhite: textureKeyWhite,
        color: colour,
        speed: planeType.speed,
      });

      // Short initial path along the departure heading.
      // Gives the plane a direction during its scale-up animation;
      // the player can override it by drawing a new path immediately.
      const departurePath = normalizeByDistance(
        [
          dep,
          {
            x: dep.x + Math.cos(runway.departureAngle) * DEPARTURE_PATH_LENGTH,
            y: dep.y + Math.sin(runway.departureAngle) * DEPARTURE_PATH_LENGTH,
          },
        ],
        PATH_STEP
      );

      // ── Speed-popup metadata (SESSION 4) ─────────────────────────────────
      // Set after construction — these fields don't exist in PlaneConfig.
      plane.callsign = `${colour.toUpperCase().slice(0, 3)}${String(
        Math.floor(Math.random() * 900) + 100
      )}`;
      plane.aircraftTypeName = planeType.name;
      plane.weightClass = planeType.weightClass;

      plane.setPath(departurePath, 0);
      plane.startDeparture();

      // Planes live inside worldContainer — they inherit cover-scale automatically.
      ctx.worldContainer.add(plane);
      ctx.planes.push(plane);
      ctx.lastDepartureTime = now;

      console.log(`✈️ SpawnSystem: runway departure — ${textureKey}`);
      return; // one spawn per call
    }

    // ── 6. Edge spawn ────────────────────────────────────────────────────────
    if (now - ctx.lastRandomSpawnTime <= minRandomInterval) return;

    const spawnMargin = planeType.baseSize * 2; // world units — just outside the visible edge
    const bands = computeEdgeBands(hw, hh, ctx);
    const edge = Math.floor(Math.random() * 4);
    const { sx, sy, sa, tx, ty } = edgeSpawnGeometry(edge, hw, hh, spawnMargin, bands);

    const plane = new Plane({
      scene: ctx as unknown as Phaser.Scene,
      x: sx,
      y: sy,
      angle: sa,
      texture: textureKey,
      textureWhite: textureKeyWhite,
      color: colour,
      speed: planeType.speed,
    });

    // Two-point initial path pointing inward so the plane immediately
    // flies toward the play area rather than hugging the edge.
    const initialPath = normalizeByDistance(
      [
        { x: sx, y: sy },
        { x: tx, y: ty },
      ],
      PATH_STEP
    );

    // ── Speed-popup metadata (SESSION 4) ─────────────────────────────────
    plane.callsign = `${colour.toUpperCase().slice(0, 3)}${String(
      Math.floor(Math.random() * 900) + 100
    )}`;
    plane.aircraftTypeName = planeType.name;
    plane.weightClass = planeType.weightClass;

    plane.setPath(initialPath, 0);
    ctx.worldContainer.add(plane);
    ctx.planes.push(plane);
    ctx.lastRandomSpawnTime = now;

    console.log(`✈️ SpawnSystem: edge spawn (edge ${edge}) — ${textureKey}`);
  },
};
