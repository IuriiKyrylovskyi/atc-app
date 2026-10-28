/**
 * packages/app/src/services/progress.ts
 *
 * One API for "how far has this player got", regardless of whether they are
 * free or premium:
 *
 *   recordCompletion(airportId, shiftId, maxPlanes?, stars?)
 *   getLastCompleted(airportId)          → shiftId | null   ("Continue Game")
 *   isShiftCompleted(airportId, shiftId) → boolean
 *   getMaxPlanes(airportId, shiftId)    → best plane count (endless scoreboard)
 *   load() / flush()                     → server sync for premium users
 *   migrateFreeToPaid()                  → push the local free progress up
 *
 * ── Where the data lives ────────────────────────────────────────────────────
 * The plan originally described a single `account_progress(account_id,
 * airport_id, shift_id)` table. A table with that name and a different shape is
 * already deployed (`account_id` PK + `last_passed_level` / `passed_levels`),
 * and the game already reads and writes it, so replacing it would be a
 * destructive migration. This service therefore presents the planned API on top
 * of the three stores that already own each piece of the data:
 *
 *   completion chain + last completed → monetization (last_passed_level /
 *                                     passed_levels, localStorage + server)
 *   best plane count per shift        → userScores (account_scores, server for
 *                                     premium, local-only for free)
 *   stars per shift                   → shiftProgress (local only)
 *
 * Both tiers of the plan's sync matrix therefore hold without a schema change:
 * free users are served entirely from localStorage, premium users get the same
 * state pushed to and pulled from Supabase.
 */

import { getShiftEnum, getShiftIdFromEnum } from '@/game/config/level.structure';
import { useMonetizationStore } from '@/stores/monetization';
import { useUserScoresStore } from '@/stores/userScores';
import { useShiftProgressStore } from '@/stores/shiftProgress';

function levelKey(airportId: string, shiftId: string): string {
  return `${airportId}:${shiftId}`;
}

/** Numeric enum of the last shift completed on an airport, or 0 for none. */
function completedEnum(airportId: string): number {
  const raw = useMonetizationStore().getPassedLevelForAirport(airportId);
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Record a finished shift (and/or an endless run).
 *
 * `maxPlanes` is the best plane count for the shift — kept non-decreasing, both
 * locally and by the server-side RLS policy. `stars` is the 1–3 star rating of
 * a cleared shift; endless has no completion screen, so it is never passed.
 */
function recordCompletion(
  airportId: string,
  shiftId: string,
  maxPlanes?: number,
  stars?: number
): void {
  if (!airportId || !shiftId) return;

  if (typeof maxPlanes === 'number' && Number.isFinite(maxPlanes)) {
    useUserScoresStore().recordResult(levelKey(airportId, shiftId), maxPlanes);
  }

  if (shiftId === 'endless') return;

  if (typeof stars === 'number') {
    useShiftProgressStore().recordResult(levelKey(airportId, shiftId), stars);
  }
  useMonetizationStore().markLevelPassed(airportId, shiftId);
}

/** The last shift cleared on an airport, or null when none was. */
function getLastCompleted(airportId: string): string | null {
  const enumValue = completedEnum(airportId);
  if (!enumValue) return null;
  return getShiftIdFromEnum(enumValue);
}

/**
 * Whether a shift has been cleared. The unlock chain is strictly ordered, so a
 * shift is complete when its position is at or before the last cleared one.
 */
function isShiftCompleted(airportId: string, shiftId: string): boolean {
  if (shiftId === 'endless') return false;
  const target = getShiftEnum(shiftId);
  if (target === null) return false;
  return target <= completedEnum(airportId);
}

/** Best plane count for a shift (endless has no upper bound). */
function getMaxPlanes(airportId: string, shiftId: string): number {
  return useUserScoresStore().getMaxPlanes(levelKey(airportId, shiftId));
}

/** The shift that unlocks endless mode on an airport. */
const ENDLESS_GATE_SHIFT = 'midday-mix';

/**
 * Whether a shift may be played.
 *
 * Free users follow the local completion chain — clearing shift N opens N+1 —
 * which is all their local state can express.
 *
 * Premium users are entitled to EVERY airport, and their chain is read from the
 * server-synced per-airport progress rather than the local `cleared` map: every
 * shift they have completed stays enabled, plus exactly one more so there is
 * always something to play. A purchase opens the airports; it does not skip the
 * campaign, so shifts past that stay locked.
 *
 * The completion source is what differs between tiers, which is why this lives
 * here instead of in the shift store: a premium player who restored on a new
 * device has a full server chain and an empty local `cleared` map.
 */
function isShiftPlayable(airportId: string, shiftId: string): boolean {
  if (!airportId || !shiftId) return false;
  if (shiftId === 'endless') return isEndlessPlayable(airportId);

  const target = getShiftEnum(shiftId);
  if (target === null) return false;

  if (useMonetizationStore().isPremium) {
    return target <= completedEnum(airportId) + 1;
  }

  return useShiftProgressStore().isShiftUnlocked(airportId, shiftId);
}

/**
 * Endless opens once the airport's chain has reached Midday Mix, matching the
 * long-standing free-user rule so the two tiers do not disagree.
 */
function isEndlessPlayable(airportId: string): boolean {
  if (useMonetizationStore().isPremium) {
    const gate = getShiftEnum(ENDLESS_GATE_SHIFT);
    return gate !== null && completedEnum(airportId) >= gate;
  }
  return useShiftProgressStore().isEndlessUnlocked(airportId);
}

/** Stars for a cleared shift (local only — never synced). */
function getStars(airportId: string, shiftId: string): number {
  return useShiftProgressStore().getStars(levelKey(airportId, shiftId));
}

/**
 * Pull the server state. Called once on launch (via monetization.init); kept
 * public so a re-entering player (after the waiting screen) can refresh.
 */
async function load(): Promise<void> {
  await useUserScoresStore().loadFromServer();
  await useMonetizationStore().syncFromServer(true);
}

/** Push local state that the server does not have yet (premium only). */
async function flush(): Promise<void> {
  await useUserScoresStore().flush();
  await useMonetizationStore().flushProgressToServer();
}

/**
 * Free → paid handover. The free player's progress was already written to the
 * same in-memory state while they played, so "migration" is just a flush: the
 * localStorage values are now uploaded to the account they have just bought.
 * No server-side copy of anything is left behind — the local cache is the only
 * free-state store, exactly as before the purchase.
 */
async function migrateFreeToPaid(): Promise<void> {
  await useUserScoresStore().loadFromServer();
  await flush();
}

export const progressService = {
  recordCompletion,
  getLastCompleted,
  isShiftCompleted,
  isShiftPlayable,
  isEndlessPlayable,
  getMaxPlanes,
  getStars,
  load,
  flush,
  migrateFreeToPaid,
};
