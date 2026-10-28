// =============================================================================
// Plane.ts — CHANGE HISTORY
// =============================================================================
//
// SESSION 1 — Android & coordinate space fixes
// ─────────────────────────────────────────────
// • checkOffscreen() rewritten to use screen-space coordinates.
//   The old version compared plane.x/y (world-local, ±960/±540) against
//   camera.width/height (DPR-scaled canvas pixels, ~2400×1080). Those are
//   different coordinate spaces — a plane at world x=-400 (left side, fully
//   visible) incorrectly triggered isOffscreen=true and was destroyed mid-flight.
//   Fix: convert world-local to screen via the parent container's transform
//   (parent.x + this.x * parent.scaleX) and compare against camera dimensions.
//
// • isPointOnIcon() hit radius:
//   Was: (baseSize * baseScale * textureScale) / 2 — including textureScale
//   shrank the effective hit zone to ~25% of the visible icon because
//   textureScale is an internal sprite normalisation factor, not a visual scale.
//   Fix: hitRadius = (baseSize * baseScale) / 2 — matches the actual visual size.
//
// SESSION 2 — Shadow size
// ─────────────────────────
// • SHADOW_SCALE changed from 0.5 to 0.25.
//   Shadow is now rendered at 1/4 of the plane icon size (was 1/2).
//   Applied consistently in all four shadow scale sites: initial creation,
//   departure scaling loop, level-change scale animation, and landing animation.
//
// SESSION 3 — Path following stability
// ──────────────────────────────────────
// • targetAngle computation: uses Phaser.Math.Angle.Between(plane, path[i]).
//   This is stable as long as path[0] is seeded correctly from GameScene
//   (see GameScene.ts SESSION 2 notes on liveRawPath and dragStartAngle).
//   The plane's TURN_SPEED (0.03) lerps rotation smoothly toward targetAngle
//   each frame — instantaneous heading changes are not possible by design.
//
// SESSION 4 — Speed control popup
// ─────────────────────────────────
// • Added public fields: callsign, aircraftTypeName, weightClass.
//   Set by SpawnSystem after construction. Read by InputSystem tap handler to
//   build the PopupPlaneData payload emitted on 'plane:tapped'.
// • Added public getters: baseSpeed (read-only), currentSpeed (read-only).
//   InputSystem needs these to compute the knot range — keeping the underlying
//   fields private so only Plane internals mutate them directly.
// • Added _targetSpeedKnots (private) + setTargetSpeed(knots) public method.
//   GameScene listens for 'plane:setSpeed' bus events and calls this.
//   Speed lerps toward the target at 0.02/frame in update() (~2 s at 60 fps).
//   Skipped during landing roll (_thresholdCrossed) so it never fights
//   LANDING_ROLL_SPEED. Clamped to ±30 % of baseSpeed on entry.
// • SPEED_TO_KNOTS constant removed from Plane — lives in InputSystem instead
//   (single source of truth for the conversion factor).
//
// SESSION 5 — Path-following circling bug (CRITICAL — see update())
// ─────────────────────────────────────────────────────────────────
// SYMPTOM: plane enters a continuous turning loop instead of following the
// drawn path; changing speed sometimes "unsticks" it, sometimes doesn't.
//
// ROOT CAUSE (two compounding issues, both inside update()'s path-following
// block — search for "Forward-scan catch-up"):
//
//   1. pathIndex previously advanced by at most ONE point per frame via a
//      single `if (distance < pathAccuracy) pathIndex++`. If currentSpeed
//      caused the plane to travel further than NORMALIZED_STEP (10 units) in
//      one frame, pathIndex fell behind the plane's real position.
//
//   2. this.rotation lerps toward targetAngle via an EXPONENTIAL fraction
//      (TURN_SPEED = 0.03/frame), NOT a fixed degrees-per-frame rate. The
//      plane's actual achievable turn radius therefore scales with
//      currentSpeed — faster planes need more distance to complete the same
//      heading change, so their effective turn radius is WIDER than slower
//      planes. The drawn path's curvature is capped at a FIXED minimum
//      radius (MAX_TURN_DEGREES, independent of speed). On a sharp corner
//      taken at high speed, the plane's wider turn radius swings it
//      PHYSICALLY OUTSIDE the path dots — it ends up beyond pathAccuracy
//      from several points it has already flown past. A fixed-radius
//      capture then never advances pathIndex; the heading target stays
//      pinned to an increasingly stale point, and the plane orbits trying
//      to reach it. Changing speed only "fixes" this by accident — it
//      perturbs the geometry enough to wander back inside some later
//      point's capture radius.
//
// FIX: replaced fixed-radius capture with a bounded forward-scan
// (PATH_LOOKAHEAD = 30 points) that finds the closest path point AHEAD of
// the plane's actual position every frame, regardless of lateral overshoot
// distance. This makes path-following correct for any combination of speed
// and turn sharpness.
//
// ⚠️  DO NOT replace the forward-scan in update() with a simple distance
//     check against a single point (pathIndex or pathIndex+1) — that
//     reintroduces this exact bug. See inline comments at the fix site for
//     full detail before touching this block.
//
// =============================================================================

