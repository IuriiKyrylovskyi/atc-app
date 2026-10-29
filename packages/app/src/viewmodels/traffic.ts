/**
 * Traffic summary view-model: the counters of the scope's status line.
 */
import type { Conflict } from '@atc-app/sim';
import type { Ownership } from '@atc-app/scope';

export interface TrafficSummaryVM {
  aircraft: number;
  /** In the active sector (every aircraft when no sector is active). */
  owned: number;
  /** Entering the active sector within the look-ahead. */
  incoming: number;
  /** Pairs in conflict alert. */
  conflicts: number;
}

export const EMPTY_TRAFFIC: TrafficSummaryVM = { aircraft: 0, owned: 0, incoming: 0, conflicts: 0 };

export function trafficSummary(
  tracks: readonly { ownership: Ownership }[],
  conflicts: readonly Conflict[]
): TrafficSummaryVM {
  return {
    aircraft: tracks.length,
    owned: tracks.filter((t) => t.ownership === 'owned').length,
    incoming: tracks.filter((t) => t.ownership === 'incoming').length,
    conflicts: conflicts.length,
  };
}
