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
 * - `indra`: modelled on an Indra (iTEC / SACTA) display (reference
 *   screenshot): navy own airspace on slate grey, teal unit boundary, dark-red
 *   sector lines, light-grey range arcs, small light-grey diamond fixes, bold
 *   monospace labels — green for own traffic with the exit / next point on top
 *   (`DODE` / `KLM733 440` / `270 270`), white two-line labels for others.
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
  /** Filled (Selex, Indra) or outline symbols. */
  waypointFilled: boolean;
  waypointShape: 'triangle' | 'diamond';
  waypointLabel: string;
  navaid: string;
  navaidLabel: string;
  runway: string;
  centreline: string;
  airportLabel: string;
  scaleBar: string;
}

export interface TrafficStyle {
  symbol: 'dot' | 'cross' | 'square' | 'ring';
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

/**
 * Indra label. Own traffic: `DODE` (next point) / `KLM733 440` (callsign, ground
 * speed) / `270 270` (actual and cleared level). Others: the last two lines only.
 */
export function indraLabel(ac: AircraftState, ctx: LabelContext): string[] {
  const lines = [`${ac.callsign} ${gs3(ac)}`, `${fl3(ac.altFt)}${trendOf(ac).trim()} ${fl3(ac.target.altFt)}`];
  return ctx.ownership === 'owned' && ctx.nextFix ? [ctx.nextFix, ...lines] : lines;
}

/** Indra selected label: adds type / wake, destination, speed and sector. */
export function indraSelectedLabel(ac: AircraftState, ctx: LabelContext): string[] {
  return [
    ...(ctx.nextFix ? [ctx.nextFix] : []),
    `${ac.callsign} ${gs3(ac)} ${ac.icaoType}/${ac.wake}`,
    [`${fl3(ac.altFt)}${trendOf(ac).trim()}`, fl3(ac.target.altFt), ac.destination].filter(Boolean).join(' '),
    [String(Math.round(ac.casKt)), ctx.sector].filter(Boolean).join(' '),
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
    waypointShape: 'triangle',
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
    waypointShape: 'triangle',
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
  name: 'Indra',
  description: 'Indra iTEC / SACTA style: navy map, teal unit boundary, green own traffic with next point, white others',
  font: 'bold 12px "DejaVu Sans Mono", Menlo, Consolas, monospace',
  map: {
    background: '#2c333d',
    airspace: '#0b0f2c',
    activeSector: '#121a46',
    sectorBorder: '#6a1f31',
    sectorBorderWidth: 1,
    activeSectorBorder: '#2fb6c0',
    activeSectorBorderWidth: 2,
    sectorLabel: '#8a93ad',
    terminalFill: 'rgba(40, 140, 155, 0.14)',
    terminalBorder: '#2a9ca8',
    restrictedFill: 'rgba(120, 30, 48, 0.22)',
    restrictedBorder: '#8a2638',
    ring: '#6c7593',
    ringLabel: '#8a93ad',
    airway: '#59648a',
    waypoint: '#c6cad6',
    waypointFilled: true,
    waypointShape: 'diamond',
    waypointLabel: '#b6bbca',
    navaid: '#c6cad6',
    navaidLabel: '#b6bbca',
    runway: '#e6e8ee',
    centreline: '#59648a',
    airportLabel: '#d0d4de',
    scaleBar: '#8a93ad',
  },
  traffic: {
    symbol: 'ring',
    owned: '#5cd65a',
    incoming: '#f2c14e',
    other: '#e6e8ee',
    selected: '#5cd65a',
    selectedBox: { background: 'rgba(11, 15, 44, 0.94)', border: '#5cd65a', text: '#ffffff' },
    alert: '#ff4d3d',
    history: ['#c6cad6', '#adb2c2', '#959baf', '#7f869c', '#6b738a', '#5a6178', '#4b5167', '#3e4357'],
    label: indraLabel,
    selectedLabel: indraSelectedLabel,
  },
};

export const SCOPE_SYSTEMS: readonly ScopeSystem[] = [GENERIC_SYSTEM, SELEX_SYSTEM, INDRA_SYSTEM];

export const findSystem = (id: string | null | undefined): ScopeSystem =>
  SCOPE_SYSTEMS.find((s) => s.id === id) ?? GENERIC_SYSTEM;
