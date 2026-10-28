<script setup lang="ts">
import { computed } from 'vue';

/**
 * LevelCompleteModal
 * Props + emits are backward-compatible with the original component.
 * New optional props: airportName, airportCode, conflicts, earnedCoins, earnedGems, bestScore
 */
const props = defineProps<{
  score: number;
  stars?: number; // 0–3
  planesLanded?: number;
  playTime?: string; // e.g. "04:12"
  conflicts?: number;
  airportName?: string;
  airportCode?: string;
  earnedCoins?: number;
  earnedGems?: number;
  bestScore?: number;
}>();

const emit = defineEmits<{
  next: [];
  menu: [];
  replay: [];
}>();

// Star array: true = filled, false = empty
const starsArray = computed(() => Array.from({ length: 3 }, (_, i) => i < (props.stars ?? 0)));

// New record if score beats bestScore
const isNewRecord = computed(() => props.bestScore !== undefined && props.score > props.bestScore);
</script>

<template>
  <div class="lc-overlay">
    <div class="lc-card">
      <!-- Confetti / celebration row -->
      <div class="lc-confetti" aria-hidden="true">🎉 ✨ 🎊</div>

      <!-- Title -->
      <h2 class="lc-title">Level Complete!</h2>

      <!-- Airport sub-label -->
      <p v-if="airportName" class="lc-airport">
        {{ airportCode ? `${airportCode} · ` : '' }}{{ airportName }}
      </p>

      <!-- Stars -->
      <div class="lc-stars" aria-label="`${stars ?? 0} out of 3 stars`">
        <span
          v-for="(filled, i) in starsArray"
          :key="i"
          class="lc-star"
          :class="{ 'lc-star--empty': !filled }"
          :style="{ animationDelay: `${0.15 + i * 0.18}s` }"
          aria-hidden="true"
          >⭐</span
        >
      </div>

      <!-- Score box -->
      <div class="lc-score-box">
        <div class="lc-score-label">Final Score</div>
        <div class="lc-score-val">{{ score.toLocaleString() }}</div>
        <div v-if="isNewRecord" class="lc-new-record">
          🎯 New record! +{{ (score - (bestScore ?? 0)).toLocaleString() }}
        </div>
        <div v-else-if="bestScore" class="lc-best">Best: {{ bestScore.toLocaleString() }}</div>
      </div>

      <!-- Stats row -->
      <div class="lc-stats">
        <div v-if="planesLanded !== undefined" class="lc-stat">
          <div class="lc-stat-icon" aria-hidden="true">✈️</div>
          <div class="lc-stat-val">{{ planesLanded }}</div>
          <div class="lc-stat-lbl">Landed</div>
        </div>
        <div v-if="playTime" class="lc-stat">
          <div class="lc-stat-icon" aria-hidden="true">⏱</div>
          <div class="lc-stat-val">{{ playTime }}</div>
          <div class="lc-stat-lbl">Time</div>
        </div>
        <div v-if="conflicts !== undefined" class="lc-stat">
          <div class="lc-stat-icon" aria-hidden="true">⚠️</div>
          <div class="lc-stat-val">{{ conflicts }}</div>
          <div class="lc-stat-lbl">Conflicts</div>
        </div>
      </div>

      <!-- Reward strip -->
      <div v-if="earnedCoins || earnedGems" class="lc-reward">
        <span aria-hidden="true">🪙</span>
        <span class="lc-reward-text">
          {{ earnedCoins ? `+${earnedCoins.toLocaleString()} AeroCredits` : '' }}
        </span>
        <span v-if="earnedGems" class="lc-reward-gems">💎 +{{ earnedGems }}</span>
      </div>

      <!-- Action buttons -->
      <div class="lc-actions">
        <button class="lc-btn lc-btn--ghost" aria-label="Main Menu" @click="emit('menu')">
          🏠
        </button>
        <button class="lc-btn lc-btn--ghost" @click="emit('replay')">↺ Replay</button>
        <button class="lc-btn lc-btn--primary" @click="emit('next')">Next →</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ─── overlay ────────────────────────────────────────────────────────────── */
