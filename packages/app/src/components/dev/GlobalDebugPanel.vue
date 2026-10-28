<template>
  <Teleport to="body">
    <div v-if="debugStore.isVisible" class="global-debug-panel">
      <!-- Header is always accessible: the whole bar toggles body expansion. -->
      <div class="global-debug-header" @click="expand = !expand">
        <div class="global-debug-title">
          <span class="global-debug-dot" :class="{ active: debugStore.logs.length > 0 }"></span>
          DEBUG
        </div>
        <div class="global-debug-actions">
          <button
            class="global-debug-btn"
            title="Force show restore modal"
            @click.stop="forceRestore"
          >
            Restore
          </button>
          <button class="global-debug-btn" title="Copy logs" @click.stop="copyLogs">Copy</button>
          <button class="global-debug-btn" title="Clear logs" @click.stop="clearLogs">Clear</button>
          <button class="global-debug-btn" title="Toggle visibility" @click.stop="expand = !expand">
            {{ expand ? '−' : '+' }}
          </button>
        </div>
      </div>

      <transition name="debug-slide">
        <div v-if="expand" class="global-debug-body">
          <!-- Device / runtime -->
          <div class="global-debug-section">
            <div class="global-debug-section-title">Device</div>
            <div class="global-debug-row">
              <span class="global-debug-key">runtime</span>
              <span class="global-debug-val">{{ runtime }}</span>
            </div>
            <div class="global-debug-row">
              <span class="global-debug-key">capPlatform</span>
              <span class="global-debug-val">{{ capPlatform }}</span>
            </div>
            <div class="global-debug-row">
              <span class="global-debug-key">isNative</span>
              <span class="global-debug-val">{{ isNative }}</span>
            </div>
            <div class="global-debug-row">
              <span class="global-debug-key">userAgent</span>
              <span class="global-debug-val">{{ userAgent }}</span>
            </div>
            <div class="global-debug-row">
              <span class="global-debug-key">screen</span>
              <span class="global-debug-val">{{ screenSize }}</span>
            </div>
            <div class="global-debug-row">
              <span class="global-debug-key">dpr</span>
              <span class="global-debug-val">{{ dpr }}</span>
            </div>
            <div class="global-debug-row">
              <span class="global-debug-key">orientation</span>
              <span class="global-debug-val">{{ orientation ?? '—' }}</span>
            </div>
            <div class="global-debug-row">
              <span class="global-debug-key">deviceInfo</span>
              <span class="global-debug-val">{{
                deviceInfo ? JSON.stringify(deviceInfo) : '—'
              }}</span>
            </div>
          </div>

          <!-- Monetization state -->
          <div class="global-debug-section">
            <div class="global-debug-section-title">Monetization</div>
            <div class="global-debug-row">
              <span class="global-debug-key">isPremium</span>
              <span class="global-debug-val">{{ monetization.isPremium }}</span>
            </div>
            <div class="global-debug-row">
              <span class="global-debug-key">isInitialized</span>
              <span class="global-debug-val">{{ monetization.isInitialized }}</span>
            </div>
            <div class="global-debug-row">
              <span class="global-debug-key">isLoading</span>
              <span class="global-debug-val">{{ monetization.isLoading }}</span>
            </div>
            <div class="global-debug-row">
              <span class="global-debug-key">platform</span>
              <span class="global-debug-val">{{ monetization.platform }}</span>
            </div>
            <div class="global-debug-row">
              <span class="global-debug-key">needsRestore</span>
              <span class="global-debug-val">{{ monetization.needsRestore }}</span>
            </div>
            <div class="global-debug-row">
              <span class="global-debug-key">userId</span>
              <span class="global-debug-val">{{ monetization.userId ?? '—' }}</span>
            </div>
            <div class="global-debug-row">
              <span class="global-debug-key">accountId</span>
              <span class="global-debug-val">{{ monetization.accountId ?? '—' }}</span>
            </div>
            <div class="global-debug-row">
              <span class="global-debug-key">userAlias</span>
              <span class="global-debug-val">{{ monetization.userAlias ?? '—' }}</span>
            </div>
            <div class="global-debug-row">
              <span class="global-debug-key">userPassword</span>
              <span class="global-debug-val">{{ maskSecret(monetization.userPassword) }}</span>
            </div>
            <div class="global-debug-row">
              <span class="global-debug-key">recoveryWord</span>
              <span class="global-debug-val">{{ maskSecret(monetization.recoveryWord) }}</span>
            </div>
            <div class="global-debug-row">
              <span class="global-debug-key">purchaseError</span>
              <span class="global-debug-val">{{ monetization.purchaseError ?? '—' }}</span>
            </div>
          </div>

          <!-- Paywall + restore modal state (cross-component flags synced via the debug store) -->
          <div class="global-debug-section">
            <div class="global-debug-section-title">App State</div>
            <div class="global-debug-row">
              <span class="global-debug-key">paywallMounted</span>
              <span class="global-debug-val">{{ debugStore.paywallVisible }}</span>
            </div>
            <div class="global-debug-row">
              <span class="global-debug-key">restoreModal</span>
              <span class="global-debug-val">{{ debugStore.restoreModalVisible }}</span>
            </div>
          </div>

          <!-- LocalStorage -->
          <div class="global-debug-section">
            <div class="global-debug-section-title">
              LocalStorage
              <button class="global-debug-btn" @click.stop="refreshLocalStorage">Refresh</button>
            </div>
            <div v-if="Object.keys(localStorageData).length === 0" class="global-debug-log-empty">
              No localStorage
            </div>
            <div v-else>
              <div v-for="entry in localStorageEntries" :key="entry.key" class="global-debug-row">
                <span class="global-debug-key">{{ entry.key }}</span>
                <span class="global-debug-val">{{ entry.value }}</span>
              </div>
            </div>
          </div>

          <!-- Strips lifecycle (per column + index) -->
          <div class="global-debug-section">
            <div class="global-debug-section-title">Strips ({{ stripSections.length }})</div>
            <div v-if="stripSections.length === 0" class="global-debug-log-empty">
              No strip events
            </div>
            <div v-for="s in stripSections" :key="s.col + '-' + s.i" class="global-debug-section">
              <div class="global-debug-row">
                <span class="global-debug-key">col</span>
                <span class="global-debug-val">{{ s.col }}</span>
              </div>
              <div class="global-debug-row">
                <span class="global-debug-key">i</span>
                <span class="global-debug-val">{{ s.i }}</span>
              </div>
              <div class="global-debug-row">
                <span class="global-debug-key">fallStart</span>
                <span class="global-debug-val">{{ s.fallStart ?? '—' }}</span>
              </div>
              <div class="global-debug-row">
                <span class="global-debug-key">fallEnd</span>
                <span class="global-debug-val">{{ s.fallEnd ?? '—' }}</span>
              </div>
              <div class="global-debug-row">
                <span class="global-debug-key">pressStart</span>
                <span class="global-debug-val">{{ s.pressStart ?? '—' }}</span>
              </div>
              <div class="global-debug-row">
                <span class="global-debug-key">pressEnd</span>
                <span class="global-debug-val">{{ s.pressEnd ?? '—' }}</span>
              </div>
              <div class="global-debug-row">
                <span class="global-debug-key">hoverStart</span>
                <span class="global-debug-val">{{ s.hoverStart ?? '—' }}</span>
              </div>
              <div class="global-debug-row">
                <span class="global-debug-key">hoverEnd</span>
                <span class="global-debug-val">{{ s.hoverEnd ?? '—' }}</span>
              </div>
              <div class="global-debug-row">
                <span class="global-debug-key">commit</span>
                <span class="global-debug-val">{{ s.commit ? '✓' : '' }}</span>
              </div>
              <div class="global-debug-row">
                <span class="global-debug-key">gateBlocked</span>
                <span class="global-debug-val">{{ s.gateBlocked ? '⛔' : '' }}</span>
              </div>
            </div>
          </div>

          <!-- Timestamped, scrollable logs -->
          <div class="global-debug-section">
            <div class="global-debug-section-title">Logs ({{ debugStore.sortedLogs.length }})</div>
            <div ref="logEl" class="global-debug-logs">
              <div
                v-for="log in debugStore.sortedLogs.slice(0, 200)"
                :key="log.id"
                class="global-debug-log-entry"
                :class="`log-${log.level}`"
              >
                <span class="global-debug-log-ts">{{ log.time }}</span>
                <span class="global-debug-log-level">{{ log.level.toUpperCase() }}</span>
                <span class="global-debug-log-msg">{{ log.message }}</span>
                <span v-if="log.context" class="global-debug-log-ctx">{{
                  JSON.stringify(log.context)
                }}</span>
              </div>
              <div v-if="debugStore.sortedLogs.length === 0" class="global-debug-log-empty">
                No logs
              </div>
            </div>
          </div>
        </div>
      </transition>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue';
