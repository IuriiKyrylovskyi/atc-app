/**
 * packages/app/src/services/revenueCatService.ts
 */
import { Capacitor } from '@capacitor/core';
import { toRaw } from 'vue';
import { NetworkTimeoutError } from '@/utils/fetchWithTimeout';
import { useDebugStore } from '@/stores/debug';
import { ENV, isMocked } from '@/config/env';

const API_KEYS = {
  ios: ENV.VITE_RC_IOS_KEY as string,
  android: ENV.VITE_RC_ANDROID_KEY as string,
};

export const RC_ENTITLEMENT_ID = 'pro_access';

function timeout<T>(ms: number): Promise<T> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new NetworkTimeoutError(`RC web call timed out after ${ms}ms`)), ms)
  );
}

// ─── Exported State for Debug Panel ──────────────────────────────────────────
export let lastRCError: string | null = null;
export let rcInitialized = false;
const _paymentLogs: string[] = [];

export function getPaymentLogs(): string[] {
  return _paymentLogs;
}

export function addPaymentLog(step: string, details?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0]; // HH:MM:SS
  const msg = `[${timestamp}] ${step}${details ? ' ' + JSON.stringify(details) : ''}`;
  _paymentLogs.push(msg);
  console.log('💰 ' + msg);
  // Mirror into the global debug store so the debug overlay's Copy button includes
  // payment steps even after the paywall closes (the in-memory list above is
  // only visible inside the paywall's own debug panel).
  try {
    useDebugStore().info('payment: ' + step, details);
  } catch {
    /* store not ready yet; non-fatal */
  }
  // Keep last 50 entries
  if (_paymentLogs.length > 50) _paymentLogs.shift();
}

export function clearPaymentLogs(): void {
  _paymentLogs.length = 0;
}

let _rc: any = null;

/**
 * Dynamic import helper for the native RevenueCat Capacitor SDK.
 * Note: If using Vite aliases, this may resolve to a stub on Web.
 */
async function getRC(): Promise<any> {
  if (_rc) return _rc;
  // Use @vite-ignore to prevent Vite from bundling the native SDK into the web build
  _rc = await import(/* @vite-ignore */ '@revenuecat/purchases-capacitor');
  return _rc;
}

/**
 * True when the store says this account already owns the product
 * (Google Play ITEM_ALREADY_OWNED / RevenueCat PRODUCT_ALREADY_PURCHASED_ERROR,
 * message "This product is already active for the user.").
 *
 * That is NOT a failed payment: the player has paid, but this app install may not
 * have an account for it yet. Callers should "claim" the purchase instead of
 * showing an error.
 */
function isAlreadyOwnedError(err: any, message: string): boolean {
  const code = String(err?.code ?? err?.errorCode ?? '').toUpperCase();
  if (
    code === '6' ||
    code === 'PRODUCT_ALREADY_PURCHASED_ERROR' ||
    code === 'PRODUCT_ALREADY_PURCHASED'
  ) {
    return true;
  }
  return /already (active|purchased|owned)/i.test(message);
}

function isNativeMobile(): boolean {
  return Capacitor.isNativePlatform();
}

export class RevenueCatService {
  /**
   * Re-binds the RevenueCat SDK to a stable appUserID.
   *
   * RevenueCat user ID = device Supabase uid until Phase 4.
   * The password is only used for manual restore authentication.
   */
  static async logIn(appUserID: string): Promise<boolean> {
    if (!appUserID) return false;
    const maskedId =
      appUserID.length > 8 ? `${appUserID.slice(0, 4)}••••${appUserID.slice(-4)}` : '••••••••';
    addPaymentLog('logIn:start', {
      platform: isNativeMobile() ? 'native' : 'web',
      appUserID: maskedId,
    });

    if (isNativeMobile()) {
      try {
        const { Purchases } = await getRC();
        const { customerInfo } = await Purchases.logIn({ appUserID });
        const active = customerInfo?.entitlements?.active ?? {};
        const hasEntitlement = !!active[RC_ENTITLEMENT_ID];
        addPaymentLog('NATIVE logIn:result', {
          appUserID: maskedId,
          hasEntitlement,
          entitlements: Object.keys(active),
        });
        return hasEntitlement;
      } catch (err: any) {
        addPaymentLog('NATIVE logIn:error', { appUserID: maskedId, error: String(err) });
        console.warn('⚠️ RC logIn failed:', err?.message || String(err));
        return false;
      }
    }

    // Web: the JS SDK rebinds the configured customer to a stable appUserID.
    // The RC appUserID is the unique rc_customer_id, not the password.
    return webLogIn(appUserID);
  }

