/**
 * packages/electron/src/main.ts
 *
 * Changes from original:
 *  - Added Content Security Policy to prevent JS injection attacks
 *  - Added 'premium:check' IPC handler — renderer asks main process to verify
 *    premium status directly with Supabase (bypasses any renderer-side hacks)
 *  - Added auto-updater with electron-updater (GitHub releases)
 *  - Existing AnyConnect / network IPC handlers unchanged
 */
import { app, BrowserWindow, ipcMain, session, dialog, shell } from 'electron';
import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import path from 'path';
import { autoUpdater, CancellationToken } from 'electron-updater';

const execAsync = promisify(exec);

let mainWindow: BrowserWindow | null = null;

// ─── Auto-Updater Configuration ──────────────────────────────────────────────
// Only check for updates in packaged builds, not in development
if (app.isPackaged) {
  autoUpdater.logger = console;
  autoUpdater.autoDownload = false; // Let user decide when to download
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    console.log('🔄 Checking for updates...');
    mainWindow?.webContents.send('update:status', { status: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    console.log('📦 Update available:', info.version);
    mainWindow?.webContents.send('update:available', {
      version: info.version,
      releaseNotes: info.releaseNotes,
      releaseDate: info.releaseDate,
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    console.log('✅ No updates available, current version:', info.version);
    mainWindow?.webContents.send('update:status', { status: 'no-update', version: info.version });
  });

  autoUpdater.on('error', (err) => {
    console.error('❌ Auto-updater error:', err);
    mainWindow?.webContents.send('update:error', { error: err.message });
  });

  autoUpdater.on('download-progress', (progress) => {
    mainWindow?.webContents.send('update:progress', {
      percent: Math.round(progress.percent),
      transferred: progress.transferred,
      total: progress.total,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('✅ Update downloaded:', info.version);
    mainWindow?.webContents.send('update:downloaded', {
      version: info.version,
      releaseNotes: info.releaseNotes,
    });
  });
}
// ─────────────────────────────────────────────────────────────────────────────

// ─── Supabase credentials (read from env, never shipped in JS bundle) ─────────
// Values come from the environment (see packages/electron/.env.local). Until
// they are set they stay `mocked_<VAR NAME>`, which the premium check treats as
// missing. Never hard-code a real service-role key here: this file is compiled
// into the desktop app and can be extracted from the installed binary.
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'mocked_VITE_SUPABASE_URL';
const SUPABASE_SERVICE_ROLE_KEY = process.env.DB_SERVICE_ROLE_KEY ?? 'mocked_DB_SERVICE_ROLE_KEY';
const isMocked = (value: string) => value.startsWith('mocked_');
// Note: SUPABASE_SERVICE_ROLE_KEY is ONLY for the main process.
// The renderer uses the anon key (VITE_SUPABASE_ANON_KEY) via the normal client.
// Never expose the service_role key to the renderer.

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false, // ✅ Security: no Node in renderer
      contextIsolation: true, // ✅ Security: isolated context bridge
      sandbox: true, // ✅ Security: sandboxed renderer process
    },
  });

  // ── Content Security Policy ────────────────────────────────────────────
  // Blocks inline scripts and restricts resource origins.
  // Tighten connect-src once you know your exact Supabase + RC endpoints.
  // Kokoro pilot voices: 'wasm-unsafe-eval' compiles the ONNX runtime, the model
  // downloads once from Hugging Face (redirects to *.hf.co).
  // Cross-origin isolation for the radar scope only (app src/utils/isolation.ts):
  // the document loaded as `?coi=1` gets COOP + COEP, everything else from the
  // app gets COEP so the isolated page may start its workers. file:// (packaged
  // app) never reaches this hook: there Kokoro runs single-threaded.
session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      const isolation: Record<string, string[]> = {};
      if (details.resourceType === 'mainFrame' && /[?&]coi=1\b/.test(details.url)) {
        isolation['Cross-Origin-Opener-Policy'] = ['same-origin'];
        isolation['Cross-Origin-Embedder-Policy'] = ['credentialless'];
      } else if (details.resourceType !== 'mainFrame' && details.resourceType !== 'subFrame') {
        const devServer = process.env.VITE_DEV_SERVER_URL;
        if (devServer && details.url.startsWith(devServer)) {
          isolation['Cross-Origin-Embedder-Policy'] = ['credentialless'];
        }
      }
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          ...isolation,
          'Content-Security-Policy': [
            "default-src 'self'",
            "script-src 'self' 'wasm-unsafe-eval' https://cdn.paddle.com https://pay.rev.cat https://checkout.paddle.com",
            "worker-src 'self' blob:",
            "style-src 'self' 'unsafe-inline'", // Vuetify needs inline styles
            "img-src 'self' data: blob: https://cdn.paddle.com https://pay.rev.cat",
            "connect-src 'self' https://*.supabase.co https://api.revenuecat.com https://api.paddle.com https://checkout.paddle.com https://pay.rev.cat https://cdn.paddle.com https://e.revenue.cat https://huggingface.co https://*.huggingface.co https://*.hf.co",
            "font-src 'self' data:",
            "media-src 'self' blob:",
            "frame-src 'self' https://checkout.paddle.com https://pay.rev.cat https://cdn.paddle.com",
            "frame-ancestors 'self'",
          ].join('; '),
        },
      });
    });

  // ── External links open in the system browser ─────────────────────────────
  // Without this handler, `window.open(url, '_blank')` — used by the legal
  // links at the bottom of the paywall — spawns a bare Chromium popup window
  // with no chrome instead of using the user's default browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Determine URL based on mode
  const devServerURL = process.env.VITE_DEV_SERVER_URL;
  if (devServerURL) {
    mainWindow.loadURL(devServerURL);
    mainWindow.webContents.openDevTools(); // dev only
  } else {
    const indexPath = path.join(__dirname, '../app-dist/index.html');
    console.log('📂 Loading index from', indexPath);
    mainWindow.loadFile(indexPath);
  }

  // ── Block DevTools keyboard shortcuts in production ────────────────────
  // F12, Ctrl+Shift+I, Cmd+Option+I — all disabled in packaged app.
  // DevTools remain fully available in dev mode (devServerURL branch above).
  if (app.isPackaged) {
    mainWindow.webContents.on('before-input-event', (event, input) => {
      const devToolsShortcut =
        input.key === 'F12' ||
        (input.control && input.shift && input.key === 'I') ||
        (input.meta && input.alt && input.key === 'I'); // Cmd+Option+I on macOS
      if (devToolsShortcut) {
        event.preventDefault();
      }
    });
  }
}

