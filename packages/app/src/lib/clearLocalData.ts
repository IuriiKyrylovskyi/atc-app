/**
 * packages/app/src/lib/clearLocalData.ts
 *
 * Removes every piece of player data this app keeps on the device. Used by
 * "Delete account". Device preferences (atc-app_settings: haptics, update
 * checks) are deliberately kept.
 *
 * The Supabase session (sb-…-auth-token) is NOT listed here: it is removed by
 * supabase.auth.signOut({ scope: 'local' }).
 */
import { safeStorage } from '@/lib/safeStorage';
import { USER_ALIAS_STORAGE_KEY, USER_PASSWORD_STORAGE_KEY } from '@/lib/supabase';

export const PLAYER_DATA_KEYS: readonly string[] = [
  USER_ALIAS_STORAGE_KEY,
  USER_PASSWORD_STORAGE_KEY,
  // Add game/progress keys here when the game is ported.
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
