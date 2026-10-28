<template>
  <router-view />
  <DevPremiumToggle v-if="isDev" />
  <UpdateNotification :auto-show="true" position="top-right" />
  <GlobalDebugPanel v-if="showDebugPanel" @force-restore="showRestoreModal = true" />

  <!-- First-launch restore modal: shown once when an alias + password were saved
     locally but this device's anonymous id is not premium yet. No email required. -->
  <Teleport to="body">
    <Transition name="restore-fade">
      <div v-if="showRestoreModal" class="restore-modal-overlay" @click.self="skipRestore">
        <div class="restore-modal-card">
          <div class="restore-modal-badge"><span class="badge-dot" /> PREMIUM ACCOUNT</div>
          <h2 class="restore-modal-title">Restore your paid account</h2>
          <p class="restore-modal-sub">
            You paid on another device. To bring your premium status and progress to
            <strong>this device</strong>, paste the alias and recovery password you received when
            you made the purchase.
          </p>

          <ol class="restore-modal-steps">
            <li>On the device where you bought premium, open the paywall.</li>
            <li>Tap <strong>Copy both — alias + password</strong>.</li>
            <li>Come back here and paste into the two fields below.</li>
          </ol>

          <div class="restore-modal-key-row">
            <input
              v-model="restoreAliasInput"
              class="restore-modal-input"
              type="text"
              maxlength="16"
              spellcheck="false"
              autocapitalize="characters"
              placeholder="PASTE YOUR 8-16 CHAR ALIAS"
              @keyup.enter="submitRestoreAlias"
            />
          </div>

          <div class="restore-modal-key-row" style="margin-top: 8px">
            <input
              v-model="restorePasswordInput"
              class="restore-modal-input"
              type="text"
              maxlength="16"
              spellcheck="false"
              autocapitalize="characters"
              placeholder="PASTE YOUR PASSWORD"
              @keyup.enter="submitRestoreAlias"
            />
          </div>

          <p v-if="restoreModalError" class="restore-modal-error">{{ restoreModalError }}</p>
          <p v-if="restoreModalSuccess" class="restore-modal-success">
            ✅ Restored — your progress is here.
          </p>

          <div class="restore-modal-actions">
            <button class="restore-modal-skip" @click="skipRestore">Not now</button>
            <button class="restore-modal-switch" @click="startSwitchAccountFromModal">
              Switch account
            </button>
            <button class="restore-modal-clear" @click="clearLocalData">Clear local data</button>
            <button
              class="restore-modal-cta"
              :disabled="restoringKey || !restoreAliasInput.trim() || !restorePasswordInput.trim()"
              @click="submitRestoreAlias"
            >
              {{ restoringKey ? 'Restoring...' : 'Restore' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>

  <!-- Close flow ──────────────────────────────────────────────────────────────
    Mounted ONCE, globally: the EXIT strip and the splash ✕ can be pressed on
    any route, and the overlay has to cover every layer underneath (the
    paywall, the debug panel). While a close is
    in flight it blocks every touch, click and key press.
  ────────────────────────────────────────────────────────────────────────────-->
  <AppCloseOverlay
    v-if="closePhase === 'confirm' || closePhase === 'closing' || closePhase === 'error'"
    :phase="closePhase"
    :status-text="closeStatus"
    :error-text="closeError"
    @confirm="confirmClose"
    @cancel="cancelClose"
    @retry="retryClose"
  />
  <AppGoodbye v-if="closePhase === 'closed'" :visible="true" :hint="closeGoodbyeHint" />
</template>

<script setup lang="ts">
import { defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useSettingsStore } from '@/stores/settings';
import { useMonetizationStore } from '@/stores/monetization';
import { useAppClose } from '@/composables/useAppClose';
import { clearUnloadGuard } from '@/composables/useUnloadGuard';
import UpdateNotification from '@/components/UpdateNotification.vue';
import AppCloseOverlay from '@/components/AppCloseOverlay.vue';
import AppGoodbye from '@/components/AppGoodbye.vue';
import { useUpdateCheck } from '@/composables/useUpdateCheck';
import {
  useNetwork,
  startNetworkMonitoring,
  stopNetworkMonitoring,
} from '@/composables/useNetwork';
import { useDebugStore } from '@/stores/debug';
import { tooManyAttemptsMessage } from '@/lib/credentialRules';
import { paywallBusy } from '@/lib/paywallBusy';
import { ENV } from '@/config/env';

// iOS Safari auto-zooms the viewport to any focused <input> whose computed
// font-size is below 16 CSS px, and leaves the zoom stuck after the field is
// blurred. The restore modal's alias/password inputs are 20px (above the
// threshold), but re-asserting the non-zoomable meta on every close is cheap
// insurance against any sub-16px input anywhere in the app, and it snaps a
// stuck zoom back to 1.0.
const VIEWPORT_META =
  'width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no,viewport-fit=cover';

function resetViewportMeta(): void {
  let vp = document.querySelector('meta[name=viewport]') as HTMLMetaElement | null;
  if (!vp) {
    vp = document.createElement('meta');
    vp.setAttribute('name', 'viewport');
    document.head.appendChild(vp);
  }
  vp.setAttribute('content', VIEWPORT_META);
  window.scrollTo(0, 0);
}

const router = useRouter();
const settingsStore = useSettingsStore();
const monetizationStore = useMonetizationStore();
const isDev = import.meta.env.DEV;
const { checkForUpdates } = useUpdateCheck();
const debugStore = useDebugStore();

// Global close flow. The state lives in the composable (module-level) so the
// EXIT strip and the splash ✕ — which live in different components — drive
// the very same overlay that is mounted here.
const {
  phase: closePhase,
  statusText: closeStatus,
  errorText: closeError,
  goodbyeHint: closeGoodbyeHint,
  confirmClose,
  cancelClose,
  retryClose,
} = useAppClose();

// The debug overlay shows account state, so it exists only in builds made with
// VITE_SHOW_DEBUG=true (the flag the paywall's debug block uses); it used to be
// on in every build, release included. Release builds are made with it off
// (FIX_PREMIUM.md 5.11). Loaded lazily so a release bundle does not ship it.
const showDebugPanel = ENV.VITE_SHOW_DEBUG === 'true';
const GlobalDebugPanel = showDebugPanel
  ? defineAsyncComponent(() => import('@/components/dev/GlobalDebugPanel.vue'))
  : null;

// Dev-only component — defineAsyncComponent avoids a top-level await in setup(),
// which would make setup() async and trigger the "no <Suspense> boundary" Vue warning.
const DevPremiumToggle = isDev
  ? defineAsyncComponent(() => import('@/components/dev/DevPremiumToggle.vue'))
  : null;

// First-launch restore modal state
const showRestoreModal = ref(false);
const restoreAliasInput = ref('');
const restorePasswordInput = ref('');
const restoringKey = ref(false);
const restoreModalError = ref<string | null>(null);
const restoreModalSuccess = ref(false);
const restoreModalSkipped = ref(false);

function skipRestore(): void {
  debugStore.info('App.vue: skipRestore called');
  // User declined to restore. Just dismiss the modal.
  // We do NOT clear premium state locally — the server sync will confirm
  // the actual premium status. "Not now" just means "ask me later".
  restoreModalSkipped.value = true;
  showRestoreModal.value = false;
  resetViewportMeta();
}

function clearLocalData(): void {
  debugStore.info('App.vue: clearLocalData called');
  console.log('🗑️ App.vue: User cleared local data from restore modal');
  monetizationStore.logoutLocally('user cleared local data');
  skipRestore();
}

async function startSwitchAccountFromModal(): Promise<void> {
  debugStore.info('App.vue: startSwitchAccountFromModal called');
  const result = await monetizationStore.unlinkDevice();
  if (!result.success) {
    restoreModalError.value = 'Could not switch account. Check your connection and try again.';
    return;
  }
  if (result.wasLinked) {
    skipRestore();
    // Device is now free — user can enter another account's alias + password
    restoreAliasInput.value = '';
    restorePasswordInput.value = '';
  }
}

async function submitRestoreAlias(): Promise<void> {
  debugStore.info('App.vue: submitRestoreAlias called');
  const alias = restoreAliasInput.value.trim();
  const password = restorePasswordInput.value.trim();
  if (!alias || !password) return;
  restoringKey.value = true;
  restoreModalError.value = null;
  restoreModalSuccess.value = false;

  try {
    debugStore.info('App.vue: calling restoreAccount', { alias });
    const result = await monetizationStore.restoreAccount(alias, password);
    debugStore.info('App.vue: restoreAccount result', {
      success: result.success,
      error: result.error,
    });
    if (result.success) {
      restoreModalSuccess.value = true;
      resetViewportMeta();
      setTimeout(() => {
        showRestoreModal.value = false;
      }, 700);
    } else if (result.error === 'not_found') {
      // Alias/password pair does not belong to any paid account. Log out
      // locally — do NOT send anything to the server (no downgrade, no leak).
      monetizationStore.logoutLocally('restore account not found');
      restoreModalError.value = 'No user found, check your spelling';
    } else if (result.error === 'not_paid') {
      restoreModalError.value = 'This alias is not associated with a paid account';
    } else if (result.error === 'already_linked') {
      restoreModalError.value = 'This device is already linked to a different account';
    } else if (result.error === 'rate_limited') {
      restoreModalError.value = tooManyAttemptsMessage(result.retryAfterSeconds);
    } else if (result.error === 'invalid') {
      restoreModalError.value = 'Check the alias and password, then try again';
    } else if (result.error === 'network') {
      restoreModalError.value = 'Network error — please check your connection and try again';
    } else {
      restoreModalError.value = 'Unknown error, try again';
    }
  } catch (e) {
    restoreModalError.value = e instanceof Error ? e.message : String(e);
  } finally {
    restoringKey.value = false;
  }
}

let backHandle: { remove: () => void } | null = null;
void (async () => {
  try {
    const { App } = await import('@capacitor/app');
    backHandle = await App.addListener('backButton', ({ canGoBack }) => {
      // A close is in flight: the app is on its way out and every input must
      // be ignored, including the hardware back button.
      if (closePhase.value !== 'idle') return;
      // The paywall is waiting for a request it started: leaving the page would
      // drop the paywall mid-restore or mid-purchase.
      if (paywallBusy.value) return;
      // `canGoBack` is native WebView history depth; with hash routing it
      // matches the router stack, so the global guard (c58e790) redirects a
      // blocked target (splash, game) to Home on the resulting pop.
      if (!canGoBack) return; // nothing to pop: stay (exit is the power button)
      void router.back();
    });
  } catch {
    // @capacitor/app unavailable (web / Electron): no hardware back button.
  }
})();

onMounted(async () => {
  startNetworkMonitoring();
  // 1. Load settings synchronously (local, instant)
  settingsStore.loadSettings();
  console.log('✅ Settings loaded');

  // 2. Init monetization (async — auth + Supabase sync)
  //    Router guard also calls this, but doing it here ensures
  //    isPremium is resolved before the first view renders.
  //    init() is idempotent — safe to call twice.
  await monetizationStore.init();
  console.log(`✅ Monetization ready — premium: ${monetizationStore.isPremium}`);

  // 3. Check for updates (non-blocking, respects user settings & interval)
  void checkForUpdates();

  watch(
    () => showRestoreModal.value,
    (showing) => {
      debugStore.info('App.vue: restore modal visibility changed', { showing });
      debugStore.setRestoreModalVisible(showing);
    }
  );

  watch(
    () => monetizationStore.needsRestore,
    (needsRestore) => {
      debugStore.info('App.vue: needsRestore changed', { needsRestore });
    }
  );

  // Show the restore modal once if a key was saved locally but this device's
  // anonymous id is not premium yet (user bought on another device).
  // Only runs AFTER monetization is fully initialized and isPremium is settled.
  debugStore.info('App.vue: evaluating restore modal conditions', {
    restoreModalSkipped: restoreModalSkipped.value,
    isInitialized: monetizationStore.isInitialized,
    needsRestore: monetizationStore.needsRestore,
    isPremium: monetizationStore.isPremium,
  });
  if (
    !restoreModalSkipped.value &&
    monetizationStore.isInitialized &&
    monetizationStore.needsRestore &&
    !monetizationStore.isPremium
  ) {
    debugStore.info('App.vue: showing restore modal');
    showRestoreModal.value = true;
  } else {
    debugStore.debug('App.vue: restore modal not shown', {
      restoreModalSkipped: restoreModalSkipped.value,
      isInitialized: monetizationStore.isInitialized,
      needsRestore: monetizationStore.needsRestore,
      isPremium: monetizationStore.isPremium,
    });
  }
});

onBeforeUnmount(() => {
  stopNetworkMonitoring();
  backHandle?.remove();
  clearUnloadGuard();
});
</script>

<style>
/* ============================================
   CRITICAL: REMOVE ALL SCROLLBARS
   ============================================ */
::-webkit-scrollbar {
  display: none !important;
  width: 0 !important;
  height: 0 !important;
  background: transparent !important;
}

html {
  scrollbar-width: none !important;
}

html {
  -ms-overflow-style: none !important;
}

/* ============================================
   RESET & FULLSCREEN BASE STYLES
   ============================================ */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  scrollbar-width: none !important;
  -ms-overflow-style: none !important;
}

*::-webkit-scrollbar {
  display: none !important;
}

html {
  width: 100%;
  height: 100%;
  overflow: hidden !important;
  position: fixed;
  top: 0;
  left: 0;
  touch-action: none;
  overscroll-behavior: none;
}

body {
  width: 100%;
  height: 100%;
  overflow: hidden !important;
  position: fixed;
  top: 0;
  left: 0;
  margin: 0;
  padding: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell,
    sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  -webkit-tap-highlight-color: rgba(0, 0, 0, 0);
  touch-action: none;
  overscroll-behavior: none;
}

#app {
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  position: fixed;
  top: 0;
  left: 0;
  touch-action: none;
  overscroll-behavior: none;
}

