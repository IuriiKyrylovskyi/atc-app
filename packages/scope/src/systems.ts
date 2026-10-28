/**
 * ATC system profiles: how a given radar display system looks — map colours,
 * sector and area styling, track symbols, traffic colours by ownership, and
 * the label (data block) format. The scope renders the same picture through
 * whichever profile the controller selects.
 *
 * - `generic`: our default dark scope (STARS-like data block).
 * - `selex`: modelled on a Selex ES / Alenia (Leonardo) en-route display in
 *   service in Eastern Europe (reference photo, Ukraine ACC): mid-grey own
 *   airspace on lighter grey, dark airways and filled fix triangles, white
 *   sector borders, white "+" tracks, white labels for own traffic, cyan for
 *   incoming, the selected label in a black box with extended fields.
 * - `indra`: approximation of an Indra (SACTA / iTEC / AirCon 2100) display:
 *   dark blue-grey map, square tracks, white own / yellow incoming labels.
 *   Not yet calibrated against a reference image — colours and fields are
 *   placeholders to be tuned from a photo of the real system.
 *
 * Labels are built from the same aircraft data; only the layout differs.
 */
import type { AircraftState } from '@atc-app/sim';

/** Who handles the aircraft, from the active sector's point of view. */
export type Ownership = 'owned' | 'incoming' | 'other';

export interface LabelContext {
  ownership: Ownership;
  /** Sector the aircraft is in, if any. */
  sector?: string;
  /** Next fix of its route, if any. */
  nextFix?: string;
}

export interface MapStyle {
  /** Canvas background: outside the unit's airspace. */
  background: string;
  /** Fill of the unit's airspace (union of the sectors). */
  airspace: string;
  /** Fill of the active sector. */
  activeSector: string;
  sectorBorder: string;
  sectorBorderWidth: number;
  activeSectorBorder: string;
  activeSectorBorderWidth: number;
  sectorLabel: string;
  /** CTR / TMA fill and border. */
  terminalFill: string;
  terminalBorder: string;
  /** Restricted / danger / prohibited areas. */
  restrictedFill: string;
  restrictedBorder: string;
  ring: string;
  ringLabel: string;
  airway: string;
  waypoint: string;
  /** Filled triangles (Selex) or outlines. */
  waypointFilled: boolean;
  waypointLabel: string;
  navaid: string;
  navaidLabel: string;
  runway: string;
  centreline: string;
  airportLabel: string;
  scaleBar: string;
}

export interface TrafficStyle {
  symbol: 'dot' | 'cross' | 'square';
  owned: string;
  incoming: string;
  other: string;
  /** Selected track: plain colour, or a boxed label. */
  selected: string;
  selectedBox: { background: string; border: string; text: string } | null;
  /** Conflict alert / loss of separation. */
  alert: string;
  /** History dots, newest → oldest. */
  history: readonly string[];
  /** Normal label lines. */
  label(ac: AircraftState, ctx: LabelContext): string[];
  /** Label lines of the selected track (extended label). */
  selectedLabel(ac: AircraftState, ctx: LabelContext): string[];
}

export interface ScopeSystem {
  id: 'generic' | 'selex' | 'indra';
  name: string;
  description: string;
  /** CSS font for every text on the scope. */
  font: string;
  map: MapStyle;
  traffic: TrafficStyle;
}

// ── Label pieces ────────────────────────────────────────────────────────────
const LEVEL_FPM = 300;
export const fl3 = (ft: number) => String(Math.max(0, Math.round(ft / 100))).padStart(3, '0');
export const trendOf = (ac: AircraftState) => (ac.vsFpm > LEVEL_FPM ? '↑' : ac.vsFpm < -LEVEL_FPM ? '↓' : ' ');
const gs3 = (ac: AircraftState) => String(Math.round(ac.gsKt)).padStart(3, '0');
const assigned = (ac: AircraftState) => (Math.abs(ac.target.altFt - ac.altFt) >= 100 ? fl3(ac.target.altFt) : '');

/**
 * Generic (STARS-like) full data block:
 *   `DAL1192` / `160↓110 29` (level, trend, assigned while changing, GS in 10 kt) / `B739 KJFK`
 */