  /**
   * Initializes the RevenueCat SDK with the platform-specific API key.
   *
   * RevenueCat user ID = device Supabase uid until Phase 4.
   */
  static async initialize(supabaseUserId: string, stableAppUserID?: string): Promise<void> {
    lastRCError = null;
    rcInitialized = false;
    clearPaymentLogs();

    if (!isNativeMobile()) {
      addPaymentLog('INIT skipped', { reason: 'not_native_mobile' });
      console.log('ℹ️ RevenueCat skipped: Not a native mobile platform.');
      return;
    }

    const platform = Capacitor.getPlatform(); // 'ios' or 'android'
    const apiKey = platform === 'ios' ? API_KEYS.ios : API_KEYS.android;
    const appUserID = stableAppUserID || supabaseUserId;

    // appUserID doubles as the private recovery password — never log it in full.
    const maskedAppUserID =
      appUserID.length > 8 ? `${appUserID.slice(0, 4)}••••${appUserID.slice(-4)}` : '••••••••';
    addPaymentLog('NATIVE initialize:start', {
      platform,
      appUserID: maskedAppUserID,
      keyPrefix: apiKey?.slice(0, 12),
    });

    // 1. Validation: Check if Vite provided the keys from .env
    if (!apiKey || apiKey === 'undefined') {
      lastRCError = `Missing VITE_RC_${platform.toUpperCase()}_KEY in .env file`;
      addPaymentLog('NATIVE initialize:error', { reason: 'missing_api_key', platform });
      console.error('❌ RC Init Error:', lastRCError);
      return;
    }

    try {
      const { Purchases, LOG_LEVEL } = await getRC();

      // 2. Safety Check: Verify we aren't using the stub on a native device
      if (typeof Purchases.configure !== 'function') {
        addPaymentLog('NATIVE initialize:error', { reason: 'stub_detected' });
        throw new Error('RevenueCat stub detected on native! Fix vite.config.ts alias.');
      }

      // 3. Configure Native SDK
      await Purchases.setLogLevel({ level: LOG_LEVEL.DEBUG });
      await Purchases.configure({
        apiKey,
        appUserID,
      });

      rcInitialized = true;
      addPaymentLog('NATIVE initialize:done', { platform, appUserID: maskedAppUserID });
      console.log('✅ RevenueCat initialized successfully');
    } catch (err: any) {
      lastRCError = err?.message || String(err);
      addPaymentLog('NATIVE initialize:error', { platform, error: lastRCError });
      console.error('❌ RC Initialization failed:', lastRCError);
    }
  }

  /**
   * Fetches current offerings from the dashboard.
   */
  static async getOfferings(): Promise<any> {
    if (!isNativeMobile()) return null;
    if (!rcInitialized) {
      throw new Error('Purchases not configured. Call initialize() first.');
    }

    const platform = Capacitor.getPlatform();
    const apiKey = platform === 'ios' ? API_KEYS.ios : API_KEYS.android;
    const keyPreview = apiKey ? `${apiKey.slice(0, 12)}...(${apiKey.length})` : 'undefined';

    try {
      const { Purchases } = await getRC();
      const offerings = await Purchases.getOfferings();
      // Log helpful context for debugging on device
      console.log(
        `🔍 RC getOfferings raw | platform=${platform} | key=${keyPreview} | initialized=${rcInitialized}`
      );
      console.log('🔍 RC getOfferings payload:', JSON.stringify(offerings, null, 2));
      return offerings;
    } catch (err: any) {
      lastRCError = err?.message || String(err);
      // Print stack if available to help diagnose native errors
      if (err && err.stack) {
        console.error('❌ RC getOfferings failed:', err.stack);
      } else {
        console.error('❌ RC getOfferings failed:', err);
      }
      return null;
    }
  }

