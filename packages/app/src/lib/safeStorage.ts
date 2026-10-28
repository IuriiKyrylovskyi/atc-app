/**
 * packages/app/src/lib/safeStorage.ts
 *
 * A drop-in, never-throwing replacement for window.localStorage.
 *
 * Why: localStorage can be missing or throw on some of the platforms this app
 * ships on (Safari private mode, "block all cookies", sandboxed iframes, full
 * quota, an evicted/cleared WebView store). The rest of the app used to swallow
 * those errors silently, which meant credentials and progress vanished with no
 * trace. This wrapper:
 *   - uses window.localStorage whenever it works (so existing data on web,
 *     Electron, iOS and Android keeps being read from the same place),
 *   - falls back to an in-memory map for the current session when it does not,
 *   - never throws, and warns once so the problem is visible in the debug log.
 *
 * It implements the full Storage interface, so it can be passed to
 * pinia-plugin-persist (`storage:`) and to supabase-js (`auth.storage`).
 *
 * NOTE: this file must not import anything from the app (supabase.ts imports it).
 */

const memory = new Map<string, string>();
let backend: Storage | null | undefined; // undefined = not probed yet
let warned = false;

function warnOnce(reason: unknown): void {
  if (warned) return;
  warned = true;
  console.warn(
    '⚠️ safeStorage: localStorage is unavailable or failing, using in-memory fallback. ' +
      'Data will be lost when the app is closed.',
    reason
  );
}

function getBackend(): Storage | null {
  if (backend !== undefined) return backend;
  try {
    if (typeof window === 'undefined') {
      backend = null;
      return backend;
    }
    const s = window.localStorage; // accessing it can itself throw SecurityError
    const probe = '__atc-app_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    backend = s;
  } catch (e) {
    backend = null;
    warnOnce(e);
  }
  return backend;
}

export const safeStorage: Storage = {
  get length(): number {
    return allKeys().length;
  },

  getItem(key: string): string | null {
    // Memory first: it only ever holds values that FAILED to reach the backend
    // (quota/revoked), i.e. the newest value. Reading the backend first would
    // return a stale older value in that case.
    const pending = memory.get(key);
    if (pending !== undefined) return pending;
    const b = getBackend();
    if (b) {
      try {
        const v = b.getItem(key);
        if (v !== null) return v;
      } catch (e) {
        warnOnce(e);
      }
    }
    return null;
  },

  setItem(key: string, value: string): void {
    const b = getBackend();
    if (b) {
      try {
        b.setItem(key, value);
        memory.delete(key);
        return;
      } catch (e) {
        // Quota exceeded or storage revoked at runtime.
        warnOnce(e);
      }
    }
    memory.set(key, String(value));
  },

  removeItem(key: string): void {
    memory.delete(key);
    const b = getBackend();
    if (!b) return;
    try {
      b.removeItem(key);
    } catch (e) {
      warnOnce(e);
    }
  },

  clear(): void {
    memory.clear();
    const b = getBackend();
    if (!b) return;
    try {
      b.clear();
    } catch (e) {
      warnOnce(e);
    }
  },

  key(index: number): string | null {
    return allKeys()[index] ?? null;
  },
};

function allKeys(): string[] {
  const keys = new Set<string>(memory.keys());
  const b = getBackend();
  if (b) {
    try {
      for (let i = 0; i < b.length; i++) {
        const k = b.key(i);
        if (k !== null) keys.add(k);
      }
    } catch (e) {
      warnOnce(e);
    }
  }
  return [...keys];
}

/** True when data is really being persisted (false = in-memory fallback). */
export function isStoragePersistent(): boolean {
  return getBackend() !== null;
}
