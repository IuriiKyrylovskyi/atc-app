<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useDevice } from '@/composables/useDevice';
import { useStrips } from '@/composables/useStrips';
import { useAppClose } from '@/composables/useAppClose';
import StripColumn from '@/components/strips/StripColumn.vue';
import type { ColumnKey } from '@/composables/useStrips';
import type { IStrip } from '@/pagesData/strips';
import { gameEventBus } from '@/services/EventBus';
import { getAirportByIcao, getAirportById } from '@/game/config/airports.config';
import { useMonetizationStore } from '@/stores/monetization';
import { useGameStore } from '@/stores/game';
import { useStripPageTransition } from '@/composables/useStripPageTransition';
import Paywall from '@/components/monetization/Paywall.vue';

import stripRed from '@/assets/strips/strip-red.png';
import stripYellow from '@/assets/strips/strip-yellow.png';
import stripGreen from '@/assets/strips/strip-green.png';
import stripBlue from '@/assets/strips/strip-blue.png';
import stripPink from '@/assets/strips/strip-pink.png';
import headsetsIcon from '@/assets/icons/headsetsIcon.png';
import radarIcon from '@/assets/icons/radarIcon.png';
import startIcon from '@/assets/icons/startIcon.png';
import settingsIcon2 from '@/assets/icons/settingsIcon2.png';
import settingsIcon from '@/assets/icons/settingsIcon.png';
import fullAccessTextIcon from '@/assets/icons/fullAccessTextIcon.png';
import crownIcon from '@/assets/icons/crownIcon.png';
import backIcon from '@/assets/icons/backIcon.png';
import hatIcon from '@/assets/icons/hatIcon.png';
import exitIcon from '@/assets/icons/exitIcon.png';
import logOffIcon from '@/assets/icons/logOffIcon.png';
import towerIcon from '@/assets/icons/towerIcon.png';
import bookIcon from '@/assets/icons/bookIcon.png';
import cloudIcon from '@/assets/icons/cloudIcon.png';
import planeUpIcon from '@/assets/icons/planeUpIcon.png';
// import twoIcon from '@/assets/icons/twoIcon.png';
import stripContentIcon6 from '@/assets/icons/stripContentIcon6.webp';
import stripContentIcon7 from '@/assets/icons/stripContentIcon7.webp';
import stripContentIcon8 from '@/assets/icons/stripContentIcon8.webp';
import stripContentIcon9 from '@/assets/icons/stripContentIcon9.webp';

const stripImages: Record<string, string> = {
  stripRed,
  stripYellow,
  stripGreen,
  stripBlue,
  stripPink,
};

const stripIcons: Record<string, string> = {
  headsetsIcon,
  radarIcon,
  startIcon,
  crownIcon,
  fullAccessTextIcon,
  settingsIcon,
  settingsIcon2,
  backIcon,
  hatIcon,
  exitIcon,
  logOffIcon,
  towerIcon,
  bookIcon,
  cloudIcon,
  planeUpIcon,
  // twoIcon,
  stripContentIcon6,
  stripContentIcon7,
  stripContentIcon8,
  stripContentIcon9,
};

interface Props {
  pageKey: string;
  handlers: Record<string, (strip: IStrip, i: number) => void>;
}

const props = withDefaults(defineProps<Props>(), {
  handlers: () => ({}),
});

const router = useRouter();
const route = useRoute();
const gameStore = useGameStore();
const monetizationStore = useMonetizationStore();
const showPaywall = ref(false);
// `?paywall=restore` (sent by "Switch to another account") opens the paywall at
// the restore form; `?paywall=open` (sent by the router for a locked level or
// route) opens it as is. The query is dropped right away so Back or a reload
// does not reopen it.
const paywallFocus = ref<'restore' | null>(null);
watch(
  () => route.query.paywall,
  (value) => {
    if (value !== 'restore' && value !== 'open') return;
    paywallFocus.value = value === 'restore' ? 'restore' : null;
    showPaywall.value = true;
    const rest = { ...route.query };
    delete rest.paywall;
    delete rest.lockedLevel;
    void router.replace({ query: rest });
  },
  { immediate: true }
);
const closePaywall = () => {
  showPaywall.value = false;
  paywallFocus.value = null;
};
const { screenType, screenRotation } = useDevice();
const { fromStripPage, setFromStripPage } = useStripPageTransition();
const { requestClose } = useAppClose();

const maxWidth = computed(() => (screenRotation.value === 'landscape' ? 98 : 102));
const MAX_LEFT_WIDTH = 95;
const MAX_RIGHT_WIDTH = 89;

const centerStrips = useStrips(
  'column-center' as ColumnKey,
  maxWidth.value,
  stripImages,
  stripIcons,
  computed(() => props.pageKey),
  screenType,
  screenRotation
);
const leftStrips = useStrips(
  'column-left' as ColumnKey,
  MAX_LEFT_WIDTH,
  stripImages,
  stripIcons,
  computed(() => props.pageKey),
  screenType,
  screenRotation
);
const rightStrips = useStrips(
  'column-right' as ColumnKey,
  MAX_RIGHT_WIDTH,
  stripImages,
  stripIcons,
  computed(() => props.pageKey),
  screenType,
  screenRotation
);

