<template>
  <div
    v-for="(strip, i) in column"
    :key="strip.id + keySuffix + restartKey + i"
    ref="stripRefs"
    class="strip"
    :class="{
      visible: strip.isVisible,
      disabled: strip.isDisabled,
      blocked: strip?.type?.blocked,
      settled: isSettled(i),
      [`${strip?.type?.class}`]: strip?.type?.class,
      training: strip?.type?.isTraining,
      pressed: pressedIndex === i,
    }"
    :style="{
      width: stripWidth(i) + '%',
      // `--i` is bound HERE, inline, by `visualIndex(i)` — it is the ONLY place
      // `--i` is set now. The old `.center/.left/.right .strip:nth-child(n)`
      // rules in StripPage.vue are gone: they counted DOM children (including
      // invisible filler strips, so the visible queue got gaps) and stopped at
      // 14 (so a 15th strip fell back to 0 and animated first). Binding inline
      // makes any column length correct and keeps the visible queue contiguous.
      //
      // The value is the VISIBLE position (visualIndex), not the DOM child
      // index: columns carry invisible filler strips, and counting them made
      // the fall queue skip indices. See visualIndex() for the full rationale.
      '--i': visualIndex(i),
    }"
    @pointerdown="onPointerDown(strip, i, $event)"
    @pointerup="onPointerUp(strip, i, $event)"
    @pointercancel="onPointerCancel(i, $event)"
    @pointerleave="onPointerLeave(strip, i, $event)"
    @pointerover="onPointerOver(strip, i, $event)"
    @pointerout="onPointerOut(strip, i, $event)"
  >
    <img :src="strip.src" alt="" />
    <img
      v-if="strip?.isGrounded"
      class="grounded-icon"
      src="../../assets/icons/notamOutServiceIcon.png"
      alt=""
    />
    <img
      v-if="strip?.type?.blocked"
      class="blocked-icon"
      src="../../assets/icons/notamPassPrevUnlockIcon.png"
      alt=""
    />
    <div class="strip--content">
      <template v-if="strip?.id === 'airport' || strip?.id === 'shift' || strip?.id === 'training'">
        <span v-if="strip?.type?.icon1" :class="strip?.type?.icon1">
          <img :src="strip?.icon1" :alt="strip?.type?.icon1" />
        </span>
        <div
          class="strip--inner"
          :class="{ grounded: strip?.isGrounded, blocked: strip?.type?.blocked }"
        >
          <div class="strip--inner-left">
            <p class="strip--level">{{ strip.type?.iata || 'SHIFT' }}</p>
            <p class="strip--level-number">
              {{ strip?.type?.isTraining ? 'T' : '' }}{{ strip?.type?.number }}
            </p>
          </div>
          <div class="strip--inner-middle">
            <p v-if="strip?.type?.text" class="strip--text middle-text">
              {{ strip?.type?.text }}
              <img
                v-if="strip?.type?.isPremium"
                src="../../assets/icons/crownIcon.png"
                alt="crown"
              />
            </p>
          </div>
          <div class="strip--inner-right">
            <p v-if="strip?.type?.subtext" class="strip--text">
              <span
                v-for="(subtext, idx) in strip?.type?.subtext.split('/')"
                :key="subtext"
                class=""
                >{{ subtext }}
                {{ idx !== 1 && strip?.type?.subtext.split('/').length > 1 ? '// ' : '' }}</span
              >
            </p>
          </div>
        </div>
        <span v-if="strip?.type?.icon2" :class="strip?.type?.icon2">
          <img :src="strip?.icon2" :alt="strip?.type?.icon2" />
        </span>
      </template>
      <template v-else>
        <span v-if="strip?.type?.icon1" :class="strip?.type?.icon1">
          <img :src="strip?.icon1" :alt="strip?.type?.icon1" />
        </span>
        <p
          v-if="strip?.type?.text"
          class="strip--text"
          :class="{ 'relative-text': strip?.type?.text === 'Airfields' }"
        >
          {{ strip?.type?.text }}
          <span v-if="strip?.type?.text === 'Airfields'" class="strip--text-number">
            {{ strip?.type?.number }}
          </span>
        </p>
        <span v-if="strip?.type?.icon2" :class="strip?.type?.icon2">
          <img :src="strip?.icon2" :alt="strip?.type?.icon2" />
        </span>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { useStripDebug } from '@/composables/useStripDebug';
