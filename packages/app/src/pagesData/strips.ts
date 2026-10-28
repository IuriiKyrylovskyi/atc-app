import { isPlainWeb } from '@/utils/platform';

type StripSrcTypes =
  | 'stripRed'
  | 'stripYellow'
  | 'stripGreen'
  | 'stripBlue'
  | 'stripPink'
  | 'stripContent';

export const STRIP_COLORS: StripSrcTypes[] = [
  'stripRed',
  'stripYellow',
  'stripGreen',
  'stripBlue',
  'stripPink',
];

export function getRandomStripColor(): StripSrcTypes {
  return STRIP_COLORS[Math.floor(Math.random() * STRIP_COLORS.length)];
}
export type StripHandlerTypes =
  | 'playLevel'
  | 'playTrainingLevel'
  | 'quickPlay'
  | 'exitPlay'
  | 'goHome'
  | 'goBack'
  | 'enterControlCenter'
  | 'trainingCenterHandler'
  | 'onSystemConfig'
  | 'onGoPro'
  | 'onPremiumAccount'
  | 'onQuestionnaire'
  | 'onProfile'
  | 'onAccountSettings';

export interface IStrip {
  id: string;
  // Filler strips (`strip('s3')`) carry no button.
  type?: IStripButtonType;
  src: StripSrcTypes | string;
  isVisible?: boolean;
  isGrounded?: boolean;
  isDisabled?: boolean;
  icon1?: string;
  icon2?: string;
}
export interface IStripButtonType {
  text: string;
  subtext?: string;
  /** Airports and shifts carry their ordinal as a number, page subtitles a number too. */
  number?: string | number;
  handler?: StripHandlerTypes;
  mouseLeaveHandler?: string;
  class?: string;
  icon1?: string;
  icon2?: string;
  blocked?: boolean;
  // Render flags StripColumn understands (airport / training strips).
  iata?: string;
  isPremium?: boolean;
  isTraining?: boolean;
}

export const defaultStrip = {
  id: 'default',
  src: 'stripBlue',
  isVisible: false,
};

export const stripsButtons = {
  title: {
    text: 'ATC-APP',
    mouseLeaveHandler: 'playClick',
    class: 'title',
    icon1: 'cloudIcon',
    icon2: 'planeUpIcon',
  },
  titlePremium: {
    text: 'PREMIUM ACCOUNT',
    mouseLeaveHandler: 'playClick',
    class: 'titlePremium',
    icon1: '',
    icon2: 'crownIcon',
  },
  subtitle: {
    text: 'Air Traffic Control Game',
    mouseLeaveHandler: 'playClick',
    class: 'subtitle',
    icon1: 'towerIcon',
    icon2: 'headsetsIcon',
  },
  subtitlePremium: {
    text: 'Your credentials, recovery and votes',
    mouseLeaveHandler: 'playClick',
    class: 'subtitle',
    icon1: '',
    icon2: '',
  },
  'start game': {
    text: 'START GAME',
    handler: 'quickPlay',
    mouseLeaveHandler: 'playClick',
    class: 'start-game',
    icon1: '',
    icon2: 'startIcon',
  },
  exit: {
    text: 'EXIT',
    handler: 'exitPlay',
    mouseLeaveHandler: 'playClick',
    class: 'exit',
    icon1: 'logOffIcon',
    icon2: 'exitIcon',
  },
  // No icon on purpose: there is no home icon in assets/icons, and borrowing
  // one (e.g. towerIcon) would sit at a different visual weight next to EXIT's
  // pair. Text-only also means the strip needs no CSS -- like 'enter control
  // center' it has no `.home` rule and no rotateX text tilt.
  home: {
    text: 'HOME',
    handler: 'goHome',
    mouseLeaveHandler: 'playClick',
    class: 'home',
    icon1: '',
  },
  back: {
    text: 'BACK',
    handler: 'goBack',
    mouseLeaveHandler: 'playClick',
    class: 'back',
    icon1: '',
    icon2: 'backIcon',
  },
  'enter control center': {
    text: 'ENTER CONTROL CENTER',
    handler: 'enterControlCenter',
    mouseLeaveHandler: 'playClick',
    icon1: '',
  },
  'training center': {
    text: 'TRAINING CENTER',
    handler: 'trainingCenterHandler',
    mouseLeaveHandler: 'playClick',
    class: 'trainingCenter',
    icon2: 'bookIcon',
    icon1: 'hatIcon',
  },
  'system config': {
    text: 'SYSTEM CONFIG',
    handler: 'onSystemConfig',
    mouseLeaveHandler: 'playClick',
    class: 'systemConfig',
    icon1: 'settingsIcon',
    icon2: 'settingsIcon2',
  },
  'go pro': {
    text: 'GO PRO',
    handler: 'onGoPro',
    mouseLeaveHandler: 'playClick',
    class: 'goPro',
    icon1: 'crownIcon',
    icon2: 'fullAccessTextIcon',
  },
  premium: {
    text: 'PREMIUM ACCOUNT',
    handler: 'onPremiumAccount',
    mouseLeaveHandler: 'playClick',
    // `goPro` is the only button art that reads correctly for a paid account
    // (crown + full-access plate), so the class is kept even though the label
    // and the destination have changed.
    class: 'goPro',
    icon1: 'crownIcon',
    icon2: '',
  },
  questionnaire: {
    text: 'Questionnaire',
    handler: 'onQuestionnaire',
    mouseLeaveHandler: 'playClick',
    class: 'questionnaire',
    icon1: '',
    icon2: '',
  },
  profile: {
    text: 'Profile',
    handler: 'onProfile',
    mouseLeaveHandler: 'playClick',
    class: 'profile',
    icon1: '',
    icon2: '',
  },
  'user settings': {
    text: 'Account Settings',
    handler: 'onAccountSettings',
    mouseLeaveHandler: 'playClick',
    class: 'account-settings',
    icon1: '',
    icon2: '',
  },
  // fpl plain strips
  stripContent6: {
    text: '',
    class: 'stripContentIcon6',
    icon1: 'stripContentIcon6',
    icon2: '',
    mouseLeaveHandler: 'playClick',
  },
  stripContent7: {
    text: '',
    class: 'stripContentIcon7',
    icon1: 'stripContentIcon7',
    icon2: '',
    mouseLeaveHandler: 'playClick',
  },
  stripContent8: {
    text: '',
    class: 'stripContentIcon8',
    icon1: 'stripContentIcon8',
    icon2: '',
    mouseLeaveHandler: 'playClick',
  },
  stripContent9: {
    text: '',
    class: 'stripContentIcon9',
    icon1: 'stripContentIcon9',
    icon2: '',
    mouseLeaveHandler: 'playClick',
  },
} satisfies Record<string, IStripButtonType>;

