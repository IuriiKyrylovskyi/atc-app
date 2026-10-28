# HOW TO: How the App Is Downloaded On Device

This document explains what the user downloads on first install (free levels), what is downloaded later when the user purchases the full game, and realistic size expectations and mitigation strategies for background images and other assets.

## Summary

- First install (app store / Play Store / Electron package): the app binary + bundled assets. The bundle always contains:

  - Application code and runtime (Vue + Phaser + native wrappers)
  - `levels_basic.json` (bundled free levels — currently levels 1–3)
  - Core assets required for the free experience (UI icons, plane sprites, audio used in free levels, and at least the `16x9` background variant for free levels)

- Purchasing the full game does NOT have to increase the _app store download size_. Instead the app downloads the premium content (metadata and assets) from Supabase Storage at runtime and caches it locally.

## What happens on first run

- The user installs the app from the App Store / Play Store / the packaged Electron app. That installer contains only the bundled free content and core assets.
- On first run the app performs these quick steps:
  1. Load local configuration and stores (instant, from disk/localStorage).
  2. Initialize auth and monetization (`monetizationStore.init()`).
  3. If the user is premium the `LevelManager` attempts to read a cached full-levels file. If none, it downloads `levels_full.json` from Supabase Storage (authenticated path) and caches it.

## Which files are bundled vs downloaded

- Bundled (inside installer):

  - `levels_basic.json` (free levels) — always present.
  - Minimum background variants for free levels (recommended: at least `16x9`).
  - Plane sprites, common UI assets, default audio used by free levels and the UI.

- Downloaded after purchase (recommended setup):
  - `levels_full.json` (metadata list of premium levels, runways, waypoints, asset keys).
  - Background image files for premium levels — downloaded lazily per level when the level is first started (recommended), not all at once.
  - Any premium-only audio or large assets referenced only by premium levels.

## Expected sizes & worked examples

Notes: actual sizes vary based on compression, format (PNG / JPG / WebP), and whether high-quality masters are included in the bundle.

- Background images (recommended compressed targets):

  - Unoptimised 1920×1080 PNG: 3–5 MB (raw export)
  - Optimised PNG / JPG / WebP: **~200–700 KB** per 1920×1080 variant (use `pngquant`, `mozjpeg`, or WebP with quality 75–85)

- Per-level typical download cost (recommended minimal shipping):

  - If you store only `16x9` per level (one compressed file, 300–600 KB): ~0.3–0.6 MB per level.
  - If you provide 3 variants per level (16x9 + 20x9 + 19_5x9): ~0.9–1.8 MB per level.

- Example: unlocking `levels 6–50` (45 paid levels):

  - If 1 variant / level at 0.5 MB: ~22.5 MB total (downloaded lazily as player opens levels)
  - If 3 variants / level at 1.2 MB: ~54 MB total

- Other assets:
  - Plane sprites (6 colours + shadow per type) — typically << 1 MB total if compressed properly (icons at 690 px after pngquant often ~5–40 KB each). These are usually bundled in the app.
  - Music & SFX — can add 1–30 MB depending on quality and number of tracks. Prefer compressed formats (OGG/AAC) and stream large music when needed.

## Trade-offs and recommendations to minimise downloads

- Minimise what ships in the installer:

  - Bundle only the free-level backgrounds (prefer `16x9` fallback) and essential UI/plane/audio assets.
  - Avoid bundling _every_ ratio variant for every level — the loader falls back gracefully to `16x9`.

- Lazy-download assets for premium content:

  - Keep `levels_full.json` small (metadata only). After purchase download `levels_full.json` first, then download background images only when the player starts a premium level.
  - Cache downloaded assets on device (filesystem on mobile, IndexedDB/browser cache on web/Electron). Reuse cache across sessions.

- Prefer modern compressed formats and a single best-device variant:

  - If you control server-side delivery, detect device ratio on the client and request only that variant (e.g., fetch `20x9` for a 20:9 device). This reduces bytes transferred vs fetching all variants.
  - Consider generating and serving WebP/JPEG-XL variants for web and modern Android to reduce bandwidth.

- Progressive download UX:
  - Show a low-resolution placeholder or a blurred `16x9` fallback while the device-specific variant downloads.
  - Download the higher-res or alternate-ratio only when needed (when the player opens a level or when the app is on Wi‑Fi and the user permits background downloads).

## Caveats & platform differences

- App store package size vs runtime downloads:

  - The App Store / Play Store download size includes only the bundled assets. Runtime downloads (Supabase) do not increase the original installer size, but they do increase disk usage on the device after the download.

- Mobile considerations:

  - On iOS and Android, prefer writing cached files to the app's sandboxed data directory (Capacitor Filesystem) to avoid accidental purging and to respect platform storage quotas.
  - Respect the user's cellular-data settings: delay non-essential downloads until Wi‑Fi if the file is large.

- Desktop / Electron:
  - Use the same lazy-download approach; cache to a known app-data folder. Electron installers usually include the free content but not premium assets.

## How the cache increases app size after purchase

- The app binary (bundle) does not change after the user purchases.
- The device storage used by the app increases as the client downloads and caches premium assets:
  - `levels_full.json` (small, < 100 KB typically)
  - background PNG/JPG/WebP files for each premium level the player opens — each file adds its compressed size to the app's disk usage
  - optionally audio/music files, if downloaded on demand

## Practical rules of thumb

- If you aim to keep the _runtime_ storage growth low: ship one compressed variant per level and lazy-load the rest on demand.
- If you expect players to play many different levels frequently, pre-warm future-level assets when on Wi‑Fi in the background.
- Aim for compressed backgrounds ≈ 300–600 KB per variant and music < 1–5 MB per track.

## Checklist for release to control download size

- [ ] Only bundle required assets for free levels (keep `levels_basic.json` minimal).
- [ ] Compress all backgrounds with `pngquant`/WebP and strip metadata.
- [ ] Implement device-ratio selection: download only the needed aspect variant on demand.
- [ ] Cache full-levels JSON and downloaded background files to the app data directory with a version field so updates can be pruned.
- [ ] Provide an in-app setting for users to allow background prefetch on Wi‑Fi.

## References and related docs

- Background sizing and folders: `packages/app/src/assets/LevelBackgrounds.md`
- Level delivery strategy: `packages/app/src/services/levelManager.ts`
- Local testing & example full-level file: `packages/app/src/assets/levels_full_example.json` and `docs/HOW_TO/HOW_TO_TEST_LEVELS_LOCALLY.md`

If you want, I can:

- add a small script to estimate total download size for a given `levels_full.json` (sum compressed sizes of referenced backgrounds), or
- implement server-side endpoints to return per-level download-size metadata to show to users before purchase.
