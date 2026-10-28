/**
 * packages/electron/src/preload.ts
 *
 * Changes from original:
 *  - Added checkPremium() — calls the secure main-process Supabase verification
 *  - Added auto-updater IPC handlers
 *  - All existing APIs unchanged
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // ── VPN/AnyConnect APIs (unchanged) ───────────────────────────────────────
  checkAnyConnect: () => ipcRenderer.invoke('anyconnect:check'),
  launchAnyConnect: () => ipcRenderer.invoke('anyconnect:launch'),
  getNetworkInterfaces: () => ipcRenderer.invoke('network:interfaces'),

  // ── Premium verification ──────────────────────────────────────────────────
  checkPremium: (userId: string): Promise<{ isPremium: boolean; error?: string }> =>
    ipcRenderer.invoke('premium:check', userId),

  // ── Auto-Updater ──────────────────────────────────────────────────────────
  update: {
    check: (): Promise<{ success: boolean; updateInfo?: unknown; error?: string }> =>
      ipcRenderer.invoke('update:check'),
    download: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('update:download'),
    install: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('update:install'),
    cancel: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('update:cancel'),
    // Event listeners
    onChecking: (callback: () => void) => {
      ipcRenderer.on('update:status', (_, data) => {
        if (data.status === 'checking') callback();
      });
    },
    onAvailable: (
      callback: (info: { version: string; releaseNotes?: string; releaseDate?: string }) => void
    ) => {
      ipcRenderer.on('update:available', (_, info) => callback(info));
    },
    onNotAvailable: (callback: (info: { version: string }) => void) => {
      ipcRenderer.on('update:status', (_, data) => {
        if (data.status === 'no-update') callback(data);
      });
    },
    onError: (callback: (error: { error: string }) => void) => {
      ipcRenderer.on('update:error', (_, error) => callback(error));
    },
    onProgress: (
      callback: (progress: { percent: number; transferred: number; total: number }) => void
    ) => {
      ipcRenderer.on('update:progress', (_, progress) => callback(progress));
    },
    onDownloaded: (callback: (info: { version: string; releaseNotes?: string }) => void) => {
      ipcRenderer.on('update:downloaded', (_, info) => callback(info));
    },
    removeAllListeners: (channel: string) => {
      ipcRenderer.removeAllListeners(channel);
    },
  },

  // ── App lifecycle ─────────────────────────────────────────────────────────
  closeApp: () => ipcRenderer.invoke('app:close'),

  // ── Legacy electron API (unchanged) ──────────────────────────────────────
  send: (channel: string, data?: unknown) => {
    ipcRenderer.send(channel, data);
  },
  on: (channel: string, listener: (...args: unknown[]) => void) => {
    ipcRenderer.on(channel, (_, ...args) => listener(...args));
  },
});
