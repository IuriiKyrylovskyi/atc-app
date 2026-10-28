/**
 * AIRPORTS CONFIG — roster, entitlements, community pipeline, live events
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * MONETISATION PRINCIPLE
 * ----------------------
 * Sell PLACES, never DIFFICULTY.
 *
 * All five shifts and Endless are available at every free airport. A free
 * player can reach Holiday Meltdown and beat it. Nothing is gated behind a
 * paywall that the player is in the middle of trying to do.
 *
 * The reason is emotional, not commercial: a player blocked mid-progress
 * churns, a player who finished the free content and wants more converts.
 * Same prompt, opposite outcome.
 */

import type { Airport } from './level.structure';

// ═══════════════════════════════════════════════════════════════════════════
// 1. Entitlement
// ═══════════════════════════════════════════════════════════════════════════

export type Tier = 'free' | 'paid';

export interface AirportMeta {
  tier: Tier;
  /** Pack this airport ships in. 'core' = launch paid set. */
  pack: 'starter' | 'core' | string;
  /** Sold individually as well as in the pack. */
  individualSku?: string;
  /** One line for the store card. */
  pitch: string;
  /** The geometry problem this airport poses — drives the store copy too. */
  signature: string;
}

export interface AirportEntry extends AirportMeta {
  airport: Airport;
}

/**
 * THREE free airports, not five.
 *
 * The free set exists to take a player from "what am I looking at" to
 * "I am good at this". Three does that if each teaches a distinct geometry
 * problem. Five dilutes the progression and shrinks the paid catalogue for
 * no gain.
 *
 * All three are unlocked from boot at Red-Eye, so a new player can sample
 * every free field before committing. Shifts then unlock in sequence within
 * whichever airport they pick.
 */
export const FREE_AIRPORT_IDS = ['eglc', 'wadd', 'ksdm/mmtj'] as const;
export const freeAirportIds: string[] = [...FREE_AIRPORT_IDS];

