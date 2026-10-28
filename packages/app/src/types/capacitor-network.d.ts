/**
 * packages/app/src/types/capacitor-network.d.ts
 *
 * Type declarations for @capacitor/network in the app package.
 *
 * The real plugin is installed ONLY in @atc-app/mobile
 * (packages/mobile/package.json). On web/Electron, Vite aliases the
 * import to packages/app/src/stubs/network.stub.ts at build time, so
 * this file is a DECLARATION-ONLY shim — it satisfies tsc without
 * pulling the native pod into the web bundle. It mirrors the stub's
 * exported shape so the two can never drift.
 *
 * When the plugin IS present (mobile build), the real .d.ts from
 * node_modules takes precedence; this file is harmless there.
 */

declare module '@capacitor/network' {
  export interface NetworkStatus {
    connected: boolean;
    connectionType: string;
  }

  export interface NetworkListenerHandle {
    remove(): Promise<void>;
  }

  export interface NetworkPlugin {
    getNetworkStatus(): Promise<NetworkStatus>;
    addListener(
      eventName: 'networkStatusChange',
      listener: (status: NetworkStatus) => void
    ): Promise<NetworkListenerHandle>;
    removeAllListeners(): Promise<void>;
  }

  const Network: NetworkPlugin;
  export { Network };
}