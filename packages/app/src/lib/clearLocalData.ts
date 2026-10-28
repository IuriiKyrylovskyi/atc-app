/**
 * packages/app/src/lib/clearLocalData.ts
 *
 * Removes every piece of player data this app keeps on the device. Used by
 * "Delete account". Device preferences (atc-app_settings: volume, haptics,
 * update checks) are deliberately kept.
 *
 * The Supabase session (sb-…-auth-token) is NOT listed here: it is removed by
 * supabase.auth.signOut({ scope: 'local' }).
 */
import { safeStorage } from '@/lib/safeStorage';
import { USER_ALIAS_STORAGE_KEY, USER_PASSWORD_STORAGE_KEY } from '@/lib/supabase';
import { SHIFT_PROGRESS_STORAGE_KEY } from '@/stores/shiftProgress';

export const PLAYER_DATA_KEYS: readonly string[] = [
  USER_ALIAS_STORAGE_KEY,
  USER_PASSWORD_STORAGE_KEY,
  'atc-app_passed_levels_v1', // monetization store
  SHIFT_PROGRESS_STORAGE_KEY, // shiftProgress store
  'atc-app_game', // game store (pinia persist: highScore) + legacy save
  'atc-app_high_score', // game store high score
];

export function clearAppLocalData(): void {
  for (const key of PLAYER_DATA_KEYS) {
    try {
      safeStorage.removeItem(key);
    } catch {
      // safeStorage never throws; belt and braces
    }
  }
}
