export type TrafficMode = 'wpt-only' | 'rw-only' | 'combined';

export interface LevelSettings {
  levelId: string;
  levelNumber: number;
  trafficDensity: number;
  trafficMode: TrafficMode;
  starPointsEnabled: boolean;
  emergencyTrafficEnabled: boolean;
  planeSpeedModifier: number;
}
