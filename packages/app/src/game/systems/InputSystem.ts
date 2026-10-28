// =============================================================================
// InputSystem.ts
// =============================================================================
//
// All player pointer input and per-plane path-dot rendering for the ATC game.
//
// ── RESPONSIBILITIES ──────────────────────────────────────────────────────────
//
//   1. POINTER EVENTS
//      pointerdown  — hit-test planes; start a drag on the tapped plane
//      pointermove  — accumulate raw points; normalise, snap, smooth, assign path
//      pointerup    — commit landing / waypoint / free-flight outcome
//
//   2. DOT RENDERING — PER-PLANE GRAPHICS OBJECTS
//      Each plane owns a dedicated Phaser.GameObjects.Graphics so its dots can
//      be cleared or redrawn independently of all other planes.
//
//      drawPaths()      — redraw dots after the plane advances its pathIndex
//      drawProjections()— ghost circle on the landing-threshold / waypoint
//      appendDragDots() — append-only paint during an active drag (no g.clear)
//      destroyPlaneDots — clean up when a plane leaves the scene
//
// ── PATH PROCESSING PIPELINE ─────────────────────────────────────────────────
//
//   1. COLLECT  raw pointer samples (screen-space)
//   2. CONVERT  each sample to world-local via screenToWorld()
//   3. SIMPLIFY discard samples closer than PATH_SIMPLIFY world units
//   4. NORMALISE re-sample at exactly PATH_STEP world units apart
//            → normalizeByDistance()
//   5. SNAP     detect runway / waypoint proximity on the raw-normalised tail
//   6. SMOOTH   limit heading change per step to PATH_MAX_TURN
//            → smoothDirections() seeded with dragStartAngle (fixed at pointerdown)
//   7. RESTORE  overwrite last smoothed point with exact snap target
//   8. ASSIGN   plane.setPath(smoothedPath, closestIndex)
//
// ── FIXED-SEED SMOOTHING ──────────────────────────────────────────────────────
//
//   dragStartAngle is the plane's rotation captured ONCE at pointerdown and
//   held constant for the entire drag.
//
//   WHY: smoothDirections() seeds from the plane's current heading. If we use
//   this.draggedPlane.rotation (which changes every frame as the plane flies),
//   the entire path is re-smoothed from a slightly different angle on every
//   pointermove — every existing dot shifts by a pixel or two on every event.
//
//   Freezing the seed makes the output deterministic: adding new raw points to
//   the tail can only APPEND new smoothed points, never move old ones. This is
//   the invariant that appendDragDots() relies on for its no-g.clear() strategy.
//
// ── APPEND-ONLY DOT PAINTING ──────────────────────────────────────────────────
//
//   appendDragDots() never calls g.clear(). It uses dragDrawnCount (how many
//   dots have already been painted this drag) to skip to the new tail.
//
//   Combined with the fixed-seed invariant this gives two guarantees:
//     • dots never shift   (fixed seed → positions are deterministic)
//     • dots never flicker (no clear+redraw — only paint-forward)
//
// ── DOT RENDER OPTIMISATION ───────────────────────────────────────────────────
//
//   fillRect() is used instead of fillCircle().
//   fillRect  = 2 GL triangles per dot.
//   fillCircle ≈ 30 GL triangles per dot.
//   With 200 dots × 7 planes this saves ~40 000 triangle submissions per redraw.
//
// ── INTEGRATION ───────────────────────────────────────────────────────────────
//
//   GameScene calls:
//     InputSystem.setup(ctx)               — once in create()
//     InputSystem.drawPaths(ctx)           — every frame in update()
//     InputSystem.drawProjections(ctx)     — every frame in update()
//     InputSystem.destroyPlaneDots(ctx, id)— when a plane leaves the scene
//     InputSystem.shutdown(ctx)            — in shutdown()
//
//   State lives inside InputSystem. GameScene holds the InputState object
//   (returned by setup()) and passes it back via ctx.inputState.
//
// =============================================================================