.lc-overlay {
  position: fixed;
  inset: 0;
  background: rgba(10, 18, 40, 0.88);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
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
.lc-card {
  width: 100%;
  max-width: 360px;
  background: linear-gradient(150deg, #3d5ae0 0%, #7c5cbf 100%);
  border-radius: 26px;
  padding: 22px 18px;
  color: white;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.45);
  animation: slideUp 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
}
@keyframes slideUp {
  from {
    transform: translateY(50px) scale(0.95);
    opacity: 0;
  }
  to {
    transform: translateY(0) scale(1);
    opacity: 1;
  }
}

/* ─── confetti ───────────────────────────────────────────────────────────── */
.lc-confetti {
  text-align: center;
  font-size: 22px;
  margin-bottom: 4px;
}

/* ─── title ──────────────────────────────────────────────────────────────── */
.lc-title {
  font-size: 22px;
  font-weight: 900;
  text-align: center;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  margin: 0 0 2px;
}
.lc-airport {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.55);
  text-align: center;
  margin: 0 0 12px;
}

/* ─── stars ──────────────────────────────────────────────────────────────── */
.lc-stars {
  display: flex;
  justify-content: center;
  gap: 10px;
  margin-bottom: 14px;
}
.lc-star {
  font-size: 30px;
  line-height: 1;
  animation: starPop 0.4s ease both;
}
.lc-star--empty {
  filter: grayscale(1);
  opacity: 0.25;
}
@keyframes starPop {
  0% {
    transform: scale(0) rotate(-15deg);
    opacity: 0;
  }
  60% {
    transform: scale(1.25) rotate(5deg);
  }
  100% {
    transform: scale(1) rotate(0deg);
    opacity: 1;
  }
}

/* ─── score box ──────────────────────────────────────────────────────────── */
.lc-score-box {
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 16px;
  padding: 14px;
  text-align: center;
  margin-bottom: 12px;
}
.lc-score-label {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.6);
  margin-bottom: 2px;
}
.lc-score-val {
  font-size: 38px;
  font-weight: 900;
  color: #ffd700;
  line-height: 1;
  text-shadow: 0 2px 12px rgba(0, 0, 0, 0.2);
  font-variant-numeric: tabular-nums;
}
.lc-new-record {
  font-size: 11px;
  font-weight: 700;
  color: #6ee7b7;
  margin-top: 3px;
}
.lc-best {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.4);
  margin-top: 3px;
}

/* ─── stats ──────────────────────────────────────────────────────────────── */
.lc-stats {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.lc-stat {
  flex: 1;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  padding: 8px 4px;
  text-align: center;
}
.lc-stat-icon {
  font-size: 14px;
  line-height: 1;
  margin-bottom: 2px;
}
.lc-stat-val {
  font-size: 16px;
  font-weight: 800;
  color: white;
  line-height: 1.2;
}
.lc-stat-lbl {
  font-size: 8px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.5);
  letter-spacing: 0.05em;
}

/* ─── reward strip ───────────────────────────────────────────────────────── */
.lc-reward {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(255, 215, 0, 0.12);
  border: 1px solid rgba(255, 215, 0, 0.25);
  border-radius: 12px;
  padding: 9px 12px;
  margin-bottom: 14px;
  font-size: 14px;
}
.lc-reward-text {
  font-size: 11px;
  font-weight: 700;
  color: #ffd700;
  flex: 1;
}
.lc-reward-gems {
  font-size: 11px;
  font-weight: 700;
  color: rgba(255, 215, 0, 0.7);
}

/* ─── actions ────────────────────────────────────────────────────────────── */
.lc-actions {
  display: flex;
  gap: 8px;
}
.lc-btn {
  flex: 1;
  padding: 11px 8px;
  border-radius: 14px;
  border: none;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: transform 0.12s, opacity 0.12s;
}
.lc-btn:active {
  transform: scale(0.97);
}

.lc-btn--ghost {
  background: rgba(255, 255, 255, 0.14);
  color: white;
  border: 1px solid rgba(255, 255, 255, 0.2);
}
.lc-btn--ghost:hover {
  background: rgba(255, 255, 255, 0.22);
}

.lc-btn--primary {
  background: white;
  color: #3d5ae0;
}
.lc-btn--primary:hover {
  background: #f0f4ff;
}

/* ─── responsive ─────────────────────────────────────────────────────────── */
@media (max-width: 380px) {
  .lc-score-val {
    font-size: 32px;
  }
  .lc-star {
    font-size: 24px;
  }
  .lc-title {
    font-size: 20px;
  }
}

/* ─── desktop: roomier card, larger type ─────────────────────────────────── */
@media (min-width: 1024px) {
  .lc-card {
    max-width: 440px;
    padding: 28px 26px;
  }
  .lc-title {
    font-size: 26px;
  }
  .lc-score-val {
    font-size: 44px;
  }
  .lc-star {
    font-size: 34px;
  }
}
</style>
