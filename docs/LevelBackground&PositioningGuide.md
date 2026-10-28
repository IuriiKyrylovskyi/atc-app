<!-- obsolete // see Levelbackgrounds.md-->

# 🗺️ Level Background & Positioning Guide

## 📁 Background Image Structure

```
packages/app/src/assets/backgrounds/
├── 16x9/
│   ├── level-1.png    ← Level 1 — standard 16:9 screens
│   ├── level-2.png
│   ├── level-3.png
│   ├── level-4.png
│   └── level-5.png
├── 20x9/              ← iPhone X / 14 / 15 (tall screens)
│   └── level-1.png …
└── 19_5x9/            ← Most Android phones
    └── level-1.png …
```

The correct variant is selected at runtime by `aspectRatio_config.ts`. The game falls back to the `16x9` variant if a specific ratio asset is missing.

---

## 🎨 Background Image Specifications

| Property           | Value                                 |
| ------------------ | ------------------------------------- |
| **Dimensions**     | 1920 × 1080 px (16:9)                 |
| **Format**         | PNG (transparency optional)           |
| **Max file size**  | 2 MB for performance                  |
| **Perspective**    | Top-down                              |
| **Colour palette** | Muted — planes must stand out clearly |

### What to include

- Runway strips with threshold markings
- Taxiway paths (optional detail)
- Terminal buildings and structures (visual only)
- Ground cover: grass, tarmac, aprons
- Compass indicator (N/S/E/W) for orientation

---

## 📐 Positioning System

### How it works

All runway and waypoint positions are stored as **fractions (0.0 – 1.0)** of the world canvas (1920 × 1080). At runtime `GameScene.convertRawLevel()` converts them to world-local coordinates:

```ts
worldLocalX = fraction * 1920 - 960; // centres on worldContainer origin
worldLocalY = fraction * 1080 - 540;
```

### Coordinate origin

```
(0.0, 0.0)                    (1.0, 0.0)
     ┌──────────────────────────┐
     │                          │
     │     (0.5, 0.5) = centre  │
     │                          │
     └──────────────────────────┘
(0.0, 1.0)                    (1.0, 1.0)
```

### Common reference positions

| Position      | centerX | centerY |
| ------------- | ------- | ------- |
| Top-left      | 0.0     | 0.0     |
| Top-centre    | 0.5     | 0.0     |
| Top-right     | 1.0     | 0.0     |
| Left          | 0.0     | 0.5     |
| Centre        | 0.5     | 0.5     |
| Right         | 1.0     | 0.5     |
| Bottom-left   | 0.0     | 1.0     |
| Bottom-centre | 0.5     | 1.0     |
| Bottom-right  | 1.0     | 1.0     |

---

## ✈️ Runway Configuration

```ts
{
  id: 'RWY09R',
  centerX: 0.25,          // horizontal fraction (0–1)
  centerY: 0.8,           // vertical fraction   (0–1)
  direction: 0,           // heading in radians
  length: 200,            // visual length (world units)
  width: 20,              // visual width  (world units)
  allowedColors: ['blue', 'green'],
}
```

### Direction (radians)

| Compass | Degrees | Radians | Runway name |
| ------- | ------- | ------- | ----------- |
| East →  | 0°      | 0       | RWY09       |
| SE ↘    | 45°     | π/4     | RWY13       |
| South ↓ | 90°     | π/2     | RWY18       |
| SW ↙    | 135°    | 3π/4    | RWY22       |
| West ←  | 180°    | π       | RWY27       |
| NW ↖    | 225°    | 5π/4    | RWY31       |
| North ↑ | 270°    | 3π/2    | RWY36       |
| NE ↗    | 315°    | 7π/4    | RWY04       |

Conversion: `radians = (degrees × Math.PI) / 180`

### Landing vs. departure direction

- `direction 0` (East →): planes land from the west and depart to the east
- `direction π` (West ←): planes land from the east and depart to the west
- The runway has two key points: **landing point** (where planes touch down) and **departure point** (where planes take off from)

---

## 🎯 Waypoint Configuration

```ts
{
  name: 'ALPHA',          // up to 5 characters, shown in UI
  x: 0.97,                // horizontal fraction — keep ≥ 0.03 and ≤ 0.97
  y: 0.5,                 // vertical fraction
  description: 'Exit east',
  allowedColors: ['orange', 'violet'],
}
```

### Recommended edge positions

| Edge   | x range     | y range     | Planes exit |
| ------ | ----------- | ----------- | ----------- |
| Right  | 0.95 – 0.97 | any         | East        |
| Left   | 0.03 – 0.05 | any         | West        |
| Top    | any         | 0.03 – 0.05 | North       |
| Bottom | any         | 0.95 – 0.97 | South       |

