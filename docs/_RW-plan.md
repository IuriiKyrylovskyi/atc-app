You're correct — the runway should look like a constant object on the background image, meaning it scales with the background, not independently with the world container. Defining runway size in master-image pixels achieves exactly this: the runway's visual proportion relative to the background stays the same on every screen and ratio.

Here's the refined plan:

---

## RW Settings Plan — Master-Pixel Runway Position & Size

### Goal

Runways appear at the same position and the same visual size relative to the background image on every screen size and aspect ratio. The runway is a "constant object on the bg image" — it moves and scales with the background, not independently.

### Root Causes Addressed

| Problem                             | Cause                                                                                          | Fix                                                                         |
| ----------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Position drifts on non-16:9 screens | Runways using `centerX`/`centerY` fraction fallback (16:9 only)                                | Migrate all runways to `masterX1/Y1/masterX2/Y2` two-endpoint form          |
| Size differs across ratios          | `length`/`width` in world units don't account for non-uniform background stretch (`sx` ≠ `sy`) | Add `masterLength`/`masterWidth` in master-image pixels, convert at runtime |

---

### Phase 1 — Add `masterLength` / `masterWidth` to runway config

Add two optional fields to each runway in `levels.config.ts`:

```ts
interface RunwayConfig {
  // ... existing ...
  masterLength?: number; // runway length in master-image pixels
  masterWidth?: number; // runway width in master-image pixels
}
```

These are in the same coordinate space as `masterX`/`masterY` — pixel coordinates on `raw_assets/level-N-master.png`.

### Phase 2 — Runtime conversion in `GameScene.convertRawLevel()`

In `convertRawLevel()`, when `masterLength`/`masterWidth` are present, convert them to world units using the same `sx`/`sy` scale factors from `getMasterScale()`:

- **`masterLength` → world length**: `masterLength * sqrt(sx * sy)` (geometric mean, because the runway's length axis is diagonal across the image)
- **`masterWidth` → world width**: `masterWidth * sy` (Y-scale factor, since runway width is the short axis perpendicular to the length direction)

If `masterLength`/`masterWidth` are absent, fall back to the existing `length`/`width` values (backward compatible).

### Phase 3 — Migrate all runways to two-endpoint form (`masterX1/Y1/masterX2/Y2`)

The single-point `masterX`/`masterY` + `masterLength` form is approximate — it can't correct for non-uniform stretch without a second point. The two-endpoint form is the only approach that stays correct on every ratio.

For each runway that currently has only `masterX`/`masterY`:

1. Open the 16x9 output PNG in an image editor
2. Click both threshold endpoints of the runway
3. Run `pnpm runway runway <level> 16x9 <runwayId> <x1> <y1> <x2> <y2>`
4. Replace `masterX`/`masterY`/`masterLength` with `masterX1`/`masterY1`/`masterX2`/`masterY2`
5. Remove `centerX`/`centerY` fraction fallback (redundant once master endpoints exist)
6. Remove `masterLength` (it's now derived from the two endpoints at runtime)

Runways that currently have neither `masterX`/`masterY` nor `masterX1/Y1` (pure fraction fallback) need the same two-endpoint measurement.

### Phase 4 — Enhance authoring tooling (`generate-master-runway-coords.ts`)

Add a `size` mode that:

- Takes two points across the runway's short axis (width measurement) on a ratio's output image
- Outputs `masterWidth` in master-image pixels
- Also outputs the derived `masterLength` from the two threshold endpoints

Update the `runway` mode to also prompt for width points and output `masterWidth` alongside `masterX1/Y1/masterX2/Y2`.

### Phase 5 — Validation & debug

- Add a validation check in `convertRawLevel()` that warns when a runway has `masterX1/Y1/masterX2/Y2` but the derived world-unit length/width differs significantly from the existing `length`/`width` values (catches cases where the old world-unit values were tuned for a specific ratio and would now be wrong)
- Add a debug overlay option (already in dev builds) that shows runway dimensions in both master-pixel and world-unit forms for verification

### Phase 6 — Remove legacy single-point form

Once all runways are migrated to two-endpoint form:

- Remove support for `masterX`/`masterY` (single point) from `convertRawLevel()`
- Remove the `masterLength`/`masterWidth` fallback path in the single-point conversion block
- Remove the `centerX`/`centerY` fraction fallback for runways that have master endpoints
- Clean up `generate-master-runway-coords.ts` `pick` and `measure` modes (or keep them as one-off utilities)

---

### File Changes Summary

| File                                            | Change                                                                                                               |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `packages/app/src/game/config/levels.config.ts` | Add `masterLength`/`masterWidth` fields; migrate all runways to `masterX1/Y1/masterX2/Y2`; remove fraction fallbacks |
| `packages/app/src/game/scenes/GameScene.ts`     | Add `masterLength`/`masterWidth` conversion in `convertRawLevel()` using `sqrt(sx*sy)` and `sy`                      |
| `scripts/generate-master-runway-coords.ts`      | Add `size` mode; update `runway` mode to output width                                                                |
| `docs/LevelBackgrounds.md`                      | Update runway sizing documentation to reference master-pixel dimensions                                              |

---

### Clarification on Point 5

You're correct — the runway should be a constant visual object on the background image. This means:

- The runway's position is defined in master-image pixels (same space as the background art)
- The runway's size is defined in master-image pixels (so it scales with the background crop)
- At runtime, both are converted to world units using the same `sx`/`sy` factors that stretch the background image into the 1920×1080 world rect

This ensures the runway maintains the same visual relationship to the background on every device — on a phone the background is cropped more tightly (zoomed in), and the runway shrinks proportionally; on a desktop the background shows more area, and the runway grows proportionally. The runway is always "painted on" the background.

Shall I proceed with implementation?
