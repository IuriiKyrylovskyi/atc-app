<script setup lang="ts">
import { useGameStore } from '@/stores/game';
import { useSettingsStore } from '@/stores/settings';

/**
 * PauseModal — white card on dark overlay.
 * Emits are unchanged: resume | restart | menu
 */
const gameStore = useGameStore();
// The game store has no lives any more (a collision ends the level), so the
// hearts row renders empty, exactly as in skymess.
const lives = 0;
const settings = useSettingsStore();

const emit = defineEmits<{
  resume: [];
  menu: [];
  restart: [];
}>();

const handleResume = () => emit('resume');

const handleRestart = () => {
  if (confirm('Are you sure you want to restart? Your current progress will be lost.')) {
    emit('restart');
  }
};

const handleMenu = () => {
  if (confirm('Are you sure you want to quit? Your current progress will be lost.')) {
    emit('menu');
  }
};
</script>

<template>
  <div class="pause-overlay" @click.self="handleResume">
    <div class="pause-card">
      <!-- Header -->
      <div class="pause-header">
        <div class="pause-header-left">
          <div class="pause-icon-wrap" aria-hidden="true">⏸</div>
          <h2 class="pause-title">Paused</h2>
        </div>
        <button class="pause-close-btn" aria-label="Resume" @click="handleResume">✕</button>
      </div>

      <!-- Stats grid -->
      <div class="pause-stats">
        <div class="stat-cell">
          <div class="stat-val" style="color: #f59e0b">{{ gameStore.score.toLocaleString() }}</div>
          <div class="stat-lbl">Score</div>
        </div>
        <div class="stat-cell">
          <div class="stat-val">{{ gameStore.planesLanded }}</div>
          <div class="stat-lbl">Landed</div>
        </div>
        <div class="stat-cell">
          <div class="stat-val">{{ gameStore.formattedPlayTime }}</div>
          <div class="stat-lbl">Time</div>
        </div>
        <div class="stat-cell">
          <!-- Render heart icons directly from lives count -->
          <div class="stat-val lives-row" :aria-label="`${lives} lives`">
            <span v-for="i in 3" :key="i" class="life-icon">
              {{ i <= lives ? '❤️' : '🖤' }}
            </span>
          </div>
          <div class="stat-lbl">Lives</div>
        </div>
      </div>

      <div class="divider" />

      <!-- Quick settings -->
      <div class="quick-settings">
        <p class="qs-label">Quick settings</p>

        <div class="qs-row">
          <span class="qs-name"><span aria-hidden="true">🔊</span> Volume</span>
          <input
            type="range"
            min="0"
            max="100"
            :value="Math.round(settings.audio.masterVolume * 100)"
            class="qs-slider"
            aria-label="Master volume"
            @input="
              settings.updateAudio({
                masterVolume: Number(($event.target as HTMLInputElement).value) / 100,
              })
            "
          />
          <span class="qs-val">{{ Math.round(settings.audio.masterVolume * 100) }}%</span>
        </div>

        <div class="qs-row">
          <span class="qs-name"><span aria-hidden="true">🎵</span> Music</span>
          <input
            type="range"
            min="0"
            max="100"
            :value="Math.round(settings.audio.musicVolume * 100)"
            class="qs-slider"
            aria-label="Music volume"
            @input="
              settings.updateAudio({
                musicVolume: Number(($event.target as HTMLInputElement).value) / 100,
              })
            "
          />
          <span class="qs-val">{{ Math.round(settings.audio.musicVolume * 100) }}%</span>
        </div>

        <div class="qs-row qs-row--toggle">
          <span class="qs-name"><span aria-hidden="true">🔕</span> Mute all</span>
          <button
            class="toggle-btn"
            :class="{ 'toggle-btn--on': settings.audio.muted }"
            role="switch"
            :aria-checked="settings.audio.muted"
            @click="settings.updateAudio({ muted: !settings.audio.muted })"
          >
            <span class="toggle-thumb" />
          </button>
        </div>
      </div>

      <div class="divider" />

      <!-- Action buttons -->
      <div class="pause-actions">
        <button class="action-btn action-btn--primary" @click="handleResume">▶ Resume Game</button>
        <button class="action-btn action-btn--secondary" @click="handleRestart">
          ↺ Restart Level
        </button>
        <button class="action-btn action-btn--ghost" @click="handleMenu">🏠 Main Menu</button>
      </div>

      <p class="pause-hint">Click outside or press ESC to resume</p>
    </div>
  </div>
</template>

<style scoped>
/* ─── overlay ────────────────────────────────────────────────────────────── */
.pause-overlay {
  position: fixed;
  inset: 0;
  background: rgba(10, 18, 40, 0.88);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
  padding: 16px;
  animation: fadeIn 0.25s ease;
}
@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

/* ─── card ───────────────────────────────────────────────────────────────── */
.pause-card {
  background: #ffffff;
  border-radius: 24px;
  padding: 20px 18px;
  width: 100%;
  max-width: clamp(300px, 90vw, 440px);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.4);
  animation: slideUp 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}
