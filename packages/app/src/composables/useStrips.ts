import { ref, computed, type ComputedRef } from 'vue';
import pagesData from '@/pagesData/pagesData';
import { stripsButtons } from '@/pagesData/strips';
import type { IStrip } from '@/pagesData/strips';
import clickSound from '@/assets/audio/click.wav';
import { useMonetizationStore } from '@/stores/monetization';

export type ColumnKey = 'column-center' | 'column-left' | 'column-right';

const MIN_WIDTH = 70;

// Hold the STORE, not its properties. Pinia unwraps refs on property access, so
// `store.isPremium` is a plain boolean — destructuring it captured that boolean
// once at module load and threw away the reactivity, and reading `.value` off
// the resulting boolean yielded `undefined`. pagesData() therefore always got
// `undefined` and every page rendered the free-user strips, which is why a
// premium player still saw "GO PRO" instead of "PREMIUM ACCOUNT". Reading
// `monetization.isPremium` inside the computed below keeps it live.
const monetization = useMonetizationStore();

// --- Web Audio API sound engine ---------------------------------------------
// Decodes click.wav once into an AudioBuffer, then spawns a fresh
// AudioBufferSourceNode per strip. This avoids the HTML5 Audio element's
// seek/restart latency and singleton contention when multiple strips land
// at once (e.g. center + left + right on the same tick).

let _audioCtx: AudioContext | null = null;
let _clickBuffer: AudioBuffer | null = null;
let _decodePromise: Promise<AudioBuffer | null> | null = null;

function getAudioContext(): AudioContext {
  if (!_audioCtx) {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    _audioCtx = new Ctx();
  }
  if (_audioCtx.state === 'suspended') {
    _audioCtx.resume().catch(() => {});
  }
  return _audioCtx;
}

async function ensureClickBuffer(): Promise<AudioBuffer | null> {
  if (_clickBuffer) return _clickBuffer;
  if (_decodePromise) return _decodePromise;

  _decodePromise = (async () => {
    try {
      const ctx = getAudioContext();
      const resp = await fetch(clickSound);
      const arr = await resp.arrayBuffer();
      _clickBuffer = await ctx.decodeAudioData(arr);
    } catch (e) {
      console.warn('[useStrips] failed to decode click sound, falling back to HTML5 Audio', e);
      _decodePromise = null;
    }
    return _clickBuffer;
  })();

  return _decodePromise;
}

export function unlockAudio() {
  // Resume the AudioContext on the first user gesture (required by the
  // browser autoplay policy, especially on mobile). Kick off decoding in
  // the background so the buffer is warm by the time strips start landing.
  getAudioContext();
  ensureClickBuffer();
}

// Pre-decode the click buffer eagerly (called from onMounted) so the first
// strip's sound doesn't pay a 40-50ms decode cost at playback time.
export function prewarmAudio() {
  getAudioContext();
  ensureClickBuffer();
}

/**
 * Which strip ids were visible in each column, carried across a page change.
 *
 * `settleAll()` marks strips as already-landed so that a strip-to-strip
 * navigation only re-drops the centre column; the side columns are meant to stay
 * where they are. That is only correct while the side columns hold the SAME
 * strips on every page. The right column no longer does: HOME is hidden on the
 * Home page, so on any other page it is a strip the player has never watched
 * land. Settling by index alone made it appear instantly, with no drop.
 *
 * So the decision is made per strip ID against the column the player is
 * leaving. Every reset rotates `pending` into `previous`, and `settleAll` is a
 * pure read of `previous`.
 */
const columnHistory = new Map<ColumnKey, { previous: Set<string>; pending: Set<string> }>();

