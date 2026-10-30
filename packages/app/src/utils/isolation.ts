/**
 * Cross-origin isolation for the radar scope only.
 *
 * Kokoro synthesises about twice as fast with multi-threaded WebAssembly, which
 * needs SharedArrayBuffer, which needs a cross-origin isolated document
 * (COOP same-origin + COEP). COEP also blocks cross-origin iframes that do not
 * opt in — the RevenueCat / Stripe web checkout among them — so the app is
 * never isolated as a whole: the scope reloads itself as `?coi=1`, the server
 * adds the headers to that document only (vite.config.ts, Electron main), and
 * leaving the scope reloads without the flag (router guard).
 *
 * Servers without the headers just give a normal document: Kokoro then runs
 * single-threaded, nothing breaks, and there is no reload loop.
 */
export const COI_PARAM = 'coi';

/** This document was requested isolated (whether or not the server obliged). */
export const isolationRequested = (): boolean =>
  typeof location !== 'undefined' && new URLSearchParams(location.search).has(COI_PARAM);

/** This document's URL with or without the isolation flag, keeping or replacing the hash route. */
export function isolationUrl(on: boolean, hash: string = location.hash): string {
  const url = new URL(location.href);
  if (on) url.searchParams.set(COI_PARAM, '1');
  else url.searchParams.delete(COI_PARAM);
  url.hash = hash;
  return url.toString();
}
