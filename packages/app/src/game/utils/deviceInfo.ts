/**
 * deviceInfo.ts
 *
 * Single source of truth for device/screen information shared between the
 * native main process (Capacitor Android, Electron) and the renderer.
 *
 * FLOW
 * ────
 * 1. The native layer populates `window.__DEVICE_INFO__` before the game
 *    script runs (see capacitor/MainActivityPlugin.kt or electron/preload.ts).
 * 2. All renderer code calls `getDeviceInfo()` — never reads window, screen,
 *    or navigator directly.
 * 3. If no native info is available (plain browser), a best-effort fallback
 *    using `screen.width/height` is used.
 */

export interface DeviceInfo {
  /** 'android' | 'ios' | 'electron' | 'web' */
  platform: 'android' | 'ios' | 'electron' | 'web';

  /** Physical screen width in device-independent pixels (landscape axis) */
  screenW: number;

  /** Physical screen height in device-independent pixels (portrait axis) */
  screenH: number;

  /** Device pixel ratio */
  dpr: number;

  /** Resolved aspect-ratio folder name, e.g. '20x9', '16x9' */
  aspectRatioKey: string;
}

/** Injected by the native main process — may not exist in plain browser. */
declare global {
  interface Window {
    __DEVICE_INFO__?: DeviceInfo;
  }
}

// ─── Aspect ratio lookup ────────────────────────────────────────────────────

/** All supported background folder names, widest first. */
const RATIO_BUCKETS: Array<{ key: string; value: number }> = [
  { key: '21x9', value: 21 / 9 },
  { key: '20x9', value: 20 / 9 },
  { key: '19_5x9', value: 19.5 / 9 },
  { key: '19x9', value: 19 / 9 },
  { key: '18_5x9', value: 18.5 / 9 },
  { key: '18x9', value: 18 / 9 },
  { key: '16x9', value: 16 / 9 },
  { key: '16x10', value: 16 / 10 },
  { key: '3x2', value: 3 / 2 },
  { key: '4x3', value: 4 / 3 },
];

const RATIO_TOLERANCE = 0.08;

export function resolveAspectRatioKey(landscapeW: number, landscapeH: number): string {
  const r = landscapeW / landscapeH;
  const match = RATIO_BUCKETS.find((b) => Math.abs(r - b.value) <= RATIO_TOLERANCE);
  if (!match) {
    console.warn(
      `[DeviceInfo] Unknown ratio ${r.toFixed(3)} (${landscapeW}×${landscapeH}), using 16x9`
    );
  }
  return match?.key ?? '16x9';
}

// ─── Main accessor ──────────────────────────────────────────────────────────

let _cached: DeviceInfo | null = null;

/**
 * Returns the device info object.
 *
 * Priority:
 *  1. `window.__DEVICE_INFO__` injected by native main process — most accurate.
 *  2. `screen.width/height` fallback — reliable in browsers and Capacitor WebView.
 *
 * The result is cached so calling this repeatedly is cheap.
 */
export function getDeviceInfo(): DeviceInfo {
  if (_cached) return _cached;

  if (window.__DEVICE_INFO__) {
    console.log('[DeviceInfo] Using native-injected device info:', window.__DEVICE_INFO__);
    _cached = window.__DEVICE_INFO__;
    return _cached;
  }

  // Fallback: derive from screen (reliable at any time, unlike window.innerWidth)
  const landscapeW = Math.max(screen.width, screen.height);
  const landscapeH = Math.min(screen.width, screen.height);
  const dpr = window.devicePixelRatio || 1;
  const aspectRatioKey = resolveAspectRatioKey(landscapeW, landscapeH);

  const platform = /android/i.test(navigator.userAgent)
    ? 'android'
    : /iphone|ipad|ipod/i.test(navigator.userAgent)
    ? 'ios'
    : typeof (window as { electron?: unknown }).electron !== 'undefined' ||
      navigator.userAgent.toLowerCase().includes('electron')
    ? 'electron'
    : 'web';

  _cached = { platform, screenW: landscapeW, screenH: landscapeH, dpr, aspectRatioKey };
  console.log('[DeviceInfo] Derived from screen:', _cached);
  return _cached;
}

/** Call this if the screen rotates or the WebView is resized. */
export function resetDeviceInfoCache(): void {
  if (window.__DEVICE_INFO__) return; // native value is authoritative, never reset
  _cached = null;
}