import {
  stripsAirportButtons,
  stripsButtons,
  stripsShiftButtons,
  stripsTrainingButtons,
} from '@/pagesData/strips';
import type { IStrip, IStripButtonType } from '@/pagesData/strips';

interface Props {
  column: IStrip[];
  isSettled: (i: number) => boolean;
  maxWidth: number;
  keySuffix: string;
  restartKey: number;
  handlers: Record<string, (strip: IStrip, i: number) => void>;
}

const props = withDefaults(defineProps<Props>(), {
  keySuffix: 'center',
  restartKey: 0,
  isSettled: () => false,
  handlers: () => ({}),
});

// `keySuffix` is the column identity ('center' | 'left' | 'right'); use it as
// the logger's column tag so a dump groups events by column.
const debug = useStripDebug(props.keySuffix as 'center' | 'left' | 'right');

const MIN_WIDTH = 70;
const stripRefs = ref<(HTMLElement | null)[]>([]);

// Pointer tracking replaces the old @click/@mouseleave pair. Pointer events are
// the ONE input that maps cleanly across mouse, touch AND stylus on every
// platform the app ships on (web, iOS Safari, Android Chrome, Electron, and
// the Capacitor WebView). Mouse `click` is synthesised only after a
// mouseup-within-a-button, which on a touch device never fires at all — so a
// touch-first strip page had no hover sound and no click. Pointer events give
// us a single down→up→leave lifecycle that works everywhere.
//
// The strip only fires its action on `pointerup` (not `pointerdown`): a
// pointerdown is the start of a press, not a commit. Firing on down would let
// a drag across strips trigger them, and would also fire before the strip has
// finished landing (see _wrapInteraction).
const pointerDownIndex = new Map<number, number>();

/**
 * Which strip is currently "up" — pressed on mouse/touch, hovered on desktop.
 *
 * This is what drives the pop-up lift on touch platforms. Desktop already
 * gets it for free from `:hover`, but `:hover` does not fire on a touch
 * screen: a finger press is not a hover, so the strip would never lift and
 * the player would get no press feedback at all. Toggling a class on the
 * pointer lifecycle gives touch the same affordance as mouse, from one rule
 * set (`:hover, .pressed` in the stylesheet).
 *
 * Only one strip is up at a time: a press on a second strip releases the
 * first, which mirrors how `:hover` can only sit on one element.
 */
const pressedIndex = ref<number | null>(null);

function onPointerDown(strip: IStrip, i: number, e?: PointerEvent) {
  e?.preventDefault();
  // console.log(
  //   `[strip:${props.keySuffix}] onPointerDown i=${i} event=pointerdown pointerType=${e?.pointerType} pointerId=${e?.pointerId}`
  // );
  pointerDownIndex.set(i, e?.pointerId ?? i);
  debug.pressStart(i, `pid=${e?.pointerId} type=${e?.pointerType}`);
  if (pressedIndex.value !== i) pressedIndex.value = i;
}

function onPointerUp(strip: IStrip, i: number, e?: PointerEvent) {
  // console.log(
  //   `[strip:${props.keySuffix}] onPointerUp i=${i} event=pointerup pointerType=${e?.pointerType} pointerId=${e?.pointerId} remainingDown=${pointerDownIndex.size}`
  // );
  pointerDownIndex.delete(i);
  debug.pressEnd(i, `pid=${e?.pointerId} type=${e?.pointerType}`);
  if (pressedIndex.value === i) pressedIndex.value = null;
  if (pointerDownIndex.size > 0) return; // a drag moved off this strip
  getStripClickHandler(strip)?.(strip, i);
}

function onPointerCancel(i: number, e?: PointerEvent) {
  // console.log(
  //   `[strip:${props.keySuffix}] onPointerCancel i=${i} event=pointercancel pointerType=${e?.pointerType} pointerId=${e?.pointerId} remainingDown=${pointerDownIndex.size}`
  // );
  pointerDownIndex.delete(i);
  debug.pressEnd(i, 'pointercancel');
  if (pressedIndex.value === i) pressedIndex.value = null;
}

function onPointerLeave(strip: IStrip, i: number, e?: PointerEvent) {
  // console.log(
  //   `[strip:${props.keySuffix}] onPointerLeave i=${i} event=pointerleave pointerType=${e?.pointerType} pointerId=${e?.pointerId} remainingDown=${pointerDownIndex.size}`
  // );
  // Any pointer still "pressed" on this strip is now a drag — drop it.
  pointerDownIndex.delete(i);
  debug.pressEnd(i, 'pointerleave');
  if (pressedIndex.value === i) pressedIndex.value = null;
  // Hover sound. Unwrapped: the default mouseLeave handler is playClick,
  // which already gates on isSettled, so it is safe to call directly.
  const button = resolveStripButton(strip);
  const handlerName = button?.mouseLeaveHandler;
  const handler = handlerName ? props.handlers[handlerName] : props.handlers.playClick;
  handler?.(strip, i);
}

