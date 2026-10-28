import { CapacitorConfig } from '@capacitor/cli';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Capacitor CLI runs in Node (CommonJS) — load packages/app/.env.local
// so AdMob IDs are available without hardcoding them.
// VITE_-prefixed vars are intentionally NOT used here (CLI ≠ Vite).
// Unset values fall back to `mocked_<VAR NAME>`.
dotenv.config({ path: path.resolve(__dirname, '../app/.env.local') });

const ADMOB_APP_ID_ANDROID = process.env.ADMOB_APP_ID_ANDROID ?? 'mocked_ADMOB_APP_ID_ANDROID';
const ADMOB_APP_ID_IOS = process.env.ADMOB_APP_ID_IOS ?? 'mocked_ADMOB_APP_ID_IOS';

const config: CapacitorConfig = {
  appId: 'com.atcapp.app',
  appName: 'ATC-APP',
  webDir: '../app/dist',

  // Important: Handle asset loading
  server: {
    androidScheme: 'https', // Use HTTPS for Android
  },

  // iOS Specific Settings
  ios: {
    path: 'ios', // Custom path for the native project folder
    scheme: 'App', // Matches your Xcode build scheme
    backgroundColor: '#000000', // Background color of the WebView
    contentInset: 'never', // Controls webview scroll behavior (automatic/never/always)

    // Set to true if using "App-Bound Domains" for security
    limitsNavigationsToAppBoundDomains: false,
  },

  // Plugin-specific settings
  plugins: {
    // CapacitorHttp: enable native HTTP bridge for fetch/XHR. When enabled,
    // Capacitor patches window.fetch and XMLHttpRequest to route through the
    // native HTTP client (OkHttp on Android, URLSession on iOS). This bypasses
    // the browser CORS stack entirely, so all Supabase calls work on-device
    // without needing to register the WebView origin in the Supabase dashboard.
    // On web/Electron the plugin falls back to standard fetch (no-op).
    CapacitorHttp: {
      enabled: false, // plain WebView fetch; Supabase CORS allows all origins
    },

    StatusBar: {
      overlaysWebView: true, // floats over WebView instead of pushing it down
      style: 'dark',
    },

    Haptics: {
      enabled: true,
    },

    // AdMob native SDK reads appId before the WebView loads.
    // Android and iOS have separate App IDs from the AdMob dashboard.
    AdMob: {
      appId: ADMOB_APP_ID_ANDROID || ADMOB_APP_ID_IOS,
      // Per-platform override: Capacitor reads the correct one at sync time
      // based on which platform you're building for.
      android: {
        appId: ADMOB_APP_ID_ANDROID,
      },
      ios: {
        appId: ADMOB_APP_ID_IOS,
      },
    },
  },

  android: {
    // Edge-to-edge: let the WebView extend behind system bars so
    // MainActivity.hideSystemBars() can cover them completely.
    // Without this Capacitor re-adds insets and the bars reappear.
    adjustMarginsForEdgeToEdge: 'disable',
    buildOptions: {
      keystorePath: 'keystore.properties',
      keystoreAlias: 'atc-app',
      releaseType: 'AAB',
    },
  },
};

export default config;
