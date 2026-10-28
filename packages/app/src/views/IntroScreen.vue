<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { Capacitor } from '@capacitor/core';
import { useMonetizationStore } from '@/stores/monetization';
import { useAppClose } from '@/composables/useAppClose';
import { unlockAudio } from '@/composables/useStrips';
import { ROUTE_TO_PAGE } from '@/composables/usePageName';

const appVersion = __APP_VERSION__;

const router = useRouter();
const monetization = useMonetizationStore();
const { requestClose, isPlainWeb } = useAppClose();

const isReady = ref(false);
const loadingProgress = ref(0);
const isStarting = ref(false);

// ATT pre-prompt — iOS only, shown before the system ATT dialog
const showAttPrePrompt = ref(false);
const isIOS = Capacitor.getPlatform() === 'ios';

onMounted(() => {
  // IntroScreen is a splash screen only — it does not control real asset
  // loading. Real progress happens later in AirTrafficCanvas via
  // 'assets:progress' events from BootScene.
  // This brief animation just gives the user visual feedback during
  // Vue initialisation before the game canvas mounts.
  const steps = [10, 25, 40, 60, 75, 90, 100];
  let i = 0;
  const interval = setInterval(() => {
    if (i < steps.length) {
      loadingProgress.value = steps[i++];
    } else {
      clearInterval(interval);
      isReady.value = true;
    }
  }, 150);
});

/**
 * "Start Game" tapped.
 *
 * iOS flow:
 *   1. Show our ATT pre-prompt (Apple-required context before the system dialog)
 *   2. User taps Continue → confirmAttAndStart() → system ATT dialog fires
 *   3. User taps No thanks → initAndNavigate() without ATT (non-personalised ads)
 *
 * Android / web flow:
 *   1. Skip directly to initAndNavigate() (no ATT concept)
 */
const startGame = async () => {
  if (isStarting.value) return;

  // Unlock HTML5 Audio on the first user gesture so that
  // Home.vue's strip landing sounds play without autoplay blocking.
  unlockAudio();

  if (isIOS) {
    showAttPrePrompt.value = true;
    return;
  }

  await initAndNavigate();
};

const confirmAttAndStart = async () => {
  showAttPrePrompt.value = false;
  await initAndNavigate();
};

const dismissAttPrePrompt = () => {
  showAttPrePrompt.value = false;
  // User declined pre-prompt — still navigate, AdMob serves non-personalised ads
  initAndNavigate();
};

async function initAndNavigate() {
  if (isStarting.value) return;
  isStarting.value = true;

  try {
    // Creates anonymous user + syncs premium status from Supabase
    await monetization.init();

    // iOS: triggers the system ATT dialog now that user has engaged.
    // Android / web: no-op.
    await monetization.requestTrackingTransparency();

    router.push(`/${ROUTE_TO_PAGE.Home}`);
  } finally {
    isStarting.value = false;
  }
}

const quitApp = () => void requestClose();
</script>

<template>
  <div class="intro-screen">
    <!-- Decorative sky elements -->
    <div class="sky-deco" aria-hidden="true">
      <div class="deco-ring ring-1" />
      <div class="deco-ring ring-2" />
    </div>

    <div class="logo">
      <h1>ATC-APP</h1>
      <p class="tagline">Air Traffic Control</p>
    </div>

    <div class="interact-block">
      <div v-if="!isReady" class="loading">
        <div class="loading-label">Loading assets</div>
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: `${loadingProgress}%` }">
            <div class="progress-glow" />
          </div>
        </div>
        <div class="loading-row">
          <span class="loading-step">Initialising…</span>
          <span class="loading-pct">{{ loadingProgress }}%</span>
        </div>
      </div>

      <div v-else class="start-section">
        <button class="start-button" :disabled="isStarting" @click="startGame">
          {{ isStarting ? 'Starting…' : 'Start Game' }}
        </button>
      </div>
    </div>

    <div class="version">v{{ appVersion }}</div>

    <button v-if="isReady && !isPlainWeb" class="quit-btn" aria-label="Quit" @click="quitApp">
      ✕
    </button>

    <!-- ATT pre-prompt (iOS only) ─────────────────────────────────────────────
      Apple requires apps to explain WHY they need tracking before the system
      dialog appears. Showing this first significantly improves opt-in rates
      and is required to avoid App Store rejection.
    ──────────────────────────────────────────────────────────────────────────-->
    <Teleport to="body">
      <div v-if="showAttPrePrompt" class="att-overlay" @click.self="dismissAttPrePrompt">
        <div class="att-modal">
          <div class="att-icon">📊</div>
          <h2 class="att-title">A quick note</h2>
          <p class="att-body">
            ATC-APP shows ads to free players. Allowing tracking lets us show you ads that are more
            relevant to your interests — it helps keep the game free.
          </p>
          <p class="att-note">You can change this any time in iOS Settings → Privacy → Tracking.</p>
          <button class="att-confirm" @click="confirmAttAndStart">Continue</button>
          <button class="att-skip" @click="dismissAttPrePrompt">No thanks</button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
