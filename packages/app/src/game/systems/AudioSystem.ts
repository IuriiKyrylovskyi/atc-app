// =============================================================================
// AudioSystem.ts
// =============================================================================
//
// Manages all in-game audio:
//
//   1. LEVEL BACKGROUND MUSIC
//      Looping per-level track.  Fades in on create(), fades out on shutdown().
//      Files: public/sounds/music-level-N.mp3  (N = 1–5)
//
//   2. PREDICT LOOP  (Traffic Advisory / TA warning)
//      Loops predict.mp3 for exactly as long as yellow collision-prediction
//      circles are visible, and stops the moment they all clear.
//
//      ── WHY A LOOP, NOT A DEBOUNCED BEEP ────────────────────────────────────
//      The yellow circles are redrawn every frame while _cachedConflictCount
//      > 0.  A one-shot debounced beep would fire once then go silent even
//      though the hazard persists — the player would lose the audio cue after
//      the first second.  A loop naturally mirrors the visual state:
//
//        circles visible  ↔  predict loop playing
//        circles gone     ↔  predict loop stopped
//
//      ── LOOP LIFECYCLE ───────────────────────────────────────────────────────
//      update() runs every frame after checkCollisions():
//
//        _cachedConflictCount > 0  AND  loop NOT playing  → start loop
//        _cachedConflictCount == 0 AND  loop IS  playing  → stop  loop
//
//      The loop starts on the exact frame the first pair enters the warning
//      zone and stops on the exact frame the last pair leaves it.
//
//      ── ASSET PATH ───────────────────────────────────────────────────────────
//      File: public/sounds/predict.mp3
//      Loaded as a plain path string in preload() — same as all other sounds.
//      Phaser key: 'sfx-predict-loop'
//
//   3. RESOLUTION ADVISORY (RA) — one-shot fatal collision sound
//      File: public/sounds/collision.wav
//
// ── ARCHITECTURE ──────────────────────────────────────────────────────────────
//
// AudioSystem is a stateless module — no class, no `new`.  GameScene passes
// `this` (as AudioContext) to every method.  The same pattern is used by
// CollisionSystem, DrawSystem, SpawnSystem, WorldTransform, InputSystem.
//
// Volume state lives in a private module-level object so it survives scene
// restarts.  The `settings:audio` listener is registered once in init() and
// removed in teardown() — never per-scene — so volume changes in the pause
// menu take effect without reloading.
//
// ── INTEGRATION CHECKLIST ─────────────────────────────────────────────────────
//
//   BootScene.preload():
//     AudioSystem.preload(this);
//
//   GameScene.create():
//     AudioSystem.startMusic(this);
//
//   GameScene.update()  — after checkCollisions():
//     AudioSystem.update(this, time);
//
//   GameScene.shutdown():
//     AudioSystem.stopAll(this);
//
//   useGame.ts — after new Phaser.Game():
//     AudioSystem.init();
//   useGame.ts — onUnmounted:
//     AudioSystem.teardown();
//
// =============================================================================

import Phaser from 'phaser';
import { gameEventBus } from '@/services/EventBus';

// =============================================================================
// CONSTANTS
// =============================================================================

/** Maximum number of levels that can have distinct music tracks. */
const MAX_LEVEL_MUSIC = 3; // only music-level-1..3 exist in public/sounds/

/** Phaser sound cache key for the predict loop. */
const PREDICT_KEY = 'sfx-predict-loop';

/** Phaser sound cache key for the plane-landed / waypoint-passed beap. */
const BEAP_KEY = 'sfx-beap';

/** Phaser sound cache key for the plane-attached-to-runway/waypoint success sound. */
const SUCCESS_KEY = 'sfx-success';

/**
 * Fade-in duration for background music, in milliseconds.
 * Phaser starts music at volume 0; a tween raises it to the target level.
 */

/**
 * Fade-out duration for background music on shutdown, in milliseconds.
 * Prevents a jarring cut when the player retries a level.
 */
const MUSIC_FADE_OUT_MS = 800;

// =============================================================================
// AUDIO CONTEXT INTERFACE
// =============================================================================