import Phaser from 'phaser';
import type { Point } from '@/types/game';
import {
  getPlaneTypeFromTextureKey,
  getDeviceScaleFactor,
  getShadowTextureKey,
} from '@/game/config/planes.config';
import { getDPR, scaleToDPR } from '@/game/utils/dprScale.helper';
import { normalizeByDistance } from '@/game/systems/PathProcessor';
import { DEPTH } from '@/game/constants/depth.constants';
import { lerpAngle } from '@/game/utils/math';
import { DEFAULT_PLANE_TYPE } from '../config/defaults.config';

/**
 * Enhanced Plane class with DPR scaling for high-resolution displays
 */

export interface PlaneConfig {
  scene: Phaser.Scene;
  x: number;
  y: number;
  angle: number;
  texture: string;
  textureWhite: string;
  shadowTexture?: string;
  color: string;
  speed?: number;
}

export class Plane extends Phaser.GameObjects.Container {
  // Identification
  public id: number;
  public connectionColor: string;
  public planeType: number;
  /** Human-readable callsign (e.g. "UAL 441"). Set by SpawnSystem after construction. */
  public callsign: string = '';
  /** Aircraft type name (e.g. "B737-800"). Set by SpawnSystem after construction. */
  public aircraftTypeName: string = 'Unknown';
  /** Weight class (e.g. "heavy"). Set by SpawnSystem after construction. */
  public weightClass: string = 'medium';

  // Speed control — popup integration
  /**
   * Non-null while a user-commanded speed ramp is active.
   * Stores the target speed in INTERNAL world-units/frame (already converted from knots).
   * Set by setTargetSpeed(). Cleared to null once the ramp reaches the target.
   */
  private _targetSpeedKnots: number | null = null;

  // Size configuration (DPR-aware)
  baseSize: number; // Already scaled by DPR
  private collisionRadius: number; // Already scaled by DPR
  private warningRadius: number; // Already scaled by DPR
  private deviceScale: number;
  private dpr: number; // Device Pixel Ratio

  // Movement
  public velocity: Phaser.Math.Vector2;
  public targetAngle: number;
  private _currentSpeed: number;
  private _baseSpeed: number;

  /** Read-only accessor for InputSystem tap handler and speed popup. */
  get currentSpeed(): number {
    return this._currentSpeed;
  }
  /** Read-only accessor for InputSystem tap handler (speed range calc). */
  get baseSpeed(): number {
    return this._baseSpeed;
  }

  // Path following
  public path: Point[] | null = null;
  public pathIndex: number = 0;
  private pathAccuracy: number;

  // Vertical separation (3 levels: -1, 0, 1)
  public level: number = 0;
  private targetLevel: number = 0;
  baseScale: number = 1.0;
  private targetBaseScale: number = 1.0;
  private textureScale: number = 1.0; // shrinks raw texture px → baseSize game-units
  private isAnimatingScale: boolean = false;
  private scaleAnimationStart: number = 0;
  private readonly LEVEL_SCALE_DURATION_MS = 2000;

  // State flags
  public isOffscreen: boolean = false;
  public isDeparting: boolean = false;
  public isLanding: boolean = false;
  public isApproachingLanding: boolean = false;
  public isApproachingWaypoint: boolean = false;
  public isPassingWaypoint: boolean = false;
  public isFollowingAirway: boolean = false;

  // Departure delay
  isDepartureDelayed: boolean = false;
  private departureDelayStartTime: number = 0;
  private readonly DEPARTURE_DELAY_MS = 2000;

  // Departure scaling
  private isDepartureScaling: boolean = false;
  private departureScaleStartTime: number = 0;
  private readonly DEPARTURE_SCALE_DURATION_MS = 8000;
  private departureStartScale: number = 0.7;
  private departureTargetScale: number = 1.0;

  // Waypoint passing
  private waypointPassingStartTime: number = 0;
  private readonly WAYPOINT_PASSING_SPEED = 0.6;

  // Landing — mirrors departure: parallel scale-down while following the runway path.
  // Position is driven by the normal path-following system (same as departure takeoff roll).
  // This block only owns the visual animation (scale, shadow, opacity).
  private landingScaleStartTime: number = 0;
  private readonly LANDING_SCALE_DURATION_MS = 3000; // scale 0.9→0.7 over the 40% roll
  private readonly LANDING_FADE_MS = 1000; // 1 s fade-out after roll ends
  private readonly LANDING_START_SCALE = 0.9; // approach level (-1) scale
  private readonly LANDING_END_SCALE = 0.7; // matches departureStartScale
  private readonly LANDING_ROLL_SPEED = DEFAULT_PLANE_TYPE.BASE_SPEED; // fixed roll speed
  // Threshold: entered when plane crosses the dashed approach zone before RW numbers.
  private landingThresholdX: number | null = null;
  private landingThresholdY: number | null = null;
  private _thresholdCrossed: boolean = false;
  private _landingFadeStartTime: number = 0;

