// packages/app/src/services/mobileUpdateService.ts
// Mobile (iOS/Android) update check service

import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { ENV, isMocked } from '@/config/env';

export interface MobileUpdateInfo {
  available: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseNotes?: string;
  storeUrl: string;
}

const IOS_BUNDLE_ID = 'com.atcapp.app';
const ANDROID_PACKAGE_NAME = 'com.atcapp.app';

// Vite injects __APP_VERSION__ at build time
declare const __APP_VERSION__: string;

/**
 * Check for updates on iOS using iTunes Search API
 */
async function checkIOSUpdate(currentVersion: string): Promise<MobileUpdateInfo> {
  const url = `https://itunes.apple.com/lookup?bundleId=${IOS_BUNDLE_ID}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`iTunes API error: ${response.status}`);
    }

    const data = await response.json();

    if (!data.results || data.results.length === 0) {
      throw new Error('App not found on App Store');
    }

    const appInfo = data.results[0];
    const latestVersion = appInfo.version;
    const storeUrl = appInfo.trackViewUrl || `https://apps.apple.com/app/id${appInfo.trackId}`;

    return {
      available: compareVersions(latestVersion, currentVersion) > 0,
      currentVersion,
      latestVersion,
      releaseNotes: appInfo.releaseNotes,
      storeUrl,
    };
  } catch (error) {
    console.warn('iOS update check failed:', error);
    // Fallback to version.json endpoint
    return checkVersionEndpoint(currentVersion, 'ios');
  }
}

/**
 * Check for updates on Android using Play Store (web scraping fallback)
 * Note: Official Play Store API requires service account, so we use version endpoint as primary
 */
async function checkAndroidUpdate(currentVersion: string): Promise<MobileUpdateInfo> {
  // Primary: Use version.json endpoint (same as web)
  const endpointResult = await checkVersionEndpoint(currentVersion, 'android');

  // If endpoint says update available, construct Play Store URL
  if (endpointResult.available) {
    return {
      ...endpointResult,
      storeUrl: `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE_NAME}`,
    };
  }

  return endpointResult;
}

/**
 * Fallback: Check version via the version.json endpoint
 */
async function checkVersionEndpoint(
  currentVersion: string,
  platform: 'ios' | 'android'
): Promise<MobileUpdateInfo> {
  const versionCheckUrl = isMocked(ENV.VITE_VERSION_CHECK_URL) ? '' : ENV.VITE_VERSION_CHECK_URL;

  if (!versionCheckUrl) {
    return {
      available: false,
      currentVersion,
      latestVersion: currentVersion,
      storeUrl:
        platform === 'ios'
          ? `https://apps.apple.com/app/id${IOS_BUNDLE_ID.replace('com.atcapp.app', '')}`
          : `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE_NAME}`,
    };
  }

  try {
    const response = await fetch(versionCheckUrl, { cache: 'no-cache' });
    if (!response.ok) {
      throw new Error(`Version endpoint error: ${response.status}`);
    }

    const data = await response.json();
    const latestVersion = data.version;
    const storeUrl = data.platforms?.[platform] || data.url;

    return {
      available: compareVersions(latestVersion, currentVersion) > 0,
      currentVersion,
      latestVersion,
      releaseNotes: data.releaseNotes,
      storeUrl,
    };
  } catch (error) {
    console.warn('Version endpoint check failed:', error);
    return {
      available: false,
      currentVersion,
      latestVersion: currentVersion,
      storeUrl:
        platform === 'ios'
          ? `https://apps.apple.com/app/id${IOS_BUNDLE_ID.replace('com.atcapp.app', '')}`
          : `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE_NAME}`,
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
 * Main function to check for mobile updates
 */
export async function checkMobileUpdate(currentVersion: string): Promise<MobileUpdateInfo> {
  const platform = Capacitor.getPlatform();

  if (platform === 'ios') {
    return checkIOSUpdate(currentVersion);
  } else if (platform === 'android') {
    return checkAndroidUpdate(currentVersion);
  }

  // Not a mobile platform
  return {
    available: false,
    currentVersion,
    latestVersion: currentVersion,
    storeUrl: '',
  };
}

/**
 * Open the app store page for the current platform
 */
export async function openAppStore(): Promise<void> {
  const platform = Capacitor.getPlatform();
  const versionCheckUrl = isMocked(ENV.VITE_VERSION_CHECK_URL) ? '' : ENV.VITE_VERSION_CHECK_URL;

  let storeUrl = '';

  if (versionCheckUrl) {
    try {
      const response = await fetch(versionCheckUrl, { cache: 'no-cache' });
      if (response.ok) {
        const data = await response.json();
        storeUrl = data.platforms?.[platform] || data.url;
      }
    } catch {
      // Ignore, use fallback
    }
  }

  if (!storeUrl) {
    storeUrl =
      platform === 'ios'
        ? `https://apps.apple.com/app/id${IOS_BUNDLE_ID.replace('com.atcapp.app', '')}`
        : `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE_NAME}`;
  }

  // @capacitor/app has no openUrl; an external URL opened from the WebView is
  // handed to the system (store app or browser).
  window.open(storeUrl, '_blank');
}

/**
 * Get the current app version from Capacitor
 */
export async function getCurrentAppVersion(): Promise<string> {
  try {
    const info = await App.getInfo();
    return info.version;
  } catch {
    // Fallback to Vite-injected version
    return __APP_VERSION__ || '0.0.0';
  }
}
