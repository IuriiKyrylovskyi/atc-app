import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface DebugLog {
  id: string;
  level: LogLevel;
  /** Full ISO timestamp, used for sorting. */
  timestamp: string;
  /** Display time, e.g. `14:03:12.456`. */
  time: string;
  source: string;
  message: string;
  context?: unknown;
}

export const useDebugStore = defineStore('debug', () => {
  const logs = ref<DebugLog[]>([]);
  const isVisible = ref(true); // Always visible by default
  const maxLogs = 200;

  // App-state flags synced from other components so the panel can reflect them
  // without prop drilling through the route stack.
  const paywallVisible = ref(false);
  const restoreModalVisible = ref(false);

  function addLog(source: string, message: string, data?: unknown, level: LogLevel = 'info') {
    const now = new Date();
    const entry: DebugLog = {
      id: `${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
      level,
      timestamp: now.toISOString(),
      time: now.toLocaleTimeString([], { hour12: false }),
      source,
      message,
      context: data,
    };
    logs.value.push(entry);
    if (logs.value.length > maxLogs) logs.value.shift();
    const dataStr = data ? ` ${JSON.stringify(data)}` : '';
    const prefix =
      level === 'error' ? '❌' : level === 'warn' ? '⚠️ ' : level === 'debug' ? '🔧 ' : '🔍 ';
    // eslint-disable-next-line no-console
    // console.log(`${prefix}[${entry.time}] [${source}] ${message}${dataStr}`);
  }

  /** Convenience wrappers — callers pass the message (with an embedded source
   * prefix like `monetization: …`) as the first argument. */
  function info(message: string, data?: unknown) {
    addLog('app', message, data, 'info');
  }
  function warn(message: string, data?: unknown) {
    addLog('app', message, data, 'warn');
  }
  function error(message: string, data?: unknown) {
    addLog('app', message, data, 'error');
  }
  function debug(message: string, data?: unknown) {
    addLog('app', message, data, 'debug');
  }

  function clearLogs() {
    logs.value = [];
  }

  /** Copy all logs to the clipboard as plain text. */
  function copyLogs(): void {
    const text = logs.value
      .map(
        (l) =>
          `[${l.time}] [${l.level.toUpperCase()}] [${l.source}] ${l.message}${
            l.context ? ` ${JSON.stringify(l.context)}` : ''
          }`
      )
      .join('\n');
    navigator.clipboard
      .writeText(text)
      .catch((e) => console.error('debugStore.copyLogs failed:', e));
  }

  /** Most recent first so the newest entries sit at the top of the scrollable view. */
  const sortedLogs = computed(() => [...logs.value].reverse());

  function setPaywallVisible(v: boolean): void {
    paywallVisible.value = v;
  }

  function setRestoreModalVisible(v: boolean): void {
    restoreModalVisible.value = v;
  }

  function toggleVisibility() {
    isVisible.value = !isVisible.value;
  }
  function show() {
    isVisible.value = true;
  }
  function hide() {
    isVisible.value = false;
  }

  return {
    logs,
    isVisible,
    paywallVisible,
    restoreModalVisible,
    addLog,
    info,
    warn,
    error,
    debug,
    clearLogs,
    copyLogs,
    sortedLogs,
    setPaywallVisible,
    setRestoreModalVisible,
    toggleVisibility,
    show,
    hide,
  };
});