  // Visual components
  private planeSprite: Phaser.GameObjects.Sprite;
  /** White silhouette layered between shadow and main sprite, always alpha 1.
   *  Keeps the plane readable on busy backgrounds when the main sprite fades. */
  private undercoverSprite: Phaser.GameObjects.Sprite;
  private shadowSprite: Phaser.GameObjects.Sprite | null = null;
  private warningCircle: Phaser.GameObjects.Graphics;

  // Warning state
  public warning: { color: string } | null = null;

  // Configuration
  private readonly TURN_SPEED = 0.03;
  private readonly SHADOW_SCALE = 0.5; // shadow rendered at 1/3 of plane size
  private readonly SHADOW_OFFSET_PERCENTAGE = 0.5;
  private readonly SHADOW_OFFSET_DEPARTURE_PERCENTAGE = 0.02;

  constructor(config: PlaneConfig) {
    super(config.scene, config.x, config.y);

    this.id = Date.now() + Math.random();
    this.connectionColor = config.color;

    // ✅ Get DPR for scaling
    this.dpr = getDPR();

    const planeTypeConfig = getPlaneTypeFromTextureKey(config.texture);

    if (planeTypeConfig) {
      this.planeType = planeTypeConfig.id;

      // ✅ DON'T scale by DPR here - these are already device-scaled
      // planeTypeConfig already includes device scaling
      this.baseSize = planeTypeConfig.baseSize;
      this.collisionRadius = planeTypeConfig.collisionRadius;
      this.warningRadius = planeTypeConfig.warningRadius;
      this._baseSpeed = config.speed ?? planeTypeConfig.speed;
    } else {
      console.warn(`Could not find plane type config for ${config.texture}, using defaults`);
      this.planeType = 1;

      // ✅ Use defaults without extra DPR scaling
      this.baseSize = 50;
      this.collisionRadius = 50;
      this.warningRadius = 70;
      this._baseSpeed = config.speed ?? 0.4;
    }

    // ✅ Path accuracy doesn't need DPR scaling
    this.pathAccuracy = 10;

    this.deviceScale = getDeviceScaleFactor();
    this._currentSpeed = this._baseSpeed;
    this.targetAngle = config.angle;
    this.velocity = new Phaser.Math.Vector2();

    if (!this.scene.textures.exists(config.texture)) {
      console.error(`❌ Texture not found: ${config.texture}`);
    }

    const shadowTextureKey = getShadowTextureKey(config.texture);

    // Create shadow sprite
    if (this.scene.textures.exists(shadowTextureKey)) {
      this.shadowSprite = this.scene.add.sprite(0, 0, shadowTextureKey);
      this.shadowSprite.setAlpha(0.5);

      // ✅ Scale sprite ONLY by baseScale (Phaser canvas handles DPR internally)
      // Corrected below after textureScale is computed
      this.shadowSprite.setScale(this.baseScale);
      this.shadowSprite.setOrigin(0.5, 0.5);

      this.add(this.shadowSprite);
      console.log(`✅ Shadow loaded: ${shadowTextureKey}`);
    } else {
      console.warn(`⚠️ Shadow texture not found: ${shadowTextureKey}`);
      this.shadowSprite = null;
    }

    // Create main sprite
    this.planeSprite = this.scene.add.sprite(0, 0, config.texture);

    // Compute textureScale: maps raw texture pixel size → baseSize game-units.
    // High-res textures (e.g. 5× upgrade) would render 5× too large without this.
    const frame = this.planeSprite.frame;
    const texturePxSize = Math.max(frame.realWidth, frame.realHeight);
    this.textureScale = texturePxSize > 0 ? this.baseSize / texturePxSize : 1.0;

    // Now correct the shadow with its own scale (1/3 of plane visual size)
    if (this.shadowSprite) {
      this.shadowSprite.setScale(this.baseScale * this.textureScale * this.SHADOW_SCALE);
    }

    const spriteScale = this.baseScale * this.textureScale;

    // White undercover sprite — same texture, tinted solid white, always alpha 1.
    // Layer order: shadow → undercoverSprite → planeSprite → warningCircle.
    this.undercoverSprite = this.scene.add.sprite(0, 0, config.textureWhite);
    this.undercoverSprite.setOrigin(0.5, 0.5);
    this.undercoverSprite.setScale(spriteScale);
    this.undercoverSprite.setTint(0xffffff);
    this.undercoverSprite.setAlpha(1);
    this.add(this.undercoverSprite);

    this.planeSprite.setScale(spriteScale);
    this.planeSprite.setOrigin(0.5, 0.5);
    this.add(this.planeSprite);

    // Create warning circle
    this.warningCircle = this.scene.add.graphics();
    this.add(this.warningCircle);

    this.setRotation(config.angle);
    this.updateShadowPosition();
    this.scene.add.existing(this);
    this.setDepth(DEPTH.PLANE_LEVEL_0); // default: cruising at level 0

    console.log(
      `✈️ Created ${planeTypeConfig?.name || 'Unknown'} (Type ${this.planeType}):`,
      `baseSize=${this.baseSize.toFixed(1)}px,`,
      `texturePx=${texturePxSize}px,`,
      `textureScale=${this.textureScale.toFixed(4)},`,
      `visual=${(this.baseSize * this.baseScale).toFixed(1)}px`
    );
  }

