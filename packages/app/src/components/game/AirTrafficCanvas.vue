<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { Capacitor } from '@capacitor/core';
import { useRouter } from 'vue-router';
import { useGame } from '@/composables/useGame';
import { useNetwork } from '@/composables/useNetwork';
import { useGameStore } from '@/stores/game';
import { gameEventBus } from '@/services/EventBus';
import SpeedControlPopup from '@/components/game/SpeedControlPopup.vue';
import type { PopupPlaneData } from '@/components/game/SpeedControlPopup.vue';
import LoaderV2 from '../ui/LoaderV2.vue';

const gameContainerRef = ref<HTMLDivElement | null>(null);
const gameStore = useGameStore();
const router = useRouter();

const showCollisionOverlay = ref(false);

// ── Boot loading state ────────────────────────────────────────────────────────
// Tracks BootScene asset loading. Shown as a Vue overlay so BootScene doesn't
// need to render any Phaser canvas UI (which would conflict with this overlay).
// Disappears when GameScene emits 'game:scene-ready'.
const bootProgress = ref(0);
const bootStep = ref('Loading…');
const sceneReady = ref(false); // true after GameScene.create() completes

// ─── Speed control popup state ────────────────────────────────────────────────
const speedPopupPlane = ref<PopupPlaneData | null>(null);
const speedPopupVisible = ref(false);

const {
  isOnline,
  secondsUntilNextCheck,
  retryNow,
} = useNetwork();

const {
  isReady,
  activePlanes,
  conflicts,
  landedCount,
  waypointPassCount,
  pauseGame,
  resumeGame,
  restartGame,
  hardRestart,
  toggleDebug,
} = useGame(gameContainerRef);

const isDevMode = computed(() => import.meta.env.DEV);

let playTimeInterval: number | null = null;

// ─── Boot progress listeners (register in setup so they're ready before Phaser starts) ────────
function onAssetsProgress({ pct, step }: { pct: number; step: string }) {
  bootProgress.value = pct;
  bootStep.value = step;
}
function onSceneReady() {
  const readyTime = performance.now();
  console.log(`📥 [${readyTime.toFixed(2)}ms] AirTrafficCanvas: RECEIVED game:scene-ready`);
  bootProgress.value = 100;
  sceneReady.value = true;
}
function onLoaderDone() {
  const doneTime = performance.now();
  console.log(`🏁 [${doneTime.toFixed(2)}ms] AirTrafficCanvas: LOADER DONE — emitting loader:done`);
  gameEventBus.emit('loader:done');
}
gameEventBus.on('assets:progress', onAssetsProgress);
gameEventBus.on('game:scene-ready', onSceneReady);