// =============================================================================
// CRITICAL FIXES — DO NOT REVERT (see inline comments at each site for detail)
// =============================================================================
//
// 1. TAP MUST NOT DISCONNECT A CONNECTED PLANE
//    pointerdown used to call plane.clearPath() + plane.resetToNeutral() +
//    clearPlaneDots() immediately — before knowing if the gesture was a tap
//    or a drag. A short tap on a plane already locked to a runway/waypoint
//    would silently disconnect it. FIX: all three calls are now deferred to
//    the FIRST CONFIRMED DRAG MOVEMENT (the `_tapMoved` transition inside
//    handlePointerMove), not pointerdown. A pure tap therefore never touches
//    the plane's connection state, path, or visual dots.
//    ⚠️  Do not move clearPath/resetToNeutral/clearPlaneDots back to
//        pointerdown — that reintroduces the disconnect-on-tap bug.
//
// 2. plane:tapped PAYLOAD MUST INCLUDE isApproachingWaypoint
//    SpeedControlPopup seeds its liveIsApproaching / liveIsWaypoint refs from
//    this payload on open. Omitting isApproachingWaypoint means the
//    "Cancel en-route" button never appears for a plane that is ALREADY
//    connected to a waypoint when tapped (dynamic updates after open are
//    handled separately by the plane:attached listener inside the popup —
//    that does NOT cover the initial state).
//    ⚠️  Do not remove isApproachingWaypoint from this emit — see the emit
//        site below for the full payload.
//
// 3. WAYPOINT SNAP REQUIRES AN ANGLE CHECK (±30°), MIRRORING RUNWAY SNAP
//    Without an angle check, ANY drawn path ending inside a waypoint's neck
//    zone connects, regardless of the direction it approaches from. FIX:
//    added the same angleDifference(...) > tolerance gate that the runway
//    snap already uses, comparing the drawn path's approach angle against
//    the bearing from world-centre to the waypoint's (edge-snapped) position.
//    ⚠️  Do not remove the angle gate in the waypoint snap loop.
//
// 4. plane:cancelApproach MUST CLEAR VISUAL PATH DOTS
//    GameScene's cancel handler clears the plane's PATH DATA (path array,
//    approach flags, icon scale) but has no access to InputSystem's Graphics
//    objects. Without a matching listener here, the white dot trail stays on
//    screen after the player presses "Cancel approach" / "Cancel en-route"
//    even though the plane is already disconnected.
//    ⚠️  Do not remove the plane:cancelApproach listener registered in
//        setup() (search "onCancelApproachDots") or its cleanup in shutdown().
//
// 5. DESKTOP: POINTER LEAVING THE CANVAS WITHOUT POINTERUP
//    On non-fullscreen desktop windows the pointer can leave the canvas
//    bounds without ever firing a native pointerup (browser chrome, window
//    edge). Phaser's InputPlugin emits 'gameout' for this. Without handling
//    it, an active drag is left stuck forever — the plane never receives a
//    final path and the player can't start a new drag on it.
//    ⚠️  Do not remove the 'gameout' listener registered in setup() (search
//        "onGameOut") or its explicit cleanup in shutdown() — 'gameout' is
//        NOT auto-removed by Phaser scene teardown like pointer events are.
//
// =============================================================================
import Phaser from 'phaser';
import type { Plane } from '@/game/objects/Plane';
import type { Runway } from '@/game/objects/Runway';
import type { Waypoint } from '@/game/objects/Waypoint';
import type { Point } from '@/types/game';
import { gameEventBus } from '@/services/EventBus';
import { PATH_CONFIG } from '@/game/config/defaults.config';
import {
  distance,
  angleDifference,
  normalizeByDistance,
  smoothDirections,
  findClosestIndex,
  PATH_STEP,
  PATH_SIMPLIFY,
  PATH_MAX_TURN,
} from '@/game/systems/PathProcessor';
import { screenToWorld } from '@/game/systems/WorldTransform';
import { DEPTH } from '@/game/constants/depth.constants';

// =============================================================================
// InputState — mutable drag state owned by InputSystem
// =============================================================================

/**
 * All mutable state for the currently active drag and per-plane dot graphics.
 *
 * GameScene receives this object from InputSystem.setup() and stores it as a
 * field (`this.inputState`). It passes the full context back to every
 * InputSystem call so the system can read and mutate this state.
 *
 * Keeping state here (rather than scattered across GameScene fields) means:
 *   • all input state is grouped and easier to reason about
 *   • shutdown() zeros everything out in one place
 *   • no input state leaks into GameScene's public surface
 */
export interface InputState {
  /** The plane currently being dragged, or null if no drag is active. */
  draggedPlane: Plane | null;

  /**
   * Raw pointer samples collected during the current drag (world-local coords).
   * Grown on every pointermove that passes the PATH_SIMPLIFY distance check.
   * Reset to null on pointerup.
   */
  rawDragPath: Point[] | null;

  /**
   * The dragged plane's rotation captured ONCE at pointerdown.
   * Fixed seed for smoothDirections() throughout the entire drag.
   * See FIXED-SEED SMOOTHING in the file header.
   */
  dragStartAngle: number;

  /**
   * Count of smoothed-path dots already painted this drag.
   * appendDragDots() draws from this index onward without calling g.clear().
   * Reset to 0 on each new pointerdown.
   */
  dragDrawnCount: number;

  /**
   * Per-plane Graphics objects for static (non-drag) path dots.
   * Each plane gets its own Graphics so one plane's dots can be cleared
   * without affecting any other. Keys are plane IDs.
   */
  planePathGraphics: Map<number, Phaser.GameObjects.Graphics>;

  /**
   * The pathIndex that was current when dots were last drawn for each plane.
   * drawPaths() only redraws when plane.pathIndex has advanced past this value.
   */
  lastDrawnPathIndex: Map<number, number>;

  /** Active landing ghost: show a circle on the runway threshold. */
  landingProjection: { runway: Runway; plane: Plane } | null;

  /** Active waypoint ghost: show a circle on the waypoint centre. */
  waypointProjection: { waypoint: Waypoint; plane: Plane } | null;

  /** Screen-space Graphics for the landing / waypoint ghost circles. */
  projectionGraphics: Phaser.GameObjects.Graphics;

  /**
   * The plane currently selected by a short tap (for speed-control popup).
   * null when no plane is selected. Cleared when the user taps the same plane
   * again, taps another plane (new selection), or dismisses the popup.
   */
  selectedPlaneId: number | null;

  /**
   * Pointer screen position captured at pointerdown — used with _tapDownTime
   * to distinguish a short stationary tap from the start of a drag.
   * Stored in screen pixels (pointer.x / pointer.y).
   */
  _tapDownX: number;
  _tapDownY: number;

  /** performance.now() timestamp captured at pointerdown. */
  _tapDownTime: number;

  /**
   * True once pointermove has moved the pointer far enough to count as a drag.
   * Set in handlePointerMove when the pointer travels > TAP_MAX_MOVE px from
   * the pointerdown position. Prevents pointerup from firing a tap on a drag.
   */
  _tapMoved: boolean;
}

