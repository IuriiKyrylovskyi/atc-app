# ATC Game — Airport, Shift, and Background Architecture

## TODO Tracking

| #   | Task                               | Status    |
| --- | ---------------------------------- | --------- |
| 1   | Map airport architecture           | Done      |
| 2   | Map runtime airport wiring         | Done      |
| 3   | Build airport background generator | Cancelled |
| 4   | Map level runtime dependencies     | Done      |
| 5   | Integrate airport runtime          | Cancelled |

---

## 1. Source of truth

`AIRPORTS_OBJECTS.json` is the authoritative roster and order. Its `number` value is the airport `order`; array order is also significant. The roster contains 20 playable airports:

- Orders 1–3 are free.
- Orders 4–20 are paid.
- Paired airports are represented by a composite key such as `ksdm/mmtj` or `omdb/omsj`.
- The legacy `eglc-alt` entry is removed.
- Training is separate and always uses the EGLC tutorial background.

`packages/app/src/game/config/airports.config.ts` is the typed runtime representation of that roster. It must preserve the JSON order, add the required `funny` and `brief` fields, and expose lookup helpers. Geometry and gameplay values remain authored in TypeScript until real airport geometry is available; do not invent runway coordinates from the JSON runway labels.

**Note on free/paid split (corrected):** The plan table in `.kilo/plans/1789840638554-airport-shift-architecture-plan.md` lists KJFK as "Free", but Phase 4 specifies `FREE_AIRPORT_IDS = ['eglc', 'wadd', 'ksdm/mmtj']` (3 free). The handover context confirms KJFK should be **paid**. This gives exactly **3 free** and **17 paid**, totaling 20.

## 2. Composed level model

A playable level is composed at runtime:

```text
Airport content × Shift rules × Platform budget → LevelConfig
```

- Airport: identity, tier, store metadata, fleet, background key, and geometry.
- Shift: plane limits, pacing, traffic target, traffic mode, and speed.
- Platform: mobile/tablet/desktop concurrency and pacing budgets.

`packages/app/src/game/config/level.structure.ts` owns the shift and platform types and composition helpers. `packages/app/src/game/config/levels.config.ts` remains the compatibility export used by the existing Phaser engine and should build a flat list from canonical airport/shift data while retaining numeric lookup and save migration helpers.

Composite level IDs use `airportId:shiftId` (for example `eglc:red-eye`). Airport/shift selection should use these IDs. Numeric IDs remain accepted at compatibility boundaries and are mapped to the corresponding composed level.

## 3. Menu and entitlement

The airport menu follows the JSON order and splits on tier:

```text
Free: EGLC, WADD, KSDM/MMTJ
Paid: YSSY, KJFK, OMDB/OMSJ, RJTT, VHHH, LEMD, KSFO, SBJL, CYYZ, RKSI, LIPZ, KSAN, LIRF, KLAX, LPPT, LFPG, EGLL
```

Airport access is entitlement-based. Free airports are available at boot; paid airports require their individual SKU or Tower Pass. Shift access is linear within an airport. Difficulty is never paywalled.

`packages/app/src/game/config/liveops.config.ts` owns the paid roster, individual SKUs, Tower Pass, previews, and live-event metadata. It must not duplicate airport geometry or identity.

## 4. Training

`packages/app/src/game/config/training.config.ts` owns scripted scenarios, objectives, hints, and retry behavior. It is independent of random level generation. Training uses the EGLC tutorial background and geometry only, so it remains in the boot bundle.

## 5. Background assets

Source images live under `raw_assets/bg`. The processing pipeline creates ratio-specific crops and a manifest under `scripts/output` for use by the app.

A background key is derived from the airport's ICAO value(s):

- Single airport: `eglc`, `wadd`, `yssy`, etc.
- Paired airport: `ksdm/mmtj` and `omdb/omsj`.

The source filename must contain the corresponding key, using a slash in the key and the repository's filename separator convention (for example `ksdm:mmtj-20-clean.png`). `AIRPORTS_OBJECTS.json` remains authoritative for the ICAO values; the pipeline validates that a matching source exists rather than guessing a new airport.

`packages/app/src/game/utils/backgroundVariantResolver.ts` resolves the requested ratio and variant. `packages/app/src/services/backgroundAssetService.ts` and `packages/app/src/game/utils/assetLoader.ts` load the manifest-backed asset without falling back to unrelated level art.

## 6. Runtime compatibility

The existing engine still consumes `LevelConfig`, runway objects, waypoint objects, and numeric helpers. The migration layer therefore:

1. Preserves `level1`–`level6` and `training1`–`training6` save keys.
2. Maps legacy numeric levels to canonical airport/shift IDs.
3. Exposes `getLevelById`, `getLevelByNumber`, `getNextLevel`, and background lookup helpers.
4. Loads airport-keyed backgrounds for composed levels.
5. Keeps training on its separate scene/configuration path.

