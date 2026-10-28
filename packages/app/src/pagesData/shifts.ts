import { SHIFTS, ENDLESS } from '@/game/config/level.structure';

export type ShiftType =
  | 'red-eye'
  | 'early-bird'
  | 'midday-mix'
  | 'evening-rush'
  | 'meltdown'
  | 'endless';

export interface IShift {
  id: ShiftType;
  name: string;
  text: string;
  number: number;
  icon1: string;
  icon2: string;
  iata?: string;
  isTraining?: boolean;
}

const shiftIcons: Record<number, { icon1: string; icon2: string }> = {
  0: { icon1: '', icon2: '' },
  1: { icon1: '', icon2: '' },
  2: { icon1: '', icon2: '' },
  3: { icon1: '', icon2: '' },
  4: { icon1: '', icon2: '' },
  5: { icon1: '', icon2: '' },
};

export const shifts: IShift[] = [
  ...SHIFTS.map((sh, i) => ({
    id: sh.id as ShiftType,
    name: sh.name,
    text: sh.blurb,
    number: i + 1,
    icon1: shiftIcons[i].icon1,
    icon2: shiftIcons[i].icon2,
  })),
  {
    id: ENDLESS.id as ShiftType,
    name: ENDLESS.name,
    text: ENDLESS.blurb,
    number: 6,
    icon1: shiftIcons[5].icon1,
    icon2: shiftIcons[5].icon2,
  },
];
