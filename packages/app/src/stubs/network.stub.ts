/**
 * packages/app/src/stubs/network.stub.ts
 *
 * Empty stub for @capacitor/network on web/Electron.
 * Vite aliases the real package to this file when bundling for non-mobile.
 * The real package is only installed in @atc-app/mobile.
 *
 * useNetwork() checks the platform and only calls these on native,
 * so this stub just satisfies the bundler's import resolution.
 */

export const Network = {
  getNetworkStatus: () =>
    Promise.resolve({
      connected: typeof navigator !== 'undefined' ? navigator.onLine : true,
      connectionType: 'unknown',
    }),
  addListener: (_event: string, _fn: unknown) =>
    Promise.resolve({ remove: () => Promise.resolve() }),
  removeAllListeners: () => Promise.resolve(),
};