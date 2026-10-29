// Unit tests for the app's plain-TS modules (view-models). Kept apart from
// vite.config.ts so a test run starts none of the dev-server plugins.
import { fileURLToPath } from 'url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['test/**/*.test.ts'],
  },
});