// =============================================================================
// InputContext — what InputSystem reads from GameScene each call
// =============================================================================

/**
 * Everything InputSystem needs from GameScene.
 * GameScene passes `this` directly — all referenced fields must be public.
 *
 * `add` is the Phaser GameObjectFactory (`this.add` on any Phaser.Scene).
 * Declared explicitly so `ctx.add.graphics()` typechecks without a cast.
 */
export interface InputContext {
  /** Live plane list — iterated in hit-testing and per-frame draws. */
  planes: Plane[];

  /** Runway list — checked for landing snap in handlePointerMove. */
  runways: Runway[];

  /** Waypoint list — checked for waypoint snap in handlePointerMove. */
  waypoints: Waypoint[];

  /**
   * Waypoint connection map — written on pointerup when a waypoint snaps.
   * Maps plane.id → { waypoint, exitPoint }.
   * Owned by GameScene (not InputSystem) because update() consumes it directly
   * to trigger plane.startWaypointPassing().
   */
  waypointConnections: Map<number, { waypoint: Waypoint; exitPoint: Point }>;

  /** Phaser input plugin — used to register pointer event listeners. */
  input: Phaser.Input.InputPlugin;

  /**
   * Phaser GameObjectFactory — used to create Graphics objects for dot layers.
   * Available on any Phaser.Scene subclass as `this.add`.
   */
  add: Phaser.GameObjects.GameObjectFactory;

  /**
   * worldContainer — used for two purposes:
   *   1. screenToWorld conversion (x/y/scale)
   *   2. Parent for path dot and projection Graphics objects so they share
   *      the container's transform and depth space with planes.
   */
  worldContainer: Phaser.GameObjects.Container;

  /** Cached cover-fit scale (refreshed at the top of each update() tick). */
  _cachedScale: number;

  /** Cached worldContainer.x in screen pixels. */
  _cachedCX: number;

  /** Cached worldContainer.y in screen pixels. */
  _cachedCY: number;

  /** InputState returned by InputSystem.setup() — store on the GameScene. */
  inputState: InputState;
}

// =============================================================================
// Tap-detection constants
// =============================================================================

/** Maximum ms between pointerdown and pointerup to count as a tap. */
const TAP_MAX_MS = 220;

/** Maximum screen-pixel travel between pointerdown and pointerup for a tap.
 *  Using screen pixels (not world units) so the threshold is DPR-independent. */
const TAP_MAX_MOVE = 12;

/** Radius in world units of the green selection circle drawn under the selected plane. */
const SELECTION_RING_RADIUS_FACTOR = 0.72; // fraction of hitRadius (baseSize * baseScale / 2)

// =============================================================================
// Private helpers — not exported
// =============================================================================

/**
 * Return the Graphics object for a plane's dots, creating it if needed.
 * Depth 500 — above path graphics layer (50) and runways (0), below projections (600).
 */
function getOrCreatePlaneDots(
  planeId: number,
  state: InputState,
  factory: Phaser.GameObjects.GameObjectFactory,
  worldContainer: Phaser.GameObjects.Container
): Phaser.GameObjects.Graphics {
  let g = state.planePathGraphics.get(planeId);
  if (!g) {
    g = factory.graphics();
    // Add to worldContainer so it shares the container's transform and depth
    // space with planes. Dots are drawn in world-local coordinates so the
    // container's scale is applied automatically — no screen conversion needed.
    worldContainer.add(g);
    g.setDepth(DEPTH.PATH_DOTS);
    state.planePathGraphics.set(planeId, g);
  }
  return g;
}

/**
 * Erase the static dots for one plane.
 * Called at the start of a new drag so the player has a clean canvas.
 */
function clearPlaneDots(planeId: number, state: InputState): void {
  state.planePathGraphics.get(planeId)?.clear();
  state.lastDrawnPathIndex.delete(planeId);
}

/**
 * Full redraw of path dots from `fromIndex` onward.
 *
 * Clears the Graphics and repaints only the remaining (unflown) portion.
 * Used by drawPaths() when a plane's pathIndex advances.
 *
 * fillRect (2 GL triangles) instead of fillCircle (~30 GL triangles) saves
 * ~40 000 triangle submissions per redraw frame with 200 dots × 7 planes.
 */
function drawPlaneDots(
  planeId: number,
  path: Point[],
  fromIndex: number,
  state: InputState,
  factory: Phaser.GameObjects.GameObjectFactory,
  worldContainer: Phaser.GameObjects.Container
): void {
  const g = getOrCreatePlaneDots(planeId, state, factory, worldContainer);
  g.clear();
  g.fillStyle(0xffffff, PATH_CONFIG.DOT_ALPHA);
  const r = PATH_CONFIG.DOT_RADIUS;
  const d = r * 2;
  // Coordinates are world-local — worldContainer applies scale automatically.
  // for (let i = fromIndex; i < path.length; i++) {
  // i+=2 → 2× visual gap
  for (let i = fromIndex; i < path.length; i += 2) {
    const p = path[i];
    g.fillRect(p.x - r, p.y - r, d, d);
  }
  state.lastDrawnPathIndex.set(planeId, fromIndex);
}

/**
 * Append-only dot paint during an active drag — NEVER calls g.clear().
 *
 * Draws from state.dragDrawnCount onward so already-painted dots are never
 * touched. On the first call of a drag (dragDrawnCount === 0) starts from
 * dotStartIndex to skip dots under the plane icon.
 *
 * See APPEND-ONLY DOT PAINTING in the file header.
 */
