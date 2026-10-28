Airport-to-Shift Navigation Implementation Plan
Review gate: this plan is ready for approval. Do not change code or generated assets until it is approved.

Goal
Replace the hardcoded airport/level screens with an airport → shift/sublevel flow, connect that flow to the existing composed-level runtime, and make the background build command explicitly consume ./raw_assets/bg/\*.png.

Decisions and contracts
AIRPORTS*OBJECTS.json is authoritative for the 20-airport roster and order.
Canonical airport IDs retain paired slashes: ksdm/mmtj, omdb/omsj.
Canonical playable IDs are airportId:shiftId, for example eglc:red-eye.
Five finite shifts unlock sequentially within each owned airport.
Endless is the sixth submenu item, unlocked after midday-mix; it has no target and does not advance finite progression.
Gameplay route is /play/:airportId/:shiftId; Vue Router params are encoded so paired IDs remain safe.
The existing numeric LEVELS lookup remains the Phaser compatibility boundary.
Free airports are always available; paid airports use the current premium entitlement gate. Individual airport SKU purchasing is not added in this phase.
Shift stars/clear state uses a local progress store in this phase because Supabase has no shift-progress column or migration. Existing numeric current_level persistence remains for backward compatibility.
Scope
Included
Canonical airport list and shift submenu UI.
Sequential shift locking and Endless visibility.
Composite route handling and legacy numeric-route compatibility.
Game store bridge from composite IDs to the existing numeric Phaser level index.
Local shift progress persistence and completion recording.
Explicit background source glob in package.json.
Generator checks for paired airport filenames/keys.
Typecheck, lint, build, and targeted runtime validation.
Excluded
New background artwork or geometry authoring.
Shift balance/fleet tuning.
Supabase schema migration for server-side shift progress.
Individual airport SKU checkout implementation.
Training-screen rewrite.
Preflight
Preserve the existing dirty worktree state; do not overwrite unrelated changes.
Confirm AIRPORTS_OBJECTS.json has 20 entries and raw_assets/bg has 20 matching images.
Confirm AIRPORTS.length === 20, with 3 free and 17 paid airports.
Confirm LEVELS.length === 100 and sample IDs use airportId:shiftId.
Confirm generated free/paid manifests exist and contain airport keys with paired slashes.
Record the current package.json diff so the script change is isolated.
Phase 1 — Normalize the data boundary
Reconcile stale documentation/comments that say composite IDs use .; runtime IDs use :.
Add or expose a single lookup helper for airportId + shiftId → ResolvedLevel.
Add a route-safe encoder/decoder helper that uses encodeURIComponent for both params.
Keep airport.backgroundImage as the canonical background key; never derive it from numeric level position.
Add a helper that maps a composite level ID to its 1-based numeric index for the existing engine and Supabase current_level.
Fix paired-airport generator lookup so ksdm/mmtj and omdb/omsj resolve filenames using /, *, or : separators without guessing a new airport identity.
Keep TRAINING*LEVELS and its numeric helpers unchanged.
Phase 2 — Shift progress model
Add a useShiftProgressStore (or equivalent) with:
stars: Record<string, number> keyed by composite level ID.
cleared: Record<string, boolean> keyed by composite level ID.
recordResult(levelId, stars) with stars clamped to 0..3.
LocalStorage persistence with a versioned key.
Migrate existing atc-app_game.currentLevel into cleared composite IDs using the existing legacy mapping where possible.
On finite-shift completion, update local stars/cleared state and call the existing numeric progress save path for compatibility.
Keep Endless out of finite cleared progression; it may record a personal best separately later.
Use isShiftUnlocked() and isEndlessUnlocked() from level.structure.ts as the UI source of truth.
Define the Supabase shift-progress migration as a follow-up, not as a prerequisite for the menu.
Phase 3 — Airport list screen
Replace the hardcoded Airfield[] in AirfieldsScreen.vue with menuOrder() from airports.config.ts.
Show free and paid airports in canonical order, with a clear owned/locked state.
Make a paid airport open the existing paywall when the player is not premium.
Make an owned airport navigate to its shift submenu rather than launching a level directly.
Show the airport code, display name, tier/ownership, and best-star summary where available.
Remove the hardcoded five-card legacy launch behavior and numeric levelNumber assumptions.
Keep the existing back target (/play-fields) and responsive styling conventions.
If GameModeScreen.vue remains reachable, redirect or adapt it to the same canonical airport list so two airport rosters cannot drift.
Phase 4 — Shift submenu
Add an airport-shift route/view, for example /airfields/:airportId/shifts.
Resolve the encoded airport param back to the canonical slash-containing ID.
Display exactly five finite shifts in tier order, followed by Endless Shift.
Lock shifts 2–5 until the previous finite shift is cleared.
Show locked shifts as visible but unavailable, with the unlock requirement.
Show Endless as visible but locked until airportId:midday-mix is cleared.
Launch a finite shift by navigating to /play/:airportId/:shiftId.
Launch Endless through the same route shape with shiftId === 'endless'; gameplay must use the Endless rules rather than a finite target.
Preserve a reliable back action to the airport list.
Phase 5 — Routes and gameplay bridge
Add /play/:airportId/:shiftId as the canonical gameplay route and render GameView.vue.
Keep /play/:levelId as a compatibility route; resolve numeric IDs through getLevelByNumber() and redirect to the canonical composite route.
Use router.push({ name: 'Game', params: { airportId, shiftId } }) so paired IDs are encoded automatically.
Update the premium guard to validate the resolved composite level against airport entitlement and the existing numeric access cap.
Add currentLevelId to gameStore and a setLevelId(compositeId) action.
Have setLevelId() resolve the numeric index, call the existing setLevel() behavior, and store the composite ID.
In GameView.vue, watch the canonical route params, resolve the composite ID, set the store, clear training mode, and increment gameKey so Phaser boots the selected level.
Keep the existing /play route as a safe fallback that boots the store’s current level.
Normalize game:init call sites so they never pass an unresolved composite ID to Phaser; retain numeric payloads at the Phaser boundary.
Fix the malformed BootScene.ts formatting around airport lookup and keep paid-background access checks intact.
Ensure GameScene logs/resolves the selected composite level while continuing to consume LevelConfig and numeric lookup helpers.
Phase 6 — Build command and generator
Change build:airports in root package.json to:
"build:airports": "ts-node scripts/process-backgrounds.ts ./raw_assets/bg/*.png"
Keep scripts/process-backgrounds.config.json as the source of truth for ratios, DPR, free/paid classification, and output paths.
Verify the shell expands the glob to all 20 source images on the supported build platforms.
Run pnpm build:airports and confirm it processes all 20 images.
Run pnpm build:airports --skip-existing through the script’s argument handling and confirm it does not regenerate existing outputs.
Confirm paired source files produce manifest airportKey values ksdm/mmtj and omdb/omsj.
Confirm free/paid manifest counts remain 36 and 204 respectively.
Confirm the bundled free manifest remains present and contains only free airport entries.
Phase 7 — Validation
Run the app typecheck: cd packages/app && pnpm exec tsc --noEmit.
Run the repository lint command: pnpm lint.
Run the app build: cd packages/app && pnpm build.
Run pnpm build:airports and inspect its exit status and processed-file count.
Verify airport cards are ordered free first, then paid, matching menuOrder().
Verify a free airport opens its submenu and Red-Eye launches successfully.
Verify shift 2 is locked before Red-Eye clears and unlocks afterward.
Verify all five finite shifts unlock in order.
Verify Endless is hidden/locked before Midday Mix and available afterward.
Verify ksdm/mmtj and omdb/omsj routes round-trip through encoded params without splitting into extra route segments.
Verify paid airports open the paywall for free users and launch for premium users.
Verify legacy /play/1 and similar links resolve to the correct composite level.
Verify back navigation returns to the shift submenu, then the airport list.
Verify refreshing or reopening the app preserves local shift progress.
Verify no unrelated files in the existing dirty worktree are modified.
Acceptance criteria
The player can select an airport, see its five finite shifts plus Endless, and launch only unlocked content.
Composite IDs are canonical internally and safe in routes, including paired airports.
The existing Phaser engine continues to receive a valid numeric LevelConfig index.
The background build command explicitly uses ./raw*assets/bg/*.png and succeeds.
Typecheck, lint, app build, and targeted navigation tests pass.
No generated assets or unrelated worktree changes are introduced by this plan.
Relevant files
package.json
scripts/process-backgrounds.ts
scripts/process-backgrounds.config.json
AIRPORTS_OBJECTS.json
packages/app/src/game/config/airports.config.ts
packages/app/src/game/config/level.structure.ts
packages/app/src/game/config/levels.config.ts
packages/app/src/game/config/liveops.config.ts
packages/app/src/views/AirfieldsScreen.vue
packages/app/src/views/GameModeScreen.vue
packages/app/src/views/PlayFieldsScreen.vue
packages/app/src/views/GameView.vue
packages/app/src/router/index.ts
packages/app/src/stores/game.ts
packages/app/src/stores/monetization.ts
packages/app/src/services/EventBus.ts
packages/app/src/game/scenes/BootScene.ts
packages/app/src/game/scenes/GameScene.ts
packages/app/src/lib/supabase.ts