function onPointerOver(_strip: IStrip, i: number, e?: PointerEvent) {
  debug.hoverStart(i, `pid=${e?.pointerId}`);
}

function onPointerOut(_strip: IStrip, i: number, e?: PointerEvent) {
  debug.hoverEnd(i, `pid=${e?.pointerId}`);
}

let _pollId: number | null = null;

function stripWidth(index: number): number {
  const n = props.column.length;
  if (n <= 1) return props.maxWidth;
  const t = index / (n - 1);
  return MIN_WIDTH + t * (props.maxWidth - MIN_WIDTH);
}

/**
 * Visual position of a strip: how many VISIBLE strips sit above it.
 *
 * `--i` drives the fall delay (`calc(var(--i) * 0.15s)`), the z-index and the
 * centre-column width, and it is bound from the DOM child index. Columns carry
 * invisible filler strips (see mainPage.ts: `strip('l2')` with no `isVisible`),
 * so the DOM child index alone would leave gaps in the stagger — the visible
 * queue must be counted, not the child list.
 *
 * Counting the visible strips STRICTLY above the current one gives:
 *  - visible strips a clean 0,1,2,3… visible position, regardless of fillers;
 *  - invisible strips the number of visible strips above them, which is
 *    non-negative and exactly the value their width/z-index should use (an
 *    invisible strip sits in the gap between two visible ones).
 *
 * The previous "at or above, minus one" formulation produced the same numbers
 * for visible strips but returned -1 for an invisible strip at the top of the
 * column — a negative `--i` that made `z-index: calc(var(--i) + 1)` = 0 and
 * shrank the strip's width to 63%.
 */
function visualIndex(i: number): number {
  // Count visible strips STRICTLY BEFORE this one. "At or above, minus one"
  // is the same number for visible strips but yields -1 for an invisible
  // strip at the top of the column — a negative --i that made
  // `z-index: calc(var(--i) + 1)` = 0 and shrank the strip. Counting only
  // the strips above keeps every value non-negative while still giving the
  // visible queue a clean 0,1,2,3... stagger.
  let n = 0;
  for (let k = 0; k < i; k++) {
    if (props.column[k]?.isVisible) n += 1;
  }
  return n;
}

function resolveStripButton(strip: IStrip): IStripButtonType | undefined {
  if (strip.id === 'airport') {
    return typeof strip.type === 'string' ? stripsAirportButtons[strip.type] : strip.type;
  }
  if (strip.id === 'shift') {
    return typeof strip.type === 'string' ? stripsShiftButtons[strip.type] : strip.type;
  }
  if (strip.id === 'training') {
    return typeof strip.type === 'string' ? stripsTrainingButtons[strip.type] : strip.type;
  }

  return typeof strip.type === 'string' ? stripsButtons[strip.type] : strip.type;
}

function getStripClickHandler(strip: IStrip): ((strip: IStrip, i: number) => void) | undefined {
  const button = resolveStripButton(strip);
  const handlerName = button?.handler;

  if (!handlerName) return undefined;
  return _wrapInteraction(props.handlers[handlerName]);
}

/**
 * Wraps a strip's interaction handler so taps, touches and keyboard activates
 * are ignored until the strip has finished landing.
 *
 * Why here and not inside the handler itself: the navigation handlers
 * (`handleAirport`, `playLevel`, `quickPlay` ...) are plain functions with no
 * knowledge of animation state, and every strip type shares the same gate. A
 * strip still "feels" clickable the instant it lands — the hover lift and the
 * click sound (playClick) keep working the moment the strip is down — so the
 * gate is a single `isSettled(i)` check, not a disabled class that would also
 * kill the hover affordance.
 */
function _wrapInteraction<T extends (strip: IStrip, i: number) => void>(
  raw: T | undefined
): ((strip: IStrip, i: number) => void) | undefined {
  if (!raw) return undefined;
  return (s, i) => {
    if (!props.isSettled(i)) {
      // The strip was pressed before its fall finished. The press is dropped,
      // not queued — a tap during the drop is an accidental grab, not intent.
      debug.gateBlocked(i, 'not settled');
      return;
    }
    debug.commit(i, 'action fired');
    raw(s, i);
  };
}

