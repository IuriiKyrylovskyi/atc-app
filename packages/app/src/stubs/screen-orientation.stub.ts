/**
 * packages/app/src/stubs/screen-orientation.stub.ts
 *
 * Empty stub for @capacitor/screen-orientation on web/Electron.
 * Vite aliases the real package to this file when bundling for non-mobile.
 * The real package is only installed in @atc-app/mobile.
 */

export const ScreenOrientation = {
  lock: (_options: { orientation: string }) => Promise.resolve(),
  unlock: () => Promise.resolve(),
  getOrientation: () =>
    Promise.resolve({
      type: 'portrait',
    }),
  addListener: (_eventName: string, _callback: Function) =>
    Promise.resolve({ remove: () => Promise.resolve() }),
  removeAllListeners: () => Promise.resolve(),
};

export const OrientationType = {
  Portrait: 'portrait',
  Landscape: 'landscape',
  PortraitPrimary: 'portrait-primary',
  PortraitSecondary: 'portrait-secondary',
  LandscapePrimary: 'landscape-primary',
  LandscapeSecondary: 'landscape-secondary',
};