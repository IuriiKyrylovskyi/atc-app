/**
 * Aircraft view-model: one shape for an aircraft on the screen, whatever
 * produced it. Today that is the sim (`aircraftFromSim`); a live feed or a
 * replay gets its own adapter to the same `AircraftVM`, and the panels that
 * read it do not change.
 */
import type { AircraftState, TrafficOrigin, WakeCategory } from '@atc-app/sim';
import { flightLevel, heading3 } from './format';

export interface AircraftVM {
  callsign: string;
  /** ICAO type designator, e.g. "B739". */
  icaoType: string;
  wake: WakeCategory;
  squawk: string;
  destination?: string;
  /** Where the track comes from (scenario, live, …). */
  origin: TrafficOrigin;
  /** Current altitude, hundreds of feet: "160". */
  level: string;
  /** Cleared level while climbing or descending to it, else absent. */
  clearedLevel?: string;
  iasKt: number;
  gsKt: number;
  /** ".78". */
  mach: string;
  /** Magnetic heading, three digits. */
  heading: string;
  /** "DCT CRI ROBER" (next four fixes), "VECTORS", or absent. */
  route?: string;
  /** Approach clearance being flown: "ILS 22L LOC GS", "ILS 22L CLEARED". */
  approach?: string;
  /** True once established on the approach (localizer or glideslope). */
  established: boolean;
}

/** Lines of the selected-aircraft panel. */
export interface AircraftDetailVM {
  head: string;
  alt: string;
  spd: string;
  hdg: string;
  /** Route and / or approach, empty when neither. */
  nav: string;
}

const PHASE = { armed: 'CLEARED', localizer: 'LOC', glideslope: 'LOC GS' } as const;

/** Sim aircraft → view-model. `magVar` turns the sim's true heading into magnetic. */
export function aircraftFromSim(ac: AircraftState, magVar: number): AircraftVM {
  const t = ac.target;
  const next = [t.directFix, ...t.route].filter(Boolean).slice(0, 4).join(' ');
  const route = next ? `DCT ${next}` : t.headingTrue !== null ? 'VECTORS' : undefined;
  const level = flightLevel(ac.altFt);
  const cleared = flightLevel(t.altFt);
  return {
    callsign: ac.callsign,
    icaoType: ac.icaoType,
    wake: ac.wake,
    squawk: ac.squawk,
    ...(ac.destination ? { destination: ac.destination } : {}),
    origin: ac.origin,
    level,
    ...(cleared !== level ? { clearedLevel: cleared } : {}),
    iasKt: Math.round(ac.casKt),
    gsKt: Math.round(ac.gsKt),
    mach: ac.mach.toFixed(2).slice(1),
    heading: heading3(ac.headingTrue - magVar),
    ...(route ? { route } : {}),
    ...(t.approach
      ? { approach: `${t.approach.type} ${t.approach.runway} ${PHASE[t.approach.phase]}` }
      : {}),
    established: !!t.approach && t.approach.phase !== 'armed',
  };
}

export function aircraftDetail(vm: AircraftVM): AircraftDetailVM {
  return {
    head: [vm.callsign, `${vm.icaoType}/${vm.wake}`, vm.destination, `SQ ${vm.squawk}`]
      .filter(Boolean)
      .join('  '),
    alt: `ALT ${vm.level}${vm.clearedLevel ? ` → ${vm.clearedLevel}` : ''}`,
    spd: `IAS ${vm.iasKt}  GS ${vm.gsKt}  M${vm.mach}`,
    hdg: `HDG ${vm.heading}`,
    // Once established the route no longer matters, only the approach.
    nav: vm.established ? vm.approach! : [vm.route, vm.approach].filter(Boolean).join(' · '),
  };
}