  /**
   * Read back the appUserID RevenueCat is currently bound to.
   *
   * RevenueCat user ID = device Supabase uid until Phase 4.
   */
  static async getAppUserID(): Promise<string | null> {
    if (!isNativeMobile()) return null;
    if (!rcInitialized) return null;

    try {
      const { Purchases } = await getRC();
      const info = await Purchases.getCustomerInfo();
      return info?.appUserID ?? null;
    } catch (err: any) {
      console.warn('⚠️ RC getAppUserID failed:', err?.message || String(err));
      return null;
    }
  }

  /**
   * Executes a purchase for a specific package.
   */
  static async purchasePackage(rawPackage: unknown): Promise<{
    success: boolean;
    cancelled?: boolean;
    /** The store already has an active purchase for this account — claim it, don't retry. */
    alreadyOwned?: boolean;
    error?: string;
    customerInfo?: object;
  }> {
    if (!isNativeMobile()) return { success: false, error: 'not_mobile' };

    const pkgId = (rawPackage as any)?.identifier ?? 'unknown';
    addPaymentLog('NATIVE purchasePackage:start', { pkgId });

    try {
      const { Purchases } = await getRC();
      // Use toRaw to ensure Vue Proxy objects don't break the native bridge
      // SDK may return different shapes; defensively handle response
      const purchaseResult = await Purchases.purchasePackage({ aPackage: toRaw(rawPackage) });
      const customerInfo = purchaseResult?.customerInfo ?? purchaseResult?.customer_info ?? null;

      const active = customerInfo?.entitlements?.active ?? {};
      const hasEntitlement = !!active[RC_ENTITLEMENT_ID];
      addPaymentLog('NATIVE purchasePackage:result', {
        pkgId,
        success: hasEntitlement,
        entitlements: Object.keys(active),
      });

      if (hasEntitlement) {
        return { success: true, customerInfo };
      }
      return { success: false, error: 'entitlement_not_active', customerInfo };
    } catch (err: any) {
      const message = err?.message || String(err);
      const isCancelled = message.toLowerCase().includes('cancel');
      addPaymentLog('NATIVE purchasePackage:error', {
        pkgId,
        cancelled: isCancelled,
        error: message,
      });

      if (isCancelled) {
        return { success: false, cancelled: true };
      }

      if (isAlreadyOwnedError(err, message)) {
        addPaymentLog('NATIVE purchasePackage:already_owned', { pkgId });
        return { success: false, alreadyOwned: true, error: message };
      }

      console.error('❌ RC purchase failed:', err);
      return { success: false, error: message };
    }
  }

  /**
   * Purchase by platform product identifier (string).
   */
  static async purchaseProduct(productIdentifier: string): Promise<{
    success: boolean;
    cancelled?: boolean;
    error?: string;
    customerInfo?: any;
  }> {
    if (!isNativeMobile()) return { success: false, error: 'not_mobile' };

    try {
      const { Purchases } = await getRC();
      // SDK shape may vary; call purchaseProduct API
      const purchaseResult = await Purchases.purchaseProduct({ productIdentifier });
      const customerInfo = purchaseResult?.customerInfo ?? purchaseResult?.customer_info ?? null;

      const active = customerInfo?.entitlements?.active ?? {};
      if (active[RC_ENTITLEMENT_ID]) {
        return { success: true, customerInfo };
      }
      return { success: false, error: 'entitlement_not_active', customerInfo };
    } catch (err: any) {
      const message = err?.message || String(err);
      const isCancelled = message.toLowerCase().includes('cancel');
      if (isCancelled) return { success: false, cancelled: true };
      console.error('❌ RC purchaseProduct failed:', err);
      return { success: false, error: message };
    }
  }

