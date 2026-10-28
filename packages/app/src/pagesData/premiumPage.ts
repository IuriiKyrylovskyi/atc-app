import {
  IStrip,
  strip,
  stripSubtitle,
  stripTitle,
  stripQuestionnaire,
  stripProfile,
  stripUserSettings,
} from './strips';

const titles = [stripTitle('titlePremium'), stripSubtitle('subtitlePremium')];
const strips = [stripQuestionnaire(), stripProfile(), stripUserSettings()];

// ---- desktop ----
// center
export const mainCenterStripsDesktop: IStrip[] = [
  ...titles,
  strip('s3d'),
  strip('s4d'),
  ...strips,
  strip('s8d'),
  strip('s9d'),
];

// ---- mobile ----
// !!! 14 strips in a column
// center
export const mainCenterStripsPortraitMobile: IStrip[] = [
  strip('s1'),
  strip('s2'),
  ...titles,
  strip('s5'),
  strip('s6'),
  strip('s7'),
  strip('s8'),
  ...strips,
  strip('s12'),
  strip('s13'),
  strip('s14'),
];

export const mainCenterStripsLandscapeMobile: IStrip[] = [
  strip('s1m'),
  ...titles,
  strip('s4m'),
  strip('s5m'),
  ...strips,
  strip('s9m'),
];
