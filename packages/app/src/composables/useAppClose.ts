/**
 * packages/app/src/composables/useAppClose.ts
 *
 * The single owner of "close the app".
 *
 * Both EXIT affordances route through here:
 *   - the red EXIT strip   → `StripPage.vue` → `exitPlay` → `requestClose()`
 *   - the splash-screen ✕  → `IntroScreen.vue` → `quitApp` → `requestClose()`
 *
 * Per-platform behaviour (verified against the Capacitor 7.1.0 sources):
 *   - Android  → `App.exitApp()` → `activity.finish()`  → the app really quits
 *   - Electron → `window.electronAPI.closeApp()` → `mainWindow.close()` + `app.quit()`
 *   - iOS      → `App.exitApp()` is `call.unimplemented()` in
 *                `AppPlugin.swift:78-79`; Apple forbids programmatic
 *                termination (App Store Guideline 2.2.5), so the app shows a
 *                goodbye overlay and the user swipes the app away.
 *   - Web      → a browser tab cannot be closed by script, so the app offers
 *                no EXIT affordance there at all (see `isPlainWeb`).
 *
 * The close is a multi-step operation (record the run, flush the scores over
 * the network, release the play session, terminate), so the whole thing runs
 * behind a blocking overlay that swallows every user action.
 */

import { ref } from 'vue';
import { useGameStore } from '@/stores/game';
import { useUserScoresStore } from '@/stores/userScores';
import { useSessionGuard } from '@/composables/useSessionGuard';
import { clearUnloadGuard } from '@/composables/useUnloadGuard';
import { getLevelByNumber, getLevelById } from '@/game/config/levels.config';
import { GameCore } from '@/game/core/GameCore';
import { NetworkTimeoutError } from '@/utils/fetchWithTimeout';
import { detectRuntime, type AppRuntime } from '@/utils/platform';

export type AppClosePhase = 'idle' | 'confirm' | 'closing' | 'closed' | 'error';

// ─── Shared state ───────────────────────────────────────────────────────────
// The overlay is rendered ONCE, globally, by App.vue. Every call site shares
// this state, so it must NOT live inside the composable instance — a
// per-instance ref would give each call site its own copy. Same pattern as
// `useDevice.ts`.
const phase = ref<AppClosePhase>('idle');
const statusText = ref('');
const errorText = ref<string | null>(null);
/**
 * The goodbye screen is the "the app cannot close itself" fallback (iOS
 * cannot terminate programmatically). On Electron the app genuinely quits,
 * so the `closed` phase is normally unreachable there — but the hint is
 * still resolved per runtime so a stray reach shows the right instruction
 * instead of an iOS "swipe up" on a Mac desktop build.
 */
function platformGoodbyeHint(runtime: AppRuntime): string {
  switch (runtime) {
    case 'ios':
      return 'Swipe up from the bottom to close the app.';
    case 'android':
      return 'Swipe up from the bottom, or press the back button, to close the app.';
    case 'electron':
      return 'Close ATC-APP from the dock or menu bar, or press Cmd+Q.';
    default:
      return 'Close the browser tab to leave ATC-APP.';
  }
}

const goodbyeHint = ref(platformGoodbyeHint(detectRuntime()));

/**
 * Score-flush cap. Kept at 15 s on purpose: the `userScores` store is
 * memory-only (no localStorage persistence), so a flush that never completes
 * means the run's best plane count is lost for good. A hung EXIT is worse
 * than a slow one.
 */
const FLUSH_TIMEOUT_MS = 15000;

/**
 * How long a terminate call may take before we declare it failed. The real
 * close destroys the JS context, so the watchdog only ever fires when the
 * app is STILL ALIVE — i.e. the close genuinely did not happen (a missing
 * Electron bridge, or the `@capacitor/app` stub accidentally bundled into an
 * Android build because `CAPACITOR_PLATFORM` was not set).
 */
const TERMINATE_WATCHDOG_MS = 2500;

