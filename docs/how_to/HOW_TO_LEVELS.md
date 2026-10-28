# HOW_TO: Levels — Local testing vs Supabase deployment

This guide explains how the app loads level data, how to test with a local full-levels file, and how to publish `levels_full.json` to Supabase Storage for production.

Files referenced

- Bundled free levels: [packages/app/src/assets/levels_basic.json](packages/app/src/assets/levels_basic.json)
- Dev/full example: [packages/app/src/assets/levels_full_example.json](packages/app/src/assets/levels_full_example.json)
- Production full levels (upload to Supabase): `levels_full.json` in the `game_assets` bucket

How the app chooses level data

- Free users: always use the bundled `levels_basic.json` (no network).
- Premium users: `LevelManager.getLevelData()` will return cached full levels (if previously downloaded), otherwise it will download `levels_full.json` from Supabase Storage and cache it.

Local development override (quick testing)

1. Purpose: use a local full-levels file during development instead of requiring Supabase downloads.
2. Edit `packages/app/.env.local` (create if missing) and add:

```
VITE_USE_LOCAL_FULL_LEVELS=true
```

3. The app already includes a development example at `packages/app/src/assets/levels_full_example.json`.

   - With the env flag set the `LevelManager` will load that file and write it to the local cache (same key used for cached production file).
   - This enables testing premium-only levels (e.g., levels 6 & 7) without Supabase or a paid account.

4. Important: this flag is for development only. Do NOT ship `VITE_USE_LOCAL_FULL_LEVELS=true` or include `levels_full_example.json` in production builds.

Supabase production flow (recommended)

1. Create and upload `levels_full.json` to the private bucket `game_assets` in Supabase Storage (see `SUPABASE_SETUP.md`):
   - Bucket: `game_assets` (created by SQL in SUPABASE_SETUP.md)
   - File name: `levels_full.json` (root of the bucket)
2. Ensure RLS policy on `storage.objects` only allows downloads to premium users (SQL in SUPABASE_SETUP.md adds this policy).
3. Premium users authenticated via Supabase will be able to download `levels_full.json` at runtime; the app caches the downloaded file locally as `atc-app_levels_full`.

Caching & clearing cache

- Web/Electron: cached JSON is written to `localStorage` under the key `atc-app_levels_full`.
- Mobile (Capacitor): cached JSON is written to the Capacitor Data directory as `atc-app_levels_full.json`.
- To force a re-download after updating `levels_full.json` on Supabase, call `LevelManager.clearCache()` (exposed API) or remove the cached file/`localStorage` key.

Testing checklist

- Set `x` and run the dev server to test premium levels locally.
- Verify the `LevelManager` console logs: it should print `Using local full levels` when the flag is active.
- Verify backgrounds and assets referenced by the full levels exist (missing assets will cause runtime rendering errors).
- To test the Supabase path, set the correct `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` and ensure your test account in Supabase has `is_premium = true` in `profiles` or use a premium test user.

Security reminders

- `levels_basic.json` must never contain premium-only content — keep free levels minimal.
- `levels_full.json` should be stored only in the private `game_assets` bucket and delivered only by authenticated, premium users via Supabase storage policies.

Support

- See `packages/app/src/services/levelManager.ts` for the runtime behavior and caching logic.
- See `SUPABASE_SETUP.md` for upload and RLS details.

If you want, I can:

- add a small dev script to copy `levels_full_example.json` to the cache path automatically, or
- create a GitHub Action to upload `levels_full.json` to Supabase Storage when you tag a release.