  /**
   * Restores previously purchased transactions.
   */
  static async restorePurchases(): Promise<any> {
    if (!isNativeMobile()) return null;
    addPaymentLog('NATIVE restorePurchases:start');
    try {
      const { Purchases } = await getRC();

      // Android: restorePurchases() asks Play for purchase HISTORY through a deprecated
      // call that Play now answers with an error ("No purchases found to restore"), even
      // for a product the account owns. The SDK's automatic sync, which queries what the
      // account currently holds, does work. So sync first, then restore, then force a
      // fresh read, because restore falls back to the stale cached CustomerInfo.
      try {
        if (typeof (Purchases as any).syncPurchases === 'function') {
          await (Purchases as any).syncPurchases();
          addPaymentLog('NATIVE syncPurchases:done');
        }
      } catch (err: any) {
        addPaymentLog('NATIVE syncPurchases:error', { error: String(err) });
      }

      let { customerInfo } = await Purchases.restorePurchases();

      if (!customerInfo?.entitlements?.active?.[RC_ENTITLEMENT_ID]) {
        try {
          if (typeof (Purchases as any).invalidateCustomerInfoCache === 'function') {
            await (Purchases as any).invalidateCustomerInfoCache();
          }
          const fresh = await Purchases.getCustomerInfo();
          if (fresh?.customerInfo) customerInfo = fresh.customerInfo;
          addPaymentLog('NATIVE restorePurchases:fresh-read');
        } catch (err: any) {
          addPaymentLog('NATIVE restorePurchases:fresh-read-error', { error: String(err) });
        }
      }
      const active = customerInfo?.entitlements?.active ?? {};
      const hasEntitlement = !!active[RC_ENTITLEMENT_ID];
      // Identity snapshot: which RC user this device is acting as, and what the
      // store/RC says it owns. Helps diagnose multi-Google-account setups, where
      // Play Billing resolves to the account the app was installed with.
      let appUserID: string | null = null;
      try {
        appUserID = (await Purchases.getAppUserID())?.appUserID ?? null;
      } catch {
        /* non-fatal */
      }
      addPaymentLog('NATIVE restorePurchases:result', {
        hasEntitlement,
        entitlements: Object.keys(active),
        appUserID,
        originalAppUserId: customerInfo?.originalAppUserId ?? null,
        purchasedProducts: customerInfo?.allPurchasedProductIdentifiers ?? [],
        activeSubscriptions: customerInfo?.activeSubscriptions ?? [],
      });
      return customerInfo;
    } catch (err: any) {
      addPaymentLog('NATIVE restorePurchases:error', { error: String(err) });
      console.error('❌ RC restorePurchases failed:', err);
      return null;
    }
  }

  /**
   * Checks if the user currently has an active "pro_access" entitlement.
   */
  static async hasActiveEntitlement(): Promise<boolean> {
    if (!isNativeMobile()) return false;
    try {
      const { Purchases } = await getRC();
      const { customerInfo } = await Purchases.getCustomerInfo();
      const active = customerInfo.entitlements.active;
      return !!active[RC_ENTITLEMENT_ID];
    } catch (err: any) {
      console.warn('⚠️ RC entitlement check failed:', err);
      return false;
    }
  }

