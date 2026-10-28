/**
 * packages/app/src/utils/platform.ts
 *
 * Runtime detection for the parts of the app that behave differently per
 * platform. `Capacitor.getPlatform()` is not enough on its own: inside
 * Electron it returns 'web', because Electron is just a Chromium renderer
 * with a Capacitor-free page. The Electron preload script injects
 * `window.electronAPI` before any app code runs, so that is the reliable
 * discriminator.
 */

import { Capacitor } from '@capacitor/core';

export type AppRuntime = 'electron' | 'android' | 'ios' | 'web';

/**
 * Which runtime is the renderer actually running in.
 *
 * The Electron check MUST come first: `Capacitor.getPlatform()` reports
 * 'web' inside Electron too, and Electron is the one 'web' runtime that can
 * genuinely terminate the app.
 */
export function detectRuntime(): AppRuntime {
  if (typeof window !== 'undefined' && window.electronAPI) return 'electron';

  const platform = Capacitor.getPlatform();
  if (platform === 'android' || platform === 'ios') return platform;

  return 'web';
}

/**
 * True only in a plain browser tab — no Electron shell, no Capacitor shell.
 *
 * A browser tab cannot be closed by script unless the script opened it, so
 * the app offers no EXIT affordance there at all.
 */
export function isPlainWeb(): boolean {
  return detectRuntime() === 'web';
}