@keyframes slideUp {
  from {
    transform: translateY(40px) scale(0.96);
    opacity: 0;
  }
  to {
    transform: translateY(0) scale(1);
    opacity: 1;
  }
}

/* ─── header ─────────────────────────────────────────────────────────────── */
.pause-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.pause-header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}
.pause-icon-wrap {
  width: 38px;
  height: 38px;
  border-radius: 12px;
  background: #eef2ff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
}
.pause-title {
  font-size: 18px;
  font-weight: 900;
  color: #1a2340;
  margin: 0;
}
.pause-close-btn {
  width: 30px;
  height: 30px;
  border-radius: 9px;
  background: #f0f0f0;
  border: none;
  color: #888;
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
}
.pause-close-btn:hover {
  background: #e0e0e0;
}

/* ─── stats ──────────────────────────────────────────────────────────────── */
.pause-stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 16px;
}
.stat-cell {
  background: #f5f7ff;
  border-radius: 14px;
  padding: 10px 8px;
  text-align: center;
}
.stat-val {
  font-size: 20px;
  font-weight: 900;
  color: #1a2340;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.stat-lbl {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: #6a8ab0;
  margin-top: 4px;
}
.lives-row {
  display: flex;
  justify-content: center;
  gap: 2px;
  font-size: 14px;
}

/* ─── divider ────────────────────────────────────────────────────────────── */
.divider {
  height: 1px;
  background: #f0f0f0;
  margin: 14px 0;
}

/* ─── quick settings ─────────────────────────────────────────────────────── */
.quick-settings {
}
.qs-label {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #aaa;
  margin: 0 0 10px;
}
.qs-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 0;
}
.qs-name {
  font-size: 12px;
  font-weight: 600;
  color: #2a3a5a;
  min-width: 90px;
  display: flex;
  align-items: center;
  gap: 5px;
}
.qs-slider {
  flex: 1;
  -webkit-appearance: none;
  appearance: none;
  height: 4px;
  border-radius: 2px;
  background: #e0e8ff;
  outline: none;
  cursor: pointer;
}
.qs-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #3d5ae0;
  border: 2px solid white;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
}
.qs-val {
  font-size: 11px;
  font-weight: 700;
  color: #3d5ae0;
  min-width: 34px;
  text-align: right;
}

/* toggle */
.qs-row--toggle {
}
.toggle-btn {
  position: relative;
  width: 36px;
  height: 20px;
  border-radius: 10px;
  background: #d0d8e8;
  border: none;
  cursor: pointer;
  transition: background 0.2s;
  flex-shrink: 0;
  margin-left: auto;
}
.toggle-btn--on {
  background: #3d5ae0;
}
.toggle-thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: white;
  transition: transform 0.2s;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}
.toggle-btn--on .toggle-thumb {
  transform: translateX(16px);
}

/* ─── action buttons ─────────────────────────────────────────────────────── */
.pause-actions {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.action-btn {
  width: 100%;
  padding: 12px 16px;
  border-radius: 14px;
  border: none;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: transform 0.12s, box-shadow 0.12s;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
.action-btn:active {
  transform: scale(0.98);
}

.action-btn--primary {
  background: #3d5ae0;
  color: white;
  box-shadow: 0 3px 0 #2040b0;
}
.action-btn--primary:active {
  box-shadow: 0 1px 0 #2040b0;
  transform: translateY(2px);
}
.action-btn--primary:hover {
  background: #4a68f0;
}

.action-btn--secondary {
  background: #eef2ff;
  color: #3d5ae0;
}
.action-btn--secondary:hover {
  background: #e0e8ff;
}

.action-btn--ghost {
  background: #f5f5f5;
  color: #555;
}
.action-btn--ghost:hover {
  background: #ebebeb;
}

/* ─── hint text ──────────────────────────────────────────────────────────── */
.pause-hint {
  text-align: center;
  margin-top: 12px;
  margin-bottom: 0;
  font-size: 10px;
  color: #bbb;
  font-style: italic;
  animation: blink 2.4s ease-in-out infinite;
}
@keyframes blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

/* ─── fluid scaling — card padding/type grow smoothly with viewport ─────── */
.pause-card {
  padding: clamp(16px, 2.2vw, 28px) clamp(14px, 2vw, 26px);
}
.pause-title {
  font-size: clamp(16px, 1.6vw, 21px);
}
.pause-icon-wrap {
  width: clamp(34px, 3vw, 44px);
  height: clamp(34px, 3vw, 44px);
  font-size: clamp(14px, 1.4vw, 19px);
}
.stat-val {
  font-size: clamp(18px, 1.8vw, 25px);
}
.action-btn {
  padding: clamp(10px, 1.1vw, 14px) clamp(14px, 1.4vw, 18px);
  font-size: clamp(12px, 1.1vw, 15px);
}
</style>