/* ─── tokens ─────────────────────────────────────────────────────────────── */
/* Defined on .intro-screen (the component root), NOT :root.
   In <style scoped> Vue rewrites :root to :root[data-v-xxxx] which never
   matches <html>, so variables would be silently unreachable.
   Custom properties cascade to all descendants from the component root. */
.intro-screen {
  --sky-top: #5bc8f0;
  --sky-bot: #3aaad6;
  --glass: rgba(255, 255, 255, 0.18);
  --glass-border: rgba(255, 255, 255, 0.3);

  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100svh;
  padding: env(safe-area-inset-top, 0) clamp(20px, 5vw, 60px)
    max(20px, env(safe-area-inset-bottom, 20px));
  background: linear-gradient(135deg, #a4d4e6 0%, #7ec0df 50%, #519bbd 100%);
  color: white;
  text-align: center;
  font-family: -apple-system, 'SF Pro Rounded', BlinkMacSystemFont, 'Segoe UI', sans-serif;
  overflow: hidden;
}

/* ─── decorative sky layer ───────────────────────────────────────────────── */
.sky-deco {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}

.deco-ring {
  position: absolute;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.1);
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
}
.ring-1 {
  width: min(340px, 80vw);
  height: min(340px, 80vw);
}
.ring-2 {
  width: min(580px, 130vw);
  height: min(580px, 130vw);
}

/* Faint ghost planes that drift across the background */
.deco-plane {
  position: absolute;
  color: rgba(255, 255, 255, 0.12);
  font-size: clamp(28px, 5vw, 48px);
  animation: drift linear infinite;

  & img {
    width: clamp(28px, 5vw, 48px);
    height: auto;
  }
}
.plane-1 {
  top: 18%;
  animation-duration: 18s;
  animation-delay: -4s;
  /* transform: rotate(-20deg); */
}
.plane-2 {
  top: 66%;
  animation-duration: 24s;
  animation-delay: -11s;
  /* transform: rotate(-10deg); */
}
@keyframes drift {
  from {
    left: -10%;
  }
  to {
    left: 110%;
  }
}

/* ─── logo ───────────────────────────────────────────────────────────────── */
.logo {
  position: relative;
  z-index: 1;

  margin-bottom: clamp(44px, 8vh, 72px);
}

.logo-icon {
  font-size: clamp(44px, 9vw, 72px);
  line-height: 1;
  margin-bottom: clamp(8px, 1.5vw, 16px);
  /* gentle hover bob */
  animation: bob 3s ease-in-out infinite;

  & img {
    max-width: 70px;
    height: auto;
  }
}
@keyframes bob {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-8px);
  }
}

.logo h1 {
  font-size: clamp(48px, 11vw, 80px);
  font-weight: 900;
  letter-spacing: -2px;
  margin: 0;
  line-height: 1;
  text-shadow: 0 4px 0 rgba(0, 0, 0, 0.12);
}

.tagline {
  font-size: clamp(14px, 2.4vw, 18px);
  margin-top: clamp(6px, 1vw, 10px);
  color: rgba(255, 255, 255, 0.72);
  letter-spacing: 0.06em;
}

.interact-block {
  width: 100%;
  min-height: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* ─── loading bar ────────────────────────────────────────────────────────── */
.loading {
  position: relative;
  z-index: 1;

  width: clamp(240px, 60vw, 360px);
  text-align: left;
}

.loading-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.55);
  margin-bottom: 8px;
}

.progress-bar {
  width: 100%;
  height: 8px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 4px;
  overflow: hidden;
  position: relative;
}

.progress-fill {
  height: 100%;
  border-radius: 4px;
  background: linear-gradient(90deg, #667eea, #a78bfa);
  transition: width 0.3s ease;
  position: relative;
  min-width: 8px;
}

/* bright leading-edge shimmer — same as LoadingBar.vue */
.progress-glow {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 24px;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.55));
  border-radius: 0 4px 4px 0;
}

