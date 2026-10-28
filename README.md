# 🧩 ATC-APP

> **Cross-platform air traffic control game built with Vue 3, Phaser 3, TypeScript, Electron, and Capacitor**

ATC-APP is a monorepo project delivering a consistent ATC (Air Traffic Control) game experience across desktop (Electron) and mobile (Capacitor) platforms with a shared Vue 3 + Phaser 3 codebase.

---

[![CI](https://github.com/IuriiKyrylovskyi/atc-app/actions/workflows/ci.yml/badge.svg)](https://github.com/IuriiKyrylovskyi/atc-app/actions/workflows/ci.yml)
[![Release](https://github.com/IuriiKyrylovskyi/atc-app/actions/workflows/release.yml/badge.svg)](https://github.com/IuriiKyrylovskyi/atc-app/actions/workflows/release.yml)
[![Security](https://github.com/IuriiKyrylovskyi/atc-app/actions/workflows/security.yml/badge.svg)](https://github.com/IuriiKyrylovskyi/atc-app/actions/workflows/security.yml)
![GitHub release](https://img.shields.io/github/v/release/IuriiKyrylovskyi/atc-app)
![Node Version](https://img.shields.io/badge/node-%3E%3D20-brightgreen)
![PNPM Version](https://img.shields.io/badge/pnpm-%3E%3D9-blueviolet)
![License](https://img.shields.io/github/license/IuriiKyrylovskyi/atc-app)

---

## 📋 Table of Contents

- [Tech Stack](#-tech-stack)
- [Game Architecture](#-game-architecture)
- [Prerequisites](#️-prerequisites)
- [Quick Start](#-quick-start)
- [Development](#-development)
- [Building](#-building)
- [Releasing](#-releasing)
- [Project Structure](#-project-structure)
- [Scripts Reference](#-scripts-reference)
- [Adding a New Level](#-adding-a-new-level)
- [CI/CD](#-cicd)
- [Contributing](#-contributing)

---

## 🛠️ Tech Stack

| Category             | Technologies              |
| -------------------- | ------------------------- |
| **Framework**        | Vue 3 (Composition API)   |
| **Game Engine**      | Phaser 3 (WebGL)          |
| **State Management** | Pinia                     |
| **Language**         | TypeScript                |
| **Build Tool**       | Vite                      |
| **Desktop**          | Electron                  |
| **Mobile**           | Capacitor (iOS + Android) |
| **Package Manager**  | PNPM Workspaces           |
| **CI/CD**            | GitHub Actions            |

---

## 🎮 Game Architecture

### Overview

ATC-APP is a landscape-only ATC game. Players guide planes by drawing paths with touch/mouse, directing them to land on runways or pass through waypoints while avoiding collisions.

### Dual-Layer Separation

```
┌──────────────────────────────────────────┐
│  Vue Layer  (UI / Navigation / Overlays) │
│  Router · Pinia stores · Vue components  │
├──────────────────────────────────────────┤
│  Event Bus  (gameEventBus)               │
│  Type-safe events — zero direct coupling │
├──────────────────────────────────────────┤
│  Phaser Layer  (Game Logic / Rendering)  │
│  GameScene · Plane · Runway · Waypoint   │
│  CollisionSystem · PathProcessor         │
│  SpawnSystem · WorldTransform            │
│  InputSystem · DrawSystem · AudioSystem  │
│  BootScene                               │
└──────────────────────────────────────────┘
```

### World Container System

All game objects live inside a **world coordinate system** with a fixed reference size of **1920 × 1080 game units** (DPR-independent).

```
worldContainer  (centred on screen, cover-scaled to fill any viewport)
├── background image        (fills 1920×1080 world units)
├── runway 1                (world-local coords, e.g. x=−224, y=−64)
└── runway 2 …

scene / screen space
├── waypoints               (world-scale size, pinned to screen edges)
├── graphics layers         (paths · projections · collision circles)
└── overlays (Vue)          (HUD · collision overlay · modals)
```

**Cover scale** — `worldScale = Math.max(screenW / 1920, screenH / 1080)` — ensures the background always fills the screen without letterboxing on any aspect ratio.

### Level Coordinate System

Runway and waypoint positions in `levels_config.ts` are stored as **fractions (0–1)** of the world rect:

```ts
runways:   [{ centerX: 0.352, centerY: 0.46, … }]
waypoints: [{ x: 0.03,  y: 0.9,  … }]
```

`convertRawLevel()` in `GameScene` maps these to world-local coordinates at runtime:

```ts
worldLocalX = fraction * WORLD_W - WORLD_W / 2.2; // e.g. 0.352 * 1920 − 960 = −284
worldLocalY = fraction * WORLD_H - WORLD_H / 2.2;
```

### Collision System

Collision detection lives in `src/game/systems/CollisionSystem.ts` (separate from `GameScene`):

- **Resolution Advisory (RA)** — fatal: `distance < (r1 + r2) / 2` triggers `level:failed`, pauses scene
- **Traffic Advisory (TA)** — warning: `distance < (r1 + r2) / 2` (warning radii) shows orange pulse
- Altitude separation: planes at different `level` values (−1 / 0 / +1) never collide
- Guard: `isGameOver` flag prevents re-entry after first collision

### Resize Handling

`GameScene.handleResize()` does two things in order:

1. **Viewport bounds** — `updateViewportBounds()` recomputes the visible world rect for the new canvas size
2. **World transform** — `applyWorldTransform()` re-scales and re-centres `worldContainer`, then re-snaps waypoints to visible edges

Planes and runways are children of `worldContainer` and reposition automatically — no per-object resize logic is needed. The camera is **not** resized from `handleResize`; Phaser's `ScaleManager` handles the camera before the event fires, and calling `cameras.main.setSize()` again would cause a re-entrant crash.

### Key Files

| File                    | Purpose                                                              |
| ----------------------- | -------------------------------------------------------------------- |
| `GameScene.ts`          | Scene orchestration: lifecycle, event wiring, update loop            |
| `CollisionSystem.ts`    | Self-contained RA/TA detection and collision circles                 |
| `PathProcessor.ts`      | Path normalisation, smoothing, closest-point lookup                  |
| `SpawnSystem.ts`        | Plane spawning — runway departures and edge-entry                    |
| `WorldTransform.ts`     | Screen↔world coordinate conversion, viewport bounds, cover-scale     |
| `InputSystem.ts`        | Pointer drag, path drawing, runway/waypoint projection               |
| `DrawSystem.ts`         | Entry zone overlay, collision circle rendering                       |
| `AudioSystem.ts`        | Music, predict loop, collision/beap/success SFX — event-driven       |
| `Plane.ts`              | Sprite with texture normalisation, path following, departure/landing |
| `Runway.ts`             | Runway container (child of worldContainer)                           |
| `Waypoint.ts`           | Waypoint container (screen space, edge-pinned)                       |
| `levels_config.ts`      | Level definitions with fractional runway/waypoint coords             |
| `defaults_config.ts`    | BASE_SIZE, device scale factors, plane type variants                 |
| `planes_config.ts`      | Plane type configs derived from defaults                             |
| `aspectRatio_config.ts` | Aspect ratio detection for background asset selection                |
| `AirTrafficCanvas.vue`  | Phaser canvas host + collision overlay (Try Again / Main Menu)       |
| `useGame.ts`            | Composable: initialises Phaser, bridges events to Pinia              |

---

## ⚙️ Prerequisites

### Required for All Platforms

| Tool        | Version | Installation                        | Verification    |
| ----------- | ------- | ----------------------------------- | --------------- |
| **Node.js** | ≥ 20    | [nodejs.org](https://nodejs.org/)   | `node -v`       |
| **PNPM**    | ≥ 9     | `npm install -g pnpm`               | `pnpm -v`       |
| **Git**     | latest  | [git-scm.com](https://git-scm.com/) | `git --version` |

### Android Development (Optional)

| Tool            | Version | Notes                                   |
| --------------- | ------- | --------------------------------------- |
| **Java JDK**    | ≥ 21    | Required for Android builds             |
| **Android SDK** | latest  | Set `ANDROID_HOME` environment variable |

### iOS Development (macOS Only)

| Tool          | Version | Notes                        |
| ------------- | ------- | ---------------------------- |
| **Xcode**     | ≥ 15    | Install from Mac App Store   |
| **CocoaPods** | latest  | `sudo gem install cocoapods` |

---

## 🚀 Quick Start

```bash
git clone https://github.com/IuriiKyrylovskyi/atc-app.git
cd atc-app
pnpm setup:dev   # installs deps, verifies env, syncs Capacitor
pnpm dev         # starts web + Electron dev servers
```

Navigate: **Intro → Menu → Play Fields → Airfields → (select airport) → Game**

---

## 🔧 Development

```bash
pnpm dev            # Web + Electron (default)
pnpm dev:app        # Web only
pnpm dev:electron   # Electron only
pnpm dev:android    # Build + run on Android
pnpm dev:ios        # Build + run on iOS
pnpm dev:mobile     # Auto-detect mobile platform
```

---

## 🏗️ Building

```bash
pnpm build                   # Web + Electron
pnpm build:app               # Web only
pnpm dist:electron           # Electron installer (.dmg / .exe)
pnpm android:release         # Android APK
pnpm ios:release             # iOS IPA
pnpm mobile:build:release    # Mobile for current platform
```

---

## 🚀 Releasing

All version state lives in one place — the root `package.json`. A single command bumps every version file, commits, and tags:

```bash
pnpm run release          # patch bump  0.0.38 → 0.0.39
pnpm run release:minor    # minor bump  0.0.38 → 0.1.0
pnpm run release:major    # major bump  0.0.38 → 1.0.0
```

### What happens in order

1. `verify:env` — checks required tools are present
2. `build` + `dist:electron` — validates the build is clean before tagging
3. `standard-version` bumps all four `package.json` files
4. **`postbump`** → `scripts/bump-native.js` syncs the new version into native files:
   - `packages/mobile/android/app/build.gradle` — `versionCode` + `versionName`
   - `packages/mobile/ios/App/App.xcodeproj/project.pbxproj` — `CURRENT_PROJECT_VERSION` + `MARKETING_VERSION`
5. **`precommit`** — stages the native files so they're included in the release commit
6. `standard-version` commits everything + creates a `vX.Y.Z` git tag
7. The version rendered in `IntroScreen.vue` updates automatically on the next build — it is baked in at Vite build time via `__APP_VERSION__` from the root `package.json`

### Then build for the stores

```bash
# Always run AFTER pnpm run release — native files must be updated first
pnpm run android:bundle   # → app-release.aab for Google Play
pnpm run ios:release      # → .app for Xcode Archive → App Store Connect
```

> **Never run store builds before `pnpm run release`** — the AAB / IPA would be signed with the old version number still in the native files.

### Version code formula

Both Android `versionCode` and iOS `CURRENT_PROJECT_VERSION` are integers derived deterministically from the semver:

```
versionCode = major × 10000 + minor × 100 + patch
```

| semver | versionCode |
| ------ | ----------- |
| 0.0.38 | 38          |
| 0.1.0  | 100         |
| 0.9.99 | 999         |
| 1.0.0  | 10000       |
| 1.2.3  | 10203       |

No separate counter file — the value is always reproducible from the semver alone.

### Manual sync (if native files get out of sync)

```bash
pnpm run version:sync   # re-runs bump-native.js against current package.json version
```

---

## 📁 Project Structure

```
atc-app/
├── packages/
│   ├── app/                           # Main Vue + Phaser application
│   │   └── src/
│   │       ├── assets/
│   │       │   └── backgrounds/
│   │       │       ├── 16x9/          # level-1.png … level-5.png
│   │       │       ├── 20x9/          # iPhone ratio variants
│   │       │       └── 19_5x9/        # Android ratio variants
│   │       ├── components/
│   │       │   └── game/
│   │       │       ├── AirTrafficCanvas.vue   # Phaser host + collision overlay
│   │       │       ├── GameHUD.vue            # Score / pause overlay
│   │       │       ├── PauseModal.vue
│   │       │       └── LevelCompleteModal.vue
│   │       ├── composables/
│   │       │   └── useGame.ts                 # Phaser init + event bridge
│   │       ├── game/
│   │       │   ├── config/
│   │       │   │   ├── defaults_config.ts     # BASE_SIZE, device scale, plane types
│   │       │   │   ├── levels_config.ts       # Level definitions (fractional coords)
│   │       │   │   ├── planes_config.ts       # Plane type configs
│   │       │   │   ├── phaser_config.ts       # Phaser + canvas setup
│   │       │   │   └── aspectRatio_config.ts  # Aspect ratio detection
│   │       │   ├── objects/
│   │       │   │   ├── Plane.ts
│   │       │   │   ├── Runway.ts
│   │       │   │   └── Waypoint.ts
│   │       │   ├── systems/
│   │       │   │   ├── CollisionSystem.ts     # RA/TA detection + collision circles
│   │       │   │   ├── PathProcessor.ts       # Path resampling, smoothing, lookup
│   │       │   │   ├── SpawnSystem.ts         # Plane spawning logic
│   │       │   │   ├── WorldTransform.ts      # Coordinate conversion, cover-scale
│   │       │   │   ├── InputSystem.ts         # Drag input, path & projection drawing
│   │       │   │   ├── DrawSystem.ts          # Entry zones, collision circle drawing
│   │       │   │   └── AudioSystem.ts         # Music, SFX, event-driven audio
│   │       │   └── utils/
│   │       │       ├── dprScale.helper.ts
│   │       │       └── assetLoader.ts
│   │       ├── router/
│   │       │   └── index.ts
│   │       ├── scenes/
│   │       │   ├── BootScene.ts
│   │       │   ├── GameScene.ts               # Main gameplay scene
│   │       │   ├── LevelScene.ts
│   │       │   └── PauseScene.ts
│   │       ├── services/
│   │       │   └── EventBus.ts                # Type-safe event bus
│   │       ├── stores/
│   │       │   ├── game.ts                    # Game state (no lives)
│   │       │   ├── purchase.ts                # Trial / licence management
│   │       │   └── settings.ts
│   │       ├── types/
│   │       │   └── game.d.ts
│   │       └── views/
│   │           ├── IntroScreen.vue
│   │           ├── Home.vue
│   │           ├── PlayFieldsScreen.vue
│   │           ├── FlightAcademyScreen.vue
│   │           └── GameView.vue               # Phaser canvas host view (→ /play)
│   │
│   ├── electron/
│   │   ├── app-build/
│   │   │   ├── main.ts
│   │   │   └── preload.ts
│   │   └── electron-builder.yml
│   │
│   └── mobile/
│       ├── android/
│       ├── ios/
│       └── capacitor.config.ts
│
├── scripts/
│   ├── verify-env.js
│   └── bump-native.js         # syncs semver → Android versionCode + iOS build number
├── .github/workflows/
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.json
```

---

## 📜 Scripts Reference

| Command                                             | Description                                                        |
| --------------------------------------------------- | ------------------------------------------------------------------ |
| `pnpm setup:dev`                                    | Full project setup (recommended for new machines)                  |
| `pnpm --filter @atc-app/mobile run assets:generate` | Generate all app icon sizes from `packages/mobile/assets/icon.png` |
| `pnpm verify:env`                                   | Check all required tools                                           |
| `pnpm dev`                                          | Web + Electron dev servers                                         |
| `pnpm build`                                        | Production build (web + electron)                                  |
| `pnpm dist:electron`                                | Electron installer                                                 |
| `pnpm android:release`                              | Android APK                                                        |
| `pnpm android:bundle`                               | Android AAB (for Google Play)                                      |
| `pnpm ios:release`                                  | iOS build for App Store                                            |
| `pnpm mobile:build:release`                         | Store build for current platform (auto-detects macOS / Windows)    |
| `pnpm mobile:clean`                                 | Remove build artifacts                                             |
| `pnpm lint`                                         | ESLint across all packages                                         |
| `pnpm format`                                       | Prettier formatting                                                |
| `pnpm version:sync`                                 | Manually sync current semver → Android + iOS native files          |
| `pnpm release`                                      | Patch bump → sync all versions → commit + tag → ready for stores   |
| `pnpm release:minor`                                | Minor bump (same flow as above)                                    |
| `pnpm release:major`                                | Major bump (same flow as above)                                    |

---

## ➕ Adding a New Level

> Full specification: [`LevelBackgrounds.md`](./docs/LevelBackgrounds.md) and [`HOW_TO_SET_RUNWAY.md`](./docs/how_to/HOW_TO_SET_RUNWAY.md)

### Background image

1. Create the master background at **5048 × 3328 px** (or larger) with aspect ratio 1.51 (it's important to set not stretched image on different screens) as `raw_assets/level-N-master.png`.
2. Run `pnpm build:levels` to generate all ratio variants (`16x9`, `20x9`, `19_5x9`, etc.) in `packages/app/src/assets/backgrounds/`.

### Runway positioning (two-endpoint form — required)

Each runway must be authored as **two threshold endpoints** in master-image pixels (`masterX1/Y1/masterX2/Y2`). The game projects both endpoints independently per ratio and derives center, length, and direction at runtime — this is the only correct approach for the non-uniform cover-scale stretching used per ratio.

**Workflow:**

1. Open the `16x9` output PNG in any image editor. Click the runway's **two threshold ends** (start and end of the strip, in the landing direction). Read both pixel coordinates.
2. Convert both points in one command:
   ```bash
   pnpm runway runway 4 16x9 level4-rw06 1150 600 1420 625
   ```
   This outputs `masterX1`, `masterY1`, `masterX2`, `masterY2` to paste into `levels.config.ts`.
3. Optionally measure the runway's short-axis **width** (in master-image pixels):
   ```bash
   pnpm runway size 4 16x9 1150 600 1150 640
   ```
   Or pass the width points as extra args to the runway command (11 args total):
   ```bash
   pnpm runway runway 4 16x9 level4-rw06 1150 600 1420 625 1150 560 1420 605
   ```
   This outputs `masterWidth`. At runtime `GameScene` converts it to world units by multiplying by `sy` (the Y scale factor).
4. Sanity-check each endpoint lands correctly on every ratio:
   ```bash
   pnpm runway verify 4 <masterX1> <masterY1>
   pnpm runway verify 4 <masterX2> <masterY2>
   ```
5. Add the runway entry to `levels.config.ts` with the two-endpoint fields. Do **not** include `centerX`, `centerY`, `direction`, `length`, or `width` when using the two-endpoint form — the game derives those automatically. Remove any legacy `masterX`/`masterY`/`masterLength`/`positionOverrides` fields.

**Legacy note:** The old single-point `masterX/masterY` (with optional `masterLength`) and fraction-based `centerX/centerY` fallback forms are deprecated — they only work correctly on 16x9. Migrate all runways to the two-endpoint form before shipping.

### Waypoints

Waypoints use fractional coordinates (`x`, `y` in 0–1) relative to the 1920×1080 world, pinned to screen edges at runtime.

### Testing

Toggle the debug overlay in dev to confirm collision circles align with the painted runways on all aspect ratios.

---

## 🎨 App Icons

All app icon sizes for iOS, Android, and PWA are generated from a single source file using `@capacitor/assets`.

### Source files

| File                                | Size         | Notes                                                  |
| ----------------------------------- | ------------ | ------------------------------------------------------ |
| `packages/mobile/assets/icon.png`   | 1024×1024 px | **Required.** PNG, no transparency, no rounded corners |
| `packages/mobile/assets/splash.png` | 2732×2732 px | Optional splash screen. Uses icon if absent            |

### Generate all sizes

```bash
# Build web app first (required — generates www/manifest.json)
pnpm --filter @atc-app/app build && pnpm --filter @atc-app/mobile exec cap sync

# Generate all icon sizes
pnpm --filter @atc-app/mobile run assets:generate
```

This generates:

- **Android:** 135 files across all densities (ldpi → xxxhdpi), adaptive icons, splash screens
- **iOS:** AppIcon.appiconset + splash screens in Assets.xcassets
- **PWA:** 7 webp sizes in `packages/mobile/icons/`

### After updating icons

Always rebuild and re-archive before submitting to stores:

```bash
pnpm android:bundle   # new AAB with updated icons
# Then re-archive in Xcode for iOS
```

### Store upload requirements

| Store             | Asset           | Size         | Notes                                |
| ----------------- | --------------- | ------------ | ------------------------------------ |
| App Store Connect | App icon        | 1024×1024 px | Baked into Xcode build automatically |
| App Store Connect | Screenshots     | 2868×1320 px | iPhone 6.9" landscape                |
| App Store Connect | iPad screenshot | 2732×2048 px | Can resize from iPhone screenshot    |
| Google Play       | App icon        | 512×512 px   | Upload manually in store listing     |
| Google Play       | Feature graphic | 1024×500 px  | Required for store listing           |
| Google Play       | Screenshots     | min 2, 16:9  | Upload manually in store listing     |

---

## ✈️ Fleet Registry

The current fleet is defined in `PLANE_TYPE_VARIANTS` inside `defaults_config.ts`. All 12 types map 1:1 to the sprite folders in `src/assets/planes/`.

| ID  | Folder name     | Aircraft                    | Class  | Notes                                          |
| --- | --------------- | --------------------------- | ------ | ---------------------------------------------- |
| 1   | `1-a380`        | Airbus A380-800             | SUPER  | Normalisation anchor (ratio = 1.0)             |
| 2   | `2-a340`        | Airbus A340-600             | HEAVY  | Four-engine long-haul wide-body                |
| 3   | `3-a320`        | Airbus A320-200             | MEDIUM | Narrow-body; ⚠️ temp `sizeMultiplier` override |
| 4   | `4-dc9`         | Douglas DC-9                | MEDIUM | Classic twin-engine short-haul                 |
| 5   | `5-concorde`    | Concorde                    | HEAVY  | Supersonic; fastest in-game speed              |
| 6   | `6-b777`        | Boeing 777-9 (777X)         | HEAVY  | Modern twin-engine long-haul                   |
| 7   | `7-c17`         | Boeing C-17 Globemaster III | HEAVY  | Military strategic airlifter                   |
| 8   | `8-an22`        | Antonov An-22               | HEAVY  | Heavy turboprop; slowest cruise                |
| 9   | `9-md11`        | Douglas MD-11               | HEAVY  | Three-engine wide-body long-haul               |
| 10  | `10-cessna-700` | Cessna Citation 700         | LIGHT  | Compact business jet; most agile               |
| 11  | `11-e170`       | Embraer E195-E2             | MEDIUM | Regional narrow-body airliner                  |
| 12  | `12-b747`       | Boeing 747-8i               | HEAVY  | Iconic quad-jet wide-body                      |

All performance multipliers (`sizeMultiplier`, `speedMultiplier`, `turnRateMultiplier`) are computed automatically from real-world wingspan and cruise speed via `defineAircraft()`. See `atc-app_aircraft_fleet_matrix.md` for the source data.

## ✈️ Adding a New Plane Type

> Full specification: [`PlaneIcons.md`](./packages/app/src/assets/PlaneIcons.md)

1. Add real-world data to `REAL_WORLD_AIRCRAFT` in `defaults_config.ts` (wingspan_m, length_m, cruiseSpeed_kmh, weightClass) if reusable across types; otherwise pass values directly to `defineAircraft()`.
2. Export all 6 colour sprites + shadow. **Strict canvas rules — read `PlaneIcons.md` before exporting:**
   - Longest canvas axis = **exactly 690 px** (`ICON_CANVAS_MAX`)
   - Plane content fills **≥ 98 %** of that axis
   - Background **fully transparent** (RGBA PNG)
   - Nose pointing **right (→)**
3. Run the verification script in `PlaneIcons.md` on every file before committing.
4. Place files in `src/assets/planes/` using naming `{typeId}-{color}.png` and `{typeId}-shadow.png`. The folder name convention is `{typeId}-{shortname}` (e.g. `13-b737`).
5. Add `defineAircraft({ id: N, wingspan_m, … })` to `PLANE_TYPE_VARIANTS` in `defaults_config.ts`.
   `sizeMultiplier` is computed automatically via `defineSizeMultiplier(wingspan_m) = 1.3 × (wingspan_m / 80)`.
   **Do not add a `sizeMultiplier` field** unless the icon is non-compliant (see `PlaneIcons.md`).
6. Add the type ID to `allowedPlaneTypes` in the target levels in `levels_config.ts`.

---

## 🔄 CI/CD

### Continuous Integration (`ci.yml`)

Runs on every push to `main` / `develop` and all PRs:

1. Code quality — Prettier, ESLint, TypeScript type-check, environment verification
2. Build validation — web app, Electron, mobile platform sync
3. Artifact upload — retained for 1 day

### Release Pipeline (`release.yml`)

Triggered when a `vX.Y.Z` tag is pushed — which `pnpm run release` does automatically:

```bash
pnpm run release          # bumps versions, commits, tags, and pushes
# CI then picks up the tag and runs the release pipeline
```

If you need to trigger it manually (e.g. to re-run a failed pipeline without bumping):

```bash
git tag v1.0.0
git push origin v1.0.0
```

---

## 🤝 Contributing

1. Fork and clone
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Use Conventional Commits: `feat:`, `fix:`, `docs:`, `refactor:`
4. Run `pnpm lint && pnpm format:check && pnpm build` before pushing
5. Open a pull request — CI validates automatically

### Versioning

| Commit type                    | Version bump  |
| ------------------------------ | ------------- |
| `fix:`                         | Patch (0.0.X) |
| `feat:`                        | Minor (0.X.0) |
| `feat!:` / `BREAKING CHANGE:`  | Major (X.0.0) |
| `chore:`, `docs:`, `refactor:` | None          |

---

## 📄 License

MIT — see [LICENSE](./LICENSE).

---

**Built with ❤️ using Vue 3, Phaser 3, Electron, and Capacitor**
