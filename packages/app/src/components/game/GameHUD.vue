<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useGameStore } from '@/stores/game';
import { gameEventBus } from '@/services/EventBus';

const gameStore = useGameStore();

const emit = defineEmits<{
  pause: [];
  resume: [];
}>();

// ── Live stats from game bus ──────────────────────────────────────────────────
// GameHUD subscribes directly to stats:update so it stays current without
// threading props through GameView → AirTrafficCanvas.
// ⚠️  DO NOT remove the onMounted/onUnmounted listeners — without them the
//     counters stay at 0 for the whole session.
const landed = ref(0);
const enroute = ref(0);
const missed = ref(0);

/** total = landed + enroute − missed  (per design spec) */
const total = computed(() => landed.value + enroute.value - missed.value);

/** True while the speed-control popup is open — hides the pause button. */
const popupOpen = ref(false);

/** Hidden until loader finishes (loader:done event).
 *  This prevents the HUD from overlaying the boot loading screen. */
const sceneReady = ref(false);

const pauseIcon = computed(() => (gameStore.isPaused ? '▶' : '⏸'));

const handlePauseResume = () => {
  if (gameStore.isPaused) emit('resume');
  else if (gameStore.isPlaying) emit('pause');
};

// ── Bus handlers ──────────────────────────────────────────────────────────────

function onStatsUpdate(stats: {
  planesLanded?: number;
  waypointPasses?: number;
  planesMissed?: number;
}) {
  if (stats.planesLanded !== undefined) landed.value = stats.planesLanded;
  if (stats.waypointPasses !== undefined) enroute.value = stats.waypointPasses;
  if (stats.planesMissed !== undefined) missed.value = stats.planesMissed;
}

const onPopupOpened = () => {
  popupOpen.value = true;
};
const onPopupClosed = () => {
  popupOpen.value = false;
};
const onLoaderDone = () => {
  sceneReady.value = true;
};
const onSceneHidden = () => {
  sceneReady.value = false;
};
const onRestartReset = () => {
  landed.value = enroute.value = missed.value = 0;
};

onMounted(() => {
  gameEventBus.on('stats:update', onStatsUpdate);
  gameEventBus.on('popup:opened', onPopupOpened);
  gameEventBus.on('popup:closed', onPopupClosed);
  // Show HUD only after loader finishes (not just scene-ready)
  gameEventBus.on('loader:done', onLoaderDone);
  // On restart the scene is torn down and re-booted: hide HUD and reset counters.
  gameEventBus.on('game:restart', onSceneHidden);
  gameEventBus.on('game:restart', onRestartReset);
});

onUnmounted(() => {
  gameEventBus.off('stats:update', onStatsUpdate);
  gameEventBus.off('popup:opened', onPopupOpened);
  gameEventBus.off('popup:closed', onPopupClosed);
  gameEventBus.off('loader:done', onLoaderDone);
  gameEventBus.off('game:restart', onSceneHidden);
  gameEventBus.off('game:restart', onRestartReset);
});
</script>

<template>
  <!-- Only rendered after LoaderV2 finishes fading out (loader:done event).
       This prevents the stats card and pause button from overlaying the
       BootScene loading screen. -->
  <div v-if="sceneReady" class="game-hud">
    <!-- ── Top-left: plane traffic indicator ─────────────────────────────── -->
    <div class="hud-stats">
      <div class="stat-item">
        <span class="stat-num">{{ landed }}</span>
        <span class="stat-lbl">LAND</span>
      </div>

      <div class="stat-sep" aria-hidden="true" />

      <div class="stat-item">
        <span class="stat-num">{{ enroute }}</span>
        <span class="stat-lbl">ROUTE</span>
      </div>

      <div class="stat-sep" aria-hidden="true" />

      <div class="stat-item stat-miss">
        <span class="stat-num">{{ missed }}</span>
        <span class="stat-lbl">MISS</span>
      </div>

      <div class="stat-sep" aria-hidden="true" />

      <div class="stat-item stat-total">
        <span class="stat-num total">{{ total }}</span>
        <span class="stat-lbl">TOTAL</span>
      </div>
    </div>

    <!-- ── Top-right: pause button ───────────────────────────────────────── -->
    <button
      class="pause-btn"
      :class="{ 'pause-btn--hidden': popupOpen }"
      :aria-label="gameStore.isPaused ? 'Resume game' : 'Pause game'"
      @click="handlePauseResume"
    >
      {{ pauseIcon }}
    </button>
  </div>