export function useStrips(
  columnKey: ColumnKey,
  maxWidth: number,
  stripImages: Record<string, string>,
  stripIcons: Record<string, string>,
  pageName: ComputedRef<string>,
  screenType: ComputedRef<string>,
  screenRotation: ComputedRef<string>
) {
  const settled = ref(new Set<number>());
  const landingTimers = new Map<number, number>();

  const strips = computed(() => {
    const pages = pagesData(monetization.isPremium) as unknown as Record<string, Record<string, Record<string, Record<string, unknown>>>>;
    const page = pages[pageName.value]?.[screenType.value]?.[screenRotation.value];
    const column = page?.[columnKey];
    if (!Array.isArray(column)) return [];
    return column.map((strip: IStrip) => {
      const type = typeof strip.type === 'string' ? stripsButtons[strip.type] : strip.type;

      return {
        ...strip,
        src: stripImages[strip.src] ?? strip.src,
        icon1: type?.icon1 ? stripIcons[type.icon1] : undefined,
        icon2: type?.icon2 ? stripIcons[type.icon2] : undefined,
      };
    });
  });

  function playStripSound() {
    ensureClickBuffer()
      .then((buffer) => {
        if (!buffer || !_audioCtx) return;
        const src = _audioCtx.createBufferSource();
        src.buffer = buffer;
        const gain = _audioCtx.createGain();
        gain.gain.value = 0.08;
        src.connect(gain);
        gain.connect(_audioCtx.destination);
        src.start();
      })
      .catch(() => {});
  }

  const soundPlayed = new Set<number>();

  function playStripSoundOnce(i: number) {
    if (soundPlayed.has(i)) return;
    soundPlayed.add(i);
    playStripSound();
  }

  function playClick(i: number) {
    if (!settled.value.has(i)) return;
    playStripSound();
  }

  function onStripLanded(i: number) {
    if (settled.value.has(i)) return;
    settled.value.add(i);
    playStripSoundOnce(i);
  }

  function scheduleStripSound(i: number) {
    const delay = i * 150 + 600;
    const id = window.setTimeout(() => {
      // Play sound at expected landing time without side effects on `settled`.
      // Previously, calling onStripLanded here would mark the strip as settled
      // BEFORE the animation completed, causing CSS .settled { animation: none }
      // to cancel the fall animation mid-flight. On control-center pages with
      // many consecutive visible strips, the cascading timeouts created a wave
      // of settled-updates that cut animations short, producing a janky
      // "from top/bottom to center" visual instead of a smooth staggered fall.
      playStripSoundOnce(i);
      landingTimers.delete(i);
    }, delay);
    landingTimers.set(i, id);
  }

  function scheduleAll() {
    const history = columnHistory.get(columnKey) ?? {
      previous: new Set<string>(),
      pending: new Set<string>(),
    };
    // Rotate on EVERY reset, not only when settleAll runs: a page reached from
    // a non-strip screen never settles, so rotating inside settleAll would
    // leave `previous` empty and the first real strip-to-strip hop would drop
    // the side columns as well.
    history.previous = history.pending;
    history.pending = new Set(
      strips.value.filter((strip) => strip.isVisible).map((strip) => strip.id)
    );
    columnHistory.set(columnKey, history);

    strips.value.forEach((strip, i) => {
      if (strip.isVisible) scheduleStripSound(i);
    });
  }

  function reset() {
    landingTimers.forEach((id) => window.clearTimeout(id));
    landingTimers.clear();
    settled.value.clear();
    soundPlayed.clear();
    scheduleAll();
  }

  /**
   * Marks the strips that were already on screen in the column the player is
   * leaving, so they do not re-drop. Strips that are new to this column — HOME
   * arriving from a page that hid it — are deliberately left unsettled and fall
   * with the first render.
   */
  function settleAll() {
    const previous = columnHistory.get(columnKey)?.previous;

    // Nothing recorded on the way in: this is the first strip page of the
    // session, so every strip still owes the player its drop.
    if (!previous?.size) return;

    strips.value.forEach((strip, i) => {
      if (strip.isVisible && previous.has(strip.id)) settled.value.add(i);
    });
  }

  function isSettled(i: number) {
    return settled.value.has(i);
  }

  function stripWidth(index: number) {
    const n = strips.value.length;
    if (n <= 1) return maxWidth;
    const t = index / (n - 1);
    return MIN_WIDTH + t * (maxWidth - MIN_WIDTH);
  }

  return {
    strips,
    settled,
    landingTimers,
    scheduleStripSound,
    scheduleAll,
    reset,
    stripWidth,
    playClick,
    onStripLanded,
    isSettled,
    settleAll,
    unlockAudio,
    prewarmAudio,
  };
}
