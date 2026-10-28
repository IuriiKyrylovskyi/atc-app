# Background Assets — Implementation Plan

## Purpose

This document describes a concrete, testable plan to implement the recommended
single-master + per-crop metadata approach for backgrounds in the atc-app game.
It covers build-time image generation, DPR derivatives, compressed outputs,
metadata schema, runtime loader changes, world mapping, runway alignment,
tests, QA, CI checks, and size-budget enforcement so quality remains high and
downloads remain reasonable.

## Goals / Non-functional requirements

- Accurate runway overlay: runway polygons drawn in-game must align visually
  (pixel-perfect within 1 logical pixel at target DPRs) with the background.
- No blur at supported DPRs (target DPRs 1 and 2 by default; optional 3).
- Reasonable download sizes: mobile 1× ≤ 3 MB, mobile 2× ≤ 6 MB, desktop
  default ≤ 8 MB. Optional HD master may be larger but delivered on-demand.
- Maintain single source of truth: master artwork per level; crops and
  metadata generated deterministically at build-time.
- Backwards compatibility: app keeps loading a single background per device
  while we migrate to metadata-driven mapping.

## High-level approach

1. Use one high-resolution master PNG for each level (stored in `raw_assets/`).
2. Build-time script (`scripts/process-backgrounds.ts`) generates for each
   target aspect-ratio and DPR a cropped/resized image and writes a metadata
   JSON describing the visibleRect and produced derivatives.
3. At runtime `assetLoader` loads the chosen image and its metadata; `GameScene`
   uses metadata to compute scale & offset so master-image coordinates map
   exactly into game world coordinates. Runways are specified in master-image
   coordinates (or normalized 0..1) and projected by the same mapper.
4. Ship only the DPR variant that best fits the device at install time; lazy
   load higher-quality derivative if needed.

## Metadata schema (recommended)

Filename: `packages/app/src/assets/backgrounds/meta/level-<N>-<ratio>.json`

Example JSON:

{
"level": 1,
"ratio": "20x9",
"sourceFile": "raw_assets/level-1-master.png",
"srcW": 3840,
"srcH": 2160,
"cropLeft": 200,
"cropTop": 80,
"cropW": 3040,
"cropH": 1350,
"zoom": 1.25,
"dprVariants": [
{ "scale": 1, "file": "20x9/level-1@1x.webp", "size": 1324000 },
{ "scale": 2, "file": "20x9/level-1@2x.webp", "size": 4220000 }
],
"timestamp": 1697440000000
}

Field notes:

- `cropLeft, cropTop, cropW, cropH`: rectangle in master pixels that was
  extracted/resized to produce the target aspect ratio at a given DPR.
- `dprVariants`: list of produced DPR derivatives, with file paths and sizes.

## Build-time changes (scripts)

Modify `scripts/process-backgrounds.ts` to:

- Write one metadata JSON per produced variant adjacent to the image.
- Produce DPR derivatives: `@1x`, `@2x` (configurable); output WebP by
  default, keep PNG option for debug.
- Add a `--meta-only` flag to emit only metadata without re-encoding images.
- Add `--force` and `--skip-existing` as overwrite controls.
- Add a `--size-limit` option that warns or downscales if output exceeds a
  configured byte budget.

## Runtime changes (app)

1. `packages/app/src/game/utils/assetLoader.ts`

   - When loading a background, also attempt to load the matching metadata JSON
     via `import.meta.glob` (or synchronous fetch where necessary).
   - Expose `{ imagePath, metadata }` so callers can read `metadata.visibleRect`.

2. `packages/app/src/game/scenes/GameScene.ts`

   - After background texture is loaded, read metadata and compute visibleRect
     in master pixels.
   - Compute scale `s = WORLD_W / visibleRect.w` (or use height-driven policy
     if desired) and apply: `worldContainer.scale = s`.
   - Position `worldContainer` so visibleRect maps to the camera viewport:
     `worldContainer.x = camW/2 - visibleRect.x * s`, `worldContainer.y = camH/2 - visibleRect.y * s`.
   - Set camera / gameplay bounds to the visibleRect mapped through `s`.
   - If no metadata present, fall back to existing fraction-based conversion.

3. Runway / game coordinate storage
   - Recommended: store runway corners in master-image pixels (preferred for
     precision) or normalized fractions (0..1) and compute master pixels at
     load-time using `srcW/srcH` from metadata.

## Migration strategy

- Start by emitting metadata for all variants (Step 1). Do NOT change runtime.
- Add loader support that reads metadata when available but continues to work
  with old behavior (fallback). This is backward-compatible.
- Once metadata is available and validated, enable `GameScene` mapping for
  selected levels behind a feature flag. Validate visually.

## DPR & quality strategy

- Default support: 1× and 2× derivatives. Optionally 3× if necessary.
- Prefer WebP/AVIF for downloads; tune quality to preserve runway edges (start
  at quality=80 and inspect). Produce a small visual QA overlay.
- Do not ship a single huge master to all users. Use DPR derivatives and lazy
  high-res download. Offer optional HD download for desktop users.

## Size budgets & enforcement

- Add `--size-limit` to script; default budgets per ratio/DPR.
- On exceed:
  - If `--auto-downsample` is set: downsample derivative until under budget.
  - Otherwise warn and write a size-report file `packages/app/src/assets/backgrounds/size-report.json`.

## Tests and QA

- Unit tests: converter functions (project master → world), metadata parser,
  DPR picker.
- Integration: run `pnpm dev` locally, load a sample level, visually confirm
  runway overlay and that `worldContainer` mapping matches visible background.
- Visual QA: script option to produce annotated PNGs showing runway polygon
  overlay on each variant for designer sign-off.

## CI & automation

- Add CI job (optional lightweight) to run `scripts/process-backgrounds.ts --meta-only --level 1` and assert metadata shape.
- Optionally produce a small cached artifact of QA images for PR reviews.

## Acceptance criteria

1. Running `npx ts-node scripts/process-backgrounds.ts --level 1` writes PNG/WebP files
   and metadata JSON in `packages/app/src/assets/backgrounds/*/`.
2. `assetLoader.loadBackgroundImages(1)` returns image path and a metadata object.
3. On enabling mapping, runway overlay aligns visually (pixel-perfect at DPR 1/2) with generated background for sample level.
4. Size-report shows derivatives within configured budgets or the script auto-downscaled.

## Estimated effort

- Step 1 (emit metadata + DPR derivatives + WebP): 2–4 hours
- Step 2 (loader + metadata exposure): 1–2 hours
- Step 3 (GameScene mapping + QA): 3–5 hours
- Step 4 (tests, CI, docs): 2–4 hours

## Next actions (immediate)

1. Implement Step 1: update `scripts/process-backgrounds.ts` to emit metadata and produce @1x/@2x WebP derivatives, plus a size report.
2. Re-generate for `--level 1` and inspect `packages/app/src/assets/backgrounds/meta/level-1-*.json`.

If this plan looks good, I will implement Step 1 now and run it for `--level 1`.
