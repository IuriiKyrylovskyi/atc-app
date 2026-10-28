/**
 * Plane configuration system based on defaults.config.ts
 *
 * FILE NAMING CONVENTION:
 * - [number]-[color].png → Main plane sprite (e.g., 1-blue.png, 2-green.png)
 * - [number]-shadow.png → Shadow for all planes of that type (e.g., 1-shadow.png)
 *
 * PLANE TYPE (number):
 * - Defines: Size, Speed, Turn Rate, Manufacturer
 * - Example: Type 1 = Cessna (small), Type 2 = Regional Jet (medium)
 *
 * COLOR (suffix):
 * - Visual variant only, doesn't affect performance
 * - Available colors: blue, green, yellow, pink, violet, orange
 *
 * SHADOW:
 * - One shadow file per plane type
 * - Used for ALL color variants of that type
 * - Example: 1-shadow.png used for 1-blue.png, 1-green.png, etc.
 *
 * COLLISION:
 * - Collision radius = 100% of plane sprite size (COLLISION_PERCENTAGE = 1.0)
 * - Larger planes = larger collision radius automatically
 */

import {
  DEFAULT_PLANE_TYPE,
  PLANE_TYPE_VARIANTS,
  getPlaneTypeById as getDefaultPlaneTypeVariant,
  getActualPlaneProperties,
  getDeviceScaleFactor,
  type PlaneTypeVariant,
} from '@/game/config/defaults.config';

export interface PlaneTypeConfig {
  id: number;
  name: string;
  manufacturer: string; // Aircraft manufacturer (Cessna, Boeing, etc.)
  baseSize: number; // Base size in pixels (width/height of sprite)
  collisionRadius: number; // Collision detection radius (= baseSize for 100%)
  warningRadius: number; // Warning zone radius (140% of baseSize)
  dangerRadius: number; // Danger zone radius (240% of baseSize)
  speed: number; // Base speed
  turnRate: number; // Turn rate in radians per frame
  weightClass: 'light' | 'medium' | 'heavy' | 'super';
  colors: string[]; // Available colors for this type
}

/**
 * Available plane colors (all types support all colors)
 */
export const PLANE_COLORS = ['blue', 'green', 'yellow', 'pink', 'violet', 'orange'] as const;
export type PlaneColor = (typeof PLANE_COLORS)[number];

/**
 * Convert PlaneTypeVariant to PlaneTypeConfig with calculated radii
 */
function variantToConfig(variant: PlaneTypeVariant, deviceScale: number = 1.0): PlaneTypeConfig {
  const props = getActualPlaneProperties(variant.id, deviceScale);

  return {
    id: variant.id,
    name: variant.name,
    manufacturer: variant.manufacturer,
    baseSize: props.baseSize,
    collisionRadius: props.collisionRadius,
    warningRadius: props.warningRadius,
    dangerRadius: props.dangerRadius,
    speed: props.speed,
    turnRate: props.turnRate,
    weightClass: props.weightClass,
    colors: [...PLANE_COLORS], // All types support all colors
  };
}

/**
 * Get all plane types with current device scaling applied
 */
export function getAllPlaneTypes(): PlaneTypeConfig[] {
  const deviceScale = getDeviceScaleFactor();
  return PLANE_TYPE_VARIANTS.map((variant) => variantToConfig(variant, deviceScale));
}

/**
 * Get plane type configuration by ID
 */
export function getPlaneTypeById(typeId: number): PlaneTypeConfig | undefined {
  const variant = getDefaultPlaneTypeVariant(typeId);
  if (!variant) return undefined;

  const deviceScale = getDeviceScaleFactor();
  return variantToConfig(variant, deviceScale);
}

/**
 * Get plane type from texture key
 * Examples:
 * - "1-blue" → Type 1
 * - "2-green" → Type 2
 * - "3-yellow" → Type 3
 */
export function getPlaneTypeFromTextureKey(textureKey: string): PlaneTypeConfig | undefined {
  const match = textureKey.match(/^(\d+)-/);
  if (match) {
    const typeId = parseInt(match[1], 10);
    return getPlaneTypeById(typeId);
  }
  return undefined;
}

/**
 * Get color from texture key
 * Examples:
 * - "1-blue" → "blue"
 * - "2-green" → "green"
 */
export function getColorFromTextureKey(textureKey: string): PlaneColor | undefined {
  const match = textureKey.match(/^(\d+)-(.+)$/);
  if (match) {
    const color = match[2];
    if (PLANE_COLORS.includes(color as PlaneColor)) {
      return color as PlaneColor;
    }
  }
  return undefined;
}

/**
 * Get shadow texture key for a plane type
 * Examples:
 * - Type 1 → "1-shadow"
 * - Type 2 → "2-shadow"
 *
 * IMPORTANT: Extract type ID from texture key first if needed
 */
