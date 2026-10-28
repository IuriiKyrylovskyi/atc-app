# Plane Icon Specification

> **Read this before creating, exporting, or editing any plane sprite.**
> The sizing system works formula-free only when every icon follows this spec exactly.
> Non-compliant icons require manual per-file `sizeMultiplier` overrides.

---

## How the scaling pipeline works

`Plane.ts` scales every sprite using:

```
textureScale  = baseSize / Math.max(canvas_w, canvas_h)
rendered_px   = plane_content_px × textureScale
baseSize      = BASE_SIZE(100) × sizeMultiplier × deviceScaleFactor
```

The divisor is **`max(canvas_w, canvas_h)` — the full canvas, not the plane content.**

When every icon shares the same `canvas_max = 690`, the formula collapses cleanly:

```
rendered_px ≈ fill% × BASE_SIZE × sizeMultiplier
            ≈ 0.99  × 100       × sizeMultiplier
            ≈ 99 × sizeMultiplier  pixels
```

And `sizeMultiplier` is computed automatically by `defineSizeMultiplier(wingspan_m)`:

```ts
// defaults_config.ts
sizeMultiplier = ANCHOR.SIZE × (wingspan_m / A380.wingspan_m)
               = 1.3         × (wingspan_m / 80)
```

**This formula produces correct visual proportions only when the icon exactly meets the spec below.**
If `canvas_max` or fill differs, the formula gives the wrong value and a manual
override is required in `PLANE_TYPE_VARIANTS`.

---

## ✅ Icon export requirements — all mandatory

| Requirement             | Value                             | Consequence if violated                                    |
| ----------------------- | --------------------------------- | ---------------------------------------------------------- |
| **Longest canvas axis** | **exactly 690 px**                | Wrong `canvas_max` divisor → wrong rendered size           |
| **Plane content fill**  | **≥ 98% of the longest axis**     | Padding acts as invisible shrink factor                    |
| **Background**          | **fully transparent (alpha = 0)** | Opaque background reads as `canvas_max` and breaks scaling |
| **Format**              | **PNG, RGBA**                     | Required for transparency                                  |
| **Orientation**         | **Nose pointing right (→)**       | `Plane.ts` rotates sprites at runtime                      |

### Valid canvas shapes

```
✅  690 × 600 px  — landscape, longest = 690, plane fills the width
✅  580 × 690 px  — portrait,  longest = 690, plane fills the height
✅  690 × 690 px  — square,    longest = 690, plane fills ≥98% of one axis
❌  767 × 690 px  — canvas_max = 767, wrong divisor
❌  1920 × 1080 px — canvas_max = 1920, plane rendered tiny
❌  690 × 500 px with plane at 60% fill — invisible padding shrinks plane
❌  690 × 500 px with opaque black background — treated as solid, breaks alpha mask
```

**Reference icon:** `2-blue.png` — 599×690 px, plane fills 99%, transparent bg. ✅

---

## sizeMultiplier formula

Sizing uses **wingspan** because it is the dominant visual dimension in a top-down
view, and it correctly differentiates variants of the same airframe (A320ceo, A320neo,
A320-300 all share the same fuselage length but differ in wingspan).

**A380 (80 m wingspan) is the anchor = 1.0.** All other aircraft are expressed as a
fraction of it.

```ts
defineSizeMultiplier(wingspan_m) = 1.3 × (wingspan_m / 80)
```

| Aircraft                  | Wingspan | `sizeMultiplier`                           | Rendered px (desktop) |
| ------------------------- | -------- | ------------------------------------------ | --------------------- |
| A380-800 (type 1, ref)    | 79.8 m   | **1.297**                                  | ~130 px               |
| A340-600 (type 2)         | 63.4 m   | **1.030**                                  | ~103 px               |
| A320-200 (type 3)         | 34.0 m   | **0.553** (formula) / **1.151** (override) | ~55 px                |
| DC-9 (type 4)             | 28.5 m   | **0.463**                                  | ~46 px                |
| Concorde (type 5)         | 25.6 m   | **0.416**                                  | ~42 px                |
| 777-9 (type 6)            | 71.8 m   | **1.167**                                  | ~117 px               |
| C-17 (type 7)             | 51.8 m   | **0.842**                                  | ~84 px                |
| An-22 (type 8)            | 64.4 m   | **1.047**                                  | ~105 px               |
| MD-11 (type 9)            | 51.7 m   | **0.840**                                  | ~84 px                |
| Cessna Citation (type 10) | 14.3 m   | **0.232**                                  | ~23 px                |
| E195-E2 (type 11)         | 35.1 m   | **0.570**                                  | ~57 px                |
| 747-8i (type 12)          | 68.4 m   | **1.112**                                  | ~111 px               |

