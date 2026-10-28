import {
  mainCenterStripsDesktop,
  mainCenterStripsLandscapeMobile,
  mainCenterStripsPortraitMobile,
  mainLeftStripsDesktop,
  mainLeftStripsLandscapeMobile,
  mainLeftStripsPortraitMobile,
  mainRightStripsDesktop,
  mainRightStripsLandscapeMobile,
  mainRightStripsPortraitMobile,
} from './mainPage';
import {
  mainCenterStripsDesktop as premiumCenterStripsDesktop,
  mainCenterStripsLandscapeMobile as premiumCenterStripsLandscapeMobile,
  mainCenterStripsPortraitMobile as premiumCenterStripsPortraitMobile,
} from './premiumPage';
import type { IStrip } from './strips';

/** The three centre-column variants a page can supply, one per layout. */
type CenterColumns = {
  desktop: IStrip[];
  portrait: IStrip[];
  landscape: IStrip[];
};

/**
 * Every page shares the same left/right columns; only the centre varies. HOME
 * is the one strip that differs per page -- it is hidden on the Home page
 * itself, where it would be a no-op, and shown on every other page.
 *
 * Note that `desktop.portrait` and `mobile.portrait` share the PORTRAIT centre,
 * which is the shipped behaviour and matches what all five hand-written page
 * factories used to do.
 *
 * The right columns are built per call rather than held in a module-level
 * table because `pagesData()` runs inside a `computed` (useStrips.ts) -- the
 * same reason the page factories are functions.
 */
const pageColumns = (isHome: boolean, center: CenterColumns) => {
  const right = {
    portrait: mainRightStripsPortraitMobile(isHome),
    desktop: mainRightStripsDesktop(isHome),
    landscape: mainRightStripsLandscapeMobile(isHome),
  };

  return {
    desktop: {
      portrait: {
        'column-left': mainLeftStripsPortraitMobile,
        'column-center': center.portrait,
        'column-right': right.portrait,
      },
      landscape: {
        'column-left': mainLeftStripsDesktop,
        'column-center': center.desktop,
        'column-right': right.desktop,
      },
    },
    mobile: {
      portrait: {
        'column-left': mainLeftStripsPortraitMobile,
        'column-center': center.portrait,
        'column-right': right.portrait,
      },
      landscape: {
        'column-left': mainLeftStripsLandscapeMobile,
        'column-center': center.landscape,
        'column-right': right.landscape,
      },
    },
  };
};

const pagesData = (isPremium: boolean = false) => {
  // Only the Home page hides HOME. Every other group passes `false`.
  return {
    main: pageColumns(true, {
      portrait: mainCenterStripsPortraitMobile(isPremium),
      desktop: mainCenterStripsDesktop(isPremium),
      landscape: mainCenterStripsLandscapeMobile(isPremium),
    }),
    premium: pageColumns(false, {
      portrait: premiumCenterStripsPortraitMobile,
      desktop: premiumCenterStripsDesktop,
      landscape: premiumCenterStripsLandscapeMobile,
    }),
  };
};
export default pagesData;
