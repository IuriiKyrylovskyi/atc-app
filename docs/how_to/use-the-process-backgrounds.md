That is everything you need to unify your level design! You have a robust, automated pipeline that turns high-res source images into perfectly cropped, muted game assets, and a clean configuration schema that handles responsive gameplay.

Here is how you use the `process-backgrounds` script to make it work.

### 1. The Setup (Prerequisites)

Ensure you have the required dependency installed. Run this in your terminal:

```bash
npm install sharp
```

_Note: If you are using TypeScript for your scripts, ensure you have `ts-node` installed (`npm install -D ts-node`), or compile the script to JavaScript first._

### 2. Prepare your Source Material

1.  Take your **Google Earth Pro** screenshot (or stitched ultra-wide image) on Camera/eye altitude 20km.
2.  Image should satisfy 1.51 aspect ratio (4800x3165, 5048x3328). It could be adjusted on cutting sides with google watermark.
3.  Save it as a high-quality PNG (e.g., `level-1-master.png`).
4.  Place it in a folder named `raw_assets/` in your project root.

### 3. Running the Script

You can trigger the script directly from your terminal by pointing it to your master image:

```bash
# Using ts-node to run the script directly
npx ts-node scripts/process-backgrounds.ts ./raw_assets/level-1-master.png
```

You can now also target a single level by number or skip regenerating files that already exist:

```bash
# Process a single level by number (looks for raw_assets/level-<N>* files)
npx ts-node scripts/process-backgrounds.ts --level 6

# Same as above (short form)
npx ts-node scripts/process-backgrounds.ts -l 6

# Skip generating variants that already exist (useful for incremental work)
npx ts-node scripts/process-backgrounds.ts -l 6 --skip-existing
# Short form:
npx ts-node scripts/process-backgrounds.ts -l 6 -s

# Process all master files in raw_assets (existing outputs will be overwritten unless --skip-existing is used)
npx ts-node scripts/process-backgrounds.ts ./raw_assets/*.png
```

**What happens when you run this:**

- **Auto-Mute:** The `sharp` library automatically applies your brightness/saturation requirements.
- **Auto-Crop:** It creates four distinct versions (`16x9`, `20x9`, `19_5x9`, `16x10`) based on the standard aspect ratios you need.
- **Auto-Folder:** It handles the folder creation automatically, placing the finished assets exactly where your `GameScene` expects them (`packages/app/src/assets/backgrounds/...`).

### 4. Integrating into your Build Process

To make this professional and "developer-proof," add it to your `package.json` **scripts** section so that your team just has to run one command:

```json
"scripts": {
  "build:levels": "ts-node scripts/process-backgrounds.ts ./raw_assets/*.png"
}
```

Now, whenever you add a new level, you just drop the master image into `raw_assets/` and run `npm run build:levels`.

### Mobile Zoom Configuration

Large master images can make runways appear tiny on mobile crops. To improve runway visibility on phones, the processing script supports a configurable "mobile zoom". Create or edit `scripts/process-backgrounds.config.json` with values like:

```json
{
  "mobileZoom": 1.25,
  "mobileRatios": ["20x9", "19_5x9", "19x9", "18_5x9", "18x9"]
}
```

- `mobileZoom`: multiplier applied to mobile crops before a centered crop is taken (values &gt;1 zoom in). Default: `1.25`.
- `mobileRatios`: which aspect-ratio folders should receive the zoom treatment.

When `mobileZoom` &gt; 1 the script will first scale the source by the multiplier and then extract a centered `width x height` crop. This preserves runway position while making details larger in the mobile images.

---

### Pro-Tip for "Positioning Validation"

Since you now have a 0–100% waypoint system and a fixed runway coordinate system, here is how you test it:

1.  **Run the script** to generate your images.
2.  **Launch the game** on your development machine.
3.  **Use your "Debug Mode"** to draw a 1-pixel border around your `1920x1080` (16:9) safe zone.
4.  **Rotate/Resize the window:** If you see your waypoints stay pinned to the edges of the window while the runway stays fixed in the center, your automation logic is perfectly configured.

**You are now set up to scale from 1 level to 100 levels without manual image editing!** Is there anything else you need to configure for the `GameScene` logic, or are you ready to start building the levels?
