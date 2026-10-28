/**
 * packages/app/src/composables/useStripDebug.ts
 *
 * Structured lifecycle logger for strip animations and interactions.
 *
 * What it records, per strip:
 *   1. index            — position in the column (0-based)
 *   2. fallStart        — when the strip begins its drop animation
 *   3. fallEnd          — when the drop animation completes (settled)
 *   4. pressStart       — pointerdown / touch / click begins
 *   5. pressEnd         — pointerup / pointercancel / pointerleave ends
 *   6. hoverStart       — pointerover (desktop hover, or touch enter)
 *   7. hoverEnd         — pointerout
 *   8. commit           — the strip's action actually fired (navigation etc.)
 *   9. gateBlocked      — a press was dropped because the strip hadn't settled
 *
 * Output: every event is pushed to `useDebugStore` (source `strip:<col>`),
 * which renders them in the on-screen GlobalDebugPanel — visible on web,
 * iOS, Android and Electron WITHOUT opening devtools. The store also mirrors
 * to console.log for browser debugging.
 *
 * The logger is a no-op in production builds — gated behind
 * `import.meta.env.DEV` so it never ships.
 */
import { useDebugStore } from '@/stores/debug';

type StripKind =
  | 'fallStart'
  | 'fallEnd'
  | 'pressStart'
  | 'pressEnd'
  | 'hoverStart'
  | 'hoverEnd'
  | 'commit'
  | 'gateBlocked';

const KIND_LABEL: Record<StripKind, string> = {
  fallStart: 'FALL_START',
  fallEnd: 'FALL_END',
  pressStart: 'PRESS_START',
  pressEnd: 'PRESS_END',
  hoverStart: 'HOVER_START',
  hoverEnd: 'HOVER_END',
  commit: 'COMMIT',
  gateBlocked: 'GATE_BLOCKED',
};

export function useStripDebug(col: 'center' | 'left' | 'right' = 'center') {
  function log(kind: StripKind, i: number, detail = '') {
    if (!import.meta.env.DEV) return;
    const store = useDebugStore();
    const label = KIND_LABEL[kind];
    const message = `strip[${col}] i=${i} ${label}${detail ? ' ' + detail : ''}`;
    store.addLog(`strip:${col}`, message, { kind, i, col, detail }, 'debug');
  }

  function fallStart(i: number, detail = '') { log('fallStart', i, detail); }
  function fallEnd(i: number, detail = '') { log('fallEnd', i, detail); }
  function pressStart(i: number, detail = '') { log('pressStart', i, detail); }
  function pressEnd(i: number, detail = '') { log('pressEnd', i, detail); }
  function hoverStart(i: number, detail = '') { log('hoverStart', i, detail); }
  function hoverEnd(i: number, detail = '') { log('hoverEnd', i, detail); }
  function commit(i: number, detail = '') { log('commit', i, detail); }
  function gateBlocked(i: number, detail = '') { log('gateBlocked', i, detail); }

  return {
    log,
    fallStart,
    fallEnd,
    pressStart,
    pressEnd,
    hoverStart,
    hoverEnd,
    commit,
    gateBlocked,
  };
}