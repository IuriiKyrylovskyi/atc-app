import {
  IStrip,
  strip,
  stripAudioSettings,
  stripBackgroundBrightness,
  stripGameScene,
  stripMasterVolume,
  stripMusicVolume,
  stripMuteAll,
  stripSoundEffects,
  stripSubtitle,
  stripTitle,
} from './strips';

const systemConfigStrips = (isExpanded = false) => [
  stripTitle(),
  ...(isExpanded ? [stripSubtitle()] : []),
  stripGameScene(),
  stripBackgroundBrightness(),
  stripAudioSettings(),
  stripMasterVolume(),
  stripMuteAll(),
  stripMusicVolume(),
  stripSoundEffects(),
];

// ---- desktop ----
// center
export const mainCenterStripsDesktop = (isPremium = false): IStrip[] => [
  ...systemConfigStrips(true),
];

// ---- mobile ----
// !!! 14 strips in a column
// center
export const mainCenterStripsPortraitMobile = (isPremium = false): IStrip[] => [
  strip('s1'),
  strip('s2'),
  strip('s3'),
  ...systemConfigStrips(true),
  strip('s13'),
  strip('s14'),
];

export const mainCenterStripsLandscapeMobile = (isPremium = false): IStrip[] => [
  ...systemConfigStrips(),
];