#game-container {
  width: 100%;
  height: 100%;
  overflow: hidden;
  position: relative;
  touch-action: none;
}

canvas {
  display: block;
  position: absolute;
  top: 0;
  left: 0;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-tap-highlight-color: rgba(0, 0, 0, 0);
  outline: none;
}

::-webkit-scrollbar {
  display: none;
  width: 0;
  height: 0;
}

* {
  scrollbar-width: none;
  -ms-overflow-style: none;
}

@supports (-webkit-touch-callout: none) {
  html,
  body {
    height: -webkit-fill-available;
  }

  #app {
    height: -webkit-fill-available;
    min-height: -webkit-fill-available;
  }
}

body {
  overscroll-behavior-y: contain;
  -webkit-overflow-scrolling: auto;
}

@media (max-width: 768px) {
  html,
  body,
  #app {
    position: fixed;
    overflow: hidden;
    width: 100%;
    height: 100%;
    touch-action: none;
  }
}

.game-wrapper,
#game-container {
  -webkit-user-select: none;
  -moz-user-select: none;
  -ms-user-select: none;
  user-select: none;
  -webkit-touch-callout: none;
}

:root {
  --modal-background-gradient: linear-gradient(135deg, #a4d4e6 0%, #7ec0df 50%, #519bbd 100%);
}

.modal-content,
.scrollable-panel {
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.settings-modal-overlay .modal-content {
  overflow-y: auto !important;
  -webkit-overflow-scrolling: touch;
}

/* @media (orientation: portrait) and (max-width: 768px) {
  body::after {
    content: '↻ Please rotate your device to landscape mode';
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: rgba(0, 0, 0, 0.95);
    color: white;
    padding: 30px 50px;
    border-radius: 15px;
    z-index: 10000;
    font-size: 20px;
    text-align: center;
    font-weight: bold;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
  }
} */
/* ── First-launch restore modal ─────────────────────────────────────── */
.restore-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 10001;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(4, 13, 20, 0.88);
  backdrop-filter: blur(10px);
}

.restore-modal-card {
  width: 100%;
  max-width: 420px;
  background: #071520;
  border: 1px solid rgba(0, 191, 255, 0.3);
  border-radius: 20px;
  padding: 32px 28px 24px;
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.7);
  text-align: center;
}

