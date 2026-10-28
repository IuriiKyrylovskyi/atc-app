/**
 * packages/app/src/stores/userScores.ts
 *
 * Per-level server-synced state:
 *   - maxPlanes  — best plane count the user has landed on this level (non-decreasing)
 *   - opened     — true once the level has been opened by the user (set on first play)
 *   - available — true once the level is reachable via the tier unlock chain
 *
 * Data flow:
 *   1. On first launch (monetizationStore.init → this.init) the server is fetched.
 *   2. On level complete / app close the local best is UPSERTED — a new value is
 *      only sent when it is strictly greater than what the server already has.
 *   3. The local `maxPlanes` map is the merge of server + local bests, so a lower
 *      local value never overwrites a higher server value.
 */

import { defineStore } from 'pinia';
import { ref } from 'vue';
import { supabase } from '@/lib/supabase';
import { getLevelById } from '@/game/config/levels.config';
import { useMonetizationStore } from '@/stores/monetization';
import { NetworkTimeoutError } from '@/utils/fetchWithTimeout';
import { retryWithBackoff } from '@/utils/retryWithBackoff';

export interface UserScoreRow {
  level_id: string;
  max_planes: number;
  opened: boolean;
  available: boolean;
  updated_at: string;
}

export interface UserScoresState {
  rows: Record<string, UserScoreRow>;
  loaded: boolean;
  dirty: boolean;
}

