<!-- obsolete // see Levelbackgrounds.md-->

# 🗺️ Level Background & Positioning Guide

## 📏 Measuring for Config

1. Open your **1920×1080 (16:9)** exported asset in your editor.
2. Get the pixel coordinates of the runway center.
3. **Calculation**:
   - `centerX = pixelX / 1920`
   - `centerY = pixelY / 1080`

## 📍 Waypoint Placement

- To spawn planes from the left: Set `x: 0`.
- To spawn planes from the top: Set `y: 0`.
- For internal waypoints: Use values between `5` and `95` to ensure they don't touch the glass edges.

## 🐛 Troubleshooting

| Problem           | Cause                | Fix                                                  |
| :---------------- | :------------------- | :--------------------------------------------------- |
| Runway misaligned | Wrong anchor in code | Ensure `background.setOrigin(0.5)` is used.          |
| Waypoints hidden  | x/y is < 0 or > 100  | Keep within the 0–100 percentage range.              |
| Background blurry | Low-res source       | Re-export from Google Earth at "Maximum" resolution. |
