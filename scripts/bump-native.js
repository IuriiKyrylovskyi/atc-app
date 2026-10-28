#!/usr/bin/env node
// =============================================================================
// scripts/bump-native.js
// =============================================================================
//
// Reads the version from the root package.json and syncs it to:
//   • packages/mobile/android/app/build.gradle  (versionCode + versionName)
//   • packages/mobile/ios/App/App.xcodeproj/project.pbxproj
//                                               (CURRENT_PROJECT_VERSION + MARKETING_VERSION)
//
// ── HOW IT'S CALLED ──────────────────────────────────────────────────────────
//
//   Automatically, via standard-version's "postbump" lifecycle hook —
//   fires after package.json versions are written but before the git commit.
//
//   Also callable manually:
//     node scripts/bump-native.js
//     pnpm run version:sync
//
// ── VERSION CODE FORMULA ─────────────────────────────────────────────────────
//
//   Both Android versionCode and iOS CURRENT_PROJECT_VERSION must be
//   monotonically increasing integers.  We derive them deterministically
//   from semver so the value is reproducible from any machine:
//
//     versionCode = major × 10000 + minor × 100 + patch
//
//   Examples:
//     0.0.38  →     38
//     0.1.5   →    105
//     0.2.0   →    200
//     1.0.0   →  10000
//     1.2.3   →  10203
//
//   This gives ample headroom: up to 99 patch releases per minor,
//   99 minor releases per major.  If you ever need > 99 patches, change
//   the multiplier here and note the change in CHANGELOG.
//
// =============================================================================

'use strict';

const fs = require('fs');
const path = require('path');

// Resolve paths relative to the monorepo root (this script lives in scripts/)
const ROOT = path.resolve(__dirname, '..');

// ── Read new version ──────────────────────────────────────────────────────────

const rootPkgPath = path.join(ROOT, 'package.json');
const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8'));
const version = rootPkg.version; // e.g. "0.1.38"

if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
  console.error(`❌  Invalid version in root package.json: "${version}"`);
  process.exit(1);
}

const [major, minor, patch] = version.split('.').map(Number);
const versionCode = major * 10000 + minor * 100 + patch;

console.log(`\n📦  Syncing native versions → ${version}  (code: ${versionCode})\n`);

let allOk = true;

// ── Android ───────────────────────────────────────────────────────────────────
//
// Target file:  packages/mobile/android/app/build.gradle
// Fields:       versionCode <integer>
//               versionName "<semver>"

const gradlePath = path.join(ROOT, 'packages/mobile/android/app/build.gradle');

if (fs.existsSync(gradlePath)) {
  let gradle = fs.readFileSync(gradlePath, 'utf8');

  const beforeGradle = gradle;
  gradle = gradle
    .replace(/versionCode\s+\d+/, `versionCode ${versionCode}`)
    .replace(/versionName\s+"[^"]*"/, `versionName "${version}"`);

  if (gradle === beforeGradle) {
    console.warn('⚠️   Android: no changes made — versionCode/versionName fields not found.');
    console.warn(`     Check that ${gradlePath} contains the expected fields.`);
    allOk = false;
  } else {
    fs.writeFileSync(gradlePath, gradle, 'utf8');
    console.log(`✅  Android: versionCode = ${versionCode},  versionName = "${version}"`);
  }
} else {
  console.warn(`⚠️   Android build.gradle not found:`);
  console.warn(`     ${gradlePath}`);
  console.warn(`     If you haven't run "cap add android" yet this is expected.`);
  allOk = false;
}

// ── iOS ───────────────────────────────────────────────────────────────────────
//
// Target file:  packages/mobile/ios/App/App.xcodeproj/project.pbxproj
// Fields:       CURRENT_PROJECT_VERSION = <integer>;    (appears twice: Debug + Release)
//               MARKETING_VERSION = <semver>;            (appears twice: Debug + Release)

const pbxprojPath = path.join(ROOT, 'packages/mobile/ios/App/App.xcodeproj/project.pbxproj');

if (fs.existsSync(pbxprojPath)) {
  let pbx = fs.readFileSync(pbxprojPath, 'utf8');

  const beforePbx = pbx;
  pbx = pbx
    // Replaces ALL occurrences (Debug + Release build configs)
    .replace(/CURRENT_PROJECT_VERSION = \d+;/g, `CURRENT_PROJECT_VERSION = ${versionCode};`)
    .replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`);

  if (pbx === beforePbx) {
    console.warn('⚠️   iOS: no changes made — version fields not found in project.pbxproj.');
    allOk = false;
  } else {
    fs.writeFileSync(pbxprojPath, pbx, 'utf8');
    console.log(
      `✅  iOS:     CURRENT_PROJECT_VERSION = ${versionCode},  MARKETING_VERSION = "${version}"`
    );
  }
} else {
  console.warn(`⚠️   iOS project.pbxproj not found:`);
  console.warn(`     ${pbxprojPath}`);
  console.warn(`     If you haven't run "cap add ios" yet this is expected.`);
  allOk = false;
}

// ── Result ────────────────────────────────────────────────────────────────────

console.log('');
if (allOk) {
  console.log('✅  All native versions synced.\n');
} else {
  console.log('⚠️   Some platforms were skipped — see warnings above.\n');
  // Exit 0 — a missing platform is not a fatal error (e.g. building iOS-only)
}
