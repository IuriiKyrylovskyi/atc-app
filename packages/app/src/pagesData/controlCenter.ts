/**
 * packages/app/src/pagesData/controlCenter.ts
 *
 * Control Center pages are GENERATED. They used to be five hand-written
 * factories (controlCenterPage.ts … controlCenterPage5.ts) whose airport
 * indices were hardcoded to `airports[0]` … `airports[19]`, which meant a 21st
 * entry in AIRPORTS_OBJECTS.json would render nowhere and nothing would say so.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * HOW A PAGE IS BUILT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   leading spacers
 *   title(page)
 *   subtitle(page)
 *   airports[0 .. split)          ← `split` is 3 on page 1, all of them after
 *   padding spacers               ← only ever non-zero on the last airport page
 *   GO PRO
 *   airports[split .. )
 *   "More Pro Levels ->"          ← only before the last airport page
 *   trailing spacers
 *
 * Each layout declares how many airports fit a page, how tall the column must
 * be, and how many spacers bracket it. The column is then padded to its target
 * height with blank strips.
 *
 * Padding goes IMMEDIATELY BEFORE `stripGoPro`, never after. This is
 * load-bearing, not cosmetic: `stripWidth(i)` makes strips widen toward the
 * bottom of the column, so moving a spacer across GO PRO changes GO PRO's
 * rendered width.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THE NUMBERS ARE WHAT THEY ARE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The three layouts were transcribed from the five deleted factories and
 * reproduce them strip for strip at 20 airports:
 *
 *   layout     perPage  target  lead  trail  airport pages
 *   desktop        5       9     0      0    4 + 1 filler
 *   landscape      4       9     1      0    5
 *   portrait       7      14     2      1    3 + 2 fillers
 *
 * `target` is the column height the layout needs; the CSS stops at 14.
 *
 * `MIN_CONTROL_CENTER_PAGES` exists purely so the authored filler pages
 * (desktop page 5, portrait pages 4 and 5) keep shipping. Lower it to
 * `Math.ceil(airports.length / perPage)` if those should disappear.
 *
 * "More Pro Levels" stops at the last page that has airports — which is why
 * desktop pages 4 AND 5 both lack it, and why portrait stops at 3. "Last page"
 * is not "page 5".
 *
 * Adding an airport to AIRPORTS_OBJECTS.json is the only edit needed: landscape
 * grows to 6 pages at 21 airports, desktop and portrait absorb it.
 */

import {
  strip,
  stripField,
  stripGoPro,
  stripNext,
  stripSubtitle,
  stripTitle,
  subtitleControlCenter,
  titleControlCenter,
} from './strips';
import type { IStrip } from './strips';
import { airports } from './airports';
import { AIRPORTS } from '@/game/config/airports.config';

export type ControlCenterBreakpoint = 'desktop' | 'landscape' | 'portrait';

export interface ControlCenterLayout {
  /** Airports shown per page. */
  perPage: number;
  /** Strips the centre column must end up with, including the blank ones. */
  target: number;
  /** Blank strips above the title. */
  lead: number;
  /** Blank strips below "More Pro Levels". */
  trail: number;
}

export const CONTROL_CENTER_LAYOUTS: Record<ControlCenterBreakpoint, ControlCenterLayout> = {
  desktop: { perPage: 5, target: 9, lead: 0, trail: 0 },
  landscape: { perPage: 4, target: 9, lead: 1, trail: 0 },
  portrait: { perPage: 7, target: 14, lead: 2, trail: 1 },
};

/** Keeps the authored filler pages. See the file header. */
export const MIN_CONTROL_CENTER_PAGES = 5;

/**
 * GO PRO sits after the first three airports on page 1 on all three layouts
 * (3 before / the rest after), and after every airport on later pages.
 */
const GO_PRO_SPLIT = 3;

/**
 * Four route keys, three layouts. `desktop` + `portrait` deliberately reuses
 * the portrait layout — that is the shipped behaviour, not an oversight.
 */
export function controlCenterBreakpoint(
  screenType: string,
  screenRotation: string
): ControlCenterBreakpoint {
  if (screenRotation === 'portrait') return 'portrait';
  return screenType === 'mobile' ? 'landscape' : 'desktop';
}

/** The last page that still has airports, for this layout. */
export function lastAirportPage(breakpoint: ControlCenterBreakpoint): number {
  const { perPage } = CONTROL_CENTER_LAYOUTS[breakpoint];
  return Math.ceil(airports.length / perPage);
}

export function controlCenterPageCount(breakpoint: ControlCenterBreakpoint): number {
  return Math.max(MIN_CONTROL_CENTER_PAGES, lastAirportPage(breakpoint));
}