  /**
   * Sets subscriber attributes on the current RevenueCat customer.
   * Called BEFORE purchase to pass user-chosen alias/password to the webhook.
   *
   * On web the JS SDK does not cache or retry this request on failure — if it
   * fails, alias/password never reach the webhook and the account is not
   * created, so the caller must retry before purchase().
   */
  static async setAttributes(attributes: Record<string, string>): Promise<boolean> {
    addPaymentLog('setAttributes:start', {
      platform: isNativeMobile() ? 'native' : 'web',
      keys: Object.keys(attributes),
    });
    try {
      if (isNativeMobile()) {
        const { Purchases } = await getRC();
        // RC v12 SDK takes the attributes dict directly, NOT wrapped in { attributes }.
        // The previous { attributes } wrapper set a single bogus attribute named
        // "attributes" (with an object value) and the real keys (alias, password,
        // user_id) never reached the RevenueCat webhook, so the webhook could not
        // create accounts or link devices on native.
        await Purchases.setAttributes(attributes);
        addPaymentLog('NATIVE setAttributes:done', { keys: Object.keys(attributes) });
        return true;
      }
      return webSetAttributes(attributes);
    } catch (err: any) {
      addPaymentLog('setAttributes:error', {
        platform: isNativeMobile() ? 'native' : 'web',
        error: String(err),
      });
      console.warn('⚠️ RC setAttributes failed:', err?.message || String(err));
      return false;
    }
  }

  // ─── Web SDK (RevenueCat Web Billing — Paddle) ──────────────────────────────
  // These methods are no-ops on native mobile (the native SDK is used there).
  // On web/Electron they drive @revenuecat/purchases-js with Paddle Billing.

  /**
   * Configures the web SDK for the given appUserID.
   * Returns true once configured.
   */
  static async initWeb(appUserID: string): Promise<boolean> {
    if (isNativeMobile()) return false;
    if (!appUserID) {
      console.warn('⚠️ initWeb called with empty appUserID');
      return false;
    }
    try {
      await webEnsure(appUserID);
      return true;
    } catch (err: any) {
      lastRCError = err?.message || String(err);
      console.error('❌ Web RC init failed:', lastRCError);
      return false;
    }
  }

  /**
   * Fetches offerings for the currently-configured web customer.
   */
  static async getOfferingsWeb(): Promise<any> {
    if (isNativeMobile()) return null;
    return webGetOfferings();
  }

  /**
   * Executes a Paddle-backed purchase for a package. The checkout renders
   * inline into `htmlTarget`; the returned result carries customerInfo.
   */
  static async purchasePackageWeb(
    pkg: any,
    htmlTarget?: HTMLElement
  ): Promise<{
    success: boolean;
    cancelled?: boolean;
    error?: string;
    customerInfo?: any;
  }> {
    if (isNativeMobile()) return { success: false, error: 'not_mobile' };
    return webPurchase(pkg, htmlTarget);
  }

  /**
   * Restores purchases for the currently-configured web customer.
   */
  static async restorePurchasesWeb(): Promise<any> {
    if (isNativeMobile()) return null;
    return webRestorePurchases();
  }

  /**
   * Returns the current web customer info, or null when not configured.
   */
  static async getCustomerInfoWeb(): Promise<any> {
    if (isNativeMobile()) return null;
    return webGetCustomerInfo();
  }

  /**
   * True when the web billing public key is present in env.
   */
  static async isWebConfigured(): Promise<boolean> {
    if (isNativeMobile()) return false;
    return webIsConfigured();
  }
}

// ─── Web SDK (RevenueCat Web Billing — Paddle) ────────────────────────────────
// The @revenuecat/purchases-js package is resolved normally on web/Electron and
// stubbed on native mobile builds (see vite.config.ts alias). These helpers are
// only active when !isNativeMobile().
//
// API notes (verified against purchases-js 1.66.0):
//   - Purchases.configure(apiKey, appUserId) — positional args, NOT an object.
//   - purchases.setAttributes(attributes) — takes ONE arg (the attributes dict).
//     The apiKey passed to configure() is reused internally; do NOT pass it here
//     (it's silently ignored and was the cause of a prior "Could not save your
//     credentials" bug).
//   - There is no logIn() on the web SDK. Cross-device restore uses
//     identifyUser(appUserId), which aliases the new id with the previous one.
//   - purchase() takes a PurchaseParams object with rcPackage and htmlTarget.

