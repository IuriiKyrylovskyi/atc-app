import {
  IStrip,
  strip,
  stripBack,
  stripEnterControlCenter,
  stripExit,
  stripGoPro,
  stripHome,
  stripsButtons,
  stripSystemConfig,
  stripStartGame,
  stripSubtitle,
  stripTitle,
  stripTrainingCenter,
} from './strips';

// ---- desktop ----
// !!! 9 strips in a column
// left
export const mainLeftStripsDesktop: IStrip[] = [
  strip('l1', true, 'stripYellow', stripsButtons.stripContent9),
  strip('l2'),
  stripBack(),
  strip('l4'),
  strip('l5'),
  strip('l6'),
  strip('l7', true, 'stripBlue', stripsButtons.stripContent6),
  strip('l8', true, 'stripBlue', stripsButtons.stripContent7),
  strip('l9', true, 'stripBlue', stripsButtons.stripContent8),
];

// right
// A FACTORY, not a shared const: the HOME strip is hidden on the Home page
// itself, where it would be a no-op, and visible everywhere else. These columns
// are used by every page, so the difference has to be built per page.
// `isHome` swaps the HOME strip in and out of the slot directly below EXIT. The
// slot is REUSED rather than appended, so `column.length` never changes -- see
// `stripHome()`.
//
// The column always LEADS with EXIT. On plain web EXIT is hidden (a browser
// tab cannot be closed by script), and its slot is handed to HOME instead:
// leaving HOME one slot lower would open a visible gap at the top of the
// column, because every slot below EXIT is an invisible spacer. The column
// LENGTH never changes either way -- the right columns are full (9 / 14 / 9)
// and `stripWidth(i)` derives the taper from `column.length`.
export const mainRightStripsDesktop = (isHome = false): IStrip[] => {
  const exit = stripExit();
  const home = isHome ? strip('r2') : stripHome();
  return [
    ...(exit.isVisible ? [exit, home] : [home, exit]),
    strip('r3'),
    strip('r4'),
    strip('r5'),
    strip('r6'),
    strip('r7'),
    strip('r8'),
    strip('r9'),
  ];
};

// center
export const mainCenterStripsDesktop = (isPremium = false): IStrip[] => [
  stripTitle(),
  stripSubtitle(),
  strip('s3'),
  stripStartGame(),
  stripEnterControlCenter(),
  stripTrainingCenter(),
  strip('s7'),
  stripSystemConfig(),
  stripGoPro(isPremium),
];

// ---- mobile ----
// !!! 14 strips in a column
// center
export const mainCenterStripsPortraitMobile = (isPremium = false): IStrip[] => [
  strip('s1'),
  strip('s2'),
  stripTitle(),
  stripSubtitle(),
  strip('s5'),
  strip('s6'),
  stripStartGame(),
  stripEnterControlCenter(),
  stripTrainingCenter(),
  strip('s10'),
  strip('s11'),
  stripSystemConfig(),
  stripGoPro(isPremium),
  strip('s14'),
];

export const mainLeftStripsPortraitMobile: IStrip[] = [
  stripBack(),
  strip('l1m', true, 'stripYellow', stripsButtons.stripContent9),
  strip('l3m'),
  strip('l4m'),
  strip('l5m'),
  strip('l6m'),
  strip('l7m'),
  strip('l8m'),
  strip('l9m'),
  strip('l10m'),
  strip('l11m'),
  strip('l12m'),
  strip('l13m'),
  strip('l14m'),
];

export const mainRightStripsPortraitMobile = (isHome = false): IStrip[] => {
  const exit = stripExit();
  const home = isHome ? strip('r2m') : stripHome();
  return [
    ...(exit.isVisible ? [exit, home] : [home, exit]),
    strip('r3m'),
    strip('r4m'),
    strip('r5m'),
    strip('r6m'),
    strip('r7m'),
    strip('r8m'),
    strip('r9m'),
    strip('r10m'),
    strip('r11m'),
    strip('r12m'),
    strip('r13m'),
    strip('r14m'),
  ];
};

export const mainCenterStripsLandscapeMobile = (isPremium = false): IStrip[] => [
  strip('s1m'),
  stripTitle(),
  stripSubtitle(),
  strip('s3'),
  stripStartGame(),
  stripEnterControlCenter(),
  stripTrainingCenter(),
  stripSystemConfig(),
  stripGoPro(isPremium),
];

export const mainLeftStripsLandscapeMobile: IStrip[] = [
  strip('l1m'),
  strip('l2m'),
  strip('l3m'),
  stripBack(),
  strip('l5m'),
  strip('l6m'),
  strip('l7m', true, 'stripBlue', stripsButtons.stripContent6),
  strip('l8m', true, 'stripBlue', stripsButtons.stripContent7),
  strip('l9m', true, 'stripBlue', stripsButtons.stripContent8),
];

export const mainRightStripsLandscapeMobile = (isHome = false): IStrip[] => {
  const exit = stripExit();
  const home = isHome ? strip('r3m') : stripHome();
  return [
    strip('r1m'),
    // EXIT sits at index 1 in this column, so the slot below it is r3m, not
    // r2m. On plain web EXIT is hidden and HOME takes over its slot.
    ...(exit.isVisible ? [exit, home] : [home, exit]),
    strip('r4m'),
    strip('r5m'),
    strip('r6m'),
    strip('r7m'),
    strip('r8m'),
    strip('r9m'),
  ];
};
