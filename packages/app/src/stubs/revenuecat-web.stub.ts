/**
 * packages/app/src/stubs/revenuecat-web.stub.ts
 *
 * Empty stub for @revenuecat/purchases-js on mobile builds.
 * Vite aliases the real JS SDK to this file when bundling for
 * CAPACITOR_PLATFORM=android|ios, so the web-only billing SDK is
 * never shipped to native apps (which use the native RevenueCat SDK).
 *
 * On web/Electron the real @revenuecat/purchases-js package is used.
 */

export const Purchases = {
  configure: () => {
    throw new Error('RevenueCat Web SDK is not available on native mobile builds.');
  },
  getSharedInstance: () => {
    throw new Error('RevenueCat Web SDK is not available on native mobile builds.');
  },
  getOfferings: () => Promise.resolve({ current: null, all: {} }),
  getCustomerInfo: () =>
    Promise.resolve({ entitlements: { active: {} } }),
  purchase: () => Promise.reject(new Error('Not available on native mobile')),
  setAttributes: () => Promise.resolve(),
  restorePurchases: () => Promise.resolve({ customerInfo: { entitlements: { active: {} } } }),
  logIn: () => Promise.resolve({ customerInfo: { entitlements: { active: {} } }, created: false }),
  logOut: () => Promise.resolve(),
  isSandbox: () => false,
  getAppUserId: () => null,
  preload: () => Promise.resolve(),
  close: () => {},
};

export const LOG_LEVEL = {
  DEBUG: 'DEBUG',
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
};

export const ErrorCode = {
  PurchaseCancelledError: 'PurchaseCancelledError',
  PurchaseInProgressError: 'PurchaseInProgressError',
  PurchaseInvalidError: 'PurchaseInvalidError',
  PurchaseNotFoundError: 'PurchaseNotFoundError',
};

export class PurchasesError extends Error {
  errorCode: string;
  constructor(message: string, errorCode: string) {
    super(message);
    this.errorCode = errorCode;
  }
}

export type CustomerInfo = {
  entitlements: { active: Record<string, unknown> };
};