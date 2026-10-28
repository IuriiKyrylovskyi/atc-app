# 🎮 ATC-APP — Game Architecture Guide

> Technical reference for the Phaser 3 game layer: scenes, objects, systems, and event flow.

---

## 📋 Table of Contents

- [Overview](#overview)
- [File Structure](#file-structure)
- [Scene Lifecycle](#scene-lifecycle)
- [World Coordinate System](#world-coordinate-system)
- [Game Objects](#game-objects)
- [Collision System](#collision-system)
- [Event System](#event-system)
- [Extending the Game](#extending-the-game)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)

---

## 🎯 Overview

The game layer is a self-contained Phaser 3 application mounted inside `AirTrafficCanvas.vue`. It has **no direct Vue dependencies** — all communication goes through `gameEventBus`.

### Key Benefits

- ✅ **Isolated** — game logic never imports Vue or Pinia directly
- ✅ **Testable** — each system has a clear interface
- ✅ **Type-safe** — all events defined in `GameEvents` interface
- ✅ **Restart-safe** — `shutdown()` fully clears state and listeners on every restart

---

## 📁 File Structure

```
src/
├── scenes/
│   ├── BootScene.ts              # Preloads all assets, then starts GameScene
│   ├── GameScene.ts              # Main gameplay scene
│   ├── LevelScene.ts             # Pause/resume handling
│   └── PauseScene.ts             # Pause overlay scene
│
├── game/
│   ├── config/
│   │   ├── defaults_config.ts    # BASE_SIZE, MIN/MAX_PLANES, device scale factors
│   │   ├── levels_config.ts      # Level definitions (fractional runway/waypoint coords)
│   │   ├── planes_config.ts      # Plane type configs (radii, base sizes, colors)
│   │   ├── phaser_config.ts      # Phaser game config (WebGL, DPR, resize)
│   │   └── aspectRatio_config.ts # Background image key selection per aspect ratio
│   │
│   ├── objects/
│   │   ├── Plane.ts              # Sprite: texture norm, path following, altitude levels
│   │   ├── Runway.ts             # Runway strip (child of worldContainer)
│   │   └── Waypoint.ts           # Edge-pinned exit/entry point
│   │
│   ├── systems/
│   │   ├── CollisionSystem.ts    # Standalone RA/TA detection + collision circle drawing
│   │   ├── PathProcessor.ts      # Path resampling, direction smoothing, closest-point
│   │   ├── SpawnSystem.ts        # Plane spawning — runway departures + edge-entry
│   │   ├── WorldTransform.ts     # Screen↔world conversion, viewport bounds, cover-scale
│   │   ├── InputSystem.ts        # Pointer drag, path drawing, runway/waypoint projection
│   │   ├── DrawSystem.ts         # Entry zone overlay, collision circle rendering
│   │   └── AudioSystem.ts        # Music, predict loop, collision/beap/success SFX
│   │
│   └── utils/
│       ├── dprScale.helper.ts    # DPR-aware pixel sizing
│       └── assetLoader.ts        # Background image key resolution
│
├── services/
│   └── EventBus.ts               # Type-safe singleton event bus
│
└── types/
    └── game.d.ts                 # Shared TypeScript interfaces
```

---

## 🔄 Scene Lifecycle

```
Phaser.Game created by useGame.ts composable
        │
        ▼
BootScene.preload()
  └─ loads all textures (backgrounds, plane sprites, shadows)
        │
        ▼
BootScene.create()
  └─ this.scene.start('GameScene', { level: N })
        │
        ▼
GameScene.init({ level })
  └─ reads level number from data or gameStore
        │
        ▼
GameScene.create()
  ├─ builds worldContainer (cover-scaled)
  ├─ creates background, runways, waypoints, graphics layers
  ├─ registers input handlers
  ├─ registers gameEventBus listeners (stored as bound refs)
  └─ emits game:ready
        │
        ▼
GameScene.update() — runs every frame
  ├─ plane.update() for each plane
  ├─ CollisionSystem.check()  → sets isGameOver, _cachedConflictCount
  ├─ AudioSystem.update()     → predict loop on/off, RA sound on collision
  ├─ filter offscreen planes  → emit plane:landed / plane:waypoint-passed
  ├─ SpawnSystem.trySpawn()   → spawn new planes if below MIN_PLANES
  ├─ InputSystem.drawPaths() / drawProjections()
  ├─ DrawSystem.drawCollisionCircles()
  └─ emit stats:update (throttled to ~10×/s)
        │
  [on collision]
        ▼
CollisionSystem.check()
  ├─ isGameOver = true
  ├─ scene.pause()               ← Phaser freezes update loop
  └─ emit level:failed           ← Vue shows collision overlay
        │
  [Try Again]
        ▼
game:restart event
  └─ scene.resume() + scene.restart({ level })
        │
        ▼
GameScene.shutdown()
  ├─ destroy worldContainer + all graphics layers
  ├─ clear planes / runways / waypoints / collidedPlanes
  ├─ isGameOver = false
  └─ remove all gameEventBus listeners (by stored ref)
```

---

## 🌐 World Coordinate System

```
World origin = centre of screen

        ─960                    +960
   ─540  ┌────────────────────────┐
         │                        │
         │   worldContainer       │
         │   1920 × 1080 units    │
         │                        │
   +540  └────────────────────────┘

worldScale = Math.max(screenW / 1920, screenH / 1080)
worldContainer.x = screenW / 2
worldContainer.y = screenH / 2
```

**Converting fractional config coords to world-local:**

```ts
worldX = fraction * WORLD_W - WORLD_W / 2; // fraction * 1920 − 960
worldY = fraction * WORLD_H - WORLD_H / 2; // fraction * 1080 − 540
```

**Converting world-local to screen:**

```ts
screenX = worldContainer.x + worldX * worldScale;
screenY = worldContainer.y + worldY * worldScale;
```

---

## ✈️ Game Objects

### Plane

Lives in `worldContainer`. Key concepts:

| Concept                   | Detail                                                                         |
| ------------------------- | ------------------------------------------------------------------------------ |
| `textureScale`            | Normalises raw texture px → `baseSize` game units (`baseSize / texturePxSize`) |
| `baseScale`               | Logical scale: 0.9 at level −1, 1.0 at level 0, 1.2 at level +1                |
| Sprite scale              | Always `baseScale * textureScale`                                              |
| `isActiveForCollisions()` | `true` when not in departure delay or departure scale-up                       |
| Altitude level            | −1 (landing), 0 (free flight), +1 (approaching waypoint)                       |

Landing planes animate `baseScale` DOWN to 0.9 — they remain fully collision-eligible throughout.

### Runway

Child of `worldContainer`. Positioned in world-local coords from fractional config. Handles:

- Visual strip rendering
- Landing target calculation
- Departure spawn point

### Waypoint

Screen-space object, edge-pinned. `snapWaypointsToEdges()` recalculates position on every resize. Handles:

- Triangular approach neck
- Exit ray calculation (opposite screen edge)
- Allowed-color gating

---

## 💥 Collision System

`CollisionSystem.ts` is intentionally **stateless** — it receives everything it needs via `CollisionSceneContext` (passed as `this` from `GameScene`).

### API

```ts
// Call every frame in GameScene.update()
const result = CollisionSystem.check(this);
this._cachedConflictCount = result.conflictCount;

// Call every frame in GameScene (after check)
CollisionSystem.drawCircles(this.collisionGraphics, this, this.time.now);
```

### Detection Rules

```
For each pair (p1, p2) where i < j:
  skip if either plane is outside viewport
  skip if either plane isActiveForCollisions() = false  (departure scaling)
  skip if p1.level !== p2.level                         (altitude separation)

  dist = distance(p1, p2)
  raDist = (p1.collisionRadius + p2.collisionRadius) / 2
  taDist = (p1.warningRadius   + p2.warningRadius)   / 2

  if dist < raDist  → COLLISION: pause scene, emit level:failed
  if dist < taDist  → WARNING:   set plane.warning = { color: 'orange' }
```

### Why `/2` for the RA threshold?

The `/2` is intentional — planes must overlap by at least half their combined radii before a collision fires. This gives players a small grace window and reduces false positives near the boundary. It is **not** a bug.

---

## 📡 Event System

### Core Rule

> The game layer **emits** events. The Vue layer **listens** to them.
> The Vue layer **emits** control events. The game layer **listens** to them.
> Neither layer imports the other.

### Available Events

```ts
// Game → Vue
'game:ready'; // Phaser scene fully initialised
'plane:landed'; // (planeId, points)
'plane:collision'; // ({ plane1Id, plane2Id, position })
'plane:waypoint-passed'; // (planeId, points)
'plane:attached'; // (planeId, target: 'runway' | 'waypoint')
'level:failed'; // (reason: string)
'level:complete'; // (data: LevelCompleteData)
'stats:update'; // ({ activePlanes, planesLanded, waypointPasses, conflicts })

// Vue → Game
'game:init'; // ({ levelId }) — switch to a different level
'game:restart'; // () — retry current level (used by collision overlay)
'game:pause'; // ()
'game:resume'; // ()
'settings:zoom'; // (zoom: number)
'settings:background'; // ({ dimming, alpha })
```

### Listener Cleanup Pattern

Always store listener references and remove them in `onUnmounted` (Vue) or `shutdown()` (Phaser):

```ts
// ✅ Correct
const handler = (data) => {
  /* … */
};
gameEventBus.on('level:failed', handler);
onUnmounted(() => gameEventBus.off('level:failed', handler));

// ❌ Wrong — .bind() creates a new object each call, off() never matches
gameEventBus.on('level:failed', myMethod.bind(this));
gameEventBus.off('level:failed', myMethod.bind(this)); // never removes it
```

---

## 🔨 Extending the Game

### Adding a New Level

See `LevelBackground_PositioningGuide.md` and `README.md → Adding a New Level`.

### Adding a New Plane Type

1. Add entry to `planes_config.ts` with `baseSize`, `collisionRadius`, `warningRadius`, `connectionColor`
2. Add sprite to `public/planes/` (facing right, top-down view, transparent background)
3. Ensure `BootScene` loads the new texture key

### Adding a New Game System (e.g. WeatherSystem)

```ts
// src/game/systems/WeatherSystem.ts

export interface WeatherContext {
  planes: Plane[];
  // … other fields needed
}

export const WeatherSystem = {
  update(ctx: WeatherContext): void {
    // affect plane speeds, etc.
  },
};
```

Then in `GameScene.update()`:

```ts
WeatherSystem.update(this);
```

### Audio System

`AudioSystem` is fully implemented and event-driven. `GameScene` only calls four lifecycle methods — all SFX triggering is handled internally via `gameEventBus` listeners.

#### Lifecycle integration

```ts
// BootScene.preload()
AudioSystem.preload(scene); // registers all audio files with Phaser loader

// GameScene.create()
AudioSystem.init(); // registers event listeners (no-op after first call)
AudioSystem.startMusic(this); // starts looping level track, fades in

// GameScene.update()  — after CollisionSystem.check()
AudioSystem.update(this, time);

// GameScene.shutdown()  — first line
AudioSystem.stopAll(this);
```

#### Sound files (`public/sounds/`)

| File                | Trigger                                                      |
| ------------------- | ------------------------------------------------------------ |
| `music-level-N.mp3` | Background music — loops per level, pauses on `game:pause`   |
| `predict.mp3`       | Loops while TA yellow circles visible; stops when they clear |
| `collision.wav`     | One-shot on fatal collision; music cut at same moment        |
| `beap.mp3`          | One-shot per plane landing or waypoint pass                  |
| `success.wav`       | One-shot when plane path committed to runway or waypoint     |

#### Adding a new sound

1. Place the file in `public/sounds/`
2. Add `scene.load.audio('my-key', 'sounds/my-file.mp3')` in `AudioSystem.preload()`
3. Add a listener in `AudioSystem.init()` (for event-driven sounds) or a public method (for direct calls)
4. Guard every `.get()` / `.play()` with `soundManagerAlive()` to prevent crashes during scene teardown

---

## 🎓 Best Practices

### 1. Always clean up listeners

Store bound refs as instance properties; remove in `shutdown()` / `onUnmounted()`.

### 2. Never import Vue/Pinia from the game layer

Use `gameEventBus` for all cross-layer communication.

### 3. Use `CollisionSceneContext` not `GameScene` directly

`CollisionSystem` accepts an interface, not the concrete class. This makes the system portable and testable in isolation.

### 4. Guard Phaser updates after shutdown

```ts
update(time: number): void {
  if (!this.scene?.sys?.isActive()) return;
  // … rest of update
}
```

### 5. Resize = re-snap, not re-create

`applyWorldTransform()` repositions and rescales everything. Game objects don't need to be destroyed and recreated on resize.

---

## 🐛 Troubleshooting

| Symptom                                                                 | Likely Cause                                                                        | Fix                                                                                              |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Collision circles remain after restart                                  | `collisionGraphics` not destroyed in `shutdown()`                                   | Add `this.collisionGraphics?.destroy()` to `shutdown()`                                          |
| Collision fires twice                                                   | `game:restart` listener not removed; registers again on `create()`                  | Use stored bound refs; `off()` in `shutdown()`                                                   |
| Landing planes don't trigger collision                                  | `isActiveForCollisions()` wrongly gates on `baseScale`                              | Check — it should only gate on `isDepartureScaling && isDepartureDelayed`                        |
| Planes spawn off-screen                                                 | `spawnPlane()` uses `WORLD_W/2` instead of visible bounds                           | Use `getVisibleWorldBounds()`                                                                    |
| Scene restart is a no-op                                                | `scene.restart()` called while scene is paused                                      | Call `scene.resume()` first                                                                      |
| Stats emitting every frame                                              | `_lastStatsEmit` not updated                                                        | Check throttle logic in `GameScene.update()`                                                     |
| `TypeError: Cannot read properties of null (reading 'length')` in audio | `game:pause` fired after scene teardown — `sound.get()` called on destroyed manager | `soundManagerAlive()` guard in `AudioSystem` prevents this — ensure it wraps every `.get()` call |
| Beap / success sound never plays                                        | `AudioSystem.init()` not called — event listeners never registered                  | Call `AudioSystem.init()` from `GameScene.create()` (has no-op guard so retries are safe)        |
