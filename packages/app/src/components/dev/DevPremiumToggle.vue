<template>
  <div class="dev-toggle" :title="`Dev toggle — 5 taps to toggle premium`" @click="handleClick">
    <div class="dot" :class="{ on: monetization.isPremium }"></div>
    <div v-if="showToast" class="toast">{{ toastMessage }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useMonetizationStore } from '@/stores/monetization';

const monetization = useMonetizationStore();
const clickCount = ref(0);
const showToast = ref(false);
const toastMessage = ref('');

function handleClick() {
  clickCount.value++;
  // require 5 quick taps to avoid accidental toggles
  if (clickCount.value >= 5) {
    monetization.isPremium = !monetization.isPremium;
    toastMessage.value = monetization.isPremium ? 'DEV: Premium ON' : 'DEV: Premium OFF';
    showToast.value = true;
    console.log('[DEV] Premium toggled:', monetization.isPremium);
    setTimeout(() => (showToast.value = false), 1400);
    clickCount.value = 0;
  }

  // reset the tap window after 1.5s
  setTimeout(() => (clickCount.value = 0), 1500);
}
</script>

<style scoped>
.dev-toggle {
  position: absolute;
  right: 12px;
  bottom: 12px;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  pointer-events: auto;
}
.dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.04);
  transition: all 180ms ease;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
}
.dot.on {
  background: linear-gradient(90deg, #ffd700, #ff8c00);
  box-shadow: 0 4px 14px rgba(255, 140, 0, 0.35);
}
.dev-toggle:hover .dot {
  opacity: 0.9;
  transform: scale(1.05);
}
.toast {
  position: absolute;
  bottom: 44px;
  right: 0;
  background: rgba(0, 0, 0, 0.8);
  color: #fff;
  padding: 6px 10px;
  border-radius: 8px;
  font-size: 12px;
  white-space: nowrap;
}
</style>
