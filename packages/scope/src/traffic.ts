/**
 * Traffic picture: what the scope keeps between radar sweeps.
 *
 * Each sweep delivers a sim `Snapshot`; the picture projects every aircraft to
 * local coordinates and keeps the last few positions as history dots, plus
 * per-track display settings that belong to the controller, not the sim:
 * data block leader direction, whether the route is shown, and the track's
 * ownership seen from the active sector.
 */
import {
  normDeg,
  type AircraftState,
  type Conflict,
  type LocalXY,
  type Snapshot,
  type StereographicProjection,
} from '@atc-app/sim';
import { ownershipOf, sectorOf, type MapArea } from './sectors';
import { genericLabel, type Ownership } from './systems';

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

/** Data block top-left relative to its target, screen px (y grows downwards). */
export interface LabelOffset {
  x: number;
  y: number;
}

export interface TrafficTrack {
  callsign: string;
  ac: AircraftState;
  xy: LocalXY;
  /** Previous sweep positions, newest first. */
  history: LocalXY[];
  leader: LeaderDirection;
  /**
   * Data block dragged by hand: its top-left corner relative to the target,
   * screen px. Overrides `leader` until a numpad direction is set again.
   */
  labelOffset?: LabelOffset;
  /** Seen from the active sector (all "owned" when no sector is active). */
  ownership: Ownership;
  /** Sector the aircraft is in, if any. */
  sector?: string;
  /** Route with ETOs shown (toggled by clicking the track symbol). */
  routeShown: boolean;
}

export class TrafficPicture {
  private readonly tracks = new Map<string, TrafficTrack>();
  /** Sim time of the latest sweep, s. */
  t = 0;
  /** Pairs in conflict alert at the latest sweep. */
  conflicts: Conflict[] = [];
  private sectors: readonly MapArea[] = [];
  private active: MapArea | null = null;

  constructor(
    private readonly projection: StereographicProjection,
    private readonly historyLength = 10
  ) {}

  /** Applies one radar sweep. Aircraft missing from the snapshot are dropped. */
  update(snapshot: Snapshot): void {
    this.t = snapshot.t;
    this.conflicts = snapshot.conflicts;
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
        this.tracks.set(ac.callsign, {
          callsign: ac.callsign, ac, xy, history: [], leader: DEFAULT_LEADER, ownership: 'owned', routeShown: false,
        });
      }
    }
    for (const cs of [...this.tracks.keys()]) if (!seen.has(cs)) this.tracks.delete(cs);
    this.reclassify();
  }

  /** Sets the unit's sectors and the active one (null = all sectors), and reclassifies. */
  setSectors(sectors: readonly MapArea[], activeId: string | null): void {
    this.sectors = sectors;
    this.active = sectors.find((s) => s.id === activeId) ?? null;
    this.reclassify();
  }

  private reclassify(): void {
    for (const t of this.tracks.values()) {
      t.ownership = ownershipOf(t.ac, t.xy, this.active);
      const s = sectorOf(t.ac, t.xy, this.sectors);
      if (s) t.sector = s.id;
      else delete t.sector;
    }
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
    if (!t) return;
    t.leader = dir;
    delete t.labelOffset;
  }

  /** Places the data block where it was dragged to. */
  setLabelOffset(callsign: string, offset: LabelOffset): void {
    const t = this.tracks.get(callsign);
    if (t) t.labelOffset = { x: offset.x, y: offset.y };
  }

  /** Shows / hides the route with ETOs; returns the new state. */
  toggleRoute(callsign: string): boolean {
    const t = this.tracks.get(callsign);
    if (!t) return false;
    t.routeShown = !t.routeShown;
    return t.routeShown;
  }

  clear(): void {
    this.tracks.clear();
    this.conflicts = [];
  }
}

/**
 * Generic full data block, three lines:
 *   `DAL1192`
 *   `160↓110 29`  altitude (100 ft), trend, assigned level while climbing/descending, ground speed (10 kt)
 *   `B739 KJFK`   type, destination
 */
export function dataBlockLines(ac: AircraftState): [string, string, string] {
  const [a, b, c] = genericLabel(ac);
  return [a!, b!, c!];
}

/** Magnetic heading for readouts (sim headings are true). */
export const magneticHeading = (ac: AircraftState, magVar: number): number =>
  Math.round(normDeg(ac.headingTrue - magVar)) || 360;