function clampPlanes(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

function timeout<T>(ms: number): Promise<T> {
  return new Promise((_, reject) =>
    setTimeout(
      () => reject(new NetworkTimeoutError(`account_scores upsert timed out after ${ms}ms`)),
      ms
    )
  );
}

export const useUserScoresStore = defineStore('userScores', () => {
  const rows = ref<Record<string, UserScoreRow>>({});
  // Snapshot of the values the server last confirmed for each level.
  // A flush only sends a row when the local value exceeds (or newly sets)
  // the server value — a lower local run never overwrites a higher server best.
  const serverSnapshot = ref<Record<string, UserScoreRow>>({});
  const loaded = ref(false);
  const dirty = ref(false);

  /**
   * Per-level scores are a paid-user feature: only premium subscribers have
   * their `max_planes` / `opened` / `available` rows persisted to Supabase.
   * Free users keep a fully local state (still works for the current session,
   * but nothing is sent to or read from the server).
   */
  function isPremiumUser(): boolean {
    try {
      return useMonetizationStore().isPremium;
    } catch {
      return false;
    }
  }

  // ── Local merge helpers ──────────────────────────────────────────────────

  /** Best plane count for a level, preferring the server value. */
  function getMaxPlanes(levelId: string): number {
    return rows.value[levelId]?.max_planes ?? 0;
  }

  function isOpened(levelId: string): boolean {
    return rows.value[levelId]?.opened === true;
  }

  function isAvailable(levelId: string): boolean {
    return rows.value[levelId]?.available === true;
  }

  /** Merge a server row into local state (server wins on conflicts). */
  function mergeRow(row: UserScoreRow): void {
    const existing = rows.value[row.level_id];
    serverSnapshot.value[row.level_id] = { ...row };
    if (!existing) {
      rows.value[row.level_id] = { ...row };
      return;
    }
    rows.value[row.level_id] = {
      ...existing,
      ...row,
      max_planes: Math.max(existing.max_planes, row.max_planes),
      opened: existing.opened || row.opened,
      available: existing.available || row.available,
    };
  }

  /** Record a local result. `opened` is sticky — once true it stays true. */
  function recordResult(levelId: string, maxPlanes: number): void {
    if (!getLevelById(levelId)) return;

    const planes = clampPlanes(maxPlanes);
    const existing = rows.value[levelId];
    const next: UserScoreRow = {
      level_id: levelId,
      max_planes: Math.max(existing?.max_planes ?? 0, planes),
      opened: true,
      available: existing?.available ?? false,
      updated_at: new Date().toISOString(),
    };
    rows.value[levelId] = next;
    dirty.value = true;
  }

  /** Mark a level as available (tier-unlock chain reached it). */
  function markAvailable(levelId: string): void {
    if (!getLevelById(levelId)) return;
    const existing = rows.value[levelId];
    if (existing?.available) return;
    rows.value[levelId] = {
      level_id: levelId,
      max_planes: existing?.max_planes ?? 0,
      opened: existing?.opened ?? false,
      available: true,
      updated_at: new Date().toISOString(),
    };
    dirty.value = true;
  }

  // ── Account context ──────────────────────────────────────────────────────
  function getAccountId(): string | undefined {
    try {
      const monetization = useMonetizationStore();
      return monetization.accountId ?? undefined;
    } catch {
      return undefined;
    }
  }

  // ── Server sync ──────────────────────────────────────────────────────────
  // All server-touching methods are gated on premium status. Free users
  // keep a fully local state — nothing is read from or written to Supabase.

  async function loadFromServer(): Promise<void> {
    if (!isPremiumUser()) {
      loaded.value = true;
      return;
    }

    const accountId = getAccountId();
    if (!accountId) {
      loaded.value = true;
      return;
    }

    const { data, error } = await supabase
      .from('account_scores')
      .select('level_id, max_planes, opened, available, updated_at')
      .eq('account_id', accountId)
      .order('updated_at', { ascending: false });

    if (error) {
      console.warn('⚠️ Could not load account_scores:', error.message);
      return;
    }

    for (const row of (data ?? []) as UserScoreRow[]) {
      mergeRow(row);
    }
    loaded.value = true;
  }

  /** Upsert only the levels whose local value exceeds the server value. */
  async function flush(): Promise<void> {
    if (!loaded.value || !isPremiumUser()) return;

    const accountId = getAccountId();
    if (!accountId) return;

    // Only send rows where the local best is strictly greater than what the
    // server already holds, or where a new flag (opened/available) was set
    // after the last sync. A lower local run is silently dropped.
    const pending = Object.values(rows.value).filter((row) => {
      const snap = serverSnapshot.value[row.level_id];
      if (!snap) return true;
      return (
        row.max_planes > snap.max_planes ||
        row.opened !== snap.opened ||
        row.available !== snap.available
      );
    });

    if (pending.length === 0) return;

    const now = new Date().toISOString();
    const payload = pending.map((row) => ({
      account_id: accountId,
      level_id: row.level_id,
      max_planes: row.max_planes,
      opened: row.opened,
      available: row.available,
      updated_at: now,
    }));

    try {
      await retryWithBackoff(
        async () => {
          const { error: upsertError } = await Promise.race([
            supabase.from('account_scores').upsert(payload, { onConflict: 'account_id,level_id' }),
            timeout<{ error: any }>(10000),
          ]);
          if (upsertError) {
            // A real Supabase error is retryable; a timeout is also retryable.
            throw upsertError;
          }
        },
        { attempts: 3, baseMs: 1000, maxMs: 30000, label: 'scores.flush' }
      );
    } catch (err) {
      console.warn(
        '⚠️ Could not flush account_scores after 3 attempts (non-fatal, will retry on next close):',
        err
      );
      // Keep dirty.value = true so the next app-close / background flush tries again.
      return;
    }

    // Re-stamp the server snapshot so subsequent flushes are no-ops
    for (const row of payload) {
      serverSnapshot.value[row.level_id] = {
        level_id: row.level_id,
        max_planes: row.max_planes,
        opened: row.opened,
        available: row.available,
        updated_at: now,
      };
    }
    dirty.value = false;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  function reset(): void {
    rows.value = {};
    // Must be cleared too: a stale snapshot makes flush() skip rows for the
    // next account on this device ("local is not greater than server").
    serverSnapshot.value = {};
    loaded.value = false;
    dirty.value = false;
  }

  return {
    rows,
    loaded,
    dirty,
    getMaxPlanes,
    isOpened,
    isAvailable,
    recordResult,
    markAvailable,
    loadFromServer,
    flush,
    reset,
  };
});
