import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { safeStorage } from '@/lib/safeStorage';
import { AIRPORTS, LEGACY_LEVEL_MAP, migrateLegacyProgress } from '@/game/config/airports.config';
import {
  SHIFTS,
  type Progress,
  isEndlessUnlocked as isEndlessUnlockedFromProgress,
  isShiftUnlocked as isShiftUnlockedFromProgress,
} from '@/game/config/level.structure';
import { getLevelByNumber, getLevelById, LEVELS } from '@/game/config/levels.config';

export const SHIFT_PROGRESS_STORAGE_KEY = 'atc-app_shift_progress_v1';
const LEGACY_GAME_STORAGE_KEY = 'atc-app_game';
const MAX_STARS = 3;

export interface ShiftProgressState extends Progress {
  version: 1;
}

interface LegacyGameSave {
  currentLevel?: unknown;
  stars?: unknown;
  cleared?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clampStars(stars: unknown): number | null {
  if (typeof stars !== 'number' || !Number.isFinite(stars)) return null;
  return Math.min(MAX_STARS, Math.max(0, Math.trunc(stars)));
}

function normalizeLegacyStars(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};

  const records: Record<string, number> = {};
  for (const [levelId, record] of Object.entries(value)) {
    const stars = clampStars(record);
    if (stars !== null && (LEGACY_LEVEL_MAP[levelId] || getLevelById(levelId))) {
      records[levelId] = stars;
    }
  }
  return records;
}

function normalizeLegacyCleared(value: unknown): Record<string, boolean> {
  if (!isRecord(value)) return {};

  const records: Record<string, boolean> = {};
  for (const [levelId, record] of Object.entries(value)) {
    if (record === true && (LEGACY_LEVEL_MAP[levelId] || getLevelById(levelId))) {
      records[levelId] = true;
    }
  }
  return records;
}

function normalizeRecords(
  value: unknown,
  keyType: 'stars' | 'cleared'
): Record<string, number | boolean> {
  if (!isRecord(value)) return {};

  const records: Record<string, number | boolean> = {};
  for (const [levelId, record] of Object.entries(value)) {
    if (!getLevelById(levelId)) continue;

    if (keyType === 'stars') {
      const stars = clampStars(record);
      if (stars !== null) records[levelId] = stars;
    } else if (typeof record === 'boolean') {
      records[levelId] = record;
    }
  }
  return records;
}

function parseLegacyGameSave(): LegacyGameSave | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = safeStorage.getItem(LEGACY_GAME_STORAGE_KEY);
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    const state = isRecord(parsed.state) ? parsed.state : parsed;
    return {
      currentLevel: state.currentLevel,
      stars: state.stars,
      cleared: state.cleared,
    };
  } catch {
    return null;
  }
}

function mergeRecords(
  target: Record<string, number | boolean>,
  source: Record<string, number | boolean>,
  keyType: 'stars' | 'cleared'
): void {
  for (const [levelId, value] of Object.entries(source)) {
    const current = target[levelId];
    if (keyType === 'stars') {
      const next = clampStars(value);
      if (next !== null) {
        target[levelId] = Math.max(clampStars(current) ?? 0, next);
      }
    } else if (value === true) {
      target[levelId] = true;
    }
  }
}

function migrateLegacyGameSave(): ShiftProgressState {
  const legacy = parseLegacyGameSave();
  const stars: Record<string, number> = {};
  const cleared: Record<string, boolean> = {};

  if (legacy?.stars) {
    const migrated = migrateLegacyProgress(normalizeLegacyStars(legacy.stars));
    mergeRecords(stars, migrated.stars, 'stars');
    for (const [levelId, levelStars] of Object.entries(migrated.stars)) {
      if (levelStars > 0) cleared[levelId] = true;
    }
  }

  if (legacy?.cleared) {
    mergeRecords(cleared, normalizeRecords(legacy.cleared, 'cleared'), 'cleared');
  }

  const currentLevel = Number(legacy?.currentLevel);
  if (Number.isInteger(currentLevel) && currentLevel > 1) {
    const legacyLevelsToMigrate = Math.min(currentLevel - 1, 6);
    for (let level = 1; level <= legacyLevelsToMigrate; level++) {
      const mappedLevelId = LEGACY_LEVEL_MAP[`level${level}`];
      if (mappedLevelId) {
        stars[mappedLevelId] = MAX_STARS;
        cleared[mappedLevelId] = true;
      }
    }

    for (let level = 7; level < currentLevel; level++) {
      const levelConfig = getLevelByNumber(level);
      if (!levelConfig) continue;
      stars[levelConfig.id] = Math.max(stars[levelConfig.id] ?? 0, MAX_STARS);
      cleared[levelConfig.id] = true;
    }
  }

  return { version: 1, stars, cleared };
}

