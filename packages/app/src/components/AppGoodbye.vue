<template>
  <Teleport to="body">
    <Transition name="goodbye-fade">
      <div v-if="visible" class="app-goodbye-overlay">
        <div class="app-goodbye-panel">
          <div class="app-goodbye-logo">ATC-APP</div>
          <p class="app-goodbye-text">You can close ATC-APP now.</p>
          <p class="app-goodbye-hint">{{ hint }}</p>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * The goodbye screen shown when the app cannot terminate itself.
 *
 * iOS: Apple forbids programmatic termination (App Store Guideline 2.2.5) and
 * Capacitor's `App.exitApp()` is literally `call.unimplemented()` on iOS, so
 * the app is closed by the user with the OS gesture.
 *
 * The hint is passed in so the copy can follow the platform that produced it.
 */
defineProps<{
  visible: boolean;
  hint: string;
}>();
</script>

<style scoped>
.app-goodbye-overlay {
  position: fixed;
  inset: 0;
  /* Above every other layer — the app's highest today is 10001 (App.vue). */
  z-index: 100000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #5bc8f0 0%, #3aaad6 100%);

  /* The app is functionally closed: nothing underneath may be touched. */
  touch-action: none;
  overscroll-behavior: contain;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
}

.app-goodbye-panel {
  text-align: center;
  color: white;
  padding: 32px;
}

.app-goodbye-logo {
  font-size: clamp(42px, 10vw, 64px);
  font-weight: 900;
  letter-spacing: -1.5px;
  margin-bottom: 16px;
}

.app-goodbye-text {
  font-size: clamp(16px, 3.5vw, 22px);
  font-weight: 600;
  margin: 0 0 12px;
  opacity: 0.95;
}

.app-goodbye-hint {
  font-size: clamp(13px, 2.5vw, 16px);
  font-weight: 500;
  margin: 0;
  opacity: 0.7;
}

.goodbye-fade-enter-active,
.goodbye-fade-leave-active {
  transition: opacity 0.3s ease;
}

.goodbye-fade-enter-from,
.goodbye-fade-leave-to {
  opacity: 0;
}
</style>
