import Phaser from 'phaser';
import type { Point } from '@/types/game';
import { DEPTH } from '@/game/constants/depth.constants';

/**
 * Runway object with DPR scaling for high-resolution displays
 */

export interface RunwayConfig {
  scene: Phaser.Scene;
  id: string;
  rwNumber?: string;
  oppositeRwNumber?: string;
  centerX: number;
  centerY: number;
  direction: number;
  length?: number;
  width?: number;
  angleTolerance?: number;
  color?: string;
  allowedColors?: string[];
}

export class Runway extends Phaser.GameObjects.Container {
  public id: string;
  public rwNumber: string;
  public oppositeRwNumber: string;
  public centerX: number;
  public centerY: number;
  public direction: number;
  public length: number; // DPR-scaled
  public width: number; // DPR-scaled
  public angleTolerance: number;
  public color: string;
  public allowedColors: string[];

  // Key points
  public landingPoint: Point;
  public departurePoint: Point;
  /** 40% of halfLength inward from the landing threshold — where the landing roll ends. */
  public landingRollPoint: Point;
  public landingApproachPoint: Point;
  public landingApproachAngle: number;
  public departureAngle: number;

  // Graphics
  private graphics: Phaser.GameObjects.Graphics;
  private chevronGraphics: Phaser.GameObjects.Graphics;

  // Chevron throttle — only redraw when the blink step changes (~10 redraws/s)
  // drawChevrons() uses a 1500 ms period divided into 15 discrete steps (100 ms each).
  // At 60 fps that's ~6 skipped draws per visible change — imperceptible, big CPU saving.
  private _lastBlinkStep: number = -1;

  constructor(config: RunwayConfig) {
    super(config.scene, config.centerX, config.centerY);
    console.log(`Creating Runway: ${config.scene}`, config);
    this.id = config.id;
    this.rwNumber = config.rwNumber || '';
    this.oppositeRwNumber = config.oppositeRwNumber || '';
    this.centerX = config.centerX;
    this.centerY = config.centerY;
    this.direction = config.direction;

    // Length/width are plain world units — do NOT scale by DPR here.
    // worldContainer's own scale (computeWorldScale in WorldTransform.ts)
    // already includes DPR, since camera.width/height are DPR-inclusive
    // physical pixels. Scaling again here double-counted it — on a 2x DPR
    // screen the runway rendered roughly 2x too large relative to
    // everything else in world-units (planes, waypoints, the background).
    this.length = config.length ?? 200;
    this.width = config.width ?? 16;

    // Scale is inherited from worldContainer — no explicit setScale needed.

    this.angleTolerance = config.angleTolerance ?? Math.PI / 8;
    this.color = config.color ?? 'blue';
    this.allowedColors = config.allowedColors ?? [this.color];

    // Calculate key points (using DPR-scaled dimensions)
    const halfLength = this.length / 2;

    this.landingPoint = {
      x: -Math.cos(this.direction) * halfLength,
      y: -Math.sin(this.direction) * halfLength,
    };

    // Landing roll endpoint: 40% of full runway length from the threshold.
    // threshold is at -halfLength, so roll endpoint = -halfLength + 0.4*(2*halfLength)
    //   = -halfLength * 0.2 from center.
    // Roll distance from threshold = 0.4 * length, keeping the zone clear of
    // departurePoint (center) by 20% of halfLength.
    this.landingRollPoint = {
      x: -Math.cos(this.direction) * halfLength * 0.2,
      y: -Math.sin(this.direction) * halfLength * 0.2,
    };

    this.departurePoint = {
      x: 0,
      y: 0,
    };

    // Approach distance in plain world units — see note above on why DPR
    // scaling is applied once, by worldContainer, not here.
    const approachDistance = 50;
    this.landingApproachPoint = {
      x: this.landingPoint.x - Math.cos(this.direction) * approachDistance,
      y: this.landingPoint.y - Math.sin(this.direction) * approachDistance,
    };

    this.landingApproachAngle = this.direction;
    this.departureAngle = this.direction;

    // Create graphics
    this.graphics = this.scene.add.graphics();
    this.add(this.graphics);

    this.chevronGraphics = this.scene.add.graphics();
    this.add(this.chevronGraphics);

    this.draw();

    // NOTE: do NOT call scene.add.existing(this) here.
    // GameScene adds this Runway to worldContainer via worldContainer.add(runway),
    // which handles display list registration automatically.
    this.setDepth(DEPTH.RUNWAYS);
  }