export const FREE_AIRPORT_DESIGN: Record<(typeof FREE_AIRPORT_IDS)[number], AirportMeta> = {
  eglc: {
    tier: 'free',
    pack: 'starter',
    pitch: 'One runway, one exit, no excuses.',
    signature: 'Single runway. Fundamentals: pathing, alignment, spacing.',
  },
  wadd: {
    tier: 'free',
    pack: 'starter',
    pitch: 'One runway over the sea, heavy traffic at sunset.',
    signature: 'Single runway with long ocean approach. Teaches timing over water.',
  },
  'ksdm/mmtj': {
    tier: 'free',
    pack: 'starter',
    pitch: 'Two airports on opposite sides of the border.',
    signature: 'Paired airports sharing one airspace. Teaches cross-border handoffs.',
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// 2. Paid roster
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 17 paid airports at launch → 20 total.
 *
 * Priced two ways:
 *   - Individual airport, small price. For the player who wants Haneda.
 *   - TOWER PASS: all 17, at roughly the price of five. Most take this.
 *
 * Pick each for a geometry gimmick, not just a famous name. "Another four
 * parallel runways" is not a product; "a runway wedged between mountains
 * with one legal approach" is.
 */
export const CORE_PACK: AirportMeta[] = [
  {
    tier: 'paid',
    pack: 'core',
    individualSku: 'airport.yssy',
    pitch: 'Sydney. Four runways over a harbour.',
    signature:
      'Two runway pairs at right angles. Long overwater legs make mistakes slow to correct.',
  },
  {
    tier: 'paid',
    pack: 'core',
    individualSku: 'airport.kjfk',
    pitch: 'JFK. Runways that all want to cross each other.',
    signature: 'Crossing runways, multiple corridors. Teaches conflict geometry at intersections.',
  },
  {
    tier: 'paid',
    pack: 'core',
    individualSku: 'airport.omdb-omsj',
    pitch: 'Dubai / Sharjah. Two hubs bookending the desert.',
    signature: 'Parallel runways with long desert legs. Teaches speed management on final.',
  },
  {
    tier: 'paid',
    pack: 'core',
    individualSku: 'airport.rjtt',
    pitch: 'Tokyo Haneda. Four runways, one bay.',
    signature: 'Four runways in a cross-and-parallel tangle over Tokyo Bay.',
  },
  {
    tier: 'paid',
    pack: 'core',
    individualSku: 'airport.vhhh',
    pitch: 'Hong Kong. Water on three sides, no room for error.',
    signature: 'Crossing runways in a tight basin. The full twelve-type fleet.',
  },
  {
    tier: 'paid',
    pack: 'core',
    individualSku: 'airport.lemd',
    pitch: 'Madrid Barajas. Four runways fanning from a central terminal.',
    signature:
      'Dual parallel pairs with staggered thresholds. Teaches spacing across multiple flight paths.',
  },
  {
    tier: 'paid',
    pack: 'core',
    individualSku: 'airport.ksfo',
    pitch: 'San Francisco. Four runways over water, heavy wake turbulence.',
    signature: 'Parallel runways over San Francisco Bay. Teaches wake separation.',
  },
  {
    tier: 'paid',
    pack: 'core',
    individualSku: 'airport.sbjl',
    pitch: 'Galeao. Two runways on a coastal spit.',
    signature: 'Tidal reach and sea breeze changes. Teaches adapting to shifting wind patterns.',
  },
  {
    tier: 'paid',
    pack: 'core',
    individualSku: 'airport.cyyz',
    pitch: 'Toronto Pearson. Five runways in two complexes.',
    signature: 'Diverse runway orientations, staggered peaks. Teaches rapid heading changes.',
  },
  {
    tier: 'paid',
    pack: 'core',
    individualSku: 'airport.rksi',
    pitch: 'Seoul Incheon. Four parallels stretching to the east sea.',
    signature: 'Dual parallel pairs with long finals. Teaches endurance under sustained pressure.',
  },
  {
    tier: 'paid',
    pack: 'core',
    individualSku: 'airport.lipz',
    pitch: 'Venice Marco Polo. Island field with lagoon approaches.',
    signature: 'Constrained by water on three sides. Teaches precision in tight airspace.',
  },
  {
    tier: 'paid',
    pack: 'core',
    individualSku: 'airport.ksan',
    pitch: 'San Diego. Single runway squeezed between bay and city.',
    signature:
      'Short-field single runway with urban overrun. Teaches precision in constrained spaces.',
  },
  {
    tier: 'paid',
    pack: 'core',
    individualSku: 'airport.lirf',
    pitch: 'Rome Fiumicino. Three parallels and a cross runway.',
    signature:
      'Parallel cluster with intersecting traffic. Teaches deconfliction at busy intersections.',
  },
  {
    tier: 'paid',
    pack: 'core',
    individualSku: 'airport.klax',
    pitch: 'Los Angeles. Four parallels stretched across the basin.',
    signature: 'Wide single-direction parallels. Teaches long-queue management.',
  },
  {
    tier: 'paid',
    pack: 'core',
    individualSku: 'airport.lppt',
    pitch: 'Lisbon. Single runway with city in the approach path.',
    signature: 'Tight final over the city. Teaches energy management on short final.',
  },
  {
    tier: 'paid',
    pack: 'core',
    individualSku: 'airport.lfpg',
    pitch: 'Paris CDG. Four runways fanning from the terminal maze.',
    signature: 'Staggered parallel pairs with diverse approach paths. Teaches sector management.',
  },
  {
    tier: 'paid',
    pack: 'core',
    individualSku: 'airport.egll',
    pitch: 'Heathrow. Two parallels and a queue that never ends.',
    signature: 'Parallel runways. Teaches allocation — which runway, and colour matching.',
  },
];

export const TOWER_PASS_SKU = 'pass.tower';

// ═══════════════════════════════════════════════════════════════════════════
// 3. Community pipeline
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ROUTE PACKS — ~3 airports per quarter, chosen by community vote.
 *
 * The monthly vote cycle is the point. It turns a one-time purchase into a
 * membership and gives you a recurring calendar event that costs nothing
 * but a backend table:
 *
 *   Week 1   submissions open
 *   Week 2   you CURATE down to 3-5 finalists
 *   Week 3   vote
 *   Week 4   result announced, production starts
 *
 * CURATION IS NOT OPTIONAL. Open submission with open voting produces four
 * hundred requests for the submitter's local airstrip and one winner nobody
 * else wanted. You pick the finalists; the community picks the winner.
 *
 * Voting rights:
 *   Tower Pass owners   5 votes per cycle
 *   Free players        1 vote per cycle
 *
 * Free players voting matters — it is the cheapest possible taste of
 * membership and a direct conversion path.
 */
export interface AirportSubmission {
  id: string;
  icao: string;
  city: string;
  country: string;
  submittedBy: string;
  submittedAt: string;
  /** Why it would be interesting to control — the field that gets curated on. */
  rationale: string;
  votes: number;
  status: 'submitted' | 'finalist' | 'winner' | 'shipped' | 'declined';
  /** Set when shipped, so the submitter can be credited in the airport card. */
  shippedInPack?: string;
}

export interface VoteCycle {
  id: string;
  opensAt: string;
  closesAt: string;
  finalists: string[]; // AirportSubmission ids
  packName: string;
  /** Ship 3 of the finalists — usually top 3, but you keep final say. */
  slots: number;
}

export function votesFor(hasTowerPass: boolean): number {
  return hasTowerPass ? 5 : 1;
}

/**
 * Route Pack pricing: same as a 3-airport bundle. Tower Pass owners get a
 * standing discount rather than free access — "all future airports free
 * forever" is a liability you cannot price at launch, and players accept a
 * member discount readily.
 */
export const ROUTE_PACK_MEMBER_DISCOUNT = 0.4;

// ═══════════════════════════════════════════════════════════════════════════
// 4. Live events — the actual retention engine
// ═══════════════════════════════════════════════════════════════════════════

/**
 * DAILY DISPATCH
 *
 * One shift per day, fixed seed, global leaderboard. Everyone plays the
 * identical traffic sequence, so the board is a pure skill comparison.
 *
 * The important part: rotate it through PAID airports too, playable free
 * that day only. This demos your entire catalogue continuously without ever
 * nagging anyone. Players buy Haneda because they played it on a Tuesday
 * and wanted a second go.
 */
export interface DailyDispatch {
  date: string; // YYYY-MM-DD
  airportId: string;
  shiftId: string;
  /** Deterministic seed — same traffic for every player worldwide. */
  seed: number;
  /** True when the airport is paid but temporarily open for the day. */
  isPreview: boolean;
}

export function dailySeed(date: string): number {
  let h = 2166136261;
  for (let i = 0; i < date.length; i++) {
    h ^= date.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * WEEKLY NOTAM — a modifier layered on an existing airport.
 *
 * Best content-to-effort ratio on the whole list. Modifiers are small code
 * changes that recombine infinitely, and they make airports the player has
 * already mastered feel new.
 */
export type NotamModifier =
  | 'fog' // callsign + type labels hidden until tapped
  | 'runway-closed' // half the runways unavailable
  | 'single-direction' // wind: one approach heading only
  | 'no-departures' // arrivals-only surge
  | 'heavy-only' // super/heavy fleet, huge collision radii
  | 'express' // every aircraft at 1.5x its normal speed
  | 'blackout'; // no warning rings — separation by eye

export interface WeeklyNotam {
  weekOf: string;
  airportId: string;
  shiftId: string;
  modifiers: NotamModifier[];
  /** Two stacked modifiers is plenty. Three is noise. */
}

/**
 * ENDLESS LEADERBOARDS — weekly reset, per airport.
 *
 * The reset matters more than the board. A permanent all-time leaderboard
 * is dead content to anyone who installs in month three.
 */
export interface LeaderboardWindow {
  scope: 'daily-dispatch' | 'endless' | 'notam';
  key: string;
  resetsAt: string;
}

/**
 * CONTROLLER CAREER — slow ambient progression across everything.
 *
 * Gives a session purpose even when the player is not chasing stars, and it
 * never resets, so it is the one number that always goes up.
 */
export interface CareerRank {
  atAircraftHandled: number;
  title: string;
}

export const CAREER_RANKS: CareerRank[] = [
  { atAircraftHandled: 0, title: 'Trainee' },
  { atAircraftHandled: 100, title: 'Ground Controller' },
  { atAircraftHandled: 500, title: 'Tower Controller' },
  { atAircraftHandled: 2000, title: 'Approach Controller' },
  { atAircraftHandled: 6000, title: 'Area Controller' },
  { atAircraftHandled: 15000, title: 'Watch Supervisor' },
  { atAircraftHandled: 40000, title: 'Flow Manager' },
];

export function rankFor(handled: number): CareerRank {
  return [...CAREER_RANKS].reverse().find((r) => handled >= r.atAircraftHandled)!;
}

/**
 * DELIBERATELY ABSENT: energy, lives, session timers.
 *
 * They work in match-3 and they are poison here. A player who just lost
 * Evening Rush wants to retry immediately, and that retry impulse is the
 * entire engine of retention in a skill game. Never interrupt it.
 */

// ═══════════════════════════════════════════════════════════════════════════
// 5. Unlock rules
// ═══════════════════════════════════════════════════════════════════════════

/**
 *   Airport access  = entitlement (free set, or purchased) — never stars.
 *   Shift access    = linear within an airport. Clear tier N to see N+1.
 *   Red-Eye         = open at boot on every owned airport.
 *
 * Note this replaces the star-gated airport unlock from level-structure.ts.
 * With a free/paid split, gating owned airports behind stars means a player
 * can pay for Haneda and not be allowed to play it. Entitlement decides
 * access; stars become pure vanity and completion tracking.
 */
export function isAirportPlayable(entry: AirportEntry, owned: Set<string>): boolean {
  if (entry.tier === 'free') return true;
  if (owned.has(TOWER_PASS_SKU)) return true;
  return entry.individualSku ? owned.has(entry.individualSku) : false;
}
