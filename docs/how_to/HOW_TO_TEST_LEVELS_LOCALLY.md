# HOW TO: Test Levels Locally

This guide shows quick, safe ways to test full (premium) levels locally during development.

Prerequisites

- `packages/app/src/assets/levels_full_example.json` exists (included in the repo).
- Node + pnpm installed.

1. Copy the example into the dev server public folder (auto-run on `dev`)

- The app includes a script to copy the example into `packages/app/public/atc-app_levels_full.json`.
- Manual copy (one-time):

  cd packages/app
  pnpm run cache-local-levels

- Or simply run the dev server from the root — the `predev` hook runs the copy automatically:

  pnpm --filter @atc-app/app run dev

2. Opt into the local full-levels override

- Create or edit `packages/app/.env.local` and add:

  VITE_USE_LOCAL_FULL_LEVELS=true

- This tells `LevelManager` to use the bundled `levels_full_example.json` (for premium downloads) instead of fetching from Supabase.

3. Make a test account premium (recommended)

- The app still enforces premium gating: `LevelManager` only returns full levels for premium users.
- The recommended method is to mark your test user as premium in Supabase:
  - Open Supabase Studio → `public.profiles` → find your test user's `id` → set `is_premium = true`.

4. Quick dev-only premium override (temporary)

- If you prefer not to touch Supabase, you can enable premium locally in dev by editing the store temporarily (do NOT ship this change):

  In `packages/app/src/stores/monetization.ts` temporarily set the initial value or force in `dev`:

  ```ts
  const isPremium = ref(false);
  if (import.meta.env.DEV) {
    // DEV ONLY — forces premium while developing
    isPremium.value = true;
  }
  ```

  - Revert this change before committing.

5. Start the app and verify

- Start dev server (if not already running):

  pnpm --filter @atc-app/app run dev

- Open browser console and look for logs from `LevelManager`:

  - `Using local full levels (VITE_USE_LOCAL_FULL_LEVELS)` indicates the example file was used.
  - `Full levels downloaded and cached` will appear if the file was written to cache.

- Confirm local cache: `localStorage.getItem('atc-app_levels_full')` should contain the JSON.

6. Clearing cache / Reset

- To force re-copy / re-cache after edits:

  pnpm --filter @atc-app/app run cache-local-levels

  then refresh the page and clear `localStorage` key `atc-app_levels_full` in DevTools Application tab.

7. Troubleshooting

- If you see rendering errors referencing missing backgrounds (e.g. `drawImage` null): ensure the background images referenced by your level entries exist in `packages/app/src/assets/backgrounds/` (or adjust `backgroundImage` fields to existing assets).
- If `LevelManager` still returns `levels_basic.json`, confirm the current user is premium (Supabase profile) or that you used the dev premium override.

Security notes

- `VITE_USE_LOCAL_FULL_LEVELS` and the dev premium override are for development only — do not enable them in production or commit them to main.
- Production distribution uses `levels_basic.json` for free users and `levels_full.json` only from Supabase Storage for premium users.

If you want, I can also:

- add a dev UI toggle (hidden behind `import.meta.env.DEV`) to force premium locally, or
- implement a temporary `VITE_FORCE_FULL_LEVELS` flag that bypasses premium gating strictly for dev builds.