.loading-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 7px;
}

.loading-step {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
  font-weight: 500;
}

.loading-pct {
  font-size: 13px;
  font-weight: 800;
  color: white;
  letter-spacing: 0.02em;
}

/* ─── start button ───────────────────────────────────────────────────────── */
.start-section {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 15px;
}

.start-button {
  padding: clamp(14px, 2vw, 20px) clamp(48px, 10vw, 80px);
  font-size: clamp(18px, 2.2vw, 24px);
  font-weight: 800;
  color: #3d5ae0;
  background: white;
  border: none;
  border-radius: 50px;
  cursor: pointer;
  /* raised pill shadow — matches Go Pro button language */
  box-shadow: 0 6px 0 rgba(0, 0, 0, 0.12), 0 10px 32px rgba(0, 0, 0, 0.16);
  transition: transform 0.15s, box-shadow 0.15s, opacity 0.2s;
  letter-spacing: 0.02em;
}

.start-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

@media (hover: hover) {
  .start-button:not(:disabled):hover {
    transform: translateY(-3px);
    box-shadow: 0 9px 0 rgba(0, 0, 0, 0.1), 0 14px 36px rgba(0, 0, 0, 0.2);
  }
}

.start-button:not(:disabled):active {
  transform: translateY(3px);
  box-shadow: 0 3px 0 rgba(0, 0, 0, 0.12), 0 4px 16px rgba(0, 0, 0, 0.12);
}

/* ─── quit button ────────────────────────────────────────────────────────── */
.quit-btn {
  position: absolute;
  bottom: max(24px, env(safe-area-inset-bottom, 24px));
  left: 24px;
  width: clamp(36px, 4vw, 44px);
  height: clamp(36px, 4vw, 44px);
  border-radius: 50%;
  border: 1.5px solid rgba(255, 255, 255, 0.35);
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(10px);
  color: rgba(255, 255, 255, 0.75);
  font-size: clamp(13px, 1.4vw, 16px);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s, color 0.2s;
  z-index: 10;
}
.quit-btn:hover {
  background: rgba(255, 255, 255, 0.28);
  color: white;
}

/* ─── version label ──────────────────────────────────────────────────────── */
.version {
  position: absolute;
  bottom: max(24px, env(safe-area-inset-bottom, 24px));
  right: 24px;
  opacity: 0.4;
  font-size: clamp(11px, 1vw, 13px);
  z-index: 10;
}

/* ─── ATT pre-prompt ─────────────────────────────────────────────────────── */
.att-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 1000;
  padding-bottom: max(24px, env(safe-area-inset-bottom, 24px));
}

.att-modal {
  width: min(400px, 92vw);
  background: rgba(20, 28, 52, 0.97);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 24px;
  padding: clamp(20px, 3vw, 32px) clamp(18px, 2.5vw, 28px) clamp(16px, 2.5vw, 24px);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  text-align: center;
}

.att-icon {
  font-size: 38px;
}

.att-title {
  font-size: clamp(17px, 2vw, 20px);
  font-weight: 800;
  color: white;
  margin: 0;
}

.att-body {
  font-size: clamp(13px, 1.3vw, 15px);
  color: rgba(255, 255, 255, 0.82);
  line-height: 1.55;
  margin: 0;
}

.att-note {
  font-size: clamp(11px, 1vw, 12px);
  color: rgba(255, 255, 255, 0.45);
  line-height: 1.4;
  margin: 0;
}

.att-confirm {
  width: 100%;
  padding: clamp(11px, 1.4vw, 15px);
  border-radius: 14px;
  border: none;
  background: #3d5ae0;
  color: white;
  font-size: clamp(14px, 1.3vw, 16px);
  font-weight: 700;
  cursor: pointer;
  margin-top: 4px;
  box-shadow: 0 3px 0 #2040b0;
  transition: opacity 0.2s, transform 0.12s;
}
.att-confirm:hover {
  opacity: 0.88;
}
.att-confirm:active {
  transform: translateY(2px);
  box-shadow: 0 1px 0 #2040b0;
}

.att-skip {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.45);
  font-size: clamp(12px, 1.1vw, 14px);
  cursor: pointer;
  padding: 6px;
  transition: color 0.2s;
}
.att-skip:hover {
  color: rgba(255, 255, 255, 0.75);
}
</style>
