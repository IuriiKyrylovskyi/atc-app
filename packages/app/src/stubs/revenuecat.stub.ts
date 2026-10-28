/**
 * packages/app/src/stubs/revenuecat.stub.ts
 *
 * Empty stub for @revenuecat/purchases-capacitor on web/Electron.
 * Vite aliases the real package to this file when bundling for non-mobile.
 * The real package is only installed in @atc-app/mobile.
 *
 * RevenueCatService.isMobile() returns false on web so none of these
 * are ever called — this file just satisfies the bundler's import resolution.
 */

export const Purchases = {
  configure: () => Promise.resolve(),
  logIn: () => Promise.resolve({ customerInfo: null, created: false }),
  setLogLevel: () => Promise.resolve(),
  getOfferings: () => Promise.resolve({ current: null }),
  purchasePackage: () => Promise.reject(new Error('Not available on web')),
  restorePurchases: () => Promise.resolve({ customerInfo: null }),
  getCustomerInfo: () => Promise.resolve({ customerInfo: { entitlements: { active: {} } } }),
};

export const LOG_LEVEL = {
  DEBUG: 'DEBUG',
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
};

// Minimal PAYWALL_RESULT constants used by RevenueCatUI
export const PAYWALL_RESULT = {
  PURCHASED: 'PURCHASED',
  RESTORED: 'RESTORED',
  NOT_PRESENTED: 'NOT_PRESENTED',
  CANCELLED: 'CANCELLED',
  ERROR: 'ERROR',
};

export type CustomerInfo = {
  entitlements: { active: Record<string, unknown> };
};
