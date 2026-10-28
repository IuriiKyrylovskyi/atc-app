/**
 * Core data model shared by the simulator, the scope renderer, the voice layer and
 * the data importers. Everything here is plain JSON (no classes, no Dates) so it can
 * cross a worker / WebSocket boundary and be saved in snapshots and packs.
 */
import type { LatLon } from '../geo/geodesy';

export type { LatLon };

// ─── Airspace pack (static data, see ATC_ARCHITECTURE.md §4.2) ───────────────

export interface PackSource {
  name: string;
  /** SPDX id or short licence name, e.g. "Public-Domain", "ODbL-1.0". */
  licence: string;
  url: string;
  /** ISO date the data was retrieved. */
  retrieved: string;
}

export interface PackMeta {
  id: string;
  name: string;
  /** AIRAC cycle, e.g. "2611". */
  airac: string;
  /** Projection centre for the scope. */
  reference: LatLon;
  /** Charted magnetic variation for the area, degrees east (negative = west). */
  magVar: number;
  sources: PackSource[];
}

export interface Airport {
  icao: string;
  iata?: string;
  name: string;
  arp: LatLon;
  elevationFt: number;
  magVar?: number;
  transitionAltFt?: number;
  transitionLevel?: number;
}

export interface Runway {
  /** e.g. "04L". */
  id: string;
  airport: string;
  threshold: LatLon;
  end: LatLon;
  headingTrue: number;
  lengthM: number;
  widthM: number;
  thresholdElevFt: number;
  displacedM?: number;
  ils?: { courseTrue: number; glideslopeDeg: number; fafId?: string; tchFt?: number };
}

export type FixKind = 'waypoint' | 'vor' | 'ndb' | 'dme' | 'rnav' | 'runway' | 'airport';

export interface Fix {
  id: string;
  kind: FixKind;
  pos: LatLon;
}

export interface AltitudeConstraint {
  type: 'at' | 'atOrAbove' | 'atOrBelow' | 'between';
  ft: number;
  ft2?: number;
}

/** ARINC 424 path terminators (all 23); the FMS implements them in Phase 4. */
export const PATH_TERMINATORS = [
  'IF', 'TF', 'CF', 'DF', 'FA', 'FC', 'FD', 'FM', 'CA', 'CD', 'CI', 'CR',
  'RF', 'AF', 'VA', 'VD', 'VI', 'VM', 'VR', 'PI', 'HA', 'HF', 'HM',
] as const;
export type PathTerminator = (typeof PATH_TERMINATORS)[number];

export interface Leg {
  type: PathTerminator;
  fix?: string;
  courseTrue?: number;
  /** RF legs. */
  centre?: string;
  radiusNm?: number;
  altitude?: AltitudeConstraint;
  speedKt?: number;
  flyOver?: boolean;
  /** Required turn direction onto / within the leg. */
  turn?: TurnDirection;
  /** Leg / holding distance, NM. */
  distanceNm?: number;
  /** Holding leg time, minutes. */
  holdMinutes?: number;
  /** Recommended navaid (CF, FD, CD, AF …). */
  navaid?: string;
  /** Vertical path angle, degrees (negative = descending). */
  vpaDeg?: number;
  /** First leg of the missed approach and everything after it. */
  missedApproach?: boolean;
}

export interface Procedure {
  id: string;
  kind: 'SID' | 'STAR' | 'IAP';
  airport: string;
  runway?: string;
  transition?: string;
  legs: Leg[];
}

export interface Airway {
  id: string;
  segments: { from: string; to: string; minAltFt?: number; maxAltFt?: number }[];
}

export type AreaKind =
  | 'CTR' | 'TMA' | 'sector' | 'restricted' | 'danger' | 'prohibited' | 'TRA' | 'TSA';

export interface Area {
  id: string;
  kind: AreaKind;
  polygon: LatLon[];
  floorFt: number;
  ceilingFt: number;
}

export interface MvaArea {
  polygon: LatLon[];
  minAltFt: number;
}

export interface AirspacePack {
  meta: PackMeta;
  airports: Airport[];
  runways: Runway[];
  fixes: Fix[];
  airways?: Airway[];
  procedures?: Procedure[];
  areas?: Area[];
  mva?: MvaArea[];
}

// ─── Clearances (the only way to change an aircraft, §4.4) ───────────────────

