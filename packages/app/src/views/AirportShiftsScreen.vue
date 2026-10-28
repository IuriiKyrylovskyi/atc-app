<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ENDLESS, SHIFTS, type Shift } from '@/game/config/level.structure';
import { getAirportById } from '@/game/config/airports.config';
import { getLevelByAirportAndShift } from '@/game/config/levels.config';
import { useGameStore } from '@/stores/game';
import { useMonetizationStore } from '@/stores/monetization';
import { useShiftProgressStore } from '@/stores/shiftProgress';
import { progressService } from '@/services/progress';
import { gameEventBus } from '@/services/EventBus';
import StripPage from '@/components/layout/StripPage.vue';
import type { IStrip } from '@/pagesData/strips';

type ShiftOption = Shift | typeof ENDLESS;

const route = useRoute();
const router = useRouter();
const gameStore = useGameStore();
const monetization = useMonetizationStore();
const progress = useShiftProgressStore();
const showPaywall = ref(false);

const airportId = computed(() => {
  const value = String(route.params.airportId ?? '');
  return decodeURIComponent(value);
});

const airport = computed(() => getAirportById(airportId.value));
const shifts = computed<ShiftOption[]>(() => [...SHIFTS, ENDLESS]);
const airportLocked = computed(() => airport.value?.tier === 'paid' && !monetization.isPremium);

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function airportStars(): number {
  if (!airport.value) return 0;
  return Object.values(progress.getAirportProgress(airport.value.id).stars).reduce(
    (total, stars) => total + stars,
    0
  );
}

function isUnlocked(shift: ShiftOption): boolean {
  if (!airport.value) return false;
  // Same rule as the strip UI and the router guard — one implementation, so the
  // list can never disagree with what actually loads.
  return progressService.isShiftPlayable(airport.value.id, shift.id);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function unlockLabel(shift: ShiftOption): string {
  if (isUnlocked(shift)) return 'Available';
  if (shift.id === 'endless') return 'Clear Midday Mix';
  const previous = SHIFTS.find((candidate) => candidate.tier === shift.tier - 1);
  return previous ? `Clear ${previous.name}` : 'Available';
}

function launch(shift: ShiftOption): void {
  if (!airport.value) return;
  if (airportLocked.value) {
    showPaywall.value = true;
    return;
  }
  if (!isUnlocked(shift)) return;

  const level = getLevelByAirportAndShift(airport.value.id, shift.id);
  console.log('___level___', level);

  if (!level) return;

  gameStore.setLevelId(level.id);
  gameEventBus.emit('game:init', {
    levelId: gameStore.currentLevel,
    levelKey: level.id,
  });
  router.push({
    name: 'Gameplay',
    params: { airportId: airport.value.id, shiftId: shift.id },
  });
}

watch(
  () => route.params.airportId,
  () => {
    if (!airport.value) router.replace('/airfields');
  },
  { immediate: true }
);

const sharedHandlers: Record<string, (strip: IStrip, i: number) => void> = {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  playLevel: (strip, i) => {
    void i;
    const shift = shifts.value.find((s) => s.name === strip.type?.text);
    if (shift) launch(shift);
  },
};

const handlers = sharedHandlers;
</script>

<template>
  <StripPage page-key="shift" :handlers="handlers" />
</template>

<style scoped>
.airport-shifts-screen {
  position: relative;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  padding: 0 16px env(safe-area-inset-bottom, 20px);
  overflow-x: hidden;
  color: white;
  background: linear-gradient(175deg, #60cdef 0%, #42aee0 100%);
  font-family: -apple-system, 'SF Pro Rounded', BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

.shifts-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 0 4px;
}

.back-btn {
  flex-shrink: 0;
  width: 38px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  background: rgba(255, 255, 255, 0.18);
  border: 1.5px solid rgba(255, 255, 255, 0.3);
  border-radius: 12px;
  cursor: pointer;
}

.back-btn svg {
  width: 16px;
  height: 16px;
}

.header-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.header-eyebrow {
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.2em;
  color: rgba(255, 255, 255, 0.55);
  text-transform: uppercase;
}

.header-code {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.12em;
  color: rgba(255, 255, 255, 0.7);
}

.header-title {
  font-size: 22px;
  font-weight: 900;
  line-height: 1.1;
}

.header-meta {
  margin-top: 3px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.65);
}

.airport-pitch {
  margin: 14px 2px 8px;
  font-size: 12px;
  line-height: 1.4;
  color: rgba(255, 255, 255, 0.72);
}

.shift-list {
  display: flex;
  flex-direction: column;
  gap: 9px;
  margin-top: 10px;
}

.shift-card {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 14px 12px;
  color: white;
  text-align: left;
  background: rgba(255, 255, 255, 0.16);
  border: 1.5px solid rgba(255, 255, 255, 0.28);
  border-radius: 18px;
  cursor: pointer;
  backdrop-filter: blur(8px);
  transition: background 0.2s, transform 0.15s, box-shadow 0.15s;
}

.shift-card:hover {
  background: rgba(255, 255, 255, 0.26);
  transform: translateX(3px);
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.14);
}

.shift-card--locked {
  opacity: 0.62;
  border-color: rgba(255, 200, 60, 0.28);
  background: rgba(255, 200, 60, 0.05);
}

.shift-main {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 3px;
}

.shift-tier {
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.14em;
  color: rgba(255, 255, 255, 0.55);
  text-transform: uppercase;
}

.shift-name {
  font-size: 15px;
  font-weight: 800;
}

.shift-blurb {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.6);
}

.shift-requirement {
  font-size: 10px;
  color: #80ffb8;
}

.shift-card--locked .shift-requirement {
  color: #ffd060;
}

.shift-right {
  display: flex;
  flex-shrink: 0;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

.shift-state {
  font-size: 9px;
  font-weight: 800;
  padding: 3px 8px;
  border-radius: 7px;
  background: rgba(45, 184, 122, 0.18);
  color: #80ffb8;
  border: 1px solid rgba(45, 184, 122, 0.32);
}

.shift-card--locked .shift-state {
  background: rgba(255, 200, 60, 0.12);
  color: #ffd060;
  border-color: rgba(255, 200, 60, 0.28);
}

.shift-arrow {
  font-size: 20px;
  color: rgba(255, 255, 255, 0.55);
}

@media (min-width: 768px) {
  .airport-shifts-screen {
    align-items: center;
    padding: 0 40px 40px;
  }

  .shifts-header,
  .airport-pitch,
  .shift-list {
    width: 100%;
    max-width: 760px;
  }

  .shifts-header {
    padding-top: 28px;
  }

  .header-title {
    font-size: 26px;
  }
}
</style>
