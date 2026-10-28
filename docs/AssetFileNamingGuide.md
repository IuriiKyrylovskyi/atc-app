# 🎨 Asset File Naming Guide

## 📁 Required Files Structure

```
packages/app/src/assets/planes/
├── 1-blue.png
├── 1-green.png
├── 1-yellow.png
├── 1-pink.png
├── 1-violet.png
├── 1-orange.png
├── 1-shadow.png          ← ONE shadow for ALL Type 1 planes
│
├── 2-blue.png
├── 2-green.png
├── 2-yellow.png
├── 2-pink.png
├── 2-violet.png
├── 2-orange.png
├── 2-shadow.png          ← ONE shadow for ALL Type 2 planes
│
├── 3-blue.png
├── 3-green.png
├── 3-yellow.png
├── 3-pink.png
├── 3-violet.png
├── 3-orange.png
├── 3-shadow.png          ← ONE shadow for ALL Type 3 planes
│
└── ... (Types 4-7 follow same pattern)
```

---

## 🔢 Plane Type Numbers

**IMPORTANT**: All planes of the SAME TYPE have IDENTICAL size and speed!

- Type number = Performance characteristics
- Color = Visual only (no effect on gameplay)

### **Type 1: Cessna (Light Aircraft)**

- **Size**: 50px (ALL Type 1 planes - regardless of color)
- **Speed**: 0.4 px/frame (ALL Type 1 planes - regardless of color)
- **Collision**: 50px (100% of sprite = full size)
- **Files needed**:
  - `1-blue.png` → 50px, 0.4 speed
  - `1-green.png` → 50px, 0.4 speed
  - `1-yellow.png` → 50px, 0.4 speed
  - `1-pink.png` → 50px, 0.4 speed
  - `1-violet.png` → 50px, 0.4 speed
  - `1-orange.png` → 50px, 0.4 speed
  - `1-shadow.png` (one shadow for all Type 1 colors)

### **Type 2: Regional Jet**

- **Size**: 65px (ALL Type 2 planes)
- **Speed**: 0.46 px/frame (ALL Type 2 planes)
- **Collision**: 65px (100% of sprite)
- **Files needed**:
  - `2-blue.png` → 65px, 0.46 speed
  - `2-green.png` → 65px, 0.46 speed
  - `2-yellow.png` → 65px, 0.46 speed
  - `2-pink.png` → 65px, 0.46 speed
  - `2-violet.png` → 65px, 0.46 speed
  - `2-orange.png` → 65px, 0.46 speed
  - `2-shadow.png`

### **Type 3: Narrow-body (Boeing 737 / A320)**

- **Size**: 80px (ALL Type 3 planes)
- **Speed**: 0.52 px/frame (ALL Type 3 planes)
- **Collision**: 80px (100% of sprite)
- **Files needed**:
  - `3-blue.png`, `3-green.png`, `3-yellow.png`, `3-pink.png`, `3-violet.png`, `3-orange.png`
  - `3-shadow.png`

### **Type 4: Wide-body (Boeing 777 / A330)**

- **Size**: 100px (ALL Type 4 planes)
- **Speed**: 0.56 px/frame (ALL Type 4 planes)
- **Collision**: 100px (100% of sprite)
- **Files needed**:
  - `4-blue.png`, `4-green.png`, `4-yellow.png`, `4-pink.png`, `4-violet.png`, `4-orange.png`
  - `4-shadow.png`

### **Type 5: Jumbo Jet (Boeing 747 / A380)**

- **Size**: 125px (ALL Type 5 planes)
- **Speed**: 0.6 px/frame (ALL Type 5 planes)
- **Collision**: 125px (100% of sprite)
- **Files needed**:
  - `5-blue.png`, `5-green.png`, `5-yellow.png`, `5-pink.png`, `5-violet.png`, `5-orange.png`
  - `5-shadow.png`

### **Type 6: Helicopter**

- **Size**: 35px (ALL Type 6 planes)
- **Speed**: 0.24 px/frame (ALL Type 6 planes)
- **Collision**: 35px (100% of sprite)
- **Files needed**:
  - `6-blue.png`, `6-green.png`, `6-yellow.png`, `6-pink.png`, `6-violet.png`, `6-orange.png`
  - `6-shadow.png`

### **Type 7: Fighter Jet**

- **Size**: 40px (ALL Type 7 planes)
- **Speed**: 0.8 px/frame (ALL Type 7 planes)
- **Collision**: 40px (100% of sprite)
- **Files needed**:
  - `7-blue.png`, `7-green.png`, `7-yellow.png`, `7-pink.png`, `7-violet.png`, `7-orange.png`
  - `7-shadow.png`

---

## 🎨 Color Variants

**CRITICAL**: All plane types support all 6 colors, and **COLOR DOES NOT AFFECT PERFORMANCE**!

Available colors:

- **blue** - Blue livery - rgb(107 196 237)
- **green** - Green livery - rgb(117 191 76)
- **yellow** - Yellow livery - rgb(246 202 72)
- **pink** - Pink livery - rgb(191 49 96)
- **violet** - Violet/purple livery - rgb(121 55 153)
- **orange** - Orange livery - rgb(210 106 30)
- **red** - Red livery - rgb(241 68 61)
- **shadow** - shadow - rgb(1 1 1)