function appendDragDots(
  planeId: number,
  path: Point[],
  dotStartIndex: number,
  state: InputState,
  factory: Phaser.GameObjects.GameObjectFactory,
  worldContainer: Phaser.GameObjects.Container
): void {
  const g = getOrCreatePlaneDots(planeId, state, factory, worldContainer);
  g.fillStyle(0xffffff, PATH_CONFIG.DOT_ALPHA);
  const r = PATH_CONFIG.DOT_RADIUS;
  const d = r * 2;

  const drawFrom = state.dragDrawnCount === 0 ? dotStartIndex : state.dragDrawnCount;

  // Coordinates are world-local — worldContainer applies scale automatically.
  // for (let i = drawFrom; i < path.length; i++) {
  // i+=2 → 2× visual gap
  for (let i = drawFrom; i < path.length; i += 2) {
    const p = path[i];
    g.fillRect(p.x - r, p.y - r, d, d);
  }

  // Advance counter so the next pointermove only paints the new tail.
  state.dragDrawnCount = path.length;

  // Keep lastDrawnPathIndex in sync so drawPaths() won't try to redraw this
  // plane's dots and accidentally undo the append-only strategy.
  state.lastDrawnPathIndex.set(planeId, dotStartIndex);
}

// =============================================================================
// Pointer event handlers — private, registered by setup()
// =============================================================================

/**
 * pointerdown — hit-test planes in reverse z-order; start a drag.
 *
 * Reverse iteration ensures the topmost (last added) plane is tested first,
 * matching the visual stacking order.
 */
function handlePointerDown(pointer: Phaser.Input.Pointer, ctx: InputContext): void {
  const state = ctx.inputState;

  // Record tap-down snapshot every pointerdown, regardless of whether we hit a plane.
  // pointerup reads these to decide if this was a short stationary tap.
  state._tapDownX = pointer.x;
  state._tapDownY = pointer.y;
  state._tapDownTime = performance.now();
  state._tapMoved = false;

  const worldPt = screenToWorld(
    pointer.x,
    pointer.y,
    ctx.worldContainer.x,
    ctx.worldContainer.y,
    ctx._cachedScale
  );

  for (let i = ctx.planes.length - 1; i >= 0; i--) {
    const plane = ctx.planes[i];
    if (plane.isPointOnIcon(worldPt) && plane.canBeInteracted()) {
      state.draggedPlane = plane;

      // Freeze heading seed at pointerdown. See FIXED-SEED SMOOTHING in file header.
      state.dragStartAngle = plane.rotation;
      state.dragDrawnCount = 0;

      // Seed path at the icon centre, not the nose.
      state.rawDragPath = [{ x: plane.x, y: plane.y }];

      // Do NOT clear dots, path, or approach state here.
      // We don't yet know if this is a tap or a drag.
      // clearPlaneDots + plane.clearPath + plane.resetToNeutral are all deferred
      // to handlePointerMove, where they fire only once _tapMoved transitions
      // to true (confirmed drag). A short tap leaves everything untouched.

      gameEventBus.emit('input:drag-start', plane.id, worldPt);
      break;
    }
  }
}

/**
 * pointermove — collect raw samples; run the full path processing pipeline.
 *
 * Steps: collect → simplify → normalise → snap detect → smooth → restore snap → assign
 * See PATH PROCESSING PIPELINE in the file header.
 */