You never compute this manually — `defineAircraft({ ..., wingspan_m })` calls
`defineSizeMultiplier` automatically. **No `sizeMultiplier` field needed in the
`defineAircraft` call when the icon is compliant.**

---

## What happens when an icon is non-compliant

If `canvas_max ≠ 690` or fill `< 98%`, the formula value will be wrong. The icon
needs a manual override in `defaults_config.ts`:

```ts
defineAircraft({
  ...
  wingspan_m: 34,
  // ⚠️ TEMP: formula gives 0.553 but current icon (600×338, ~48% fill) needs 1.0
  // Verified in-game. Remove after re-exporting icon to 690 px / ≥98% fill.
  sizeMultiplier: 1.0,
})
```

**The override exists only to paper over a non-compliant icon.
Fix the icon, delete the override.**

### Why two things compound the error

| Problem                           | Effect on rendered size                                                        |
| --------------------------------- | ------------------------------------------------------------------------------ |
| `canvas_max = 600` instead of 690 | Plane renders 690/600 = **1.15× too large**                                    |
| Fill = 48% instead of 98%         | Plane renders 48/98 = **0.49× too small**                                      |
| Combined                          | 1.15 × 0.49 ≈ **0.56×** — close to why formula gives 0.553 but correct is ~1.0 |

Both must be corrected together. Fixing only canvas size without fixing fill, or
vice versa, still requires a manual override.

---

## Verification script

Run on every icon before committing:

```bash
python3 - src/assets/planes/2-blue.png src/assets/planes/3-blue.png << 'PYEOF'
from PIL import Image
import numpy as np, sys

for path in sys.argv[1:]:
    img = Image.open(path).convert('RGBA')
    arr = np.array(img)
    w, h = img.size

    # Background transparency check (sample 4 corners)
    bg_opaque = any(arr[r, c, 3] > 10 for r, c in [(0,0),(0,w-1),(h-1,0),(h-1,w-1)])

    # Plane content bounding box
    mask = arr[:,:,3] > 10
    rows_any = np.any(mask, axis=1)
    cols_any = np.any(mask, axis=0)
    rmin, rmax = np.where(rows_any)[0][[0,-1]]
    cmin, cmax = np.where(cols_any)[0][[0,-1]]
    pw, ph = cmax - cmin, rmax - rmin
    canvas_max = max(w, h)
    fill = max(pw / w, ph / h) * 100

    ok_canvas = canvas_max == 690
    ok_fill   = fill >= 98.0
    ok_bg     = not bg_opaque

    status = "✅ OK  " if (ok_canvas and ok_fill and ok_bg) else "❌ FAIL"
    print(f"{status}  {path}")
    print(f"         canvas {w}×{h}  plane {pw}×{ph}  fill {fill:.1f}%  canvas_max={canvas_max}  transparent_bg={ok_bg}")
    if not ok_canvas: print(f"         ❌ canvas_max must be 690, got {canvas_max} — resize canvas")
    if not ok_fill:   print(f"         ❌ fill must be ≥98%, got {fill:.1f}% — crop tighter")
    if not ok_bg:     print(f"         ❌ background is not transparent — export with alpha channel")
PYEOF
```

---

## File naming

```
src/assets/planes/
  {typeId}-blue.png
  {typeId}-green.png
  {typeId}-yellow.png
  {typeId}-pink.png
  {typeId}-violet.png
  {typeId}-orange.png
  {typeId}-shadow.png     ← same canvas dimensions, greyscale silhouette
```

