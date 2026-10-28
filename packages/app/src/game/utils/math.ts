import type { Point } from '@/types/game';

/**
 * Math utilities for game calculations
 */

/**
 * Linearly interpolate between two angles (shortest path)
 */
export function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  if (diff > Math.PI) diff -= 2 * Math.PI;
  if (diff < -Math.PI) diff += 2 * Math.PI;
  return a + diff * t;
}

/**
 * Calculate distance between two points
 */
export function getDistance(p1: Point, p2: Point): number {
  return Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);
}

/**
 * Calculate squared distance (faster, for comparisons)
 */
export function getDistanceSquared(p1: Point, p2: Point): number {
  return (p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2;
}

/**
 * Calculate angle from point A to point B
 */
export function getAngleBetweenPoints(from: Point, to: Point): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

/**
 * Clamp a value between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Linear interpolation
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Check if point is within circle
 */
export function isPointInCircle(point: Point, center: Point, radius: number): boolean {
  return getDistanceSquared(point, center) < radius * radius;
}

/**
 * Generate random number between min and max
 */
export function randomRange(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

/**
 * Generate random integer between min and max (inclusive)
 */
export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Normalize a vector
 */
export function normalize(x: number, y: number): { x: number; y: number } {
  const length = Math.sqrt(x * x + y * y);
  if (length === 0) return { x: 0, y: 0 };
  return { x: x / length, y: y / length };
}

/**
 * Check if a point is within canvas bounds
 */
export function isPointInBounds(
  point: Point,
  width: number,
  height: number,
  margin: number = 0
): boolean {
  return (
    point.x >= -margin &&
    point.x <= width + margin &&
    point.y >= -margin &&
    point.y <= height + margin
  );
}