function handlePointerMove(pointer: Phaser.Input.Pointer, ctx: InputContext): void {
  const state = ctx.inputState;

  // Track whether the pointer has moved far enough from its down position to
  // count as a drag (used by pointerup tap detection).
  if (!state._tapMoved) {
    const dx = pointer.x - state._tapDownX;
    const dy = pointer.y - state._tapDownY;
    if (Math.sqrt(dx * dx + dy * dy) > TAP_MAX_MOVE) {
      state._tapMoved = true;

      // First confirmed drag movement — now safe to clear the plane's existing
      // path and dots. Deferred from pointerdown so a short tap never wipes them.
      if (state.draggedPlane) {
        clearPlaneDots(state.draggedPlane.id, state);
        state.draggedPlane.clearPath();
        state.draggedPlane.resetToNeutral();
      }
    }
  }

  // Until the drag is confirmed, don't process path samples.
  if (!state._tapMoved) return;

  if (!state.draggedPlane || !state.rawDragPath) return;

  const worldPt = screenToWorld(
    pointer.x,
    pointer.y,
    ctx.worldContainer.x,
    ctx.worldContainer.y,
    ctx._cachedScale
  );
  const lastPoint = state.rawDragPath[state.rawDragPath.length - 1];

  // 3. Simplify: skip samples too close together to contribute information.
  if (distance(worldPt, lastPoint) <= PATH_SIMPLIFY) return;

  state.rawDragPath.push(worldPt);

  // 4. Normalise: re-sample at exactly PATH_STEP world units.
  const normalizedPath = normalizeByDistance(state.rawDragPath, PATH_STEP);

  // Reset projections — will be re-evaluated for the new path tail.
  state.landingProjection = null;
  state.waypointProjection = null;
  state.draggedPlane.resetToNeutral();

  // ── 5. Snap detection ──────────────────────────────────────────────────────
  // Check on the raw-normalised path (before smoothing) so the player's drawn
  // endpoint is used for proximity/angle detection, not the turn-limited version.
  let snapPoint: Point | null = null;

  if (normalizedPath.length >= 2) {
    const pathEnd = normalizedPath[normalizedPath.length - 1];
    const pathSecondToEnd = normalizedPath[normalizedPath.length - 2];
    const approachAngle = Math.atan2(pathEnd.y - pathSecondToEnd.y, pathEnd.x - pathSecondToEnd.x);

    // Runway landing snap
    for (const runway of ctx.runways) {
      const landingWorldPoint = runway.getLandingPointWorld();
      if (
        distance(pathEnd, landingWorldPoint) < 60 &&
        angleDifference(approachAngle, runway.landingApproachAngle) < runway.angleTolerance &&
        state.draggedPlane.canConnectToColors(runway.allowedColors)
      ) {
        state.landingProjection = { runway, plane: state.draggedPlane };
        snapPoint = landingWorldPoint;
        state.draggedPlane.setApproachingLanding(true);
        break;
      }
    }

    // Waypoint snap (only if no runway was matched)
    if (!state.landingProjection) {
      // pathEnd and waypoint.x/y are both world-local — no conversion needed.
      for (const waypoint of ctx.waypoints) {
        if (
          waypoint.isPathEndInNeck(pathEnd) &&
          state.draggedPlane.canConnectToColors(waypoint.allowedColors)
        ) {
          // Angle check: drawn path must head toward the waypoint's edge within
          // ±30° of the natural outbound bearing (world centre → waypoint).
          // Mirrors the runway angleTolerance check. Without this any path
          // ending near the neck connects regardless of direction.
          // ⚠️  DO NOT REMOVE — prevents wrong-direction connections.
          const WAYPOINT_ANGLE_TOLERANCE = (30 * Math.PI) / 180;
          const expectedBearing = Math.atan2(waypoint.y, waypoint.x);
          if (angleDifference(approachAngle, expectedBearing) > WAYPOINT_ANGLE_TOLERANCE) {
            continue;
          }

          state.waypointProjection = { waypoint, plane: state.draggedPlane };
          snapPoint = { x: waypoint.x, y: waypoint.y };
          state.draggedPlane.setApproachingWaypoint(true);
          break;
        }
      }
    }
  }

  // ── 6. Smooth ──────────────────────────────────────────────────────────────
  // Seed with dragStartAngle (frozen at pointerdown). See FIXED-SEED SMOOTHING.
  const smoothedPath = smoothDirections(normalizedPath, state.dragStartAngle, PATH_MAX_TURN);

  // ── 7. Restore snap endpoint ───────────────────────────────────────────────
  // smoothDirections re-generates all intermediate points; the exact snap
  // target (runway threshold / waypoint centre) must survive smoothing.
  if (snapPoint && smoothedPath.length > 0) {
    smoothedPath[smoothedPath.length - 1] = snapPoint;
  }

  // ── 7b. Build pathForPlane: extend to runway touchdown when landing snap active ──
  //
  // pathForPlane is SEPARATE from smoothedPath.
  // • smoothedPath (player-drawn only) → appendDragDots, so the append-only
  //   dot strategy is never disturbed by a shifting extension tail.
  // • pathForPlane (drawn + extension) → setPath, so the plane follows all the
  //   way to the departure/touchdown point without a separate lerp animation.
  //
  // After pointerup, drawPaths() trims dots as the plane advances pathIndex
  // through the drawn portion; when it enters the extension the extension dots
  // appear automatically — no extra drawing code required.
  //
  // Waypoint: startWaypointPassing() replaces the path on entry, so extending
  // to the exit point here would be immediately overwritten. Leave for a
  // future dedicated waypoint-preview feature.
  let pathForPlane: Point[] = smoothedPath;
  if (state.landingProjection && snapPoint) {
    // Extend from the landing threshold (snapPoint) to the landing roll endpoint.
    // This guides the plane along the runway centerline to where it decelerates
    // and shrinks to a stop — mirroring how departure extends from departurePoint outward.
    const rollPt = state.landingProjection.runway.getLandingRollPointWorld();
    const extension = normalizeByDistance([snapPoint, rollPt], PATH_STEP);
    if (extension.length > 1) {
      // slice(1) drops the duplicate of snapPoint already at smoothedPath tail
      pathForPlane = [...smoothedPath, ...extension.slice(1)];
    }
  }

  // ── 8. Assign path ──────────────────────────────────────────────────────────
  // closestIndex is computed on pathForPlane so the start index is valid for
  // the full path (extension indices are always > plane's current position).
  //
  // IMPORTANT: start the search from index 1, not 0.
  // pathForPlane[0] is always the plane's centre at pointerdown — the plane is
  // already at (or past) that point.  If findClosestIndex returns 0, setPath
  // sends the plane back to its own starting position, and smoothDirections'
  // MAX_TURN_DEGREES clamping curves the path into a tight circle before it
  // can reach the player's intended direction.  Skipping index 0 ensures the
  // plane always targets a point ahead of its current position.
  const rawClosestIndex = findClosestIndex(
    { x: state.draggedPlane.x, y: state.draggedPlane.y },
    pathForPlane
  );
  const closestIndex = Math.max(rawClosestIndex, 1);
  state.draggedPlane.setPath(pathForPlane, closestIndex);

  // closest to the plane's current world position, minimum 1 — same reason as
  // closestIndex above: index 0 is the plane's own centre at drag-start, so
  // dots starting there would appear under the plane icon rather than ahead of it.
  const dotStartIndex = Math.max(
    findClosestIndex(
      { x: state.draggedPlane.x, y: state.draggedPlane.y },
      smoothedPath // NOTE: the player-drawn path only, not pathForPlane — see §2-E
    ),
    1
  );

  // ── Append dots (player-drawn portion only) ─────────────────────────────────
  // dotStartIndex is computed on smoothedPath so dots begin at the icon centre.
  appendDragDots(
    state.draggedPlane.id,
    smoothedPath, // ← player-drawn only; extension dots come via drawPaths
    dotStartIndex,
    state,
    ctx.add,
    ctx.worldContainer
  );

  gameEventBus.emit('plane:path-assigned', state.draggedPlane.id, pathForPlane);
}

