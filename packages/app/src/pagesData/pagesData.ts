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
  buildControlCenterPage,
  controlCenterPageCount,
  type ControlCenterBreakpoint,
} from './controlCenter';
import {
  shiftCenterStripsDesktop,
  shiftCenterStripsLandscapeMobile,
  shiftCenterStripsPortraitMobile,
} from './shiftsPage';
import {
  mainCenterStripsDesktop as tcpMainCenterStripsDesktop,
  mainCenterStripsLandscapeMobile as tcpMainCenterStripsLandscapeMobile,
  mainCenterStripsPortraitMobile as tcpMainCenterStripsPortraitMobile,
} from './trainingCenterPage';
import {
  mainCenterStripsDesktop as scpMainCenterStripsDesktop,
  mainCenterStripsLandscapeMobile as scpMainCenterStripsLandscapeMobile,
  mainCenterStripsPortraitMobile as scpMainCenterStripsPortraitMobile,
} from './systemConfigPage';
import {
  mainCenterStripsDesktop as premiumCenterStripsDesktop,
  mainCenterStripsLandscapeMobile as premiumCenterStripsLandscapeMobile,
  mainCenterStripsPortraitMobile as premiumCenterStripsPortraitMobile,
} from './premiumPage';
import { IAirfield } from './airfields';
import type { IStrip } from './strips';

/**
 * Four screen keys, three Control Center layouts. `desktop` + `portrait`
 * reuses the portrait layout — that is the shipped behaviour, matching what the
 * five hand-written page factories used to do.
 */
const CONTROL_CENTER_BY_KEY: Record<string, ControlCenterBreakpoint> = {
  'desktop/portrait': 'portrait',
  'desktop/landscape': 'desktop',
  'mobile/portrait': 'portrait',
  'mobile/landscape': 'landscape',
};

/** The widest layout decides how many `control center N` keys exist at all. */
const CONTROL_CENTER_MAX_PAGES = Math.max(
  controlCenterPageCount('desktop'),
  controlCenterPageCount('landscape'),
  controlCenterPageCount('portrait')
);

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
 * same reason controlCenter.ts keeps its pages as functions.
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

/**
 * Builds `control center 1..N` for every screen key. HOME is always shown here:
 * the Control Center is reached from Home, so HOME is never a no-op on it.
 *
 * Each key builds its own strips on purpose: `stripField` re-rolls the strip
 * colour, so the four branches stay independent rather than sharing instances.
 */
const controlCenterPages = (isPremium: boolean) => {
  const pages: Record<string, unknown> = {};
  const center = (key: string, page: number): IStrip[] =>
    buildControlCenterPage(CONTROL_CENTER_BY_KEY[key], page, isPremium);

  for (let page = 1; page <= CONTROL_CENTER_MAX_PAGES; page += 1) {
    pages[`control center ${page}`] = pageColumns(false, {
      portrait: center('desktop/portrait', page),
      desktop: center('desktop/landscape', page),
      landscape: center('mobile/landscape', page),
    });
  }
  return pages;
};

const pagesData = (
  isPremium: boolean = false,
  airportId: string,
  airfield?: IAirfield,
  isBlocked?: (shiftId: string) => boolean
) => {
  // Only the Home page hides HOME. Every other group passes `false`.
  //
  // `system config` is unreachable -- SystemConfig.vue renders SystemConfigPage
  // instead, which is not a strip page -- but it is kept consistent with the
  // rest rather than left as a special case.
  return {
    main: pageColumns(true, {
      portrait: mainCenterStripsPortraitMobile(isPremium),
      desktop: mainCenterStripsDesktop(isPremium),
      landscape: mainCenterStripsLandscapeMobile(isPremium),
    }),
    ...controlCenterPages(isPremium),
    shift: pageColumns(false, {
      portrait: airfield ? shiftCenterStripsPortraitMobile(airfield, airportId, isBlocked) : [],
      desktop: airfield ? shiftCenterStripsDesktop(airfield, airportId, isBlocked) : [],
      landscape: airfield ? shiftCenterStripsLandscapeMobile(airfield, airportId, isBlocked) : [],
    }),
    premium: pageColumns(false, {
      portrait: premiumCenterStripsPortraitMobile,
      desktop: premiumCenterStripsDesktop,
      landscape: premiumCenterStripsLandscapeMobile,
    }),
    'tarining center': pageColumns(false, {
      portrait: tcpMainCenterStripsPortraitMobile(isPremium),
      desktop: tcpMainCenterStripsDesktop(isPremium),
      landscape: tcpMainCenterStripsLandscapeMobile(isPremium),
    }),
    'system config': pageColumns(false, {
      portrait: scpMainCenterStripsPortraitMobile(isPremium),
      desktop: scpMainCenterStripsDesktop(isPremium),
      landscape: scpMainCenterStripsLandscapeMobile(isPremium),
    }),
  };
};
export default pagesData;
