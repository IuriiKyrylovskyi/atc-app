/**
 * packages/app/src/stubs/revenuecat-ui.stub.ts
 *
 * Empty stub for @revenuecat/purchases-capacitor-ui on web/Electron.
 * Vite aliases the real package to this file when bundling for non-mobile.
 * The real package is only installed in @atc-app/mobile.
 */

export const PurchasesUI = {
  presentPaywall: () => Promise.resolve({ paywallResult: 'NOT_PRESENTED' }),
  presentPaywallIfNeeded: () => Promise.resolve({ paywallResult: 'NOT_PRESENTED' }),
};

export const PAYWALL_RESULT = {
  PURCHASED: 'PURCHASED',
  RESTORED: 'RESTORED',
  NOT_PRESENTED: 'NOT_PRESENTED',
  CANCELLED: 'CANCELLED',
  ERROR: 'ERROR',
};