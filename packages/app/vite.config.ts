import { defineConfig, type Plugin } from 'vite';
import path from 'path';
import vue from '@vitejs/plugin-vue';
import vuetify from 'vite-plugin-vuetify';
import { fileURLToPath } from 'url';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { execFileSync } from 'child_process';

const rootPkg = JSON.parse(readFileSync(path.resolve(__dirname, '../../package.json'), 'utf-8'));

// Reports skymess changes to the files atc-app was ported from, once per dev
// server start. Read-only towards skymess and never blocks the launch.
const checkSkymessUpdates = (): Plugin => ({
  name: 'check-skymess-updates',
  apply: 'serve',
  configureServer() {
    try {
      execFileSync('node', [path.resolve(__dirname, '../../scripts/check-skymess-updates.mjs')], {
        stdio: 'inherit',
      });
    } catch {
      // The script already exits 0 on every failure; this only guards a missing node.
    }
  },
});

// Airspace packs built by `pnpm pack:build` (packs/dist) are served at /packs/
// in dev and copied into the build, until pack hosting (Supabase Storage) exists.
const PACKS_DIR = path.resolve(__dirname, '../../packs/dist');
const airspacePacks = (): Plugin => ({
  name: 'airspace-packs',
  configureServer(server) {
    server.middlewares.use('/packs', (req, res, next) => {
      const name = decodeURIComponent((req.url ?? '/').split('?')[0]!.replace(/^\//, ''));
      if (!/^[\w.@-]+\.json$/.test(name)) return next();
      const file = path.join(PACKS_DIR, name);
      if (!existsSync(file)) return next();
      res.setHeader('Content-Type', 'application/json');
      res.end(readFileSync(file));
    });
  },
  generateBundle() {
    if (!existsSync(PACKS_DIR)) return;
    for (const name of readdirSync(PACKS_DIR)) {
      if (!name.endsWith('.json') || name.endsWith('.diff.json')) continue;
      this.emitFile({ type: 'asset', fileName: `packs/${name}`, source: readFileSync(path.join(PACKS_DIR, name)) });
    }
  },
});

export default defineConfig(({ mode }) => {
  // Capacitor sets this env var during build if you use their CLI,
  // or you can set it manually in your build scripts.
  const isNative =
    process.env.CAPACITOR_PLATFORM === 'android' || process.env.CAPACITOR_PLATFORM === 'ios';

  return {
    root: '.',
    base: './',
    plugins: [vue(), vuetify({ autoImport: true }), checkSkymessUpdates(), airspacePacks()],
    define: {
      'process.env': {},
      __APP_VERSION__: JSON.stringify(rootPkg.version),
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        ...(!isNative
          ? {
              // Web/Electron: stub native-only mobile packages.
              // The real @revenuecat/purchases-js is resolved normally here.
              '@revenuecat/purchases-capacitor': path.resolve(
                __dirname,
                'src/stubs/revenuecat.stub.ts'
              ),
              '@revenuecat/purchases-capacitor-ui': path.resolve(
                __dirname,
                'src/stubs/revenuecat-ui.stub.ts'
              ),
              '@capacitor-community/admob': path.resolve(__dirname, 'src/stubs/admob.stub.ts'),
              '@capacitor/haptics': path.resolve(__dirname, 'src/stubs/haptics.stub.ts'),
              '@capacitor/network': path.resolve(__dirname, 'src/stubs/network.stub.ts'),
              '@capacitor/app': path.resolve(__dirname, 'src/stubs/app.stub.ts'),
              '@capacitor/filesystem': path.resolve(__dirname, 'src/stubs/filesystem.stub.ts'),
              '@capacitor/status-bar': path.resolve(__dirname, 'src/stubs/status-bar.stub.ts'),
              '@capacitor/screen-orientation': path.resolve(
                __dirname,
                'src/stubs/screen-orientation.stub.ts'
              ),
            }
          : {
              // Mobile: stub the web-only billing SDK — native apps use
              // the native @revenuecat/purchases-capacitor SDK instead.
              '@revenuecat/purchases-js': path.resolve(
                __dirname,
                'src/stubs/revenuecat-web.stub.ts'
              ),
            }),
      },
    },
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
      assetsInlineLimit: 0,
      sourcemap: false,
      minify: 'terser',
      terserOptions: {
        compress: { passes: 2, drop_console: false, drop_debugger: true },
        mangle: { toplevel: true },
        format: { comments: false },
      },
      rollupOptions: {
        // Remove the conditional external — we want Vite to use the stub even on mobile build
        external: [],
        output: {
          assetFileNames: 'assets/[name]-[hash][extname]',
        },
      },
    },
    server: {
      port: 5173,
    },
  };
});