export function useAppClose() {
  const runtime: AppRuntime = detectRuntime();
  const canTerminate = runtime === 'electron' || runtime === 'android';
  const isPlainWeb = runtime === 'web';

  const gameStore = useGameStore();
  const scoresStore = useUserScoresStore();
  const sessionGuard = useSessionGuard();

  // ── Score persistence ─────────────────────────────────────────────────────

  async function flushScoresSafely(): Promise<void> {
    try {
      await Promise.race([
        scoresStore.flush(),
        // 15s: flush() now races its own upsert at 10s and sleeps 1s+2s
        // between retries, so a 3s cap here always fired first and
        // aborted the backoff before it could do a single retry.
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new NetworkTimeoutError(`Score flush on exit timed out after ${FLUSH_TIMEOUT_MS}ms`)
              ),
            FLUSH_TIMEOUT_MS
          )
        ),
      ]);
    } catch (e) {
      console.warn('Score flush on exit (non-fatal):', e);
    }
  }

  /** Save the plane count of a run that is being abandoned mid-level. */
  function recordRunResult(): void {
    if (!gameStore.isPlaying && !gameStore.isPaused) return;

    const levelId = gameStore.currentLevelId ?? getLevelByNumber(gameStore.currentLevel)?.id;
    const level = levelId ? getLevelById(levelId) : null;
    if (level && gameStore.trainingLevel === null) {
      scoresStore.recordResult(`${level.airportId}:${level.shiftId}`, gameStore.planesLanded);
    }
  }

  // ── Input lock ────────────────────────────────────────────────────────────

  const blockKeys = (e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  /**
   * Freeze the app while the close runs.
   *
   * The overlay blocks pointer/touch input at the DOM level, but the Phaser
   * canvas has its own listeners and the keyboard reaches the game through
   * `window`, so both have to be shut down explicitly.
   */
  function lockInput(): void {
    // Stops the Phaser update loop and the music track — the scene 'pause'
    // event is what AudioSystem listens to.
    GameCore.active?.pause();

    // Phaser's global input capture (pointer + keyboard on the canvas).
    const game = GameCore.active?.getPhaserGame();
    if (game) game.input.enabled = false;

    // Swallow every key at the capture phase so nothing reaches the game.
    window.addEventListener('keydown', blockKeys, true);
    window.addEventListener('keyup', blockKeys, true);
  }

  function unlockInput(): void {
    window.removeEventListener('keydown', blockKeys, true);
    window.removeEventListener('keyup', blockKeys, true);

    const game = GameCore.active?.getPhaserGame();
    if (game) game.input.enabled = true;
  }

  /**
   * Put the player back in control after a failed close. The Phaser scene
   * was paused by `lockInput()` but the store never learned about it, so the
   * store is brought in line: the normal PauseModal reappears and the
   * player can resume, restart or leave.
   */
  function restoreGameAfterFailedClose(): void {
    if (!gameStore.isPlaying) return;
    gameStore.pauseGame();
  }

  // ── Termination ───────────────────────────────────────────────────────────

  /** Rejects if the app is still alive after the watchdog window. */
  function watchdog(): Promise<never> {
    return new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error('ATC-APP could not close itself. Please close it manually.')),
        TERMINATE_WATCHDOG_MS
      )
    );
  }

  async function terminate(): Promise<void> {
    if (runtime === 'electron') {
      if (!window.electronAPI?.closeApp) {
        throw new Error('The Electron bridge is not available.');
      }
      await Promise.race([window.electronAPI.closeApp(), watchdog()]);
      return;
    }

    if (runtime === 'android') {
      // Dynamic import so the web/Electron bundle never pulls the plugin in.
      // On a mobile build the Vite alias points at the REAL package.
      const { App } = await import('@capacitor/app');
      await Promise.race([App.exitApp(), watchdog()]);
      return;
    }

    // iOS — Apple forbids programmatic termination.
    phase.value = 'closed';
  }

  // ── Flow ──────────────────────────────────────────────────────────────────

  async function startClose(): Promise<void> {
    phase.value = 'closing';
    errorText.value = null;
    statusText.value = 'Saving your progress…';
    lockInput();

    try {
      recordRunResult();
      await flushScoresSafely();

      statusText.value = 'Closing ATC-APP…';

      // The device must not keep the play-session claim once the app is
      // gone: `activity.finish()` never fires appStateChange, so without
      // this the user's other device stays locked out for the full TTL.
      sessionGuard.releaseSession();

      // MUST come before terminating — Electron's `mainWindow.close()` runs
      // the renderer's `beforeunload`, and a handler that calls
      // `preventDefault()` cancels the close and pops a native dialog.
      clearUnloadGuard();

      await terminate();
    } catch (e) {
      console.error('[useAppClose] close failed:', e);
      phase.value = 'error';
      errorText.value = e instanceof Error ? e.message : String(e);
      unlockInput();
    }
  }

  /** The user tapped EXIT. */
  async function requestClose(): Promise<void> {
    // Re-entrancy guard: a second tap while closing does nothing.
    if (phase.value !== 'idle') return;

    if (isPlainWeb) {
      // A browser tab cannot be closed by script. The EXIT affordances are
      // hidden on plain web, so this is unreachable in practice — and it must
      // NOT strand the user on an overlay they cannot dismiss.
      console.warn('[useAppClose] close requested on plain web — the tab must be closed manually.');
      return;
    }

    if (gameStore.isPlaying || gameStore.isPaused) {
      phase.value = 'confirm';
      return;
    }

    await startClose();
  }

  /** The user confirmed the in-app "Exit ATC-APP?" modal. */
  async function confirmClose(): Promise<void> {
    if (phase.value !== 'confirm') return;
    await startClose();
  }

  /** The user backed out of the confirm modal, or dismissed the error. */
  function cancelClose(): void {
    // A close in flight cannot be cancelled.
    if (phase.value === 'closing') return;

    // Only a FAILED close leaves the game frozen by `lockInput()`. Backing
    // out of the confirmation must leave the running level exactly as it was.
    const closeFailed = phase.value === 'error';

    phase.value = 'idle';
    errorText.value = null;
    statusText.value = '';

    if (closeFailed) restoreGameAfterFailedClose();
  }

  /** The user asked to try the close again after a failure. */
  async function retryClose(): Promise<void> {
    if (phase.value !== 'error') return;
    await startClose();
  }

  return {
    // Shared state — the overlay in App.vue binds to these.
    phase,
    statusText,
    errorText,
    goodbyeHint,

    // Platform facts.
    canTerminate,
    isPlainWeb,

    // Actions.
    requestClose,
    confirmClose,
    cancelClose,
    retryClose,
  };
}
