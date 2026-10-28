<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSessionGuard } from '@/composables/useSessionGuard';

const POLL_INTERVAL_MS = 10_000;

const router = useRouter();
const route = useRoute();
const guard = useSessionGuard();

const checking = ref(true);
const now = ref(Date.now());

let pollTimer: ReturnType<typeof setInterval> | null = null;
let clockTimer: ReturnType<typeof setInterval> | null = null;

/** Where to send the player once the other device's session is gone. */
const redirect = computed(() => {
  const target = route.query.redirect;
  // Only ever redirect to an in-app gameplay route: an attacker-controlled
  // `redirect` param must not be able to bounce the user off the origin.
  if (typeof target === 'string' && target.startsWith('/play/')) return target;
  return null;
});

const secondsLeft = computed(() => {
  const until = guard.blockedUntil.value;
  if (!until) return null;
  return Math.max(0, Math.ceil((until - now.value) / 1000));
});

/**
 * Try to take the session. Returns true as soon as the other device's session
 * has expired (or was released), at which point we leave for the intended
 * destination.
 */
async function poll(): Promise<void> {
  const allowed = await guard.ensurePlayAllowed();
  checking.value = false;
  if (allowed) {
    stopTimers();
    router.replace(redirect.value ?? { name: 'home' });
  }
}

function stopTimers(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (clockTimer) {
    clearInterval(clockTimer);
    clockTimer = null;
  }
}

function goHome(): void {
  stopTimers();
  router.replace({ name: 'home' });
}

onMounted(() => {
  void poll();
  pollTimer = setInterval(() => void poll(), POLL_INTERVAL_MS);
  clockTimer = setInterval(() => (now.value = Date.now()), 1000);
});

onBeforeUnmount(stopTimers);
</script>

<template>
  <div class="waiting-page">
    <div class="waiting-card">
      <div class="waiting-spinner" :class="{ 'waiting-spinner--idle': checking }" />

      <h1>PLAYING ON ANOTHER DEVICE</h1>

      <p class="waiting-text">
        It looks like you are playing on other device now. Not to lead us in a trouble with your
        score synchronization stop game and close the App please
      </p>

      <p class="waiting-status">
        <span v-if="checking">Checking…</span>
        <span v-else-if="secondsLeft === null">
          Waiting for the other device to close the game…
        </span>
        <span v-else>Try again in about {{ secondsLeft }}s…</span>
      </p>

      <button class="waiting-home" @click="goHome">Go to main menu</button>
    </div>
  </div>
</template>

<style scoped>
.waiting-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
  background: #06101a;
  color: #e8f4fb;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.waiting-card {
  width: 100%;
  max-width: 520px;
  text-align: center;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(0, 191, 255, 0.25);
  border-radius: 20px;
  padding: 40px 28px 28px;
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.6);
}

.waiting-spinner {
  width: 54px;
  height: 54px;
  margin: 0 auto 22px;
  border-radius: 50%;
  border: 3px solid rgba(0, 191, 255, 0.15);
  border-top-color: #00bfff;
  animation: waiting-spin 1s linear infinite;
}

.waiting-spinner--idle {
  animation-duration: 2.4s;
}

@keyframes waiting-spin {
  to {
    transform: rotate(360deg);
  }
}

.waiting-card h1 {
  font-size: 22px;
  letter-spacing: 0.12em;
  margin: 0 0 14px;
  color: #00bfff;
}

.waiting-text {
  font-size: 14px;
  line-height: 1.55;
  color: #7aa0b5;
  margin: 0 0 18px;
}

.waiting-status {
  font-size: 13px;
  color: #9fc;
  margin: 0 0 22px;
  min-height: 18px;
}

.waiting-home {
  width: 100%;
  height: 48px;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 12px;
  color: #7aa0b5;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}

.waiting-home:hover {
  background: rgba(255, 255, 255, 0.05);
  color: #fff;
}
</style>
