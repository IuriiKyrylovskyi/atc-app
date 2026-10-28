# 📱 Aspect Ratio Background System Setup Guide

## 📁 Required Folder Structure

```
packages/app/src/assets/backgrounds/
├── 16x9/              ← Desktop & Standard HD
│   ├── level-1.png
│   ├── level-2.png
│   ├── level-3.png
│   ├── level-4.png
│   └── level-5.png
│
├── 16x10/             ← MacBook Pro (optional)
│   ├── level-1.png
│   ├── level-2.png
│   └── ...
│
├── 19_5x9/            ← Galaxy S21, Pixel 6
│   ├── level-1.png
│   ├── level-2.png
│   ├── level-3.png
│   ├── level-4.png
│   └── level-5.png
│
├── 20x9/              ← iPhone 12/13/14/15
│   ├── level-1.png
│   ├── level-2.png
│   ├── level-3.png
│   ├── level-4.png
│   └── level-5.png
│
├── 21x9/              ← Sony Xperia (optional)
│   └── ...
│
├── 19x9/              ← Galaxy S10 (optional)
│   └── ...
│
└── 18x9/              ← Galaxy S8/S9 (optional)
    └── ...
```

---

## 🎯 Priority Folders

### **MUST HAVE** (Covers 90% of devices):

1. **`16x9/`** - Desktop, laptops, most displays

   - Resolution: 1920×1080
   - Most common aspect ratio

2. **`19_5x9/`** - Modern Android phones

   - Resolution: 2340×1080
   - Galaxy S21, Pixel 6, OnePlus 9

3. **`20x9/`** - Modern iPhones
   - Resolution: 2400×1080
   - iPhone 12, 13, 14, 15 series

### **NICE TO HAVE** (Extra coverage):

4. **`16x10/`** - MacBook Pro

   - Resolution: 1920×1200

5. **`21x9/`** - Ultra-wide mobiles

   - Resolution: 2520×1080
   - Sony Xperia series

6. **`4x3/`** - iPads in landscape
   - Resolution: 2048×1536

---

## 📐 Image Specifications

### **Desktop (16x9)**

```
Resolution: 1920×1080 pixels
Aspect Ratio: 16:9 (1.778)
Devices: Desktop, laptop, TV
```

### **Mobile 19.5:9**

```
Resolution: 2340×1080 pixels
Aspect Ratio: 19.5:9 (2.167)
Devices: Galaxy S21, Pixel 6, OnePlus 9
```

### **Mobile 20:9**

```
Resolution: 2400×1080 pixels
Aspect Ratio: 20:9 (2.222)
Devices: iPhone 12/13/14/15, many Android flagships
```

### **Mobile 21:9**

```
Resolution: 2520×1080 pixels
Aspect Ratio: 21:9 (2.333)
Devices: Sony Xperia 1/5/10 series
```

---

## 🎨 Creating Backgrounds for Different Ratios

### **Method 1: Design for Mobile, Scale for Desktop**

1. **Start with mobile** (19.5:9 or 20:9)

   - Design at 2400×1080
   - More vertical space for runways

2. **Crop for desktop** (16:9)
   - Crop center to 1920×1080
   - Keep important elements in center

### **Method 2: Design for Desktop, Extend for Mobile**

1. **Start with desktop** (16:9)

   - Design at 1920×1080
   - Standard wide layout

2. **Extend vertically for mobile**
   - Add extra height: 2400×1080
   - Extend top/bottom with more detail

### **Method 3: Individual Designs (Best)**

1. **Tailor each ratio separately**
   - 16x9: Wide, horizontal runway emphasis
   - 19.5x9/20x9: Taller, more vertical space
   - Unique layouts optimized per ratio

---

## 🔧 How Detection Works

### **Automatic Detection:**

```typescript
// System detects on game load:
const aspectInfo = detectAspectRatio();

// Example outputs:
Desktop 1920×1080    → ratio: '16x9'
iPhone 15 (1179×2556) → ratio: '20x9'
Galaxy S21 (1080×2400) → ratio: '19_5x9'
```

### **File Loading:**

```typescript
// System builds path automatically:
Desktop → '@/assets/backgrounds/16x9/level-1.png'
iPhone  → '@/assets/backgrounds/20x9/level-1.png'
Galaxy  → '@/assets/backgrounds/19_5x9/level-1.png'
```

### **Fallback System:**

```
1. Try exact match: level-1-20x9
2. If not found, try: level-1-16x9 (common fallback)
3. If still not found, try: any level-1-* variant
4. If none exist, show error
```

---

## 📝 Setup Checklist

### **Phase 1: Minimum Viable (Quick Start)**

- [ ] Create `16x9/` folder
- [ ] Create `20x9/` folder (iPhone)
- [ ] Create `19_5x9/` folder (Android)
- [ ] Design level-1 for all 3 ratios
- [ ] Test on desktop browser
- [ ] Test on iPhone (20:9)
- [ ] Test on Android (19.5:9)

### **Phase 2: Full Coverage**

- [ ] Add all 5 levels to each ratio
- [ ] Optional: Add `16x10/` for MacBook
- [ ] Optional: Add `21x9/` for Xperia
- [ ] Test aspect ratio switching
- [ ] Verify fallbacks work
- [ ] Check all devices load correctly

---

## 🧪 Testing Commands

### **In Browser Console:**