/**
 * Returns the web (Paddle) API key for @revenuecat/purchases-js.
 *
 *   VITE_RC_PADDLE_SERVER_API_KEY          -> production web builds
 *   VITE_RC_PADDLE_SERVER_SANDBOX_API_KEY  -> sandbox (dev / test purchases)
 *
 * Sandbox is chosen when VITE_RC_WEB_SANDBOX=true, or - when that flag is not
 * set - automatically in dev (`vite` dev server). Set VITE_RC_WEB_SANDBOX=false
 * to force the live key in dev. A production build never uses sandbox unless
 * the flag is explicitly true.
 *
 * The legacy VITE_RC_WEB_BILLING_* names are still read as a fallback.
 */
function getWebApiKey(): string | undefined {
  const raw = isMocked(ENV.VITE_RC_WEB_SANDBOX) ? '' : ENV.VITE_RC_WEB_SANDBOX;
  const flag = String(raw ?? '').toLowerCase();
  const useSandbox = flag === 'true' || (flag === '' && import.meta.env.DEV);
  const env = import.meta.env as Record<string, string | undefined>;
  const key = useSandbox
    ? env.VITE_RC_PADDLE_SERVER_SANDBOX_API_KEY || env.VITE_RC_WEB_BILLING_SANDBOX_API_KEY
    : env.VITE_RC_PADDLE_SERVER_API_KEY || env.VITE_RC_WEB_BILLING_PUBLIC_KEY;
  return key && !key.includes('YOUR') ? key : undefined;
}

let _webConfiguredFor: string | null = null;
let _webPurchases: any = null;

/**
 * Configures the RevenueCat Web SDK (Paddle Billing) once per appUserID.
 * RevenueCat user ID = device Supabase uid until Phase 4.
 */
async function webConfigure(appUserID: string): Promise<any> {
  const apiKey = getWebApiKey();
  if (!apiKey) {
    addPaymentLog('WEB configure:error', { reason: 'missing_api_key' });
    throw new Error(
      'Missing web Paddle API key. Set VITE_RC_PADDLE_SERVER_SANDBOX_API_KEY (sandbox/dev) ' +
        'or VITE_RC_PADDLE_SERVER_API_KEY (production) in packages/app/.env.local.'
    );
  }
  addPaymentLog('WEB configure:start', {
    appUserID: maskId(appUserID),
    keyPrefix: apiKey.slice(0, 12),
    sandbox: apiKey === (import.meta.env as any).VITE_RC_PADDLE_SERVER_SANDBOX_API_KEY,
  });
  const { Purchases } = await import('@revenuecat/purchases-js');
  _webPurchases = Purchases.configure(apiKey, appUserID);
  _webConfiguredFor = appUserID;
  addPaymentLog('WEB configure:done', { appUserID: maskId(appUserID) });
  return _webPurchases;
}

function maskId(id: string): string {
  if (!id) return 'empty';
  return id.length > 8 ? `${id.slice(0, 4)}••••${id.slice(-4)}` : '••••••••';
}

/**
 * Ensures the SDK is configured for the given appUserID. If the configured
 * identity differs, re-configure (which creates a new RC customer id) — the
 * caller must call webIdentifyUser() afterwards to alias the two.
 */
async function webEnsure(appUserID: string): Promise<any> {
  if (_webPurchases && _webConfiguredFor === appUserID) return _webPurchases;
  return webConfigure(appUserID);
}

/**
 * Re-binds the web SDK to a stable appUserID.
 * RevenueCat user ID = device Supabase uid until Phase 4.
 * Uses identifyUser() to alias the new id with the previous one.
 * Returns true when the customer already has the pro_access entitlement.
 */