const showInitClip = ref(true);
const restartKey = ref(0);

const leftColumn = computed(() => leftStrips.strips.value);
const centerColumn = computed(() => centerStrips.strips.value);
const rightColumn = computed(() => rightStrips.strips.value);

/**
 * How long the init clip stays on.
 *
 * While `showInitClip` is true the centre column is lifted above the side
 * columns and its `clip-path` is dropped, so the first-render drop is not cut
 * by the column mask. The clip has to outlive the drop, otherwise the column
 * falls back behind the side columns (and gets clipped again) while the last
 * strips are still in the air.
 *
 * The fall is `stripFall 0.6s` with a per-strip delay of
 * `calc(var(--i) * 0.15s)`, and `--i` is the VISUAL index of a strip among
 * the visible ones (see StripColumn's visualIndex()), so the last visible
 * strip lands at `(visibleCount - 1) * 150 + 600` ms. The 600ms floor covers
 * a column with a single (or no) visible strip.
 */
const initMs = computed(() => {
  const visibleCount = centerStrips.strips.value.filter(
    (s: IStrip & { visible?: boolean }) => s.visible !== false && s.isVisible !== false
  ).length;
  return Math.max(600, (visibleCount - 1) * 150 + 600);
});

let initTimer: number | undefined;

const handleFirstInteraction = () => {
  centerStrips.unlockAudio();
  leftStrips.unlockAudio();
  rightStrips.unlockAudio();
  document.removeEventListener('click', handleFirstInteraction);
  document.removeEventListener('touchstart', handleFirstInteraction);
  document.removeEventListener('keydown', handleFirstInteraction);
};

/**
 * Run the strip-drop sequence.
 *
 * `reset()` clears the previous page's landing timers and `settled` flags and
 * re-arms the sounds, which is what makes the drop replay.
 *
 * `fromStripPage` means we arrived from another strip page: the side columns
 * are already landed and only the centre column drops. `settled` is the class
 * that switches the fall animation off, so the sides must be marked settled.
 */
function startStrips(fromStrip: boolean): void {
  centerStrips.reset();
  leftStrips.reset();
  rightStrips.reset();

  if (fromStrip) {
    leftStrips.settleAll();
    rightStrips.settleAll();
  }

  setFromStripPage(false);
}

onMounted(() => {
  document.addEventListener('click', handleFirstInteraction);
  document.addEventListener('touchstart', handleFirstInteraction);
  document.addEventListener('keydown', handleFirstInteraction);

  // Pre-decode the click buffer eagerly so it's ready before strips start
  // falling. Without this, the first few clicks pay a 40-50ms decode cost.
  centerStrips.prewarmAudio();
  leftStrips.prewarmAudio();
  rightStrips.prewarmAudio();

  startStrips(fromStripPage.value);

  if (initTimer !== undefined) {
    window.clearTimeout(initTimer);
  }
  initTimer = window.setTimeout(() => {
    showInitClip.value = false;
  }, initMs.value);
});

/**
 * Re-run the drop when the strip page changes.
 *
 * "More Pro Levels ->" pushes the next Control Center page on the SAME route
 * with a different param, so Vue Router reuses this component instead of
 * remounting it: onMounted never runs again, and the new page's strips render
 * carrying the previous page's `settled` flags — which is exactly the class
 * that disables the fall animation, so the page appeared frozen.
 *
 * Every other StripPage consumer passes a static page-key, so this only fires
 * for real page changes.
 */
watch(
  () => props.pageKey,
  () => {
    // Bumping the key destroys and recreates the strip elements, which is what
    // makes the CSS fall animation replay rather than resume its finished state.
    restartKey.value++;
    startStrips(fromStripPage.value);
    showInitClip.value = true;
    if (initTimer !== undefined) {
      window.clearTimeout(initTimer);
    }
    initTimer = window.setTimeout(() => {
      showInitClip.value = false;
    }, initMs.value);
  }
);

watch(
  screenRotation,
  (newVal, oldVal) => {
    console.log('StripPage screenRotation watcher', oldVal, '->', newVal);
    startStrips(false);
    restartKey.value++;
    showInitClip.value = true;
    if (initTimer !== undefined) {
      window.clearTimeout(initTimer);
    }
    initTimer = window.setTimeout(() => {
      showInitClip.value = false;
    }, initMs.value);
  },
  { immediate: true }
);

onUnmounted(() => {
  if (initTimer !== undefined) {
    window.clearTimeout(initTimer);
  }
  document.removeEventListener('click', handleFirstInteraction);
  document.removeEventListener('touchstart', handleFirstInteraction);
  document.removeEventListener('keydown', handleFirstInteraction);
});

