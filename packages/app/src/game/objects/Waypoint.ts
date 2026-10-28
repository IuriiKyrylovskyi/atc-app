// =============================================================================
// Waypoint.ts — ARCHITECTURE REFERENCE (read before ANY edit)
// =============================================================================
//
// ── COORDINATE SPACE ─────────────────────────────────────────────────────────
//
//   Waypoints live INSIDE worldContainer (world-local coords).
//   worldContainer is centred on screen: its position = (camW/2, camH/2).
//   Therefore world origin (0,0) = screen centre at all times.
//
//   GameScene.snapWaypointsToEdges() sets:
//     wp.setPosition(worldX, worldY)   ← world-local (range ±960 / ±540)
//     ← NO setScale() — worldContainer.scale is inherited by all children
//        so child.scaleX === 1 always. DO NOT use this.scaleX as a px-multiplier.
//
//   Planes also live in worldContainer → pathEnd from GameScene is world-local.
//   isPathEndInNeck() receives world-local pathEnd directly — no conversion needed.
//   GameScene does NOT call worldToScreen() before calling isPathEndInNeck().
//
//   DO NOT move waypoints out of worldContainer — all angle/detection math
//   assumes world origin = screen centre.
//
// ── ANGLES ───────────────────────────────────────────────────────────────────
//
//   getPerpendicularAngle():
//     returns atan2(-this.y, -this.x)
//     = direction FROM this waypoint TOWARD world origin (0,0) = screen centre
//     = "approachAngle" — the inbound corridor where planes fly from centre
//
//   exitAngle = approachAngle + π
//     = direction FROM waypoint AWAY from centre → toward/past screen edge
//
//   Example — waypoint snapped to left edge (wx≈-900, wy=0):
//     approachAngle = atan2(0, 900) = 0° (pointing right, toward centre) ✓
//     exitAngle     = 180° (pointing left, off-screen) ✓
//
//   DO NOT pass canvasWidth/canvasHeight to these methods — world centre is
//   always (0,0). The old screen-space formula atan2(camH/2−y, camW/2−x)
//   was equivalent but used screen coords. Now world coords are used directly.
//
// ── VISUAL LAYOUT (draw) ─────────────────────────────────────────────────────
//
//   All sizes are in DPR-scaled local/world units (scaleToDPR).
//   worldContainer.scale maps them to screen pixels automatically.
//   Screen size of any element = localSize × worldContainer.scale.
//   child.scaleX = 1 always — do NOT multiply BASE distances by scaleX.
//
//   1. Coloured triangles — INBOUND interception zone
//      Tip at BASE_START_DISTANCE from icon along approachAngle (toward centre).
//      Base fans out to (BASE_START_DISTANCE + neckLength) along approachAngle.
//      Wide opening faces screen centre so planes flying inward enter the funnel.
//      Multiple colours = nested coaxial triangles, each progressively shorter.
//
//   2. White exit line — OUTBOUND direction indicator
//      From icon outward along exitAngle. Clamped to world boundary so the
//      line ends exactly at the world edge regardless of waypoint position.
//
//   3. Central icon — concentric circles + crosshairs at (0,0)
//
// ── CHEVRONS (drawExitChevrons) ───────────────────────────────────────────────
//
//   Blinking chevrons at the outer rim of the neck (BASE_START_DISTANCE +
//   BASE_NECK_LENGTH from icon along approachAngle), pointing INWARD.
//   Tells the player "approach from this direction."
//   Called every frame from update(). No canvas params needed.
//
// ── DETECTION (isPathEndInNeck) ──────────────────────────────────────────────
//
//   pathEnd is WORLD-LOCAL (GameScene passes normalizedPath.last directly).
//   this.x/y is WORLD-LOCAL (set by snapWaypointsToEdges).
//   this.scaleX = 1 → BASE distances are already in world units, no multiplication.
//
//   Detection zone mirrors the visual triangle:
//     Radial:  [BASE_START_DISTANCE … BASE_START_DISTANCE + BASE_NECK_LENGTH]
//     Angular: |angle(pathEnd − wp) − approachAngle| ≤ TOLERANCE_DEGREES
//
//   Minimum = BASE_START_DISTANCE so the icon dead-zone (inside triangle tip)
//   correctly rejects hits. Matches the visual gap.
//   DO NOT remove the minimum check.
//   DO NOT multiply by scaleX — distances are world units, pathEnd is world units.
//
// ── REDRAW ───────────────────────────────────────────────────────────────────
//
//   draw() uses this.x/this.y to compute getPerpendicularAngle().
//   It MUST be called after snapWaypointsToEdges() moves the waypoint so
//   triangles point toward the correct direction from the snapped position.
//   GameScene calls wp.redraw() at the end of snapWaypointsToEdges().
//   DO NOT remove that call — without it, triangles point toward the original
//   config position (before edge-snap) and detection/visual will be misaligned.
//
// ── EXIT POINT ───────────────────────────────────────────────────────────────
//
//   getExitPoint() returns WORLD-LOCAL coords clamped to ±worldHalfW/H.
//   GameScene stores it directly as the plane's post-waypoint target.
//   worldHalfW/H are set by GameScene after construction (WORLD_W/2, WORLD_H/2).
//   DO NOT pass canvasWidth/canvasHeight — clamping is to world bounds now.
//
// ── PROJECTION CIRCLE ────────────────────────────────────────────────────────
//
//   drawProjections() in GameScene draws a circle at the waypoint position.
//   Because projectionGraphics is in scene space, it calls:
//     const wpScreen = this.worldToScreen(waypoint.x, waypoint.y);
//     fillCircle(wpScreen.x, wpScreen.y, radius)
//   This conversion is in GameScene, not here.
//
// ── CHANGE HISTORY ───────────────────────────────────────────────────────────
//
//   v1 — Scene-space waypoints
//     Waypoints were NOT inside worldContainer. setPosition() was screen-pixels,
//     setScale() was worldScale. All methods took canvasWidth/canvasHeight to
//     compute screen centre for angle/clamp math.
//     Bug: draw() ran in constructor with config position, not snapped position.
//     triangles pointed wrong direction until redraw() was added.
//
//   v2 (this file) — worldContainer children
//     Moved into worldContainer. World origin = screen centre = (0,0).
//     Removed canvasWidth/canvasHeight from all methods.
//     getPerpendicularAngle → atan2(-y, -x).
//     getExitPoint → clamps to ±worldHalfW/H instead of screen edges.
//     isPathEndInNeck → world-local pathEnd, no scaleX multiplication.
//     drawExitChevrons → no canvas params.
//     GameScene detection: passes pathEnd directly (no worldToScreen).
//     GameScene handlePointerUp: getExitPoint() already world-local (no screenToWorld).
//     GameScene drawProjections: converts waypoint.x/y to screen for fillCircle.
//     GameScene snapWaypointsToEdges: snaps to world-local edges, calls redraw().
//     GameScene shutdown: waypoints destroyed with worldContainer.
//
// =============================================================================

