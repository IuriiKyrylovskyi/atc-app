<!-- eslint-disable vue/multi-word-component-names -->
<script setup lang="ts">
import type { IStrip } from '@/pagesData/strips';
import StripPage from '@/components/layout/StripPage.vue';

// The screens these strips lead to (game, Control Center, Training Center,
// System Config) are not part of atc-app yet. Each handler is kept as a named
// hook so wiring a new page in is a one-line change here.
const notPortedYet = (target: string) => () => {
  console.info(`[Home] "${target}" is not available yet`);
};

const quickPlay = notPortedYet('Start Game');
const enterControlCenter = notPortedYet('Control Center');
const trainingCenterHandler = notPortedYet('Training Center');
const onSystemConfig = notPortedYet('System Config');

const handlers: Record<string, (strip: IStrip, i: number) => void> = {
  quickPlay,
  enterControlCenter,
  trainingCenterHandler,
  onSystemConfig,
};
</script>

<template>
  <StripPage page-key="main" :handlers="handlers" />
</template>

<style lang="less"></style>