Waypoints are automatically edge-pinned to the **visible viewport** on every resize via `snapWaypointsToEdges()`.

---

## 🎨 Creating Level Backgrounds — Step by Step

### Step 1: Create the canvas

1. Open any image editor (Photoshop, GIMP, Figma, Pixelmator)
2. Create a **1920 × 1080** canvas
3. Design the airport top-down: ground, runways, taxiways, buildings
4. Keep colours muted so coloured planes stand out

### Step 2: Measure runway positions

For each runway, note the pixel position of its **centre**:

```
Runway centre at pixel (480, 864) on a 1920×1080 canvas:
  centerX = 480 / 1920 = 0.25
  centerY = 864 / 1080 = 0.80
```

### Step 3: Measure runway direction

1. Find the runway heading from your design
2. Convert to radians using the table above

### Step 4: Update `levels_config.ts`

```ts
{
  id: 'level3',
  name: 'Level 3: Rush Hour',
  backgroundImage: 'level-3',   // loads from backgrounds/16x9/level-3.png
  spawnRate: 0.008,
  minPlanes: 3,
  maxPlanes: 7,
  runways: [
    {
      id: 'RWY09R',
      centerX: 0.25,
      centerY: 0.80,
      direction: 0,
      length: 220,
      width: 22,
      allowedColors: ['blue', 'green', 'red'],
    },
  ],
  waypoints: [
    {
      name: 'ALPHA',
      x: 0.97,
      y: 0.5,
      description: 'Exit east',
      allowedColors: ['orange', 'violet', 'yellow'],
    },
  ],
}
```

---

## 🔧 Testing & Validation

### In-game validation

```js
// Browser console after loading the level:
import { logLevelConfig } from '@/game/config/levels_config';
logLevelConfig('level3');
// Prints all runways and waypoints with computed world-local coords
```

### Visual alignment check

1. Load the level in game
2. Enable debug mode (`gameScene.toggleDebug()` in console)
3. Runway outlines render on the background — adjust `centerX`/`centerY` until aligned

### Resize test

1. Resize the browser window (desktop)
2. Rotate device (mobile)
3. Runways should stay over their background markings — they inherit the worldContainer transform automatically
4. Waypoints should remain at screen edges — `snapWaypointsToEdges()` handles this

---

## 📋 Level Design Examples

### Level 1 — Tutorial

- 2 runways (parallel, one colour each)
- 1 waypoint (east edge)
- Low spawn rate, small plane count

### Level 2 — Busy Airport

- 3 runways (varied angles)
- 2 waypoints (east + west)
- Moderate spawn rate

### Level 3 — Rush Hour

- 3 runways (diagonal orientations)
- 2 waypoints (NE + SW)
- Higher spawn rate, crossing traffic

### Level 4 — Parallel Ops

- 4 runways (2 parallel sets)
- 3 waypoints (N / E / S)
- High traffic volume

### Level 5 — Master Challenge

- 4 runways (intersecting)
- 4 waypoints (all four edges)
- Maximum complexity and spawn rate

---

## ✅ Checklist

Before shipping a new level:

- [ ] Background images created for all three ratio folders (16x9, 20x9, 19_5x9)
- [ ] Files named `level-N.png` (not `levelN.png`)
- [ ] Runway fractions measured from the 1920×1080 image
- [ ] Runway directions in radians
- [ ] Waypoints placed at screen edges (0.03 – 0.97 range)
- [ ] Entry added to `levels_config.ts`
- [ ] Tested at desktop, tablet, and mobile sizes
- [ ] Validated with `logLevelConfig()`
- [ ] Checked on both landscape and the portrait-rotation warning screen

---

## 🐛 Troubleshooting

| Problem                             | Likely cause                         | Fix                                  |
| ----------------------------------- | ------------------------------------ | ------------------------------------ |
| Runways don't align with background | Wrong pixel → fraction calculation   | Re-measure on the 1920×1080 image    |
| Background not loading              | Wrong filename or wrong folder       | Check `backgrounds/16x9/level-N.png` |
| Background stretched                | Image not 16:9                       | Resize canvas to 1920×1080           |
| Waypoints off-screen after resize   | Fractional value too close to 0 or 1 | Use 0.03 – 0.97 range                |
| Runway not visible                  | Placed outside 0.1–0.9 range         | Move to safe zone                    |

---

## 📚 Summary

```ts
// Pixel → fraction
centerX = pixelX / 1920;
centerY = pixelY / 1080;

// Degrees → radians
radians = (degrees * Math.PI) / 180;

// Fraction → world-local (done automatically by GameScene)
worldX = fraction * 1920 - 960;
worldY = fraction * 1080 - 540;

// World-local → screen (done automatically by Phaser)
screenX = worldContainer.x + worldX * worldScale;
screenY = worldContainer.y + worldY * worldScale;
```