/**
 * pointerup — commit the drag outcome.
 *
 * Three outcomes:
 *   LANDING    — setLandingTarget() + setApproachingLanding(true) + clear conn
 *   WAYPOINT   — setApproachingWaypoint(true) + store exit point in conn map
 *   FREE-FLIGHT — resetToNeutral() + clear conn
 */
function handlePointerUp(pointer: Phaser.Input.Pointer, ctx: InputContext): void {
  const state = ctx.inputState;

  // ── Tap detection ────────────────────────────────────────────────────────────
  // A tap is: pointer up within TAP_MAX_MS AND travel < TAP_MAX_MOVE px AND
  // a plane was hit on pointerdown (draggedPlane was set).
  // A drag has state.draggedPlane AND path data (rawDragPath grew beyond seed).
  //
  // We distinguish two cases:
  //   • Pure tap   — _tapMoved is false and elapsed < TAP_MAX_MS
  //                  → do NOT commit any drag outcome; handle as tap instead.
  //   • Drag-up    — _tapMoved is true OR elapsed >= TAP_MAX_MS
  //                  → commit the normal drag outcome as before.

  const elapsed = performance.now() - state._tapDownTime;
  const isTap = !state._tapMoved && elapsed < TAP_MAX_MS && !!state.draggedPlane;

  if (isTap) {
    const tappedPlane = state.draggedPlane!;

    // Nothing was modified at pointerdown (clearPath/resetToNeutral/clearDots
    // are all deferred to first drag movement), so no restoration is needed.
    state.draggedPlane = null;
    state.rawDragPath = null;
    state.landingProjection = null;
    state.waypointProjection = null;

    // Toggle selection: tap same plane again → deselect; tap new plane → select.
    if (state.selectedPlaneId === tappedPlane.id) {
      // Second tap on same plane — close popup.
      state.selectedPlaneId = null;
      gameEventBus.emit('plane:tap-deselect');
    } else {
      // First tap, or switching to a different plane.
      state.selectedPlaneId = tappedPlane.id;

      // Build and emit popup payload.
      const SPEED_TO_KNOTS = 500;
      const minSpeedKt = Math.round(tappedPlane.baseSpeed * 0.7 * SPEED_TO_KNOTS);
      const maxSpeedKt = Math.round(tappedPlane.baseSpeed * 1.4 * SPEED_TO_KNOTS);
      const curSpeedKt = Math.round(tappedPlane.currentSpeed * SPEED_TO_KNOTS);

      gameEventBus.emit('plane:tapped', {
        id: tappedPlane.id,
        callsign: tappedPlane.callsign || `FLT ${String(Math.floor(tappedPlane.id)).slice(-4)}`,
        aircraftType: tappedPlane.aircraftTypeName || 'Unknown',
        weightClass: tappedPlane.weightClass || 'medium',
        currentSpeed: Math.max(minSpeedKt, Math.min(maxSpeedKt, curSpeedKt)),
        minSpeed: minSpeedKt,
        maxSpeed: maxSpeedKt,
        // isApproaching + isApproachingWaypoint seed liveIsApproaching /
        // liveIsWaypoint in SpeedControlPopup on open. BOTH are required:
        // without isApproachingWaypoint the "Cancel en-route" button never
        // appears for planes that are already connected to a waypoint when tapped.
        // Dynamic updates while the popup stays open arrive via plane:attached
        // and plane:cancelApproach listeners inside SpeedControlPopup.
        // ⚠️  DO NOT REMOVE isApproachingWaypoint.
        isApproaching: tappedPlane.isApproachingLanding,
        isApproachingWaypoint: tappedPlane.isApproachingWaypoint,
      });
    }

    // Do NOT emit 'input:drag-end' — no drag took place.
    return;
  }

  // ── Normal drag commit (unchanged logic) ─────────────────────────────────────
  if (state.draggedPlane && state.landingProjection) {
    const plane = state.draggedPlane;
    const runway = state.landingProjection.runway;
    // Notify the plane of the threshold world position so it knows when to
    // start its landing scale-down animation (mirrors departure startDeparture()).
    const threshold = runway.getLandingPointWorld();
    plane.setLandingThreshold(threshold.x, threshold.y);
    plane.setApproachingLanding(true);
    ctx.waypointConnections.delete(plane.id);
    gameEventBus.emit('plane:attached', plane.id, 'runway'); // triggers AudioSystem success sound
  } else if (state.draggedPlane && state.waypointProjection) {
    const plane = state.draggedPlane;
    const waypoint = state.waypointProjection.waypoint;
    plane.setApproachingWaypoint(true);
    const exitPoint = waypoint.getExitPoint();
    ctx.waypointConnections.set(plane.id, { waypoint, exitPoint });
    gameEventBus.emit('plane:attached', plane.id, 'waypoint'); // triggers AudioSystem success sound
  } else if (state.draggedPlane) {
    state.draggedPlane.resetToNeutral();
    ctx.waypointConnections.delete(state.draggedPlane.id);
  }

  state.draggedPlane = null;
  state.rawDragPath = null;
  state.landingProjection = null;
  state.waypointProjection = null;

  gameEventBus.emit('input:drag-end');
}