.restore-modal-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: #00bfff;
  margin-bottom: 14px;
}

.restore-modal-title {
  font-size: 20px;
  font-weight: 700;
  color: #fff;
  margin: 0 0 10px;
}

.restore-modal-sub {
  font-size: 13px;
  color: #7aa0b5;
  line-height: 1.5;
  margin: 0 0 20px;
}

.restore-modal-key-row {
  margin-bottom: 12px;
}

.restore-modal-input {
  width: 100%;
  height: 52px;
  background: rgba(0, 191, 255, 0.06);
  border: 1px solid rgba(0, 191, 255, 0.25);
  border-radius: 12px;
  color: #fff;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-align: center;
  text-transform: uppercase;
}

.restore-modal-input:focus {
  outline: none;
  border-color: #00bfff;
  box-shadow: 0 0 0 3px rgba(0, 191, 255, 0.15);
}

.restore-modal-error {
  color: #ff8099;
  font-size: 13px;
  margin: 8px 0;
}

.restore-modal-success {
  color: #6fe0a0;
  font-size: 13px;
  margin: 8px 0;
}

.restore-modal-actions {
  display: flex;
  gap: 10px;
  margin-top: 18px;
}

.restore-modal-skip {
  flex: 1;
  height: 48px;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  color: #7aa0b5;
  font-size: 14px;
  cursor: pointer;
}

.restore-modal-clear {
  flex: 1;
  height: 48px;
  background: transparent;
  border: 1px solid rgba(255, 80, 80, 0.4);
  border-radius: 12px;
  color: #ff8099;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}

.restore-modal-clear:hover {
  background: rgba(255, 80, 80, 0.15);
  border-color: rgba(255, 80, 80, 0.7);
}

.restore-modal-cta {
  flex: 1;
  height: 48px;
  background: linear-gradient(135deg, #00bfff 0%, #0099cc 100%);
  border: none;
  border-radius: 12px;
  color: #040d14;
  font-weight: 700;
  font-size: 14px;
  cursor: pointer;
}

.restore-modal-cta:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.restore-fade-enter-active,
.restore-fade-leave-active {
  transition: opacity 0.25s ease;
}

.restore-fade-enter-from,
.restore-fade-leave-to {
  opacity: 0;
}
</style>
