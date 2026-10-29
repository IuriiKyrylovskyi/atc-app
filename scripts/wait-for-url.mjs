#!/usr/bin/env node
// Waits until a dev server answers, so Electron does not open on a blank
// "connection refused" page while its Vite server (pnpm dev:electron) is
// still starting. Usage: node scripts/wait-for-url.mjs <url> [timeoutSeconds]
const [url, timeoutArg] = process.argv.slice(2);
if (!url) {
  console.error('usage: wait-for-url.mjs <url> [timeoutSeconds]');
  process.exit(2);
}
const deadline = Date.now() + Number(timeoutArg ?? 60) * 1000;

for (;;) {
  try {
    const res = await fetch(url);
    if (res.ok) process.exit(0);
  } catch {
    // Not listening yet.
  }
  if (Date.now() > deadline) {
    console.error(`wait-for-url: ${url} did not answer in ${timeoutArg ?? 60} s`);
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 500));
}