The runtime selection and menu call sites should move to composite IDs where practical, while numeric routes remain compatibility shims.

## 7. Validation

Before release, validate:

- JSON roster order and `number === order`.
- Exactly three free airports and 17 paid airports.
- No `eglc-alt` in the runtime roster.
- Every runtime airport has a matching background source and manifest entry.
- Every composed level has at least one runway and one waypoint for its active shift.
- Legacy save mappings resolve.
- TypeScript, ESLint, and the app build pass.

## 8. Remaining data work

The roster metadata is complete except for the explicitly marked Galeão (`SBJL`) fields. Real runway/waypoint master coordinates, airport-specific fleet tuning, and shift balance values still require gameplay authoring and visual verification. Do not ship guessed coordinates as final data.

---

## 9. Detailed Implementation Plan

### 9.1 Key findings from codebase analysis

During exploration the following issues were discovered that block a clean implementation:

1. **`PlaneColor` not exported from `@/types/game`**: `airports.config.ts` and `level.structure.ts` import `PlaneColor` from `@/types/game` (i.e. `game.d.ts`), but that file only imports `PlaneTypeConfig`. `PlaneColor` is actually defined in `planes.config.ts` as `type PlaneColor = (typeof PLANE_COLORS)[number]`. Fix: add `PlaneColor` to the import in `game.d.ts` and re-export it.

2. **Broken import paths**: `training.config.ts:24` and `liveops.config.ts:18` import from `./level-structure` (hyphen), but the actual file is `level.structure.ts` (dot). Both are currently broken and produce `TS2307: Cannot find module`. Fix: update to `./level.structure`.

3. **Duplicate Airport interfaces**: `airports.config.ts` and `level.structure.ts` both define `Airport`, `AirportRunway`, `AirportWaypoint` independently. `airports.config.ts` has the complete version (with `brief`, `funny`, `tier`, `sku`, `pitch`, `signature`, `order`); `level.structure.ts` is missing those fields and has `unlockStars` instead. `training.config.ts` imports the types from `./level-structure`. Fix: keep the canonical interface in `airports.config.ts`, have `level.structure.ts` import and re-export them, remove the duplicate definitions and the example EGLC at the bottom.

4. **EGLC_ALT still present**: `airports.config.ts` still exports `EGLC_ALT` and includes it in the `AIRPORTS` array. It is also referenced in `LEGACY_LEVEL_MAP` as `level3: 'eglc-alt.midday-mix'`. Fix: remove the `EGLC_ALT` constant, remove from `AIRPORTS`, update the migration map.

5. **Tier/order conflicts in current `airports.config.ts`**:

   - EGLL: `tier: 'free'`, `order: 2` — should be `tier: 'paid'`, `order: 20`.
   - KJFK: `tier: 'free'`, `order: 3` — should be `tier: 'paid'`, `order: 5`.
   - YSSY: `order: 11` — should be `order: 4`.
   - VHHH: `order: 12` — should be `order: 8`.

6. **`levels.config.ts` `getLevelByNumber` bug**: line 962 does `number.replace(...)` where `number` is typed as `number` (the typeof check can never be true, TypeScript infers `never`). Fix: remove the dead typeof check.

7. **Plane type fleet IDs (1–12)**: Defined in `defaults.config.ts`:

   - 1: A380, 2: A340, 3: A320, 4: DC-9, 5: Concorde, 6: 777X, 7: C-17, 8: An-22, 9: MD-11, 10: Citation, 11: E195, 12: 747-8i.

8. **Free/paid split (corrected)**: Plan table lists KJFK as Free, but Phase 4 and handover context confirm KJFK is paid. Decision: 3 free (EGLC, WADD, KSDM/MMTJ), 17 paid.

9. **RKSI background key**: Plan table has typo `rk si` — should be `rksi`.

10. **`game.d.ts` LevelConfig type**: Does NOT have `minShift` on `RunwayConfig`/`WaypointConfig`. `AirportRunway`/`AirportWaypoint` from `airports.config.ts` add `minShift` as extra — structurally compatible (subset fields). `buildLevel` uses `as ResolvedLevel` cast.

11. **GameScene.ts**: Uses `getLevelByNumber(levelNumber)` with numeric indices. With 100 composed levels (20 airports × 5 shifts), numeric indexing changes. `GameModeScreen.vue` is a hardcoded placeholder not connected to config. No immediate action needed for runtime — numeric helpers remain as index-based shims.

12. **`level-settings.config.ts`**: Has its own `LEVEL_SETTINGS` array with old `levelId: 'level1'`–`'level6'`. Out of scope — update in follow-up.