async function webLogIn(appUserID: string): Promise<boolean> {
  if (!appUserID) return false;
  addPaymentLog('WEB logIn:start', { appUserID: maskId(appUserID) });
  try {
    const purchases = await webEnsure(appUserID);
    if (typeof purchases.identifyUser === 'function') {
      await purchases.identifyUser(appUserID);
    }
    let customerInfo: any;
    try {
      customerInfo = await Promise.race([purchases.getCustomerInfo(), timeout<any>(10000)]);
    } catch (err: any) {
      if (err instanceof NetworkTimeoutError) {
        addPaymentLog('WEB logIn:timeout', { appUserID: maskId(appUserID) });
        console.warn(
          '⚠️ Web RC logIn getCustomerInfo timed out after 10s — treating as not premium yet'
        );
      } else {
        addPaymentLog('WEB logIn:customerInfo_error', {
          appUserID: maskId(appUserID),
          error: String(err),
        });
        console.warn(
          '⚠️ Web RC logIn getCustomerInfo failed:',
          err instanceof Error ? err.message : String(err)
        );
      }
      return false;
    }
    const active = customerInfo?.entitlements?.active ?? {};
    const hasEntitlement = !!active[RC_ENTITLEMENT_ID];
    addPaymentLog('WEB logIn:result', {
      appUserID: maskId(appUserID),
      hasEntitlement,
      entitlements: Object.keys(active),
    });
    return hasEntitlement;
  } catch (err: any) {
    addPaymentLog('WEB logIn:error', { appUserID: maskId(appUserID), error: String(err) });
    console.warn('⚠️ Web RC logIn failed:', err?.message || String(err));
    return false;
  }
}

async function webSetAttributes(attributes: Record<string, string>): Promise<boolean> {
  try {
    const purchases = await webEnsure(_webConfiguredFor || '');
    if (typeof purchases.setAttributes !== 'function') return false;
    addPaymentLog('WEB setAttributes:start', { keys: Object.keys(attributes) });
    // The API key was already passed to Purchases.configure(); setAttributes
    // only needs the attributes dictionary — a second arg is silently ignored.
    await Promise.race([purchases.setAttributes(attributes), timeout<void>(10000)]);
    addPaymentLog('WEB setAttributes:done', { keys: Object.keys(attributes) });
    return true;
  } catch (err: any) {
    addPaymentLog('WEB setAttributes:error', { keys: Object.keys(attributes), error: String(err) });
    if (err instanceof NetworkTimeoutError) {
      console.warn(
        '⚠️ Web RC setAttributes timed out after 10s — attributes will sync on next purchase'
      );
    } else {
      console.warn('⚠️ Web RC setAttributes failed:', err?.message || String(err));
    }
    return false;
  }
}

/**
 * Fetches offerings for the currently-configured web customer.
 * Returns null when not configured or the SDK is unavailable.
 *
 * Bounded at 10s so a hung SDK call can't stall the paywall's package
 * list — the same freeze class as getCustomerInfo.
 */
async function webGetOfferings(): Promise<any> {
  if (!_webConfiguredFor) return null;
  try {
    const purchases = await webEnsure(_webConfiguredFor);
    try {
      return await Promise.race([purchases.getOfferings(), timeout<any>(10000)]);
    } catch (err: any) {
      if (err instanceof NetworkTimeoutError) {
        console.warn('⚠️ Web RC getOfferings timed out after 10s — treating as unavailable');
      } else {
        console.warn(
          '⚠️ Web RC getOfferings failed:',
          err instanceof Error ? err.message : String(err)
        );
      }
      return null;
    }
  } catch (err: any) {
    console.warn('⚠️ Web RC getOfferings failed:', err?.message || String(err));
    return null;
  }
}

/**
 * Executes a Paddle-backed purchase for a package. The checkout renders
 * inline into `htmlTarget`; the returned result carries customerInfo.
 *
 * The web SDK purchase() takes a PurchaseParams object with `rcPackage`
 * and `htmlTarget`. We pass the package object directly.
 */
