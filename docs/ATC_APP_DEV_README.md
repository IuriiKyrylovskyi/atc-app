# ATC-APP — Developer Reference

Complete map of every system, event, DB schema, and critical fix.
Update this file alongside every code change.

---

## Architecture Overview

```
Vue (UI layer)                       Phaser (game engine)
───────────────────────────────────  ────────────────────────────────────
IntroScreen.vue    → splash / ATT    BootScene.ts    → silent asset load
AirTrafficCanvas.vue → game shell    GameScene.ts    → main game loop
GameHUD.vue        → stats / pause   Plane.ts        → plane entity
SpeedControlPopup.vue → selection    CollisionSystem.ts
                                     InputSystem.ts  → drag / tap / input
                                     SpawnSystem.ts  → plane spawning
                                     DrawSystem.ts   → entry zone visuals
                                     PathProcessor.ts → path maths
                                     WorldTransform.ts → coord conversion

Backend
───────────────────────────────────
Supabase Auth      → anonymous + upgrade
Supabase DB        → profiles, level_scores (see schema below)
Supabase Storage   → level-backgrounds bucket (paid bg images)
Supabase Edge Fn   → revenuecat-webhook (updates is_premium)
RevenueCat         → iOS / Android in-app purchase
RevenueCat Web     → web / desktop purchase (Paddle via Web Billing)
AdMob              → interstitial ads (free users only)
```

Communication between Vue and Phaser is exclusively via **`gameEventBus`**
(typed mitt emitter at `@/services/EventBus`). Never import Phaser objects
into Vue components or Vue stores into Phaser scenes directly — use the bus.

---

## Loading Flow

```
User opens app
  └─ IntroScreen.vue
       • Animated splash (Vue init only — NOT real asset loading)
       • "Start" → monetization.init() → ensureAuth() → router.push('/game')

User taps Play Level N
  └─ GameView.vue mounts AirTrafficCanvas.vue + GameHUD.vue
       • AirTrafficCanvas mounts → useGame() → GameCore.init() → Phaser starts
       • BootScene.preload() fires immediately (Phaser scene 1)
           → emits  assets:progress { pct, step }  for every milestone
           → AirTrafficCanvas.vue shows Vue sky-blue boot overlay + LoadingBar
           → GameHUD stays hidden (sceneReady = false, via v-if)
       • BootScene finishes → 300 ms pause → starts GameScene
       • GameScene.create() runs
           → loadLevelBackground() — fetches paid bg from Supabase if needed
           → emits  game:scene-ready
           → boot overlay fades out
           → GameHUD becomes visible (sceneReady = true)
```

### Why BootScene has no canvas UI

The old BootScene rendered Phaser Graphics + Text objects onto the canvas.
This produced a broken double-loading-screen: the Phaser bar appeared under
the Vue overlay on IntroScreen, then over it once the canvas mounted.
BootScene now does zero canvas rendering. All progress is reported via
`assets:progress` events and shown in a native Vue overlay.

---

## Supabase — Full Schema

### Auth