All 6 colour variants **plus the shadow** must exist before enabling the type in
`levels_config.ts`. Missing textures cause a silent fallback to type 1.

**Shadow spec:** same canvas size as colour variants; greyscale plane silhouette,
~60% opacity, transparent background. Do not bake the offset into the PNG —
`Plane.ts` applies a `baseSize × 0.15` world-space offset at runtime.

---

## Adding a new plane type — checklist

- [ ] Add real-world data to `REAL_WORLD_AIRCRAFT` in `defaults_config.ts`
- [ ] Export 6 colour variants + shadow at **690 px longest axis, ≥98% fill, transparent bg, nose right**
- [ ] Run the verification script on every file
- [ ] Add `defineAircraft({ id: N, wingspan_m, ... })` to `PLANE_TYPE_VARIANTS` — no `sizeMultiplier` needed
- [ ] Add type ID to `allowedPlaneTypes` in target levels in `levels_config.ts`
- [ ] Verify collision circle tracks sprite boundary in dev overlay

---

## Current icon status

| Type | Aircraft            | Canvas     | Fill | Status                                                                 |
| ---- | ------------------- | ---------- | ---- | ---------------------------------------------------------------------- |
| 1    | Airbus A380-800     | 599×690 px | ~99% | ✅ Compliant — reference icon                                          |
| 2    | Airbus A340-600     | unknown    | —    | ⚠️ Run verification script                                             |
| 3    | Airbus A320-200     | 767×690 px | ~48% | ❌ Non-compliant — `sizeMultiplier: 1.151` override active (see below) |
| 4    | Douglas DC-9        | unknown    | —    | ⚠️ Run verification script                                             |
| 5    | Concorde            | unknown    | —    | ⚠️ Run verification script                                             |
| 6    | Boeing 777-9        | unknown    | —    | ⚠️ Run verification script                                             |
| 7    | Boeing C-17         | unknown    | —    | ⚠️ Run verification script                                             |
| 8    | Antonov An-22       | unknown    | —    | ⚠️ Run verification script                                             |
| 9    | Douglas MD-11       | unknown    | —    | ⚠️ Run verification script                                             |
| 10   | Cessna Citation 700 | unknown    | —    | ⚠️ Run verification script                                             |
| 11   | Embraer E195-E2     | unknown    | —    | ⚠️ Run verification script                                             |
| 12   | Boeing 747-8i       | unknown    | —    | ⚠️ Run verification script                                             |

### Why type 3 override changed from 1.0 → 1.151

The old `sizeMultiplier: 1.0` was set by eye ("looks about right") rather than
derived from the actual icon measurements. With the known canvas and fill values,
the correct compensation is:

```
Plane.ts renders:  visual_content_px = fill × baseSize
                                     = fill × BASE_SIZE(100) × sizeMultiplier

Intended size:     BASE_SIZE(100) × formula_sm = 100 × 1.3 × (34/80) = 55.25 px

Solving for sm:    sizeMultiplier = 55.25 / (0.48 × 100) = 1.151
```

| Override              | Visual content | Intended     | Error       |
| --------------------- | -------------- | ------------ | ----------- |
| 1.0 (old)             | 48 px          | 55.25 px     | −13 %       |
| **1.151 (corrected)** | **55.3 px**    | **55.25 px** | **< 0.1 %** |

### Fixing type 3 permanently

1. Open `3-{color}.png` in your editor
2. Resize the **canvas** (not the artwork) so the longest axis = **690 px**
   Current canvas is 767×690 — set it to **690×600 px** (scale down proportionally: `690/767 × 690 ≈ 621 px` → canvas **690×621 px**, then crop height to taste while keeping artwork ≥98% of 690)
3. Crop so plane artwork fills **≥ 98% of the 690 px axis** (≥ 676 px of content)
4. Export: **RGBA, transparent background, nose pointing right (→)**
5. Run the verification script — all three checks must pass
6. Repeat for all 6 colour variants **and** the shadow
7. Delete `sizeMultiplier: 1.151` from the A320 entry in `defaults_config.ts`
8. `defineAircraft` will compute `1.3 × (34/80) = 0.553` automatically → plane renders at **55 px** on desktop
