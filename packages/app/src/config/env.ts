/**
 * packages/app/src/config/env.ts
 *
 * Every value the app used to read from `.env` / `.env.local`, as plain
 * strings. They are placeholders for now: replace them here (and only here)
 * with the real atc-app values.
 *
 * Everything in this file ships inside the client bundle, so only put public
 * values here (Supabase URL + anon key, RevenueCat public SDK keys, AdMob unit
 * ids). Server secrets (service-role keys, webhook secrets, Paddle server keys)
 * must never be added.
 *
 * `import.meta.env.DEV` is Vite's own build-mode flag, not an .env value, so
 * it is still read directly where it is used.
 */
export const ENV = {
  // Supabase
  VITE_SUPABASE_URL: 'https://YOUR_PROJECT_REF.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'YOUR_SUPABASE_ANON_KEY',

  // RevenueCat (public SDK keys)
  VITE_RC_IOS_KEY: 'YOUR_REVENUECAT_IOS_KEY',
  VITE_RC_ANDROID_KEY: 'YOUR_REVENUECAT_ANDROID_KEY',
  // 'true' | 'false' | '' — empty means "sandbox in dev builds only".
  VITE_RC_WEB_SANDBOX: '',

  // AdMob interstitial unit ids
  VITE_ADMOB_INTERSTITIAL_ID_ANDROID: 'YOUR_ADMOB_INTERSTITIAL_ID_ANDROID',
  VITE_ADMOB_INTERSTITIAL_ID_IOS: 'YOUR_ADMOB_INTERSTITIAL_ID_IOS',

  // Mobile / web version check
  VITE_VERSION_CHECK_URL: '',

  // Debug overlay + paywall debug block. 'true' turns them on.
  VITE_SHOW_DEBUG: 'false',
};