### Examples:

- `1-blue.png` = 50px, 0.4 speed (Cessna, blue)
- `1-green.png` = 50px, 0.4 speed (Cessna, green) ← **SAME SIZE & SPEED!**
- `2-blue.png` = 65px, 0.46 speed (Regional Jet, blue)
- `2-yellow.png` = 65px, 0.46 speed (Regional Jet, yellow) ← **SAME SIZE & SPEED!**

**Color is purely cosmetic** - use it for visual variety or to match runway/waypoint requirements!

---

## 🌑 Shadow Files

- **One shadow per type**: `[number]-shadow.png`
- Used for ALL color variants of that plane type
- Example: `1-shadow.png` is used for `1-blue.png`, `1-green.png`, `1-yellow.png`, etc.
- Recommended: Semi-transparent (50% opacity), offset slightly bottom-right

---

## 📐 Image Specifications

### **Recommended Sprite Sizes:**

- Type 1: ~50×50px
- Type 2: ~65×65px
- Type 3: ~80×80px
- Type 4: ~100×100px
- Type 5: ~125×125px
- Type 6: ~35×35px
- Type 7: ~40×40px

### **Format:**

- PNG with transparency
- Top-down view
- **Facing RIGHT (→)** by default (0 degrees = East)
- Clean edges, high contrast

### **Shadow Specifications:**

- Same size as main sprite
- 50% opacity black/gray
- Slight offset (8px right, 8px down)

---

## 🔧 How the System Works

### **1. File Loading**

```typescript
// Game loads: "1-blue.png"
const planeType = getPlaneTypeFromTextureKey('1-blue');
// Returns: Type 1 config (Cessna, 50px, 0.4 speed)

const color = getColorFromTextureKey('1-blue');
// Returns: "blue"

const shadow = getShadowTextureKey(1);
// Returns: "1-shadow"
```

### **2. Spawning**

```typescript
// Random plane spawning
const planeType = getRandomPlaneType(); // e.g., Type 2
const color = getRandomColor(); // e.g., "green"
const texture = buildTextureKey(2, 'green'); // "2-green"
const shadow = getShadowTextureKey(2); // "2-shadow"

// Plane gets Type 2 properties:
// - Size: 65px (1.3x)
// - Speed: 0.46 (1.15x)
// - Collision: 65px (100% of sprite)
```

### **3. Collision Detection**

```typescript
// Collision radius = 100% of plane sprite size
Type 1 (50px): collision = 50px
Type 5 (125px): collision = 125px

// Warning zone = 140% of sprite size
Type 1: warning = 70px
Type 5: warning = 175px
```

---

## ✅ Quick Checklist

For a complete game with all 7 plane types:

- [ ] 42 plane sprites (7 types × 6 colors)
- [ ] 7 shadow sprites (1 per type)
- [ ] All sprites facing RIGHT (→)
- [ ] PNG with transparency
- [ ] Correct sizes relative to each other
- [ ] Shadows at 50% opacity

**Total files needed: 49 PNG files** (42 planes + 7 shadows)

---

## 🐛 Troubleshooting

### "Texture not found" errors?

- Check filename exactly matches: `[number]-[color].png`
- Verify files are in `packages/app/src/assets/planes/`
- No spaces, capital letters, or typos

### Planes too small/large?

- Check device scale multiplier in `DEVICE_SCALE_DEFAULTS`
- Verify sprite sizes are correct relative to Type 1

### Wrong collision size?

- Collision = 100% of sprite size (COLLISION_PERCENTAGE = 1.0)
- Check that `baseSize` matches your actual PNG dimensions

### Shadow not appearing?

- Verify `[number]-shadow.png` exists
- Check shadow is loaded in asset loader
- Ensure alpha channel is present (not fully opaque)

---

## 💡 Tips

1. **Start with Type 1**: Get all 6 colors working, then expand to other types
2. **Consistent style**: All plane sprites should have similar art style
3. **Test visibility**: Ensure sprites are visible on black background
4. **Size matters**: Larger planes should LOOK larger (relative sizing is critical)
5. **Color coding**: Consider using colors for different routes/airlines in gameplay

---

## 📊 Summary

| Type | Name     | Size  | Speed | Manufacturer  | Colors | Shadow       |
| ---- | -------- | ----- | ----- | ------------- | ------ | ------------ |
| 1    | Light    | 50px  | 0.4   | Cessna        | 6      | 1-shadow.png |
| 2    | Regional | 65px  | 0.46  | Bombardier    | 6      | 2-shadow.png |
| 3    | Narrow   | 80px  | 0.52  | Boeing/Airbus | 6      | 3-shadow.png |
| 4    | Wide     | 100px | 0.56  | Boeing/Airbus | 6      | 4-shadow.png |
| 5    | Jumbo    | 125px | 0.6   | Boeing/Airbus | 6      | 5-shadow.png |
| 6    | Heli     | 35px  | 0.24  | Various       | 6      | 6-shadow.png |
| 7    | Fighter  | 40px  | 0.8   | Military      | 6      | 7-shadow.png |

**Collision = 100% of sprite size for all types** 🎯
