// packages/electron/build.cjs
const { build } = require('esbuild');
const {
  rmSync,
  mkdirSync,
  cpSync,
  existsSync,
  writeFileSync,
  copyFileSync,
  readFileSync,
} = require('fs');
const path = require('path');

const isWatch = process.argv.includes('--watch');
// Dev: compile main + preload only (the window loads the Vite dev server, no app-dist needed).
const isMainOnly = process.argv.includes('--main-only');

// -----------------------------------------------------------------------------
// 🧩 Paths
// -----------------------------------------------------------------------------
const rootDir = __dirname;
const outDir = path.resolve(rootDir, 'dist');
const vueDist = path.resolve(rootDir, '../app/dist');
const appDist = path.resolve(rootDir, 'app-dist');
const buildDir = path.resolve(rootDir, 'app-build');
const releaseDir = path.resolve(rootDir, 'release');
const electronPkgPath = path.resolve(rootDir, 'package.json');
const appPkgPath = path.resolve(rootDir, '../app/package.json');

const iconIco = path.join(buildDir, 'icon.ico');
const iconIcns = path.join(buildDir, 'icon.icns');
const entitlementsFile = path.join(buildDir, 'entitlements.mac.plist');

const vueIconIco = path.resolve(rootDir, '../app/public/favicon.ico');
const vueIconPng = path.resolve(rootDir, '../app/public/icon.png');

// -----------------------------------------------------------------------------
// ⚙️ esbuild compile (main + preload)
// -----------------------------------------------------------------------------
const base = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['electron'],
  minify: true,
};

function compile() {
  return Promise.all([
    build({
      ...base,
      entryPoints: ['src/main.ts'],
      outfile: path.join(outDir, 'main.js'),
    }),
    build({
      ...base,
      entryPoints: ['src/preload.ts'],
      outfile: path.join(outDir, 'preload.js'),
    }),
  ]).then(() => {
    console.log('✅ Compiled Electron main + preload');
  });
}

if (isMainOnly) {
  mkdirSync(outDir, { recursive: true });
  compile().catch((err) => {
    console.error('❌ Build failed:', err);
    process.exit(1);
  });
} else if (isWatch) {
  mkdirSync(outDir, { recursive: true });
  compile().then(() => {
    console.log('👀 Watching for changes...');
    build({
      ...base,
      entryPoints: ['src/main.ts'],
      outfile: path.join(outDir, 'main.js'),
      watch: {
        onRebuild(error) {
          if (error) console.error('❌ main.ts rebuild failed:', error);
          else console.log('✅ main.ts rebuilt');
        },
      },
    });
    build({
      ...base,
      entryPoints: ['src/preload.ts'],
      outfile: path.join(outDir, 'preload.js'),
      watch: {
        onRebuild(error) {
          if (error) console.error('❌ preload.ts rebuild failed:', error);
          else console.log('✅ preload.ts rebuilt');
        },
      },
    });
  }).catch((err) => {
    console.error('❌ Build failed:', err);
    process.exit(1);
  });
} else {
  // -----------------------------------------------------------------------------
  // 🧹 Clean + recreate essential directories
  // -----------------------------------------------------------------------------
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  mkdirSync(buildDir, { recursive: true });
  mkdirSync(releaseDir, { recursive: true });

  // -----------------------------------------------------------------------------
  // 🔁 Sync metadata (version, description only) from app → electron
  // -----------------------------------------------------------------------------
  try {
    const appPkg = JSON.parse(readFileSync(appPkgPath, 'utf8'));
    const electronPkg = JSON.parse(readFileSync(electronPkgPath, 'utf8'));

    const fieldsToSync = ['version', 'description'];
    for (const key of fieldsToSync) {
      if (appPkg[key]) electronPkg[key] = appPkg[key];
    }

    if (!electronPkg.name || electronPkg.name === appPkg.name) {
      electronPkg.name = '@atc-app/electron';
    }

    writeFileSync(electronPkgPath, JSON.stringify(electronPkg, null, 2));
    console.log('🧩 Synced version & description from @atc-app/app → @atc-app/electron');
  } catch (err) {
    console.warn('⚠️ Could not sync metadata:', err.message);
  }

  // -----------------------------------------------------------------------------
  // 🧱 Ensure icons & entitlements exist
  // -----------------------------------------------------------------------------
  if (existsSync(vueIconIco)) {
    copyFileSync(vueIconIco, iconIco);
    console.log('🪄 Copied real icon.ico from app/public/');
  } else if (existsSync(vueIconPng)) {
    copyFileSync(vueIconPng, iconIco);
    console.log('🪄 Copied real icon.png → icon.ico');
  } else if (!existsSync(iconIco)) {
    writeFileSync(iconIco, '');
    console.log('🧩 Created placeholder app-build/icon.ico');
  }

  if (existsSync(vueIconPng)) {
    copyFileSync(vueIconPng, iconIcns);
    console.log('🪄 Copied real icon.png → icon.icns');
  } else if (!existsSync(iconIcns)) {
    writeFileSync(iconIcns, '');
    console.log('🧩 Created placeholder app-build/icon.icns');
  }

  if (!existsSync(entitlementsFile)) {
    writeFileSync(
      entitlementsFile,
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>com.apple.security.app-sandbox</key>
    <false/>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
    <key>com.apple.security.device.audio-input</key>
    <true/>
    <key>com.apple.security.device.camera</key>
    <true/>
    <key>com.apple.security.files.user-selected.read-write</key>
    <true/>
    <key>com.apple.security.network.client</key>
    <true/>
    <key>com.apple.security.network.server</key>
    <true/>
  </dict>
</plist>`
    );
    console.log('🧩 Created default app-build/entitlements.mac.plist');
  }

  compile()
    .then(() => {
      if (!existsSync(vueDist)) {
        console.error('❌ Vue build not found at', vueDist);
        process.exit(1);
      }

      rmSync(appDist, { recursive: true, force: true });
      cpSync(vueDist, appDist, { recursive: true });

      console.log('✅ Copied Vue dist → app-dist');
      console.log('✅ Verified build folders (app-build/, dist/, release/)');
    })
    .catch((err) => {
      console.error('❌ Build failed:', err);
      process.exit(1);
    });
}
