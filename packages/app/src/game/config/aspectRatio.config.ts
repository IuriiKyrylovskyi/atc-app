/**
 * Aspect Ratio Detection & Background Path System
 * Detects device screen ratio and returns appropriate background path
 */

export interface AspectRatioInfo {
  ratio: string; // e.g., "16x9", "19_5x9", "20x9"
  width: number;
  height: number;
  decimal: number; // e.g., 1.778 for 16:9
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
}

/**
 * Known mobile aspect ratios
 * Add new ratios here as needed
 */
const MOBILE_ASPECT_RATIOS = [
  { ratio: '19_5x9', decimal: 19.5 / 9, tolerance: 0.05, name: 'Galaxy S21, Pixel 6' },
  { ratio: '20x9', decimal: 20 / 9, tolerance: 0.05, name: 'iPhone 12/13/14' },
  { ratio: '21x9', decimal: 21 / 9, tolerance: 0.05, name: 'Sony Xperia' },
  { ratio: '19x9', decimal: 19 / 9, tolerance: 0.05, name: 'Galaxy S10' },
  { ratio: '18x9', decimal: 18 / 9, tolerance: 0.05, name: 'Galaxy S8/S9' },
  { ratio: '16x9', decimal: 16 / 9, tolerance: 0.05, name: 'Standard HD' },
] as const;

/**
 * Desktop/Tablet aspect ratios
 */
const DESKTOP_ASPECT_RATIOS = [
  { ratio: '16x9', decimal: 16 / 9, tolerance: 0.05, name: 'Standard HD' },
  { ratio: '16x10', decimal: 16 / 10, tolerance: 0.05, name: 'MacBook' },
  { ratio: '4x3', decimal: 4 / 3, tolerance: 0.05, name: 'iPad' },
  { ratio: '3x2', decimal: 3 / 2, tolerance: 0.05, name: 'Surface' },
] as const;

/**
 * Detect current screen aspect ratio.
 *
 * Dimension source is chosen per platform:
 * - `window.innerWidth/innerHeight` (CSS pixels) is preferred, because it
 *   reflects the actual viewport — required for Electron, where a portrait
 *   window must be detected as portrait rather than the physical display's
 *   landscape ratio.
 * - `screen.width/height` is used as a fallback when `window` is unavailable
 *   (SSR) or has not been laid out yet (`0`), which happens on Android/Capacitor
 *   startup where WebView insets make the first `window` measurement smaller
 *   than the real screen.
 *
 * The old `isMobile = landscapeWidth <= 768` gate is gone — modern Android
 * flagships are 870–915 CSS px wide in landscape, above the old threshold,
 * which caused all mobile ratio checks to be skipped silently.
 */
export function detectAspectRatio(): AspectRatioInfo {
  // Cross-platform dimension source: prefer CSS pixels (window) so Electron
  // portrait windows are detected correctly; fall back to screen dimensions
  // on Android/Capacitor startup where window may be 0.
  let srcW = 0;
  let srcH = 0;
  if (typeof window !== 'undefined') {
    srcW = window.innerWidth || 0;
    srcH = window.innerHeight || 0;
  }
  if (srcW <= 0 || srcH <= 0) {
    // SSR or not-yet-laid-out (mobile startup): use physical screen dims.
    if (typeof screen !== 'undefined') {
      srcW = (screen as any).width || 1920;
      srcH = (screen as any).height || 1080;
    } else {
      srcW = 1920;
      srcH = 1080;
    }
  }
  const landscapeWidth = Math.max(srcW, srcH);
  const landscapeHeight = Math.min(srcW, srcH);
  const actualRatio = landscapeWidth / landscapeHeight;

  const isMobile = landscapeHeight <= 500; // phones are typically ≤500 CSS px tall
  const isTablet = !isMobile && landscapeHeight <= 768;
  const isDesktop = !isMobile && !isTablet;

  // Check all ratio families — no device-size gate
  const ALL_RATIOS = [...MOBILE_ASPECT_RATIOS, ...DESKTOP_ASPECT_RATIOS];
  const tol = 0.08;

  for (const knownRatio of ALL_RATIOS) {
    if (Math.abs(actualRatio - knownRatio.decimal) <= tol) {
      return {
        ratio: knownRatio.ratio,
        width: landscapeWidth,
        height: landscapeHeight,
        decimal: actualRatio,
        isMobile,
        isTablet,
        isDesktop,
      };
    }
  }

  // No match — pick the closest and warn
  let closest = ALL_RATIOS[0];
  for (const r of ALL_RATIOS) {
    if (Math.abs(actualRatio - r.decimal) < Math.abs(actualRatio - closest.decimal)) closest = r;
  }
  console.warn(
    `[aspectRatio] Unknown ratio ${actualRatio.toFixed(
      3
    )} (${landscapeWidth}×${landscapeHeight}), using ${closest.ratio}`
  );

  return {
    ratio: closest.ratio,
    width: landscapeWidth,
    height: landscapeHeight,
    decimal: actualRatio,
    isMobile,
    isTablet,
    isDesktop,
  };
}
