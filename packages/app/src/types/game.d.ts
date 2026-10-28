// Shared TypeScript interfaces for the ATC-APP game layer.

import { PlaneTypeConfig, PlaneColor } from '@/game/config/planes.config';

export type { PlaneColor };

export interface Point {
  x: number;
  y: number;
}

export interface PlaneTypes {
  [id: number]: PlaneTypeConfig;
}

export interface RunwayConfig {
  id: string;
  rwNumber: string;
  oppositeRwNumber: string;
  // Two-endpoint form (primary — GameScene derives center/length/direction)
  masterX1?: number;
  masterY1?: number;
  masterX2?: number;
  masterY2?: number;
  masterWidth?: number;
  // Single-point form (legacy, deprecated)
  masterX?: number;
  masterY?: number;
  masterLength?: number;
  // Fraction fallback (legacy)
  centerX?: number;
  centerY?: number;
  direction?: number;
  length?: number;
  width?: number;
  allowedColors: string[];
  positionOverrides?: Record<string, { centerX: number; centerY: number }>;
}

export interface PlaneConfig {
  id: number;
  type: allowedPlaneTypes;
  width: number;
  height: number;
  speed: number;
}

export interface WaypointConfig {
  name: string;
  x: number;
  y: number;
  description: string;
  allowedColors: string[];
}

export interface LevelConfig {
  id: string;
  name: string;
  difficulty: 'easy' | 'normal' | 'hard';
  airfieldName?: string; // ICAO code or airport name (e.g., "EGLL", "KJFK") — links background image to real-world airdrome

  // Spawn limits — how many planes can be active on screen at once
  maxPlanes: number;
  minPlanes: number;
  spawnRate: number;

  /**
   * How many planes must be successfully handled (landed OR waypoint-passed)
   * for the level to be considered complete.
   *
   * Unhandled planes (flew off screen without a route) do NOT count.
   * Collided planes do NOT count.
   *
   * Once this quota is reached:
   *   1. No new planes are spawned
   *   2. The scene waits for remaining active planes to clear
   *   3. 'level:complete' is emitted → useGame → gameStore.completeLevel()
   */
  planesTarget: number;

  targetScore: number | null; // used for star rating; not a pass/fail gate
  timeLimit: number | null; // seconds; null = unlimited

  backgroundImage: string;
  allowedPlaneTypes?: allowedPlaneTypes[];
  minDepartureIntervalMs?: number;
  minRandomSpawnIntervalMs?: number;

  runways: RunwayConfig[];
  waypoints: WaypointConfig[];
}

export interface CollisionData {
  plane1Id: number;
  plane2Id: number;
  /** Midpoint of the two planes (CollisionSystem). */
  position?: { x: number; y: number };
  x?: number;
  y?: number;
}

export interface StatsUpdate {
  activePlanes: number;
  planesLanded: number;
  waypointPasses: number;
  planesTarget: number;
  conflicts: number;
}

/** 'game:init' payload. `levelId` is the level number when known; callers that
 *  only have the `[airport]:[shift]` id pass it as `levelKey` (or as levelId). */
export interface GameInitData {
  levelId?: number | string | null;
  levelKey?: string;
}

/** 'level:complete' payload emitted by GameScene. */
export interface LevelCompleteData {
  levelNumber: number;
  planesLanded: number;
  waypointPasses: number;
  planesTarget: number;
}

export interface ScoreUpdateData {
  score: number;
  delta?: number;
}

export interface PlaneData {
  id: number;
  x: number;
  y: number;
  color?: string;
}
