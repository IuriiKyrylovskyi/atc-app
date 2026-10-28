// packages/app/src/composables/useUpdateCheck.ts
// Unified update check composable for all platforms

import { ref, onMounted, onBeforeUnmount } from 'vue';
import { Capacitor } from '@capacitor/core';
import {
  checkMobileUpdate,
  openAppStore,
  getCurrentAppVersion,
} from '@/services/mobileUpdateService';
import {
  checkWebUpdate,
  shouldCheckForUpdate,
  recordUpdateCheck,
  clearLastUpdateCheck,
} from '@/services/webUpdateService';
import { useSettingsStore } from '@/stores/settings';
import type { ElectronUpdateInfo } from '@/types/electron';

// Vite injects __APP_VERSION__ at build time
declare const __APP_VERSION__: string;

export interface UpdateInfo {
  available: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseNotes?: string;
  storeUrl?: string;
  url?: string;
}

export interface UpdateState {
  checking: boolean;
  updateInfo: UpdateInfo | null;
  error: string | null;
  downloadProgress: number | null;
  downloaded: boolean;
}

export function useUpdateCheck() {
  const settingsStore = useSettingsStore();
  const state = ref<UpdateState>({
    checking: false,
    updateInfo: null,
    error: null,
    downloadProgress: null,
    downloaded: false,
  });

  // Platform detection
  const isElectron = Capacitor.getPlatform() === 'electron' || !!window.electronAPI;
  const isMobile = Capacitor.getPlatform() === 'ios' || Capacitor.getPlatform() === 'android';
  const isWeb = !isElectron && !isMobile;

  // Electron auto-updater event handlers
  let electronListenersAttached = false;

  /**
   * Attach Electron auto-updater event listeners
   */
  function attachElectronListeners(): void {
    if (!isElectron || electronListenersAttached) return;
    electronListenersAttached = true;

    const electronAPI = window.electronAPI;
    if (!electronAPI?.update) return;

    electronAPI.update.onChecking?.(() => {
      state.value.checking = true;
      state.value.error = null;
    });

    electronAPI.update.onAvailable?.((info: ElectronUpdateInfo) => {
      state.value.checking = false;
      state.value.updateInfo = {
        available: true,
        currentVersion: __APP_VERSION__ || '0.0.0',
        latestVersion: info.version,
        releaseNotes: info.releaseNotes,
        storeUrl: '',
      };
    });

    electronAPI.update.onNotAvailable?.((info: { version: string }) => {
      state.value.checking = false;
      state.value.updateInfo = {
        available: false,
        currentVersion: info.version,
        latestVersion: info.version,
      };
    });

    electronAPI.update.onError?.((error: { error: string }) => {
      state.value.checking = false;
      state.value.error = error.error;
    });

    electronAPI.update.onProgress?.((progress: { percent: number }) => {
      state.value.downloadProgress = progress.percent;
    });

    electronAPI.update.onDownloaded?.((info: ElectronUpdateInfo) => {
      state.value.downloadProgress = null;
      state.value.downloaded = true;
      state.value.updateInfo = {
        available: true,
        currentVersion: __APP_VERSION__ || '0.0.0',
        latestVersion: info.version,
        releaseNotes: info.releaseNotes,
        storeUrl: '',
      };
    });
  }

  /**
   * Detach Electron auto-updater event listeners
   */
  function detachElectronListeners(): void {
    if (!isElectron) return;
    const electronAPI = window.electronAPI;
    if (!electronAPI?.update) return;
    electronAPI.update.removeAllListeners?.('update:status');
    electronAPI.update.removeAllListeners?.('update:available');
    electronAPI.update.removeAllListeners?.('update:error');
    electronAPI.update.removeAllListeners?.('update:progress');
    electronAPI.update.removeAllListeners?.('update:downloaded');
    electronListenersAttached = false;
  }

  /**
   * Check for updates based on platform
   */
  async function checkForUpdates(force = false): Promise<UpdateInfo | null> {
    // Check if updates are enabled in settings
    if (!settingsStore.checkForUpdates && !force) {
      return null;
    }

    // Check interval (skip if checked recently, unless forced)
    const intervalHours = settingsStore.updateCheckIntervalHours || 24;
    if (!force && !shouldCheckForUpdate(intervalHours)) {
      return null;
    }

    state.value.checking = true;
    state.value.error = null;

    try {
      let result: UpdateInfo | null = null;

      if (isElectron) {
        // Electron: use electron-updater
        const electronAPI = window.electronAPI;
        const checkResult = await electronAPI?.update?.check?.();

        if (checkResult?.success && checkResult.updateInfo) {
          const info = checkResult.updateInfo;
          result = {
            available: true,
            currentVersion: __APP_VERSION__ || '0.0.0',
            latestVersion: info.version,
            releaseNotes: info.releaseNotes,
            storeUrl: '',
          };
        } else {
          result = {
            available: false,
            currentVersion: __APP_VERSION__ || '0.0.0',
            latestVersion: __APP_VERSION__ || '0.0.0',
          };
        }
      } else if (isMobile) {
        // Mobile: check App Store / Play Store
        const currentVersion = await getCurrentAppVersion();
        const mobileResult = await checkMobileUpdate(currentVersion);
        result = {
          available: mobileResult.available,
          currentVersion: mobileResult.currentVersion,
          latestVersion: mobileResult.latestVersion,
          releaseNotes: mobileResult.releaseNotes,
          storeUrl: mobileResult.storeUrl,
        };
      } else {
        // Web: check version endpoint
        const currentVersion = __APP_VERSION__ || '0.0.0';
        const webResult = await checkWebUpdate(currentVersion);
        result = {
          available: webResult.available,
          currentVersion: webResult.currentVersion,
          latestVersion: webResult.latestVersion,
          releaseNotes: webResult.releaseNotes,
          url: webResult.url,
        };
      }

      state.value.updateInfo = result;
      state.value.checking = false;

      if (!force) {
        recordUpdateCheck();
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      state.value.error = errorMessage;
      state.value.checking = false;
      console.error('Update check failed:', error);
      return null;
    }
  }

  /**
   * Download update (Electron only)
   */
  async function downloadUpdate(): Promise<boolean> {
    if (!isElectron) return false;

    const electronAPI = window.electronAPI;
    const result = await electronAPI?.update?.download?.();
    return result?.success === true;
  }

  /**
   * Install update (Electron only)
   */
  async function installUpdate(): Promise<void> {
    if (!isElectron) return;

    const electronAPI = window.electronAPI;
    await electronAPI?.update?.install?.();
  }

  /**
   * Cancel download (Electron only)
   */
  async function cancelDownload(): Promise<void> {
    if (!isElectron) return;

    const electronAPI = window.electronAPI;
    await electronAPI?.update?.cancel?.();
    state.value.downloadProgress = null;
  }

  /**
   * Open store page (Mobile) or release page (Web)
   */
  async function openUpdatePage(): Promise<void> {
    const info = state.value.updateInfo;
    if (!info) return;

    if (isMobile) {
      await openAppStore();
    } else if (info.url) {
      window.open(info.url, '_blank');
    } else if (info.storeUrl) {
      window.open(info.storeUrl, '_blank');
    }
  }

  /**
   * Dismiss update notification
   */
  function dismissUpdate(): void {
    state.value.updateInfo = null;
  }

  /**
   * Reset update state
   */
  function reset(): void {
    state.value = {
      checking: false,
      updateInfo: null,
      error: null,
      downloadProgress: null,
      downloaded: false,
    };
  }

  /**
   * Manually trigger update check (bypasses interval)
   */
  async function checkNow(): Promise<UpdateInfo | null> {
    return checkForUpdates(true);
  }

  // Auto-attach Electron listeners on mount
  onMounted(() => {
    if (isElectron) {
      attachElectronListeners();
    }
  });

  // Cleanup on unmount
  onBeforeUnmount(() => {
    if (isElectron) {
      detachElectronListeners();
    }
  });

  return {
    state,
    checkForUpdates,
    checkNow,
    downloadUpdate,
    installUpdate,
    cancelDownload,
    openUpdatePage,
    dismissUpdate,
    reset,
    clearLastUpdateCheck,
    isElectron,
    isMobile,
    isWeb,
  };
}