  private updateShadowPosition(): void {
    if (!this.shadowSprite) return;

    let offsetPercentage: number;

    if (this.isDepartureDelayed) {
      offsetPercentage = this.SHADOW_OFFSET_DEPARTURE_PERCENTAGE;
    } else if (this.isDepartureScaling) {
      const scaleProgress =
        (this.baseScale - this.departureStartScale) /
        (this.departureTargetScale - this.departureStartScale);
      offsetPercentage =
        this.SHADOW_OFFSET_DEPARTURE_PERCENTAGE +
        (this.SHADOW_OFFSET_PERCENTAGE - this.SHADOW_OFFSET_DEPARTURE_PERCENTAGE) * scaleProgress;
    } else {
      offsetPercentage = this.SHADOW_OFFSET_PERCENTAGE;
    }

    const worldShadowOffset = this.baseSize * offsetPercentage * this.baseScale;
    const angle = -this.rotation;
    const rotatedX = worldShadowOffset * Math.cos(angle) - worldShadowOffset * Math.sin(angle);
    const rotatedY = worldShadowOffset * Math.sin(angle) + worldShadowOffset * Math.cos(angle);

    this.shadowSprite.setPosition(rotatedX, rotatedY);
  }

  getCollisionRadius(): number {
    return this.collisionRadius * this.baseScale;
  }

  getWarningRadius(): number {
    return this.warningRadius * this.baseScale;
  }

  getActualSize(): number {
    return this.baseSize * this.baseScale;
  }

  setLevel(level: number): void {
    if (this.level === level) return;

    this.level = level;
    this.targetLevel = level;

    let newTargetScale: number;
    switch (level) {
      case -1:
        newTargetScale = 0.9;
        break;
      case 1:
        newTargetScale = 1.2;
        break;
      default:
        newTargetScale = 1.0;
        break;
    }

    if (newTargetScale !== this.targetBaseScale) {
      this.targetBaseScale = newTargetScale;
      this.scaleAnimationStart = this.scene.time.now;
      this.isAnimatingScale = true;
    }

    this.updateDepth();
  }

  private updateDepth(): void {
    if (this.isDepartureDelayed || this.isDepartureScaling) {
      this.setDepth(DEPTH.PLANE_RUNWAY);
      (this.scene as unknown as { _depthDirty: boolean })._depthDirty = true;
      return;
    }

    switch (this.level) {
      case -1:
        this.setDepth(DEPTH.PLANE_LEVEL_M1);
        break;
      case 1:
        this.setDepth(DEPTH.PLANE_LEVEL_1);
        break;
      default:
        this.setDepth(DEPTH.PLANE_LEVEL_0);
        break;
    }
    (this.scene as unknown as { _depthDirty: boolean })._depthDirty = true;
  }

  canConnectToColors(allowedColors: string[]): boolean {
    return allowedColors.includes(this.connectionColor);
  }

  setApproachingLanding(approaching: boolean): void {
    this.isApproachingLanding = approaching;
    if (approaching) {
      this.setLevel(-1);
    }
  }

  setApproachingWaypoint(approaching: boolean): void {
    this.isApproachingWaypoint = approaching;
    if (approaching) {
      this.setLevel(1);
    }
  }

  resetToNeutral(): void {
    this.setLevel(0);
    this.isApproachingLanding = false;
    this.isApproachingWaypoint = false;
  }

  startWaypointPassing(exitPoint: Point): void {
    this.isPassingWaypoint = true;
    this.isFollowingAirway = true;
    this.waypointPassingStartTime = this.scene.time.now;
    this._currentSpeed = this.WAYPOINT_PASSING_SPEED;

    const pathToExit = normalizeByDistance([{ x: this.x, y: this.y }, exitPoint], 10);
    this.path = pathToExit;
    this.pathIndex = 0;
  }

