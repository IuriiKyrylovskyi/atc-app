/**
 * packages/app/src/composables/useSessionGuard.ts
 *
 * Wires the single-active-device play session into the app:
 *   - claims the session before gameplay starts
 *   - keeps it alive while the app is in the foreground
 *   - releases it when the app is backgrounded
 *   - reports the loss of a session so the player is bounced to /waiting
 *
 * Free users are never gated: they have no account row, nothing to synchronise
 * across devices, and gating them would only add a failure mode.
 */

import { ref, readonly } from 'vue';
import { Capacitor } from '@capacitor/core';
import { useMonetizationStore } from '@/stores/monetization';
import { playSessionService } from '@/services/playSession';

export type SessionState = 'unknown' | 'allowed' | 'blocked';

const state = ref<SessionState>('unknown');
const blockedUntil = ref<number | null>(null);
const lastError = ref<string | null>(null);

let listenersAttached = false;

/** Drop the local session when the app is backgrounded / closed. */
function releaseSession(): void {
  if (state.value === 'allowed') {
    playSessionService.stopHeartbeat(true);
    state.value = 'unknown';
  }
}

/**
 * Claim (or refresh) the session for the current device.
 *
 * Returns true when the device may play. On false the caller is expected to
 * route to /waiting. A backend failure is treated as "cannot play": showing the
 * waiting screen is recoverable, letting two devices write the same progress is
 * not.
 */
export async function ensurePlayAllowed(): Promise<boolean> {
  const monetization = useMonetizationStore();

  if (!monetization.isPremium) {
    state.value = 'allowed';
    return true;
  }

  if (!monetization.userId) {
    // Not signed in yet — nothing to claim against. The router guard waits for
    // init() to finish before calling us, so this is a transient state.
    state.value = 'unknown';
    return false;
  }

  const result = await playSessionService.checkAndClaim(monetization.userId);

  if (result.canPlay) {
    state.value = 'allowed';
    blockedUntil.value = null;
    lastError.value = null;
    playSessionService.startHeartbeat(monetization.userId, true);
    return true;
  }

  state.value = 'blocked';
  blockedUntil.value = result.sessionExpiresAt
    ? new Date(result.sessionExpiresAt).getTime()
    : Date.now() + playSessionService.ttlMs;
  return false;
}

/**
 * Attach the Capacitor appStateChange listener (foreground → re-claim,
 * background → release). Safe to call more than once.
 */
async function attachLifecycle(): Promise<void> {
  if (listenersAttached) return;
  listenersAttached = true;

  playSessionService.setLostHandler(() => {
    state.value = 'blocked';
    blockedUntil.value = Date.now() + playSessionService.ttlMs;
  });

  try {
    const { App } = await import('@capacitor/app');
    App.addListener('appStateChange', (appState: { isActive: boolean }) => {
      if (appState.isActive) {
        // Coming back to the foreground: our session was released on blur, so
        // claim it again. If another device grabbed it in the meantime the
        // guard state flips to 'blocked' and the UI routes to /waiting.
        void ensurePlayAllowed();
      } else {
        releaseSession();
      }
    });
  } catch {
    // @capacitor/app not available (web / electron) — the web equivalent is the
    // document visibility API.
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          void ensurePlayAllowed();
        } else {
          releaseSession();
        }
      });
    }
  }
}

/** Reset the guard, e.g. after a local logout or account deletion. */
function reset(): void {
  playSessionService.stopHeartbeat(false);
  state.value = 'unknown';
  blockedUntil.value = null;
  lastError.value = null;
}

export function useSessionGuard() {
  // Touch so the module-level refs are registered with the current app instance
  // even when the composable is first called from a lazy route component.
  const isNative = Capacitor.isNativePlatform();

  return {
    state: readonly(state),
    blockedUntil: readonly(blockedUntil),
    lastError: readonly(lastError),
    isBlocked: () => state.value === 'blocked',
    isNative,
    ensurePlayAllowed,
    releaseSession,
    attachLifecycle,
    reset,
  };
}