/**
 * Everything AudioSystem needs from GameScene.
 *
 * GameScene passes `this` directly — TypeScript verifies at compile time that
 * all listed fields are public on GameScene.
 *
 * ── WHY NOT scene: Phaser.Scene ──────────────────────────────────────────────
 * In any Phaser.Scene subclass, `this.scene` is the ScenePlugin — NOT the
 * scene itself.  Requesting individual managers (.sound, .tweens) avoids the
 * naming collision entirely.
 */
export interface AudioContext {
  /** Phaser sound manager — `this.sound` inside GameScene. */
  sound: Phaser.Sound.BaseSoundManager;

  /** Phaser tween manager — `this.tweens` inside GameScene. */
  tweens: Phaser.Tweens.TweenManager;

  /** Current level number (1–5). Selects which music track to start. */
  levelNumber: number;

  /**
   * True after a fatal collision (set by CollisionSystem on the collision frame).
   * AudioSystem.update() stops the predict loop and fires the RA sound once
   * when this transitions from false → true.
   */
  isGameOver: boolean;

  /**
   * Count of active proximity-warning pairs, updated by CollisionSystem.check()
   * before AudioSystem.update() runs each frame.
   *   > 0  → at least one pair of planes is inside the TA warning radius
   *   == 0 → no warnings active, circles not drawn
   */
  _cachedConflictCount: number;
}

// =============================================================================
// MODULE-LEVEL STATE
// =============================================================================

/** Volume settings — persist across scene restarts. */
interface VolumeState {
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  muted: boolean;
}

const _vol: VolumeState = {
  masterVolume: 1.0,
  musicVolume: 0.8,
  sfxVolume: 1.0,
  muted: false,
};

/**
 * Key of the currently playing music track.
 * Compared in startMusic() to skip restarting the same track on level retry.
 */
let _currentMusicKey: string | null = null;

/**
 * Cached sound manager reference — set in startMusic(), used by event-driven
 * action sounds (_playBeap, _playSuccess) which have no ctx parameter.
 * Cleared in teardown().
 */
let _soundMgr: Phaser.Sound.BaseSoundManager | null = null;

/**
 * Whether the predict loop is currently active.
 *
 * Tracked separately from ctx.sound.get(PREDICT_KEY).isPlaying because Phaser
 * may take one frame to set isPlaying after play() is called — using the
 * Phaser flag directly would cause update() to call _startPredictLoop() twice
 * on fast transitions (e.g. planes entering and leaving the zone in one frame).
 */
let _predictPlaying = false;

/**
 * Whether the RA collision sound has already fired this level.
 * Prevents double-fire on the same frame or if update() runs after shutdown().
 */
let _raFired = false;

/**
 * Stored bound reference for the `settings:audio` listener.
 * Must be stored so teardown() can pass the exact same function to off().
 * Using .bind() inline inside off() creates a new object that never matches.
 */
let _onAudioSettings: ((audio: VolumeState) => void) | null = null;

// Stored refs for action-sound listeners — registered in init(), removed in teardown().
// Module-level so they survive level restarts without re-registering.
let _onPlaneLanded: ((planeId: number, score: number) => void) | null = null;
let _onWaypointPassed: ((planeId: number, score: number) => void) | null = null;
let _onPlaneAttached: ((planeId: number, target: 'runway' | 'waypoint') => void) | null = null;

// =============================================================================
// PRIVATE HELPERS
// =============================================================================

/** Effective music volume: master × music, 0 when muted. */
function effectiveMusicVol(): number {
  if (_vol.muted) return 0;
  return _vol.masterVolume * _vol.musicVolume;
}

/** Effective SFX volume: master × sfx, 0 when muted. */
function effectiveSfxVol(): number {
  if (_vol.muted) return 0;
  return _vol.masterVolume * _vol.sfxVolume;
}

/** Phaser audio cache key for a given level number. */
function musicKeyForLevel(n: number): string {
  return `music-level-${Math.min(Math.max(1, n), MAX_LEVEL_MUSIC)}`;
}

/**
 * Returns true if Phaser's sound manager is in a state where .get() is safe.
 *
 * WHY THIS EXISTS:
 * WebAudioSoundManager.get() reads `this.sounds.length` internally.  When the
 * scene is destroyed or Phaser tears down, `sounds` is set to null — any call
 * to .get() at that point throws:
 *   "Cannot read properties of null (reading 'length')"
 *
 * This happens when a Vue-layer event (e.g. game:pause from a UI button) fires
 * on the same tick as scene teardown.  By probing with getAll() first — which
 * hits the same internal path — we can bail out before any state is mutated.
 */