13. **`TRAINING_LEVELS` in `levels.config.ts`**: `GameScene.ts:6` imports `getTrainingLevelByNumber`. Keep old hand-written `TRAINING_LEVELS` array as-is (training is a separate track).

### 9.2 File-by-file implementation steps

#### Step A: Fix `game.d.ts` (types/game.d.ts)

- Add `PlaneColor` to the import from `@/game/config/planes.config`.
- Re-export: `export type { PlaneColor };`

#### Step B: Complete `airports.config.ts` — Phase 1

**B1. Remove EGLC_ALT**

- Delete the `EGLC_ALT` constant definition.
- Remove `EGLC_ALT` from the `AIRPORTS` array.
- Update `LEGACY_LEVEL_MAP`: change `level3: 'eglc-alt:midday-mix'` to `level3: 'eglc:midday-mix'`.

**B2. Fix existing airports' tier/order**

- EGLL: `tier: 'free'` → `'paid'`, `order: 2` → `20`, add `sku: 'airport.egll'`. Move to PAID section.
- KJFK: `tier: 'free'` → `'paid'`, `order: 3` → `5`, add `sku: 'airport.kjfk'`.
- YSSY: `order: 11` → `4`.
- VHHH: `order: 12` → `8`.

**B3. Add 15 new airports** (JSON orders 2, 3, 6, 7, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19)

| JSON Order | Airport Name        | ICAO      | id          | Tier | SKU                 | backgroundImage |
| ---------- | ------------------- | --------- | ----------- | ---- | ------------------- | --------------- |
| 2          | Bali Ngurah Rai     | WADD      | `wadd`      | free | —                   | `wadd`          |
| 3          | San Diego / Tijuana | KSDM/MMTJ | `ksdm/mmtj` | free | —                   | `ksdm/mmtj`     |
| 6          | Dubai / Sharjah     | OMDB/OMSJ | `omdb/omsj` | paid | `airport.omdb/omsj` | `omdb/omsj`     |
| 7          | Tokyo Haneda        | RJTT      | `rjtt`      | paid | `airport.rjtt`      | `rjtt`          |
| 9          | Madrid Barajas      | LEMD      | `lemd`      | paid | `airport.lemd`      | `lemd`          |
| 10         | San Francisco       | KSFO      | `ksfo`      | paid | `airport.ksfo`      | `ksfo`          |
| 11         | Galeão              | SBJL      | `sbjl`      | paid | `airport.sbjl`      | `sbjl`          |
| 12         | Toronto Pearson     | CYYZ      | `cyyz`      | paid | `airport.cyyz`      | `cyyz`          |
| 13         | Seoul Incheon       | RKSI      | `rksi`      | paid | `airport.rksi`      | `rksi`          |
| 14         | Venice Marco Polo   | LIPZ      | `lipz`      | paid | `airport.lipz`      | `lipz`          |
| 15         | San Diego           | KSAN      | `ksan`      | paid | `airport.ksan`      | `ksan`          |
| 16         | Rome Fiumicino      | LIRF      | `lirf`      | paid | `airport.lirf`      | `lirf`          |
| 17         | Los Angeles         | KLAX      | `klax`      | paid | `airport.klax`      | `klax`          |
| 18         | Lisbon Portela      | LPPT      | `lppt`      | paid | `airport.lppt`      | `lppt`          |
| 19         | Paris CDG           | LFPG      | `lfpg`      | paid | `airport.lfpg`      | `lfpg`          |

For each new airport, create placeholder data:

- **Runways**: At least one at `minShift: 1`, non-negative master coords, `masterWidth` in 20–120, `id` = `{airportId}-rwy{number}`.
- **Waypoints**: At least 2 total, one at `minShift: 1`. Globally unique names. Coords in 0–1.
- **Color coverage**: All 6 colors (`blue, green, yellow, pink, violet, orange`) reachable at every tier 1–5.
- **Fleet**: Placeholder array of plane type IDs 1–12.

**B4. Update AIRPORTS registry** — Must contain all 20 in JSON order: EGLC, WADD, KSDM/MMTJ, YSSY, KJFK, OMDB/OMSJ, RJTT, VHHH, LEMD, KSFO, SBJL, CYYZ, RKSI, LIPZ, KSAN, LIRF, KLAX, LPPT, LFPG, EGLL.

#### Step C: Align `level.structure.ts` — Phase 3

**C1.** Import `Airport`, `AirportRunway`, `AirportWaypoint` from `./airports.config`; re-export them.

**C2.** Delete local `AirportRunway`, `AirportWaypoint`, `Airport` interfaces and the example `EGLC` at the bottom.

**C3.** Remove `unlockStars` (replaced by entitlement in liveops).

**C4.** Update unlock logic to use liveops entitlement gate.

