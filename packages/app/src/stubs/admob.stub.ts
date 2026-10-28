/**
 * packages/app/src/stubs/admob.stub.ts
 *
 * Empty stub for @capacitor-community/admob on web/Electron.
 * Vite aliases the real package to this file for non-mobile builds.
 * AdMobService.isMobile() guards every method so this is never called.
 */

export const AdMob = {
  initialize: () => Promise.resolve(),
  prepareInterstitial: () => Promise.resolve(),
  showInterstitial: () => Promise.resolve(),
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  addListener: (_event: string, _fn: unknown) =>
    Promise.resolve({ remove: () => Promise.resolve() }),
  removeAllListeners: () => Promise.resolve(),
  // ATT — only called on iOS, no-op on web/Electron
  requestTrackingAuthorization: () => Promise.resolve({ status: 'notDetermined' }),
};

export const InterstitialAdPluginEvents = {
  Loaded: 'interstitialAdLoaded',
  FailedToLoad: 'interstitialAdFailedToLoad',
  Showed: 'interstitialAdShowed',
  FailedToShow: 'interstitialAdFailedToShow',
  Dismissed: 'interstitialAdDismissed',
};