// Detect CSS animation completion. We try three approaches in order:
// 1. Native `animationend` event (most reliable when it fires)
// 2. Web Animations API `finished` promise (resolves at exact completion)
// 3. Computed-style polling (fallback when WAAPI is unavailable)
function _onAnimationFinished(el: HTMLElement, i: number) {
  if (props.isSettled(i)) return;
  // Single point that both logs and lands the strip. Every detector calls this
  // (never logs before calling it), so a strip's FALL_END appears exactly once
  // — the first detector to resolve. The gate above means the other two
  // detectors' calls are silent no-ops, which is what stops the strip's
  // `settled` class from flickering (the "sometimes a strip stays up" bug).
  debug.fallEnd(i, 'complete');
  props.handlers.onStripLanded?.(props.column[i], i);
}

function _bindAnimationFinished(el: HTMLElement, i: number) {
  // Approach 1: native animationend event
  el.addEventListener(
    'animationend',
    () => {
      _onAnimationFinished(el, i);
    },
    { once: true }
  );

  // Approach 2: WAAPI finished promise
  const animations = el.getAnimations();
  if (animations.length > 0) {
    Promise.all(animations.map((a) => a.finished))
      .then(() => {
        _onAnimationFinished(el, i);
      })
      .catch(() => {});
  }

  // Approach 3: computed-style polling fallback.
  // The strip starts at opacity:0 and animates to opacity:1 via stripFall.
  // We fire only when opacity reaches ~1 (animation complete), not when it
  // is still 0 (which would be a false positive at the very start).
  const start = performance.now();
  let pollId: number | null = null;
  const poll = () => {
    if (props.isSettled(i)) return;
    const opacity = parseFloat(getComputedStyle(el).opacity);
    const now = performance.now();
    // Only fire when opacity has settled near 1.0 (animation finished), not when it
    // is still 0 (which would be a false positive at the very start).
    if (opacity < 0.99 && now - start < 3000) {
      pollId = requestAnimationFrame(poll);
      return;
    }
    if (pollId !== null) {
      cancelAnimationFrame(pollId);
      pollId = null;
    }
    _onAnimationFinished(el, i);
  };
  pollId = requestAnimationFrame(poll);
}

function _pollAnimations() {
  stripRefs.value.forEach((el, i) => {
    if (!el || props.isSettled(i)) return;
    if (!el.classList.contains('visible')) return;

    // Bind once per strip; subsequent frames are no-ops.
    if (el.dataset._animBound !== '1') {
      el.dataset._animBound = '1';
      // The strip just became visible — this is the true start of its drop.
      // Two numbers matter here and they are NOT the same:
      //   `i`            = array index (has holes when some strips are hidden)
      //   `--i` (CSS var) = VISUAL position, 0 = topmost, set per :nth-child
      // The animation delay is `calc(var(--i) * 0.15s)`, so the topmost strip
      // (var(--i)=0) falls first. Logging `i` alone made the order look
      // inverted on pages with gaps, so log the visual position too.
      const delay = getComputedStyle(el).animationDelay || '0s';
      const visualPos = getComputedStyle(el).getPropertyValue('--i').trim();
      debug.fallStart(i, `visible pos=${visualPos} delay=${delay}`);
      _bindAnimationFinished(el, i);
    }
  });

  _pollId = requestAnimationFrame(_pollAnimations);
}

function clearPressed(e?: Event) {
  // console.log(
  //   `[strip:${props.keySuffix}] clearPressed event=${e?.type ?? 'unknown'} pressedIndex=${
  //     pressedIndex.value
  //   } remainingDown=${pointerDownIndex.size}`
  // );
  pressedIndex.value = null;
  pointerDownIndex.clear();
}

onMounted(() => {
  _pollId = requestAnimationFrame(_pollAnimations);
  document.addEventListener('pointerup', clearPressed);
  document.addEventListener('pointercancel', clearPressed);
  document.addEventListener('touchend', clearPressed);
  document.addEventListener('touchcancel', clearPressed);
});

onBeforeUnmount(() => {
  if (_pollId !== null) {
    cancelAnimationFrame(_pollId);
    _pollId = null;
  }
  document.removeEventListener('pointerup', clearPressed);
  document.removeEventListener('pointercancel', clearPressed);
  document.removeEventListener('touchend', clearPressed);
  document.removeEventListener('touchcancel', clearPressed);
});
</script>