const handleAirport = (strip: IStrip, _i: number) => {
  console.log('<<<__handleAirport__strip___', strip);

  void _i;
  // Gated on the monetization store, not the legacy purchase store: strip
  // VISIBILITY is driven by `monetizationStore.isPremium` (see stripGoPro), so
  // gating on a second source of truth lets a premium player tap a paid strip
  // and be shown the paywall for something they already own.
  if (strip.type?.isPremium && !monetizationStore.isPremium) {
    showPaywall.value = true;
    return;
  }

  const text = strip.type?.text ?? '';
  const airport = getAirportByIcao(text) ?? getAirportById(text.toLowerCase());
  if (airport) {
    router.push({ name: 'AirportShifts', params: { airportId: airport.id } });
  }
};

const playLevel = (strip: IStrip, _i: number) => {
  void _i;
  if (strip.type?.isPremium && !monetizationStore.isPremium) {
    showPaywall.value = true;
    return;
  }
  const levelNumber = strip.type?.levelNumber;
  if (!levelNumber) return;
  gameStore.setLevel(levelNumber);
  gameEventBus.emit('game:init', { levelId: levelNumber });
  router.push('/play');
};

const playTrainingLevel = (strip: IStrip, _i: number) => {
  if (strip.isGrounded) return;

  void _i;
  const level = Number(strip.type?.levelNumber);
  if (!level || level < 1) return;
  gameStore.setTrainingLevel(level);
  router.push(`/train/${level}`);
};

const exitPlay = () => void requestClose();

/**
 * The blue HOME strip below EXIT. Treated as an escape to the top-level hub,
 * like goBack, so it REPLACES rather than pushes: pushing would leave the page
 * the player just abandoned in the history stack and the very next BACK would
 * walk them straight back into it. A no-op on Home avoids a duplicate /home
 * entry. The strip is hidden on the Home page itself, so this guard is a
 * belt-and-braces check rather than the usual path.
 */
const goHome = () => {
  if (router.currentRoute.value.name === 'home') return;
  void router.replace({ name: 'home' });
};

// A BACK must never land on a splash or a game: from there the player is either
// dumped on the boot screen or dropped straight back into a fullscreen canvas
// they had already left. The route-name check has to be a pattern, not a list,
// because `Training Play` only carries "Play" in its NAME (its path is
// /train/:levelId) and `Play` is immediately replaced into `Gameplay` by
// GameContainer — so `Gameplay` is the name that persists in history.
const isBlockedBackTarget = (path: string) => {
  const { name, matched } = router.resolve(path);
  // Match the record PATTERNS, never `route.path`: `path` has the parameters
  // substituted in, so an id containing "play" would block BACK from a page that
  // has nothing to do with games. The router guard matches the same way.
  const record = matched.map((r) => r.path).join(' ');
  // No matched record at all is blocked too: landing there renders an empty
  // router-view, which is a blank screen rather than a destination.
  return !matched.length || name === 'Intro' || /play/i.test(`${String(name ?? '')} ${record}`);
};

const goBack = () => {
  // vue-router writes the path it is leaving into the history state on every
  // push and preserves it across replace, so this is the entry BACK would
  // actually reach. It is null on the first entry, where BACK currently does
  // nothing at all and leaves the player on a dead strip.
  const back = window.history.state?.back as string | null | undefined;

  if (!back || isBlockedBackTarget(back)) {
    // replace, not push: pushing would leave this page in the stack for the
    // next BACK to walk back into.
    void router.replace({ name: 'home' });
    return;
  }
  router.back();
};

const onGoPro = () => {
  showPaywall.value = true;
};

// The Premium account page is not part of atc-app; the paywall shows a premium
// player their credentials and restore options.
const onPremiumAccount = () => {
  showPaywall.value = true;
};

const centerHandlers = computed(() => ({
  ...props.handlers,
  handleAirport,
  playLevel: props.handlers.playLevel ?? playLevel,
  playTrainingLevel: props.handlers.playTrainingLevel ?? playTrainingLevel,
  onGoPro,
  onPremiumAccount,
  onStripLanded: (strip: IStrip, i: number) => centerStrips.onStripLanded(i),
  playClick: (strip: IStrip, i: number) => centerStrips.playClick(i),
}));

const leftHandlers = computed(() => ({
  ...props.handlers,
  goBack,
  onGoPro,
  onPremiumAccount,
  onStripLanded: (strip: IStrip, i: number) => leftStrips.onStripLanded(i),
  playClick: (strip: IStrip, i: number) => leftStrips.playClick(i),
}));

const rightHandlers = computed(() => ({
  ...props.handlers,
  exitPlay,
  goHome,
  onGoPro,
  onPremiumAccount,
  onStripLanded: (strip: IStrip, i: number) => rightStrips.onStripLanded(i),
  playClick: (strip: IStrip, i: number) => rightStrips.playClick(i),
}));
</script>