async function webPurchase(
  pkg: any,
  htmlTarget?: HTMLElement
): Promise<{
  success: boolean;
  cancelled?: boolean;
  error?: string;
  customerInfo?: any;
}> {
  const pkgId = pkg?.identifier ?? pkg?.packageIdentifier ?? 'unknown';
  addPaymentLog('WEB purchase:start', { pkgId, hasHtmlTarget: !!htmlTarget });

  try {
    const purchases = await webEnsure(_webConfiguredFor || '');
    // The RC Web SDK v1.66.0 PurchaseParams uses `rcPackage`, NOT `package`.
    // Using the wrong key left rcPackage undefined and purchases silently failed.
    const params: any = { rcPackage: pkg };
    if (htmlTarget) params.htmlTarget = htmlTarget;
    // Bounded at 20s: the Paddle checkout is an interactive flow, so this
    // is a generous cap, but it must still exist — a hung SDK call would
    // otherwise freeze the paywall button indefinitely. Purchase is never
    // RETRIED (a retry could double-charge); on timeout we surface a clean
    // error and let the user try again deliberately.
    const result = await Promise.race([purchases.purchase(params), timeout<any>(20000)]);
    const customerInfo = result?.customerInfo ?? null;
    const active = customerInfo?.entitlements?.active ?? {};
    const hasEntitlement = !!active[RC_ENTITLEMENT_ID];
    addPaymentLog('WEB purchase:result', {
      pkgId,
      success: hasEntitlement,
      entitlements: Object.keys(active),
    });

    if (hasEntitlement) {
      return { success: true, customerInfo };
    }
    return { success: false, error: 'entitlement_not_active', customerInfo };
  } catch (err: any) {
    if (err instanceof NetworkTimeoutError) {
      addPaymentLog('WEB purchase:timeout', { pkgId, timeout: '20s' });
      console.error('❌ Web RC purchase timed out after 20s');
      return { success: false, error: 'Purchase timed out — please try again' };
    }
    const message = err?.message || String(err);
    const isCancelled =
      err?.errorCode === 'PurchaseCancelledError' || message.toLowerCase().includes('cancel');
    addPaymentLog('WEB purchase:error', { pkgId, cancelled: isCancelled, error: message });
    if (isCancelled) return { success: false, cancelled: true };
    console.error('❌ Web RC purchase failed:', err);
    return { success: false, error: message };
  }
}

async function webRestorePurchases(): Promise<any> {
  if (!_webConfiguredFor) return null;
  try {
    const purchases = await webEnsure(_webConfiguredFor);
    // The RC Web SDK (v1.66.0) has no restorePurchases() method — restore on
    // web is implicit: once the customer is identified (appUserID = password),
    // calling getCustomerInfo() returns the current entitlement state from the
    // server. This is the web equivalent of native restorePurchases().
    try {
      return await Promise.race([purchases.getCustomerInfo(), timeout<any>(10000)]);
    } catch (err: any) {
      if (err instanceof NetworkTimeoutError) {
        console.warn(
          '⚠️ Web RC restorePurchases getCustomerInfo timed out after 10s — treating as not configured'
        );
      } else {
        console.warn(
          '⚠️ Web RC restorePurchases failed:',
          err instanceof Error ? err.message : String(err)
        );
      }
      return null;
    }
  } catch (err: any) {
    console.warn('⚠️ Web RC restorePurchases failed:', err?.message || String(err));
    return null;
  }
}

async function webGetCustomerInfo(): Promise<any> {
  if (!_webConfiguredFor) return null;
  try {
    const purchases = await webEnsure(_webConfiguredFor);
    try {
      return await Promise.race([purchases.getCustomerInfo(), timeout<any>(10000)]);
    } catch (err: any) {
      if (err instanceof NetworkTimeoutError) {
        console.warn('⚠️ Web RC getCustomerInfo timed out after 10s — treating as not configured');
      } else {
        console.warn(
          '⚠️ Web RC getCustomerInfo failed:',
          err instanceof Error ? err.message : String(err)
        );
      }
      return null;
    }
  } catch (err: any) {
    console.warn('⚠️ Web RC getCustomerInfo failed:', err?.message || String(err));
    return null;
  }
}

async function webIsConfigured(): Promise<boolean> {
  return !!getWebApiKey();
}
