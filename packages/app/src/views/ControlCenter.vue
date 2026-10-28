<script setup lang="ts">
import { computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { IStrip } from '@/pagesData/strips';
import StripPage from '@/components/layout/StripPage.vue';
import { useDevice } from '@/composables/useDevice';
import {
  clampControlCenterPage,
  controlCenterBreakpoint,
  controlCenterPageCount,
} from '@/pagesData/controlCenter';

const router = useRouter();
const route = useRoute();
const { screenType, screenRotation } = useDevice();

// Four screen keys, three layouts — see controlCenter.ts. The page count is NOT
// a constant: landscape grows a page once the airport list outgrows 4 per page,
// so anything that needs "the last page" has to ask for the current layout.
const breakpoint = computed(() => controlCenterBreakpoint(screenType.value, screenRotation.value));

// 1-based: the route segment is the page number itself, with no offset.
const requestedPage = computed(() => Number(route.params.pageNumber));
const page = computed(() => clampControlCenterPage(breakpoint.value, requestedPage.value));
const pageKey = computed(() => `control center ${page.value}`);

// A deep link to /control-center/page-99 (or one that never resolved) is
// rewritten in place, so the URL and the rendered page can never disagree.
// `immediate` is required: without it the first evaluation happens before the
// watcher exists, and a bad deep link would render page 5 while leaving
// `page-99` in the address bar until the user pressed "More Pro Levels".
watch(
  [requestedPage, page],
  ([requested, resolved]) => {
    if (requested === resolved) return;
    void router.replace({ name: 'Control Center', params: { pageNumber: String(resolved) } });
  },
  { immediate: true }
);

const onMoreLevels = () => {
  const last = controlCenterPageCount(breakpoint.value);
  const next = Math.min(page.value + 1, last);
  if (next === page.value) return;
  void router.push({ name: 'Control Center', params: { pageNumber: String(next) } });
};

const sharedHandlers: Record<string, (strip: IStrip, i: number) => void> = {
  onMoreLevels,
};

const handlers = sharedHandlers;
</script>

<template>
  <StripPage :page-key="pageKey" :handlers="handlers" />
</template>

<style lang="less"></style>