// =============================================================================
// InputSystem — public stateless API
// =============================================================================

export const InputSystem = {
  /**
   * Register pointer event listeners and allocate the projectionGraphics layer.
   *
   * Call once from GameScene.create() AFTER worldContainer is set up.
   * Store the returned InputState on the GameScene instance as `this.inputState`
   * and include it in every subsequent InputContext passed to this system.
   *
   * @param ctx  GameScene context
   * @returns    Mutable InputState — must be stored and passed back via ctx.inputState
   */
  setup(ctx: InputContext): InputState {
    // Projection graphics lives inside worldContainer so it shares depth space
    // with planes and dots. Drawn in world-local coordinates.
    const projectionGraphics = ctx.add.graphics();
    ctx.worldContainer.add(projectionGraphics);
    projectionGraphics.setDepth(DEPTH.PATH_DOTS);

    const state: InputState = {
      draggedPlane: null,
      rawDragPath: null,
      dragStartAngle: 0,
      dragDrawnCount: 0,
      planePathGraphics: new Map(),
      lastDrawnPathIndex: new Map(),
      landingProjection: null,
      waypointProjection: null,
      projectionGraphics,
      selectedPlaneId: null,
      _tapDownX: 0,
      _tapDownY: 0,
      _tapDownTime: 0,
      _tapMoved: false,
    };

    // Arrow functions capture `ctx` by reference. Unlike `.bind()` they do not
    // create a new Function object on every call, so off() can unregister them
    // reliably if needed. In practice Phaser removes all scene listeners on
    // shutdown automatically, so off() is not required here.
    ctx.input.on('pointerdown', (p: Phaser.Input.Pointer) => handlePointerDown(p, ctx));
    ctx.input.on('pointermove', (p: Phaser.Input.Pointer) => handlePointerMove(p, ctx));
    ctx.input.on('pointerup', (p: Phaser.Input.Pointer) => handlePointerUp(p, ctx));

    // Desktop-only: pointer can leave the canvas without firing pointerup (e.g.
    // non-fullscreen window, browser chrome). 'gameout' is Phaser's canvas-leave
    // event on InputPlugin.
    //   • Active drag (path being drawn) → commit whatever path exists so far,
    //     same outcome as a normal pointerup.
    //   • Pointer pressed but not yet dragged (tap in progress) → cancel silently;
    //     do NOT open the popup (that would be confusing — user slid off canvas).
    const onGameOut = () => {
      const s = ctx.inputState;
      if (!s.draggedPlane) return;
      if (s._tapMoved) {
        // Drag in progress — commit the path.
        handlePointerUp(ctx.input.activePointer, ctx);
      } else {
        // Tap that drifted off canvas — discard without side-effects.
        s.draggedPlane = null;
        s.rawDragPath = null;
        s._tapMoved = false;
      }
    };
    ctx.input.on('gameout', onGameOut);
    // Store reference so shutdown() can unregister (gameout is NOT auto-removed
    // by Phaser on scene shutdown — it lives on the InputPlugin manager).
    (state as any)._onGameOut = onGameOut;

    // ── plane:cancelApproach — clear visual path dots on disconnect ───────────
    //
    // When the player presses "Cancel approach" or "Cancel en-route" in the
    // SpeedControlPopup, the following chain fires:
    //
    //   SpeedControlPopup.disconnect()
    //     → gameEventBus.emit('plane:cancelApproach', { planeId })
    //       → GameScene._onCancelApproach   — clears plane.path + resetToNeutral()
    //       → HERE (InputSystem)            — clears the visual dot Graphics
    //
    // GameScene clears the *data* (path coordinates, approach flags, icon scale).
    // InputSystem owns the *visuals* (the white dot Graphics objects per plane).
    // Without this listener the dots linger on screen even after the plane is
    // disconnected and freely flying again.
    //
    // ⚠️  DO NOT REMOVE THIS LISTENER — dots will stay on screen after cancel.
    // ⚠️  DO NOT REMOVE THE shutdown() cleanup below — it prevents stale handlers
    //     firing on the next game session after a restart.
    const onCancelApproachDots = ({ planeId }: { planeId: number }) => {
      clearPlaneDots(planeId, ctx.inputState);
    };
    gameEventBus.on('plane:cancelApproach', onCancelApproachDots);
    (state as any)._onCancelApproachDots = onCancelApproachDots;

    return state;
  },

  /**
   * Redraw dots for planes whose pathIndex has advanced since the last draw.
   *
   * Skips the actively dragged plane — its dots are managed by appendDragDots()
   * which is append-only. If drawPaths() also ran for the dragged plane it would
   * call g.clear() + redraw every frame, wiping the accumulated append-only dots
   * and causing a "path dynamically shifting" flickering artifact.
   *
   * Call every frame from GameScene.update() after planes have moved.
   */
  drawPaths(ctx: InputContext): void {
    // Guard: inputState is set by setup(), which is called inside async create().
    // Phaser can tick update() before create() awaits finish, so inputState may
    // still be undefined on the first few frames.
    if (!ctx.inputState) return;
    const state = ctx.inputState;

    for (const plane of ctx.planes) {
      if (plane === state.draggedPlane) continue;
      if (!plane.path || plane.isLanding || !state.planePathGraphics.has(plane.id)) continue;

      const lastIdx = state.lastDrawnPathIndex.get(plane.id) ?? plane.pathIndex;
      if (plane.pathIndex <= lastIdx) continue; // no advancement since last draw

      // Clamp to plane.pathIndex so dots never redraw behind the plane's
      // current position. findClosestIndex searches the whole path and can
      // return an index earlier than pathIndex when the path loops near the
      // plane's starting point — causing the dot layer to incorrectly show
      // dots the plane has already flown through.
      const rawDotStart = findClosestIndex({ x: plane.x, y: plane.y }, plane.path);
      const dotStartIndex = Math.max(rawDotStart, plane.pathIndex);

      drawPlaneDots(plane.id, plane.path, dotStartIndex, state, ctx.add, ctx.worldContainer);
    }
  },

  /**
   * Draw ghost circles on the active landing threshold / waypoint centre.
   *
   * Gives the player visual confirmation that their drawn path will snap to the
   * target. Clears and redraws every frame.
   *
   * Call every frame from GameScene.update().
   */
  drawProjections(ctx: InputContext): void {
    // Guard: same async-create race as drawPaths() — inputState may not exist yet.
    if (!ctx.inputState) return;
    const state = ctx.inputState;
    const g = state.projectionGraphics;
    if (!g) return;

    g.clear();

    if (state.landingProjection) {
      const { runway, plane } = state.landingProjection;
      const lp = runway.getLandingPointWorld();
      // World-local coords — worldContainer scale is applied automatically by Phaser.
      // Radius expressed in world units matches the plane's actual game-unit size.
      g.fillStyle(0xffffff, 0.4);
      g.fillCircle(lp.x, lp.y, plane.getActualSize() / 2.2);
    }

    if (state.waypointProjection) {
      const { waypoint, plane } = state.waypointProjection;
      // waypoint.x/y is already world-local (worldContainer child).
      g.fillStyle(0xffffff, 0.4);
      g.fillCircle(waypoint.x, waypoint.y, plane.getActualSize() / 2.2);
    }

    // ── Selection ring (speed-control popup) ─────────────────────────────────
    // Draw a pulsing green ring under the icon of the selected plane.
    // Drawn in world-local coords just like landing/waypoint projections.
    if (state.selectedPlaneId !== null) {
      const sel = (ctx as InputContext).planes.find((p) => p.id === state.selectedPlaneId);
      if (sel && !sel.isOffscreen) {
        const ringRadius = (sel.baseSize * sel.baseScale) / 2 / SELECTION_RING_RADIUS_FACTOR;
        // Pulsing alpha: oscillates between 0.55 and 1.0
        const pulse = 0.55 + 0.45 * Math.abs(Math.sin(Date.now() * 0.003));
        g.lineStyle(3, 0x3b82f6, pulse);
        g.strokeCircle(sel.x, sel.y, ringRadius);
        // Soft fill inside ring
        g.fillStyle(0x3b82f6, 0.08 * pulse);
        g.fillCircle(sel.x, sel.y, ringRadius);
      } else if (!sel || sel.isOffscreen) {
        // Plane left scene — clear selection
        state.selectedPlaneId = null;
      }
    }
  },

  /**
   * Destroy the Graphics object for a plane that has left the scene.
   *
   * Call from GameScene.update() when filtering out offscreen planes.
   */
  destroyPlaneDots(ctx: InputContext, planeId: number): void {
    const state = ctx.inputState;
    const g = state.planePathGraphics.get(planeId);
    if (g) {
      g.destroy();
      state.planePathGraphics.delete(planeId);
    }
    state.lastDrawnPathIndex.delete(planeId);
  },

  /**
   * Tear down all input state and Graphics objects.
   *
   * Destroys projectionGraphics and all per-plane dot Graphics.
   * Does NOT call ctx.input.off() — Phaser removes all scene listeners
   * automatically when the scene shuts down.
   *
   * Call from GameScene.shutdown().
   */
  shutdown(ctx: InputContext): void {
    const state = ctx.inputState;

    // ── Bus listeners — must be unregistered explicitly ────────────────────────
    // Unlike Phaser input events (pointerdown/move/up), bus listeners on
    // gameEventBus survive scene restarts. If not removed here they fire a
    // second time on the next game session with a stale ctx reference.
    //
    // ⚠️  DO NOT REMOVE THESE off() calls.

    // gameout: fires when pointer leaves the canvas without a pointerup (desktop).
    if ((state as any)._onGameOut) {
      ctx.input.off('gameout', (state as any)._onGameOut);
      (state as any)._onGameOut = null;
    }

    // plane:cancelApproach: clears visual path dots when player disconnects a
    // plane from its runway/waypoint via the SpeedControlPopup cancel button.
    if ((state as any)._onCancelApproachDots) {
      gameEventBus.off('plane:cancelApproach', (state as any)._onCancelApproachDots);
      (state as any)._onCancelApproachDots = null;
    }

    state.projectionGraphics?.destroy();

    state.planePathGraphics.forEach((g) => g.destroy());
    state.planePathGraphics.clear();
    state.lastDrawnPathIndex.clear();

    state.draggedPlane = null;
    state.rawDragPath = null;
    state.landingProjection = null;
    state.waypointProjection = null;
    state.dragDrawnCount = 0;
    state.selectedPlaneId = null;
    state._tapMoved = false;
  },
} as const;
