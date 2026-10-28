/**
 * packages/app/src/stores/game.ts
 *
 * Changes from original:
 *  - maxLevel is now a GETTER driven by monetizationStore.maxAccessibleLevel
 *    (was a hardcoded state field set to 10)
 *  - setLevel() enforces the accessible cap
 *  - completeLevel() records the shift as passed via
 *    monetizationStore.markLevelPassed(), which writes
 *    profiles.last_passed_level / profiles.passed_levels — the single source
 *    of truth for where Start Game should redirect
 *  - currentLevel / currentLevelId are NOT persisted locally: the server
 *    `last_passed_level` column is the source of truth, so a reload always
 *    re-derives the cursor from the server instead of trusting a stale
 *    local copy.
 *  - No other logic changed — all existing composable/scene integrations still work
 */
import { defineStore } from 'pinia';
import { safeStorage } from '@/lib/safeStorage';
import { useMonetizationStore, FREE_LEVEL_LIMIT } from './monetization';
import { progressService } from '@/services/progress';
import { useUserScoresStore } from './userScores';
import {
  calculateStars,
  getLevelByNumber,
  getLevelById,
  getLevelNumberById,
  getNextLevel,
  getNextLevelInAirport,
  getPreviousLevelInAirport,
} from '@/game/config/levels.config';

export interface GameState {
  status: 'idle' | 'playing' | 'paused' | 'complete' | 'failed';
  isPaused: boolean;
  isPlaying: boolean;
  currentLevel: number;
  currentLevelId: string | null;
  trainingLevel: number | null;
  score: number;
  highScore: number;
  planesLanded: number;
  planesCollided: number;
  waypointsPassed: number;
  totalPlanes: number;
  playTime: number;
}