  startDeparture(): void {
    this.isDeparting = true;
    this.isDepartureDelayed = true;
    this.departureDelayStartTime = this.scene.time.now;

    this.baseScale = this.departureStartScale;
    this.targetBaseScale = this.departureStartScale;

    // Plane is on the ground — render below all airborne traffic.
    this.setDepth(DEPTH.PLANE_RUNWAY);

    // ✅ Must use baseScale * textureScale — same formula as all other scale calls.
    // textureScale normalises the raw texture pixels down to baseSize game-units,
    // so the blinking plane on the runway appears at the correct visual size.
    const smallScale = this.departureStartScale * this.textureScale;
    this.planeSprite.setScale(smallScale);
    this.undercoverSprite.setScale(smallScale);

    if (this.shadowSprite) {
      this.shadowSprite.setScale(smallScale * this.SHADOW_SCALE);
      this.updateShadowPosition();
    }

    console.log(
      `✈️ Plane ${this.id}: Starting departure at ${(this.departureStartScale * 100).toFixed(
        0
      )}% scale`
    );
  }

  canBeInteracted(): boolean {
    return (
      !this.isPassingWaypoint &&
      !this.isFollowingAirway &&
      !this.isDepartureDelayed &&
      !this.isDepartureScaling
    );
  }

  /**
   * Command the plane to smoothly ramp its speed toward `speedKnots`.
   * Called by GameScene when it receives a 'plane:setSpeed' bus event.
   *
   * Converts knots → internal world-units/frame using the same SPEED_TO_KNOTS
   * factor (500) that InputSystem uses to build the popup payload — they must match.
   * Clamped to ±30 % of _baseSpeed so the popup range and the actual clamp agree.
   *
   * The lerp (0.02/frame) runs in update(). Skipped while _thresholdCrossed so
   * landing roll is never interrupted.
   */
  setTargetSpeed(speedKnots: number): void {
    const SPEED_TO_KNOTS = 500;
    const internal = speedKnots / SPEED_TO_KNOTS;
    const minInternal = this._baseSpeed * 0.7;
    const maxInternal = this._baseSpeed * 1.4;
    this._targetSpeedKnots = Math.max(minInternal, Math.min(maxInternal, internal));
  }

  isActiveForCollisions(): boolean {
    // Landing / approaching planes shrink their baseScale below departureTargetScale (1.0),
    // but they must ALWAYS participate in collision detection — that's the whole point of
    // sequencing arrivals safely.  The old guard `baseScale >= departureTargetScale` was
    // designed to exclude planes still *growing* out of a departure animation; it should
    // never have fired for planes that are *shrinking* toward a runway.
    if (this.isApproachingLanding || this.isLanding) return true;

    // Exclude planes that are still materialising on the runway (departure delay + scale-up).
    return !this.isDepartureScaling && this.baseScale >= this.departureTargetScale;
  }

  /**
   * Store the runway threshold world position.
   * Scale-down, shadow fade, and deceleration begin once the plane crosses this point.
   * Call from InputSystem.handlePointerUp() alongside setApproachingLanding(true).
   */
  setLandingThreshold(thresholdX: number, thresholdY: number): void {
    this.landingThresholdX = thresholdX;
    this.landingThresholdY = thresholdY;
    this._thresholdCrossed = false;
  }

  startLanding(): void {
    // Path exhausted at landingRollPoint — plane stops and begins 1 s fade-out.
    this.isLanding = true;
    this._thresholdCrossed = true;
    this._currentSpeed = 0;
    this._landingFadeStartTime = 0;
    this.setDepth(DEPTH.PLANE_RUNWAY);
    (this.scene as unknown as { _depthDirty: boolean })._depthDirty = true;
  }

  setPath(path: Point[], startIndex: number = 0): void {
    this.path = path;
    this.pathIndex = startIndex;
  }

  clearPath(): void {
    this.path = null;
    this.pathIndex = 0;
  }

  isPointOnIcon(point: Point): boolean {
    const distance = Phaser.Math.Distance.Between(point.x, point.y, this.x, this.y);
    // Hit radius = visual radius in world-local units.
    // baseSize is already the intended world size; textureScale is internal sprite normalisation
    // and must NOT be applied here — including it shrinks the hit zone to ~25% of the visual.
    const hitRadius = (this.baseSize * this.baseScale) / 2;
    return distance < hitRadius;
  }