  private draw(): void {
    this.graphics.clear();
    this.graphics.save();
    this.graphics.translateCanvas(0, 0);
    this.graphics.rotateCanvas(this.direction);

    const halfLength = this.length / 2;
    const halfWidth = this.width / 2;

    // ✅ Plain world unit — see DPR note in constructor
    const stopwayLength = 30;

    // Draw stopway zone
    this.graphics.fillStyle(0x2a2a35, 1);
    this.graphics.fillRect(-halfLength - stopwayLength, -halfWidth, stopwayLength, this.width);

    // ✅ Plain world units — see DPR note in constructor
    this.graphics.lineStyle(2, 0xffc800, 0.6);
    for (let i = 0; i < 3; i++) {
      const xOffset = -halfLength - stopwayLength + (i + 0.5) * (stopwayLength / 3);
      const chevronSize = 8;
      this.graphics.beginPath();
      this.graphics.moveTo(xOffset - chevronSize, -halfWidth * 0.6);
      this.graphics.lineTo(xOffset, -halfWidth * 0.3);
      this.graphics.lineTo(xOffset - chevronSize, 0);
      this.graphics.moveTo(xOffset - chevronSize, halfWidth * 0.6);
      this.graphics.lineTo(xOffset, halfWidth * 0.3);
      this.graphics.lineTo(xOffset - chevronSize, 0);
      this.graphics.strokePath();
    }

    // Draw asphalt
    this.graphics.fillStyle(0x394154, 1);
    this.graphics.fillRect(-halfLength, -halfWidth, this.length, this.width);

    // Plain world unit — see DPR note in constructor
    const noiseSize = 1.5;
    for (let i = 0; i < 50; i++) {
      const x = -halfLength + Math.random() * this.length;
      const y = -halfWidth + Math.random() * this.width;
      const size = Math.random() * noiseSize;
      const color = Math.random() > 0.5 ? 0x1a1a1a : 0x3a3a3a;
      this.graphics.fillStyle(color, 0.3);
      this.graphics.fillCircle(x, y, size);
    }

    // Plain world unit — see DPR note in constructor
    const shoulderHeight = 3;
    this.graphics.fillStyle(0x4a4a4a, 1);
    this.graphics.fillRect(-halfLength, -halfWidth - shoulderHeight, this.length, shoulderHeight);
    this.graphics.fillRect(-halfLength, halfWidth, this.length, shoulderHeight);

    // ✅ Scale font size by DPR
    const fontSize = Math.floor(this.width * 0.5);
    this.graphics.fillStyle(0xffffff, 0.95);

    // Runway number text must be positioned in container-local space (unrotated),
    // NOT in the rotated graphics canvas space.  The graphics context has
    // rotateCanvas(direction) applied, but Text objects added to this Container
    // live in container-local (unrotated) coordinates.
    //
    // To place text at a point that is (rx, ry) in the rotated runway frame,
    // rotate that point back to container-local space:
    //   cx = rx * cos(θ) − ry * sin(θ)
    //   cy = rx * sin(θ) + ry * cos(θ)
    //
    // Landing end: rx = −halfLength + width*1.5  (just inside threshold), ry = 0
    // Departure end: rx = halfLength − width*1.5,  ry = 0
    const cos = Math.cos(this.direction);
    const sin = Math.sin(this.direction);

    // Landing end text (near the threshold where planes touch down)
    const lrx = -halfLength + this.width * 1.5;
    const landingText = this.scene.add.text(lrx * cos, lrx * sin, this.rwNumber, {
      fontSize: `${fontSize}px`,
      fontFamily: 'Arial',
      color: '#ffffff',
      fontStyle: 'bold',
    });
    landingText.setOrigin(0.5, 0.5);
    landingText.setRotation(this.direction + Math.PI / 2);
    this.add(landingText);

    // Departure end text (opposite threshold)
    const drx = halfLength - this.width * 1.5;
    const departureText = this.scene.add.text(drx * cos, drx * sin, this.oppositeRwNumber, {
      fontSize: `${fontSize}px`,
      fontFamily: 'Arial',
      color: '#ffffff',
      fontStyle: 'bold',
    });
    departureText.setOrigin(0.5, 0.5);
    departureText.setRotation(this.direction - Math.PI / 2);
    this.add(departureText);

    // Draw threshold markings (scaled)
    const thresholdWidth = this.width * 0.12;
    const thresholdLength = this.width * 0.8;
    const thresholdSpacing = this.width * 0.18;
    const numThresholds = Math.min(6, Math.floor(this.width / thresholdSpacing));

    this.graphics.fillStyle(0xffffff, 0.95);

    // Landing threshold
    for (let i = 0; i < numThresholds; i++) {
      const offset = (i - (numThresholds - 1) / 2) * thresholdSpacing;
      this.graphics.fillRect(
        -halfLength + this.width * 0.15,
        offset - thresholdWidth / 2,
        thresholdLength,
        thresholdWidth
      );
    }

    // Departure threshold
    for (let i = 0; i < numThresholds; i++) {
      const offset = (i - (numThresholds - 1) / 2) * thresholdSpacing;
      this.graphics.fillRect(
        halfLength - this.width * 0.15 - thresholdLength,
        offset - thresholdWidth / 2,
        thresholdLength,
        thresholdWidth
      );
    }

    // Draw centerline (scaled)
    const centerlineStartOffset = this.width * 2;
    this.graphics.lineStyle(this.width * 0.1, 0xffffff, 0.95);

    const dashLength = this.length * 0.02;
    const gapLength = this.length * 0.03;
    let currentX = -halfLength + centerlineStartOffset;
    const endX = halfLength - centerlineStartOffset;

    while (currentX < endX) {
      this.graphics.beginPath();
      this.graphics.moveTo(currentX, 0);
      this.graphics.lineTo(Math.min(currentX + dashLength, endX), 0);
      this.graphics.strokePath();
      currentX += dashLength + gapLength;
    }

    // Draw tire marks
    this.graphics.fillStyle(0x0a0a0a, 0.3);
    this.graphics.fillRect(
      -halfLength * 0.3,
      -this.width * 0.08,
      halfLength * 1.2,
      this.width * 0.03
    );
    this.graphics.fillRect(
      -halfLength * 0.3,
      this.width * 0.05,
      halfLength * 1.2,
      this.width * 0.03
    );

    this.graphics.restore();
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

  getLandingPointWorld(): Point {
    // Runway is inside worldContainer; x/y are world-local coords.
    // Return world-local position of the landing point — matches plane path coords.
    return {
      x: this.x + this.landingPoint.x,
      y: this.y + this.landingPoint.y,
    };
  }

  getLandingRollPointWorld(): Point {
    return {
      x: this.x + this.landingRollPoint.x,
      y: this.y + this.landingRollPoint.y,
    };
  }

  getDeparturePointWorld(): Point {
    return {
      x: this.x + this.departurePoint.x,
      y: this.y + this.departurePoint.y,
    };
  }

  drawChevrons(time: number): void {
    this.chevronGraphics.clear();

    // Each chevron blinks independently with a small phase offset per slot,
    // matching the colored-arrow blink style used before.
    const period = 1500;
    const maxChevrons = Math.min(3, this.allowedColors.length);

    // Plain world units — see DPR note in constructor
    const chevronWidth = 14;
    const chevronHeight = 25;
    const chevronThickness = 3.5;

    this.chevronGraphics.save();
    // chevronGraphics is a Container child — origin is runway center (container-local).
    // Translate to the landing threshold, then rotate into runway-frame space.
    this.chevronGraphics.translateCanvas(this.landingPoint.x, this.landingPoint.y);
    this.chevronGraphics.rotateCanvas(this.direction);

    for (let i = 0; i < maxChevrons; i++) {
      const color = this.allowedColors[i];
      const colorHex = this.getColorHex(color);

      // Stagger phase by 500 ms per slot so colors blink in sequence.
      const phase = ((time + i * 500) % period) / period;
      const opacity = 0.4 + Math.sin(phase * Math.PI * 2) * 0.35;

      // Chevrons stack leftward (into the stopway) from the threshold.
      const offsetX = -(i + 0.5) * (chevronWidth * 1.4);

      // V shape: two diagonal strokes meeting at a centre tip.
      this.chevronGraphics.lineStyle(chevronThickness, colorHex, Math.min(1, opacity + 0.25));

      this.chevronGraphics.beginPath();
      this.chevronGraphics.moveTo(offsetX - chevronWidth, -chevronHeight / 2);
      this.chevronGraphics.lineTo(offsetX, 0);
      this.chevronGraphics.lineTo(offsetX - chevronWidth, chevronHeight / 2);
      this.chevronGraphics.strokePath();
    }

    this.chevronGraphics.restore();
  }

  update(time: number): void {
    // Throttle: 1500 ms blink period split into 15 steps → one redraw per 100 ms (~10/s).
    // At 60 fps this skips ~5 out of 6 drawChevrons calls with zero visual difference.
    const blinkStep = Math.floor((time % 1500) / 100);
    if (blinkStep === this._lastBlinkStep) return;
    this._lastBlinkStep = blinkStep;
    this.drawChevrons(time);
  }

  destroy(fromScene?: boolean): void {
    this.graphics.destroy();
    this.chevronGraphics.destroy();
    super.destroy(fromScene);
  }
}
