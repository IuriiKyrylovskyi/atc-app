/**
 * packages/app/src/config/env.ts
 *
 * The one place the app reads its Vite env vars (packages/app/.env.local).
 * Every value falls back to `mocked_<VAR NAME>`, so the app still starts with
 * no .env file at all. Replace the mocked values in .env.local with the real
 * atc-app ones.
 *
 * Everything here ships inside the client bundle, so only public values belong
 * in VITE_ vars (Supabase URL + anon key, RevenueCat public SDK keys, AdMob unit
 * ids). Server secrets (service-role keys, webhook secrets, Paddle server keys)
 * must never be read here.
 *
 * `import.meta.env.DEV` is Vite's own build-mode flag, not an .env value, so
 * it is still read directly where it is used.
 */
const env = import.meta.env;

export const ENV = {
  // Supabase
  VITE_SUPABASE_URL: env.VITE_SUPABASE_URL ?? 'mocked_VITE_SUPABASE_URL',
  VITE_SUPABASE_ANON_KEY: env.VITE_SUPABASE_ANON_KEY ?? 'mocked_VITE_SUPABASE_ANON_KEY',

  // RevenueCat (public SDK keys)
  VITE_RC_IOS_KEY: env.VITE_RC_IOS_KEY ?? 'mocked_VITE_RC_IOS_KEY',
  VITE_RC_ANDROID_KEY: env.VITE_RC_ANDROID_KEY ?? 'mocked_VITE_RC_ANDROID_KEY',
  // 'true' | 'false' | '' — empty means "sandbox in dev builds only".
  VITE_RC_WEB_SANDBOX: env.VITE_RC_WEB_SANDBOX ?? 'mocked_VITE_RC_WEB_SANDBOX',

  // AdMob interstitial unit ids
  VITE_ADMOB_INTERSTITIAL_ID_ANDROID:
    env.VITE_ADMOB_INTERSTITIAL_ID_ANDROID ?? 'mocked_VITE_ADMOB_INTERSTITIAL_ID_ANDROID',
  VITE_ADMOB_INTERSTITIAL_ID_IOS:
    env.VITE_ADMOB_INTERSTITIAL_ID_IOS ?? 'mocked_VITE_ADMOB_INTERSTITIAL_ID_IOS',

  // Mobile / web version check
  VITE_VERSION_CHECK_URL: env.VITE_VERSION_CHECK_URL ?? 'mocked_VITE_VERSION_CHECK_URL',

  // 'true' loads levels_full_example.json locally instead of the paid bucket (dev only).
  VITE_USE_LOCAL_FULL_LEVELS: env.VITE_USE_LOCAL_FULL_LEVELS ?? 'mocked_VITE_USE_LOCAL_FULL_LEVELS',

  // Radar scope (new ATC engine, in development). Always on in dev builds; 'true' enables it elsewhere.
  VITE_FEATURE_SCOPE: env.VITE_FEATURE_SCOPE ?? 'mocked_VITE_FEATURE_SCOPE',

  // Debug overlay + paywall debug block. 'true' turns them on.
  VITE_SHOW_DEBUG: env.VITE_SHOW_DEBUG ?? 'mocked_VITE_SHOW_DEBUG',
} as Record<
  | 'VITE_SUPABASE_URL'
  | 'VITE_SUPABASE_ANON_KEY'
  | 'VITE_RC_IOS_KEY'
  | 'VITE_RC_ANDROID_KEY'
  | 'VITE_RC_WEB_SANDBOX'
  | 'VITE_ADMOB_INTERSTITIAL_ID_ANDROID'
  | 'VITE_ADMOB_INTERSTITIAL_ID_IOS'
  | 'VITE_VERSION_CHECK_URL'
  | 'VITE_USE_LOCAL_FULL_LEVELS'
  | 'VITE_FEATURE_SCOPE'
  | 'VITE_SHOW_DEBUG',
  string
>;

/** True while a value is still the `mocked_` placeholder. */
export const isMocked = (value: string): boolean => value.startsWith('mocked_');