**C5.** Ensure `buildLevel` compatibility — `AirportRunway` extends `RunwayConfig` structurally (has `minShift` extra).

#### Step D: Rebuild `levels.config.ts` — Phase 2

**D1.** Remove old hand-written `LEVELS` array.

- Import `AIRPORTS`, `menuOrder` from `./airports.config`.
- Import `SHIFTS`, `PLATFORM_PROFILES`, `buildAllLevels` from `./level.structure`.
- Generate: `export const LEVELS: LevelConfig[] = buildAllLevels(AIRPORTS, PLATFORM_PROFILES.desktop);`
  (ResolvedLevel[] is assignable to LevelConfig[] via structural typing.)

**D2.** Keep `TRAINING_LEVELS` — old hand-written array (training is separate track).

**D3.** Fix `getLevelByNumber` — remove dead typeof check, use simple `LEVELS[levelNumber - 1]`.

**D4.** Keep all helper functions: `getLevelById`, `getNextLevel`, `getPreviousLevel`, `getTotalLevels`, `calculateStars`, `getLevelBackgroundPath`, `logLevelConfig`, `convertLevelToPixels`, `validateLevelConfig`, `isPlaneTypeAllowedInLevel`, `getRandomAllowedPlaneType`.

**D5.** Keep save migration — `LEGACY_LEVEL_MAP` (updated), `LEGACY_TRAINING_IDS`, `migrateLegacyProgress`.

#### Step E: Update `liveops.config.ts` — Phase 4

**E1.** Fix import: `./level-structure` → `./level.structure`.

**E2.** `FREE_AIRPORT_IDS = ['eglc', 'wadd', 'ksdm/mmtj']` (3 free).

**E3.** Update `FREE_AIRPORT_DESIGN` — remove `egll`/`kjfk`, add `wadd`/`ksdm/mmtj`.

**E4.** Replace `CORE_PACK` (7 entries) with 17 entries: YSSY, KJFK, OMDB/OMSJ, RJTT, VHHH, LEMD, KSFO, SBJL, CYYZ, RKSI, LIPZ, KSAN, LIRF, KLAX, LPPT, LFPG, EGLL. Remove fictional (LOWI, YNAS, SVMI, PTRO).

**E5.** SKUs: use `airport.{id}` format. Decision needed: confirm store backends accept slashes in SKUs; if not, use hyphens.

#### Step F: Fix `training.config.ts`

**F1.** Fix import path: `./level-structure` → `./level.structure`.
**F2.** `PlaneColor` import from `@/types/game` will work once Step A is done.

#### Step G: Validation — Phase 6

1. `npx tsc --noEmit -p packages/app/tsconfig.json` — fix only config-file errors.
2. `cd packages/app && pnpm lint` — fix lint errors in modified files.
3. `cd packages/app && pnpm build` — verify build succeeds.
4. `validateAirports()` returns empty array (or only geometry warnings).
5. Manual checks:
   - `AIRPORTS.length === 20`
   - Exactly 3 free, 17 paid
   - No `eglc-alt` in registry
   - `LEGACY_LEVEL_MAP` maps all 6 old levels to valid composite IDs
   - `FREE_AIRPORT_IDS` matches free airports
   - `CORE_PACK` has 17 entries with real ICAO codes

### 9.3 Data mapping from AIRPORTS_OBJECTS.json

All `brief`/`funny` values come from the JSON. SBJL has empty strings — keep empty. `pitch`/`signature` derived from the airport's geometry problem and runway configuration.

### 9.4 Open questions / decisions

1. **KJFk tier**: Plan table says "Free" but Phase 4 and handover confirm "Paid". Decision: KJFK is paid.
2. **RKSI background key**: Plan table has typo `rk si` — should be `rksi`. Resolved.
3. **Level ID ordering**: With 100 composed levels, numeric level progression changes. GameScene uses numeric IDs for lookup only; menu is not yet connected. No immediate action needed.
4. **TRAINING_LEVELS**: Keep old hand-written array. Training is a separate track.
5. **`level-settings.config.ts`**: Uses old level IDs — out of scope, follow-up.
6. **SKU format for paired airports**: `airport.omdb/omsj` uses a slash. RevenueCat and store backends may not accept slashes in product IDs. If not, use `airport.omdb-omsj` (hyphen).

### 9.5 Dependency order

1. Step A (game.d.ts) — unblocks TS compilation
2. Step B (airports.config.ts) — canonical Airport type and data
3. Step C (level.structure.ts) — imports from B, provides SHIFTS/composition
4. Step D (levels.config.ts) — imports from B and C, generates LEVELS
5. Step E (liveops.config.ts) — depends on B
6. Step F (training.config.ts) — fixes import path, depends on C
7. Step G (validation) — runs after all above
