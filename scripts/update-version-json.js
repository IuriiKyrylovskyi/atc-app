// scripts/update-version-json.js
// Updates packages/app/public/version.json with current version info
// Run as part of release process (postbump hook in standard-version)

const fs = require('fs');
const path = require('path');

const rootPkgPath = path.resolve(__dirname, '../package.json');
const versionJsonPath = path.resolve(__dirname, '../packages/app/public/version.json');

const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf-8'));
const version = rootPkg.version;

const versionJson = {
  version,
  minVersion: version, // Could be configured separately if needed
  releaseNotes: `Version ${version} - Bug fixes and improvements`,
  url: `https://github.com/IuriiKyrylovskyi/atc-app/releases/tag/v${version}`,
  platforms: {
    electron: `https://github.com/IuriiKyrylovskyi/atc-app/releases/download/v${version}/ATC-APP-${version}-${
      process.platform === 'darwin' ? 'mac' : 'win'
    }.${process.platform === 'darwin' ? 'dmg' : 'exe'}`,
    ios: 'https://apps.apple.com/app/id6471234567', // Replace with actual App Store ID
    android: 'https://play.google.com/store/apps/details?id=com.atcapp.app',
  },
  updatedAt: new Date().toISOString(),
};

fs.writeFileSync(versionJsonPath, JSON.stringify(versionJson, null, 2));
console.log(`✅ Updated version.json to ${version}`);
