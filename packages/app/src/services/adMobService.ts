/**
 * packages/app/src/services/adMobService.ts
 *
 * Interstitial ads for free users only.
 *
 * Design decisions:
 *  - Dynamic import with /* @vite-ignore * / — @capacitor-community/admob
 *    is installed in @atc-app/mobile only, not @atc-app/app.
 *    Vite alias maps it to src/stubs/admob.stub.ts on web/Electron.
 *  - isPremium guard — premium users never see ads
 *  - Pre-load pattern — ad loads in background after level starts,
 *    shows instantly when level ends (no delay felt by the user)
 *  - Fail-silent — any ad error is caught and logged, never crashes game
 *  - Test IDs — Google's official test ad unit IDs used in DEV mode
 *
 * Usage:
 *   // After level starts (pre-load in background)
 *   AdMobService.preload(isPremium);
 *
 *   // When level ends (show if loaded and user is free)
 *   await AdMobService.showIfReady(isPremium);
 */
import { Capacitor } from '@capacitor/core';
import { ENV } from '@/config/env';

// ─── Ad Unit IDs ─────────────────────────────────────────────────────────────
// Set real IDs in packages/app/.env.local once you have an AdMob account.
// In DEV mode, Google's official test IDs are used automatically.

const TEST_IDS = {
  ios: 'ca-app-pub-3940256099942544/4411468910', // Google test interstitial iOS
  android: 'ca-app-pub-3940256099942544/1033173712', // Google test interstitial Android
};

function getAdUnitId(): string {
  const platform = Capacitor.getPlatform();

  if (import.meta.env.DEV) {
    return platform === 'ios' ? TEST_IDS.ios : TEST_IDS.android;
  }

  // Use platform-specific ad unit IDs set in packages/app/.env.local
  if (platform === 'ios') {
    return (ENV.VITE_ADMOB_INTERSTITIAL_ID_IOS as string) ?? '';
  }
  return (ENV.VITE_ADMOB_INTERSTITIAL_ID_ANDROID as string) ?? '';
}

// ─── Platform guard ───────────────────────────────────────────────────────────
function isMobile(): boolean {
  const p = Capacitor.getPlatform();
  return p === 'ios' || p === 'android';
}

// ─── Lazy AdMob loader ────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _admob: any = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getAdMob(): Promise<any> {
  if (_admob) return _admob;
  _admob = await import(/* @vite-ignore */ '@capacitor-community/admob');
  return _admob;
}

// ─── State ────────────────────────────────────────────────────────────────────
let _initialized = false;
let _isLoaded = false;
let _isLoading = false;

// ─── Service ──────────────────────────────────────────────────────────────────

export class AdMobService {
  /**
   * Initialize AdMob once on app boot.
   * Call this from monetization.ts init() — after auth, before first level.
   *
   * On iOS: requests ATT (App Tracking Transparency) permission.
   * On Android: shows GDPR consent form if required.
   * On web/Electron: no-op.
   */
  /**
   * Phase 1 — called on app boot from monetization.init().
   * Initializes the AdMob SDK WITHOUT requesting ATT so we don't cold-prompt
   * the user before they've interacted with the app.
   * Apple will reject apps that show ATT immediately on launch.
   */
  static async initialize(): Promise<void> {
    if (!isMobile() || _initialized) return;

    try {
      const { AdMob } = await getAdMob();

      await AdMob.initialize({
        // ATT is requested separately in requestTrackingTransparency() below,
        // triggered by the user tapping "Start Game" — not on cold launch.
        requestTrackingAuthorization: false,

        testingDevices: [],
        initializeForTesting: import.meta.env.DEV,
      });

      _initialized = true;
      console.log('✅ AdMob initialized (ATT deferred)');
    } catch (err) {
      console.warn('⚠️ AdMob initialize failed (non-fatal):', err);
    }
  }

