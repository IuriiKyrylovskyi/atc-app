/**
 * packages/app/src/composables/useNetwork.ts
 *
 * WHY THIS EXISTS
 * ----------------
 * The game must never block launch or level-start on a network
 * that may not be there. A Supabase/Storage fetch awaited during
 * boot used to hang the splash screen until its hard timeout, and
 * on a slow link a single background download froze the whole
 * level (see utils/fetchWithTimeout.ts for the freeze half of
 * that story). That freeze / launch-block failure mode is what
 * this resilience plan removes.
 *
 * This composable is the single source of truth for
 * connectivity: one module-level monitor, shared by every
 * caller, that
 *   - reflects platform connectivity events immediately
 *     (@capacitor/network `networkStatusChange` on native,
 *     window `online` / `offline` on web/Electron),
 *   - proves real reachability with a HEAD probe every 15s, so
 *     captive portals and "connected but dead" links are caught
 *     within 15s,
 *   - classifies the link as online | slow | offline so the game
 *     can defer heavy downloads on a slow link instead of
 *     freezing, and
 *   - exposes a countdown so the UI can show when the next
 *     re-check happens, plus retryNow() for an immediate probe.
 *
 * Every plugin call is try/catch-guarded: a missing or
 * mispackaged @capacitor/network plugin degrades to probe-only
 * monitoring instead of throwing out of the composable.
 */

import { ref } from 'vue';
import { Capacitor } from '@capacitor/core';
import { Network } from '@capacitor/network';
import { probeReachable } from '@/utils/fetchWithTimeout';
import { ENV } from '@/config/env';

export type NetworkQuality = 'online' | 'slow' | 'offline';

/** Subset of @capacitor/network's NetworkStatus payload used here. */
interface NetworkStatus {
  connected: boolean;
  connectionType: string;
}

/** Re-probe cadence, in seconds. */
const CHECK_INTERVAL_SECONDS = 15;

/** Hard cap for a single reachability probe. */
const PROBE_TIMEOUT_MS = 8000;

/** A probe that succeeds but takes longer than this is 'slow'. */
const SLOW_THRESHOLD_MS = 2000;

/**
 * Probe target — the backend the game actually depends on, so the
 * probe measures the link that matters. Falls back to a well-known
 * stable host when no backend URL is configured.
 */
const PROBE_URL = ENV.VITE_SUPABASE_URL
  ? `${String(ENV.VITE_SUPABASE_URL).replace(/\/$/, '')}/rest/v1/`
  : 'https://www.google.com';

// Module-level state: every useNetwork() call shares these refs,
// so the whole app reads one source of truth instead of each
// component wiring its own listeners and probes.
const isOnline = ref(typeof navigator !== 'undefined' ? navigator.onLine : true);
const quality = ref<NetworkQuality>(isOnline.value ? 'online' : 'offline');
const secondsUntilNextCheck = ref(CHECK_INTERVAL_SECONDS);

let intervalId: ReturnType<typeof setInterval> | null = null;
let started = false;

/** Native plugin listener handles, removed again on stop. */
const nativeHandles: Array<{ remove: () => Promise<void> }> = [];

/** Web/Electron window listeners, removed again on stop. */
const windowListeners: Array<{ type: string; listener: () => void }> = [];

/** Serial of the in-flight probe — a superseded probe never writes state. */
let probeSerial = 0;

function markOffline(): void {
  isOnline.value = false;
  quality.value = 'offline';
}

function markOnline(): void {
  isOnline.value = true;
  quality.value = 'online';
}

/**
 * HEAD-probe the stable URL and fold the result into state.
 *
 * false -> offline (link down or probe timed out).
 * true  -> online, or 'slow' when the probe exceeded
 *          SLOW_THRESHOLD_MS — this is how degradation is
 *          detected while the platform still reports the radio
 *          as connected.
 *
 * probeReachable resolves false on every error, so this never
 * throws.
 */
async function probe(): Promise<void> {
  const serial = ++probeSerial;
  const startedAt = Date.now();
  const reachable = await probeReachable(PROBE_URL, PROBE_TIMEOUT_MS);
  if (serial !== probeSerial) return;

  if (!reachable) {
    markOffline();
    return;
  }
  isOnline.value = true;
  quality.value = Date.now() - startedAt >= SLOW_THRESHOLD_MS ? 'slow' : 'online';
}

