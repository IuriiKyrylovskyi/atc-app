/**
 * packages/app/src/lib/supabase.ts
 *
 * Supabase client singleton.
 * Import this everywhere — never call createClient() directly.
 */
import { createClient } from '@supabase/supabase-js';
import { safeStorage } from '@/lib/safeStorage';
import { ENV, isMocked } from '@/config/env';

// supabase-js throws at import time unless the URL is http(s), which would take
// the whole app down while the .env values are still `mocked_`. Swap in an
// unroutable URL so the app boots and every Supabase call just fails offline.
const MOCKED_SUPABASE_URL = 'https://mocked-supabase-url.invalid';
const configuredUrl = ENV.VITE_SUPABASE_URL;
if (isMocked(configuredUrl)) {
  console.warn('⚠️ VITE_SUPABASE_URL is mocked — Supabase calls will fail until it is set.');
}
export const supabaseUrl = /^https?:\/\//.test(configuredUrl) ? configuredUrl : MOCKED_SUPABASE_URL;
export const supabaseAnonKey = ENV.VITE_SUPABASE_ANON_KEY as string;
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    '❌ Missing Supabase env vars.\n' +
      'Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in packages/app/.env.local\n' +
      'See SUPABASE_SETUP.md for instructions.'
  );
}

/**
 * Plain fetch everywhere. Supabase's API answers CORS preflights for any
 * origin, so no native HTTP shim is needed.
 *
 * Do NOT pass `CapacitorHttp.fetch` here: CapacitorHttp has no `fetch` method
 * (only request/get/post/...). It is a plugin proxy, so `.fetch` resolves to a
 * native call that rejects with {"code":"UNIMPLEMENTED"} - which Supabase
 * reports as AuthRetryableFetchError (status 0).
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    // Same localStorage as before, but never throws and falls back to memory.
    storage: safeStorage,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

/** Convenience: typed profile row shape */
export interface Profile {
  id: string;
  account_id: string | null;
  is_premium: boolean;
  last_passed_level: string | null;
  passed_levels: Record<string, string> | null;
  platform: 'ios' | 'android' | 'electron' | 'web';
  rc_customer_id: string | null;
  purchased_at: string | null;
  updated_at: string;
}

/** Stable anonymous identity alias used for cross-device restore. */
export const USER_ALIAS_STORAGE_KEY = 'atc-app_user_alias_v1';
/** Private recovery token shown once after purchase. */
export const USER_PASSWORD_STORAGE_KEY = 'atc-app_user_password_v1';

// There is deliberately NO storage key for the recovery word. Unlike the alias
// and password it is not needed to bind RevenueCat on first launch, so the
// server stays the single source of truth and the word is never written to
// disk. `loadAccount()` re-reads it from get_account_for_device every launch.