export const useGameStore = defineStore('game', {
  state: (): GameState => ({
    status: 'idle',
    isPaused: false,
    isPlaying: false,
    currentLevel: 1,
    currentLevelId: null,
    trainingLevel: null,
    // maxLevel removed from state — it's now a getter below
    score: 0,
    highScore: 0,
    planesLanded: 0,
    planesCollided: 0,
    waypointsPassed: 0,
    totalPlanes: 0,
    playTime: 0,
  }),

  getters: {
    /**
     * ✅ CHANGED: maxLevel is now driven by server-side premium status.
     * Free users → FREE_LEVEL_LIMIT (3)
     * Premium users → 999 (effectively unlimited)
     *
     * Falls back to FREE_LEVEL_LIMIT if the monetization store isn't ready yet
     * (e.g. during cold boot before init() completes).
     */
    maxLevel(): number {
      try {
        const monetization = useMonetizationStore();
        return monetization.maxAccessibleLevel;
      } catch {
        // Store not yet registered (SSR / unit test context)
        return FREE_LEVEL_LIMIT;
      }
    },

    isActive: (state) => state.status === 'playing' || state.status === 'paused',
    isGameOver: (state) => state.status === 'failed',
    isComplete: (state) => state.status === 'complete',

    accuracy: (state) => {
      if (state.totalPlanes === 0) return 100;
      return Math.round(((state.planesLanded + state.waypointsPassed) / state.totalPlanes) * 100);
    },
    collisionRate: (state) => {
      if (state.totalPlanes === 0) return 0;
      return Math.round((state.planesCollided / state.totalPlanes) * 100);
    },
    formattedPlayTime: (state) => {
      const minutes = Math.floor(state.playTime / 60);
      const seconds = state.playTime % 60;
      return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    },
  },

  actions: {
    startGame() {
      this.status = 'playing';
      this.isPlaying = true;
      this.isPaused = false;
      this.score = 0;
      this.planesLanded = 0;
      this.planesCollided = 0;
      this.waypointsPassed = 0;
      this.totalPlanes = 0;
      this.playTime = 0;
    },

    pauseGame() {
      if (this.status === 'playing') {
        this.status = 'paused';
        this.isPaused = true;
        this.isPlaying = false;
      }
    },

    resumeGame() {
      if (this.status === 'paused') {
        this.status = 'playing';
        this.isPaused = false;
        this.isPlaying = true;
      }
    },

    restartGame() {
      this.startGame();
    },

    levelFailed() {
      this.status = 'failed';
      this.isPlaying = false;
      this.isPaused = false;
      this.planesCollided += 2;
      this.totalPlanes += 2;

      const levelId = this.currentLevelId ?? getLevelByNumber(this.currentLevel)?.id;
      const level = levelId ? getLevelById(levelId) : null;
      if (level && this.trainingLevel === null) {
        useUserScoresStore().recordResult(`${level.airportId}:${level.shiftId}`, this.planesLanded);
      }
    },

    gameOver(reason?: string) {
      console.log(`Game Over: ${reason ?? 'collision'}`);
      this.levelFailed();
    },

    planeLanded(_planeId: number, points: number) {
      this.planesLanded++;
      this.totalPlanes++;
      this.addScore(points);
    },

    planeCollision(_plane1Id: number, _plane2Id: number) {
      console.log('💥 Plane collision detected', _plane1Id, _plane2Id);
    },

    planeOffscreen(_planeId: number) {
      console.log('✈️ Plane went offscreen', _planeId);
      this.totalPlanes++;
      this.addScore(-50);
    },

    waypointPassed(_planeId: number, points: number) {
      this.waypointsPassed++;
      this.totalPlanes++;
      this.addScore(points);
    },

    addScore(points: number) {
      this.score = Math.max(0, this.score + points);
      if (this.score > this.highScore) {
        this.highScore = this.score;
        this.saveHighScore();
      }
    },

    /**
     * ✅ CHANGED: now persists level progress to Supabase after advancing
     */
    completeLevel() {
      this.status = 'complete';
      this.isPlaying = false;
      this.addScore(500);

      const levelId = this.currentLevelId ?? getLevelByNumber(this.currentLevel)?.id;
      const level = levelId ? getLevelById(levelId) : null;
      const isEndless = this.currentLevelId?.endsWith(':endless') ?? false;

      if (level && this.trainingLevel === null) {
        // One call for both shift kinds: a cleared shift records stars + the
        // completion chain, an endless run records only the best plane count
        // (it has no completion screen, so it must never advance the chain).
        if (isEndless) {
          progressService.recordCompletion(level.airportId, level.shiftId, this.planesLanded);
        } else {
          const earnedStars = calculateStars(level, this.score);
          progressService.recordCompletion(
            level.airportId,
            level.shiftId,
            this.planesLanded,
            earnedStars
          );
        }
      }

      const currentLevelId = this.currentLevelId ?? getLevelByNumber(this.currentLevel)?.id ?? null;
      const nextLevel = currentLevelId
        ? getNextLevelInAirport(currentLevelId) ?? getNextLevel(currentLevelId)
        : null;
      const canAdvance = isEndless
        ? false
        : this.trainingLevel !== null
        ? this.currentLevel < 6
        : this.currentLevel < this.maxLevel &&
          nextLevel !== null &&
          getLevelNumberById(nextLevel.id) !== null &&
          getLevelNumberById(nextLevel.id)! <= this.maxLevel;

      if (canAdvance && nextLevel) {
        this.currentLevel = getLevelNumberById(nextLevel.id)!;
        this.currentLevelId = nextLevel.id;
      }

      // Fire-and-forget: push the new best plane counts (and the completed
      // shift) to the server. A new value is only sent when it exceeds what the
      // server already holds; free players keep everything local.
      progressService.flush().catch((e) => console.warn('Progress flush failed (non-fatal):', e));
    },
    nextLevel() {
      if (this.currentLevelId?.endsWith(':endless')) return;

      if (this.trainingLevel !== null) {
        if (this.currentLevel < 6) {
          this.currentLevel++;
          this.currentLevelId = null;
          this.startGame();
        }
        return;
      }

      const currentLevelId = this.currentLevelId ?? getLevelByNumber(this.currentLevel)?.id ?? null;
      const nextLevel = currentLevelId ? getNextLevelInAirport(currentLevelId) : null;
      const nextLegacyLevel = currentLevelId ? getNextLevel(currentLevelId) : null;
      const resolvedNextLevel = nextLevel ?? nextLegacyLevel;
      if (!resolvedNextLevel) return;

      const nextLevelNumber = getLevelNumberById(resolvedNextLevel.id);
      if (nextLevelNumber === null || nextLevelNumber > this.maxLevel) return;

      this.currentLevel = nextLevelNumber;
      this.currentLevelId = resolvedNextLevel.id;
      this.startGame();
    },

    previousLevel() {
      if (this.currentLevelId?.endsWith(':endless')) return;

      const previousLevel = this.currentLevelId
        ? getPreviousLevelInAirport(this.currentLevelId)
        : null;
      const previousLevelNumber = previousLevel
        ? getLevelNumberById(previousLevel.id)
        : this.currentLevel > 1
        ? this.currentLevel - 1
        : null;
      if (previousLevelNumber === null) return;

      this.currentLevel = previousLevelNumber;
      this.currentLevelId = previousLevel?.id ?? null;
      this.startGame();
    },

    /**
     * ✅ CHANGED: enforce premium cap when setting level
     */
    setLevel(level: number) {
      if (this.currentLevelId && this.currentLevel !== level) {
        this.currentLevelId = null;
      }
      const cap = this.maxLevel;
      if (level >= 1 && level <= cap) {
        this.currentLevel = level;
      } else if (level > cap) {
        console.warn(`🔒 Level ${level} requires premium (max accessible: ${cap})`);
      }
    },

    setLevelId(levelId: string) {
      const levelNumber = getLevelNumberById(levelId);
      if (levelNumber === null) return;

      this.setLevel(levelNumber);
      if (this.currentLevel !== levelNumber) return;
      this.currentLevelId = levelId;
    },

    setTrainingLevel(level: number) {
      this.trainingLevel = level;
      this.currentLevel = level;
      this.currentLevelId = null;
    },

    clearTrainingMode() {
      this.trainingLevel = null;
    },

    incrementPlayTime() {
      if (this.status === 'playing') this.playTime++;
    },

    saveHighScore() {
      try {
        safeStorage.setItem('atc-app_high_score', this.highScore.toString());
      } catch (e) {
        console.error('Failed to save high score:', e);
      }
    },

    loadHighScore() {
      try {
        const saved = safeStorage.getItem('atc-app_high_score');
        if (saved) this.highScore = parseInt(saved, 10) || 0;
      } catch (e) {
        console.error('Failed to load high score:', e);
      }
    },

    resetStats() {
      this.planesLanded = 0;
      this.planesCollided = 0;
      this.waypointsPassed = 0;
      this.totalPlanes = 0;
      this.playTime = 0;
    },

    reset() {
      this.$reset();
      this.loadHighScore();
    },
  },
  // highScore is saved by saveHighScore()/loadHighScore(). skymess also had a
  // `persist` block here for pinia-plugin-persist, which was never installed.
});