// ─── iOS AudioContext unlock ──────────────────────────────────────────────────
// iOS suspends the WebAudio context until a direct user gesture. The ATT
// prompt on "Start Game" consumes that gesture before Phaser can unlock audio,
// leaving the game silent. We resume the context on the very first touch.
let _audioUnlocked = false;
function unlockAudioContext(): void {
  if (_audioUnlocked) return;
  _audioUnlocked = true;
  try {
    // Phaser stores the AudioContext on game.sound.context.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const phaserGame = (window as any).__PHASER_GAME__ as
      | { sound?: { context?: AudioContext } }
      | undefined;
    const ctx = phaserGame?.sound?.context;
    if (ctx?.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
  } catch {
    // Sound manager not available yet — no-op
  }
}

// ─── Two-finger swipe to pause ────────────────────────────────────────────────
// Two simultaneous fingers moving > SWIPE_THRESHOLD px within SWIPE_TIMEOUT ms
// toggles pause. This is the standard iOS landscape game pause gesture.
const SWIPE_THRESHOLD = 40; // px minimum travel
const SWIPE_TIMEOUT = 400; // ms gesture window

interface TouchStart {
  x: number;
  y: number;
  t: number;
}
let _twoFingerStart: [TouchStart, TouchStart] | null = null;

function onTwoFingerTouchStart(e: TouchEvent): void {
  unlockAudioContext();
  if (e.touches.length === 2) {
    const t = Date.now();
    _twoFingerStart = [
      { x: e.touches[0].clientX, y: e.touches[0].clientY, t },
      { x: e.touches[1].clientX, y: e.touches[1].clientY, t },
    ];
  } else {
    _twoFingerStart = null;
  }
}

function onTwoFingerTouchEnd(e: TouchEvent): void {
  if (!_twoFingerStart) return;
  if (Date.now() - _twoFingerStart[0].t > SWIPE_TIMEOUT) {
    _twoFingerStart = null;
    return;
  }

  // Both fingers must have moved at least SWIPE_THRESHOLD px
  const changed = Array.from(e.changedTouches);
  let movedCount = 0;
  for (let i = 0; i < 2; i++) {
    const touch = changed[i] ?? e.touches[i];
    if (!touch) continue;
    const s = _twoFingerStart[i];
    if (!s) continue;
    const dx = touch.clientX - s.x;
    const dy = touch.clientY - s.y;
    if (Math.sqrt(dx * dx + dy * dy) >= SWIPE_THRESHOLD) movedCount++;
  }

  _twoFingerStart = null;

  if (movedCount >= 2) {
    if (gameStore.isPaused) {
      resumeGame();
    } else if (gameStore.isPlaying) {
      pauseGame();
    }
  }
}

// ─── Speed popup handlers ─────────────────────────────────────────────────────

/** Phaser tap → open popup for this plane. */
const handlePlaneTapped = (data: PopupPlaneData) => {
  speedPopupPlane.value = data;
  speedPopupVisible.value = true;
  gameEventBus.emit('popup:opened');
};

/**
 * Close the popup and null the plane ref — used for all forced-close paths
 * (offscreen, pause, level end, collision). Emits popup:closed so GameHUD
 * can restore the play-pause button.
 */
const forceClosePopup = () => {
  if (!speedPopupVisible.value) return;
  speedPopupVisible.value = false;
  speedPopupPlane.value = null;
  gameEventBus.emit('popup:closed');
};

/** Second tap on same plane OR close-btn → close popup. */
const handleTapDeselect = () => {
  speedPopupVisible.value = false;
  speedPopupPlane.value = null;
  gameEventBus.emit('popup:closed');
};

const handleCancelApproach = (planeId: number) => {
  gameEventBus.emit('plane:cancelApproach', { planeId });
};

/**
 * Fired by GameScene (Phaser 'pause' event) for every pause source:
 * manual pause, level complete, and any future sources.
 */
const handlePopupClose = () => forceClosePopup();

/**
 * Fired when any plane leaves the visible scene (landed, waypoint-passed,
 * or plain offscreen). Close the popup only if it belongs to that plane.
 */
const handlePlaneOffscreen = ({ planeId }: { planeId: number }) => {
  if (speedPopupPlane.value?.id === planeId) forceClosePopup();
};

const handleLevelFailed = () => {
  gameStore.levelFailed();
  showCollisionOverlay.value = true;
  // Collision does NOT pause the scene (animation keeps running), so the
  // Phaser 'pause' handler won't fire — close the popup explicitly here.
  forceClosePopup();
};

const handleTryAgain = () => {
  showCollisionOverlay.value = false;
  gameStore.startGame();
  // Emit game:restart so GameHUD hides during the new loading screen
  gameEventBus.emit('game:restart');
  // Hard restart: destroy the Phaser instance entirely and boot fresh.
  // This is identical to a page reload — no stale scene state, no collision
  // re-detection races, no lingering circles.  gameStore.currentLevel already
  // holds the failed level number so BootScene will boot into the same level.
  hardRestart();
};

const handleGoToMenu = () => {
  showCollisionOverlay.value = false;
  gameStore.reset();
  router.push({ name: 'Airfields' });
};

onMounted(async () => {
  // Lock to landscape during gameplay — unlocked when this component unmounts
  if (Capacitor.isNativePlatform()) {
    try {
      const { ScreenOrientation } = await import('@capacitor/screen-orientation');
      await ScreenOrientation.lock({ orientation: 'landscape' });
    } catch (e) {
      console.warn('ScreenOrientation lock failed (non-fatal):', e);
    }
  }

  playTimeInterval = window.setInterval(() => {
    gameStore.incrementPlayTime();
  }, 1000);

  gameStore.loadHighScore();
  gameEventBus.on('level:failed', handleLevelFailed);
  gameEventBus.on('plane:tapped', handlePlaneTapped);
  gameEventBus.on('plane:tap-deselect', handleTapDeselect);
  gameEventBus.on('popup:close', handlePopupClose);
  gameEventBus.on('plane:offscreen', handlePlaneOffscreen);

  // Attach two-finger swipe + audio unlock listeners to the game container.
  // { passive: true } — we never call preventDefault here so no jank.
  const el = gameContainerRef.value;
  if (el) {
    el.addEventListener('touchstart', onTwoFingerTouchStart, { passive: true });
    el.addEventListener('touchend', onTwoFingerTouchEnd, { passive: true });
  }
});

onUnmounted(async () => {
  // Unlock orientation so menus can use portrait again
  if (Capacitor.isNativePlatform()) {
    try {
      const { ScreenOrientation } = await import('@capacitor/screen-orientation');
      await ScreenOrientation.unlock();
    } catch (e) {
      console.warn('ScreenOrientation unlock failed (non-fatal):', e);
    }
  }

  if (playTimeInterval !== null) {
    clearInterval(playTimeInterval);
    playTimeInterval = null;
  }
  gameEventBus.off('level:failed', handleLevelFailed);
  gameEventBus.off('plane:tapped', handlePlaneTapped);
  gameEventBus.off('plane:tap-deselect', handleTapDeselect);
  gameEventBus.off('popup:close', handlePopupClose);
  gameEventBus.off('plane:offscreen', handlePlaneOffscreen);
  gameEventBus.off('assets:progress', onAssetsProgress);
  gameEventBus.off('game:scene-ready', onSceneReady);

  // Clean up two-finger swipe listeners
  const el = gameContainerRef.value;
  if (el) {
    el.removeEventListener('touchstart', onTwoFingerTouchStart);
    el.removeEventListener('touchend', onTwoFingerTouchEnd);
  }
  _audioUnlocked = false;
  _twoFingerStart = null;
});

defineExpose({ pauseGame, resumeGame, restartGame, toggleDebug });
</script>

<template>
  <div class="air-traffic-canvas">
    <Transition name="offline-fade">
      <div v-if="!isOnline" class="offline-banner" role="alert" aria-live="polite">
        <div class="offline-icon">📡</div>
        <div class="offline-title">No connection</div>
        <div class="offline-sub">Backgrounds download over the network.<br />Gameplay is paused until you're back online.</div>
        <div class="offline-count">Retrying in {{ secondsUntilNextCheck }}s</div>
        <button class="retry-btn" @click="retryNow">Retry Now</button>
      </div>
    </Transition>

    <div id="game-container" ref="gameContainerRef" class="game-container" :style="{ pointerEvents: isOnline ? 'auto' : 'none' }"></div>

    <!-- Boot loading overlay — visible while BootScene loads assets.
         Driven by real 'assets:progress' events from BootScene (not a timer).
         Fades out when GameScene emits 'game:scene-ready'.
         ⚠️  Do not remove: without this the Phaser canvas is black during boot
             and the GameHUD appears on top of the loading screen. -->
    <!-- <LoaderLegacy :progress="bootProgress" :step="bootStep" :scene-ready="sceneReady" /> -->
    <!-- <Loader :progress="bootProgress" :step="bootStep" :scene-ready="!sceneReady" /> -->
    <LoaderV2 :progress="bootProgress" :scene-ready="sceneReady" @loader-done="onLoaderDone" />

    <!-- Collision overlay -->
    <Transition name="fade">
      <div v-if="showCollisionOverlay" class="collision-overlay">
        <div class="collision-card">
          <div class="collision-icon">💥</div>
          <h2 class="collision-title">COLLISION</h2>
          <p class="collision-sub">Two aircraft have collided.<br />All traffic in sector lost.</p>
          <button class="try-again-btn" @click="handleTryAgain">Try Again</button>
          <button class="menu-btn" @click="handleGoToMenu">Go to Main Menu</button>
        </div>
      </div>
    </Transition>

    <!-- Speed control popup — bottom-left corner, above game canvas -->
    <SpeedControlPopup
      :plane="speedPopupPlane"
      :visible="speedPopupVisible"
      @close="handleTapDeselect"
      @cancel-approach="handleCancelApproach"
    />
  </div>
</template>

<style lang="scss">
/* ✅ HIGH QUALITY CANVAS RENDERING */
.air-traffic-canvas {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background-color: #000000;
}

.game-container {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}

/* ✅ CRITICAL: Force high-quality rendering for Phaser canvas */
.game-container canvas {
  /* ✅ FULLSCREEN CANVAS - scale down from high-res */
  position: absolute !important;
  top: 0 !important;
  left: 0 !important;

  /* High-quality rendering */
  image-rendering: auto;
  image-rendering: -moz-crisp-edges;
  image-rendering: -webkit-optimize-contrast;

  /* GPU acceleration */
  transform: translateZ(0);
  -webkit-transform: translateZ(0);
  will-change: transform;
  -webkit-backface-visibility: hidden;
  backface-visibility: hidden;
  -webkit-font-smoothing: subpixel-antialiased;

  /* Ensure no margins/padding */
  margin: 0 !important;
  padding: 0 !important;
  display: block !important;

  /* Phaser owns cover-scaling internally via worldContainer.getWorldScale().
     Do NOT set object-fit on the canvas — it conflicts with Phaser's render. */
}


  /* Offline banner — covers the canvas and blocks all gameplay input.
     z-index 10000 beats the LoaderV2 boot overlay (9999) so an offline
     boot shows "No connection", not a spinning loader. */
  .offline-banner {
    position: absolute;
    inset: 0;
    z-index: 10000;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    background: radial-gradient(ellipse at center, rgba(20, 10, 10, 0.96) 0%, rgba(0, 0, 0, 0.96) 100%);
    color: #fff;
    text-align: center;
    padding: 24px;
    pointer-events: auto;
  }
  .offline-icon {
    font-size: clamp(48px, 12vw, 96px);
    line-height: 1;
    filter: grayscale(0.4);
  }
  .offline-title {
    font-size: clamp(22px, 5vw, 36px);
    font-weight: 900;
    letter-spacing: 0.04em;
    color: #ff7a6b;
  }
  .offline-sub {
    font-size: clamp(13px, 2.5vw, 17px);
    color: rgba(255, 255, 255, 0.65);
    max-width: 80%;
    line-height: 1.5;
  }
  .offline-count {
    font-size: clamp(16px, 3.5vw, 22px);
    font-weight: 700;
    font-family: 'Courier New', monospace;
    color: #ffd24a;
    letter-spacing: 0.12em;
  }
  .retry-btn {
    margin-top: 6px;
    padding: 14px 36px;
    background: linear-gradient(135deg, #ff7a6b 0%, #ff4444 100%);
    color: #fff;
    border: none;
    border-radius: 14px;
    font-size: 17px;
    font-weight: 700;
    cursor: pointer;
    box-shadow: 0 6px 24px rgba(255, 68, 68, 0.35);
    transition: transform 0.15s ease;
  }
  .retry-btn:active { transform: scale(0.96); }
  .offline-fade-enter-active,
  .offline-fade-leave-active { transition: opacity 0.3s ease; }
  .offline-fade-enter-from,
  .offline-fade-leave-to { opacity: 0; }

/* Boot loading overlay — covers Phaser canvas while BootScene loads */
.boot-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  background: linear-gradient(135deg, #a4d4e6 0%, #7ec0df 50%, #519bbd 100%);
  color: white;
  z-index: 9999;
  font-family: -apple-system, 'SF Pro Rounded', BlinkMacSystemFont, sans-serif;

  &.loader {
    color: #b0645c;
    background: linear-gradient(135deg, #faf6ee 0%, #f9efde 50%, #f4e8d2 100%);
  }
}

.boot-logo {
  font-size: clamp(44px, 8vw, 90px);
  line-height: 1;
  animation: bob 3s ease-in-out infinite;
}
.boot-title {
  font-size: clamp(36px, 7vw, 64px);
  font-weight: 900;
  letter-spacing: -1px;
  text-shadow: 0 4px 0 rgba(0, 0, 0, 0.12);
}
.loader-title {
  font-size: clamp(24px, 9vw, 90px);
  font-weight: 900;
  letter-spacing: -1px;
  text-shadow: 0 4px 0 rgba(0, 0, 0, 0.12);
  color: #519bbd;
}
.boot-bar {
  width: clamp(200px, 50vw, 320px);
}
.boot-radar {
  position: absolute;
  height: 90vmin;
  width: 90vmin;
  aspect-ratio: 1;
  z-index: -1;

  & img {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    max-width: 100%;
    object-fit: fill;
    z-index: 1;
  }
}

.radar-screen {
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  overflow: hidden;
}

/* Dark radar background with vignette */
.radar-bg {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: radial-gradient(
    ellipse at center,
    rgb(56 66 63) 0%,
    rgb(26, 41, 37) 50%,
    rgb(12, 40, 31) 80%,
    rgb(2, 33, 24) 100%
  );
  // background: radial-gradient(ellipse at center, #0d1f0d 0%, #061206 50%, #000800 80%, #000 100%);
  box-shadow: inset 0 0 60px rgba(0, 40, 0, 0.8), inset 0 0 100px rgba(0, 40, 0, 0.3),
    0 0 30px rgba(0, 40, 0, 0.1);
}

/* Concentric range rings */
.radar-range-ring {
  position: absolute;
  top: 50%;
  left: 50%;
  border-radius: 50%;
  border: 1px solid rgba(0, 255, 68, 0.18);
  transform: translate(-50%, -50%);
}

.radar-range-ring:nth-child(2) {
  width: 25%;
  height: 25%;
}
.radar-range-ring:nth-child(3) {
  width: 50%;
  height: 50%;
}
.radar-range-ring:nth-child(4) {
  width: 75%;
  height: 75%;
}
.radar-range-ring:nth-child(5) {
  width: 100%;
  height: 100%;
}

/* Radial spokes */
.radar-radials {
  position: absolute;
  inset: 0;
}

.radar-radials::before,
.radar-radials::after,
.radar-radials span {
  content: '';
  position: absolute;
  top: 50%;
  left: 100%;
  width: 100%;
  height: 1px;
  transform-origin: 0 50%;
  background: linear-gradient(90deg, transparent, rgba(0, 255, 68, 0.12), transparent);
  transform: translate(-50%, -50%) rotate(var(--angle));
}

.radar-radials::before {
  left: 50%;
  width: 200%;
  --angle: 0deg;
}
.radar-radials::after {
  top: -50%;
  width: 200%;
  transform: translate(-25%, -25%) rotate(90deg);
}
.radar-radials span:nth-child(1) {
  --angle: 45deg;
}
.radar-radials span:nth-child(2) {
  --angle: 135deg;
}
.radar-radials span:nth-child(3) {
  --angle: 225deg;
}
.radar-radials span:nth-child(4) {
  --angle: 315deg;
}

/* Scale marks around circumference */
.radar-scale {
  position: absolute;
  inset: 0;
}

.radar-scale span {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 1px;
  height: 10px;
  background: rgba(0, 255, 68, 0.35);
  transform-origin: 0 50%;
  transform: translate(-50%, -50%) rotate(calc(var(--i) * 15deg)) translateY(-48%);
}

.radar-scale span:nth-child(4n) {
  height: 16px;
  background: rgba(0, 255, 68, 0.55);
}

/* Sweep with trailing shadow */
.radar-sweep {
  position: absolute;
  top: 50%;
  left: 75%;
  width: 50%;
  height: 2px;
  transform-origin: 0 50%;
  transform: translate(-50%, -50%) rotate(0deg);
  animation: radar-sweep 4s linear infinite;
  pointer-events: none;
}

.sweep-line {
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, transparent 0%, #00ff44 30%, #00ffaa 80%, #ffffff00 100%);
  filter: drop-shadow(10px -12px 10px #00ff44) drop-shadow(0 -20px 12px #00ff44);
  border-radius: 1px;
}

.sweep-trail {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(0, 255, 68, 0.05) 20%,
    rgba(0, 255, 68, 0.15) 40%,
    rgba(0, 255, 68, 0.25) 60%,
    rgba(0, 255, 68, 0.15) 80%,
    transparent 100%
  );
  filter: blur(1px);
  opacity: 0.6;
  border-radius: 100px;
}

/* Center dot with pulse */
.radar-center {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #00ff44;
  box-shadow: 0 0 6px #00ff44, 0 0 12px #00ff88, 0 0 20px #00ff44;
  transform: translate(-50%, -50%);
  animation: radar-center-pulse 1.5s ease-in-out infinite;
  pointer-events: none;
}

@keyframes radar-sweep {
  0% {
    transform: translate(-50%, -50%) rotate(0deg);
  }
  100% {
    transform: translate(-50%, -50%) rotate(360deg);
  }
}

@keyframes radar-center-pulse {
  0%,
  100% {
    box-shadow: 0 0 6px #00ff44, 0 0 12px #00ff88, 0 0 20px #00ff44;
    transform: translate(-50%, -50%) scale(1);
  }
  50% {
    box-shadow: 0 0 12px #00ff44, 0 0 24px #00ff88, 0 0 36px #00ff44;
    transform: translate(-50%, -50%) scale(1.25);
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

/* Debug info */
.debug-info {
  position: absolute;
  top: 10px;
  left: 10px;
  background: rgba(0, 0, 0, 0.7);
  padding: 10px 15px;
  border-radius: 8px;
  font-family: 'Courier New', monospace;
  font-size: 12px;
  color: #00ff00;
  z-index: 10000;
  pointer-events: none;
  backdrop-filter: blur(5px);
}

.debug-item {
  display: flex;
  justify-content: space-between;
  gap: 15px;
  margin-bottom: 5px;
}

.debug-item:last-child {
  margin-bottom: 0;
}

.debug-label {
  opacity: 0.7;
}

.debug-value {
  font-weight: bold;
}

/* Responsive adjustments */
@media (max-width: 768px) {
  .loading-text {
    font-size: 20px;
  }

  .loading-subtext {
    font-size: 14px;
  }

  .debug-info {
    font-size: 10px;
    padding: 8px 12px;
  }
}

// landscape
@media (max-height: 400px) and (orientation: landscape) {
  .loader-title {
    font-size: clamp(24px, 6vw, 52px);
  }

  .boot-logo {
    font-size: clamp(34px, 6vw, 90px);
  }
}

/* Collision overlay */
.collision-overlay {
  position: absolute;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.72);
  backdrop-filter: blur(6px);
}

.collision-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 40px 48px;
  background: rgba(20, 20, 30, 0.95);
  border: 1.5px solid rgba(255, 80, 80, 0.5);
  border-radius: 24px;
  box-shadow: 0 0 60px rgba(255, 60, 60, 0.25);
  text-align: center;
}

.collision-icon {
  font-size: 56px;
  line-height: 1;
}

.collision-title {
  font-size: 28px;
  font-weight: 900;
  letter-spacing: 0.18em;
  color: #ff4444;
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif;
}

.collision-sub {
  font-size: 15px;
  color: rgba(255, 255, 255, 0.65);
  margin: 0;
  line-height: 1.6;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif;
}

.try-again-btn {
  margin-top: 8px;
  padding: 14px 40px;
  background: #ff4444;
  color: white;
  border: none;
  border-radius: 14px;
  font-size: 17px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif;
}

.try-again-btn:hover {
  background: #ff2222;
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(255, 60, 60, 0.45);
}

.try-again-btn:active {
  transform: translateY(0);
}

.menu-btn {
  padding: 12px 40px;
  background: transparent;
  color: rgba(255, 255, 255, 0.55);
  border: 1.5px solid rgba(255, 255, 255, 0.2);
  border-radius: 14px;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif;
}

.menu-btn:hover {
  color: white;
  border-color: rgba(255, 255, 255, 0.5);
  background: rgba(255, 255, 255, 0.08);
}

/* Fade transition */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