/** Non-finite and out-of-range pages land on the nearest valid one. */
export function clampControlCenterPage(breakpoint: ControlCenterBreakpoint, page: number): number {
  if (!Number.isFinite(page)) return 1;
  return Math.min(Math.max(Math.trunc(page), 1), controlCenterPageCount(breakpoint));
}

/**
 * MUST stay a function rather than a module-level precomputed table:
 * `stripField` and `stripGoPro` call `getRandomStripColor()`, and `pagesData()`
 * runs inside a `computed`. A precomputed table would freeze every strip colour
 * on the first render instead of re-rolling on recompute.
 */
export function buildControlCenterPage(
  breakpoint: ControlCenterBreakpoint,
  page: number,
  isPremium = false
): IStrip[] {
  const layout = CONTROL_CENTER_LAYOUTS[breakpoint];
  const safePage = clampControlCenterPage(breakpoint, page);
  const start = (safePage - 1) * layout.perPage;
  const pageAirports = airports.slice(start, start + layout.perPage);
  const isLastAirportPage = safePage >= lastAirportPage(breakpoint);

  const split = safePage === 1 ? Math.min(GO_PRO_SPLIT, pageAirports.length) : pageAirports.length;
  const after = pageAirports.length - split;

  // Everything the page needs apart from the padding. `split` and `after` are
  // both counted: on page 1 GO PRO splits the airport run in two, and dropping
  // either half would pad the column with phantom blanks.
  const unpadded = layout.lead + 2 + split + 1 + after + (isLastAirportPage ? 0 : 1) + layout.trail;
  const pad = Math.max(0, layout.target - unpadded);

  const strips: IStrip[] = [];
  for (let i = 0; i < layout.lead; i += 1) strips.push(strip(`lead-${i + 1}`));
  strips.push(stripTitle(titleControlCenter(safePage)));
  strips.push(stripSubtitle(subtitleControlCenter(safePage)));
  for (const airport of pageAirports.slice(0, split)) strips.push(stripField(airport));
  for (let i = 0; i < pad; i += 1) strips.push(strip(`pad-${i + 1}`));
  strips.push(stripGoPro(isPremium));
  for (const airport of pageAirports.slice(split)) strips.push(stripField(airport));
  if (!isLastAirportPage) strips.push(stripNext());
  for (let i = 0; i < layout.trail; i += 1) strips.push(strip(`trail-${i + 1}`));
  return strips;
}

// ═══════════════════════════════════════════════════════════════════════════
// Two lists of the same airports
// ═══════════════════════════════════════════════════════════════════════════

/**
 * `pagesData/airports.ts` (this directory's JSON, which derives
 * `isPremium: number > 3`) and `game/config/airports.config.ts` (with `tier`
 * and `order`) are two independent lists of the same twenty airports. They
 * agree today — JSON `number` equals config `order` for all twenty, free = 1–3
 * in both — but nothing enforces it, and the JSON is the file that gets edited
 * when the list grows.
 *
 * The control center slices `airports` POSITIONALLY, so a disagreement here
 * silently shows the wrong airport, or a wrong premium badge, in the menu.
 */
export function airportSourceMismatches(): string[] {
  const problems: string[] = [];
  if (airports.length !== AIRPORTS.length) {
    problems.push(
      `airports.ts has ${airports.length} airports, airports.config.ts has ${AIRPORTS.length}`
    );
  }
  const shared = Math.min(airports.length, AIRPORTS.length);
  for (let i = 0; i < shared; i += 1) {
    const menu = airports[i];
    const game = AIRPORTS[i];
    // Compare against the id, NOT `game.icao`: the menu spells a paired field as
    // 'KSDM/MMTJ' while the config keeps only the primary 'KSDM' and carries the
    // pair in `id` ('ksdm/mmtj'). Comparing ICAO alone would flag both paired
    // airports on a perfectly healthy list.
    if (menu.icao !== game.id.toUpperCase()) {
      problems.push(
        `[${i}] pagesData ${menu.icao} vs game config ${game.id.toUpperCase()} (order ${
          game.order
        })`
      );
    }
    if (menu.isPremium !== (game.tier === 'paid')) {
      problems.push(`[${i}] ${menu.icao}: isPremium ${menu.isPremium} vs tier '${game.tier}'`);
    }
  }
  return problems;
}

// Optional-chained like `stores/api.ts`: Vite replaces `import.meta.env.DEV`
// with `false` in production, but the module must not throw when evaluated by
// anything that has no `import.meta.env` at all.
if (import.meta.env?.DEV) {
  const problems = airportSourceMismatches();
  if (problems.length) {
    console.warn(
      `[controlCenter] the two airport lists disagree — the control center slices by index:\n${problems.join(
        '\n'
      )}`
    );
  }
}
