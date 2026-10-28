// scripts/verify-env.js
const { execSync } = require('child_process');

const semver = (v) => v.split(/[.-]/).map(Number);
const ok = (t) => console.log('✅', t);
const warn = (t) => console.warn('⚠️', t);
const err = (t) => {
  console.error('❌', t);
  process.exitCode = 1;
};
const run = (c) => {
  try {
    return execSync(c, { stdio: ['pipe', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return '';
  }
};

const nodeV = process.versions.node;
if (semver(nodeV)[0] < 20) err('Node >=20 required, found ' + nodeV);
else ok('Node ' + nodeV);

const pnpmV = run('pnpm -v');
pnpmV ? ok('PNPM ' + pnpmV) : err('PNPM not found');

const javaV = run('java -version 2>&1').match(/"(\d+[.\d+]*)"/);
if (javaV) {
  const v = javaV[1].split('.')[0];
  +v >= 17 ? ok('Java ' + javaV[1]) : err('Java >=17 required, found ' + javaV[1]);
} else warn('Java not found (required for Android)');

const andHome = process.env.ANDROID_HOME;
andHome ? ok('ANDROID_HOME=' + andHome) : warn('ANDROID_HOME not set');

const capV = run('pnpm --filter @atc-app/mobile exec cap --version');
capV ? ok('Capacitor ' + capV) : warn('Capacitor CLI not found');

const viteV = run('pnpm --filter @atc-app/app exec vite --version');
viteV ? ok('Vite ' + viteV) : warn('Vite not found');

const tscV = run('pnpm exec tsc --version');
tscV ? ok(tscV) : warn('TypeScript not found');

console.log('\nEnvironment verification complete.');