import { Capacitor } from '@capacitor/core';
import { detectRuntime } from '@/utils/platform';
import { getDeviceInfo } from '@/utils/deviceInfo';
import { useDebugStore } from '@/stores/debug';
import { useMonetizationStore } from '@/stores/monetization';
import { maskSecret, redactStorageValue } from '@/lib/redact';

const debugStore = useDebugStore();
const monetization = useMonetizationStore();

const runtime = typeof window === 'undefined' ? 'n/a' : detectRuntime();
const capPlatform = typeof Capacitor === 'undefined' ? 'n/a' : Capacitor.getPlatform();
const isNative =
  typeof Capacitor === 'undefined' || typeof Capacitor.isNativePlatform === 'undefined'
    ? 'n/a'
    : Capacitor.isNativePlatform();
const userAgent = typeof navigator === 'undefined' ? 'n/a' : navigator.userAgent;
const screenSize = typeof screen === 'undefined' ? '—' : `${screen.width}×${screen.height}`;
const dpr = typeof window === 'undefined' ? '—' : window.devicePixelRatio;
const orientation =
  typeof screen === 'undefined' || !screen.orientation ? '—' : screen.orientation.type;
const deviceInfo =
  typeof window === 'undefined' || typeof getDeviceInfo !== 'function'
    ? undefined
    : getDeviceInfo();

