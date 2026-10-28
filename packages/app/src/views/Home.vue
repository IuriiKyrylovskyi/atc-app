<!-- eslint-disable vue/multi-word-component-names -->
<script setup lang="ts">
import { useRouter } from 'vue-router';
import { useGameStore } from '@/stores/game';
import { useMonetizationStore } from '@/stores/monetization';
import { ROUTE_TO_PAGE } from '@/composables/usePageName';
import { gameEventBus } from '@/services/EventBus';
import type { IStrip } from '@/pagesData/strips';
import StripPage from '@/components/layout/StripPage.vue';

const router = useRouter();
const gameStore = useGameStore();
const monetization = useMonetizationStore();

// const isSubscribed = computed(() => monetization.isPremium);
// const aeroCreds = ref(1_240);
// const flightGems = ref(8);
// const xpCurrent = ref(320);
// const xpMax = ref(500);
// const xpLevel = ref(4);
// const bestScore = ref(0);

// const radarAngle = ref(0);

const enterControlCenter = () =>
  router.push({ name: 'Control Center', params: { pageNumber: '1' } });

const quickPlay = () => {
  // Start Game redirects to the NEXT shift after the last one the user
  // COMPLETED (`profiles.last_passed_level`, a `[airport]:[shift]` string),
  // e.g. a user who cleared `WADD:Midday Mix` lands on `/play/WADD/Evening
  // Rush`. Falls back to `eglc:red-eye` when nothing has been completed yet.
  const levelId = monetization.nextLevelToPlay;
  gameStore.setLevelId(levelId);
  // Free users can be capped out: if the next shift is behind the premium
  // paywall `setLevelId` no-ops, so fall back to the first free shift.
  if (!gameStore.currentLevelId) {
    gameStore.setLevelId('eglc:red-eye');
  }
  gameEventBus.emit('game:init', { levelId: gameStore.currentLevelId });
  router.push(`/${ROUTE_TO_PAGE.Play}`);
};

const trainingCenterHandler = () => {
  router.push(`/${ROUTE_TO_PAGE.TrainingCenter}`);
};
const onSystemConfig = () => {
  router.push(`/${ROUTE_TO_PAGE.SystemConfig}`);
};

const sharedHandlers: Record<string, (strip: IStrip, i: number) => void> = {
  quickPlay,
  enterControlCenter,
  trainingCenterHandler,
  onSystemConfig,
};

const handlers = sharedHandlers;
</script>

<template>
  <StripPage page-key="main" :handlers="handlers" />
</template>

<style lang="less"></style>
