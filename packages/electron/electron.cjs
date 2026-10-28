// packages/electron/electron.cjs
(async () => {
  // Dynamically import the compiled ESM entry point
  await import('./dist/main.js');
})();
