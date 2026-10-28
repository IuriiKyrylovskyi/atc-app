import {
  IStrip,
  strip,
  stripFieldSubtext,
  stripFieldSubtitle,
  stripFieldTitle,
  stripShift,
} from './strips';
import { shifts as shiftsData } from './shifts';
import { IAirfield } from './airfields';

const shifts = (airportId: string, isBlocked?: (shiftId: string) => boolean) =>
  shiftsData.map((shift) => stripShift(shift, false, isBlocked?.(shift.id)));

// ---- desktop ----
// center
export const shiftCenterStripsDesktop = (
  airfield: IAirfield,
  airportId: string,
  isBlocked?: (shiftId: string) => boolean
): IStrip[] => [
  stripFieldTitle(airfield),
  stripFieldSubtitle(airfield),
  stripFieldSubtext(airfield),
  ...shifts(airportId, isBlocked),
  strip('s9d'),
];

// ---- mobile ----
// !!! 14 strips in a column
// center
export const shiftCenterStripsPortraitMobile = (
  airfield: IAirfield,
  airportId: string,
  isBlocked?: (shiftId: string) => boolean
): IStrip[] => [
  strip('s1'),
  strip('s2'),
  stripFieldTitle(airfield),
  stripFieldSubtitle(airfield),
  stripFieldSubtext(airfield),
  strip('s6'),
  strip('s7'),
  ...shifts(airportId, isBlocked),
  strip('s13'),
  strip('s14'),
];

export const shiftCenterStripsLandscapeMobile = (
  airfield: IAirfield,
  airportId: string,
  isBlocked?: (shiftId: string) => boolean
): IStrip[] => [
  strip('s1m'),
  stripFieldTitle(airfield),
  stripFieldSubtitle(airfield),
  stripFieldSubtext(airfield),
  ...shifts(airportId, isBlocked),
];