const emit = defineEmits<{
  (e: 'force-restore'): void;
}>();

const expand = ref(false);
const logEl = ref<HTMLElement | null>(null);

// Keep the newest-first log viewport anchored at the top as entries arrive.
watch(
  () => debugStore.sortedLogs.length,
  () => nextTick(() => logEl.value && (logEl.value.scrollTop = 0))
);

function clearLogs(): void {
  debugStore.clearLogs();
}

function copyLogs(): void {
  debugStore.copyLogs();
}

function forceRestore(): void {
  emit('force-restore');
}

// ── LocalStorage ──────────────────────────────────────────────────────────────
const KNOWN_KEYS = [
  'atc-app_user_alias_v1',
  'atc-app_user_password_v1',
  'atc-app_passed_levels_v1',
];

// Every secret (password, recovery word, the Supabase session tokens) is shown
// as "set (N chars)" only, so the panel can be screenshotted or copied safely.
function maskValue(key: string, raw: string): string {
  return redactStorageValue(key, raw);
}

const localStorageData = ref<Record<string, string>>({});

function refreshLocalStorage(): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    localStorageData.value = {};
    return;
  }
  const result: Record<string, string> = {};
  // Known keys first (even if empty)
  for (const k of KNOWN_KEYS) {
    let raw: string | null;
    try {
      raw = window.localStorage.getItem(k);
    } catch {
      raw = null;
    }
    result[k] = raw === null ? '(empty)' : maskValue(k, raw);
  }
  // Any other keys
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k || k in result) continue;
      const raw = window.localStorage.getItem(k);
      result[k] = raw === null ? '(empty)' : maskValue(k, raw);
    }
  } catch {
    // Non-fatal
  }
  localStorageData.value = result;
}

interface StripLogContext {
  kind: string;
  i: number;
  col: string;
  detail: string;
}

interface StripSection {
  col: string;
  i: number;
  fallStart: string | null;
  fallEnd: string | null;
  pressStart: string | null;
  pressEnd: string | null;
  hoverStart: string | null;
  hoverEnd: string | null;
  commit: string | null;
  gateBlocked: string | null;
}

const stripSections = computed(() => {
  const groups = new Map<string, StripSection>();
  for (const log of debugStore.logs) {
    if (!log.source || !log.source.startsWith('strip:')) continue;
    const raw = log.context;
    const ctx: StripLogContext =
      raw && typeof raw === 'object' ? (raw as StripLogContext) : ({} as StripLogContext);
    const col = ctx.col ?? log.source.split(':')[1];
    const i = ctx.i;
    const kind = ctx.kind;
    const key = `${col}:${i}`;
    if (!groups.has(key)) {
      groups.set(key, {
        col,
        i,
        fallStart: null,
        fallEnd: null,
        pressStart: null,
        pressEnd: null,
        hoverStart: null,
        hoverEnd: null,
        commit: null,
        gateBlocked: null,
      });
    }
    const g = groups.get(key)!;
    if (kind === 'fallStart' && !g.fallStart) g.fallStart = log.time;
    if (kind === 'fallEnd' && !g.fallEnd) g.fallEnd = log.time;
    if (kind === 'pressStart' && !g.pressStart) g.pressStart = log.time;
    if (kind === 'pressEnd' && !g.pressEnd) g.pressEnd = log.time;
    if (kind === 'hoverStart' && !g.hoverStart) g.hoverStart = log.time;
    if (kind === 'hoverEnd' && !g.hoverEnd) g.hoverEnd = log.time;
    if (kind === 'commit') g.commit = log.time;
    if (kind === 'gateBlocked') g.gateBlocked = log.time;
  }
  return Array.from(groups.values()).map((g) => ({
    col: g.col,
    i: g.i,
    fallStart: g.fallStart,
    fallEnd: g.fallEnd,
    pressStart: g.pressStart,
    pressEnd: g.pressEnd,
    hoverStart: g.hoverStart,
    hoverEnd: g.hoverEnd,
    commit: !!g.commit,
    gateBlocked: !!g.gateBlocked,
  }));
});