  /**
   * Phase 2 — request App Tracking Transparency permission on iOS.
   *
   * Call this at a natural moment AFTER the user has interacted with the app
   * (e.g. after tapping "Start Game" on IntroScreen).
   *
   * Apple guidelines:
   *  - Must NOT be shown on cold launch
   *  - Must NOT be shown inside another alert
   *  - NSUserTrackingUsageDescription must be set in Info.plist
   *
   * On Android / web: no-op (no ATT concept).
   * Safe to call multiple times — skips if already requested this session.
   */
  static async requestTrackingTransparency(): Promise<void> {
    if (!_initialized) await AdMobService.initialize();

    const { Capacitor } = await import('@capacitor/core');
    if (Capacitor.getPlatform() !== 'ios') return;

    try {
      const { AdMob } = await getAdMob();
      // Use the dedicated ATT API instead of re-calling initialize().
      // Calling initialize() twice is unreliable — the SDK ignores or merges
      // the second call unpredictably. requestTrackingAuthorization() is the
      // correct single-purpose API: shows the system prompt once, skips
      // silently on subsequent calls or if the user has already answered.
      const result = await AdMob.requestTrackingAuthorization();
      console.log('✅ ATT prompt result:', result?.status ?? 'unknown');
    } catch (err) {
      console.warn('⚠️ ATT request failed (non-fatal):', err);
    }
  }

  /**
   * Pre-load an interstitial ad in the background.
   * Call this when a level starts so the ad is ready when the level ends.
   * Skips silently if user is premium or already loading.
   */
  static async preload(isPremium: boolean): Promise<void> {
    if (!isMobile() || isPremium || _isLoading || _isLoaded) return;
    if (!_initialized) await AdMobService.initialize();

    const adId = getAdUnitId();
    if (!adId) {
      console.warn('⚠️ VITE_ADMOB_INTERSTITIAL_ID not set — skipping ad preload');
      return;
    }

    _isLoading = true;

    try {
      const { AdMob, InterstitialAdPluginEvents } = await getAdMob();

      // Listen for load confirmation
      await AdMob.addListener(InterstitialAdPluginEvents.Loaded, () => {
        _isLoaded = true;
        _isLoading = false;
        console.log('📺 Interstitial ad loaded');
      });

      // Listen for load failure — reset state so next preload can retry
      await AdMob.addListener(InterstitialAdPluginEvents.FailedToLoad, (err: unknown) => {
        _isLoaded = false;
        _isLoading = false;
        console.warn('⚠️ Interstitial ad failed to load:', err);
      });

      // Listen for dismissal — reset so next level can preload a fresh ad
      await AdMob.addListener(InterstitialAdPluginEvents.Dismissed, () => {
        _isLoaded = false;
        _isLoading = false;
      });

      await AdMob.prepareInterstitial({ adId });
    } catch (err) {
      _isLoading = false;
      console.warn('⚠️ AdMob preload error (non-fatal):', err);
    }
  }

  /**
   * Show the pre-loaded interstitial ad if it's ready and user is free.
   *
   * Call this at natural break points:
   *   - After level completion
   *   - Before returning to main menu
   *
   * Returns true if ad was shown, false if skipped (premium/not loaded/web).
   */
  static async showIfReady(isPremium: boolean): Promise<boolean> {
    if (!isMobile() || isPremium || !_isLoaded) return false;

    try {
      const { AdMob } = await getAdMob();
      await AdMob.showInterstitial();
      console.log('📺 Interstitial ad shown');
      return true;
    } catch (err) {
      console.warn('⚠️ AdMob showInterstitial error (non-fatal):', err);
      _isLoaded = false;
      return false;
    }
  }

  /**
   * Reset ad state — call if you want to force a fresh preload.
   * Useful when premium status changes (user just purchased).
   */
  static reset(): void {
    _isLoaded = false;
    _isLoading = false;
  }

  /** True if an ad is loaded and ready to show */
  static get isReady(): boolean {
    return _isLoaded;
  }
}