import Phaser from 'phaser';
import type { Point } from '@/types/game';
import { getDPR, scaleToDPR } from '@/game/utils/dprScale.helper';
import { DEPTH } from '@/game/constants/depth.constants';

export interface WaypointConfig {
  scene: Phaser.Scene;
  name: string;
  x: number;
  y: number;
  description?: string;
  color?: string;
  allowedColors?: string[];
}

export class Waypoint extends Phaser.GameObjects.Container {
  public name: string;
  public description?: string;
  public color: string;
  public allowedColors: string[];

  // Original world-local config coords (fraction→world conversion done by GameScene).
  // snapWaypointsToEdges() reads these to find the nearest world edge,
  // then calls setPosition() with the snapped world-local coords.
  // DO NOT use for rendering or detection — use this.x/this.y (snapped position).
  public worldLocalX: number = 0;
  public worldLocalY: number = 0;

  // World half-extents — set by GameScene after construction (WORLD_W/2, WORLD_H/2).
  // Required by getExitPoint() to clamp the exit ray to world boundaries.
  // DO NOT remove — without them getExitPoint() cannot clamp correctly.
  public worldHalfW: number = 960;
  public worldHalfH: number = 540;

  private graphics: Phaser.GameObjects.Graphics;
  private chevronGraphics: Phaser.GameObjects.Graphics;
  private nameText: Phaser.GameObjects.Text;
  private descriptionText: Phaser.GameObjects.Text | null = null;

