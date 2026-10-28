// =============================================================================
// BootScene.ts
// =============================================================================
//
// Phaser's first scene. Loads game assets silently and reports progress via
// the Vue event bus so the Vue loading overlay (AirTrafficCanvas / IntroScreen)
// can drive a native-feeling progress bar without any Phaser canvas rendering.
//
// ── LOADING FLOW ─────────────────────────────────────────────────────────────
//
//  1. BootScene.preload() fires immediately after Phaser initialises.
//  2. Every meaningful milestone emits  assets:progress  { pct: 0–100, step }.
//  3. AirTrafficCanvas.vue listens and drives its Vue progress bar.
//  4. On complete → waits 300 ms → starts GameScene → emits  assets:loaded.
//
// ── BACKGROUND IMAGES — NEITHER TIER IS BUNDLED ─────────────────────────────
//
//  No level's background ships in the app bundle anymore, free or paid —
//  see backgroundAssetService.ts's header for why free levels moved off
//  bundling too. Both tiers are downloaded on demand and cached locally:
//    • FREE levels  → public Supabase Storage bucket, no auth required.
//      Safe to preload here in BootScene — that's what this file does below.
//    • PAID levels  → private `game_assets` bucket (same RLS — is_premium =
//      true — that already gates levels_full.json). MUST stay deferred
//      until GameScene verifies monetizationStore.canAccessLevel(levelId) —
//      BootScene explicitly skips the background preload for any level
//      above FREE_LEVEL_LIMIT (see loadAssetsAsync below) so a resumed
//      session on a paid level never triggers an unauthenticated download
//      attempt at boot.
//
//  See: GameScene.ts → loadLevelBackground()
//       backgroundAssetService.ts → getBackgroundForLevel()
//       monetization store → canAccessLevel(levelId), FREE_LEVEL_LIMIT
//
// ── WHY NO CANVAS UI ─────────────────────────────────────────────────────────
//
//  The old BootScene rendered its own loading bar directly onto the Phaser
//  canvas (Phaser Graphics + Text objects). This conflicted with the Vue
//  loading overlay on AirTrafficCanvas and produced a broken double-loading-
//  screen UX (the Phaser bar showed UNDER the Vue overlay during IntroScreen,
//  then OVER it once the canvas mounted). The Vue overlay is richer and more
//  consistent with the rest of the UI system, so BootScene now does nothing
//  visual — all progress reporting happens via the event bus.
//
// =============================================================================

import Phaser from 'phaser';
import { gameEventBus } from '@/services/EventBus';
import { getLevelById, getLevelByNumber } from '@/game/config/levels.config';
import { getAirportById } from '@/game/config/airports.config';
import { loadPlaneSprites, loadBackgroundImagesForAirport } from '@/game/utils/assetLoader';
import { useGameStore } from '@/stores/game';
import { AudioSystem } from '@/game/systems/AudioSystem';

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload(): void {
    this.loadAssetsAsync();
  }

  // create() is intentionally empty — GameScene will handle everything after
  // the scene transition.
  create(): void {}

  private async loadAssetsAsync(): Promise<void> {
    const emit = (pct: number, step: string) => gameEventBus.emit('assets:progress', { pct, step });

    try {
      emit(5, 'Preparing asset list…');

      const gameStore = useGameStore();
      const targetLevel = gameStore.currentLevelId
        ? getLevelById(gameStore.currentLevelId)
        : getLevelByNumber(gameStore.currentLevel ?? 1);
      const targetAirportId = targetLevel?.airportId ?? 'eglc';
      const isFree =
        getAirportById(targetAirportId)?.tier === 'free' || gameStore.trainingLevel !== null;
      const backgrounds: { [key: string]: string } = {};
      const bgPromise = isFree
        ? loadBackgroundImagesForAirport(targetAirportId)
        : Promise.resolve({});
      bgPromise
        .then((bg) => {
          Object.assign(backgrounds, bg);
        })
        .catch((err) => console.warn('⚠️ BootScene background preload failed (non-fatal):', err));
      const planes = await loadPlaneSprites();
      const assets = { planes, backgrounds };
      emit(20, 'Asset list ready…');

      // ── Audio ─────────────────────────────────────────────────────────────
      AudioSystem.preload(this);
      emit(25, 'Audio registered…');

      // ── Plane sprites ─────────────────────────────────────────────────────
      const planeEntries = Object.entries(assets.planes);
      const bgEntries = Object.entries(assets.backgrounds);
      const total = planeEntries.length + bgEntries.length;
      let loaded = 0;

      for (const [key, url] of planeEntries) {
        this.load.image(key, url);
        loaded++;
        emit(25 + Math.round((loaded / total) * 50), `Plane: ${key}`);
      }

      emit(75, 'Loading textures…');

      // Wait for Phaser's loader to finish the plane sprites (real HTTP URLs
      // from Vite — no CSP concern, this is the normal XHR-based path).
      const planeLoadPromise = new Promise<void>((resolve) => {
        this.load.once('complete', () => resolve());
        this.load.on('loaderror', (file: Phaser.Loader.File) => {
          // Non-fatal: log and continue so a missing asset doesn't freeze boot
          console.error(`❌ Failed to load: ${file.key}`, file.src);
          gameEventBus.emit('assets:error', file.key);
        });
        this.load.start();
      });

      // ── Background (free level only — see header) ──────────────────────────
      //
      // addBase64, NOT this.load.image. Every URL from getBackgroundForLevel
      // is a data: URI (see backgroundAssetService.ts). Phaser's normal
      // loader fetches image URLs via XHR, and most CSPs' connect-src
      // doesn't allow blob: — using load.image on a blob: URL was a real bug
      // here (silently CSP-blocked, background never appeared). addBase64
      // uses an <img> element directly, bypassing the XHR-gated loader
      // entirely, so it's immune to that regardless of CSP config.
      const bgLoadPromises = bgEntries.map(
        ([key, url]) =>
          new Promise<void>((resolve) => {
            if (this.textures.exists(key)) {
              resolve();
              return;
            }
            this.textures.once(Phaser.Textures.Events.ADD, (addedKey: string) => {
              if (addedKey === key) {
                loaded++;
                emit(25 + Math.round((loaded / total) * 50), `Background: ${key}`);
                resolve();
              }
            });
            this.textures.addBase64(key, url);
          })
      );

      await Promise.all([planeLoadPromise, ...bgLoadPromises]);

      emit(100, 'Ready!');
      gameEventBus.emit('assets:loaded');

      // Short pause so the user sees 100% before the game scene fades in
      this.time.delayedCall(300, () => {
        this.scene.start('GameScene', {
          level: gameStore.currentLevel ?? 1,
          levelId: gameStore.currentLevelId ?? undefined,
        });
      });
    } catch (error) {
      console.error('❌ BootScene asset load failed:', error);
      gameEventBus.emit('assets:error', 'Failed to load game assets');
    }
  }
}