export function getShadowTextureKey(textureKeyOrTypeId: string | number): string {
  // If it's already a number, use it directly
  if (typeof textureKeyOrTypeId === 'number') {
    return `${textureKeyOrTypeId}-shadow`;
  }

  // If it's a texture key like "1-blue", extract the type ID
  const match = textureKeyOrTypeId.match(/^(\d+)-/);
  if (match) {
    const typeId = parseInt(match[1], 10);
    return `${typeId}-shadow`;
  }

  // Fallback: assume it's already formatted correctly
  return textureKeyOrTypeId;
}

/**
 * Build texture key from type and color
 * Example: buildTextureKey(1, 'blue') → "1-blue"
 */
export function buildTextureKey(planeTypeId: number, color: PlaneColor): string {
  return `${planeTypeId}-${color}`;
}

/**
 * Get device type based on screen width (landscape only)
 */
export function getDeviceType(): 'desktop' | 'tablet' | 'mobile' {
  // Use the short axis of screen (portrait height) so the result is stable
  // in landscape orientation on Android/Capacitor where window.innerWidth
  // reports the long axis (870–915 px on flagships, above the old 768 threshold).
  const shortAxis = Math.min(screen.width, screen.height);

  if (shortAxis >= 1024) return 'desktop';
  if (shortAxis >= 600) return 'tablet';
  return 'mobile';
}

/**
 * Calculate actual size for a plane type on current device
 */
export function getActualPlaneSize(typeId: number): number {
  const planeType = getPlaneTypeById(typeId);
  if (!planeType) {
    console.warn(`Unknown plane type ${typeId}, using default size`);
    return DEFAULT_PLANE_TYPE.BASE_SIZE * getDeviceScaleFactor();
  }
  return planeType.baseSize;
}

/**
 * Calculate actual collision radius for a plane type on current device
 */
export function getActualCollisionRadius(typeId: number): number {
  const planeType = getPlaneTypeById(typeId);
  if (!planeType) {
    console.warn(`Unknown plane type ${typeId}, using default collision radius`);
    const deviceScale = getDeviceScaleFactor();
    return DEFAULT_PLANE_TYPE.BASE_SIZE * DEFAULT_PLANE_TYPE.COLLISION_PERCENTAGE * deviceScale;
  }
  return planeType.collisionRadius;
}

/**
 * Calculate actual warning radius for a plane type on current device
 */
export function getActualWarningRadius(typeId: number): number {
  const planeType = getPlaneTypeById(typeId);
  if (!planeType) {
    console.warn(`Unknown plane type ${typeId}, using default warning radius`);
    const deviceScale = getDeviceScaleFactor();
    return DEFAULT_PLANE_TYPE.BASE_SIZE * DEFAULT_PLANE_TYPE.WARNING_PERCENTAGE * deviceScale;
  }
  return planeType.warningRadius;
}

/**
 * Get random plane type
 */
export function getRandomPlaneType(): PlaneTypeConfig {
  const types = getAllPlaneTypes();
  return types[Math.floor(Math.random() * types.length)];
}

/**
 * Get random color
 */
export function getRandomColor(): PlaneColor {
  return PLANE_COLORS[Math.floor(Math.random() * PLANE_COLORS.length)];
}

/**
 * Check if a color is valid
 */
export function isValidColor(color: string): color is PlaneColor {
  return PLANE_COLORS.includes(color as PlaneColor);
}

/**
 * Check if a color is available for a plane type (all types support all colors)
 */
export function isColorAvailableForType(typeId: number, color: string): boolean {
  const planeType = getPlaneTypeById(typeId);
  return planeType?.colors.includes(color) ?? false;
}

/**
 * Get default plane type (Type 1) - renamed to avoid conflict
 */
export function getDefaultPlaneTypeConfig(): PlaneTypeConfig {
  return getPlaneTypeById(DEFAULT_PLANE_TYPE.ID)!;
}

/**
 * Log all plane type configurations (for debugging)
 */
export function logPlaneTypeConfigs(): void {
  console.log('✈️ Plane Type Configurations:');
  console.log('Device type:', getDeviceType());
  console.log('Device scale:', getDeviceScaleFactor());
  console.log('Available colors:', PLANE_COLORS.join(', '));
  console.log('---');

  getAllPlaneTypes().forEach((type) => {
    console.log(`Type ${type.id}: ${type.name} (${type.manufacturer})`);
    console.log(`  Size: ${type.baseSize.toFixed(1)}px`);
    console.log(
      `  Collision: ${type.collisionRadius.toFixed(1)}px (${(
        (type.collisionRadius / type.baseSize) *
        100
      ).toFixed(0)}% of size)`
    );
    console.log(`  Warning: ${type.warningRadius.toFixed(1)}px`);
    console.log(`  Danger: ${type.dangerRadius.toFixed(1)}px`);
    console.log(`  Speed: ${type.speed.toFixed(2)} px/frame`);
    console.log(`  Turn: ${type.turnRate.toFixed(3)} rad/frame`);
    console.log(`  Weight: ${type.weightClass}`);
    console.log(`  Textures: ${type.colors.map((c) => `${type.id}-${c}.png`).join(', ')}`);
    console.log(`  Shadow: ${type.id}-shadow.png`);
    console.log('---');
  });
}

// Export device scale function for backwards compatibility
export { getDeviceScaleFactor };