  update(time: number): void {
    // console.log(`✈️ delta ${delta}`);

    // Guard: scene is torn down when a collision triggers level:failed.
    // Phaser still fires one more update tick — bail out to avoid null-ref crashes.
    if (!this.scene?.sys?.isActive()) return;

    this.updateScaleAnimation(time);

    // ── Speed ramp (popup command) ────────────────────────────────────────────
    // Lerp _currentSpeed toward the user-commanded target at 0.02/frame (~2 s).
    // Skipped during and after landing roll so LANDING_ROLL_SPEED is never fought.
    if (this._targetSpeedKnots !== null && !this._thresholdCrossed && !this.isLanding) {
      this._currentSpeed = Phaser.Math.Linear(this._currentSpeed, this._targetSpeedKnots, 0.02);
      if (Math.abs(this._currentSpeed - this._targetSpeedKnots) < 0.001) {
        this._currentSpeed = this._targetSpeedKnots;
        this._targetSpeedKnots = null;
      }
    }

    if (this.isDepartureDelayed) {
      const delayElapsed = time - this.departureDelayStartTime;
      if (delayElapsed >= this.DEPARTURE_DELAY_MS) {
        this.isDepartureDelayed = false;
        this.isDepartureScaling = true;
        this.departureScaleStartTime = time;
        this.targetBaseScale = this.departureTargetScale;

        console.log(`✈️ Plane ${this.id}: Departure delay complete, starting movement`);
      } else {
        this.updateOpacity(time);
        this.updateWarningVisual();
        return;
      }
    }

    if (this.isDepartureScaling) {
      const scaleElapsed = time - this.departureScaleStartTime;
      const scaleProgress = Math.min(scaleElapsed / this.DEPARTURE_SCALE_DURATION_MS, 1);

      this.baseScale =
        this.departureStartScale +
        (this.departureTargetScale - this.departureStartScale) * scaleProgress;

      const currentScale = this.baseScale * this.textureScale;
      this.planeSprite.setScale(currentScale);
      this.undercoverSprite.setScale(currentScale);

      if (this.shadowSprite) {
        this.shadowSprite.setScale(currentScale * this.SHADOW_SCALE);
        this.updateShadowPosition();
      }

      this.updateDepth();

      if (scaleProgress >= 1) {
        this.isDepartureScaling = false;
        this.baseScale = this.departureTargetScale;
        this.updateDepth(); // promote from PLANE_RUNWAY → PLANE_LEVEL_0
        console.log(`✈️ Plane ${this.id}: Scale-up complete`);
      }
    }

    if (this.isPassingWaypoint) {
      const passingDuration = 2000;
      if (time - this.waypointPassingStartTime > passingDuration) {
        this.isPassingWaypoint = false;
      }
    }

    // Landing scale animation runs in parallel with path-following — no early return.
    // Triggered by _thresholdCrossed (set when plane passes the runway threshold),
    // NOT by isLanding (which only fires when the path ends at landingRollPoint).
    if (this._thresholdCrossed) {
      this.updateLandingScale(time);
    }

    if (this.path && this.pathIndex < this.path.length) {
      // ── Forward-scan catch-up: find the closest path point AHEAD of the
      //    plane's actual position, within a bounded lookahead window ────────
      //
      // BUG THIS FIXES (two related failure modes):
      //
      //  1. LAG: a single `if (distance < pathAccuracy) pathIndex++` can only
      //     advance one point per frame. If currentSpeed × frame causes the
      //     plane to travel further than NORMALIZED_STEP (10 units) in one
      //     frame, pathIndex falls behind the plane's real position.
      //
      //  2. TURN-RADIUS MISMATCH (depends on BOTH speed and drawn turn angle):
      //     this.rotation lerps toward targetAngle via an EXPONENTIAL fraction
      //     (TURN_SPEED = 0.03/frame), not a fixed degrees-per-frame rate. The
      //     plane's actual achievable turn radius therefore depends on
      //     currentSpeed — faster planes need more distance to complete the
      //     same heading change, so their effective turn radius is WIDER.
      //     The drawn path's curvature, by contrast, is capped at a FIXED
      //     minimum radius by MAX_TURN_DEGREES (independent of speed).
      //     On a sharp corner taken at higher speed, the plane's wider turn
      //     radius makes it swing physically outside the path dots — it can
      //     end up well beyond `pathAccuracy` from several points it has
      //     already flown past. A fixed-radius capture then never advances
      //     pathIndex past those points; the heading target stays pinned to
      //     an increasingly stale point behind/beside the plane, and it
      //     orbits trying to reach it. This is why changing speed appears to
      //     "fix" the loop — it perturbs the geometry just enough to
      //     accidentally bring the plane back inside some later point's
      //     capture radius. It is not a real fix, just a lucky escape.
      //
      // FIX: every frame, scan forward from the current pathIndex (bounded
      // window — cheap, since pathIndex is normally already close) and adopt
      // whichever point is closest to the plane's ACTUAL position as the new
      // pathIndex, as long as it is ahead of (or equal to) the current index.
      // This makes path-following robust to ANY mismatch between the path's
      // drawn curvature and the plane's speed-dependent achievable turn
      // radius — the plane always chases the nearest still-ahead point
      // instead of a point it may have geometrically overshot.
      //
      // ⚠️  DO NOT revert to a single fixed-radius `if`/`while` capture check —
      //     that reintroduces speed-and-turn-angle-dependent circling.
      const PATH_LOOKAHEAD = 30; // points (~300 world units at NORMALIZED_STEP=10)
      const scanEnd = Math.min(this.pathIndex + PATH_LOOKAHEAD, this.path.length);
      let bestIndex = this.pathIndex;
      let bestDistSq = Infinity;
      for (let i = this.pathIndex; i < scanEnd; i++) {
        const pdx = this.path[i].x - this.x;
        const pdy = this.path[i].y - this.y;
        const dSq = pdx * pdx + pdy * pdy;
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          bestIndex = i;
        }
      }
      this.pathIndex = bestIndex;

      // Advance past the closest point itself once the plane is within
      // pathAccuracy of it, so the heading target is always the NEXT point,
      // not the one currently being reached.
      if (this.pathIndex < this.path.length && bestDistSq < this.pathAccuracy * this.pathAccuracy) {
        this.pathIndex++;
      }

      if (this.pathIndex < this.path.length) {
        const currentTarget = this.path[this.pathIndex];
        const _dx = currentTarget.x - this.x;
        const _dy = currentTarget.y - this.y;
        // Only update heading when the target is meaningfully far away.
        // atan2 / Angle.Between on a < 2 world-unit vector is numerically
        // unstable: a sub-pixel overshoot flips the result ~180° and the
        // TURN_SPEED lerp then spins the plane indefinitely at the draw-start
        // position.  Skipping the update for very close targets preserves the
        // last stable heading until the plane closes in from a safe distance.
        if (_dx * _dx + _dy * _dy > 4.0) {
          // threshold: 2 world-units
          this.targetAngle = Math.atan2(_dy, _dx);
        }

        // Threshold crossing: start landing scale-down when plane reaches the runway numbers.
        if (
          this.isApproachingLanding &&
          !this._thresholdCrossed &&
          this.landingThresholdX !== null &&
          this.landingThresholdY !== null
        ) {
          const distToThreshold = Phaser.Math.Distance.Between(
            this.x,
            this.y,
            this.landingThresholdX,
            this.landingThresholdY
          );
          if (distToThreshold < this.baseSize * this.baseScale * 0.6) {
            this._thresholdCrossed = true;
            this.landingScaleStartTime = 0;
            // All landing planes roll at fixed BASE_SPEED — auto-separation on RW.
            this._currentSpeed = this.LANDING_ROLL_SPEED;
            // Remove from level-based conflict: set to level 0 (was -1 on approach).
            this.level = 0;
            this.setDepth(DEPTH.PLANE_RUNWAY);
            (this.scene as unknown as { _depthDirty: boolean })._depthDirty = true;
          }
        }
      } else {
        if (this.isFollowingAirway) {
          this.isOffscreen = true;
        } else if (this.isApproachingLanding && !this.isLanding) {
          this.startLanding();
        } else {
          // Free-flight path exhausted: lock heading to current rotation.
          // Without this the plane slowly rotates toward a stale targetAngle
          // from a short drag or a previous snap, instead of flying straight.
          this.targetAngle = this.rotation;
        }
        // Do NOT null the path while the plane is approaching a waypoint but has
        // not yet started following the airway. plane.preUpdate() runs before
        // GameScene.update(), so if we null path here, GameScene's trigger check
        // (`connection && plane.path && pathIndex >= path.length - 1`) sees null
        // and never calls startWaypointPassing. Keep the array alive so GameScene
        // can detect the exhausted state (pathIndex >= path.length - 1) and fire.
        if (!this.isApproachingWaypoint || this.isFollowingAirway) {
          this.path = null;
        }
      }
    }