Supabase Auth handles all identity. Users start as anonymous
(`signInAnonymously()`). Anonymous accounts can be upgraded to email/password
later without losing their data (Supabase's account linking).

```
auth.users           (managed by Supabase — do not create manually)
├── id               uuid PK
├── email            text nullable
├── created_at       timestamptz
└── last_sign_in_at  timestamptz
```

---

### Table: `profiles`

One row per user. Created automatically via a Supabase trigger on
`auth.users INSERT`, or on first `syncFromServer()` call.

```sql
create table profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  is_premium      boolean   not null default false,
  last_passed_level text,    -- '[airport]:[shiftEnum]', e.g. 'eglc:1', 'WADD:4'
  passed_levels   jsonb,    -- { 'eglc': '1', 'ksdm/mmtj': '3', ... }
  platform        text      not null default 'web',
                   -- 'ios' | 'android' | 'web' | 'electron'
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Trigger: keep updated_at current
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at
  before update on profiles
  for each row execute function set_updated_at();
```

**Row-Level Security:**

```sql
alter table profiles enable row level security;

-- Users can read and update only their own row
create policy "own profile" on profiles
  for all using (auth.uid() = id);

-- Edge Functions use the service_role key → bypass RLS
```

**Written by:**

- `monetization.ts → markLevelPassed()` — updates `last_passed_level` + `passed_levels` (the `[airport]:[shiftEnum]` form)
- `revenuecat-webhook` Edge Function — updates `is_premium = true`

**Read by:**

- `monetization.ts → syncFromServer()` — reads `is_premium`, `last_passed_level`, `passed_levels`, `platform`

> The shift half of `last_passed_level` is the numeric SHIFT_ENUM (1=red-eye … 5=meltdown), not the shift's string `id`. This is deliberate: a future rename of a shift slug would otherwise silently break every stored value on every device and on the server. `endless` is deliberately absent — it has no completion screen.

---

### Table: `level_scores` _(TODO — not yet created)_

Best score per user per level. Written after `level:complete` event.

```sql
create table level_scores (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles(id) on delete cascade,
  level_number    int  not null,
  planes_landed   int  not null default 0,
  waypoint_passes int  not null default 0,
  planes_missed   int  not null default 0,
  -- total = landed + waypoint_passes - missed
  total_score     int  not null generated always as
                    (planes_landed + waypoint_passes - planes_missed) stored,
  stars           int  not null default 0 check (stars between 0 and 3),
  completed_at    timestamptz not null default now(),

  -- one row per user per level (upsert on completion)
  unique (user_id, level_number)
);

alter table level_scores enable row level security;

create policy "own scores" on level_scores
  for all using (auth.uid() = user_id);
```

**Star rating formula** (implement in `GameScene.checkLevelComplete()`):

```
1 star → planesLanded >= planesTarget × 0.6
2 star → planesLanded >= planesTarget × 0.8  AND missed = 0
3 star → planesLanded = planesTarget          AND missed = 0
```

---

### Supabase Storage: `level-backgrounds` bucket

Background images for paid levels. Never bundled in the app binary.

```
Bucket name:   level-backgrounds
Public:        true  (URLs are public; access is controlled client-side
                      by canAccessLevel() check before requesting the URL)

File naming convention:
  level-{N}@1x.jpg   long axis < 1400 px  (phones, small tablets)
  level-{N}@2x.jpg   long axis ≥ 1400 px  (iPad Pro, desktop)

Example:
  level-2@1x.jpg
  level-2@2x.jpg
  level-3@1x.jpg
  level-3@2x.jpg
  ...

Resolution targets:
  @1x  →  1920 × 1080 px  (game world reference size)
  @2x  →  3840 × 2160 px  (4K / Retina)
```

**Download flow in `GameScene.loadLevelBackground()`:**

1. Check `this.textures.exists("level-N")` — skip if already cached
2. Check `monetization.canAccessLevel(N)` — skip if not purchased
3. Pick resolution bucket based on `Math.max(camW, camH) >= 1400`
4. `supabase.storage.from('level-backgrounds').getPublicUrl(path)` — sync, no error field
5. `this.load.image(textureKey, publicUrl)` + `this.load.start()` → await complete
6. `createBackground()` picks it up from the Phaser texture cache

**Free levels (1–FREE_LEVEL_LIMIT=3):** backgrounds bundled with app via
`assetLoader.ts` → loaded in BootScene alongside plane sprites.

---

### Supabase Edge Functions

#### `revenuecat-webhook`

Path: `supabase/functions/revenuecat-webhook/index.ts`

Triggered by RevenueCat on every purchase, renewal, or cancellation event.
Verifies the webhook signature, finds the Supabase user by RevenueCat
`app_user_id`, and flips `profiles.is_premium`.

```
POST /functions/v1/revenuecat-webhook
Headers: Authorization: Bearer <SUPABASE_ANON_KEY>
Body:    RevenueCat webhook payload (see RC docs)

Updates:
  profiles.is_premium = true   on INITIAL_PURCHASE, RENEWAL, UNCANCELLATION
  profiles.is_premium = false  on CANCELLATION, EXPIRATION (optional — decide policy)
```

**TODO:** The current webhook sets `is_premium = true` but never sets it
back to `false`. Decide whether cancellation/expiration should revoke access.

---

### Environment Variables

```env
# .env.local (never commit)
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGc...
VITE_RC_IOS_KEY=appl_...
VITE_RC_ANDROID_KEY=goog_...
VITE_RC_WEB_BILLING_PUBLIC_KEY=...   # RevenueCat Web Billing (Paddle) — public key only

# Supabase Edge Function secrets (set via supabase secrets set)
SUPABASE_URL=                    # auto-provided
SUPABASE_SERVICE_ROLE_KEY=       # auto-provided
REVENUECAT_WEBHOOK_SECRET=       # from RC dashboard
```

---

## Monetization Store API (`@/stores/monetization.ts`)

| Export                   | Type                                      | Description                                |
| ------------------------ | ----------------------------------------- | ------------------------------------------ |
| `FREE_LEVEL_LIMIT`       | `const number = 3`                        | Levels 1–3 are free                        |
| `isPremium`              | `Ref<boolean>`                            | true after successful purchase             |
| `canAccessLevel`         | `ComputedRef<(level: number) => boolean>` | `level <= maxAccessibleLevel`              |
| `maxAccessibleLevel`     | `ComputedRef<number>`                     | 999 if premium, else FREE_LEVEL_LIMIT      |
| `init()`                 | `async fn`                                | Auth + RevenueCat + AdMob + syncFromServer |
| `purchase(pkg?)`         | `async fn`                                | RC on native, RevenueCat Web on web        |
| `restorePurchases()`     | `async fn`                                | RC restore + server sync                   |
| `saveProgress(level)`    | `async fn`                                | Updates `profiles.current_level`           |
| `syncFromServer(force?)` | `async fn`                                | Reads profile, throttled 60 s              |

⚠️ `hasPurchased(levelId)` does **not exist**. Use `canAccessLevel(levelId)`.

---

## Event Bus Reference

All events on `gameEventBus`. Register in `onMounted`/`setup()`,
remove in `onUnmounted`/`shutdown()`. Never use inline arrow functions
for `off()` — they won't match.

### Boot / scene lifecycle

| Event              | Payload                         | Emitted by                    | Consumed by                                       |
| ------------------ | ------------------------------- | ----------------------------- | ------------------------------------------------- |
| `assets:progress`  | `{ pct: number, step: string }` | BootScene                     | AirTrafficCanvas boot overlay                     |
| `assets:loaded`    | —                               | BootScene                     | useGame.ts                                        |
| `assets:error`     | `assetKey: string`              | BootScene                     | useGame.ts                                        |
| `game:scene-ready` | —                               | GameScene.create()            | GameHUD (`v-if`), AirTrafficCanvas (hide overlay) |
| `game:ready`       | —                               | GameScene.create()            | useGame.ts                                        |
| `game:restart`     | —                               | AirTrafficCanvas              | GameHUD (reset counters + hide)                   |
| `game:pause`       | —                               | useGame.ts                    | AudioSystem, SpeedControlPopup                    |
| `popup:opened`     | —                               | AirTrafficCanvas              | GameHUD (hides pause btn)                         |
| `popup:closed`     | —                               | AirTrafficCanvas              | GameHUD (shows pause btn)                         |
| `popup:close`      | —                               | GameScene Phaser `pause` hook | AirTrafficCanvas (force-close popup)              |

### Plane lifecycle

| Event                   | Payload                                                                                 | Emitted by                   | Consumed by                                                   |
| ----------------------- | --------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------- |
| `plane:spawned`         | `{ id }`                                                                                | SpawnSystem                  | useGame.ts                                                    |
| `plane:tapped`          | `PopupPlaneData`                                                                        | InputSystem                  | AirTrafficCanvas → SpeedControlPopup                          |
| `plane:tap-deselect`    | —                                                                                       | SpeedControlPopup, GameScene | AirTrafficCanvas                                              |
| `plane:offscreen`       | `{ planeId }`                                                                           | GameScene planes filter      | AirTrafficCanvas (close popup if selected)                    |
| `plane:landed`          | `(planeId, score)`                                                                      | GameScene                    | useGame.ts, GameScene stats                                   |
| `plane:waypoint-passed` | `(planeId, score)`                                                                      | GameScene                    | useGame.ts, GameScene stats                                   |
| `plane:missed`          | `{ planeId }`                                                                           | GameScene                    | GameScene stats                                               |
| `plane:collision`       | `CollisionData`                                                                         | CollisionSystem              | useGame.ts                                                    |
| `plane:attached`        | `(planeId, 'runway'│'waypoint')`                                                        | InputSystem                  | SpeedControlPopup (live btn state)                            |
| `plane:setSpeed`        | `{ planeId, speed }`                                                                    | SpeedControlPopup            | GameScene                                                     |
| `plane:cancelApproach`  | `{ planeId }`                                                                           | SpeedControlPopup            | GameScene (data), InputSystem (dots), SpeedControlPopup (btn) |
| `level:complete`        | `{ levelNumber, planesLanded, waypointPasses, planesTarget }`                           | GameScene                    | useGame.ts, AirTrafficCanvas overlay                          |
| `level:failed`          | `'collision'`                                                                           | CollisionSystem              | AirTrafficCanvas collision overlay                            |
| `stats:update`          | `{ activePlanes, planesLanded, waypointPasses, planesMissed, planesTarget, conflicts }` | GameScene (~1×/s)            | GameHUD                                                       |

### `PopupPlaneData` (plane:tapped payload)

```typescript
{
  id: number;
  callsign: string;
  aircraftType: string;
  weightClass: string;
  currentSpeed: number;
  minSpeed: number;
  maxSpeed: number;
  isApproaching: boolean; // runway connection
  isApproachingWaypoint: boolean; // waypoint connection ⚠️ DO NOT REMOVE
}
```

---

## HUD Stats Formula

```
LAND  = planes that completed a runway landing
ROUTE = planes that passed through a connected waypoint (en-route exit)
MISS  = planes that exited the world with no connection (free flight)
TOTAL = LAND + ROUTE − MISS
```

---

## Critical Fixes — DO NOT REVERT

### Plane.ts — path-following circling bug

**File:** `Plane.ts` → `update()` → search `Forward-scan catch-up`

Single `if (distance < pathAccuracy) pathIndex++` could only advance one
point per frame. On sharp turns at high speed the plane physically overshot
several dots — `targetAngle` pointed backward → plane orbited. Changing speed
appeared to "fix" it by coincidence.

**Fix:** Bounded 30-point forward-scan finds the geometrically closest ahead
point every frame regardless of lateral overshoot.

⚠️ DO NOT replace with a single fixed-radius distance check.

---

### InputSystem.ts — tap must not disconnect a connected plane

**File:** `InputSystem.ts` → `handlePointerDown` / `handlePointerMove` (`_tapMoved`)

`clearPath()` + `resetToNeutral()` + `clearPlaneDots()` previously fired at
`pointerdown` before knowing if it was a tap or drag. A short tap silently
disconnected the plane.

**Fix:** All three calls deferred to the first confirmed drag movement
(`_tapMoved` transitions to `true` in `handlePointerMove`).

⚠️ DO NOT move these calls back to `pointerdown`.

---

### InputSystem.ts — `plane:tapped` must include `isApproachingWaypoint`

**File:** `InputSystem.ts` → `handlePointerUp` → tap branch

`isApproachingWaypoint` was missing from the payload. SpeedControlPopup seeded
`liveIsWaypoint = false` on every open → "Cancel en-route" never appeared.

⚠️ DO NOT remove `isApproachingWaypoint` from the `plane:tapped` payload.

---

### InputSystem.ts — waypoint snap requires ±30° angle check

**File:** `InputSystem.ts` → `handlePointerMove` → waypoint snap loop

Without an angle gate, any path ending near the neck connected regardless of
direction. Added `angleDifference(approachAngle, expectedBearing) > 30°`
matching the runway `angleTolerance` check.

⚠️ DO NOT remove the angle gate in the waypoint snap loop.

---

### InputSystem.ts — `plane:cancelApproach` must clear visual dots

**File:** `InputSystem.ts` → `setup()` → `onCancelApproachDots`

GameScene clears path DATA. InputSystem owns the dot GRAPHICS — they are
separate objects. Without this listener the trail stays on screen after cancel.

⚠️ DO NOT remove the listener or its `shutdown()` cleanup.

---

### CollisionSystem.ts — zero-margin viewport check

**File:** `CollisionSystem.ts` → `check()` + `drawCircles()`

Uses `isInViewport(..., 0, ...)` — NOT `isPlaneInViewport()`. The latter adds
the collision radius as a margin outside the screen, allowing invisible
off-screen collisions.

⚠️ DO NOT swap back to `isPlaneInViewport()`.

---

### SpawnSystem.ts — HUD margins in screen pixels, not world units

**File:** `SpawnSystem.ts` → `HUD_MARGIN_X_PX`, `HUD_MARGIN_Y_PX`, `computeEdgeBands()`

The world is cover-fit. Percentage-of-world margins produce wrong clearance on
non-16:9 screens (verified: old 15% margin left planes spawning under the stats
panel on a 4:3 iPad). Margins are screen pixels, converted via `worldScale`
at runtime inside `computeEdgeBands()`.

⚠️ DO NOT revert to percentage-of-world-size margins.

---

### GameHUD.vue — hidden during boot

**File:** `GameHUD.vue` → root element has `v-if="sceneReady"`

`sceneReady` is false until `game:scene-ready` fires from `GameScene.create()`.
Without this guard the HUD overlays the BootScene loading screen.

⚠️ DO NOT remove `v-if="sceneReady"` from GameHUD's root element.

---

### Vue scoped CSS — never use `:root` for custom properties

**Files:** `Home.vue`, `IntroScreen.vue`

Scoped styles rewrite `:root` to `:root[data-v-xxxx]` — never matches `<html>`.
Define tokens on the component's own root class (e.g. `.intro-screen`).
Custom properties cascade to all descendants automatically.

---

### GameScene.ts — `canAccessLevel` not `hasPurchased`

**File:** `GameScene.ts` → `loadLevelBackground()`

`hasPurchased(levelId)` does not exist on `useMonetizationStore`. The correct
API is `canAccessLevel(levelId)` (a computed returning a function).
`FREE_LEVEL_LIMIT` is imported from `@/stores/monetization` — do not hardcode.

⚠️ DO NOT call `monetization.hasPurchased()` — it does not exist.

---

### GameScene.ts — use `supabase.storage` directly

**File:** `GameScene.ts` → `loadLevelBackground()`, import block

`useSupabaseStorage` composable does not exist. Use `supabase` from
`@/lib/supabase` directly. `getPublicUrl()` is synchronous and returns
`{ data: { publicUrl } }` — no `error` field.

⚠️ DO NOT import from `@/composables/useSupabaseStorage` — the file does not exist.

---

## What Is Left To Do

### High priority

| #   | Task                                                                                                                | File(s)                        |
| --- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| 1   | Create `level_scores` table in Supabase (SQL above) + RLS policy                                                    | Supabase dashboard             |
| 2   | Upload level background images to `level-backgrounds` bucket at `@1x` + `@2x`                                       | Supabase Storage               |
| 3   | Write score to `level_scores` after `level:complete` event                                                          | `useGame.ts` or `GameScene.ts` |
| 4   | Implement star rating logic in `GameScene.checkLevelComplete()`                                                     | `GameScene.ts`                 |
| 5   | Add `AirTrafficCanvas.vue` boot-overlay template + CSS (sky-blue, `LoadingBar`, driven by `assets:progress`)        | `AirTrafficCanvas.vue`         |
| 6   | Confirm `LoadingBar.vue` exists at `@/components/ui/LoadingBar.vue` and accepts `progress: number` + `step: string` | `LoadingBar.vue`               |

### Medium priority

| #   | Task                                                                            | File(s)                                                 |
| --- | ------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 7   | Level select screen: lock/unlock based on `monetization.canAccessLevel()`       | `PlayFieldsScreen.vue`                                  |
| 8   | Level complete modal wired to `level:complete` event with star display          | `AirTrafficCanvas.vue` / new `LevelCompleteOverlay.vue` |
| 9   | Decide RevenueCat cancellation / expiration policy (flip `is_premium = false`?) | `revenuecat-webhook` Edge Fn                            |
| 10  | `plane:attached` emission — verify emitted on ALL drag-commit code paths        | `InputSystem.ts`                                        |
| 11  | Persist `current_level` to `profiles` on level complete                         | `useGame.ts` → `monetization.saveProgress()`            |

### Low priority / polish

| #   | Task                                                                                 | File(s)                        |
| --- | ------------------------------------------------------------------------------------ | ------------------------------ |
| 12  | Waypoint angle tolerance hardcoded at 30° — expose in level config                   | `InputSystem.ts`, level config |
| 13  | `ENTRY_CORNERS` tuning — verify white corner zones at real device sizes              | `GameScene.ts`                 |
| 14  | `HUD_MARGIN_X/Y_PX` — validate on small phone screens (375 px wide)                  | `SpawnSystem.ts`               |
| 15  | IntroScreen ATT pre-prompt copy — legal review before App Store submission           | `IntroScreen.vue`              |
| 16  | Confirm `AudioSystem.preload()` gracefully skips missing files in prod               | `AudioSystem.ts`               |
| 17  | Add Supabase trigger to auto-create `profiles` row on `auth.users` insert            | Supabase dashboard             |
| 18  | Encrypt / sign Supabase Storage URLs for paid assets (optional, belt-and-suspenders) | Supabase Storage policy        |

---

## File Map

```
src/
├── components/
│   ├── game/
│   │   ├── AirTrafficCanvas.vue    ← Phaser shell, boot overlay, popup mgmt
│   │   ├── GameHUD.vue             ← stats card + pause button
│   │   └── SpeedControlPopup.vue   ← speed / cancel approach popup
│   └── ui/
│       └── LoadingBar.vue          ← reusable progress bar (TODO: verify)
├── composables/
│   └── useGame.ts                  ← Phaser lifecycle bridge
├── game/
│   ├── config/
│   │   ├── defaults.config.ts      ← PATH_CONFIG, plane defaults
│   │   ├── levels.config.ts        ← level definitions
│   │   └── planes.config.ts        ← plane type variants
│   ├── objects/
│   │   ├── Plane.ts                ← plane entity + path following
│   │   ├── Runway.ts
│   │   └── Waypoint.ts
│   ├── scenes/
│   │   ├── BootScene.ts            ← silent asset loader, emits progress
│   │   └── GameScene.ts            ← main game orchestrator
│   └── systems/
│       ├── CollisionSystem.ts      ← collision + warning detection
│       ├── DrawSystem.ts           ← entry zone overlay
│       ├── InputSystem.ts          ← drag / tap / path input
│       ├── PathProcessor.ts        ← path normalise / smooth / query
│       ├── SpawnSystem.ts          ← plane spawning
│       └── WorldTransform.ts       ← world ↔ screen coordinate conversion
├── lib/
│   └── supabase.ts                 ← supabase client (use this, not a composable)
├── screens/
│   ├── IntroScreen.vue             ← splash / ATT
│   └── ...
├── services/
│   ├── EventBus.ts                 ← gameEventBus (mitt)
│   ├── revenueCatService.ts        ← RC SDK wrapper
│   ├── adMobService.ts             ← AdMob wrapper
│   └── levelManager.ts
├── stores/
│   ├── game.ts                     ← Pinia game state + high score
│   ├── monetization.ts             ← auth, premium, canAccessLevel, saveProgress
│   └── settings.ts
├── views/
│   └── GameView.vue                ← mounts AirTrafficCanvas + GameHUD
└── supabase/
    └── functions/
        └── revenuecat-webhook/
            └── index.ts            ← Edge Function: RC → profiles.is_premium
```

---

_Last updated: session covering Supabase schema, loading flow, HUD visibility,
paid backgrounds, path-following fix, collision system, spawn margins,
SpeedControlPopup live state, monetization API corrections._