export type TurnDirection = 'left' | 'right';

export type Clearance =
  | { kind: 'altitude'; altFt: number; vsFpm?: number }
  | { kind: 'heading'; headingMag: number; turn?: TurnDirection }
  | { kind: 'turn'; degrees: number; direction: TurnDirection }
  | { kind: 'speed'; casKt?: number; mach?: number }
  | { kind: 'direct'; fix: string }
  | { kind: 'squawk'; code: string }
  | { kind: 'resume_own_navigation' };

export interface Message {
  to: string;
  clearances: Clearance[];
  /** What the controller said / typed, for the log and debrief. */
  text?: string;
}

// ─── Aircraft ────────────────────────────────────────────────────────────────

export type TrafficOrigin = 'scenario' | 'synthetic' | 'live' | 'history';
export type WakeCategory = 'L' | 'M' | 'H' | 'J';

export interface AircraftTargets {
  altFt: number;
  /** True heading target; null while navigating to a fix. */
  headingTrue: number | null;
  turn: TurnDirection | null;
  casKt: number;
  mach: number | null;
  vsFpm: number | null;
  directFix: string | null;
  /**
   * Fixes still to fly after `directFix`, in order (a STAR or a cleared route).
   * Vectors keep it, so "resume own navigation" can rejoin it.
   */
  route: string[];
}

export interface AircraftState {
  callsign: string;
  icaoType: string;
  wake: WakeCategory;
  squawk: string;
  origin: TrafficOrigin;
  pos: LatLon;
  altFt: number;
  headingTrue: number;
  trackTrue: number;
  casKt: number;
  tasKt: number;
  gsKt: number;
  mach: number;
  vsFpm: number;
  /** Destination airport (ICAO), shown in the data block when known. */
  destination?: string;
  target: AircraftTargets;
}

/** What a new aircraft needs; everything else is derived. */
export interface AircraftSpawn {
  callsign: string;
  icaoType: string;
  wake?: WakeCategory;
  squawk?: string;
  origin?: TrafficOrigin;
  pos: LatLon;
  altFt: number;
  headingTrue: number;
  casKt: number;
  /** Fixes to fly in order; the aircraft turns direct to the first one. */
  route?: string[];
  /** Cleared altitude / speed if different from the current ones (e.g. descending on arrival). */
  clearedAltFt?: number;
  clearedCasKt?: number;
  destination?: string;
}

// ─── Events, snapshots ───────────────────────────────────────────────────────

export type SimEvent =
  | { t: number; type: 'aircraft_added'; callsign: string }
  | { t: number; type: 'aircraft_removed'; callsign: string }
  | { t: number; type: 'message_received'; message: Message; applyAt: number }
  | { t: number; type: 'clearance_applied'; callsign: string; clearance: Clearance }
  | { t: number; type: 'clearance_rejected'; callsign: string; clearance: Clearance; reason: string }
  | { t: number; type: 'message_rejected'; message: Message; reason: string }
  | { t: number; type: 'fix_reached'; callsign: string; fix: string }
  | { t: number; type: 'route_ended'; callsign: string; fix: string }
  /** STCA: loss of separation predicted within `inS` s (0 = already lost). */
  | { t: number; type: 'conflict_alert'; a: string; b: string; inS: number }
  | { t: number; type: 'separation_lost'; a: string; b: string; lateralNm: number; verticalFt: number }
  | {
      t: number;
      type: 'separation_restored';
      a: string;
      b: string;
      durationS: number;
      minLateralNm: number;
      minVerticalFt: number;
    }
  | { t: number; type: 'conflict_ended'; a: string; b: string };

/** A pair the separation monitor is alerting on. */
export interface Conflict {
  /** Callsigns, alphabetical. */
  a: string;
  b: string;
  kind: 'loss' | 'predicted';
  /** Seconds to the predicted loss (0 for a loss). */
  inS: number;
  lateralNm: number;
  verticalFt: number;
}

/** What the scope receives every radar sweep. */
export interface Snapshot {
  /** Simulation time, seconds since session start. */
  t: number;
  aircraft: AircraftState[];
  /** Pairs currently in conflict alert (predicted or lost separation). */
  conflicts: Conflict[];
  /** Events since the previous snapshot. */
  events: SimEvent[];
}
