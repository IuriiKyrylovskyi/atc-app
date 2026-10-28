<script setup lang="ts">
import type { IStrip } from '@/pagesData/strips';
import StripPage from '@/components/layout/StripPage.vue';

// const gameStore = useGameStore();
// const purchaseStore = usePurchaseStore();
// const showPaywall = ref(false);

const sharedHandlers: Record<string, (strip: IStrip, i: number) => void> = {};

const handlers = sharedHandlers;
</script>

<template>
  <StripPage page-key="tarining center" :handlers="handlers" />
</template>

<style lang="less"></style>
