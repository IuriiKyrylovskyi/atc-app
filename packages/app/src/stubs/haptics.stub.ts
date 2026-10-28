/**
 * packages/app/src/stubs/haptics.stub.ts
 *
 * Empty stub for @capacitor/haptics on web/Electron.
 * Vite aliases the real package to this file when bundling for non-mobile.
 * The real package is only installed in @atc-app/mobile.
 *
 * useHaptics() checks the platform and only calls these on native,
 * so this stub just satisfies the bundler's import resolution.
 */

export const ImpactStyle = {
  Light: 'LIGHT',
  Medium: 'MEDIUM',
  Heavy: 'HEAVY',
};

export const Haptics = {
  impact: () => Promise.resolve(),
  vibrate: () => Promise.resolve(),
  selectionStart: () => Promise.resolve(),
  selectionChanged: () => Promise.resolve(),
  selectionEnd: () => Promise.resolve(),
};