const localStorageEntries = computed(() =>
  Object.entries(localStorageData.value).map(([key, value]) => ({ key, value }))
);

// Read on mount
refreshLocalStorage();
</script>

<style scoped>
.global-debug-panel {
  position: fixed;
  top: 12px;
  right: 12px;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.92);
  border: 1px solid rgba(0, 191, 255, 0.6);
  border-radius: 6px;
  font-family: 'Courier New', Courier, monospace;
  font-size: 11px;
  color: #fff;
  width: 90vw;
  max-width: 500px;
  max-height: 50vh;
  overflow: hidden;
  backdrop-filter: blur(8px);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.8);
  display: flex;
  flex-direction: column;
}

.global-debug-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 6px;
  background: rgba(0, 191, 255, 0.2);
  border-radius: 6px 6px 0 0;
  cursor: pointer;
  user-select: none;
  flex-shrink: 0;
}

.global-debug-header .global-debug-actions {
  display: flex;
  gap: 2px;
  cursor: default;
}

.global-debug-title {
  display: flex;
  align-items: center;
  gap: 4px;
  font-weight: bold;
  color: #00bfff;
  font-size: 10px;
  letter-spacing: 0.08em;
}

.global-debug-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #555;
  box-shadow: 0 0 4px #555;
  transition: all 120ms ease;
}

.global-debug-dot.active {
  background: #00bfff;
  box-shadow: 0 0 8px #00bfff;
}

.global-debug-btn {
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #fff;
  font-size: 9px;
  padding: 2px 4px;
  border-radius: 3px;
  cursor: pointer;
  font-family: 'Courier New', Courier, monospace;
  transition: background 120ms ease;
}

.global-debug-btn:hover {
  background: rgba(255, 255, 255, 0.25);
}

.global-debug-body {
  padding: 6px;
  overflow-y: auto;
  max-height: calc(50vh - 34px);
}

.global-debug-section {
  margin-bottom: 6px;
}

.global-debug-section:last-child {
  margin-bottom: 0;
}

.global-debug-section-title {
  color: #00bfff;
  font-weight: bold;
  font-size: 10px;
  margin-bottom: 2px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.global-debug-row {
  display: flex;
  justify-content: space-between;
  line-height: 1.4;
}

.global-debug-key {
  color: #aaa;
}

.global-debug-val {
  color: #fff;
  word-break: break-word;
  max-width: 260px;
  text-align: right;
}

.global-debug-logs {
  max-height: 140px;
  overflow-y: auto;
  background: rgba(0, 0, 0, 0.5);
  border-radius: 3px;
  padding: 3px;
}

.global-debug-log-entry {
  line-height: 1.3;
  margin-bottom: 2px;
  word-break: break-word;
  display: flex;
  align-items: baseline;
  gap: 4px;
}

.global-debug-log-ts {
  color: #666;
  white-space: nowrap;
}

.global-debug-log-level {
  color: #666;
  white-space: nowrap;
  font-variant: small-caps;
}

.global-debug-log-msg {
  color: #fff;
  flex: 1;
}

.log-info .global-debug-log-msg {
  color: #fff;
}

.log-warn .global-debug-log-msg {
  color: #ffcc00;
}

.log-error .global-debug-log-msg {
  color: #ff6666;
}

.log-debug .global-debug-log-msg {
  color: #aaa;
}

.global-debug-log-ctx {
  color: #999;
  margin-left: 4px;
}

.global-debug-log-empty {
  color: #666;
  font-style: italic;
}

.debug-slide-enter-active,
.debug-slide-leave-active {
  transition: height 0.15s ease, opacity 0.15s ease;
  overflow: hidden;
}

.debug-slide-enter-from,
.debug-slide-leave-to {
  height: 0;
  opacity: 0;
}
</style>