function soundManagerAlive(mgr: Phaser.Sound.BaseSoundManager): boolean {
  if (!mgr) return false;
  try {
    mgr.getAll('__probe__');
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns true if the given key is present in Phaser's audio cache.
 *
 * Every play() call is guarded by this so missing audio files degrade
 * silently — the game is fully playable without any sound files present.
 */
function soundExists(mgr: Phaser.Sound.BaseSoundManager, key: string): boolean {
  // Guard: sound manager may be from a destroyed game instance
  if (!mgr?.game?.cache?.audio) return false;
  return mgr.game.cache.audio.has(key);
}

// =============================================================================
// PUBLIC API
// =============================================================================

export const AudioSystem = {
  // ---------------------------------------------------------------------------
  // APP-LEVEL LIFECYCLE  (call once per Phaser.Game instance, not per scene)
  // ---------------------------------------------------------------------------

  /**
   * Directly apply audio settings to the internal volume state.
   *
   * Call this instead of (or in addition to) emitting `settings:audio`.
   * Unlike the event-bus path, this works regardless of whether the
   * `settings:audio` listener has been registered yet — so it is safe to
   * call from the settings store at any point in the app lifecycle.
   *
   * Also immediately updates the volume of the currently-playing music track
   * so in-game slider changes take effect without restarting the scene.
   */
  applySettings(audio: {
    masterVolume: number;
    musicVolume: number;
    sfxVolume: number;
    muted: boolean;
  }): void {
    console.log('🔊 AudioSystem.applySettings called with:', audio);
    _vol.masterVolume = audio.masterVolume ?? 1.0;
    _vol.musicVolume = audio.musicVolume ?? 1.0;
    _vol.sfxVolume = audio.sfxVolume ?? 1.0;
    _vol.muted = audio.muted ?? false;

    console.log(
      '🔊 AudioSystem._vol after apply:',
      _vol,
      'effectiveMusicVol:',
      effectiveMusicVol()
    );

    // Push new volume to the live music track immediately if one is playing.
    if (_soundMgr && soundManagerAlive(_soundMgr) && _currentMusicKey) {
      const music = _soundMgr.get(_currentMusicKey) as
        | Phaser.Sound.WebAudioSound
        | Phaser.Sound.HTML5AudioSound
        | null;
      if (music?.isPlaying) {
        music.setVolume(effectiveMusicVol());
      }
    }
  },

  /**
   * Register the `settings:audio` event listener.
   *
   * Call ONCE after new Phaser.Game() (e.g. useGame.ts), NOT from
   * GameScene.create().  The listener must survive level restarts so a volume
   * change in the pause menu takes effect without reloading.
   *
   * Pair with teardown() when the Phaser.Game is destroyed.
   */
  init(): void {
    if (_onAudioSettings) return; // guard against double-init

    _onAudioSettings = (audio: VolumeState) => {
      AudioSystem.applySettings(audio);
      console.log(
        `🔊 AudioSystem settings: master=${_vol.masterVolume.toFixed(2)}` +
          ` music=${_vol.musicVolume.toFixed(2)}` +
          ` sfx=${_vol.sfxVolume.toFixed(2)}` +
          ` muted=${_vol.muted}`
      );
    };

    // Action sounds — driven entirely by game events so GameScene needs no
    // direct AudioSystem call sites for these.
    _onPlaneLanded = () => {
      AudioSystem._playBeap();
    };
    _onWaypointPassed = () => {
      AudioSystem._playBeap();
    };
    _onPlaneAttached = () => {
      AudioSystem._playSuccess();
    };

    gameEventBus.on('settings:audio', _onAudioSettings);
    gameEventBus.on('plane:landed', _onPlaneLanded);
    gameEventBus.on(
      'plane:waypoint-passed',
      _onWaypointPassed
    );
    gameEventBus.on('plane:attached', _onPlaneAttached);
    console.log('🔊 AudioSystem: initialised');
  },

  /**
   * Remove the `settings:audio` listener and reset all module state.
   * Call when the Phaser.Game is destroyed (useGame.ts onUnmounted).
   */
  teardown(): void {
    if (_onAudioSettings) {
      gameEventBus.off(
        'settings:audio',
        _onAudioSettings
      );
      _onAudioSettings = null;
    }
    if (_onPlaneLanded) {
      gameEventBus.off('plane:landed', _onPlaneLanded);
      _onPlaneLanded = null;
    }
    if (_onWaypointPassed) {
      gameEventBus.off(
        'plane:waypoint-passed',
        _onWaypointPassed
      );
      _onWaypointPassed = null;
    }
    if (_onPlaneAttached) {
      gameEventBus.off(
        'plane:attached',
        _onPlaneAttached
      );
      _onPlaneAttached = null;
    }
    _currentMusicKey = null;
    _soundMgr = null;
    _predictPlaying = false;
    _raFired = false;
    console.log('🔊 AudioSystem: torn down');
  },

  // ---------------------------------------------------------------------------
  // BOOT  (call from BootScene.preload())
  // ---------------------------------------------------------------------------

  /**
   * Register all audio assets with Phaser's loader.
   *
   * Call from BootScene.preload() — all files are fetched and decoded during
   * the loading screen so there is zero stutter on first play.
   *
   * All files are in public/sounds/ and loaded as plain path strings.
   */
  preload(scene: Phaser.Scene): void {
    // Level music  (public/sounds/music-level-N.mp3)
    for (let n = 1; n <= MAX_LEVEL_MUSIC; n++) {
      const key = musicKeyForLevel(n);
      scene.load.audio(key, `sounds/${key}.mp3`);
    }

    // Predict loop  (public/sounds/predict.mp3)
    scene.load.audio(PREDICT_KEY, 'sounds/predict.mp3');

    // RA collision  (public/sounds/collision.wav)
    scene.load.audio('sfx-collision', 'sounds/collision.wav');

    // Beap — played once per plane landing or waypoint pass
    scene.load.audio(BEAP_KEY, 'sounds/beap.mp3');

    // Success — played once when a plane is attached to a runway or waypoint
    scene.load.audio(SUCCESS_KEY, 'sounds/success.wav');

    console.log(`🔊 AudioSystem: registered ${MAX_LEVEL_MUSIC + 4} audio assets`);
  },

  // ---------------------------------------------------------------------------
  // SCENE LIFECYCLE  (call from GameScene.create() / GameScene.shutdown())
  // ---------------------------------------------------------------------------

  /**
   * Start background music for the current level.
   *
   * Safe to call every create() — skips silently if the same track is already
   * playing (e.g. same level retried).  Starts at the correct volume immediately.
   */
  startMusic(ctx: AudioContext): void {
    // Guard: sound manager may be from a destroyed game instance
    if (!ctx.sound?.game) {
      console.warn('🔊 AudioSystem: startMusic called with invalid sound manager (game destroyed)');
      return;
    }

    console.log('🔊 AudioSystem: startMusic called', {
      levelNumber: ctx.levelNumber,
      soundManagerAlive: soundManagerAlive(ctx.sound),
      ctxSound: !!ctx.sound,
    });

    const key = musicKeyForLevel(ctx.levelNumber);

    // Cache the sound manager for event-driven action sounds
    _soundMgr = ctx.sound;

    // Reset per-level transient flags so the loop and RA can fire again
    _predictPlaying = false;
    _raFired = false;

    // Same track already playing → kill any in-flight fade tween and snap to
    // current volume (e.g. user retried same level after changing settings).
    if (_currentMusicKey === key && ctx.sound.get(key)?.isPlaying) {
      const music = ctx.sound.get(key) as Phaser.Sound.WebAudioSound | Phaser.Sound.HTML5AudioSound;
      if (music) {
        ctx.tweens.killTweensOf(music);
        music.setVolume(effectiveMusicVol());
      }
      console.log(`🔊 AudioSystem: music "${key}" already playing — volume synced`);
      return;
    }

    // Stop any previous track before starting the new one
    if (_currentMusicKey) {
      const prev = ctx.sound.get(_currentMusicKey);
      prev?.stop();
      prev?.destroy();
      _currentMusicKey = null;
    }

    if (!soundExists(ctx.sound, key)) {
      console.warn(`🔊 AudioSystem: "${key}.mp3" not found — place in public/sounds/`);
      return;
    }

    console.log(`🔊 AudioSystem: sound exists for "${key}", checking AudioContext state`, {
      soundState:
        ctx.sound instanceof Phaser.Sound.WebAudioSoundManager
          ? (ctx.sound as Phaser.Sound.WebAudioSoundManager).context?.state
          : 'not WebAudio',
    });

    const targetVol = effectiveMusicVol();
    console.log(
      `🔊 AudioSystem: startMusic "${key}" — vol=${targetVol.toFixed(3)}` +
        ` (master=${_vol.masterVolume} music=${_vol.musicVolume} muted=${_vol.muted})`
    );

    // Start at the correct volume immediately — no fade-in tween.
    // A 0→target fade causes a noticeable ramp on every level start.
    const music = ctx.sound.add(key, { loop: true, volume: targetVol }) as
      | Phaser.Sound.WebAudioSound
      | Phaser.Sound.HTML5AudioSound;
    music.play();
    _currentMusicKey = key;

    console.log(
      `🔊 AudioSystem: started music "${key}", music.isPlaying=${music.isPlaying}, music.volume=${music.volume}`
    );

    // ── AudioContext unlock guard (web browsers / Mac) ──────────────────────
    // Browsers suspend AudioContext until first user gesture. Phaser 3 does NOT
    // queue sounds that fire while suspended — they fail silently.
    // If the context is suspended, try to resume it immediately (works if there
    // was a prior user gesture like clicking "Start Game"), otherwise wait for
    // the 'unlocked' event from a future interaction.
    if (ctx.sound instanceof Phaser.Sound.WebAudioSoundManager) {
      const webMgr = ctx.sound as Phaser.Sound.WebAudioSoundManager;
      if (webMgr.context?.state === 'suspended') {
        console.log('🔊 AudioSystem: AudioContext suspended — attempting immediate resume');
        webMgr.context
          .resume()
          .then(() => {
            if (webMgr.context?.state === 'running') {
              console.log('🔊 AudioSystem: AudioContext resumed immediately');
              // Re-create and play the music since the first play() may have failed
              const existing = webMgr.get(key);
              if (existing && !existing.isPlaying) {
                existing.destroy();
                const retried = webMgr.add(key, { loop: true, volume: effectiveMusicVol() });
                retried.play();
                console.log(`🔊 AudioSystem: music "${key}" started after immediate resume`);
              }
            }
          })
          .catch(() => {
            // If immediate resume fails, fall back to waiting for 'unlocked' event
            console.log('🔊 AudioSystem: immediate resume failed, waiting for unlocked event');
          });

        // Also register for the unlocked event as fallback
        ctx.sound.once('unlocked', () => {
          // Guard: level may have changed or been destroyed since we registered
          if (_currentMusicKey !== key) return;
          if (!soundManagerAlive(webMgr)) return;
          const existing = webMgr.get(key);
          if (existing?.isPlaying) return; // already playing (shouldn't happen, but safe)
          existing?.destroy();
          const retried = webMgr.add(key, { loop: true, volume: effectiveMusicVol() });
          retried.play();
          console.log(`🔊 AudioSystem: music "${key}" restarted after AudioContext unlock`);
        });
      }
    }
  },

  /**
   * Pause the currently playing music track.
   *
   * Called when `game:pause` fires.  The track position is preserved so
   * resumeMusic() continues from the same point.
   */
  pauseMusic(ctx: AudioContext): void {
    if (!_currentMusicKey) return;
    if (!soundManagerAlive(ctx.sound)) return;
    const music = ctx.sound.get(_currentMusicKey);
    if (music?.isPlaying) {
      music.pause();
      console.log(`🔊 AudioSystem: music paused "${_currentMusicKey}"`);
    }
  },

  /**
   * Resume the paused music track.
   *
   * Called when `game:resume` fires.  No-op if the track is already playing
   * (e.g. resume fired without a prior pause).
   */
  resumeMusic(ctx: AudioContext): void {
    if (!_currentMusicKey) return;
    if (!soundManagerAlive(ctx.sound)) return;
    const music = ctx.sound.get(_currentMusicKey);
    if (music && !music.isPlaying) {
      music.resume();
      console.log(`🔊 AudioSystem: music resumed "${_currentMusicKey}"`);
    }
  },

  /**
   * Fade out music and immediately stop the predict loop and RA sound.
   *
   * Call as the FIRST statement in GameScene.shutdown() while this.sound and
   * this.tweens are still valid Phaser objects.
   */
  stopAll(ctx: AudioContext): void {
    // Fade out music
    if (_currentMusicKey) {
      const music = ctx.sound.get(_currentMusicKey);
      if (music?.isPlaying) {
        ctx.tweens.add({
          targets: music,
          volume: 0,
          duration: MUSIC_FADE_OUT_MS,
          ease: 'Linear',
          onComplete: () => {
            music.stop();
            music.destroy();
          },
        });
        console.log(`🔊 AudioSystem: fading out "${_currentMusicKey}"`);
      }
    }

    // Stop predict loop immediately — it is an alert tone, not music
    AudioSystem._stopPredictLoop(ctx);

    // Stop RA sound if somehow still playing
    ctx.sound.get('sfx-collision')?.stop();

    _raFired = false;
    // _currentMusicKey is intentionally NOT cleared here so startMusic()
    // can detect that the same track was playing when the level was retried.
  },

  // ---------------------------------------------------------------------------
  // PER-FRAME UPDATE  (call from GameScene.update(), after checkCollisions())
  // ---------------------------------------------------------------------------

  /**
   * Synchronise audio state with game state every frame.
   *
   * MUST be called AFTER CollisionSystem.check() so that ctx.isGameOver and
   * ctx._cachedConflictCount already reflect the current frame.
   *
   * Three transitions handled:
   *
   *   isGameOver just became true:
   *     → stop predict loop, play RA one-shot, return early
   *
   *   _cachedConflictCount went from 0 → >0 (first pair entered warning zone):
   *     → start predict loop
   *
   *   _cachedConflictCount went from >0 → 0 (last pair left warning zone):
   *     → stop predict loop
   */
  update(ctx: AudioContext): void {
    // ── RA — fatal collision ──────────────────────────────────────────────────
    if (ctx.isGameOver && !_raFired) {
      _raFired = true;
      AudioSystem._stopPredictLoop(ctx); // hazard is over, loop must stop
      AudioSystem._playRa(ctx);
      return;
    }

    if (ctx.isGameOver) return;

    // ── Predict loop — 1:1 with _cachedConflictCount ─────────────────────────
    const warningActive = ctx._cachedConflictCount > 0;

    if (warningActive && !_predictPlaying) {
      AudioSystem._startPredictLoop(ctx);
    } else if (!warningActive && _predictPlaying) {
      AudioSystem._stopPredictLoop(ctx);
    }
  },

  // ---------------------------------------------------------------------------
  // PRIVATE SOUND HELPERS  (prefixed _ by convention)
  // ---------------------------------------------------------------------------

  /**
   * Start the predict loop.
   *
   * Uses sound.add() + play() rather than the fire-and-forget sound.play() so
   * that _stopPredictLoop() can retrieve and stop the same instance later via
   * sound.get(PREDICT_KEY).
   *
   * Any stale instance (e.g. from a previous partial cycle) is destroyed first
   * to avoid multiple overlapping loops.
   */
  _startPredictLoop(ctx: AudioContext): void {
    if (!soundExists(ctx.sound, PREDICT_KEY)) {
      // File not yet placed — degrade silently
      return;
    }

    // Destroy any stale instance before creating a fresh one
    const stale = ctx.sound.get(PREDICT_KEY);
    if (stale) {
      stale.stop();
      stale.destroy();
    }

    const loop = ctx.sound.add(PREDICT_KEY, {
      loop: true,
      volume: effectiveSfxVol(),
    });
    loop.play();
    _predictPlaying = true;

    console.log(`🟡 AudioSystem: predict loop START` + ` (conflicts: ${ctx._cachedConflictCount})`);
  },

  /**
   * Stop the predict loop.
   *
   * Called when all warning pairs clear, when a collision fires (RA takes
   * over), or on scene shutdown.  Safe to call when the loop is not playing.
   */
  _stopPredictLoop(ctx: AudioContext): void {
    if (!_predictPlaying) return;

    const loop = ctx.sound.get(PREDICT_KEY);
    if (loop) {
      loop.stop();
      loop.destroy();
    }
    _predictPlaying = false;

    console.log('🔇 AudioSystem: predict loop STOP');
  },

  /** Play the one-shot RA fatal-collision sound and stop the music track. */
  _playRa(ctx: AudioContext): void {
    // Stop music immediately — collision is abrupt, a fade would feel wrong.
    if (_currentMusicKey && soundManagerAlive(ctx.sound)) {
      const music = ctx.sound.get(_currentMusicKey);
      if (music) {
        music.stop();
        music.destroy();
      }
      _currentMusicKey = null;
    }
    if (!soundExists(ctx.sound, 'sfx-collision')) return;
    ctx.sound.play('sfx-collision', { volume: effectiveSfxVol() });
    console.log('💥 AudioSystem: RA collision sound');
  },

  // ---------------------------------------------------------------------------
  // SETTINGS PREVIEW
  // ---------------------------------------------------------------------------

  /**
   * Play a short preview sound so the user can hear the effect of a volume
   * change immediately.  Called from useAudioPreview (debounced ~300 ms).
   *
   * effectiveVolume is computed by the caller from the store so this method
   * never needs to read _vol — it works correctly even when AudioSystem.init()
   * has not been called (i.e. on the settings screen before any game starts).
   *
   * category:
   *   'sfx'    — plays beap.mp3 at effectiveVolume
   *   'music'  — updates the live music track volume, or plays success.wav
   *   'master' — plays beap.mp3 at effectiveVolume
   */
  playPreview(category: 'sfx' | 'music' | 'master', effectiveVolume: number): void {
    if (effectiveVolume <= 0) return;

    // If Phaser is running use its sound manager (avoids a second AudioContext)
    if (_soundMgr && soundManagerAlive(_soundMgr)) {
      if (category === 'music') {
        // If a track is playing just update its volume live — change is instant
        if (_currentMusicKey && soundExists(_soundMgr, _currentMusicKey)) {
          const music = _soundMgr.get(_currentMusicKey);
          if (music) {
            (music as Phaser.Sound.WebAudioSound | Phaser.Sound.HTML5AudioSound).setVolume(
              effectiveVolume
            );
            return;
          }
        }
      } else {
        if (soundExists(_soundMgr, BEAP_KEY)) {
          _soundMgr.play(BEAP_KEY, { volume: effectiveVolume });
          return;
        }
      }
    }

    // ── Native Web Audio fallback (settings screen, no game running) ────────
    const file = category === 'music' ? 'sounds/success.wav' : 'sounds/beap.mp3';
    AudioSystem._playViaWebAudio(file, effectiveVolume);
  },

  /**
   * Decode and play a sound file directly through the Web Audio API.
   * Creates a fresh AudioContext per call (fire-and-forget, short clips only).
   * Internal helper — not part of the public API.
   */
  _playViaWebAudio(filePath: string, volume: number): void {
    try {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;

      const ctx = new AudioContextClass();
      const gain = ctx.createGain();
      gain.gain.value = Math.max(0, Math.min(1, volume));
      gain.connect(ctx.destination);

      fetch(filePath)
        .then((r) => r.arrayBuffer())
        .then((buf) => ctx.decodeAudioData(buf))
        .then((decoded) => {
          const src = ctx.createBufferSource();
          src.buffer = decoded;
          src.connect(gain);
          src.start(0);
          // Close context shortly after the clip ends to free resources
          src.onended = () => {
            ctx.close();
          };
        })
        .catch(() => {
          ctx.close();
        });
    } catch {
      // AudioContext blocked or unavailable — ignore silently
    }
  },

  // ---------------------------------------------------------------------------
  // PRIVATE ACTION SOUND HELPERS
  // Triggered by gameEventBus listeners registered in init() — no ctx needed.
  // ---------------------------------------------------------------------------

  /** Play the beap sound — fires on plane:landed and plane:waypoint-passed. */
  _playBeap(): void {
    if (!_soundMgr || !soundManagerAlive(_soundMgr)) return;
    if (!soundExists(_soundMgr, BEAP_KEY)) return;
    _soundMgr.play(BEAP_KEY, { volume: effectiveSfxVol() });
    console.log('✅ AudioSystem: beap');
  },

  /** Play the success sound — fires on plane:attached. */
  _playSuccess(): void {
    if (!_soundMgr || !soundManagerAlive(_soundMgr)) return;
    if (!soundExists(_soundMgr, SUCCESS_KEY)) return;
    _soundMgr.play(SUCCESS_KEY, { volume: effectiveSfxVol() });
    console.log('🎯 AudioSystem: success');
  },
};