// ─── Premium Verification IPC ─────────────────────────────────────────────────
//
// The renderer calls window.electronAPI.checkPremium() which invokes this handler.
// Main process makes a DIRECT fetch to Supabase using the service_role key —
// the renderer never sees this key, and cannot spoof the result.
//
// Flow:
//   Renderer → IPC → Main (fetch Supabase with service_role) → returns { isPremium }
//
ipcMain.handle('premium:check', async (_event, userId: string) => {
  if (
    !SUPABASE_URL ||
    !SUPABASE_SERVICE_ROLE_KEY ||
    isMocked(SUPABASE_URL) ||
    isMocked(SUPABASE_SERVICE_ROLE_KEY)
  ) {
    console.warn('⚠️ Supabase env vars not set in main process — cannot verify premium');
    return { isPremium: false, error: 'config_missing' };
  }

  if (!userId || typeof userId !== 'string' || userId.length < 10) {
    return { isPremium: false, error: 'invalid_user_id' };
  }

  try {
    // Query canonical accounts table (source of truth) via profiles join
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(
        userId
      )}&select=account_id,accounts!inner(is_premium)`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      console.error('Supabase premium check failed:', response.status);
      return { isPremium: false, error: `supabase_${response.status}` };
    }

    const rows = (await response.json()) as Array<{
      account_id: string | null;
      accounts: { is_premium: boolean };
    }>;

    if (!rows || rows.length === 0 || !rows[0].account_id || !rows[0].accounts) {
      return { isPremium: false, error: 'account_not_linked' };
    }

    return { isPremium: rows[0].accounts.is_premium === true };
  } catch (err) {
    console.error('premium:check network error:', err);
    // On network error, fall back to false (fail-closed = secure)
    return { isPremium: false, error: 'network_error' };
  }
});

// ============================================================
// Existing IPC Handlers — unchanged
// ============================================================

ipcMain.handle('anyconnect:check', async () => {
  console.log('🔍 Checking for AnyConnect installation...');
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execAsync('where vpncli.exe');
      return { installed: stdout.includes('vpncli.exe') };
    } else if (process.platform === 'darwin') {
      const possiblePaths = [
        '/Applications/Cisco/Cisco Secure Client.app',
        '/Applications/Cisco/Cisco AnyConnect Secure Mobility Client.app',
        '/Applications/Cisco Secure Client.app',
        '/Applications/Cisco AnyConnect Secure Mobility Client.app',
        '/Applications/Cisco/AnyConnect.app',
        '/Applications/AnyConnect.app',
      ];
      for (const appPath of possiblePaths) {
        try {
          await execAsync(`ls "${appPath}"`);
          return { installed: true, path: appPath };
        } catch {
          continue;
        }
      }
      return { installed: false };
    }
    return { installed: false };
  } catch (error: unknown) {
    const err = error as Error;
    console.error('Error in anyconnect:check:', err.message);
    return { installed: false };
  }
});

ipcMain.handle('anyconnect:launch', async () => {
  try {
    if (process.platform === 'win32') {
      await execAsync(
        'start "" "C:\\Program Files (x86)\\Cisco\\Cisco AnyConnect Secure Mobility Client\\vpnui.exe"'
      );
      return { success: true };
    } else if (process.platform === 'darwin') {
      const possibleApps = [
        'Cisco Secure Client',
        'Cisco AnyConnect Secure Mobility Client',
        'AnyConnect',
      ];
      for (const appName of possibleApps) {
        try {
          await execAsync(`open -a "${appName}"`);
          return { success: true };
        } catch {
          continue;
        }
      }
      return { success: false, error: 'Could not find AnyConnect. Please open it manually.' };
    }
    return { success: false, error: 'Platform not supported' };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: errorMessage };
  }
});

ipcMain.handle('network:interfaces', async () => {
  try {
    const interfaces = os.networkInterfaces();
    const result: unknown[] = [];
    Object.keys(interfaces).forEach((name) => {
      const iface = interfaces[name];
      if (iface) {
        iface.forEach((config) => {
          if (config.family === 'IPv4' && !config.internal) {
            result.push({ name, address: config.address, isActive: true });
          }
        });
      }
    });
    return result;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.log('Error getting network interfaces:', errorMessage);
    return [];
  }
});

// ─── Auto-Updater IPC Handlers ───────────────────────────────────────────────
ipcMain.handle('update:check', async () => {
  if (!app.isPackaged) {
    return { success: false, error: 'Auto-updater only works in packaged builds' };
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    return { success: true, updateInfo: result?.updateInfo };
  } catch (err) {
    const error = err as Error;
    return { success: false, error: error.message };
  }
});

// electron-updater has no cancelDownload(); a download is cancelled through the
// token it was started with.
let downloadCancellation: CancellationToken | null = null;

ipcMain.handle('update:download', async () => {
  if (!app.isPackaged) {
    return { success: false, error: 'Auto-updater only works in packaged builds' };
  }
  try {
    downloadCancellation = new CancellationToken();
    await autoUpdater.downloadUpdate(downloadCancellation);
    return { success: true };
  } catch (err) {
    const error = err as Error;
    return { success: false, error: error.message };
  }
});

ipcMain.handle('update:install', async () => {
  if (!app.isPackaged) {
    return { success: false, error: 'Auto-updater only works in packaged builds' };
  }
  autoUpdater.quitAndInstall(true, true);
  return { success: true };
});

ipcMain.handle('update:cancel', async () => {
  if (!app.isPackaged) {
    return { success: false, error: 'Auto-updater only works in packaged builds' };
  }
  downloadCancellation?.cancel();
  downloadCancellation = null;
  return { success: true };
});

// ============================================================
// App Lifecycle
// ============================================================

app.whenReady().then(createWindow);

// Closes the app from the in-app EXIT control.
//
// `mainWindow.close()` runs the renderer's `beforeunload` handler, so the
// renderer MUST have removed that guard before calling this (see
// `useUnloadGuard` in the app package) — otherwise Electron cancels the
// close and pops a native "Leave site?" dialog instead of quitting.
//
// `app.quit()` is what actually ends the process on macOS: `window-all-closed`
// deliberately does NOT quit on darwin (the app stays in the dock).
ipcMain.handle('app:close', async () => {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.close();
    }
  } finally {
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