<template>
  <div class="wrap">
    <div class="inner">
      <img class="main-bg" src="../../assets/page-bg/bg.webp" alt="bg" />
      <img class="main-bg--papers" src="../../assets/icons/text-sheet.png" alt="paper" />
      <img class="main-bg--pencil" src="../../assets/page-bg/pencilIcon.png" alt="pencil" />

      <div class="column left">
        <StripColumn
          :key="`left-${screenRotation}-${screenType}-${restartKey}`"
          :column="leftColumn"
          :is-settled="leftStrips.isSettled"
          :max-width="MAX_LEFT_WIDTH"
          :key-suffix="`left-${screenRotation}-${screenType}`"
          :restart-key="restartKey"
          :handlers="leftHandlers"
        />
      </div>
      <div :key="props.pageKey" class="column center" :class="{ init: showInitClip }">
        <StripColumn
          :key="`center-${screenRotation}-${screenType}-${restartKey}`"
          :column="centerColumn"
          :is-settled="centerStrips.isSettled"
          :max-width="maxWidth"
          :key-suffix="`center-${screenRotation}-${screenType}`"
          :restart-key="restartKey"
          :handlers="centerHandlers"
        />
      </div>
      <div class="column right">
        <StripColumn
          :key="`right-${screenRotation}-${screenType}-${restartKey}`"
          :column="rightColumn"
          :is-settled="rightStrips.isSettled"
          :max-width="MAX_RIGHT_WIDTH"
          :key-suffix="`right-${screenRotation}-${screenType}`"
          :restart-key="restartKey"
          :handlers="rightHandlers"
        />
      </div>
    </div>
  </div>

  <Paywall
    :visible="showPaywall"
    :focus="paywallFocus"
    @close="closePaywall"
    @purchased="closePaywall"
  />
</template>

<style lang="less">
.wrap {
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background-color: #000;
}

.inner {
  --img-w: 5172;
  --img-h: 3072;
  --ratio: calc(var(--img-w) / var(--img-h));

  position: absolute;
  top: 50%;
  left: 50%;
  width: max(100vw, calc(100vh * var(--ratio)));
  height: max(100vh, calc(100vw / var(--ratio)));
  transform: translate(-50%, -50%);

  display: flex;
  justify-content: center;
  align-items: stretch;

  background-color: rgb(228 219 200);
}

.main-bg {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: block;
  pointer-events: none;

  &--papers {
    position: absolute;
    bottom: 17%;
    right: 4.5%;
    width: 15%;
    height: 32%;
    display: block;
    pointer-events: none;
    transform: skew(11.5deg, 0deg);
    transform-origin: 50% 100%;
  }
  &--pencil {
    position: absolute;
    bottom: 17%;
    right: 6.5%;
    width: 10%;
    display: block;
    pointer-events: none;
  }
}

.inner .column {
  position: relative;
  z-index: 1;
  flex: 1;
  pointer-events: auto;

  &:hover {
    z-index: 10;
  }
}

.column.init {
  pointer-events: none;
}

