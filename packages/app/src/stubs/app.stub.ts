/**
 * packages/app/src/stubs/app.stub.ts
 *
 * Stub for @capacitor/app on web/Electron.
 * Vite aliases the real package to this file when bundling for non-mobile.
 * The real package is only installed in @atc-app/mobile.
 */

export const App = {
  addListener: (_eventName: string, _callback: Function) =>
    Promise.resolve({ remove: () => Promise.resolve() }),
  removeAllListeners: () => Promise.resolve(),
  /**
   * MUST reject, not resolve.
   *
   * The real plugin is `call.unimplemented()` on iOS and a no-op on web. A
   * silently-resolving stub would leave the user staring at the
   * "Closing ATC-APP…" overlay forever with no way out. Rejecting surfaces
   * the failure in the close flow's error state, where it can be retried or
   * dismissed.
   */
  exitApp: () => Promise.reject(new Error('App.exitApp() is not available on web/Electron.')),
  getInfo: () =>
    Promise.resolve({
      name: 'ATC-APP',
      id: 'com.atcapp.app',
      build: '0.0.76',
      version: '0.0.76',
    }),
  getLaunchUrl: () => Promise.resolve({ url: '' }),
  minimizeApp: () => Promise.resolve(),
  openUrl: (options: { url: string }) => {
    window.open(options.url, '_blank', '_noopener');
    return Promise.resolve();
  },
};

export const AppState = {
  isActive: true,
};

export const AppRestoredResult = {
  restored: false,
};

export const BackButtonListener = {
  remove: () => Promise.resolve(),
};
