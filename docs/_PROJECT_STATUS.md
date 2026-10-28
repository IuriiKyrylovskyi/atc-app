# ATC-APP content pipeline — status & checklist

Compact summary + what's left, broken into small pieces to do one at a time.
✅ = done this thread. 🔲 = not started. Each 🔲 lists exactly which files it touches.

---

## Latest update — two important fixes

1. **Free levels moved off bundling entirely.** Every ratio×dpr×format
   combination for every free level used to ship in the app bundle even
   though a device only ever uses one — real app-size waste, worse on
   mobile. Free and paid backgrounds now both download on demand and cache
   locally, via one unified `backgroundAssetService.getBackgroundForLevel()`.
   Only difference: free levels hit a new **public** `game_assets_public`
   bucket (no auth), paid levels hit the existing private `game_assets`
   bucket (RLS). **Action needed**: create the `game_assets_public` bucket in
   Supabase (toggle "Public bucket" on, no policy needed), then run
   `pnpm build:levels && pnpm upload:free-backgrounds`.
2. **Runway positioning bug fixed**: the background is stretched with
   _different_ X and Y scale factors per ratio (visible in the debug overlay
   as a non-square `bg scale`). A single precomputed length+angle scaled by
   one factor was wrong on every ratio except the one it was tuned against —
   only _position_ was ever actually correct. Runways now need their two
   threshold endpoints (`masterX1/Y1`, `masterX2/Y2`), each projected
   independently; length/direction are derived at runtime, not authored.
   **Every runway migrated so far (levels 1–4) needs re-doing** with
   `pnpm runway runway <level> 16x9 <runwayId> <x1> <y1> <x2> <y2>` — the old
   single-point data still works via a fallback path but is now known-
   approximate off the 16x9 baseline.

---

## Done so far (for context, no action needed)

- **Background build pipeline**: `process-backgrounds.ts` generates per-ratio ×
  dpr × format variants + a merged `manifest.json` (free) / `manifest-paid.json`
  (paid, routed by `freeLevelLimit`, never bundled).
- **Paid background security**: moved from a public `getPublicUrl()` bucket to
  the private `game_assets` bucket (same RLS as `levels_full.json`), via
  `backgroundAssetService.ts` — resolve → download → checksum → cache.
- **Runtime variant selection**: `backgroundVariantResolver.ts`, shared by free
  (`assetLoader.ts`) and paid (`backgroundAssetService.ts`) loaders.
- **Purchase flow**: `monetization.ts` hydrates paid JSON + current + next-level
  background after purchase/restore.
- **Runway positioning**: fixed a regression I introduced (nested vs flat crop
  fields) that was silently breaking every master-point-based runway. Removed
  dead `positionOverrides` and duplicative per-ratio `masterPositions`.
  Promoted single-point `masterX`/`masterY` (+ new `masterLength`/`masterWidth`)
  as the only real mechanism — one point + one length, auto-scaled per ratio.
  **All levels (1–6) migrated** to two-endpoint form (`masterX1/Y1/masterX2/Y2`).
  Level-3 runway re-measured against the new 5048×3328 master. Level-4 rw06
  migrated from single-point to two-endpoint form.
- **Master image spec**: 5048×3328 canonical canvas (was 4800×2160), documented + self-checked by the build script (`expectedMasterWidth`/`Height`, warns on mismatch).
- **Background stretching fix**: Removed `object-fit: contain` from `AirTrafficCanvas.vue` — it was conflicting with Phaser's cover-scaling via `worldContainer.getWorldScale()`, causing non-uniform background stretch on non-16:9 screens.
- **Tooling**: `generate-master-runway-coords.ts` rebuilt against the new
  manifest (was reading files that no longer exist) — `pick`/`measure`/`verify`.

---

## Piece 1 — Finish the runway migration (levels 4 & 5)

**Status**: ✅ All runways migrated to two-endpoint form across all levels (1–6).

- ✅ Level-3 `level3-rwy09` re-measured against the new 5048×3328 master → `masterX1: 2300, masterY1: 1537, masterX2: 3555, masterY2: 1597`
- ✅ Level-4 `level4-rw06` migrated from single-point to two-endpoint form
- ✅ Level-4 rw24, rw15 already in two-endpoint form
- ✅ Levels 5 & 6 runways already in two-endpoint form
- 🔲 Run `verify` for every migrated runway against the _actual_
  currently-shipped per-ratio PNGs — flagged last time that these may predate
  the current `raw_assets/level-N-master.png` files and not agree → **no file
  changes, just confirms whether regeneration is needed**

## Piece 2 — Regenerate backgrounds against the master spec

**Status**: ✅ Level-3 master regenerated at 5048×3328, manifest rebuilt, runway coordinates re-measured.

- ✅ Level-3 master re-exported at 5048×3328
- ✅ `pnpm build:levels` run — manifest regenerated with correct crops
- ✅ Level-3 runway coordinates re-measured against new master
- 🔲 For paid levels (4+), run `pnpm upload:paid-backgrounds` after
  regenerating → **files: none, just running scripts**
