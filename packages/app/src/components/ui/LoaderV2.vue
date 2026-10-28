<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from 'vue';
import { useDevice } from '@/composables/useDevice';

// Import images so Vite bundles them and they're available instantly
import titleImg from '../../assets/page-bg/game-title.png';
import statusImg from '../../assets/page-bg/status.png';
import statusPortraitImg from '../../assets/page-bg/status-portrait.png';
import statusState1 from '../../assets/page-bg/status-state-1.png';
import statusState2 from '../../assets/page-bg/status-state-2.png';

const props = defineProps<{
  progress: number; // 0–100
  sceneReady: boolean;
}>();

const emit = defineEmits<{
  loaderDone: [];
}>();

const { isPortrait } = useDevice();

// ── Animated progress counter ──────────────────────────────────────────────
// The raw `progress` prop can jump (e.g. 50 → 75). We animate the displayed
// value in steps of 5 so the counter visibly grows: 55 → 60 → 65 → 70 → 75.
const ANIMATION_STEP = 5;
const ANIMATION_INTERVAL = 100; // ms per step

const displayedProgress = ref(0);
let animTimer: number | null = null;

// Track when animation hit 100% so we can show it for 200ms before fading
let hit100At: number | null = null;
let holdTimer: number | null = null;
const isHoldComplete = ref(false);

function animateTo(target: number): void {
  if (animTimer !== null) {
    clearInterval(animTimer);
    animTimer = null;
  }
  // Already at or past target (e.g. progress decreased) — snap directly.
  if (displayedProgress.value >= target) {
    displayedProgress.value = target;
    return;
  }
  animTimer = window.setInterval(() => {
    if (displayedProgress.value + ANIMATION_STEP >= target) {
      displayedProgress.value = target;
      if (animTimer !== null) clearInterval(animTimer);
      animTimer = null;
      // Record when we hit 100% and start 200ms hold
      if (target >= 100 && hit100At === null) {
        hit100At = performance.now();
        console.log(`💯 [${hit100At.toFixed(2)}ms] LoaderV2: HIT 100%`);
        isHoldComplete.value = false;
        if (holdTimer !== null) clearTimeout(holdTimer);
        holdTimer = window.setTimeout(() => {
          isHoldComplete.value = true;
          console.log(`✅ [${performance.now().toFixed(2)}ms] LoaderV2: 200ms hold complete`);
        }, 200);
      }
    } else {
      displayedProgress.value += ANIMATION_STEP;
    }
  }, ANIMATION_INTERVAL);
}

watch(
  () => props.progress,
  (newVal) => animateTo(Math.round(newVal)),
  { immediate: true }
);

onUnmounted(() => {
  if (animTimer !== null) {
    clearInterval(animTimer);
    animTimer = null;
  }
  if (holdTimer !== null) {
    clearTimeout(holdTimer);
    holdTimer = null;
  }
});

// progressVal is the *animated* value shown in the UI.
const progressVal = computed(() => Math.round(displayedProgress.value));

// Loader stays visible until the parent reports the scene is ready AND the
// animated counter has finished climbing to 100 AND we've shown 100% for 200ms.
const isDone = computed(() => {
  if (!props.sceneReady || displayedProgress.value < 100) return false;
  return isHoldComplete.value;
});

// Log when sceneReady is received
watch(
  () => props.sceneReady,
  (val) => {
    if (val) {
      const readyTime = performance.now();
      console.log(
        `📥 [${readyTime.toFixed(2)}ms] LoaderV2: RECEIVED sceneReady=true (displayedProgress=${
          displayedProgress.value
        }, hit100At=${hit100At})`
      );
    }
  }
);

// Log when loader actually finishes fade-out and emit event
watch(isDone, (val) => {
  if (val) {
    const doneTime = performance.now();
    console.log(`🏁 [${doneTime.toFixed(2)}ms] LoaderV2: FADE OUT COMPLETE (isDone=true)`);
    emit('loaderDone');
  }
});
</script>

<template>
  <Transition name="fade">
    <div v-if="!isDone" class="loading">
      <div class="game-title" :class="{ 'portrait-title': isPortrait }">
        <img :src="titleImg" alt="title" />
      </div>
      <div class="loading-status status-img" :class="{ 'status-portrait': isPortrait }">
        <img :src="isPortrait ? statusPortraitImg : statusImg" alt="status" />

        <p class="loading-progress">{{ progressVal }}%</p>
        <div v-if="progressVal > 25" class="status-item status-1">
          <img :src="statusState1" alt="check 1" />
        </div>
        <div v-if="progressVal > 50" class="status-item status-2">
          <img :src="statusState1" alt="check 2" />
        </div>
        <div v-if="progressVal > 75" class="status-item status-3">
          <img :src="statusState2" alt="check 3" />
        </div>
        <div v-if="progressVal > 92" class="status-item status-4">
          <img :src="statusState1" alt="check 4" />
        </div>
      </div>
    </div>
  </Transition>
</template>

<style lang="less" scoped>
.loading {
  position: fixed;
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

.game-title {
  position: relative;
  width: 80vw;
  height: 9vw;

  &.portrait-title {
    height: 14vw;
  }

  & img {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    width: 100%;
    object-fit: contain;
  }
}

.loading-status {
  position: relative;
  width: 80vw;
  height: 26vw;

  container-type: inline-size;

  &.status-portrait {
    height: 120vw;

    & .loading-progress {
      top: 15.5%;
      right: 30%;
      font-size: 7cqw;
      transform: rotate(0deg);
    }

    & .status-1 {
      top: 26%;
      right: 21%;
      width: 5%;
      height: 9%;
      max-width: 5%;
    }
    & .status-2 {
      top: 38%;
      right: 23.5%;
      width: 5%;
      height: 9%;
      max-width: 5%;
    }
    & .status-3 {
      top: 49.6%;
      right: 45%;
      width: 5%;
      height: 9%;
      max-width: 5%;
    }
    & .status-4 {
      top: 60.2%;
      right: 49%;
      width: 5%;
      height: 9%;
      max-width: 5%;
    }
  }
}
.status-img {
  & img {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    width: 100%;
    object-fit: contain;
  }
}

.loading-progress {
  position: absolute;
  top: 16%;
  right: 22%;
  color: #412a1e;
  font-size: 4cqw;
  font-weight: 600;
  transform: rotate(-2deg);
  transition: all 0.3s ease;
}

.status-item {
  position: absolute;
  transition: all 0.2s linear;

  & img {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
}
.status-1 {
  top: 37%;
  right: 34%;
  width: 4%;
  height: 9%;
  max-width: 4%;
}
.status-2 {
  top: 48%;
  right: 25.5%;
  width: 4%;
  height: 9%;
  max-width: 4%;
}
.status-3 {
  top: 60.2%;
  right: 31.8%;
  width: 4%;
  height: 9%;
  max-width: 4%;
}
.status-4 {
  top: 72%;
  right: 42%;
  width: 4%;
  height: 9%;
  max-width: 4%;
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
