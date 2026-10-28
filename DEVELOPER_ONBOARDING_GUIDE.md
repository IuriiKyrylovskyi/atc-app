# 🚀 ATC-APP Developer Onboarding Guide

> Complete guide for developers joining the project — architecture, current status, and next steps.

---

## 📋 Table of Contents

1. [Project Overview](#project-overview)
2. [Current Architecture](#current-architecture)
3. [What's Implemented](#whats-implemented)
4. [What's Still Missing](#whats-still-missing)
5. [Key Files Quick-Reference](#key-files-quick-reference)
6. [Common Tasks](#common-tasks)
7. [Testing Checklist](#testing-checklist)
8. [Debugging Tips](#debugging-tips)

---

## 🎯 Project Overview

**ATC-APP** is a cross-platform air traffic control game:

| Layer           | Technology                |
| --------------- | ------------------------- |
| UI / Navigation | Vue 3 + TypeScript        |
| Game Engine     | **Phaser 3** (WebGL)      |
| State           | Pinia                     |
| Build           | Vite                      |
| Desktop         | Electron                  |
| Mobile          | Capacitor (iOS + Android) |

Players guide planes by drawing paths with touch/mouse, directing them to land on runways or pass through waypoints while avoiding mid-air collisions.

---

## 🏗️ Current Architecture

### Three-Layer Pattern

```
┌────────────────────────────────────────────┐
│  Vue Layer                                 │
│  Router · Pinia stores · Vue components    │
│  AirTrafficCanvas.vue hosts the Phaser     │
│  canvas and shows the collision overlay    │
├────────────────────────────────────────────┤
│  Event Bus  (gameEventBus — EventBus.ts)   │
│  Type-safe, no direct layer coupling       │
├────────────────────────────────────────────┤
│  Phaser Layer                              │
│  GameScene · Plane · Runway · Waypoint     │
│  CollisionSystem · PathProcessor           │
│  SpawnSystem · WorldTransform              │
│  InputSystem · DrawSystem · AudioSystem    │
│  BootScene                                 │
└────────────────────────────────────────────┘
```

### Navigation Flow

// TODO: not correct now

```
IntroScreen → Home → PlayFieldsScreen
                               ├── ??    → (select airport) → /play (GameView)
                               └── FlightAcademyScreen → /play
```

`/play` renders `AirTrafficCanvas.vue` which mounts the Phaser game.

### World Coordinate System

- Fixed world size: **1920 × 1080 units**
- `worldContainer` is cover-scaled: `scale = Math.max(screenW/1920, screenH/1080)`
- Runways are children of `worldContainer` — scale/move automatically on resize
- Waypoints are screen-space but edge-pinned by `snapWaypointsToEdges()` on every resize
- Level configs use fractional coords `(0–1)` converted to world-local at runtime

### Collision System (`CollisionSystem.ts`)

Extracted from `GameScene` into its own file at `src/game/systems/CollisionSystem.ts`:

- **RA (Resolution Advisory)**: `distance < (r1 + r2) / 2` → pauses scene, emits `level:failed`
- **TA (Traffic Advisory)**: `distance < (warningR1 + warningR2) / 2` → orange warning pulse
- Altitude separation: planes at different `.level` values (−1 / 0 / +1) never collide
- `isGameOver` flag on `GameScene` prevents re-entry after first collision
- `game:restart` listener calls `scene.resume()` then `scene.restart()` (resume required — restarting a paused scene is a no-op)

### Game-Over / Retry Flow

```
Collision detected
  → CollisionSystem: isGameOver = true, scene.pause(), emit level:failed
  → AirTrafficCanvas: shows overlay (💥 COLLISION)
  → "Try Again": emit game:restart → GameScene: scene.resume() + scene.restart()
  → "Go to Main Menu": gameStore.reset() + router.push('/menu')
```

### Listener Lifecycle (Important)

All `gameEventBus` listeners in `GameScene` are stored as bound instance references (`_onZoomChange`, `_onBackgroundChange`, `_onGameInit`, `_onGameRestart`, `_onGamePause`, `_onGameResume`) so `shutdown()` can remove them precisely. **Never use inline `.bind()` in `off()` calls** — it creates a new reference that never matches the registered listener and the handler leaks.

`AudioSystem` registers its own app-level listeners (`plane:landed`, `plane:waypoint-passed`, `plane:attached`, `settings:audio`) via `AudioSystem.init()`, called from `GameScene.create()`. The double-init guard makes it a no-op after the first call, so repeated level restarts never duplicate listeners.

---

## ✅ What's Implemented

### Game Engine

- Phaser 3 scene system (BootScene → GameScene)
- `GameScene` — scene orchestration, event wiring, update loop
- `Plane.ts` — texture normalisation, path following, departure scale-up, landing animation, altitude levels
- `Runway.ts` — worldContainer child, directional landing/departure logic
- `Waypoint.ts` — screen-space edge-pinned, approach neck, exit trajectory
- `CollisionSystem.ts` — standalone RA/TA detection + collision circles
- `PathProcessor.ts` — path resampling, direction smoothing, closest-point lookup
- `SpawnSystem.ts` — runway departures + edge-entry spawning
- `WorldTransform.ts` — screen↔world coordinate conversion, viewport bounds, cover-scale
- `InputSystem.ts` — pointer drag, path drawing, runway/waypoint projection
- `DrawSystem.ts` — entry zone overlay, per-frame collision circle drawing

### Audio

- `AudioSystem.ts` — stateless module, event-driven, no direct call sites in `GameScene` update loop
- Level background music — looping per-level track, fades in/out, pauses/resumes with `game:pause` / `game:resume`
- Predict loop (`predict.mp3`) — loops while yellow TA warning circles are visible, stops immediately when they clear
- Collision sound (`collision.wav`) — one-shot on fatal collision; music stops at same moment
- Beap (`beap.mp3`) — fires once per plane landing or waypoint pass (driven by `plane:landed` / `plane:waypoint-passed` events)
- Success (`success.wav`) — fires when a plane path is committed to a runway or waypoint (driven by `plane:attached` event)
- All sounds degrade gracefully if files are absent — no crashes

### UI / Navigation

- Full navigation flow: Intro → Home → PlayFields → Airfields / FlightAcademy → Game
- `AirTrafficCanvas.vue` — Phaser canvas host + collision overlay (Try Again / Main Menu)
- `GameHUD.vue` — score, stats, pause button
- Pause / level-complete modals
- Purchase modal + trial gating

### State Management

- `game.ts` — game status, score, stats (no lives — collision immediately ends level)
- `purchase.ts` — trial plays, licence key, platform detection
- `settings.ts` — zoom, background dimming

### Purchase / Trial System

- 3 free trial plays
- Licence key activation
- Platform detection (web / iOS / Android / Electron)
- Router guards

---

## ⚠️ What's Still Missing

### Polish

- Collision particle / explosion effect
- Plane spawn animation
- Mobile-specific touch control improvements

### Persistence

- Cloud saves (requires backend)
- Achievement system

### Platform-Specific

- iOS In-App Purchase (StoreKit)
- Android Google Play Billing
- Electron auto-update
- Deep linking for score sharing

---

## 📂 Key Files Quick-Reference

| File                   | What to edit                                     |
| ---------------------- | ------------------------------------------------ |
| `levels_config.ts`     | Add / modify levels, runways, waypoints          |
| `defaults_config.ts`   | BASE_SIZE, spawn rates, plane count limits       |
| `planes_config.ts`     | Plane types, sizes, collision/warning radii      |
| `CollisionSystem.ts`   | RA/TA thresholds, detection logic                |
| `SpawnSystem.ts`       | Spawn rates, departure logic, edge-entry bands   |
| `InputSystem.ts`       | Drag input, path smoothing, projection behaviour |
| `AudioSystem.ts`       | Sound files, volume, event-to-sound wiring       |
| `GameScene.ts`         | Scene orchestration, event wiring, update loop   |
| `Plane.ts`             | Flight behaviour, departure/landing states       |
| `AirTrafficCanvas.vue` | Collision overlay UI, Try Again / menu buttons   |
| `game.ts`              | Game state store (score, status)                 |
| `purchase.ts`          | Trial/licence store                              |
| `EventBus.ts`          | Add new typed events here                        |

---

## 🔧 Common Tasks

### Adding a New Level

1. Drop background images into:

   - `src/assets/backgrounds/16x9/level-N.png`
   - `src/assets/backgrounds/20x9/level-N.png`
   - `src/assets/backgrounds/19_5x9/level-N.png`

2. Measure runway centre pixel on the 1920×1080 image:

   ```ts
   centerX = pixelX / 1920;
   centerY = pixelY / 1080;
   ```

3. Add to `levels_config.ts` — see `LevelBackground_PositioningGuide.md` for full reference.

### Adding a New Event

1. Add type signature to `GameEvents` in `EventBus.ts`
2. Emit in game layer: `gameEventBus.emit('my:event', payload)`
3. Listen in Vue layer: `gameEventBus.on('my:event', handler)` — always store and `off()` in `onUnmounted`

### Changing Collision Sensitivity

Edit thresholds in `CollisionSystem.ts`:

```ts
// RA — make collision harder to trigger (increase divisor)
const raDist = (p1.getCollisionRadius() + p2.getCollisionRadius()) / 2;

// TA — widen warning zone (increase warning radii in planes_config.ts)
const taDist = (p1.getWarningRadius() + p2.getWarningRadius()) / 2;
```

### Changing Plane Spawn Behaviour

Edit `defaults_config.ts` (`MIN_PLANES`, `MAX_PLANES`, `spawnRate`) or override per-level in `levels_config.ts`.

---

## 🧪 Testing Checklist

- [ ] `pnpm dev` starts without errors
- [ ] Intro → Home → PlayFields → Airfields → select airport → game loads
- [ ] Planes spawn and fly across screen
- [ ] Drawing a path redirects a plane
- [ ] Directing a plane to a runway causes it to land (disappears, score increases)
- [ ] Two planes at the same level show orange warning circles when close
- [ ] Two planes at the same level that fully overlap trigger collision overlay
- [ ] Planes at **different** altitude levels pass through each other silently
- [ ] "Try Again" restarts the same level cleanly (no stale circles, fresh spawn)
- [ ] "Go to Main Menu" navigates to `/menu`
- [ ] Pause works during gameplay
- [ ] Trial plays decrement correctly
- [ ] Purchase modal appears when trial exhausted

### Cross-Platform Build Tests

```bash
# Web
pnpm build:app

# Electron
pnpm dist:electron

# Android
pnpm build:app
pnpm --filter @atc-app/mobile exec cap sync android
pnpm --filter @atc-app/mobile exec cap run android

# iOS
pnpm build:app
pnpm --filter @atc-app/mobile exec cap sync ios
pnpm --filter @atc-app/mobile exec cap run ios
```

---

## 🐛 Debugging Tips

### Game not loading

```js
// Browser console (F12)
// Look for: Phaser boot errors, image 404s, EventBus errors
window.__gameEventBus.eventNames(); // lists all active event listeners
```

### Collision overlay not showing

- Check `AirTrafficCanvas.vue` — `handleLevelFailed` must be registered with `gameEventBus.on('level:failed', …)` in `onMounted`
- Check `CollisionSystem.ts` — confirm `ctx.isGameOver` is `false` at the start of the frame when planes overlap

### Stale collision circles after restart

- `shutdown()` must call `this.collisionGraphics?.destroy()` — these are scene-level objects, not `worldContainer` children

### Listener leaking / double-fire after restart

- All `gameEventBus` listeners in `GameScene` must be removed in `shutdown()` using the stored bound references (`_onGameRestart`, etc.)
- Never pass a fresh `.bind()` to `off()` — it creates a new function object and the original is never removed

### Purchase system not working

```js
// Browser console:
usePurchaseStore().setPurchased(true); // unlock full version
usePurchaseStore().resetTrial(); // restore trial plays
```

---

## 💡 Architecture Decisions

**Why Phaser 3 over raw Canvas?**
Phaser provides WebGL rendering, a built-in scene system, texture management, and input handling — replacing several custom managers from the earlier Canvas prototype. Raw Canvas was fine for MVP but Phaser scales better as complexity grows.

**Why no lives system?**
A single collision immediately ends the level. Lives added complexity without improving the ATC simulation feel — real ATC has zero tolerance for mid-air collisions.

**Why separate `CollisionSystem.ts`?**
`GameScene` was growing large. Collision logic is self-contained (inputs: plane list + transform cache; outputs: collision event + scene pause) and benefits from isolated testing and documentation.

**Why store bound listener references?**
`eventEmitter.off(event, fn.bind(this))` never works — `.bind()` creates a new function each call. Storing the bound ref on the instance is the only reliable way to unregister in `shutdown()`.

---

_Last updated: 2026-02-27_
