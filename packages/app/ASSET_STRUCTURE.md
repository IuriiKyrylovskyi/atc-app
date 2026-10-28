# Cross-Platform Asset Structure

## ✅ Correct Structure for Web, Electron, iOS, Android

```
packages/app/
├── src/
│   └── assets/              # ✅ CORRECT - Assets bundled by Vite
│       ├── planes/
│       │   ├── 1-blue.png
│       │   ├── 1-green.png
│       │   ├── 1-yellow.png
│       │   ├── 1-pink.png
│       │   ├── 1-violet.png
│       │   ├── 1-orange.png
│       │   ├── 1-shadow.png
│       │   ├── 2-blue.png
│       │   ├── 2-green.png
│       │   ├── 2-yellow.png
│       │   ├── 2-pink.png
│       │   ├── 2-violet.png
│       │   ├── 2-orange.png
│       │   └── 2-shadow.png
│       └── backgrounds/
│           └── 06.png
│
└── public/                  # ❌ AVOID - Not bundled for mobile
    └── (static files only)
```

## 🎯 Key Points

### ✅ DO: Use `src/assets/`

- **Web**: Vite bundles and optimizes
- **Electron**: Bundled into app.asar
- **iOS**: Bundled into app binary
- **Android**: Bundled into APK
- **Result**: Works everywhere!

### ❌ DON'T: Use `public/`

- **Web**: Works (served as static)
- **Electron**: May work (if copied)
- **iOS**: ❌ Won't work (not bundled)
- **Android**: ❌ Won't work (not bundled)
- **Result**: Breaks on mobile!

## 📝 Migration Steps

If you have assets in `public/`, move them:

```bash
# Move planes
mkdir -p src/assets/planes
mv public/planes/*.png src/assets/planes/

# Move backgrounds
mkdir -p src/assets/backgrounds
mv public/rws/06.png src/assets/backgrounds/
```

## 🔧 TypeScript Declaration

Add to `src/env.d.ts`:

```typescript
/// <reference types="vite/client" />

declare module '*.png' {
  const value: string;
  export default value;
}

declare module '*.jpg' {
  const value: string;
  export default value;
}

declare module '*.jpeg' {
  const value: string;
  export default value;
}

declare module '*.svg' {
  const value: string;
  export default value;
}
```

## ✅ Verification

After moving assets, verify:

```bash
# Check files exist
ls src/assets/planes/
ls src/assets/backgrounds/

# Run dev server
pnpm dev

# Should see in console:
# "✅ Loaded 14 plane sprites"
```

## 📱 Platform-Specific Notes

### iOS (Capacitor)

```bash
# Sync assets to iOS project
pnpm --filter @atc-app/mobile exec cap sync ios

# Assets are bundled in:
# ios/App/App/public/assets/
```

### Android (Capacitor)

```bash
# Sync assets to Android project
pnpm --filter @atc-app/mobile exec cap sync android

# Assets are bundled in:
# android/app/src/main/assets/public/assets/
```

### Electron

```bash
# Assets are bundled by electron-builder
# Into app.asar file automatically
pnpm dist:electron
```

## 🎨 Asset Guidelines

Full specifications are in dedicated documents — read those before creating or exporting assets:

| Asset type                                   | Spec document                                  |
| -------------------------------------------- | ---------------------------------------------- |
| Plane sprites (colour variants + shadow)     | [`PlaneIcons.md`](./PlaneIcons.md)             |
| Level background images (all ratio variants) | [`LevelBackgrounds.md`](./LevelBackgrounds.md) |

### Quick reference

**Plane sprites** — see [`PlaneIcons.md`](./PlaneIcons.md) for the full spec and verification script.

- Naming: `{typeId}-{color}.png` and `{typeId}-shadow.png`
- **Longest canvas axis: exactly 690 px** (`ICON_CANVAS_MAX` in `defaults_config.ts`)
- **Plane content fill: ≥ 98 %** of that axis — padding reduces the rendered size
- **Background: fully transparent** (RGBA PNG) — opaque pixels are counted in canvas_max
- **Orientation: nose pointing right (→)** — rotation is applied at runtime
- All 6 colours (`blue green yellow pink violet orange`) + shadow required before enabling a type
- `sizeMultiplier` is computed automatically from `wingspan_m` — no manual value needed when icons are compliant

**Backgrounds**

- Master canvas: **5048 × 3328 px**. Measure all runway pixel coords from this file.
- Additional ratios (20×9, 19.5×9…): extend the canvas outward — do not scale the content.
- Runway position fractions: `centerX = pixel_x / 1920`, `centerY = pixel_y / 1080`.

## 🚀 Performance Tips

### Optimize Images

```bash
# Install imagemin
pnpm add -D vite-plugin-imagemin

# Add to vite.config.ts
import viteImagemin from 'vite-plugin-imagemin'

export default defineConfig({
  plugins: [
    viteImagemin({
      gifsicle: { optimizationLevel: 7 },
      optipng: { optimizationLevel: 7 },
      mozjpeg: { quality: 80 },
      pngquant: { quality: [0.8, 0.9], speed: 4 },
      svgo: { plugins: [{ removeViewBox: false }] },
    }),
  ],
})
```

### Lazy Load Large Assets

```typescript
// For very large backgrounds
const loadBackground = async () => {
  const { default: bg } = await import('@/assets/backgrounds/large-bg.png');
  return bg;
};
```