    const currentAngle = this.rotation;
    this.rotation = lerpAngle(currentAngle, this.targetAngle, this.TURN_SPEED);

    this.updateShadowPosition();

    this.velocity.x = Math.cos(this.rotation) * this._currentSpeed;
    this.velocity.y = Math.sin(this.rotation) * this._currentSpeed;

    this.x += this.velocity.x;
    this.y += this.velocity.y;

    this.checkOffscreen();
    this.updateWarningVisual();
    this.updateOpacity(time);
  }

  private updateScaleAnimation(currentTime: number): void {
    if (!this.isAnimatingScale) return;

    const elapsed = currentTime - this.scaleAnimationStart;
    const progress = Math.min(elapsed / this.LEVEL_SCALE_DURATION_MS, 1);

    const startScale = this.baseScale;
    this.baseScale = startScale + (this.targetBaseScale - startScale) * progress;

    const finalScale = this.baseScale * this.textureScale;
    this.planeSprite.setScale(finalScale);
    this.undercoverSprite.setScale(finalScale);

    if (this.shadowSprite) {
      this.shadowSprite.setScale(finalScale * this.SHADOW_SCALE);
      this.updateShadowPosition();
    }

    if (progress >= 1) {
      this.baseScale = this.targetBaseScale;
      this.isAnimatingScale = false;
    }
  }

  /**
   * Parallel landing visual animation — two phases.
   *
   * Phase 1 — ROLL (threshold crossed, isLanding false):
   *   Scale 0.9→0.7, shadow fades first 30%, speed = LANDING_ROLL_SPEED.
   *
   * Phase 2 — STOP & FADE (startLanding called, isLanding true):
   *   Speed 0, 1 s fade-out, then isOffscreen = true → scored as landed.
   */
  private updateLandingScale(currentTime: number): void {
    if (!this._thresholdCrossed) return;

    // ── Phase 1: roll — scale while moving along runway path ─────────────────
    if (!this.isLanding) {
      if (this.landingScaleStartTime === 0) {
        this.landingScaleStartTime = currentTime;
      }
      const elapsed = currentTime - this.landingScaleStartTime;
      const progress = Math.min(elapsed / this.LANDING_SCALE_DURATION_MS, 1);
      const eased = 1 - (1 - progress) * (1 - progress);

      this.baseScale =
        this.LANDING_START_SCALE + (this.LANDING_END_SCALE - this.LANDING_START_SCALE) * eased;
      const scaledSize = this.baseScale * this.textureScale;
      this.planeSprite.setScale(scaledSize);
      // Fade main icon from 1.0 → 0.5 across the roll phase so opacity reduces
      // continuously through both phases (roll 1→0.5, fade-out 0.5→0).
      this.planeSprite.setAlpha(0.5);
      this.undercoverSprite.setScale(scaledSize);

      if (this.shadowSprite) {
        const shadowAlpha = Math.max(0, 1 - progress / 0.3) * 0.5;
        this.shadowSprite.setAlpha(shadowAlpha);
        this.shadowSprite.setScale(scaledSize * this.SHADOW_SCALE);
        this.updateShadowPosition();
      }
      return;
    }

    // ── Phase 2: stopped — 1 s fade-out then remove ──────────────────────────
    if (this._landingFadeStartTime === 0) {
      this._landingFadeStartTime = currentTime;
    }
    const fadeElapsed = currentTime - this._landingFadeStartTime;
    const fadeProgress = Math.min(fadeElapsed / this.LANDING_FADE_MS, 1);

    // Fade continues from 0.5 (end of roll) → 0. Multiply by 0.5 to align with
    // where Phase 1 left off so there's no opacity jump between phases.
    this.planeSprite.setAlpha(0.5 - fadeProgress * 0.5);
    this.undercoverSprite.setAlpha(0.5 - fadeProgress * 0.5);
    if (this.shadowSprite) {
      this.shadowSprite.setAlpha(0);
    }

    if (fadeProgress >= 1) {
      this.isOffscreen = true;
    }
  }

  private updateOpacity(time: number): void {
    if (this._thresholdCrossed) {
      // Opacity managed by updateLandingScale() — do not override here.
      return;
    } else if (this.isPassingWaypoint) {
      this.planeSprite.setAlpha(time % 400 > 200 ? 0.3 : 1.0);
    } else if (this.isDepartureDelayed) {
      this.planeSprite.setAlpha(time % 600 > 300 ? 0.6 : 1.0);
    } else if (this.isDepartureScaling) {
      this.planeSprite.setAlpha(0.7);
    } else if (this.isApproachingLanding || this.isApproachingWaypoint) {
      this.planeSprite.setAlpha(0.5);
    } else {
      this.planeSprite.setAlpha(1.0);
    }
  }

  private updateWarningVisual(): void {
    this.warningCircle.clear();

    if (this.warning) {
      if (!this.scene?.sys?.isActive()) return;
      const pulsePhase = (this.scene.time.now % 600) / 600;
      const opacity = 0.4 + Math.sin(pulsePhase * Math.PI * 2) * 0.3;

      const radius = this.getWarningRadius();

      // ✅ Scale line width by DPR
      this.warningCircle.lineStyle(scaleToDPR(3), 0xff8f00, opacity);
      this.warningCircle.fillStyle(0xff8f00, opacity * 0.2);
      this.warningCircle.strokeCircle(0, 0, radius);
      this.warningCircle.fillCircle(0, 0, radius);
    }
  }

  private checkOffscreen(): void {
    if (this.isFollowingAirway) return;
    // Guard: scene or cameras can be undefined after destruction or scene shutdown
    if (!this.scene?.cameras?.main) return;

    // this.x / this.y are world-local coordinates inside worldContainer.
    // Comparing them directly to camera.width/height (canvas-pixel space) is wrong —
    // the two spaces differ by worldScale (typically 1–3×).
    // Convert to screen space via the parent container's transform instead.
    const parent = this.parentContainer as Phaser.GameObjects.Container | null;
    let screenX: number;
    let screenY: number;
    let effectiveScale = 1;

    if (parent) {
      effectiveScale = parent.scaleX || 1;
      screenX = parent.x + this.x * effectiveScale;
      screenY = parent.y + this.y * (parent.scaleY || 1);
    } else {
      screenX = this.x;
      screenY = this.y;
    }

    const cam = this.scene.cameras.main;
    const margin = this.baseSize * 2 * effectiveScale;

    if (
      screenX < -margin ||
      screenX > cam.width + margin ||
      screenY < -margin ||
      screenY > cam.height + margin
    ) {
      this.isOffscreen = true;
    }
  }

  destroy(fromScene?: boolean): void {
    this.undercoverSprite.destroy();
    this.warningCircle.destroy();
    super.destroy(fromScene);
  }
}
