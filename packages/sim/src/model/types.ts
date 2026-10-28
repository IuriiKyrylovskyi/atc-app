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

export type FixKind = 'waypoint' | 'vor' | 'ndb' | 'dme' | 'rnav';

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

/** ARINC 424 path terminator; the FMS implements them in Phase 4. */
export type PathTerminator =
  | 'IF' | 'TF' | 'CF' | 'DF' | 'RF' | 'VA' | 'VM' | 'VI' | 'CA' | 'FA' | 'HM' | 'HA' | 'HF';

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
}

// ─── Events, snapshots ───────────────────────────────────────────────────────

export type SimEvent =
  | { t: number; type: 'aircraft_added'; callsign: string }
  | { t: number; type: 'aircraft_removed'; callsign: string }
  | { t: number; type: 'message_received'; message: Message; applyAt: number }
  | { t: number; type: 'clearance_applied'; callsign: string; clearance: Clearance }
  | { t: number; type: 'clearance_rejected'; callsign: string; clearance: Clearance; reason: string }
  | { t: number; type: 'message_rejected'; message: Message; reason: string }
  | { t: number; type: 'fix_reached'; callsign: string; fix: string };

/** What the scope receives every radar sweep. */
export interface Snapshot {
  /** Simulation time, seconds since session start. */
  t: number;
  aircraft: AircraftState[];
  /** Events since the previous snapshot. */
  events: SimEvent[];
}
