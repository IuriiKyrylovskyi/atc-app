/**
 * Traffic picture: what the scope keeps between radar sweeps.
 *
 * Each sweep delivers a sim `Snapshot`; the picture projects every aircraft to
 * local coordinates and keeps the last few positions as history dots, plus
 * per-track display settings (data block leader direction) that belong to the
 * controller, not the sim.
 */
import { normDeg, type AircraftState, type LocalXY, type Snapshot, type StereographicProjection } from '@atc-app/sim';

/**
 * Data block position around the target, numpad layout as on STARS / most
 * consoles: 7 8 9 above, 4 6 beside, 1 2 3 below. 5 is not a position.
 */
export type LeaderDirection = 1 | 2 | 3 | 4 | 6 | 7 | 8 | 9;
export const DEFAULT_LEADER: LeaderDirection = 9;

/** Screen-space unit direction for a leader position (screen y grows downwards). */
export function leaderVector(dir: LeaderDirection): { dx: number; dy: number } {
  const col = ((dir - 1) % 3) - 1; // -1, 0, 1
  const row = 1 - Math.floor((dir - 1) / 3); // 1 (bottom row) … -1 (top row)
  const len = Math.hypot(col, row) || 1;
  return { dx: col / len, dy: row / len };
}

export interface TrafficTrack {
  callsign: string;
  ac: AircraftState;
  xy: LocalXY;
  /** Previous sweep positions, newest first. */
  history: LocalXY[];
  leader: LeaderDirection;
}

export class TrafficPicture {
  private readonly tracks = new Map<string, TrafficTrack>();
  /** Sim time of the latest sweep, s. */
  t = 0;

  constructor(
    private readonly projection: StereographicProjection,
    private readonly historyLength = 10
  ) {}

  /** Applies one radar sweep. Aircraft missing from the snapshot are dropped. */
  update(snapshot: Snapshot): void {
    this.t = snapshot.t;
    const seen = new Set<string>();
    for (const ac of snapshot.aircraft) {
      seen.add(ac.callsign);
      const xy = this.projection.toLocal(ac.pos);
      const prev = this.tracks.get(ac.callsign);
      if (prev) {
        prev.history.unshift(prev.xy);
        if (prev.history.length > this.historyLength) prev.history.length = this.historyLength;
        prev.ac = ac;
        prev.xy = xy;
      } else {
        this.tracks.set(ac.callsign, { callsign: ac.callsign, ac, xy, history: [], leader: DEFAULT_LEADER });
      }
    }
    for (const cs of [...this.tracks.keys()]) if (!seen.has(cs)) this.tracks.delete(cs);
  }

  get(callsign: string): TrafficTrack | undefined {
    return this.tracks.get(callsign);
  }

  list(): TrafficTrack[] {
    return [...this.tracks.values()];
  }

  get size(): number {
    return this.tracks.size;
  }

  setLeader(callsign: string, dir: LeaderDirection): void {
    const t = this.tracks.get(callsign);
    if (t) t.leader = dir;
  }

  clear(): void {
    this.tracks.clear();
  }
}

/** Vertical speed (ft/min) below which the trend shows level. */
const LEVEL_FPM = 300;

const level = (ft: number) => String(Math.max(0, Math.round(ft / 100))).padStart(3, '0');

/**
 * Full data block, three lines:
 *   `DAL1192`
 *   `160↓110 29`  altitude (100 ft), trend, assigned level while climbing/descending, ground speed (10 kt)
 *   `B739 KJFK`   type, destination
 */
export function dataBlockLines(ac: AircraftState): [string, string, string] {
  const trend = ac.vsFpm > LEVEL_FPM ? '↑' : ac.vsFpm < -LEVEL_FPM ? '↓' : ' ';
  const assigned = Math.abs(ac.target.altFt - ac.altFt) >= 100 ? level(ac.target.altFt) : '';
  const gs = String(Math.round(ac.gsKt / 10)).padStart(2, '0');
  return [ac.callsign, `${level(ac.altFt)}${trend}${assigned} ${gs}`, [ac.icaoType, ac.destination].filter(Boolean).join(' ')];
}

/** Magnetic heading for readouts (sim headings are true). */
export const magneticHeading = (ac: AircraftState, magVar: number): number =>
  Math.round(normDeg(ac.headingTrue - magVar)) || 360;