  // ── Geometry (DPR-scaled world units) ────────────────────────────────────
  //
  // scaleToDPR() keeps sizes physically consistent across DPR levels.
  // worldContainer.scale maps world units → screen pixels.
  // child.scaleX = 1 always — do NOT multiply BASE values by scaleX.
  //
  // BASE_NECK_LENGTH:    visual triangle arm length in world units.
  // BASE_START_DISTANCE: offset from icon to triangle tip in world units.
  //   Detection minimum matches this so dead-zone = visual gap. DO NOT remove.
  // TOLERANCE_DEGREES = 22°. Touch paths have ~10-15° noise; 22° is tight but
  //   deliberate — lowering it helps beginners, raising it feels imprecise.
  // ─────────────────────────────────────────────────────────────────────────
  private readonly BASE_NECK_LENGTH: number;
  private readonly BASE_START_DISTANCE: number;
  private readonly TOLERANCE_DEGREES = 22;

  private dpr: number;

  constructor(config: WaypointConfig) {
    super(config.scene, config.x, config.y);

    this.name = config.name;
    this.description = config.description;
    this.color = config.color ?? 'blue';
    this.allowedColors = config.allowedColors ?? [this.color];

    this.dpr = getDPR();
    this.BASE_NECK_LENGTH = scaleToDPR(50);
    this.BASE_START_DISTANCE = scaleToDPR(15);

    // worldHalfW/H and final position/worldLocalX/Y set by GameScene after construction.
    // redraw() called by snapWaypointsToEdges() after setPosition() so draw()
    // computes angles from the snapped world-local position, not config position.

    this.graphics = this.scene.add.graphics();
    this.add(this.graphics);

    this.chevronGraphics = this.scene.add.graphics();
    this.add(this.chevronGraphics);

    const nameFontSize = Math.floor(scaleToDPR(16));
    this.nameText = this.scene.add.text(24, -26, this.name, {
      fontSize: `${nameFontSize}px`,
      fontFamily: 'Arial',
      color: '#ffffff',
      fontStyle: 'bold',
    });
    this.nameText.setOrigin(1, 0.5);
    this.add(this.nameText);

    if (this.description) {
      const descFontSize = Math.floor(scaleToDPR(14));
      this.descriptionText = this.scene.add.text(-20, 2, this.description, {
        fontSize: `${descFontSize}px`,
        fontFamily: 'Arial',
        color: '#9e9e9e',
        fontStyle: 'italic',
      });
      this.descriptionText.setOrigin(1, 0.5);
      this.add(this.descriptionText);
    }

    // Initial draw — angles computed from config position.
    // GameScene calls redraw() after snapWaypointsToEdges() for the correct angles.
    this.draw();

    this.scene.add.existing(this);
    this.setDepth(DEPTH.WAYPOINTS);
  }

  // Called by GameScene.snapWaypointsToEdges() after setPosition() so that
  // draw() recomputes angles from the final snapped world-local position.
  // DO NOT remove this call from snapWaypointsToEdges().
  public redraw(): void {
    this.draw();
  }