/** One second of the 15s loop: count down, probe when the counter hits 0. */
function tick(): void {
  secondsUntilNextCheck.value -= 1;
  if (secondsUntilNextCheck.value <= 0) {
    secondsUntilNextCheck.value = CHECK_INTERVAL_SECONDS;
    void probe();
  }
}

function onNativeStatusChange(status: NetworkStatus): void {
  // Platform event: update immediately; the silent 15s probe
  // refines 'online' -> 'slow' afterwards.
  if (status.connected) {
    markOnline();
  } else {
    markOffline();
  }
}

function onWindowOnline(): void {
  markOnline();
}

function onWindowOffline(): void {
  markOffline();
}

/**
 * Initial native status + native listener. Both calls are guarded
 * so a missing plugin never throws out of the composable.
 */
async function startNativeMonitoring(): Promise<void> {
  try {
    const status = await Network.getNetworkStatus();
    if (started) {
      onNativeStatusChange(status);
    }
  } catch {
    // Plugin missing (mispackaged build) — degrade to probe-only.
  }

  try {
    const handle = await Network.addListener('networkStatusChange', onNativeStatusChange);
    if (started) {
      nativeHandles.push(handle);
    } else {
      // Stopped while registration was in flight — undo it.
      try {
        await handle.remove();
      } catch {
        // Best-effort removal.
      }
    }
  } catch {
    // Plugin missing — the 15s probe loop keeps state accurate.
  }
}

function startWebMonitoring(): void {
  if (typeof window === 'undefined') return;
  // Re-seed: connectivity may have changed between module import
  // and start.
  isOnline.value = navigator.onLine;
  quality.value = navigator.onLine ? 'online' : 'offline';
  window.addEventListener('online', onWindowOnline);
  window.addEventListener('offline', onWindowOffline);
  windowListeners.push(
    { type: 'online', listener: onWindowOnline },
    { type: 'offline', listener: onWindowOffline }
  );
}

/** Native teardown. Every call is guarded so a missing plugin never throws. */
async function stopNativeMonitoring(): Promise<void> {
  for (const handle of nativeHandles.splice(0)) {
    try {
      await handle.remove();
    } catch {
      // Best-effort removal.
    }
  }
  try {
    await Network.removeAllListeners();
  } catch {
    // Plugin missing — nothing to remove.
  }
}

/**
 * Start the shared connectivity monitor. Idempotent: calling it
 * from several components (or twice across hot reloads) wires
 * exactly one listener set and one interval.
 */
export function startNetworkMonitoring(): void {
  if (started) return;
  started = true;

  if (Capacitor.isNativePlatform()) {
    void startNativeMonitoring();
  } else {
    startWebMonitoring();
  }

  intervalId = setInterval(tick, 1000);

  // Fire an immediate reachability probe so the first render reflects a
  // real HEAD check, not the platform's initial guess. The native path
  // already calls Network.getNetworkStatus() above; this additionally
  // proves the link is actually usable (captive portals report
  // connected=true while the backend is unreachable).
  void probe();
}

/**
 * Stop the monitor: clears the countdown interval and removes
 * every listener. Safe to call when monitoring was never
 * started.
 */
export function stopNetworkMonitoring(): void {
  if (!started) return;
  started = false;

  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }

  if (Capacitor.isNativePlatform()) {
    void stopNativeMonitoring();
  }

  if (typeof window !== 'undefined') {
    for (const { type, listener } of windowListeners.splice(0)) {
      window.removeEventListener(type, listener);
    }
  }
}

/**
 * Re-check now: restart the 15s countdown and fire an immediate
 * probe (e.g. from a "retry" button or after a failed sync).
 */
export function retryNow(): void {
  secondsUntilNextCheck.value = CHECK_INTERVAL_SECONDS;
  void probe();
}

export function useNetwork() {
  return {
    isOnline,
    quality,
    secondsUntilNextCheck,
    startNetworkMonitoring,
    stopNetworkMonitoring,
    retryNow,
  };
}