```javascript
// Check current aspect ratio
import { logAspectRatioInfo } from '@/game/config/aspectRatio.config';
logAspectRatioInfo();

// Output:
// 📐 Aspect Ratio Information:
//    Current: 20x9 (2.222)
//    Screen: 1179×2556
//    Device Type: Mobile
//    Recommended Image Size: 2400×1080
//    Background Path: @/assets/backgrounds/20x9/level-1.png
//    Background Key: level-1-20x9
```

```javascript
// List all supported ratios
import { listSupportedRatios } from '@/game/config/aspectRatio.config';
listSupportedRatios();
```

```javascript
// Calculate aspect ratio of your design
import { calculateAspectRatio } from '@/game/config/aspectRatio.config';
calculateAspectRatio(2400, 1080);
// Output: { decimal: 2.222, simplified: "20:9", name: "iPhone 12/13/14" }
```

---

## 🎨 Design Tips

### **For Mobile (Tall Ratios):**

- ✅ More vertical runway arrangements
- ✅ Utilize extra height for taxiways
- ✅ Stack terminals vertically
- ✅ Keep important elements centered
- ✅ Test visibility on narrow screens

### **For Desktop (Wide Ratios):**

- ✅ Horizontal runway emphasis
- ✅ Wide terminal arrangements
- ✅ More side-by-side elements
- ✅ Utilize full width
- ✅ Add peripheral details

### **Universal Rules:**

- ✅ Keep runways/waypoints in safe zone (10% margin)
- ✅ Use consistent color palette across ratios
- ✅ Maintain visual style between variants
- ✅ Test on actual devices when possible
- ✅ Use percentage positioning (0.0-1.0)

---

## 🔍 Common Issues & Solutions

### **Issue: Background not loading on iPhone**

```
❌ Background not found: level-1-20x9
```

**Solution:**

- Check file exists: `backgrounds/20x9/level-1.png`
- Verify folder name: `20x9` NOT `20×9` or `20_9`
- Ensure file is PNG format
- Restart dev server after adding files

### **Issue: Wrong aspect ratio detected**

```
⚠️ No exact match, using closest: 16x9
```

**Solution:**

- Add tolerance in `aspectRatio.config.ts`
- Create background for detected ratio
- System will use fallback if exact match missing

### **Issue: Background stretched/distorted**

**Solution:**

- Verify image dimensions match folder name:
  - `16x9/` → 1920×1080
  - `20x9/` → 2400×1080
  - `19_5x9/` → 2340×1080
- Use `getRecommendedDimensions()` to check

### **Issue: Desktop shows mobile background**

**Solution:**

- Check screen width detection (< 768px = mobile)
- System uses landscape dimensions
- Portrait mode should trigger rotation warning

---

## 📊 Device Coverage

### **By Ratio:**

| Ratio  | % Coverage | Devices                       |
| ------ | ---------- | ----------------------------- |
| 16x9   | 45%        | Desktop, laptop, older phones |
| 20x9   | 25%        | iPhone 12-15, many Android    |
| 19.5x9 | 20%        | Galaxy S21+, Pixel 6+         |
| 16x10  | 5%         | MacBook Pro                   |
| 21x9   | 3%         | Sony Xperia                   |
| Other  | 2%         | Various                       |

**Priority Implementation:**

1. **16x9** (desktop baseline)
2. **20x9** (iPhone coverage)
3. **19_5x9** (Android coverage)
4. Rest optional

---

## 🚀 Quick Start (Minimal Setup)

### **Option 1: Single Ratio (Testing)**

```
backgrounds/
└── 16x9/
    └── level-1.png (1920×1080)
```

- Works for desktop
- Falls back for all mobile devices

### **Option 2: Multi-Device (Production)**

```
backgrounds/
├── 16x9/          ← Desktop
│   └── level-1.png (1920×1080)
├── 20x9/          ← iPhone
│   └── level-1.png (2400×1080)
└── 19_5x9/        ← Android
    └── level-1.png (2340×1080)
```

- Covers 90% of devices
- Optimal experience everywhere

---

## ✅ Success Criteria

Your aspect ratio system works when:

✅ Desktop loads `16x9/` backgrounds
✅ iPhone loads `20x9/` backgrounds
✅ Android loads `19_5x9/` backgrounds
✅ Console shows correct aspect ratio detection
✅ Fallback works if exact match missing
✅ Runways stay aligned after window resize
✅ No stretching or distortion
✅ Background changes if aspect ratio changes (rotate device)

---

## 💡 Pro Tips

1. **Start with 16x9 only** - Get it working, then expand
2. **Use Figma frames** - Create artboards for each ratio
3. **Design mobile-first** - Easier to crop than extend
4. **Test real devices** - Simulators aren't perfect
5. **Use console logging** - `logAspectRatioInfo()` is your friend
6. **Keep file sizes low** - Compress PNGs (< 500KB each)
7. **Version control** - Track which ratios you've completed
8. **Document changes** - Note runway position adjustments per ratio

---

## 📚 File Naming Reference

✅ **CORRECT:**

```
16x9/level-1.png
20x9/level-2.png
19_5x9/level-3.png    ← Note underscore for decimal
```

❌ **WRONG:**

```
16×9/level-1.png      ← × symbol, not 'x'
20x9/level_1.png      ← Underscore in filename
19.5x9/level-1.png    ← Decimal point, not underscore
level-1-20x9.png      ← Wrong location (not in folder)
```

---

Your system now auto-detects device ratios and loads the perfect background! 🎯
