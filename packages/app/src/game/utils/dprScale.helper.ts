/**
 * DPR Scale Helper
 *
 * When canvas is scaled by DPR (e.g., 2x), all coordinates are doubled.
 * Game objects need to be scaled proportionally to maintain visual size.
 *
 * Example:
 * - Display: 800×600
 * - DPR: 2x
 * - Canvas: 1600×1200
 * - A 50px plane should be scaled to 100px in canvas space
 */

/**
 * Get current device pixel ratio
 */
export function getDPR(): number {
  return window.devicePixelRatio || 1;
}

/**
 * Scale a size value by DPR
 * Use this for: plane sizes, runway widths, text sizes, etc.
 *
 * @example
 * const planeSize = scaleToDPR(50); // Returns 100 on 2x DPR screens
 */
export function scaleToDPR(value: number): number {
  return value * getDPR();
}

/**
 * Scale multiple values by DPR
 *
 * @example
 * const [width, height] = scaleMultipleToDPR(100, 50);
 */
export function scaleMultipleToDPR(...values: number[]): number[] {
  const dpr = getDPR();
  return values.map((v) => v * dpr);
}

/**
 * Unscale a value from DPR (convert canvas space to display space)
 * Usually not needed, but useful for debugging
 *
 * @example
 * const displaySize = unscaleFromDPR(100); // Returns 50 on 2x DPR screens
 */
export function unscaleFromDPR(value: number): number {
  return value / getDPR();
}

/**
 * Get a scale factor for Phaser sprites to maintain visual size
 * Apply this to sprite.setScale()
 *
 * @example
 * const sprite = this.add.sprite(x, y, 'plane');
 * sprite.setScale(getSpriteScaleFactor());
 */
export function getSpriteScaleFactor(): number {
  return getDPR();
}

/**
 * Check if high DPR rendering is active
 */
export function isHighDPR(): boolean {
  return getDPR() >= 2;
}

/**
 * Log DPR information (for debugging)
 */
export function logDPRInfo(): void {
  const dpr = getDPR();
  console.log('📐 DPR Scale Information:');
  console.log(`   Device Pixel Ratio: ${dpr}x`);
  console.log(`   50px becomes: ${scaleToDPR(50)}px in canvas space`);
  console.log(`   High DPR: ${isHighDPR() ? 'Yes' : 'No'}`);
}
