/**
 * packages/app/src/stubs/status-bar.stub.ts
 *
 * Empty stub for @capacitor/status-bar on web/Electron.
 * Vite aliases the real package to this file when bundling for non-mobile.
 * The real package is only installed in @atc-app/mobile.
 */

export const StatusBar = {
  hide: () => Promise.resolve(),
  show: () => Promise.resolve(),
  setStyle: (_options: { style: string }) => Promise.resolve(),
  setBackgroundColor: (_options: { color: string }) => Promise.resolve(),
  setOverlaysWebView: (_options: { overlay: boolean }) => Promise.resolve(),
  getInfo: () =>
    Promise.resolve({
      visible: true,
      style: 'DEFAULT',
      color: '#000000',
      overlays: false,
    }),
};

export const StatusBarStyle = {
  Default: 'DEFAULT',
  Light: 'LIGHT',
  Dark: 'DARK',
};

export const StatusBarAnimation = {
  None: 'NONE',
  Slide: 'SLIDE',
  Fade: 'FADE',
};