export function genericLabel(ac: AircraftState): string[] {
  const gs = String(Math.round(ac.gsKt / 10)).padStart(2, '0');
  return [ac.callsign, `${fl3(ac.altFt)}${trendOf(ac)}${assigned(ac)} ${gs}`, [ac.icaoType, ac.destination].filter(Boolean).join(' ')];
}

/**
 * Selex label: `UTH4457` / `350 370` (actual level, trend, cleared level — always
 * shown) / `G449` (ground speed, kt).
 */
export function selexLabel(ac: AircraftState): string[] {
  return [ac.callsign, `${fl3(ac.altFt)}${trendOf(ac).trim()} ${fl3(ac.target.altFt)}`, `G${gs3(ac)}`];
}

/** Selex extended label of the selected track (boxed): wake, sector, destination, speed, next point, type. */
export function selexSelectedLabel(ac: AircraftState, ctx: LabelContext): string[] {
  return [
    [ac.callsign, ac.wake, ctx.sector].filter(Boolean).join(' '),
    [`${fl3(ac.altFt)}${trendOf(ac).trim()}`, fl3(ac.target.altFt), ac.destination].filter(Boolean).join(' '),
    [`G${gs3(ac)}`, String(Math.round(ac.casKt)), ctx.nextFix].filter(Boolean).join(' '),
    [ac.icaoType, ac.squawk].join(' '),
  ];
}

/** Indra (approximation): `IBE3456` / `350↓220` / `A320 449`. */
export function indraLabel(ac: AircraftState): string[] {
  return [ac.callsign, `${fl3(ac.altFt)}${trendOf(ac).trim()}${fl3(ac.target.altFt)}`, `${ac.icaoType} ${gs3(ac)}`];
}

export function indraSelectedLabel(ac: AircraftState, ctx: LabelContext): string[] {
  return [
    [ac.callsign, ctx.sector].filter(Boolean).join(' '),
    `${fl3(ac.altFt)}${trendOf(ac).trim()}${fl3(ac.target.altFt)} ${Math.round(ac.casKt)}`,
    [ac.icaoType, ac.wake, gs3(ac)].join(' '),
    [ac.destination, ctx.nextFix].filter(Boolean).join(' '),
  ];
}

// ── Profiles ────────────────────────────────────────────────────────────────
export const GENERIC_SYSTEM: ScopeSystem = {
  id: 'generic',
  name: 'Generic',
  description: 'atc-app default dark scope, STARS-like data blocks',
  font: '11px ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  map: {
    background: '#0b1620',
    airspace: '#0e1c28',
    activeSector: '#13283a',
    sectorBorder: '#24465a',
    sectorBorderWidth: 1,
    activeSectorBorder: '#6fa8c8',
    activeSectorBorderWidth: 2,
    sectorLabel: '#4f7a92',
    terminalFill: 'rgba(60, 110, 170, 0.18)',
    terminalBorder: '#3a6a96',
    restrictedFill: 'rgba(170, 70, 60, 0.18)',
    restrictedBorder: '#a4554a',
    ring: '#1c3342',
    ringLabel: '#35596d',
    airway: '#21404f',
    waypoint: '#4f7386',
    waypointFilled: false,
    waypointLabel: '#5f8396',
    navaid: '#7fa3b5',
    navaidLabel: '#8fb0c0',
    runway: '#d8e4ea',
    centreline: '#3a5f72',
    airportLabel: '#a9bfca',
    scaleBar: '#5f8396',
  },
  traffic: {
    symbol: 'dot',
    owned: '#8fe3a8',
    incoming: '#5ce1e6',
    other: '#5f8396',
    selected: '#ffd27a',
    selectedBox: null,
    alert: '#ff5a4f',
    history: ['#5d8fae', '#4f7f9c', '#45718b', '#3c637a', '#34566a', '#2d4b5c', '#28414f', '#233944'],
    label: genericLabel,
    selectedLabel: genericLabel,
  },
};