- 🔲 Upload free-level backgrounds to the public bucket:
  `pnpm upload:free-backgrounds` → **files: none, just running scripts**

## Piece 3 — Delete `atc-app_levels_full.json` + fix its code path

**Status**: ✅ already implemented in the repo.

The old public fallback path is no longer part of the runtime: there is no
`packages/app/public/atc-app_levels_full.json` file in the tree, and
`levelManager.ts` now relies on the private Supabase download path plus the
local-only `VITE_USE_LOCAL_FULL_LEVELS` dev override. The dev fallback path
that used to read a public file is gone.

- ✅ Confirmed: no public `atc-app_levels_full.json` file remains in
  `packages/app/public/`
- ✅ Confirmed: `levelManager.ts` no longer uses a public `fetch('/atc-app_levels_full.json')`
  fallback
- ✅ Confirmed: the local example file is loaded via dynamic `import()` in the
  `VITE_USE_LOCAL_FULL_LEVELS` branches only

## Piece 4 — Deduplicate the levels JSON files

**Status**: ✅ mostly implemented in the repo.

The current tree already reflects the intended split:

- ✅ `levels_basic.json` remains the bundled free-level file
- ✅ `levels_full_example.json` remains the local dev/example file only
- ✅ The master paid-level payload now lives in `content/levels_full.json`
- ✅ `scripts/upload-paid-levels.ts` uploads that file to the private
  `game_assets` bucket as `levels_full.json`
- ✅ `package.json` exposes `upload:paid-levels` for the release pipeline

The remaining follow-up is content-level, not repository-structure work:

- ⚠️ `levels_basic.json`'s level 2 includes a 4th runway (`RWY27L`) that the
  premium payload does not; that should be treated as a content decision, not
  silently merged in code.

**How to detect "in use" going forward**: `grep -rn "from '@/assets/levels" packages/app/src`
for static imports, and `find packages/app/dist -name "levels*.json"` after a
prod build to catch anything that leaked into the bundle.

## Piece 5 — Dev/prod background caching fixes

**Status**: 🟡 partially implemented.

The non-native path already uses IndexedDB rather than Cache Storage, which
addresses the Electron/file:// issue. What remains is the dev-only override
path so you can point the loader at a local server without needing a live
premium account.

- ✅ `backgroundAssetService.ts` uses IndexedDB for web/Electron blob caching
- 🔲 Add a `VITE_LOCAL_BACKGROUNDS_URL` dev override — when set, fetch the
  manifest + binaries from a local static server instead of Supabase, so you
  can test the paid-background flow without a live premium test account →
  **file: `backgroundAssetService.ts`**
- 🔲 Add a small local static server for that override (`serve
dist_remote_assets -l 8787`) → **new devDependency + `package.json` script**

## Piece 6 — README / doc cleanup

- ✅ `LevelBackgrounds.md` — updated (master spec, masterX/Y workflow)
- 🔲 `LevelBackgroundsV2.md` — describes a "Super-Canvas" + brightness/
  saturation muting workflow that was never actually implemented (no muting
  step exists in `process-backgrounds.ts`). Recommend **deleting** it — it'll
  just confuse the next person. Its one correct idea (large master canvas) is
  now folded into `LevelBackgrounds.md`'s spec.
- 🔲 `ASSET_STRUCTURE.md` — still shows a stale single-file `backgrounds/06.png`
  example; needs the manifest/`dist_remote_assets` split described
- 🔲 `SUPABASE_SETUP.md` — needs the `game_assets/backgrounds/` prefix, the
  `levels_full.json` relocation from Piece 4, and updated security checklist
  items (paid backgrounds uploaded, old public bucket deleted)
- ✅ `BACKGROUND_ASSETS.md`, `PAID_BACKGROUND_MIGRATION.md` — already current

## Piece 7 — Verification (do last, after the above)

- 🔲 Free levels load with no network (airplane mode / offline dev tools)
- 🔲 Premium user gets correct paid JSON + backgrounds, free user's requests
  never hit the paid bucket at all
- 🔲 Runway collision circles align with painted runways on at least 16x9 +
  one zoomed mobile ratio, for every migrated level
- 🔲 Level-3 background renders correctly (no stretching) on all ratios —
  verify after uploading new assets to Supabase Storage
- 🔲 Bundle size / first-load time before vs. after (paid content should no
  longer inflate the free bundle)
- 🔲 Web, Android, iOS, Electron — Electron especially, given Piece 5

---

**Suggested order**: Piece 3 (security, quick) → Piece 4 (cleanup, quick) →
Piece 2 (upload backgrounds to Supabase) → Piece 7 (verification, including
level-3 background fix) → Piece 5 (Electron fix) → Piece 6 (docs, can happen
anytime).

Tell me which piece to do next and I'll just do that one.
