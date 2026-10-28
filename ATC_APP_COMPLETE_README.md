# 🛫 ATC-APP — Complete System Guide

> **Full-stack reference: game client, monetization backend, and everything in between**

This document describes how every layer of ATC-APP works together — from the moment a player launches the app to the moment a purchase unlocks all levels across all their devices.

---

## 📋 Table of Contents

- [System Overview](#system-overview)
- [Architecture at a Glance](#architecture-at-a-glance)
- [Documentation Map](#documentation-map)
- [Full Stack Layout](#full-stack-layout)
- [App Boot Sequence](#app-boot-sequence)
- [Complete Purchase Flow](#complete-purchase-flow)
- [Level Gate Flow](#level-gate-flow)
- [Cross-Platform Behaviour](#cross-platform-behaviour)
- [Data Flow Diagram](#data-flow-diagram)
- [Environment Variables Reference](#environment-variables-reference)
- [Development Setup](#development-setup)
- [Deployment Checklist](#deployment-checklist)
- [Code Protection](#code-protection)

---

## 🎯 System Overview

ATC-APP is a cross-platform air traffic control game with three distinct technical layers that communicate in strictly one direction each:

```
┌─────────────────────────────────────────────────────────────────────┐
│  EXTERNAL SERVICES                                                   │
│  App Store · Google Play · RevenueCat (Web Billing: Paddle)         │
│  (Payment processing — outside our codebase)                        │
└──────────────────────────────────┬──────────────────────────────────┘
                                   │ webhook (HTTPS)
┌──────────────────────────────────▼──────────────────────────────────┐
│  BACKEND  (Supabase — PostgreSQL + Auth + Storage + Edge Functions)  │
│  profiles table · game_assets bucket · revenuecat-webhook           │
│  (Server-side truth — the only writer of is_premium)                │
└──────────────────────────────────┬──────────────────────────────────┘
                                   │ anon key (RLS-filtered)
┌──────────────────────────────────▼──────────────────────────────────┐
│  CLIENT  (Vue 3 + Phaser 3 + Pinia — shared across platforms)        │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  Vue Layer  (UI / Navigation / Overlays)                     │   │
│  │  Router · Pinia stores · Vue components · Views              │   │
│  ├──────────────────────────────────────────────────────────────┤   │
│  │  Services                                                    │   │
│  │  monetization store · revenueCatService · levelManager       │   │
│  │  supabase client · EventBus                                  │   │
│  ├──────────────────────────────────────────────────────────────┤   │
│  │  Phaser Layer  (Game Logic / Rendering)                      │   │
│  │  BootScene · GameScene · CollisionSystem · AudioSystem       │   │
│  │  SpawnSystem · InputSystem · DrawSystem · WorldTransform     │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌─────────────────┐  ┌──────────────────┐  ┌────────────────────┐  │
│  │ Electron        │  │ iOS (Capacitor)  │  │ Android (Capacitor)│  │
│  │ Desktop         │  │ App Store        │  │ Google Play        │  │
│  └─────────────────┘  └──────────────────┘  └────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 🗺️ Documentation Map

Read these documents in order based on what you're working on:

| Document                                                                                 | Covers                                                  | When to read                        |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------- |
| **This file**                                                                            | Full system — how all layers connect                    | Start here                          |
| [`HOW_TO_BUILD.md`](./HOW_TO_BUILD.md)                                                   | Every build & release command from root package.json    | Building / releasing                |
| [`GAME_ARCHITECTURE_README.md`](./GAME_ARCHITECTURE_README.md)                           | Phaser game layer — scenes, objects, systems, events    | Working on gameplay                 |
| [`BACKEND_ARCHITECTURE_README.md`](./BACKEND_ARCHITECTURE_README.md)                     | Supabase schema, RLS, webhook, storage, Electron IPC    | Working on monetization or security |
| [`SUPABASE_SETUP.md`](./SUPABASE_SETUP.md)                                               | Step-by-step Supabase + RevenueCat configuration        | First-time backend setup            |
| [`README_PROD.md`](./README_PROD.md)                                                     | CI/CD, code signing, platform release builds            | Releasing a new version             |
| [`PaywallUsage.md`](./PaywallUsage.md)                                                   | Paywall component props, events, debug panel            | Adding purchase gates to any screen |
| [`AspectRatioBackgroundSystemSetupGuide.md`](./AspectRatioBackgroundSystemSetupGuide.md) | Background images per device ratio                      | Adding level artwork                |
| [`LevelBackgrounds.md`](./packages/app/src/assets/LevelBackgrounds.md)                   | Canvas sizes, runway coord measurement, ratio variants  | Creating or updating level art      |
| [`PlaneIcons.md`](./packages/app/src/assets/PlaneIcons.md)                               | Sprite canvas rules, scaling pipeline, adding new types | Creating or updating plane sprites  |
| [`HOW_TO/HOW_TO_BACKGROUNDS.md`](./HOW_TO/HOW_TO_BACKGROUNDS.md)                         | Google Earth → game-ready background pipeline           | Creating new level backgrounds      |
| [`HOW_TO/HOW_TO_PLANES.md`](./HOW_TO/HOW_TO_PLANES.md)                                   | Plane sprite rules, shadow layer, adding new types      | Creating new plane sprites          |
| [`HOW_TO/HOW_TO_LEVELS.md`](./HOW_TO/HOW_TO_LEVELS.md)                                   | Runway / waypoint positioning, levels_config fields     | Building new levels                 |
| [`HOW_TO/HOW_TO_MUSIC.md`](./HOW_TO/HOW_TO_MUSIC.md)                                     | AudioSystem internals, custom music, internet radio     | Audio system changes                |

---

## 📁 Full Stack Layout

```
atc-app/
│
├── supabase/                               ← Backend code
│   └── functions/
│       └── revenuecat-webhook/
│           └── index.ts                   # Edge Function: RC → DB writer
│
├── packages/
│   │
│   ├── app/                               ← Shared client (Vue 3 + Phaser 3)
│   │   └── src/
│   │       │
│   │       ├── assets/
│   │       │   ├── levels_basic.json      # Free levels (up to FREE_LEVEL_LIMIT), bundled in app — never contains premium level data
│   │       │   │                            # For local testing you can set VITE_USE_LOCAL_FULL_LEVELS=true and
│   │       │   │                            # include packages/app/src/assets/levels_full_example.json so the
│   │       │   │                            # app uses a local full-levels file instead of downloading from Supabase.
│   │       │   ├── planes/                # Plane sprites: {typeId}-{color}.png + {typeId}-shadow.png
│   │       │   └── backgrounds/           # Per-ratio background images
│   │       │       ├── 16x9/
│   │       │       ├── 20x9/
│   │       │       └── 19_5x9/
│   │       │
│   │       ├── lib/
│   │       │   └── supabase.ts            # Supabase client singleton + Profile type
│   │       │
│   │       ├── services/
│   │       │   ├── revenueCatService.ts   # RC SDK: purchase, restore, entitlements
│   │       │   ├── levelManager.ts        # level data delivery: bundled levels_basic.json (free) or levels_full.json from Supabase Storage (premium, cached on device as atc-app_levels_full.json)
│   │       │   └── EventBus.ts            # Type-safe Phaser ↔ Vue event bus
│   │       │
│   │       ├── stores/
│   │       │   ├── monetization.ts        # Auth, premium state, throttle, purchase
│   │       │   ├── game.ts                # Game state (premium-aware maxLevel)
│   │       │   └── settings.ts            # Audio, graphics, zoom settings
│   │       │
│   │       ├── router/
│   │       │   └── index.ts               # Route guards: level gate enforcement
│   │       │
│   │       ├── scenes/
│   │       │   ├── BootScene.ts           # Asset preload + level boot
│   │       │   └── GameScene.ts           # Main gameplay scene
│   │       │
│   │       ├── game/
│   │       │   ├── config/                # Levels, planes, aspect ratios
│   │       │   ├── objects/               # Plane, Runway, Waypoint
│   │       │   └── systems/               # Collision, Audio, Input, Draw, Spawn
│   │       │
│   │       └── views/
│   │           ├── IntroScreen.vue
│   │           ├── Home.vue
│   │           ├── PlayFieldsScreen.vue
│   │           └── GameView.vue
│   │
│   ├── electron/                          ← Desktop wrapper
│   │   └── src/
│   │       ├── main.ts                    # IPC handlers, CSP, premium:check
│   │       └── preload.ts                 # contextBridge API exposure
│   │
│   └── mobile/                            ← Mobile wrapper
│       ├── android/
│       ├── ios/
│       └── capacitor.config.ts
│
└── Supabase Storage (cloud)
    └── game_assets/                       ← Private bucket
        └── levels_full.json               # Premium levels (all airports) — downloaded by LevelManager, cached on device as 'atc-app_levels_full.json'
```

---

## 🚀 App Boot Sequence

Every time the app launches, this sequence runs in order. Understanding it explains why premium status is always reliable even without an active network connection.

```
App.vue onMounted()
  │
  ├─ 1. settingsStore.loadSettings()
  │      Reads audio/graphics from localStorage — instant, no network
  │
  ├─ 2. gameStore.loadHighScore()
  │      Reads from localStorage — instant, no network
  │
  └─ 3. monetizationStore.init()
         │
         ├─ a. detectPlatform()
         │      Sets 'ios' | 'android' | 'electron' | 'web'
         │
         ├─ b. ensureAuth()
         │      ┌─ getSession() ── session exists? ──► reuse existing user_id
         │      └─ signInAnonymously() ──────────────► new user_id + profiles row
         │
         ├─ c. RevenueCatService.initialize(userId)   [mobile only]
         │      Configures RC SDK, logIn(userId), checks active entitlements
         │      Sets isPremium = true optimistically if RC has active entitlement
         │
         └─ d. syncFromServer()
                Fetches profiles row from Supabase
                Sets isPremium (server truth), serverLevel
                Resets throttle timer (lastCheckedAt = now)

Then: router.beforeEach() fires on first navigation
  └─ monetization.isInitialized = true → skip re-init
     Level gate check if route has requiresPremium: true

Then: BootScene.onLoadComplete()
  └─ scene.start('GameScene', { level: gameStore.currentLevel })
```

**Key guarantee:** By the time `GameScene` starts, `isPremium` reflects the server-verified value. The Phaser layer never needs to check premium status — the Vue layer has already enforced it at the router level.

---

## 💳 Complete Purchase Flow

This is the most critical flow. Every step is detailed so you can debug it end-to-end.

```
User taps "Unlock Full Game" in Paywall.vue
  │
  ├─ [Mobile: iOS / Android]
  │    │
  │    ├─ RevenueCatService.getOfferings()
  │    │    Returns available packages from App Store / Google Play
  │    │
  │    ├─ RevenueCatService.purchasePackage(pkg)
  │    │    Native payment sheet appears
  │    │    User confirms payment
  │    │    App Store / Google Play processes transaction
  │    │    RC receives receipt → validates with Apple/Google
  │    │
  │    ├─ RC fires webhook → Supabase Edge Function
  │    │    POST /functions/v1/revenuecat-webhook
  │    │    Authorization: Bearer <REVENUECAT_WEBHOOK_SECRET>
  │    │    { event.type: "INITIAL_PURCHASE", app_user_id: "<uuid>" }
  │    │         │
  │    │         ├─ signature verified ✓
  │    │         └─ supabase.from('profiles').update({ is_premium: true })
  │    │              .eq('rc_customer_id', app_user_id)
  │    │              [uses service_role — bypasses RLS]
  │    │
  │    ├─ App: isPremium = true (optimistic, from RC entitlement)
  │    │
  │    ├─ await 2000ms (webhook propagation time)
  │    │
  │    ├─ syncFromServer(forceCheck: true)
  │    │    Reads is_premium = true from DB ✓ (confirmed)
  │    │
  │    └─ LevelManager.getLevelData()
  │         Downloads levels_full.json from Supabase Storage
  │         [Storage RLS: is_premium = true → 200 OK]
  │         Cached to device filesystem
  │
  └─ [Desktop: Electron]
       │
       ├─ RevenueCat Web SDK (@revenuecat/purchases-js), App User ID = device uid
       │    In-app checkout, Paddle through RevenueCat Web Billing
       │    RevenueCat → webhook → Supabase (same path as mobile)
       │
       └─ Paywall polls for the account (get_account_for_device)
            │
            └─ syncFromServer(forceCheck: true)
                 LevelManager.getLevelData()
```

---

## 🔒 Level Gate Flow

The router guard is the client-side enforcement point. It is backed by server-verified state — not a local boolean the user can flip.

```
User navigates to /play/4
  │
  └─ router.beforeEach()
       │
       ├─ monetization.isInitialized?
       │    no → await monetization.init() [boot not complete yet]
       │    yes → continue
       │
       ├─ route.meta.requiresPremium = true
       │    levelId = 4
       │
       ├─ monetization.canAccessLevel(4)
       │    ├─ isPremium = true  ──────────────────────► allow navigation ✓
       │    └─ isPremium = false
       │         maxAccessibleLevel = 3
       │         4 > 3 → blocked
       │              │
       │              └─ next({ name: 'Intro', query: { showUpsell: 'true', lockedLevel: '4' } })
       │                   Paywall UI shown to user
       │
       └─ [if allowed] GameScene.init({ level: 4 })
            gameStore.setLevel(4)
            gameStore.maxLevel = monetization.maxAccessibleLevel = 999 (premium)
```

**Double enforcement:** The router guard blocks navigation. Inside `GameScene`, `gameStore.maxLevel` is a computed getter driven by `monetizationStore.maxAccessibleLevel`, so even if navigation somehow succeeded, `setLevel()` would reject levels above the cap.

---

## 🌍 Cross-Platform Behaviour

| Feature                  | iOS                    | Android                  | Electron                   | Web                     |
| ------------------------ | ---------------------- | ------------------------ | -------------------------- | ----------------------- |
| **Auth**                 | Anonymous (Supabase)   | Anonymous (Supabase)     | Anonymous (Supabase)       | Anonymous (Supabase)    |
| **Purchase**             | App Store (RevenueCat) | Google Play (RevenueCat) | RevenueCat Web (Paddle)    | RevenueCat Web (Paddle) |
| **Premium verification** | Supabase DB            | Supabase DB              | Supabase DB + IPC re-check | Supabase DB             |
| **Level cache**          | Capacitor Filesystem   | Capacitor Filesystem     | localStorage               | localStorage            |
| **RC SDK**               | ✅ native              | ✅ native                | ✅ purchases-js            | ✅ purchases-js         |
| **CSP enforced**         | OS sandbox             | OS sandbox               | ✅ main process            | N/A                     |
| **Webhook path**         | RC → Supabase          | RC → Supabase            | RC → Supabase              | RC → Supabase           |

### Why Electron Has an Extra Verification Step

On mobile, the app binary is sandboxed by the OS — a user cannot inspect or modify memory. On Electron, the renderer process is a Chromium tab: DevTools are accessible, `localStorage` is readable, and JS modules can be patched.

The `premium:check` IPC handler in the Electron main process re-verifies premium status directly with Supabase using the `service_role` key, which never appears in the renderer bundle. Even if a user patches `isPremium = true` in the renderer, the Electron-aware parts of the codebase can call `window.electronAPI.checkPremium(userId)` for a tamper-proof second opinion.

---

## 📊 Data Flow Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         ATC-APP DATA FLOWS                               │
│                                                                          │
│  WRITE flows (who sets is_premium)                                       │
│  ─────────────────────────────────                                       │
│  App Store / Google Play                                                 │
│       └──► RevenueCat ──► Edge Function (service_role) ──► profiles.is_premium │
│                                                                          │
│  READ flows (who reads is_premium)                                       │
│  ────────────────────────────────                                        │
│  monetizationStore ──► supabase.from('profiles').select() ──► isPremium  │
│  [throttled: max once per 60s except on purchase/restore events]         │
│                                                                          │
│  ASSET flows (who gets levels_full.json)                                 │
│  ─────────────────────────────────────                                   │
│  LevelManager ──► supabase.storage.download()                            │
│                         └── Storage RLS checks is_premium                │
│                               ├── true  → 200 file data → device cache   │
│                               └── false → 403 forbidden                  │
│                                                                          │
│  GAME STATE flows (runtime, no network)                                  │
│  ───────────────────────────────────                                     │
│  Phaser GameScene ──► gameEventBus ──► Vue components                    │
│  Vue components   ──► gameEventBus ──► Phaser GameScene                  │
│  monetizationStore.isPremium ──► gameStore.maxLevel (computed getter)    │
│                                                                          │
│  PROGRESS flows (level completion)                                       │
│  ─────────────────────────────────                                       │
│  gameStore.completeLevel() ──► monetizationStore.saveProgress()          │
│                                     └──► supabase.update({ current_level }) │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 🔑 Environment Variables Reference

### `packages/app/.env.local`

```env
# Supabase (required for all platforms)
VITE_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# RevenueCat (required for mobile builds)
VITE_RC_IOS_KEY=appl_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
VITE_RC_ANDROID_KEY=goog_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
VITE_RC_WEB_BILLING_PUBLIC_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx  # RevenueCat Web Billing (Paddle) — public key only, for Electron/web

# AdMob Ad Unit IDs — read by adMobService.ts at runtime (VITE_ prefix = bundled by Vite)
VITE_ADMOB_INTERSTITIAL_ID_ANDROID=ca-app-pub-XXXXXXXXXXXXXXXX/XXXXXXXXXX
VITE_ADMOB_INTERSTITIAL_ID_IOS=ca-app-pub-YYYYYYYYYYYYYYYY/YYYYYYYYYY

# AdMob App IDs — read by capacitor.config.ts via dotenv at `cap sync` time (NO VITE_ prefix)
# These are different from ad unit IDs — one per app, not per ad format
ADMOB_APP_ID_ANDROID=ca-app-pub-XXXXXXXXXXXXXXXX~XXXXXXXXXX
ADMOB_APP_ID_IOS=ca-app-pub-YYYYYYYYYYYYYYYY~YYYYYYYYYY
```

### `packages/electron/.env.local`

```env
# Same Supabase public credentials as app
VITE_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGci...

# Service role key — ONLY for Electron main process, NEVER in renderer
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Supabase Edge Function Secrets

Set via Supabase Dashboard → Edge Functions → Secrets (shared across all functions):

```
REVENUECAT_WEBHOOK_SECRET=wh_sk_your_chosen_secret
  SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...  (same as above)
```

### GitHub Actions Secrets

For CI/CD (`README_PROD.md` has full reference):

```
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
VITE_RC_IOS_KEY
VITE_RC_ANDROID_KEY
VITE_RC_WEB_BILLING_PUBLIC_KEY
VITE_ADMOB_INTERSTITIAL_ID_ANDROID
VITE_ADMOB_INTERSTITIAL_ID_IOS
ADMOB_APP_ID_ANDROID
ADMOB_APP_ID_IOS
```

> **Security rule:** `DB_SERVICE_ROLE_KEY` must **never** be added to GitHub Secrets that are injected into the client build. It is only used in the Electron main process (`process.env.DB_SERVICE_ROLE_KEY`). The Edge Function uses the auto-injected `SUPABASE_SERVICE_ROLE_KEY` — you never set that manually.

---

## ⚙️ Development Setup

### First-Time Setup

```bash
# 1. Clone and install
git clone https://github.com/IuriiKyrylovskyi/atc-app.git
cd atc-app
pnpm install

# 2. Configure environment
cp packages/app/.env.example packages/app/.env.local
cp packages/electron/.env.example packages/electron/.env.local
# Fill in Supabase keys (see SUPABASE_SETUP.md)

# 3. Set up Supabase backend
# Run SQL from SUPABASE_SETUP.md in Supabase SQL Editor
# Deploy Edge Function:
npx supabase functions deploy revenuecat-webhook

# 4. Start development
pnpm dev         # web + electron
pnpm dev:android # android (builds web first)
pnpm dev:ios     # ios (builds web first, macOS only)
```

### Testing Purchase Flow Locally

```bash
# Start Edge Function locally
npx supabase functions serve revenuecat-webhook --env-file .env.local

# Simulate a purchase webhook
curl -X POST http://localhost:54321/functions/v1/revenuecat-webhook \
  -H "Authorization: Bearer your_test_secret" \
  -H "Content-Type: application/json" \
  -d '{
    "event": {
      "type": "INITIAL_PURCHASE",
      "app_user_id": "your-test-supabase-user-uuid",
      "entitlement_id": "pro_access"
    }
  }'

# Verify: check Supabase Table Editor → profiles → is_premium should now be true
```

### Testing Level Gate Without a Real Purchase

In the browser console while running the dev build:

```javascript
// Temporarily bypass for UI testing (does NOT affect Supabase DB)
// Reverts on next syncFromServer() call or page reload
const store = window.__pinia__.state.value.monetization;
store.isPremium = true;
```

---

## 🔐 Code Protection

> **Honest baseline:** JavaScript source cannot be made truly theft-proof — it runs
> in a runtime that can always be inspected. The goal is to raise the cost from
> "copy-paste in 5 minutes" to "days of skilled reverse engineering", which deters
> the vast majority of opportunistic copycats.
>
> Your most valuable assets — `service_role` keys, `levels_full.json`, premium gate
> logic — are already server-side and therefore genuinely unreachable. The measures
> below protect the client bundle itself.

---

### What is actually protected (by design)

| Asset                               | Where it lives                      | Protection                                                           |
| ----------------------------------- | ----------------------------------- | -------------------------------------------------------------------- |
| `levels_full.json` (premium levels) | Supabase Storage (private bucket)   | RLS policy — physically absent from device until purchased           |
| `SUPABASE_SERVICE_ROLE_KEY`         | Electron main process only          | Never in renderer bundle; verified by `strings` check in CI          |
| Premium gate logic                  | Server: `profiles.is_premium` + RLS | Cannot be bypassed client-side — server refuses the file             |
| In-app purchase receipts            | Apple / Google / RevenueCat         | Validated server-side; RC webhook is the only writer of `is_premium` |

### What can be obfuscated (client bundle)

#### 1. Disable source maps in production (highest priority)

Source maps hand attackers your original TypeScript with variable names intact.

```ts
// vite.config.ts
export default defineConfig({
  build: {
    sourcemap: false, // never ship source maps to production
    minify: 'terser',
    terserOptions: {
      compress: { passes: 3 },
      mangle: { toplevel: true }, // renames top-level symbols
      format: { comments: false },
    },
  },
});
```

#### 2. JavaScript obfuscation (raises reverse-engineering cost significantly)

```bash
pnpm add -D javascript-obfuscator vite-plugin-javascript-obfuscator
```

```ts
// vite.config.ts
import JavaScriptObfuscator from 'vite-plugin-javascript-obfuscator';

export default defineConfig({
  plugins: [
    // Only in production — obfuscation breaks HMR in dev
    ...(process.env.NODE_ENV === 'production'
      ? [
          JavaScriptObfuscator({
            options: {
              compact: true,
              controlFlowFlattening: true,
              controlFlowFlatteningThreshold: 0.5, // 0.75+ breaks performance
              deadCodeInjection: true,
              deadCodeInjectionThreshold: 0.2,
              stringArray: true,
              stringArrayEncoding: ['base64'],
              stringArrayThreshold: 0.75,
              rotateStringArray: true,
              shuffleStringArray: true,
              splitStrings: true,
              splitStringsChunkLength: 10,
              transformObjectKeys: true,
              unicodeEscapeSequence: false, // true doubles bundle size
            },
          }),
        ]
      : []),
  ],
});
```

> ⚠️ Always test the obfuscated build end-to-end before releasing. Obfuscation can
> break dynamic imports, Pinia store names, and Phaser scene keys if `keepIdentifiers`
> is not configured correctly. Start with conservative settings.

#### 3. Electron: compile to V8 bytecode (strongest desktop protection)

The Electron renderer is a Chromium tab — DevTools are accessible by default.
Compiling to V8 bytecode prevents reading the source even with DevTools open.

```bash
pnpm add -D bytenode
```

```ts
// electron/build-scripts/compile.ts
import bytenode from 'bytenode';
import fs from 'fs';

// Compile main process entry point to .jsc (V8 bytecode)
await bytenode.compileFile({
  filename: 'dist/main.js',
  output: 'dist/main.jsc',
});
fs.unlinkSync('dist/main.js'); // remove original source
```

Then update `electron-builder.yml` to package `.jsc` instead of `.js`.

> Note: V8 bytecode is architecture-specific. You need separate `.jsc` files for
> macOS (arm64 + x64), Windows (x64), and Linux (x64). Build on each platform
> or use cross-compilation with `--target`.

#### 4. Electron: disable DevTools in production

```ts
// electron/main.ts
if (app.isPackaged) {
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' || (input.control && input.shift && input.key === 'I')) {
      event.preventDefault();
    }
  });
  // Do NOT call mainWindow.webContents.openDevTools()
}
```

#### 5. Mobile: already protected by the OS

iOS and Android apps are compiled and sandboxed by the OS before reaching
users. The App Store and Google Play add their own DRM encryption layer on
top. Reverse engineering is possible but requires jailbreaking/rooting the
device, which is a significant barrier.

Enable ProGuard/R8 for Android (obfuscates class names in the Java/Kotlin
wrapper that Capacitor generates):

```json
// android/app/build.gradle
buildTypes {
  release {
    minifyEnabled true
    shrinkResources true
    proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
  }
}
```

### Realistic threat model

| Attacker                | Capability                    | Mitigation                                                   |
| ----------------------- | ----------------------------- | ------------------------------------------------------------ |
| Casual user             | Copy JS from browser DevTools | Minification + obfuscation stops this                        |
| Script kiddie           | Unpack `.asar`, read source   | V8 bytecode + DevTools disabled stops this                   |
| Skilled developer       | Decompile + reverse engineer  | Obfuscation raises cost; server-side gate is the real lock   |
| Determined professional | Full reverse engineering      | Unavoidable for client code — server-side assets remain safe |

**Bottom line:** No client-side measure stops a determined professional. Your
actual competitive moat is the game design, artwork, and level data — the last
of which (`levels_full.json`) is already physically server-side.

---

## ✅ Deployment Checklist

### Backend (do once before first release)

- [x] Supabase project created
- [x] Schema SQL executed (profiles table + trigger + RLS policies)
- [x] Storage bucket `game_assets` created with RLS policy
- [x] `levels_full.json` uploaded to `game_assets` bucket
- [x] `levels_basic.json` in `packages/app/src/assets/` (Levels 1–3 only)
- [x] Edge Function `revenuecat-webhook` deployed with `--no-verify-jwt` flag
- [x] `@capacitor/core` and `@capacitor/filesystem` added to `@atc-app/app`
- [x] Vite stub alias added for `@revenuecat/purchases-capacitor` in `vite.config.ts`
- [x] `monetization.ts` uses `.maybeSingle()` not `.single()` for profile query
- [x] `RC_ENTITLEMENT_ID` not duplicated in `monetization.ts` (import only, no redeclaration)
- [x] Edge Function secrets set (`REVENUECAT_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`)

### RevenueCat (do once before first release)

- [x] RC project created
- [x] Entitlement `pro_access` created
- [x] Offering `default` created (ATC-APP Premium)
- [x] iOS App created in RC
- [x] Android App created in RC — Google Cloud service account JSON, Pub/Sub enabled, all 3 API permissions validated
- [x] `pro_access_unlock` linked to `pro_access` entitlement (iOS)
- [x] `lifetime` linked to `pro_access` entitlement (Android)
- [x] RC Offering `default` configured with `$rc_lifetime` package (iOS + Android products attached)
- [x] Webhook URL configured in RC dashboard
- [x] Webhook authorization header set to `Bearer <REVENUECAT_WEBHOOK_SECRET>`
- [x] Webhook verified — Supabase Edge Function logs confirm `200 OK` on test event

### Client (check each release)

- [x] `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in environment
- [x] `VITE_RC_IOS_KEY` set in `packages/app/.env.local`
- [x] `VITE_RC_ANDROID_KEY` set in `packages/app/.env.local`
- [ ] `VITE_RC_WEB_BILLING_PUBLIC_KEY` set for Electron/web builds
  - [ ] Paddle account created (supports Ukraine without a local entity; Stripe does not)
  - [ ] RC dashboard: connect Paddle under Web → Billing, create `lifetime` product + `pro_access` entitlement
  - [ ] Paddle: create matching product/price, complete sandbox + domain approval
  - [ ] Public API key copied into `VITE_RC_WEB_BILLING_PUBLIC_KEY` in `.env.local`
  - [x] `revenuecat-webhook` Supabase Edge Function written — handles native RC events AND web/Paddle purchases via `subscriber.attributes`
  - [x] `revenuecat-webhook` deployed: `supabase functions deploy revenuecat-webhook`
  - [ ] `REVENUECAT_WEBHOOK_SECRET` added to Supabase secrets: `supabase secrets set REVENUECAT_WEBHOOK_SECRET=sk_...`
  - [ ] End-to-end tested: Electron → Paddle inline checkout → test card → Restore Purchases → unlocked
- [x] `DB_SERVICE_ROLE_KEY` set in Electron env (not client bundle)
- [x] `levels_basic.json` contains only free levels
- [x] All plane icons exported at 690 px longest axis, ≥98% fill, transparent background (see `PlaneIcons.md`)
- [x] Router guard `requiresPremium: true` on `/play/:levelId` route
- [x] `FREE_LEVEL_LIMIT` constant matches your intended free level count

### Security Audit (check each release)

- [x] `DB_SERVICE_ROLE_KEY` not prefixed with `VITE_` in `packages/electron/.env.local`
- [x] Neither `DB_SERVICE_ROLE_KEY` nor `SUPABASE_SERVICE_ROLE_KEY` appear in `packages/app/src/` files
- [x] Renderer bundle clean — no `service_role` in dist ✅
- [x] `levels_full.json` not in `packages/app/src/assets/` (should be in Supabase Storage only)
- [x] RLS policies active on `profiles` table (check Supabase Dashboard → Auth → Policies)
- [x] Storage RLS active on `game_assets` bucket

### Code Protection (check each release)

- [x] `sourcemap: false` set in `vite.config.ts`
- [x] `minify: 'terser'` with `mangle.toplevel: true` enabled in `vite.config.ts`
- [x] JavaScript obfuscation — tested `vite-plugin-javascript-obfuscator` but it breaks Vue/Phaser dynamic imports; using Terser `toplevel: true` instead (symbol renaming + comment stripping, safe and verified)
- [x] Build tested end-to-end — Terser minification verified working
- [x] Electron: DevTools keyboard shortcuts disabled in packaged build (F12, Ctrl+Shift+I, Cmd+Option+I) — dev mode unaffected
- [x] Electron: `openDevTools()` only called in dev mode (`devServerURL` guard)
- [x] Electron (optional, strongest): `bytenode` compiles `main.js` → `main.jsc` V8 bytecode — source unreadable even with DevTools
- [x] Android: ProGuard/R8 enabled in release `build.gradle` (`minifyEnabled true`) — `proguard-rules.pro` covers Capacitor, RevenueCat, AdMob, Supabase, OkHttp, Kotlin
- [x] No `.map` files in production dist ✅

### Performance

- [x] Level 2 plane movement delay investigated — root cause: browser JIT warm-up during first 2-3 seconds, not a game bug. FPS ramps 50→61 on load then holds steady. No code fix required.
- [x] `Runway.drawChevrons()` throttled to ~10 redraws/s (was 60/s) — `_lastBlinkStep` guard in `Runway.ts`
- [x] `worldContainer.sort('depth')` converted to dirty-flag pattern — only sorts when a plane changes altitude. `_depthDirty` flag in `GameScene.ts`, set by `Plane.updateDepth()`

### AdMob Integration

- [x] `@capacitor-community/admob` installed in `@atc-app/mobile`
- [x] `src/stubs/admob.stub.ts` created for web/Electron builds
- [x] `@capacitor-community/admob` stub alias added to `vite.config.ts`
- [x] `adMobService.ts` created — interstitial only, free users only, dynamic import
- [x] `AdMobService.initialize()` called in `monetization.ts` boot sequence
- [x] `preloadAd()` and `showAdIfReady()` exposed from monetization store
- [x] AdMob account created, payment method added
- [x] AdMob payment method added
- [x] Android app created in AdMob — `ca-app-pub-1654957331834000~1722341127`
- [ ] Link AdMob Android app to Google Play — do after Google Play app is approved (Play Console → Dashboard → Production track shows Active), then re-request AdMob review
- [x] iOS app created in AdMob — App ID set in `ADMOB_APP_ID_IOS`
- [ ] Link AdMob iOS app to App Store — do after Apple approves the app
- [x] Android Interstitial ad unit created (`ATC-APP Interstitial Android`) → `VITE_ADMOB_INTERSTITIAL_ID_ANDROID` set
- [x] iOS Interstitial ad unit created (`ATC-APP Interstitial iOS`) → `VITE_ADMOB_INTERSTITIAL_ID_IOS` set
- [x] All 4 AdMob keys added to `packages/app/.env.local` (`VITE_ADMOB_INTERSTITIAL_ID_ANDROID/IOS` + `ADMOB_APP_ID_ANDROID/IOS`)
- [x] `capacitor.config.ts` reads `ADMOB_APP_ID_ANDROID/IOS` via dotenv at `cap sync` time
- [x] `dotenv` installed in `@atc-app/mobile`
- [x] `cap sync` run after setting env vars — App IDs baked into native projects
- [x] Rebuilt with real AdMob IDs — iOS v1.0(2) resubmitted (AdMob crash fix), Android v0.0.35 on internal track
- [x] `cap sync ios` complete
- [x] `preloadAd()` called from `GameScene.create()` when level starts
- [x] `showAdIfReady()` called from `GameScene.triggerLevelComplete()` when level ends
- [x] `adMobService.ts` uses platform-specific env vars (`VITE_ADMOB_INTERSTITIAL_ID_ANDROID` / `_IOS`)
- [x] DEV mode auto-uses Google test IDs — no real AdMob account needed for dev testing
- [x] Android v0.0.35 installed and played on real device ✅
- [x] Screen orientation — `@capacitor/screen-orientation` installed; locks landscape in `AirTrafficCanvas.vue`, unlocks on exit; global `sensorLandscape` removed from `AndroidManifest.xml`
- [x] iOS portrait orientation — `UIInterfaceOrientationPortrait` present in `Info.plist` `UISupportedInterfaceOrientations`; confirmed in Xcode Deployment Info
- [ ] Ads not yet showing — AdMob under review (2-3 days)
- [ ] Test purchase flow on Android (Play Console → Setup → License testing → add your email)

### Legal & Privacy (BLOCKING — required before submission to either store)

- [x] Privacy policy written (`privacy.html` — covers all required disclosures)
- [x] `delete-account` Edge Function created (`supabase/functions/delete-account/index.ts`)
- [x] `AccountSettingsScreen.vue` updated — Privacy Policy link, Restore Purchases, Delete Account
- [x] Profile section shows real data (premium status, platform, anonymous ID)
- [x] Privacy policy deployed to GitHub Pages
- [x] `PRIVACY_POLICY_URL` updated in `AccountSettingsScreen.vue`
- [x] Privacy policy URL added to App Store Connect — https://iuriikyrylovskyi.github.io/atc-app-privacy/
- [x] Privacy policy URL set in Google Play Console — https://iuriikyrylovskyi.github.io/atc-app-privacy/
- [x] `delete-account` Edge Function deployed: `supabase functions deploy delete-account`
- [ ] Restore Purchases button tested on device
- [x] Account deletion tested end-to-end
- [x] Post-deletion redirect to IntroScreen (no new user created until Start Game)
- [x] Router guard skips init on Intro route
- [x] Quit button added to IntroScreen (cross-platform: Capacitor + Electron)
- [x] `IntroScreen` lazy init — anonymous user created only on Start Game click

### Level Complete & Audio

- [x] `planesTarget` field added to `LevelConfig` — number of planes to handle to complete level
- [x] `planesTarget` present in both `levels_config.ts` and `levels_basic.json` for all levels
- [x] `checkLevelComplete()` + `triggerLevelComplete()` added to `GameScene.ts`
- [x] Spawn guard stops new planes once `planesTarget` reached
- [x] `oppositeRwNumber` field name corrected in `RunwayConfig` type, `levels_config.ts`, and `levels_basic.json` (was `opositeRwNumber`)
- [x] `positionOverrides` present on all runways in levels 1–3 in both config files
- [x] Level 1 `maxPlanes` corrected to 3 (was 27 — tutorial was spawning a full swarm)
- [x] Level 2 `allowedPlaneTypes` corrected to `[1, 3]` — A320 introduction (was `[1, 2, 6]`: A380 too large for level 2, type 6 mocked data)
- [x] Level 3 `allowedPlaneTypes` corrected to `[1, 3, 2]` — A380 introduced at level 3 (was `[1, 2, 3, 6]`)
- [x] Runway dimensions updated to match real aircraft sprite sizes (see `PlaneIcons.md`)
- [x] `defineSizeMultiplier(wingspan_m)` used for all aircraft — formula = `1.3 × (wingspan_m / 80)`, A380 wingspan is the anchor
- [x] Music stops on level complete (`scene.pause` event → `AudioSystem.pauseMusic`)
- [x] Music stops on game pause (`scene.pause` event → `AudioSystem.pauseMusic`)
- [x] Music resumes on game resume (`scene.resume` event → `AudioSystem.resumeMusic`)
- [x] Music starts at correct volume immediately on level load (no fade-in ramp)
- [x] `levelCompleteData` ref in `useGame.ts` — drives level complete modal
- [x] `handleNextLevel` in `GameView.vue` uses `:key` remount — no stale Phaser scene
- [x] `shutdown()` resets `isLevelComplete`, `landedCount`, `waypointPassCount`

### App Store Assets (required before submission)

- [x] App icon 1024×1024 PNG generated at `packages/mobile/assets/icon.png`
- [x] App icon 512×512 PNG — auto-generated by `pnpm --filter @atc-app/mobile run assets:generate`
- [x] All icon sizes generated via `pnpm --filter @atc-app/mobile run assets:generate` — 135 Android + 11 iOS + 14 PWA files
      Source: `packages/mobile/assets/icon.png` (1024×1024 PNG, no transparency)
      Splash: `packages/mobile/assets/splash.png` (2732×2732 PNG) — optional, uses icon if absent
- [x] iPhone 6.9" screenshots uploaded (2868×1320 px landscape)
- [x] iPad 13" screenshot uploaded (2732×2048 px, resized from iPhone screenshot)
- [x] Android screenshots uploaded to Google Play store listing
- [x] Google Play feature graphic uploaded (1024×500)
- [x] App description written — ATCO veteran angle, plain text, ~1850 chars
- [x] Promotional text set (144 chars)
- [x] Keywords set (86 chars)
- [x] Short description set for Google Play

### Apple App Store Submission

- [x] Apple Developer account active and paid
- [x] App created in App Store Connect
- [x] Bundle ID registered
- [x] Non-consumable IAP `pro_access_unlock` created, review screenshot uploaded, status: Ready to Submit
- [x] Sandbox tester account created
- [x] App Privacy Nutrition Label filled in and published — User ID, Device ID, Purchases, Product Interaction
- [x] ATT pre-prompt added to `IntroScreen.vue` (iOS only, fires on "Start Game" tap)
- [x] `AdMobService.requestTrackingTransparency()` fixed — now calls `AdMob.requestTrackingAuthorization()` directly instead of re-calling `initialize()` (double-initialize was unreliable, ATT prompt not showing on reviewer's device)
- [x] `AdMobService.initialize()` updated — `requestTrackingAuthorization: false` on boot, deferred to user action
- [x] `monetization.ts` exposes `requestTrackingTransparency()` action
- [x] `NSUserTrackingUsageDescription` added to `Info.plist`
- [ ] ATT prompt tested on real iOS device — test via TestFlight
- [x] iPhone (Antonina's) registered in Apple Developer account
- [x] TestFlight build uploaded (v0.0.30) — waiting for Apple processing (~15-30 min)
- [x] Internal testers added in TestFlight
- [ ] Install ATC-APP via TestFlight
- [ ] Test full purchase flow with sandbox tester account
- [ ] No crashes on real iPhone

### Apple Review — Rejection History

- [x] **v1.0.0 rejected** — March 31, 2026 (iPad Air M3, iPadOS 26.3.1). Three issues:

  **3.1.1 — "Licence codes"** (FIXED)

  - Root cause: `detectPlatform()` used `window.Capacitor` which can be undefined during early boot → returned `'web'` on real device → Stripe branch ran → showed "Complete your purchase in the browser" message → Apple flagged as external payment bypass
  - Fix: `detectPlatform()` now uses `Capacitor.isNativePlatform()` (always reliable). Added double safety guard in `purchase()` to never enter Stripe path on native platform regardless of `detectPlatform()` result.

  **2.1(b) — Sandbox purchase sheet didn't appear** (FIXED)

  - Root cause: `RevenueCatService.purchasePackage()` was calling `Purchases.purchaseStoreProduct()` which bypasses RC's offering attribution and silently fails to open StoreKit sheet
  - Fix: Changed to `Purchases.purchasePackage({ aPackage: pkg })` — the correct RC Capacitor SDK API

  **2.1 — ATT prompt not appearing** (FIXED)

  - Root cause: `requestTrackingTransparency()` called `AdMob.initialize({ requestTrackingAuthorization: true })` a second time — SDK ignores duplicate initialize calls
  - Fix: Now calls `AdMob.requestTrackingAuthorization()` directly
  - Action required: Record ATT screen recording on real iPhone (Settings → Privacy → Tracking → reset ATC-APP → fresh install → tap Start Game → record prompt appearing) and attach to App Review Information → Notes before resubmitting

- [ ] **Confirm Paid Apps Agreement is signed** — App Store Connect → Agreements, Tax, and Banking → must be Active before sandbox purchases work
- [ ] **Confirm RevenueCat `default` offering** has `$rc_lifetime` package with `pro_access_unlock` attached for iOS
- [ ] Record ATT screen recording → attach to App Store Connect submission notes
- [ ] Rebuild iOS IPA → archive in Xcode → resubmit

- [x] Build uploaded via Xcode (v0.0.30, Archive → Distribute → App Store Connect)
- [x] Age rating set — 4+ (Advertising: Yes, all other content: None)
- [x] Export compliance — No encryption beyond standard HTTPS
- [x] Content rights — No third-party content
- [x] Pricing set — Free
- [x] Availability — All countries and regions
- [x] `pro_access_unlock` IAP added to version submission
- [x] **App submitted for review** — v1.0.0, submitted March 2026

### Google Play Submission

- [x] Google Play Developer account active ($25 one-time)
- [x] Google Payments merchant account set up and payment method added
- [x] ATC-APP app created in Play Console
- [x] AAB built via `pnpm android:bundle` (v0.0.31, signed, jar verified)
- [x] `capacitor.config.ts` `releaseType` corrected from `APK` to `AAB`
- [ ] Target API level = 36 (Android 16) — check `targetSdkVersion` in `variables.gradle`
- [x] `android.permission.BILLING` declared in `AndroidManifest.xml`
- [x] `com.google.android.gms.permission.AD_ID` declared in `AndroidManifest.xml` (AdMob personalised ads, Android 13+)
- [x] In-app product `lifetime` created, Durable, Digital content, Active
- [x] Internal testing track — v0.0.30 released (Mar 14), 20,061 supported devices, testers added
- [x] Google Cloud project created, Pub/Sub API enabled, Google Play Android Developer API enabled
- [x] Service account `revenuecat` created with Admin permissions, JSON uploaded to RC
- [x] Play Console: service account granted Admin (all permissions)
- [x] Data Safety section completed in Google Play Console
- [x] IARC content rating questionnaire completed — Rated 3+ / Everyone
- [x] Feature graphic uploaded (1024×500)
- [x] Closed testing release submitted for Google review — pending approval

---

## 🗺️ Roadmap

Planned features and improvements. Items are grouped by area. Check off as completed.

---

### 💳 Monetization

- [ ] **Electron purchases via RevenueCat Web Billing** — In-app checkout with `@revenuecat/purchases-js` is in the code (the Stripe redirect is removed). Pending: Paddle activation, `VITE_RC_WEB_BILLING_PUBLIC_KEY` in `.env.local`, and the end-to-end test (`docs/plans/FIX_PREMIUM.md` Phase 3). Same Supabase webhook path. See RC docs: https://www.revenuecat.com/docs/web/web-billing
- [ ] **Custom Paywall matching RevenueCat components paywall** — Recreate the RC dashboard-designed paywall (`pw9d03e432713448e7`) as a native Vue component so the same layout renders on all platforms without depending on `RevenueCatUI.presentPaywall()`. Match the `components_config` layout: header image → title → feature list → package card → CTA → footer (terms / privacy / restore). Read localizations from `components_localizations.en_US`. Support dark/light themes via CSS variables. Eliminate dependency on `@revenuecat/purchases-capacitor-ui`.
- [ ] **PRO chevron on main menu** — Show a gold ✦ PRO badge next to the ATC-APP logo on `Home.vue` when `monetization.isPremium` is true. Replace the "Purchase Full Game" button with a subtle "Full Version" indicator for premium users.
- [ ] **Disable ads when full game purchased** — `AdMobService.showIfReady(isPremium)` already accepts the premium flag and short-circuits. Wire the interstitial trigger in `GameView.vue` to call this correctly so premium users never see ads.
- [ ] **Downloadable levels for premium users** — On purchase, `LevelManager.getLevelData()` already downloads `levels_full.json`. Extend to: download associated background images not bundled in the app (levels 4–20); store on device via `@capacitor/filesystem`; verify cached files on every launch (compare ETag or a `version` field in the JSON header).
- [ ] **Update check on startup** — On every app launch compare locally cached `levels_full.json` against Supabase Storage object metadata (ETag or a `version` field). If stale, re-download silently in background and update cache. For free users: compare bundled `levels_basic.json` version against a lightweight `/api/version` endpoint.

---

### 📺 Advertising

- [ ] **Interstitial ads between levels** — Show an AdMob interstitial when a level ends (complete, failed, or retry) and before the next level loads. Skip for premium users. Implementation: emit `level:ended` from `GameScene` → `GameView.vue` intercepts → calls `monetization.showAdIfReady()` → awaits completion → shows result modal → next level loads. Flow: `level ends → isPremium? skip : showAd(~30s) → result screen → next level`.

---

### 📱 Screen Orientation

- [ ] **Lock game scene to landscape; allow portrait on all other screens** — Use `@capacitor/screen-orientation` (already installed) to lock `landscape` only while `GameView.vue` is mounted. Lock in `onMounted`, release in `onBeforeUnmount`. Do NOT use a global lock in `capacitor.config.ts` — that would break portrait menus and paywall. All non-game screens follow the device sensor freely.
- [ ] **Prevent auto-rotation while game is in progress** — Add a secondary guard in `GameScene.ts`: listen to `window.orientationchange` while `isGameRunning` is true and immediately re-assert `ScreenOrientation.lock({ orientation: 'landscape' })`. Removes the listener in `shutdown()`. Makes the lock self-healing against OEM overrides (Samsung, Xiaomi).
- [ ] **"Rotating…" transition screen on orientation change** — Show a full-screen dark overlay (`z-index: 9999`, background `#0b0c20`) on `orientationchange` event (fires before reflow). Lift it after `resize` event + 120 ms buffer (fires after reflow completes). Prevents flash of unstyled content, canvas misalignment, and blank-screen glitch during rotation. Mount `<RotatingOverlay>` in `App.vue`, wire `orientationchange` → show, `resize` → hide after delay.

---

### 🎵 Audio

- [ ] **Game audio plays during gameplay only — stop/pause on leave or pause** — `AudioSystem` already handles `scene.pause/resume` and `level:complete`. Missing pieces: (1) `level:failed` → `stopMusic()` — emit from `CollisionSystem`, handle same as `level:complete`; (2) `GameView.vue` `onBeforeUnmount` → emit `audio:stop` event so back-button/router navigation stops music; (3) `App.vue` `appStateChange` listener → emit `audio:pause` on background, `audio:resume` on foreground (no-op if game not active, since `AudioSystem` tracks its own `isPlaying` flag).
- [ ] **Custom music: device library or internet radio** — Allow players to replace the in-level music theme with their own audio. Device audio: use `@capacitor/media` (or native MusicKit / MediaStore API) to browse and stream a local track in a loop. Internet radio: accept an Icecast/HLS streaming URL, validate before accepting, play via HTML `<audio>` element managed by `AudioSystem`. Sound effects (collision beep, landing chime) continue over custom audio. Settings persisted in `settingsStore`. See `HOW_TO/HOW_TO_MUSIC.md`.

---

### 🎮 Gameplay

- [ ] **Plane speed control popup on short tap** — On short tap of a plane (not a drag), show a small floating popup: speed indicator (current/max), `−` decrease and `+` increase buttons. Auto-dismiss on any touch outside popup or after 3s of inactivity. Implementation: distinguish tap vs drag in `InputSystem.ts` (tap = pointer up within ~10px of pointer down within ~200ms). Emit `plane:tapped` with plane id and screen coordinates. `GameView.vue` renders `<PlaneSpeedPopup>` Vue overlay at those coordinates.
- [ ] **Fix plane path drawing — prevent constant turn loop** — When a player draws a path that doubles back sharply the plane enters a constant-turn loop chasing a waypoint it has already passed. Fix in `PathProcessor.ts`: detect and remove hairpin turns (angle change > 150° within < 80px); if plane overshoots a path node, advance to next node rather than circling back. Add maximum angular velocity cap per frame in `Plane.ts` update loop.

---

### 🗺️ Level Design

- [ ] **Real airfield backgrounds via Google Earth (levels 4–20)** — Capture 10–20 real-world airfields as level backgrounds. Each background needs three ratio exports (16×9, 20×9, 19.5×9) at 1920×1080px source. See `LevelBackgrounds.md` and `HOW_TO/HOW_TO_BACKGROUNDS.md` for the full pipeline. Candidate airfields: EGLL London Heathrow (parallel runways), KJFK New York JFK (crossed runways, water), YSSY Sydney (harbour backdrop), VHHH Hong Kong (single runway reclaimed land), FAJS Johannesburg (high altitude inland), UUEE Moscow Sheremetyevo (parallel + diagonal), ZBAA Beijing Capital (triple parallel), RJTT Tokyo Haneda (bay island tight traffic), SBGR São Paulo Guarulhos (mountain backdrop), OMDB Dubai (desert aesthetic parallel runways).

---

### 📚 UX & Guides

- [ ] **In-game rules guide** — Show a swipeable tutorial overlay on first launch of each new level. Content: how to draw a flight path (drag from plane); how altitude separation works (−1 / 0 / +1 levels); what the orange TA ring and red RA ring mean; how to land (drag to runway); how to use waypoints (drag to edge waypoint); level objective (planes to handle to complete). Implement as `<GameGuide>` Vue component reading from a `guides/` JSON file per level id. Shown once per level, dismissed with "Got it", toggled from settings.
- [ ] **HOW TO series — developer guide files**
  - [ ] `HOW_TO/HOW_TO_BACKGROUNDS.md` — Google Earth → image editor → ratio exports → `levels_config.ts` integration
  - [ ] `HOW_TO/HOW_TO_PLANES.md` — Sprite canvas rules, nose direction, shadow layer, adding to `defaults_config.ts`
  - [ ] `HOW_TO/HOW_TO_LEVELS.md` — Runway coord measurement, waypoint edge positioning, `levels_config.ts` fields, `levels_basic.json` sync
  - [ ] `HOW_TO/HOW_TO_MUSIC.md` — AudioSystem internals, adding custom music support, internet radio stream integration
  - [ ] `HOW_TO/HOW_TO_PAYWALL.md` — Paywall component props, events, debug panel usage, platform purchase paths

---

### 🎬 Marketing

- [ ] **Promo video** — Short (~30s) gameplay capture + voiceover for App Store and Google Play listing. Prompt and script ready — see `marketing/PROMO_VIDEO_PROMPT.md`. Production: record gameplay on real device (landscape, highest graphics), generate voiceover (ElevenLabs or similar), edit in DaVinci Resolve / Premiere with ATC radio static overlay and title card. Export specs: App Store requires H.264 ≤ 500MB, up to 30s, 1920×1080 or 2868×1320.