  private draw(): void {
    this.graphics.clear();

    // approachAngle: FROM this waypoint TOWARD world origin (0,0) = screen centre.
    // exitAngle:     opposite, away from centre toward screen edge (outbound).
    // See ANGLES section in file header.
    // DO NOT add canvasWidth/canvasHeight — world centre is always (0,0).
    const approachAngle = this.getPerpendicularAngle();
    const exitAngle = approachAngle + Math.PI; // TODO: set accepted interception angle on left/right side of inbound track to waipoint
    console.log('Waypoint draw:', this.name, approachAngle, exitAngle);

    // ── White exit line — OUTBOUND direction ──────────────────────────────────
    // Clamp to world boundary so the line always reaches the world edge.
    // Using getExitPoint() gives the correct visual length from any position.
    const exitPoint = this.getExitPoint();
    this.graphics.lineStyle(scaleToDPR(2), 0xffffff, 1);
    this.graphics.beginPath();
    this.graphics.moveTo(0, 0);
    // exitPoint is world-local; this.x/y is world-local → difference = local offset.
    this.graphics.lineTo(exitPoint.x - this.x, exitPoint.y - this.y);
    this.graphics.strokePath();

    // ── Coloured triangles — INBOUND interception zone ────────────────────────
    // Tip at BASE_START_DISTANCE from icon along approachAngle (toward centre).
    // Base fans at (currentStartDistance + currentNeckLength).
    // Nested: longest at i=0, progressively shorter.
    // Tip offset (BASE_START_DISTANCE) = visual gap = detection minimum.
    const tolerance = (this.TOLERANCE_DEGREES * Math.PI) / 180;
    const maxNecks = Math.min(3, this.allowedColors.length);

    for (let i = 0; i < maxNecks; i++) {
      const color = this.allowedColors[i];
      const colorHex = this.getColorHex(color);

      const startOffset = (i * this.BASE_NECK_LENGTH) / maxNecks;
      const currentStartDistance = this.BASE_START_DISTANCE + startOffset;

      const heightReduction = (i * this.BASE_NECK_LENGTH) / maxNecks;
      const currentNeckLength = this.BASE_NECK_LENGTH - heightReduction;

      this.graphics.lineStyle(scaleToDPR(2), colorHex, 1);
      this.graphics.fillStyle(colorHex, 0.3);

      this.graphics.beginPath();
      const angle1 = approachAngle + tolerance;
      const angle2 = approachAngle - tolerance;

      this.graphics.moveTo(
        Math.cos(approachAngle) * currentStartDistance,
        Math.sin(approachAngle) * currentStartDistance
      );
      this.graphics.lineTo(
        Math.cos(angle1) * (currentStartDistance + currentNeckLength),
        Math.sin(angle1) * (currentStartDistance + currentNeckLength)
      );
      this.graphics.lineTo(
        Math.cos(angle2) * (currentStartDistance + currentNeckLength),
        Math.sin(angle2) * (currentStartDistance + currentNeckLength)
      );
      this.graphics.closePath();
      this.graphics.fillPath();
      this.graphics.strokePath();
    }

    // ── Central icon ─────────────────────────────────────────────────────────
    const outerRadius = scaleToDPR(8);
    const innerRadius = scaleToDPR(4);
    const crosshairLength = scaleToDPR(7);

    this.graphics.lineStyle(scaleToDPR(1.5), 0xffffff, 1);
    this.graphics.strokeCircle(0, 0, outerRadius);
    this.graphics.strokeCircle(0, 0, innerRadius);
    this.graphics.beginPath();
    this.graphics.moveTo(-crosshairLength, 0);
    this.graphics.lineTo(crosshairLength, 0);
    this.graphics.moveTo(0, -crosshairLength);
    this.graphics.lineTo(0, crosshairLength);
    this.graphics.strokePath();
  }

  // Chevrons at the outer rim of the neck, pointing INBOUND toward the waypoint.
  // Rim position: BASE_START_DISTANCE + BASE_NECK_LENGTH from icon along approachAngle.
  // No canvas params — world centre is (0,0).
  drawExitChevrons(time: number): void {
    this.chevronGraphics.clear();

    // approachAngle: toward world centre (inbound approach axis).
    const approachAngle = this.getPerpendicularAngle();

    const blinkPhase = (time % 1500) / 1500;
    const blinkOpacity = 0.4 + Math.sin(blinkPhase * Math.PI * 2) * 0.3;

    const chevronWidth = scaleToDPR(15);
    const chevronHeight = scaleToDPR(25);
    const chevronSpacing = scaleToDPR(8);
    const chevronThickness = scaleToDPR(4);
    const maxChevrons = Math.min(3, this.allowedColors.length);

    // Outer rim of the neck: approach from this direction to enter the funnel.
    const neckRimDist = this.BASE_NECK_LENGTH + this.BASE_START_DISTANCE;
    const originLocalX = Math.cos(approachAngle) * neckRimDist;
    const originLocalY = Math.sin(approachAngle) * neckRimDist;

    // Chevrons point INWARD (toward the waypoint) = approachAngle + π
    const inboundAngle = approachAngle + Math.PI;

    this.chevronGraphics.save();
    this.chevronGraphics.translateCanvas(originLocalX, originLocalY);
    this.chevronGraphics.rotateCanvas(inboundAngle);

    for (let i = 0; i < maxChevrons; i++) {
      const color = this.allowedColors[i];
      const colorHex = this.getColorHex(color);
      const offsetX = i * (chevronWidth + chevronSpacing);

      this.chevronGraphics.lineStyle(chevronThickness, colorHex, blinkOpacity + 0.2);
      this.chevronGraphics.fillStyle(colorHex, blinkOpacity);

      this.chevronGraphics.beginPath();
      this.chevronGraphics.moveTo(offsetX - chevronWidth, -chevronHeight / 2);
      this.chevronGraphics.lineTo(offsetX, 0);
      this.chevronGraphics.lineTo(offsetX - chevronWidth, chevronHeight / 2);
      this.chevronGraphics.strokePath();
    }

    this.chevronGraphics.restore();
  }

