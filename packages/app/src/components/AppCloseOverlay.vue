<script setup lang="ts">
/**
 * AppCloseOverlay — the blocking layer that covers the app while ATC-APP is
 * closing.
 *
 * Three states:
 *   'confirm' — a styled modal asking whether to really leave a live level
 *   'closing' — the loader shown while the score flush and the terminate run
 *   'error'   — the close did not work; offer a retry or a way out
 *
 * It is mounted ONCE, globally, by App.vue, so it covers every route and
 * every layer underneath (the Phaser canvas, the HUD, the paywall, the debug
 * panel). The overlay itself is the touch barrier: it is a fixed, full
 * viewport layer above everything, with `touch-action: none` so it also
 * swallows scroll, pinch and long-press on the content below.
 */
import type { AppClosePhase } from '@/composables/useAppClose';

defineProps<{
  phase: AppClosePhase;
  statusText: string;
  errorText: string | null;
}>();

const emit = defineEmits<{
  confirm: [];
  cancel: [];
  retry: [];
}>();
</script>

<template>
  <Teleport to="body">
    <div
      class="close-overlay"
      :class="`close-overlay--${phase}`"
      role="dialog"
      aria-modal="true"
      @touchmove.prevent
      @contextmenu.prevent
    >
      <!-- CONFIRM ─────────────────────────────────────────────────────────── -->
      <div v-if="phase === 'confirm'" class="close-card">
        <h2 class="close-title">Exit ATC-APP?</h2>
        <p class="close-text">Your current progress in this shift will be lost.</p>
        <div class="close-actions">
          <button class="close-btn close-btn--ghost" @click="emit('cancel')">Keep playing</button>
          <button class="close-btn close-btn--danger" @click="emit('confirm')">Exit</button>
        </div>
      </div>

      <!-- CLOSING ─────────────────────────────────────────────────────────── -->
      <div v-else-if="phase === 'closing'" class="close-card">
        <div class="close-spinner" aria-hidden="true" />
        <p class="close-text close-text--status">{{ statusText }}</p>
        <p class="close-hint">This can take a few seconds on a slow connection.</p>
      </div>

      <!-- ERROR ───────────────────────────────────────────────────────────── -->
      <div v-else-if="phase === 'error'" class="close-card">
        <p class="close-text">ATC-APP could not close automatically.</p>
        <p v-if="errorText" class="close-hint">{{ errorText }}</p>
        <div class="close-actions">
          <button class="close-btn close-btn--ghost" @click="emit('cancel')">Cancel</button>
          <button class="close-btn close-btn--danger" @click="emit('retry')">Try again</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* ─── blocking layer ─────────────────────────────────────────────────────── */
.close-overlay {
  position: fixed;
  inset: 0;
  /* Above every existing layer — the app's highest today is 10001 (App.vue). */
  z-index: 100000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(10, 18, 40, 0.92);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);

  /* Swallow scroll / pinch / long-press aimed at the layer underneath. */
  touch-action: none;
  overscroll-behavior: contain;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;

  animation: close-fade 0.2s ease;
}

@keyframes close-fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

/* ─── card ───────────────────────────────────────────────────────────────── */
.close-card {
  width: 100%;
  max-width: clamp(300px, 90vw, 420px);
  padding: clamp(20px, 3vw, 28px);
  border-radius: 24px;
  background: #ffffff;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.45);
  text-align: center;
  animation: close-pop 0.28s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes close-pop {
  from {
    transform: translateY(28px) scale(0.96);
    opacity: 0;
  }
  to {
    transform: translateY(0) scale(1);
    opacity: 1;
  }
}

.close-title {
  margin: 0 0 10px;
  font-size: clamp(18px, 2.4vw, 22px);
  font-weight: 900;
  color: #1a2340;
}

.close-text {
  margin: 0 0 18px;
  font-size: clamp(13px, 1.7vw, 15px);
  font-weight: 600;
  color: #46587a;
}

.close-text--status {
  margin: 18px 0 8px;
  color: #1a2340;
}

.close-hint {
  margin: 0 0 18px;
  font-size: clamp(11px, 1.4vw, 13px);
  font-weight: 500;
  color: #8a9ab5;
}

/* ─── actions ────────────────────────────────────────────────────────────── */
.close-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
}

.close-btn {
  flex: 1;
  padding: 12px 16px;
  border: none;
  border-radius: 14px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: transform 0.12s, box-shadow 0.12s, background 0.15s;
  touch-action: manipulation;
}

.close-btn:active {
  transform: scale(0.98);
}

.close-btn--ghost {
  background: #f0f3fa;
  color: #46587a;
}

.close-btn--ghost:hover {
  background: #e4e9f4;
}

.close-btn--danger {
  background: #d94f4f;
  color: #ffffff;
  box-shadow: 0 3px 0 #a83a3a;
}

.close-btn--danger:hover {
  background: #e35c5c;
}

/* ─── spinner ────────────────────────────────────────────────────────────── */
.close-spinner {
  width: 46px;
  height: 46px;
  margin: 4px auto 0;
  border-radius: 50%;
  border: 4px solid rgba(61, 90, 224, 0.18);
  border-top-color: #3d5ae0;
  animation: close-spin 0.9s linear infinite;
}

@keyframes close-spin {
  to {
    transform: rotate(360deg);
  }
}

/* Respect the OS "reduce motion" setting. */
@media (prefers-reduced-motion: reduce) {
  .close-overlay,
  .close-card {
    animation: none;
  }
  .close-spinner {
    animation-duration: 2.4s;
  }
}
</style>