function loadProgress(): ShiftProgressState {
  if (typeof window !== 'undefined') {
    try {
      const raw = safeStorage.getItem(SHIFT_PROGRESS_STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (isRecord(parsed)) {
          const stars = normalizeRecords(parsed.stars, 'stars') as Record<string, number>;
          const cleared = normalizeRecords(parsed.cleared, 'cleared') as Record<string, boolean>;
          if (parsed.version === 1) {
            return { version: 1, stars, cleared };
          }
          if (Object.keys(stars).length > 0 || Object.keys(cleared).length > 0) {
            return { version: 1, stars, cleared };
          }
        }
      }
    } catch {
      // Fall through to legacy migration.
    }
  }

  const migrated = migrateLegacyGameSave();
  persistProgress(migrated);
  return migrated;
}

function persistProgress(state: ShiftProgressState): void {
  try {
    safeStorage.setItem(SHIFT_PROGRESS_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Non-fatal: progress stays in memory for this session.
  }
}

export const useShiftProgressStore = defineStore('shiftProgress', () => {
  const initial = loadProgress();
  const stars = ref<Record<string, number>>({ ...initial.stars });
  const cleared = ref<Record<string, boolean>>({ ...initial.cleared });

  const progress = computed<Progress>(() => ({
    stars: { ...stars.value },
    cleared: { ...cleared.value },
  }));

  function save(): void {
    persistProgress({ version: 1, stars: stars.value, cleared: cleared.value });
  }

  function recordResult(levelId: string, starsEarned: number): void {
    const level = getLevelById(levelId);
    if (!level || level.shiftId === 'endless') return;

    const nextStars = clampStars(starsEarned) ?? 0;
    stars.value = {
      ...stars.value,
      [levelId]: Math.max(stars.value[levelId] ?? 0, nextStars),
    };
    cleared.value = {
      ...cleared.value,
      [levelId]: true,
    };
    save();
  }

  function getStars(levelId: string): number {
    return stars.value[levelId] ?? 0;
  }

  function isCleared(levelId: string): boolean {
    return cleared.value[levelId] === true;
  }

  function getAirportProgress(airportId: string): Progress {
    const prefix = `${airportId}:`;
    const airportStars: Record<string, number> = {};
    const airportCleared: Record<string, boolean> = {};

    for (const level of LEVELS) {
      if (level.airportId !== airportId || !level.id.startsWith(prefix)) continue;
      airportStars[level.id] = stars.value[level.id] ?? 0;
      airportCleared[level.id] = cleared.value[level.id] === true;
    }

    return { stars: airportStars, cleared: airportCleared };
  }

  function isShiftUnlocked(airportId: string, shiftId: string): boolean {
    const airport = AIRPORTS.find((candidate) => candidate.id === airportId);
    const shift = SHIFTS.find((candidate) => candidate.id === shiftId);
    if (!airport || !shift || shift.id === 'endless') return false;

    return isShiftUnlockedFromProgress(airport, shift, progress.value);
  }

  function isEndlessUnlocked(airportId: string): boolean {
    const airport = AIRPORTS.find((candidate) => candidate.id === airportId);
    if (!airport) return false;

    return isEndlessUnlockedFromProgress(airport, progress.value);
  }

  function reset(): void {
    stars.value = {};
    cleared.value = {};
    save();
  }

  return {
    stars,
    cleared,
    progress,
    recordResult,
    getStars,
    isCleared,
    getAirportProgress,
    isShiftUnlocked,
    isEndlessUnlocked,
    reset,
  };
});
