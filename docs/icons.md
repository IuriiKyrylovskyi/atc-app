# App Icon Specifications: Air Traffic Control Game

## 1. Desktop (Electron)

Electron requires container files that hold multiple resolutions to support different display scaling.

| Platform    | Format  | Recommended Master Size | Notes                                            |
| :---------- | :------ | :---------------------- | :----------------------------------------------- |
| **macOS**   | `.icns` | 1024 × 1024 px          | Includes sizes: 16, 32, 64, 128, 256, 512, 1024. |
| **Windows** | `.ico`  | 256 × 256 px            | Includes sizes: 16, 32, 48, 256.                 |

---

## 2. Mobile & Tablet (iOS / iPadOS)

Apple requires a flat PNG. The system automatically applies the rounded corner mask (do not include it in your source file).

| Usage                  | Size (px)   | Density     |
| :--------------------- | :---------- | :---------- |
| **App Store**          | 1024 × 1024 | 1x (Master) |
| **iPhone Home Screen** | 180 × 180   | @3x         |
| **iPhone Home Screen** | 120 × 120   | @2x         |
| **iPad Pro**           | 167 × 167   | @2x         |
| **iPad Air / Mini**    | 152 × 152   | @2x         |

---

## 3. Mobile & Tablet (Android)

Android uses **Adaptive Icons** consisting of two separate layers.

- **Background Layer:** The solid blue gradient (108 x 108 dp).
- **Foreground Layer:** The plane(s) and tower with transparency (108 x 108 dp).

| Density Bucket        | Icon Size (px) |
| :-------------------- | :------------- |
| **Google Play Store** | 512 × 512      |
| **xxxhdpi**           | 192 × 192      |
| **xxhdpi**            | 144 × 144      |
| **xhdpi**             | 96 × 96        |
| **hdpi**              | 72 × 72        |
| **mdpi**              | 48 × 48        |

---

## 4. Critical Implementation Tips

- **The Safe Zone:** Keep all critical visual elements (the tower and the planes) within the center **66px** of the 108px Android asset, or the center **80%** of the iOS asset to avoid clipping.
- **Transparency:** \* **iOS:** No transparency allowed (fill corners with background color).
  - **Android:** Foreground layer _must_ have transparency; Background layer _must_ be opaque.
- **Tools:** Use `electron-icon-builder` for desktop and the Android Studio Image Asset Studio for mobile to automate the resizing process.
