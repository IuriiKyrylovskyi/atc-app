export interface IAirfield {
  icao?: string;
  iata?: string;
  number?: number;
  name?: string;
  // Legacy / training data names the strip by `field` and orders it by `levelNumber`.
  field?: string;
  levelNumber?: number;
  subtext?: string;
  isPremium?: boolean;
  isTraining?: boolean;
  icon1?: string;
  icon2?: string;
  cityIcon1?: string;
  cityIcon2?: string;
}

export const airfields: Record<string, IAirfield> = {
  // London city (level-1)
  'EGLC-legacy': {
    field: 'EGLC-legacy',
    subtext: 'London City Airport (LCY), GB',
    levelNumber: 1,
    isPremium: false,
    icon1: '',
    icon2: '',
  },
  'MMTG/KSDM': {
    field: 'MMTG/KSDM',
    subtext: 'Tijuana (TIJ), Mexico/Brown Field Municipal Airport (SDM), USA',
    levelNumber: 2,
    isPremium: false,
    icon1: '',
    icon2: '',
  },
  EGLC: {
    field: 'EGLC',
    subtext: 'London City Airport (LCY), GB',
    levelNumber: 3,
    isPremium: false,
    icon1: '',
    icon2: '',
  },
  LPPT: {
    field: 'LPPT',
    subtext: 'Humberto Delgado Airport (LIS), Lisbon, Portugal',
    levelNumber: 4,
    isPremium: true,
    icon1: '',
    icon2: '',
  },
  'OMDB/OMAD': {
    field: 'OMDB/OMAD',
    subtext: 'Dubai International (DXB)/Sharjah International Airport (SHJ), UAE',
    levelNumber: 5,
    isPremium: true,
    icon1: '',
    icon2: '',
  },
  WADD: {
    field: 'WADD',
    subtext: 'Gusti Ngurah Rai International Airport (DPS), Indonesia, Bali',
    levelNumber: 6,
    isPremium: true,
    icon1: '',
    icon2: '',
  },
  KSAN: {
    field: 'KSAN',
    subtext: 'San Diego International Airport (Lindbergh Field, SAN), San Diego, USA',
    levelNumber: 7,
    isPremium: true,
    icon1: '',
    icon2: '',
  },

  // training levels
  'EGLC / Basic Vectoring': {
    field: 'EGLC / Basic Vectoring',
    subtext: `Telling a pilot which way to steer—like guiding a bicycle by whispering "turn a little left" so you don't bump into anyone!`,
    levelNumber: 1,
    isPremium: false,
    isTraining: true,
    icon1: '',
    icon2: '',
  },
  'EGLC / Approach handling': {
    field: 'EGLC / Approach handling',
    subtext:
      'Guiding airplanes safely down from the big sky like a parking lot attendant helping cars line up one by one to land at the airport!',
    levelNumber: 2,
    isPremium: false,
    isTraining: true,
    icon1: '',
    icon2: '',
  },
  'EGLC / Enroute Handling': {
    field: 'EGLC / Enroute Handling',
    subtext:
      'Giving a pilot a magic signpost in the sky and saying, "Fly right to this spot!" so they never get lost on their big road trip.',
    levelNumber: 3,
    isPremium: false,
    isTraining: true,
    icon1: '',
    icon2: '',
  },
  'EGLC / Vertical Separation': {
    field: 'EGLC / Vertical Separation',
    subtext:
      'Stacking airplanes on top of each other like bunk beds—keeping one flying high up in the clouds and another lower down so they never bump heads!',
    levelNumber: 4,
    isPremium: false,
    isTraining: true,
    icon1: '',
    icon2: '',
  },
  'EGLC / Speed Adjustment': {
    field: 'EGLC / Speed Adjustment',
    subtext:
      'Telling a pilot to step on the gas or hit the brakes in the sky—speeding them up or slowing them down so they keep a safe distance from their friends!',
    levelNumber: 5,
    isPremium: false,
    isTraining: true,
    icon1: '',
    icon2: '',
  },
  'EGLC / Emergency Procedures': {
    field: 'EGLC / Emergency Procedures',
    subtext:
      'Calling the safety helper on the radio when a pilot has a big surprise or a bumpy problem, so everyone can jump in to help them land safely!',
    levelNumber: 6,
    isPremium: false,
    isTraining: true,
    icon1: '',
    icon2: '',
  },
};
