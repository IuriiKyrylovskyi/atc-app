import { ref, onMounted, onUnmounted, type Ref } from 'vue';
import { GameCore } from '@/game/core/GameCore';
import { gameEventBus } from '@/services/EventBus';
import { useGameStore } from '@/stores/game';
import { useSettingsStore } from '@/stores/settings';
import type { CollisionData } from '@/types/game';
import { AudioSystem } from '@/game/systems/AudioSystem';
import type { PopupPlaneData } from '@/components/game/SpeedControlPopup.vue';

/**
 * Vue composable for integrating Phaser GameCore with Vue components
 */
export function useGame(containerRef: Ref<HTMLElement | null>) {
  const gameStore = useGameStore();
  const settingsStore = useSettingsStore();
  const gameCore = ref<GameCore | null>(null);
  const isReady = ref(false);

  // Stats
  const activePlanes = ref(0);
  const conflicts = ref(0);
  const landedCount = ref(0);
  const waypointPassCount = ref(0);

  // Level complete — reactive state for the modal
  const levelCompleteData = ref<{
    levelNumber: number;
    planesLanded: number;
    waypointPasses: number;
    planesTarget: number;
  } | null>(null);

  /**
   * Initialize the game
   */
  const initGame = async () => {
    if (!containerRef.value) {
      console.error('Container ref is not available');
      return;
    }

    try {
      if (!containerRef.value.id) {
        containerRef.value.id = 'game-container';
      }

      gameCore.value = new GameCore(containerRef.value);

      await gameCore.value.init();

      AudioSystem.init();

      settingsStore.loadSettings();

      // Debug: log audio settings after loading
      console.log('🔊 useGame: audio settings after loadSettings:', settingsStore.audio);

      setupEventListeners();

      isReady.value = true;

      gameCore.value.start();
      gameStore.startGame();

      console.log('✅ Game initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize game:', error);
    }
  };

  /**
   * Setup event listeners for game events
   */
  const setupEventListeners = () => {
    gameEventBus.on('assets:loaded', handleAssetsLoaded);
    gameEventBus.on('assets:error', handleAssetsError);

    gameEventBus.on('game:ready', handleGameReady);
    gameEventBus.on('game:start', handleGameStart);
    gameEventBus.on('game:pause', handleGamePause);
    gameEventBus.on('game:resume', handleGameResume);
    gameEventBus.on('game:restart', handleGameRestart);

    gameEventBus.on('level:complete', handleLevelComplete);
    gameEventBus.on('level:failed', handleLevelFailed);

    gameEventBus.on('plane:spawned', handlePlaneSpawned);
    gameEventBus.on('plane:landed', handlePlaneLanded);
    gameEventBus.on('plane:waypoint-passed', handleWaypointPassed);
    gameEventBus.on('plane:collision', handlePlaneCollision);
    gameEventBus.on('plane:offscreen', handlePlaneOffscreen);

    // Speed control events — Phaser scene reacts to these
    gameEventBus.on('plane:setSpeed', handleSetSpeed);
    gameEventBus.on('plane:cancelApproach', handleCancelApproach);
    gameEventBus.on('plane:resumeApproach', handleResumeApproach);

    gameEventBus.on('stats:update', handleStatsUpdate);

    gameEventBus.on('input:drag-start', handleDragStart);
    gameEventBus.on('input:drag-end', handleDragEnd);
  };

  /**
   * Remove event listeners
   */
  const removeEventListeners = () => {
    gameEventBus.off('assets:loaded', handleAssetsLoaded);
    gameEventBus.off('assets:error', handleAssetsError);
    gameEventBus.off('game:ready', handleGameReady);
    gameEventBus.off('game:start', handleGameStart);
    gameEventBus.off('game:pause', handleGamePause);
    gameEventBus.off('game:resume', handleGameResume);
    gameEventBus.off('game:restart', handleGameRestart);
    gameEventBus.off('level:complete', handleLevelComplete);
    gameEventBus.off('level:failed', handleLevelFailed);
    gameEventBus.off('plane:spawned', handlePlaneSpawned);
    gameEventBus.off('plane:landed', handlePlaneLanded);
    gameEventBus.off('plane:waypoint-passed', handleWaypointPassed);
    gameEventBus.off('plane:collision', handlePlaneCollision);
    gameEventBus.off('plane:offscreen', handlePlaneOffscreen);
    gameEventBus.off('plane:setSpeed', handleSetSpeed);
    gameEventBus.off('plane:cancelApproach', handleCancelApproach);
    gameEventBus.off('plane:resumeApproach', handleResumeApproach);
    gameEventBus.off('stats:update', handleStatsUpdate);
    gameEventBus.off('input:drag-start', handleDragStart);
    gameEventBus.off('input:drag-end', handleDragEnd);
  };

  // ─── Event handlers ────────────────────────────────────────────────────────

  const handleAssetsLoaded = () => console.log('✅ Assets loaded');
  const handleAssetsError = (assetKey: string) =>
    console.error(`❌ Failed to load asset: ${assetKey}`);
  const handleGameReady = () => console.log('✅ Game ready');
  const handleGameStart = () => console.log('▶️ Game started');
  const handleGamePause = () => console.log('⏸️ Game paused');
  const handleGameResume = () => console.log('▶️ Game resumed');

  const handleGameRestart = () => {
    console.log('🔄 Game restarted');
    landedCount.value = 0;
    waypointPassCount.value = 0;
  };

  const handleLevelComplete = (data: {
    levelNumber: number;
    planesLanded: number;
    waypointPasses: number;
    planesTarget: number;
  }) => {
    console.log('✅ Level complete:', data);
    levelCompleteData.value = data;
    gameStore.completeLevel();
  };

  const handleLevelFailed = (reason: string) => {
    gameStore.gameOver(reason);
  };

  const handlePlaneSpawned = (planeData: { id: number }) => {
    console.log('✈️ Plane spawned:', planeData.id);
  };

  const handlePlaneLanded = (planeId: number, score: number) => {
    landedCount.value++;
    gameStore.planeLanded(planeId, score);
  };

  const handleWaypointPassed = (planeId: number, score: number) => {
    waypointPassCount.value++;
    gameStore.waypointPassed(planeId, score);
  };

  const handlePlaneCollision = (data: CollisionData) => {
    gameStore.planeCollision(data.plane1Id, data.plane2Id);
  };

  const handlePlaneOffscreen = ({ planeId }: { planeId: number }) => {
    gameStore.planeOffscreen(planeId);
  };

  // ─── Speed control handlers ────────────────────────────────────────────────
  // These are forwarded to GameScene via the event bus. GameScene should have
  // matching listeners registered in its create() / setupSettingsListeners().
  // useGame only logs here — the actual plane mutation lives in GameScene.ts.

  const handleSetSpeed = ({ planeId, speed }: { planeId: number; speed: number }) => {
    console.log(`🎚️ Speed instruction: plane ${planeId} → ${speed} kt`);
    // GameScene.ts registers its own listener on 'plane:setSpeed' and calls
    // plane.setTargetSpeed(speed * KNOTS_TO_SPEED). No action needed here.
  };

  const handleCancelApproach = ({ planeId }: { planeId: number }) => {
    console.log(`🚫 Cancel approach: plane ${planeId}`);
    // GameScene.ts handles clearing isApproachingLanding + path on this event.
  };

  const handleResumeApproach = ({ planeId }: { planeId: number }) => {
    console.log(`✅ Resume approach: plane ${planeId}`);
    // GameScene.ts handles re-snapping to the runway approach path.
  };

  const handleStatsUpdate = (stats: {
    activePlanes: number;
    planesLanded?: number;
    waypointPasses?: number;
    conflicts: number;
  }) => {
    activePlanes.value = stats.activePlanes;
    conflicts.value = stats.conflicts;
    if (stats.planesLanded !== undefined) landedCount.value = stats.planesLanded;
    if (stats.waypointPasses !== undefined) waypointPassCount.value = stats.waypointPasses;
  };

  const handleDragStart = (planeId: number, point: unknown) => {
    console.log('🎯 Drag started on plane:', planeId, point);
  };

  const handleDragEnd = () => {
    console.log('🎯 Drag ended');
  };

  // ─── Game controls ─────────────────────────────────────────────────────────

  const pauseGame = () => {
    gameCore.value?.pause();
    gameStore.pauseGame();
  };

  const resumeGame = () => {
    gameCore.value?.resume();
    gameStore.resumeGame();
  };

  const restartGame = () => {
    gameCore.value?.restart();
    gameStore.restartGame();
  };

  const clearLevelComplete = () => {
    levelCompleteData.value = null;
  };

  /**
   * Hard restart — destroy the Phaser game instance completely and recreate it
   * from scratch, identical to the first onMounted() call.
   */
  const hardRestart = async (level?: number) => {
    if (gameCore.value) {
      removeEventListeners();
      AudioSystem.teardown();
      gameCore.value.destroy();
      gameCore.value = null;
      isReady.value = false;
    }

    if (level !== undefined) {
      gameStore.setLevel(level);
    }

    await initGame();
  };

  const toggleDebug = () => {
    gameCore.value?.toggleDebug();
  };

  const getStats = () => {
    return gameCore.value?.getStats() || null;
  };

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  onMounted(() => {
    initGame();
  });

  onUnmounted(() => {
    removeEventListeners();
    AudioSystem.teardown();
    gameCore.value?.destroy();
    gameCore.value = null;
  });

  return {
    isReady,
    activePlanes,
    conflicts,
    landedCount,
    waypointPassCount,
    levelCompleteData,
    pauseGame,
    resumeGame,
    restartGame,
    hardRestart,
    clearLevelComplete,
    toggleDebug,
    getStats,
  };
}
