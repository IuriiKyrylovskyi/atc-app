export interface NetworkInterface {
  name: string;
  address: string;
  isActive: boolean;
}

export interface AnyConnectCheckResult {
  installed: boolean;
  path?: string;
}

export interface AnyConnectLaunchResult {
  success: boolean;
  error?: string;
}

export interface ElectronUpdateInfo {
  version: string;
  releaseNotes?: string;
  releaseDate?: string;
}

export interface ElectronAPI {
  update?: {
    check: () => Promise<{ success: boolean; updateInfo?: ElectronUpdateInfo; error?: string }>;
    download: () => Promise<{ success: boolean; error?: string }>;
    install: () => Promise<{ success: boolean; error?: string }>;
    cancel: () => Promise<{ success: boolean; error?: string }>;
    onChecking: (callback: () => void) => void;
    onAvailable: (callback: (info: ElectronUpdateInfo) => void) => void;
    onNotAvailable: (callback: (info: { version: string }) => void) => void;
    onError: (callback: (error: { error: string }) => void) => void;
    onProgress: (callback: (progress: { percent: number }) => void) => void;
    onDownloaded: (callback: (info: ElectronUpdateInfo) => void) => void;
    removeAllListeners: (channel: string) => void;
  };
  checkAnyConnect: () => Promise<{ installed: boolean }>;
  launchAnyConnect: () => Promise<{ success: boolean; error?: string }>;
  getNetworkInterfaces: () => Promise<
    Array<{
      name: string;
      address: string;
      isActive: boolean;
    }>
  >;
  checkPremium: (userId: string) => Promise<{ isPremium: boolean; error?: string }>;
  closeApp: () => Promise<void>;
  send: (channel: string, data?: unknown) => void;
  on: (channel: string, listener: (...args: unknown[]) => void) => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
    Capacitor?: {
      platform: string;
      isNativePlatform: () => boolean;
    };
  }
}

export {};