</template>

<style scoped>
/* ── HUD shell ────────────────────────────────────────────────────────────── */
.game-hud {
  position: absolute;
  inset: 0;
  pointer-events: none;
  /* Below all popups (SpeedControlPopup z-index: 900, collision overlay higher) */
  z-index: 100;
}

/* ── Top-left stats card ──────────────────────────────────────────────────── */
.hud-stats {
  position: absolute;
  top: 4px;
  left: 4px;
  display: flex;
  align-items: center;
  gap: 0;
  background: rgba(0, 0, 0, 0.22);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 8px;
  padding: 6px 4px 4px;
  pointer-events: none;
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 0 2px;
  min-width: 40px;
}

.stat-sep {
  width: 1px;
  height: 28px;
  background: rgba(255, 255, 255, 0.18);
  flex-shrink: 0;
}

.stat-svg {
  width: 16px;
  height: 16px;
  color: rgba(255, 255, 255, 0.75);
  flex-shrink: 0;
}

.stat-num {
  font-size: 24px;
  font-weight: 700;
  color: #fff;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  font-family: -apple-system, 'SF Pro Display', BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

.stat-lbl {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.5);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  text-align: center;
  font-family: -apple-system, 'SF Pro Text', BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

/* Missed column: red tint */
.stat-miss .stat-svg {
  color: #ff6b6b;
}
.stat-miss .stat-num {
  color: #ff8a8a;
}

/* Total column: brighter */
.total {
  color: #ffe066;
}
.stat-total .stat-lbl {
  color: rgba(255, 224, 102, 0.7);
}

/* ── Top-right pause button ───────────────────────────────────────────────── */
.pause-btn {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 60px;
  height: 60px;
  border-radius: 16px;
  background: #3d5ae0;
  border: none;
  color: #fff;
  font-size: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  pointer-events: auto;
  box-shadow: 0 4px 16px rgba(61, 90, 224, 0.5);
  transition: opacity 0.2s, visibility 0.2s, transform 0.12s, background 0.12s;
  user-select: none;

  /* /////==== */
  /* position: absolute;
  top: 4px;
  right: 4px;
  display: flex;
  align-items: center;
  gap: 0; */
  background: rgba(0, 0, 0, 0.22);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 8px;
  padding: 6px 4px 4px;
  /* pointer-events: none; */
}

.pause-btn:hover {
  background: #4f6ef7;
}
.pause-btn:active {
  transform: scale(0.93);
}

/* Hide pause button when speed-control popup is open */
.pause-btn--hidden {
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
}

/* ── Responsive ───────────────────────────────────────────────────────────── */
@media (max-width: 480px) {
  .hud-stats {
    padding: 6px 10px;
    border-radius: 12px;
  }
  .stat-item {
    padding: 0 7px;
  }
  .stat-num {
    font-size: 15px;
  }
  .total-num {
    font-size: 17px;
  }
  .stat-lbl {
    font-size: 7px;
  }
  .pause-btn {
    width: 50px;
    height: 50px;
    font-size: 20px;
    border-radius: 14px;
  }
}

@media (max-height: 442px) {
  .hud-stats {
    padding: 2px 4px;
    border-radius: 6px;
  }
  .stat-item {
    padding: 0 2px;
    min-width: 30px;
  }
  .stat-num {
    font-size: 16px;
  }
  .total-num {
    font-size: 17px;
  }
  .stat-lbl {
    font-size: 6px;
  }
  .pause-btn {
    width: 50px;
    height: 50px;
    font-size: 20px;
    border-radius: 14px;
  }
}
</style>
