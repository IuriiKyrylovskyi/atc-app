// packages/app/src/services/webUpdateService.ts
// Web update check service

import { ENV } from '@/config/env';

export interface WebUpdateInfo {
  available: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseNotes?: string;
  url: string;
}

const STORAGE_KEY = 'atc-app_last_update_check';
const DEFAULT_INTERVAL_HOURS = 24;

/**
 * Check for updates on web using the version.json endpoint
 */
export async function checkWebUpdate(currentVersion: string): Promise<WebUpdateInfo> {
  const versionCheckUrl = ENV.VITE_VERSION_CHECK_URL;

  if (!versionCheckUrl) {
    return {
      available: false,
      currentVersion,
      latestVersion: currentVersion,
      url: '',
    };
  }

  try {
    const response = await fetch(versionCheckUrl, { cache: 'no-cache' });
    if (!response.ok) {
      throw new Error(`Version endpoint error: ${response.status}`);
    }

    const data = await response.json();
    const latestVersion = data.version;

    return {
      available: compareVersions(latestVersion, currentVersion) > 0,
      currentVersion,
      latestVersion,
      releaseNotes: data.releaseNotes,
      url: data.url || '',
    };
  } catch (error) {
    console.warn('Web update check failed:', error);
    return {
      available: false,
      currentVersion,
      latestVersion: currentVersion,
      url: '',
    };
  }
}

/**
 * Compare two semantic version strings
 * Returns: 1 if v1 > v2, -1 if v1 < v2, 0 if equal
 */
function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);

  const maxLen = Math.max(parts1.length, parts2.length);
  for (let i = 0; i < maxLen; i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  return 0;
}

/**
 * Check if enough time has passed since last update check
 */
export function shouldCheckForUpdate(intervalHours: number = DEFAULT_INTERVAL_HOURS): boolean {
  const lastCheck = localStorage.getItem(STORAGE_KEY);
  if (!lastCheck) return true;

  const lastCheckTime = parseInt(lastCheck, 10);
  const now = Date.now();
  const intervalMs = intervalHours * 60 * 60 * 1000;

  return now - lastCheckTime > intervalMs;
}

/**
 * Record the time of the last update check
 */
export function recordUpdateCheck(): void {
  localStorage.setItem(STORAGE_KEY, Date.now().toString());
}

/**
 * Clear the last update check time (for testing or manual trigger)
 */
export function clearLastUpdateCheck(): void {
  localStorage.removeItem(STORAGE_KEY);
}