.strip {
  display: flex;
  justify-content: center;
  align-items: center;

  aspect-ratio: 620 / 118;

  margin-top: -3%;

  opacity: 0;
  visibility: hidden;

  position: relative;

  // Pointer-friendly defaults. `manipulation` tells the browser this element
  // is a tap target (no double-tap-to-zoom, no 300ms delay) on every mobile
  // browser; `pointer` is the cross-platform cursor for the same reason.
  touch-action: manipulation;
  cursor: pointer;

  &.title {
    & .cloudIcon {
      position: absolute;
      top: 14%;
      left: 7%;
      width: 20cqw;
      height: 10cqw;
      transform: rotateX(8deg);
      transform-origin: 50% 100%;
    }
    & .planeUpIcon {
      position: absolute;
      top: 14%;
      right: 7%;
      width: 20cqw;
      height: 10cqw;
      transform: rotateX(8deg);
      transform-origin: 50% 100%;
    }
    & .headsetsIcon {
      position: absolute;
      top: 14%;
      left: 6%;
      width: 10cqw;
      height: 10cqw;
      transform: rotateX(4deg);
      transform-origin: 50% 100%;
    }
    & .towerIcon {
      position: absolute;
      top: 14%;
      right: 6%;
      width: 8cqw;
      height: 10cqw;
      transform: rotateX(14deg);
      transform-origin: 50% 100%;
    }
  }

  &.subtitle {
    p {
      font-size: 6cqw;
      font-weight: 500;
      height: 11cqw;
      text-decoration: underline;

      display: flex;
      align-items: center;
      justify-content: center;
    }

    // icons
    .towerIcon {
      position: absolute;
      top: 14%;
      left: 6%;
      width: 8cqw;
      height: 10cqw;
      transform: rotateX(14deg);
      transform-origin: 50% 100%;
    }
    .headsetsIcon {
      position: absolute;
      top: 18%;
      right: 6%;
      width: 10cqw;
      height: 10cqw;
      transform: rotateX(4deg);
      transform-origin: 50% 100%;
    }
    .planeUpIcon {
      position: absolute;
      top: 14%;
      right: 7%;
      width: 20cqw;
      height: 10cqw;
      transform: rotateX(8deg);
      transform-origin: 50% 100%;
    }
  }
  &.shift-subtitle {
    & .strip--content {
      height: 76%;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    & .strip--text {
      font-size: 5.2cqw;
      line-height: 1;
    }
  }
  &.shift-subtext {
    & .strip--content {
      height: 76%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    & .strip--text {
      font-size: 4.2cqw;
      line-height: 1;
    }
  }
  &.back {
    p {
      display: inline-block;
      padding: 0 2%;
      background-color: rgb(230 108 96);
      border-left: 1cqw solid rgb(144 54 54);
      border-right: 1cqw solid rgb(144 54 54);
      color: rgb(255 222 209);
      transform: rotateX(6deg);

      position: absolute;
      right: 1.5%;
      top: 15%;

      line-height: 1.53;
    }

    // icons
    & .backIcon {
      position: absolute;
      top: 15%;
      right: 28%;
      width: 16cqw;
      height: 10cqw;
      transform: rotateX(8deg);
      transform-origin: 50% 100%;
    }
  }
  &.exit,
  &.home {
    p {
      display: inline-block;
      padding: 0 2%;
      background-color: rgb(230 225 126);
      border-right: 1cqw solid rgb(144 54 54);
      border-left: 1cqw solid rgb(144 54 54);
      color: rgb(132 114 42);
      transform: rotateX(6deg);

      position: absolute;
      left: 1.2%;
      top: 13%;

      line-height: 1.5;
    }

    // icons
    & .exitIcon {
      position: absolute;
      top: 14%;
      left: 22%;
      width: 14cqw;
      height: 10cqw;
      transform: rotateX(8deg);
      transform-origin: 50% 100%;
    }
    & .logOffIcon {
      position: absolute;
      top: 16%;
      right: 6%;
      width: 34cqw;
      height: 10cqw;
    }
  }
  &.systemConfig {
    // icons
    & .settingsIcon2 {
      position: absolute;
      top: 15%;
      right: 5%;
      width: 20cqw;
      height: 10cqw;
      transform: rotateX(8deg);
      transform-origin: 50% 100%;
    }
    & .settingsIcon {
      position: absolute;
      top: 15%;
      left: 5%;
      width: 20cqw;
      height: 10cqw;
      transform: rotateX(8deg);
      transform-origin: 50% 100%;
    }
  }
  &.goPro {
    &:before {
      content: '';
      position: absolute;
      top: 17%;
      left: 2.2%;
      width: 15%;
      height: 48%;
      background: #b9dcaf;
      transform: skew(-5.5deg, 0deg);
      border-right: 0.2cqw solid rgb(110, 120, 106);
    }
    &:after {
      content: '';
      position: absolute;
      top: 17%;
      right: 2.2%;
      width: 15%;
      height: 48%;
      background: #b9dcaf;
      transform: skew(5.5deg, 0deg);
      border-left: 0.2cqw solid rgb(110, 120, 106);
    }
    // icons
    & .crownIcon {
      position: absolute;
      top: 14%;
      left: 17%;
      width: 20cqw;
      height: 10cqw;
      transform: rotateX(8deg);
      transform-origin: 50% 100%;
    }
    & .fullAccessTextIcon {
      position: absolute;
      top: 14%;
      right: 17%;
      width: 20cqw;
      height: 10cqw;
      transform: rotateX(8deg);
      transform-origin: 50% 100%;
    }
  }
  &.trainingCenter {
    // icons
    & .bookIcon {
      position: absolute;
      top: 15%;
      right: 5%;
      width: 14cqw;
      height: 10cqw;
      transform: rotateX(8deg);
      transform-origin: 50% 100%;
      opacity: 0.6;
    }
    & .hatIcon {
      position: absolute;
      top: 14%;
      left: 5%;
      width: 14cqw;
      height: 10cqw;
      transform: rotateX(8deg);
      transform-origin: 50% 100%;
    }
  }
  &.titleControlCenter2 {
    // icons
    & .radarIcon {
      position: absolute;
      top: 16%;
      left: 7%;
      width: 10cqw;
      height: 10cqw;
      transform: rotateX(8deg);
      transform-origin: 50% 100%;
    }
    & .headsetsIcon {
      position: absolute;
      top: 18%;
      right: 8%;
      width: 10cqw;
      height: 10cqw;
      transform: rotateX(4deg);
      transform-origin: 50% 100%;
    }
  }
  &.titleTrainingCenter {
    // icons
    & .headsetsIcon {
      position: absolute;
      top: 18%;
      right: 8%;
      width: 10cqw;
      height: 10cqw;
      transform: rotateX(4deg);
      transform-origin: 50% 100%;
    }
  }
  &.subtitleControlCenter2 {
    p {
      font-size: 6cqw;
      font-weight: 500;
      height: 11cqw;
      text-decoration: underline;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    // icons
    & .cloudIcon {
      position: absolute;
      top: 14%;
      left: 7%;
      width: 18cqw;
      height: 10cqw;
      transform: rotateX(8deg);
      transform-origin: 50% 100%;
    }
    // Odd-numbered pages carry the plane instead of the cloud. Without this the
    // icon is rendered but unpositioned, because nothing else in this block
    // places a planeUpIcon. Mirrors `.subtitle .planeUpIcon` above.
    & .planeUpIcon {
      position: absolute;
      top: 14%;
      right: 7%;
      width: 20cqw;
      height: 10cqw;
      transform: rotateX(8deg);
      transform-origin: 50% 100%;
    }
    // & .twoIcon {
    //   position: absolute;
    //   top: 22%;
    //   right: 26%;
    //   width: 10cqw;
    //   height: 7cqw;
    //   transform: rotateX(14deg);
    //   transform-origin: 50% 100%;
    // }
  }
  &.subtitleTrainingCenter {
    p {
      font-size: 6cqw;
      font-weight: 500;
      height: 11cqw;
      text-decoration: underline;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    // icons
    & .bookIcon {
      position: absolute;
      top: 15%;
      left: 8%;
      width: 12cqw;
      height: 10cqw;
      // transform: rotateX(8deg);
      transform: rotateX(4deg);
      transform-origin: 50% 100%;
      opacity: 0.6;
    }
    & .radarIcon {
      position: absolute;
      top: 22%;
      right: 12%;
      width: 10cqw;
      height: 7cqw;
      transform: rotateX(4deg);
      // transform: rotateX(14deg);
      transform-origin: 50% 100%;
    }
  }
  &.level {
    // icons
    & .crownIcon {
      position: absolute;
      top: 14%;
      left: 7%;
      width: 18cqw;
      height: 10cqw;
      transform: rotateX(8deg);
      transform-origin: 50% 100%;
    }
  }
  &.training {
    & .strip--inner-middle {
      padding: 1cqw 0;
    }
    & .middle-text {
      line-height: 1;
      font-size: 4.3cqw;
    }
    & .strip--inner-right {
      justify-content: center;
      .strip--text {
        font-size: 2.3cqw;
      }
    }
  }
  &.more-levels {
    & .strip--text {
      font-size: 5.5cqw;
      line-height: 10cqw;
    }
  }

  // icons
  & .startIcon {
    position: absolute;
    top: 16%;
    right: 7%;
    width: 20cqw;
    height: 10cqw;
    transform: rotateX(8deg);
    transform-origin: 50% 100%;
  }

  & .grounded-icon {
    position: absolute;
    top: 15%;
    left: 2%;
    width: 96%;
    height: 50%;
    transform: rotateX(5deg);
    transform-origin: 50% 100%;
    z-index: 1;
  }
  & .blocked-icon {
    position: absolute;
    top: 15%;
    left: 2%;
    width: 96%;
    height: 50%;
    transform: rotateX(5deg);
    transform-origin: 50% 100%;
    z-index: 1;
  }
  & .stripContentIcon6 {
    position: absolute;
    top: 15%;
    left: 2%;
    width: 96%;
    height: 50%;
    transform: rotateX(5deg);
    transform-origin: 50% 100%;
  }
  & .stripContentIcon7 {
    position: absolute;
    top: 15%;
    left: 2%;
    width: 96%;
    height: 50%;
    transform: rotateX(3deg);
    transform-origin: 50% 100%;
  }
  & .stripContentIcon8 {
    position: absolute;
    top: 15%;
    left: 2%;
    width: 96%;
    height: 50%;
    transform: rotateX(3deg);
    transform-origin: 50% 100%;
  }
  & .stripContentIcon9 {
    position: absolute;
    top: 15%;
    left: 2%;
    width: 96%;
    height: 50%;
    transform: rotateX(6deg);
    transform-origin: 50% 100%;
  }
  & .notamOutServiceIcon {
    position: absolute;
    top: 15%;
    left: 2%;
    width: 96%;
    height: 50%;
    transform: rotateX(3deg);
    transform-origin: 50% 100%;
  }

  &.disabled {
    .strip--text {
      opacity: 0.3;
    }
  }
  &.level {
  }

  &--inner {
    display: flex;
    transform: rotateX(8deg);
    transform-origin: 50% 100%;
    margin-left: -1.4cqw;

    color: rgb(119, 64, 42);
    font-weight: 600;

    max-height: 70%;
    height: 70%;

    &.grounded {
      position: relative;
      &::after {
        content: '';
        position: absolute;
        top: 1%;
        left: 0.5cqw;
        width: 100%;
        height: 100%;
        background: white;
        opacity: 0.8;
      }
    }
    &.blocked {
      position: relative;
      &::after {
        content: '';
        position: absolute;
        top: 1%;
        left: 0.5cqw;
        width: 100%;
        height: 100%;
        background: white;
        opacity: 0.8;
      }
    }
  }

  &--inner-left {
    border-right: 0.4cqw solid rgb(119, 64, 42);
  }
  &--inner-middle {
    border-right: 0.4cqw solid rgb(119, 64, 42);
    padding: 1cqw;

    min-width: 40cqw;

    display: flex;
    align-items: center;
    justify-content: center;

    .strip--text {
      font-size: 5.5cqw;
      line-height: 1;
    }

    .middle-text {
      display: inline-block;
      position: relative;

      // crownIcon
      img {
        position: absolute;
        top: -1cqw;
        right: -2.5cqw;
        width: 5cqw;
        height: 5cqw;
        max-width: 5cqw;
        transform: rotate(45deg);
      }
    }
  }
  &--inner-right {
    padding: 0cqw 0 0 1cqw;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;

    .strip--text {
      font-size: 3cqw;
      line-height: 1;
      text-align: left;

      span {
        display: block;
      }
    }
  }
  &--level {
    font-size: 3cqw;
    border-bottom: 0.4cqw solid rgb(119, 64, 42);
    padding: 0.1cqw 2cqw;
  }
  &--level-number {
    font-size: 4cqw;
    font-weight: 800;
    text-align: center;
  }

  &--content {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    padding: 2.5%;

    container-type: inline-size;

    perspective: 250px;
    perspective-origin: 50% 100%;
  }
  &--text {
    font-size: 7cqw;
    text-align: center;
    font-weight: bold;
    color: #8a3f2e;

    transform: rotateX(8deg);
    transform-origin: 50% 100%;

    &.relative-text {
      position: relative;
    }
  }

  &--text-number {
    position: absolute;
    right: 32cqw;
    font-size: 8cqw;
    color: #5c3a33;
  }

  // Must come AFTER .visible (equal specificity at 0,2,0; later wins) so
  // `animation: none` cancels the stripFall animation and the .center .strip:hover
  // transform can apply. This mirrors the .left/.right column rules.
  &.visible {
    visibility: visible;
    animation: stripFall 0.6s cubic-bezier(0.16, 1, 0.3, 1) both;
    animation-delay: calc(var(--i) * 0.15s);
  }

  &.settled {
    opacity: 1;
    animation: none;
  }

  transition: transform 0.15s ease-out;

  @media (hover: hover) {
    &:hover {
      transform: scale(1.04) translateY(-15%);
    }
  }
  // Touch platforms never fire `:hover` — a finger press is not a hover — so
  // the same lift is applied via the `.pressed` class toggled on the pointer
  // lifecycle (see StripColumn.onPointerDown/Up/Cancel/Leave). One rule set
  // serves desktop and touch; only one strip is up at a time.
  &.pressed {
    transform: scale(1.04) translateY(-15%);
  }
}

.strip img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

// center
.column.center {
  flex: 0 0 37%;
  display: flex;
  flex-direction: column;
  align-items: center;
  box-sizing: border-box;
  padding: 6.5% 0 6.5%;

  /* to adjust posts */
  transform: skew(0.4deg, 0deg);
  left: -0.1%;

  clip-path: polygon(18% 0%, 82% 0%, 104% 100%, -4% 100%);

  // prevent cut strips sides on first animation
  &.init {
    clip-path: unset;
    z-index: 10;
    pointer-events: none;
    &:hover {
      z-index: 1;
    }
  }

  &:hover {
    clip-path: polygon(15% 0%, 84% 0%, 106% 100%, -6% 100%);
  }
}

.center .strip {
  // --i is bound INLINE by StripColumn.vue's visualIndex(), which counts only
  // VISIBLE strips so the fall queue is always 0,1,2,3... top-to-bottom.
  // The old :nth-child() rules are gone: they counted DOM children (including
  // invisible filler strips), which made the visible queue fall with gaps, and
  // they stopped at 14, so a 15th strip silently fell back to --i: 0.
  // Default for the rare strip rendered outside StripColumn (all strips ship
  // through StripColumn, so the inline binding always wins in practice).
  --i: 0;
  width: calc(70% + var(--i) * 7%);
  z-index: calc(var(--i) + 1);

  // The init clip lifts the centre column above the side columns while the
  // strips drop in (see `.column.center.init`). The strips keep that same
  // stacking order for the whole drop.
  &.init {
    z-index: 10;
    pointer-events: none;
  }
}

// The `init` class is toggled on the centre COLUMN, not on the strips, so the
// strip-level rule above is reached through the column state.
.column.center.init .strip {
  z-index: 10;
}

// left
.column.left {
  flex: 0 0 36%;
  display: flex;
  flex-direction: column;
  align-items: center;
  box-sizing: border-box;
  padding: 6.5% 0 6.5%;

  /* to adjust posts */
  transform: skew(-14.8deg, 0deg);
  right: -5.3%;

  clip-path: polygon(0% 0%, 82% 0%, 101% 100%, 3% 100%);

  &.init {
    clip-path: unset;
    pointer-events: none;
  }
}

.left .strip {
  // --i is bound INLINE by StripColumn.vue's visualIndex(), which counts only
  // VISIBLE strips so the fall queue is always 0,1,2,3... top-to-bottom.
  // The old :nth-child() rules are gone: they counted DOM children (including
  // invisible filler strips), which made the visible queue fall with gaps, and
  // they stopped at 14, so a 15th strip silently fell back to --i: 0.
  // Default for the rare strip rendered outside StripColumn (all strips ship
  // through StripColumn, so the inline binding always wins in practice).
  --i: 0;
  width: calc(70% + var(--i) * 7%);
  z-index: calc(var(--i) + 1);

  aspect-ratio: 6200 / 1224;

  &.visible {
    animation: stripFallLeft 0.6s cubic-bezier(0.16, 1, 0.3, 1) both;
    animation-delay: calc(var(--i) * 0.15s);
  }
  &.settled {
    opacity: 1;
    animation: none;
  }

  @media (hover: hover) {
    &:hover {
      transform: scale(1.04) translate(-4%, -15%);
    }
  }
  &.pressed {
    transform: scale(1.04) translate(-4%, -15%);
  }

  img {
    width: 100%;
    height: 100%;
    object-fit: fill;
  }
}

// right
.column.right {
  flex: 0 0 36%;
  display: flex;
  flex-direction: column;
  align-items: center;
  box-sizing: border-box;
  padding: 6.5% 0 6.5%;

  /* to adjust posts */
  transform: skew(13.5deg, 0deg);
  left: -6.5%;

  clip-path: polygon(18% 0%, 100% 0%, 85% 100%, 3% 100%);

  &.init {
    clip-path: unset;
    pointer-events: none;
  }
}

.right .strip {
  // --i is bound INLINE by StripColumn.vue's visualIndex(), which counts only
  // VISIBLE strips so the fall queue is always 0,1,2,3... top-to-bottom.
  // The old :nth-child() rules are gone: they counted DOM children (including
  // invisible filler strips), which made the visible queue fall with gaps, and
  // they stopped at 14, so a 15th strip silently fell back to --i: 0.
  // Default for the rare strip rendered outside StripColumn (all strips ship
  // through StripColumn, so the inline binding always wins in practice).
  --i: 0;
  width: calc(70% + var(--i) * 7%);
  z-index: calc(var(--i) + 1);

  aspect-ratio: 6200 / 1200;

  &.visible {
    animation: stripFallRight 0.6s cubic-bezier(0.16, 1, 0.3, 1) both;
    animation-delay: calc(var(--i) * 0.15s);
  }
  &.settled {
    opacity: 1;
    animation: none;
  }

  @media (hover: hover) {
    &:hover {
      transform: scale(1.04) translate(4%, -15%);
    }
  }
  &.pressed {
    transform: scale(1.04) translate(4%, -15%);
  }
}

@keyframes stripFall {
  0% {
    opacity: 0;
    transform: translateY(-260%) scale(2);
  }
  100% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
@keyframes stripFallLeft {
  0% {
    opacity: 0;
    transform: translate(-150%, -260%) scale(2);
  }
  100% {
    opacity: 1;
    transform: translate(0) scale(1);
  }
}
@keyframes stripFallRight {
  0% {
    opacity: 0;
    transform: translate(150%, -260%) scale(2);
  }
  100% {
    opacity: 1;
    transform: translate(0) scale(1);
  }
}

@media (max-width: 600px) and (orientation: portrait) {
  .inner {
    width: max(100vw, calc(70vh * var(--ratio)));
  }

  .column.center {
    flex: 0 0 36%;
    padding: 7.5% 0 10.5%;
    clip-path: polygon(17% 0%, 82% 0%, 106% 100%, -6% 100%);
  }

  .column.left {
    padding: 7.4% 0 10.5%;
    transform: skew(-9.8deg, 0deg);
    right: -4.8%;

    & .strip {
      aspect-ratio: 6200 / 1202;
    }
  }

  .column.right {
    padding: 7.5% 0 10.5%;
    transform: skew(9.5deg, 0deg);
    left: -5.8%;
    clip-path: polygon(16% 0%, 100% 0%, 85% 100%, 3% 100%);

    & .strip {
      aspect-ratio: 6200 / 1202;
    }
  }

  .strip.exit p {
    transform: rotateX(10deg);
  }

  .strip.training .strip--inner-right .strip--text {
    font-size: 2.1cqw;
  }

  .strip.goPro:before {
    content: '';
    transform: skew(-3.5deg, 0deg);
  }
  .strip.goPro:after {
    content: '';
    transform: skew(3.5deg, 0deg);
  }
}

// landscape
@media (max-height: 700px) and (orientation: landscape) {
  .strip.exit p {
    transform: rotateX(10deg);
  }
  .strip.back p {
    transform: rotateX(10deg);
  }

  .strip--inner {
    transform: rotateX(9deg);
  }
}
// landscape mobile
@media (max-height: 400px) and (orientation: landscape) {
  .strip--inner {
    transform: rotateX(14deg);
  }

  .strip .stripContentIcon6 {
    transform: rotateX(10deg);
  }
  .strip .stripContentIcon7 {
    transform: rotateX(10deg);
  }
  .strip .stripContentIcon8 {
    transform: rotateX(10deg);
  }

  .strip.training .strip--inner-right .strip--text {
    font-size: 2.1cqw;
  }

  .strip.goPro:before {
    content: '';
    transform: skew(-5.5deg, 0deg);
  }
  .strip.goPro:after {
    content: '';
    transform: skew(5.5deg, 0deg);
  }
}
</style>