  // Direction FROM this waypoint TOWARD world origin (0,0) = screen centre.
  // Used by draw(), drawExitChevrons(), isPathEndInNeck(). All three must agree.
  // DO NOT add canvasWidth/canvasHeight — equivalent to old atan2(camH/2−y, camW/2−x)
  // but world centre is simply (0,0) so no params needed.
  getPerpendicularAngle(): number {
    return Math.atan2(-this.y, -this.x);
  }

  // Returns world-local point where the exit ray crosses the nearest world boundary.
  // GameScene.handlePointerUp() stores this as the plane's post-waypoint target.
  // worldHalfW/H must be set by GameScene after construction — DO NOT skip that step.
  getExitPoint(): Point {
    const approachAngle = this.getPerpendicularAngle();
    const exitAngle = approachAngle + Math.PI;
    const maxDist = (this.worldHalfW + this.worldHalfH) * 2;

    let exitX = this.x + Math.cos(exitAngle) * maxDist;
    let exitY = this.y + Math.sin(exitAngle) * maxDist;

    // Clamp to world boundaries (±worldHalfW, ±worldHalfH).
    // Equivalent to the old screen-edge clamp but in world-local coords.
    if (exitX < -this.worldHalfW) {
      const t = (-this.worldHalfW - this.x) / (exitX - this.x);
      exitX = -this.worldHalfW;
      exitY = this.y + t * (exitY - this.y);
    } else if (exitX > this.worldHalfW) {
      const t = (this.worldHalfW - this.x) / (exitX - this.x);
      exitX = this.worldHalfW;
      exitY = this.y + t * (exitY - this.y);
    }

    if (exitY < -this.worldHalfH) {
      const t = (-this.worldHalfH - this.y) / (exitY - this.y);
      exitY = -this.worldHalfH;
      exitX = this.x + t * (exitX - this.x);
    } else if (exitY > this.worldHalfH) {
      const t = (this.worldHalfH - this.y) / (exitY - this.y);
      exitY = this.worldHalfH;
      exitX = this.x + t * (exitX - this.x);
    }

    return { x: exitX, y: exitY };
  }

  // pathEnd is WORLD-LOCAL — GameScene passes normalizedPath.last directly.
  // this.x/y is WORLD-LOCAL — set by snapWaypointsToEdges().
  // this.scaleX = 1 (worldContainer handles scaling) — do NOT multiply by scaleX.
  //
  // Detection zone mirrors the visual triangle:
  //   Radial:  [BASE_START_DISTANCE … BASE_START_DISTANCE + BASE_NECK_LENGTH] world units
  //   Angular: |angle(pathEnd−wp) − approachAngle| ≤ TOLERANCE_DEGREES
  //
  // Minimum = BASE_START_DISTANCE: rejects the icon dead-zone (gap between icon
  // and triangle tip). Matches the visual so detection ≡ what player sees.
  // DO NOT remove the minimum check.
  // DO NOT multiply BASE distances by scaleX — both sides are world units.
  isPathEndInNeck(pathEnd: Point): boolean {
    const approachAngle = this.getPerpendicularAngle();
    const tolerance = (this.TOLERANCE_DEGREES * Math.PI) / 180;

    const distanceToWaypoint = Phaser.Math.Distance.Between(pathEnd.x, pathEnd.y, this.x, this.y);

    // World-local units — scaleX = 1, no multiplication needed.
    const worldStartDist = this.BASE_START_DISTANCE;
    const worldNeckLength = this.BASE_NECK_LENGTH;

    if (
      distanceToWaypoint < worldStartDist ||
      distanceToWaypoint > worldStartDist + worldNeckLength
    ) {
      return false;
    }

    const angleToPathEnd = Math.atan2(pathEnd.y - this.y, pathEnd.x - this.x);
    const angleDiff = this.getAngleDifference(angleToPathEnd, approachAngle);

    return angleDiff <= tolerance;
  }

  private getAngleDifference(angle1: number, angle2: number): number {
    let diff = angle2 - angle1;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    return Math.abs(diff);
  }

  private getColorHex(colorName: string): number {
    const colors: { [key: string]: number } = {
      blue: 0x0078ff,
      green: 0x00c864,
      yellow: 0xffc800,
      pink: 0xff6496,
      violet: 0x9664ff,
      orange: 0xff9600,
    };
    return colors[colorName] || colors.blue;
  }

  update(time: number): void {
    if (!this.scene?.sys?.isActive()) return;
    this.drawExitChevrons(time);
  }

  destroy(fromScene?: boolean): void {
    this.graphics.destroy();
    this.chevronGraphics.destroy();
    super.destroy(fromScene);
  }
}