export const SELEX_SYSTEM: ScopeSystem = {
  id: 'selex',
  name: 'Selex (Alenia)',
  description: 'Selex ES / Alenia (Leonardo) style: grey map, white own traffic, boxed selected label',
  font: '12px Arial, "Helvetica Neue", Helvetica, sans-serif',
  map: {
    background: '#a9adb0',
    airspace: '#71767a',
    activeSector: '#8a9094',
    sectorBorder: '#c3c7ca',
    sectorBorderWidth: 1,
    activeSectorBorder: '#ffffff',
    activeSectorBorderWidth: 2.5,
    sectorLabel: '#e6e8e9',
    terminalFill: 'rgba(78, 120, 205, 0.40)',
    terminalBorder: '#5b86d6',
    restrictedFill: 'rgba(150, 60, 60, 0.30)',
    restrictedBorder: '#9c3c3c',
    ring: '#7d8285',
    ringLabel: '#4a4f52',
    airway: '#3b3f42',
    waypoint: '#1b1d1f',
    waypointFilled: true,
    waypointLabel: '#2a2d30',
    navaid: '#1f2224',
    navaidLabel: '#1b1d1f',
    runway: '#f4f4f4',
    centreline: '#3b3f42',
    airportLabel: '#111315',
    scaleBar: '#1f2224',
  },
  traffic: {
    symbol: 'cross',
    owned: '#ffffff',
    incoming: '#55e2ee',
    other: '#2a2d30',
    selected: '#ffffff',
    selectedBox: { background: '#000000', border: '#ffffff', text: '#ffffff' },
    alert: '#ff3b30',
    history: ['#f4f4f4', '#e2e3e4', '#d0d2d3', '#bfc1c3', '#aeb1b3', '#9ea1a4', '#8f9295', '#818487'],
    label: selexLabel,
    selectedLabel: selexSelectedLabel,
  },
};

export const INDRA_SYSTEM: ScopeSystem = {
  id: 'indra',
  name: 'Indra (approx.)',
  description: 'Indra SACTA / iTEC style approximation: dark blue-grey map, square tracks — to be calibrated from a reference photo',
  font: '12px "DejaVu Sans Mono", Menlo, Consolas, monospace',
  map: {
    background: '#10161d',
    airspace: '#18222b',
    activeSector: '#203040',
    sectorBorder: '#3e5668',
    sectorBorderWidth: 1,
    activeSectorBorder: '#a8cfe6',
    activeSectorBorderWidth: 2,
    sectorLabel: '#7d97aa',
    terminalFill: 'rgba(70, 120, 160, 0.22)',
    terminalBorder: '#4f84ad',
    restrictedFill: 'rgba(180, 90, 40, 0.20)',
    restrictedBorder: '#c07a3a',
    ring: '#22303c',
    ringLabel: '#4a6274',
    airway: '#2c3c4a',
    waypoint: '#6f8797',
    waypointFilled: false,
    waypointLabel: '#6f8797',
    navaid: '#93aab9',
    navaidLabel: '#93aab9',
    runway: '#e2e8ec',
    centreline: '#3e5668',
    airportLabel: '#b9c7d0',
    scaleBar: '#6f8797',
  },
  traffic: {
    symbol: 'square',
    owned: '#ffffff',
    incoming: '#e9d36c',
    other: '#7d8b96',
    selected: '#e9d36c',
    selectedBox: { background: 'rgba(16, 22, 29, 0.92)', border: '#e9d36c', text: '#ffffff' },
    alert: '#ff4d3d',
    history: ['#c9d3da', '#b0bcc5', '#98a6b1', '#82919d', '#6d7d8a', '#5b6a77', '#4b5965', '#3e4a55'],
    label: indraLabel,
    selectedLabel: indraSelectedLabel,
  },
};

export const SCOPE_SYSTEMS: readonly ScopeSystem[] = [GENERIC_SYSTEM, SELEX_SYSTEM, INDRA_SYSTEM];

export const findSystem = (id: string | null | undefined): ScopeSystem =>
  SCOPE_SYSTEMS.find((s) => s.id === id) ?? GENERIC_SYSTEM;
