<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { getAirportById } from '@/game/config/airports.config';
import {
  getGameplayLevelById,
  getLevelByAirportAndShift,
  getLevelByNumber,
  getNextLevelInAirport,
} from '@/game/config/levels.config';
import { useGameStore } from '@/stores/game';
import AirTrafficCanvas from '@/components/game/AirTrafficCanvas.vue';
import GameHUD from '@/components/game/GameHUD.vue';
import PauseModal from '@/components/game/PauseModal.vue';
import LevelCompleteModal from '@/components/game/LevelCompleteModal.vue';
import { gameEventBus } from '@/services/EventBus';

const router = useRouter();
const route = useRoute();
const gameStore = useGameStore();

const canvasRef = ref<InstanceType<typeof AirTrafficCanvas> | null>(null);
const gameKey = ref(0);

const handlePause = () => {
  gameStore.pauseGame();
  canvasRef.value?.pauseGame();
};

const handleResume = () => {
  gameStore.resumeGame();
  canvasRef.value?.resumeGame();
};

const handleRestart = () => {
  gameStore.resumeGame();
  gameStore.startGame();
  gameEventBus.emit('game:restart');
  gameKey.value++;
};

const handleMenu = () => {
  const airportId = gameStore.currentLevelId?.split(':')[0];
  const airport = airportId ? getAirportById(airportId) : null;
  if (airport) {
    router.push({ name: 'AirportShifts', params: { airportId: airport.id } });
    return;
  }
  router.push({ name: 'Airfields' });
};

const handleNextLevel = () => {
  const currentLevelId = gameStore.currentLevelId;
  const level = currentLevelId
    ? getLevelByAirportAndShift(
        currentLevelId.split(':')[0] ?? '',
        currentLevelId.split(':')[1] ?? ''
      )
    : null;
  const nextLevel = level ? getNextLevelInAirport(level.id) : null;

  if (nextLevel && level) {
    router.push({
      name: 'Gameplay',
      params: { airportId: level.airportId, shiftId: nextLevel.shiftId },
    });
    return;
  }

  if (level) {
    router.push({ name: 'AirportShifts', params: { airportId: level.airportId } });
    return;
  }

  router.push({ name: 'Airfields' });
};

function syncRouteLevel(): string | null {
  if (route.path.startsWith('/train')) {
    const levelId = Number(route.params.levelId);
    if (Number.isInteger(levelId) && levelId > 0) {
      gameStore.setTrainingLevel(levelId);
      return null;
    }
  }

  gameStore.clearTrainingMode();

  let levelId: string | null = null;
  if (route.name === 'Gameplay') {
    const level = getLevelByAirportAndShift(
      String(route.params.airportId ?? ''),
      String(route.params.shiftId ?? '')
    );
    levelId = level?.id ?? null;
  } else if (route.name === 'LegacyGame') {
    const rawLevelId = String(route.params.levelId ?? '');
    const numericLevelId = Number(rawLevelId);
    const level = Number.isInteger(numericLevelId)
      ? getLevelByNumber(numericLevelId)
      : getGameplayLevelById(rawLevelId);
    levelId = level?.id ?? null;
  } else {
    levelId = gameStore.currentLevelId ?? getLevelByNumber(gameStore.currentLevel)?.id ?? null;
  }

  if (!levelId) return null;

  const previousLevelId = gameStore.currentLevelId;
  gameStore.setLevelId(levelId);
  gameEventBus.emit('game:init', {
    levelId: gameStore.currentLevel,
    levelKey: levelId,
  });
  if (levelId !== previousLevelId) gameKey.value++;
  return levelId;
}

watch(
  () => route.fullPath,
  () => syncRouteLevel(),
  { immediate: true }
);

onUnmounted(() => {
  gameStore.clearTrainingMode();
});
</script>

<template>
  <div class="game-view">
    <!-- Phaser canvas -->
    <AirTrafficCanvas ref="canvasRef" :key="gameKey" />

    <!-- HUD overlay -->
    <GameHUD :score="gameStore.score" @pause="handlePause" />

    <!-- Pause modal -->
    <PauseModal
      v-if="gameStore.isPaused"
      @resume="handleResume"
      @restart="handleRestart"
      @menu="handleMenu"
    />

    <!-- Level complete modal -->
    <LevelCompleteModal
      v-if="gameStore.isComplete"
      :score="gameStore.score"
      @next="handleNextLevel"
      @menu="handleMenu"
    />
  </div>
</template>

<style scoped>
.game-view {
  position: fixed;
  inset: 0;
  overflow: hidden;
}
</style>