export type StripTypes = keyof typeof stripsButtons;

export const strip = (
  id: string,
  isVisible = false,
  src: StripSrcTypes = 'stripRed',
  type?: IStripButtonType
): IStrip => {
  return { id, src, isVisible, type };
};
/**
 * A strip type may be passed as a `stripsButtons` key or built on the spot
 * (e.g. a title that depends on page data).
 */
const resolveStripType = (
  type: StripTypes | IStripButtonType | undefined,
  fallback: StripTypes
): IStripButtonType =>
  typeof type === 'string' ? stripsButtons[type || fallback] : type ?? stripsButtons[fallback];

export const stripTitle = (titleType?: StripTypes | IStripButtonType): IStrip => {
  return {
    id: 'title',
    src: 'stripRed',
    type: resolveStripType(titleType, 'title'),
    isVisible: true,
  };
};
export const stripSubtitle = (subtitleType?: StripTypes | IStripButtonType): IStrip => {
  return {
    id: 'subtitle',
    src: 'stripYellow',
    type: resolveStripType(subtitleType, 'subtitle'),
    isVisible: true,
  };
};

export const stripStartGame = (): IStrip => {
  return {
    id: 'startGame',
    src: 'stripBlue',
    type: stripsButtons['start game'],
    isVisible: true,
  };
};
export const stripEnterControlCenter = (): IStrip => {
  return {
    id: 'eneterControlCenter',
    src: 'stripYellow',
    type: stripsButtons['enter control center'],
    isVisible: true,
  };
};
export const stripTrainingCenter = (): IStrip => {
  return {
    id: 'trainingCenter',
    src: 'stripYellow',
    type: stripsButtons['training center'],
    isVisible: true,
  };
};
export const stripSystemConfig = (): IStrip => {
  return {
    id: 'systemConfig',
    src: 'stripPink',
    type: stripsButtons['system config'],
    isVisible: true,
  };
};
export const stripGoPro = (isPremium?: boolean): IStrip => {
  return {
    id: 'goPro',
    src: 'stripGreen',
    type: stripsButtons[isPremium ? 'premium' : 'go pro'],
    // Always visible: free users see "GO PRO" (the upsell), premium users see
    // "PREMIUM ACCOUNT" (their account hub). Hiding the premium branch would
    // leave a premium player with no route to their credentials from Home.
    isVisible: true,
  };
};
export const stripQuestionnaire = (): IStrip => {
  return {
    id: 'questionnaire',
    src: 'stripGreen',
    type: stripsButtons['questionnaire'],
    isVisible: true,
  };
};
export const stripProfile = (): IStrip => {
  return {
    id: 'profile',
    src: 'stripGreen',
    type: stripsButtons['profile'],
    isVisible: true,
  };
};
export const stripUserSettings = (): IStrip => {
  return {
    id: 'userSettings',
    src: 'stripGreen',
    type: stripsButtons['user settings'],
    isVisible: true,
  };
};

export const stripBack = (): IStrip => {
  return {
    id: 'back',
    src: 'stripRed',
    type: stripsButtons['back'],
    isVisible: true,
  };
};
export const stripExit = (): IStrip => {
  return {
    id: 'exit',
    src: 'stripRed',
    type: stripsButtons['exit'],
    // A plain browser tab cannot be closed by script, so there is nothing
    // useful for EXIT to do there — the affordance is hidden on web.
    //
    // `isVisible: false` (rather than removing the strip from the column) is
    // deliberate: the right columns are position-sensitive and already full
    // (9 / 14 / 9), and `.strip` is only `visibility: hidden`, so the strip
    // keeps its flex box. Removing it would re-taper every strip below it
    // (`stripWidth(i)` derives from `column.length`) and break the alignment
    // with the page artwork. A hidden strip is also unclickable: every
    // handler is gated on `isSettled(i)`, and a strip that never falls never
    // settles.
    isVisible: !isPlainWeb(),
  };
};
/**
 * The blue HOME strip, shown directly below EXIT in the right column. It REUSES
 * the slot of an invisible filler strip instead of appending a new one: the
 * right columns are already full (9 / 14 / 9) and `.strip` is only
 * `visibility: hidden`, so it still occupies its flex box -- an appended strip
 * would be clipped by `.wrap { overflow: hidden }` and would re-taper every
 * strip's width via `stripWidth(i)`, which derives from `column.length`.
 */
export const stripHome = (): IStrip => {
  return {
    id: 'home',
    src: 'stripBlue',
    type: stripsButtons['home'],
    isVisible: true,
  };
};
