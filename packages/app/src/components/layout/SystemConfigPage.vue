<script setup lang="ts">
import { ref, onMounted, onUnmounted, Ref, computed, watch, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import { ROUTE_TO_PAGE } from '@/composables/usePageName';
import { useSettingsStore } from '@/stores/settings';
import { useHaptics } from '@/composables/useHaptics';
import btnClickSound from '@/assets/audio/btn-click.wav';
import musicTrack from '@/assets/audio/Neon_Dreams_Descending.mp3';
import predictSound from '@/assets/audio/predict.mp3';

export type ConfigTypes =
  | 'Background Brightness'
  | 'Audio Settings'
  | 'Music Volume'
  | 'Sound Effects'
  | 'Master Volume'
  | 'Mute All'
  | 'Go back'
  | 'Home';

const router = useRouter();
const settingsStore = useSettingsStore();
const { trigger: triggerHaptic } = useHaptics();

const _btnClickPreloader = new Audio(btnClickSound);
_btnClickPreloader.volume = 0.08;
_btnClickPreloader.preload = 'auto';
_btnClickPreloader.load();

const _neonPreloader = new Audio(musicTrack);
_neonPreloader.volume = 0.08;
_neonPreloader.preload = 'auto';
_neonPreloader.loop = true;
_neonPreloader.load();

const neonAudio = ref<HTMLAudioElement | null>(null);

function playNeonMusic() {
  if (neonAudio.value) return;
  const audio = new Audio(musicTrack);
  audio.loop = true;
  audio.volume = musicVolume.value / 100;
  audio.play().catch(() => {});
  neonAudio.value = audio;
}

function stopNeonMusic() {
  if (neonAudio.value) {
    neonAudio.value.pause();
    neonAudio.value.src = '';
    neonAudio.value = null;
  }
  if (source) {
    source.disconnect();
    source = null;
  }
}

function setMusicVolume(volume: number) {
  if (neonAudio.value) {
    neonAudio.value.volume = volume / 100;
  }
}

const visualizerCanvas = ref<HTMLCanvasElement | null>(null);
let audioCtx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let source: MediaElementAudioSourceNode | null = null;
let animFrame: number | null = null;

function setupVisualizer() {
  if (!neonAudio.value || !visualizerCanvas.value) return;

  if (!audioCtx) {
    audioCtx = new AudioContext();
  }

  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  if (!source) {
    source = audioCtx.createMediaElementSource(neonAudio.value);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 64;
    source.connect(analyser);
    analyser.connect(audioCtx.destination);
  }

  const canvas = visualizerCanvas.value;
  const parent = canvas.parentElement;
  const parentRect = parent?.getBoundingClientRect();
  canvas.width = parentRect?.width || 200;
  canvas.height = parentRect?.height || 40;

  drawVisualizer();
}

function drawVisualizer() {
  if (!analyser || !visualizerCanvas.value) return;

  const canvas = visualizerCanvas.value;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  analyser.getByteFrequencyData(dataArray);

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const barWidth = canvas.width / bufferLength;
  let x = 0;

  for (let i = 0; i < bufferLength; i++) {
    const barHeight = (dataArray[i] / 255) * canvas.height;
    ctx.fillStyle = `rgba(252, 243, 232, ${0.4 + (dataArray[i] / 255) * 0.6})`;
    ctx.fillRect(x, canvas.height - barHeight, barWidth - 1, barHeight);
    x += barWidth;
  }

  animFrame = requestAnimationFrame(drawVisualizer);
}

function stopVisualizer() {
  if (animFrame !== null) {
    cancelAnimationFrame(animFrame);
    animFrame = null;
  }
  if (visualizerCanvas.value) {
    const ctx = visualizerCanvas.value.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, visualizerCanvas.value.width, visualizerCanvas.value.height);
    }
  }
}

function destroyVisualizer() {
  stopVisualizer();
  if (source) {
    source.disconnect();
    source = null;
  }
  if (analyser) {
    analyser.disconnect();
    analyser = null;
  }
  if (audioCtx) {
    audioCtx.close().catch(() => {});
    audioCtx = null;
  }
}

const _predictPreloader = new Audio(predictSound);
_predictPreloader.volume = 0.08;
_predictPreloader.preload = 'auto';
_predictPreloader.loop = true;
_predictPreloader.load();

const predictAudio = ref<HTMLAudioElement | null>(null);

function playPredictSound() {
  if (predictAudio.value) return;
  const audio = new Audio(predictSound);
  audio.loop = true;
  audio.volume = soundEffectsVolume.value / 100;
  audio.play().catch(() => {});
  predictAudio.value = audio;
}

function stopPredictSound() {
  if (predictAudio.value) {
    predictAudio.value.pause();
    predictAudio.value.src = '';
    predictAudio.value = null;
  }
}

function setPredictVolume(volume: number) {
  if (predictAudio.value) {
    predictAudio.value.volume = volume / 100;
  }
}

function playBtnClick() {
  const audio = new Audio(btnClickSound);
  audio.volume = 0.08;
  audio.play().catch(() => {});
}

const showHint = ref(true);

const backItems: ConfigTypes[] = ['Go back', 'Home'];
const menu: Record<number, ConfigTypes[]> = {
  1: ['Background Brightness', 'Audio Settings', ...backItems],
  2: ['Music Volume', 'Sound Effects', ...backItems],
};

const brightness = ref(settingsStore.gameplay.backgroundDimming);
const masterVolume = ref(settingsStore.audio.masterVolume * 100);
const musicVolume = ref(settingsStore.audio.musicVolume * 100);
const soundEffectsVolume = ref(settingsStore.audio.sfxVolume * 100);
const isMuted = ref(settingsStore.audio.muted);

const activeMenuListKey: Ref<number | null> = ref(1);
const activeMenuList = computed(() =>
  activeMenuListKey.value === null ? [] : menu[activeMenuListKey.value] ?? []
);
const activeMenuIdx = ref(0);
const entered: Ref<ConfigTypes | null> = ref(null);

watch(entered, async (val) => {
  if (val === 'Music Volume') {
    playNeonMusic();
    await nextTick();
    setupVisualizer();
  } else {
    stopNeonMusic();
    stopVisualizer();
  }
  if (val === 'Sound Effects') {
    playPredictSound();
  } else {
    stopPredictSound();
  }
});

const renderedValue = computed(() => {
  if (entered.value === 'Master Volume') {
    return masterVolume.value;
  }
  if (entered.value === 'Music Volume') {
    return musicVolume.value;
  }
  if (entered.value === 'Sound Effects') {
    return soundEffectsVolume.value;
  }
  if (entered.value === 'Mute All') {
    return isMuted.value ? 100 : 0;
  }

  return brightness.value;
});
const scaleStyle = computed(() => ({
  width: `${100 - renderedValue.value}%`, // Notice the .value if it's a ref
}));

onMounted(() => {
  settingsStore.loadSettings();
  brightness.value = settingsStore.gameplay.backgroundDimming;
  masterVolume.value = settingsStore.audio.masterVolume * 100;
  musicVolume.value = settingsStore.audio.musicVolume * 100;
  soundEffectsVolume.value = settingsStore.audio.sfxVolume * 100;
  soundEffectsVolume.value = settingsStore.audio.sfxVolume * 100;
  isMuted.value = settingsStore.audio.muted;

  setTimeout(() => {
    showHint.value = false;
  }, 3500);
});

onUnmounted(() => {
  stopNeonMusic();
  stopPredictSound();
  destroyVisualizer();
});

const onPlus = () => {
  triggerHaptic();
  if (activeMenuIdx.value === activeMenuList.value?.length - 1 && !entered.value) return;
  if (entered.value === 'Background Brightness' && brightness.value < 100) {
    brightness.value = brightness.value + 5 <= 100 ? brightness.value + 5 : 100;
    return;
  }
  if (entered.value === 'Master Volume' && masterVolume.value < 100) {
    masterVolume.value = masterVolume.value + 5 <= 100 ? masterVolume.value + 5 : 100;
    return;
  }
  if (entered.value === 'Music Volume' && musicVolume.value < 100) {
    musicVolume.value = musicVolume.value + 5 <= 100 ? musicVolume.value + 5 : 100;
    setMusicVolume(musicVolume.value);
    settingsStore.updateAudio({ musicVolume: musicVolume.value / 100 });
    return;
  }
  if (entered.value === 'Sound Effects' && soundEffectsVolume.value < 100) {
    soundEffectsVolume.value =
      soundEffectsVolume.value + 5 <= 100 ? soundEffectsVolume.value + 5 : 100;
    setPredictVolume(soundEffectsVolume.value);
    settingsStore.updateAudio({ sfxVolume: soundEffectsVolume.value / 100 });
    return;
  }
  activeMenuIdx.value += 1;
};
const onMinus = () => {
  triggerHaptic();
  if (activeMenuIdx.value === 0 && !entered.value) return;
  if (entered.value === 'Background Brightness' && brightness.value > 0) {
    brightness.value = brightness.value - 5 >= 0 ? brightness.value - 5 : 0;
    return;
  }
  if (entered.value === 'Master Volume' && masterVolume.value > 0) {
    masterVolume.value = masterVolume.value - 5 >= 0 ? masterVolume.value - 5 : 0;
    return;
  }
  if (entered.value === 'Music Volume' && musicVolume.value > 0) {
    musicVolume.value = musicVolume.value - 5 >= 0 ? musicVolume.value - 5 : 0;
    setMusicVolume(musicVolume.value);
    settingsStore.updateAudio({ musicVolume: musicVolume.value / 100 });
    return;
  }
  if (entered.value === 'Sound Effects' && soundEffectsVolume.value > 0) {
    soundEffectsVolume.value = soundEffectsVolume.value - 5 >= 0 ? soundEffectsVolume.value - 5 : 0;
    setPredictVolume(soundEffectsVolume.value);
    settingsStore.updateAudio({ sfxVolume: soundEffectsVolume.value / 100 });
    return;
  }
  activeMenuIdx.value -= 1;
};

const backToAudio = (key = 1) => {
  entered.value = null;
  activeMenuListKey.value = key;
  activeMenuIdx.value = activeMenuList.value?.length - 2;
};
const onEnter = () => {
  triggerHaptic();
  if (entered.value) {
    if (entered.value === 'Background Brightness') {
      settingsStore.updateBackgroundDimming(brightness.value);
      backToAudio(1);
      return;
    }
    if (entered.value === 'Master Volume') {
      settingsStore.updateAudio({ masterVolume: masterVolume.value / 100 });
      backToAudio(2);
      return;
    }
    if (entered.value === 'Music Volume') {
      settingsStore.updateAudio({ musicVolume: musicVolume.value / 100 });
      backToAudio(2);
      return;
    }
    if (entered.value === 'Sound Effects') {
      settingsStore.updateAudio({ sfxVolume: soundEffectsVolume.value / 100 });
      backToAudio(2);
      return;
    }
    if (entered.value === 'Mute All') {
      isMuted.value = !isMuted.value;
      settingsStore.updateAudio({ muted: isMuted.value });
      backToAudio(2);
      return;
    }
  }
  const active = activeMenuList.value[activeMenuIdx.value];
  if ('Background Brightness' === active) {
    entered.value = 'Background Brightness';
    activeMenuListKey.value = null;
    return;
  }
  if ('Audio Settings' === active) {
    activeMenuIdx.value = 0;
    activeMenuListKey.value = 2;
    return;
  }
  if ('Master Volume' === active) {
    entered.value = 'Master Volume';
    activeMenuListKey.value = null;
    return;
  }
  if ('Mute All' === active) {
    entered.value = 'Mute All';
    activeMenuListKey.value = null;
    return;
  }
  if ('Music Volume' === active) {
    entered.value = 'Music Volume';
    activeMenuListKey.value = null;
    return;
  }
  if ('Sound Effects' === active) {
    entered.value = 'Sound Effects';
    activeMenuListKey.value = null;
    return;
  }
  if ('Go back' === active) {
    if (activeMenuListKey.value === 1) {
      router.push(`/${ROUTE_TO_PAGE.Home}`);
      return;
    }
    if (activeMenuListKey.value === 2) {
      activeMenuIdx.value = activeMenuList.value?.length - 2;
      activeMenuListKey.value = 1;
      return;
    }
    return;
  }
  if ('Home' === active) {
    router.push(`/${ROUTE_TO_PAGE.Home}`);
    return;
  }
};
</script>

<template>
  <div class="wrap">
    <div class="inner">
      <img class="scene-bg" src="../../assets/page-bg/level-3.webp" alt="scene" />
      <span class="bg-brightness" :style="{ opacity: brightness / 100 }"></span>
      <img class="scene-plane rw-icon" src="../../assets/page-bg/rw-icon.png" alt="rw icon" />
      <img class="scene-plane plane-1" src="../../assets/planes/1-a380/1-blue.png" alt="plane 1" />
      <img class="scene-plane plane-2" src="../../assets/planes/1-a380/1-green.png" alt="plane 2" />
      <img
        class="scene-plane plane-3"
        src="../../assets/planes/1-a380/1-violet.png"
        alt="plane 3"
      />
      <img class="main-bg" src="../../assets/page-bg/workStation.png" alt="bg" />
      <canvas
        v-if="entered === 'Music Volume'"
        ref="visualizerCanvas"
        class="volume-visualizer"
      ></canvas>
      <div class="buttons">
        <div
          class="button left-button"
          @click="
            onMinus();
            showHint = false;
            playBtnClick();
          "
        >
          <img src="../../assets/page-bg/ws-minus.png" alt="minus" />
        </div>
        <div
          class="button center-button"
          @click="
            onEnter();
            showHint = false;
            playBtnClick();
          "
        >
          <img src="../../assets/page-bg/ws-enter.png" alt="enter" />
        </div>
        <div
          class="button right-button"
          @click="
            onPlus();
            showHint = false;
            playBtnClick();
          "
        >
          <img src="../../assets/page-bg/ws-plus.png" alt="plus" />
        </div>
        <div v-if="entered" class="volume">
          <span class="volume--title">{{ entered }}</span>
          <span class="value min-value">0</span>
          <div class="volume--inner">
            <span class="volume--box">
              <span class="volume--scale"></span>
              <span class="volume--empty" :style="scaleStyle"></span>
            </span>
          </div>
          <span class="value max-value">{{ renderedValue }}</span>
        </div>
        <div v-else class="hint-buttons" :class="{ 'show-hint': showHint }">
          <span>push</span><span class="colored">- / ENTER / +</span><span>buttons</span>
        </div>
      </div>

      <!-- <img class="main-bg--papers" src="../../assets/icons/text-sheet.png" alt="paper" />
      <img class="main-bg--pencil" src="../../assets/page-bg/pencilIcon.png" alt="pencil" /> -->

      <div class="column system">
        <div v-if="activeMenuList" class="system--inner">
          <p class="system--title">System Config</p>
          <div class="system--menu">
            <div
              v-for="(item, i) in activeMenuList"
              :key="item"
              class="system--menu-item"
              :class="{ active: i === activeMenuIdx }"
            >
              - {{ item }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="less" scoped>
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
}

.scene-bg {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  max-width: 100%;
  object-fit: cover;
}
.scene-plane {
  position: absolute;
  width: 7cqw;
  height: 7cqw;
  max-width: 10%;

  object-fit: contain;

  &.rw-icon {
    top: 41%;
    left: 46%;
    width: auto;
    height: auto;
    max-width: 23%;
  }
  &.plane-1 {
    top: 40%;
    left: 45%;
    transform: rotate(-10deg);
  }
  &.plane-2 {
    top: 30%;
    left: 60%;
    transform: rotate(100deg);
  }
  &.plane-3 {
    top: 55%;
    left: 30%;
    transform: rotate(-50deg);
  }
}
.bg-brightness {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  max-width: 100%;
  object-fit: cover;
  background: #000;
}

.buttons {
  position: absolute;
  bottom: 20.5%;
  left: 36.5%;
  width: 25%;
  height: 8%;
  display: flex;
  align-items: center;
  gap: 6%;

  container-type: inline-size;

  // transform: skew(11.5deg, 0deg);
  // transform-origin: 50% 100%;

  .volume {
    position: absolute;
    top: -78%;
    left: 0;
    width: 100%;
    font-size: 7.5cqw;
    text-align: center;

    display: flex;
    gap: 2cqw;
    align-items: center;
    justify-content: space-around;
    padding: 0 2cqw;

    &--title {
      position: absolute;
      top: -100%;
      text-align: center;

      display: inline-block;
      font-weight: 600;
      line-height: 1;
      color: rgb(184 93 89);
      background: rgb(247, 212, 191);
      padding: 1cqw 2cqw;
      border-radius: 1cqw;
    }

    &--inner {
      width: 100%;
      height: 100%;
      background-color: #fff8ec;
      // position: relative;

      // position: absolute;
      // top: 0;
      // left: 0;
    }

    &--box {
      position: relative;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      flex-grow: 1;

      display: block !important;

      padding: 0 0 14% 0;

      overflow: hidden;
      min-height: 3cqw;
    }

    &--scale {
      position: absolute;
      top: 50%;
      left: -10%;
      width: 120%;
      height: 100%;
      background: rgb(184 93 89);
      transform: rotateZ(-8deg);
    }
    &--empty {
      position: absolute;
      top: 0%;
      right: 0%;
      height: 100%;
      background-color: #fff8ec;
    }

    span {
      display: inline-block;
    }

    & .value {
      background: #fff8ec;
      min-width: 15cqw;
      font-weight: 600;
    }

    & .min-value {
      border-top-left-radius: 1cqw;
      border-bottom-left-radius: 1cqw;
    }
    & .max-value {
      border-top-right-radius: 1cqw;
      border-bottom-right-radius: 1cqw;
    }
  }
  .hint-buttons {
    opacity: 0;
    visibility: hidden;

    position: absolute;
    top: -78%;
    left: 0;
    width: 100%;
    font-size: 7.5cqw;
    text-align: center;

    display: flex;
    gap: 1cqw;
    align-items: center;
    justify-content: space-around;
    padding: 0 2cqw;

    &.show-hint {
      background-color: #e5e545;
      backdrop-filter: blur(0.5cqw);
      border-radius: 2cqw;
      animation: hintBlink 1.5s ease-in-out infinite;
    }

    span {
      display: inline-block;

      // border-radius: 2cqw;
      // background-color: rgba(238, 217, 217, 0.8); /* Must be semi-transparent */
      // backdrop-filter: blur(0.5cqw);

      &.colored {
        font-weight: 500;
        // background-color: rgb(218 199 199 / 80%); /* Must be semi-transparent */
        // backdrop-filter: blur(0.5cqw);
      }
    }
  }

  @keyframes hintBlink {
    0%,
    100% {
      opacity: 1;
      visibility: visible;
    }
    50% {
      opacity: 0.2;
    }
  }

  .button {
    position: relative;
    width: 20%;
    height: 100%;

    transition: all 0.3s ease;

    container-type: inline-size;

    &.center-button {
      width: 60%;

      &::after {
        content: 'ENTER';
        position: absolute;
        top: -1.2%;
        left: 0;
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 18cqw;
        font-weight: 600;
        line-height: 1.3;
        color: rgb(227 214 197);
      }
    }
    &.right-button {
    }
    &.left-button {
    }

    img {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      max-width: 100%;
      object-fit: contain;
    }

    &:hover {
      transform: scale(1.07);
    }
  }
}

.inner .column {
  // position: relative;
  // pointer-events: auto;
}

// ws
.column.system {
  flex: 0 0 42.2%;
  width: 42.2%;
  max-width: 42.2%;
  display: flex;
  flex-direction: column;
  align-items: center;
  box-sizing: border-box;
  padding-top: 12%;

  /* to adjust posts */
  transform: skew(0.4deg, 0deg);
  left: -1.1%;

  clip-path: polygon(3% 19.8%, 100% 19.8%, 100% 71%, -1% 71%);

  container-type: inline-size;
  perspective: 250px;
  perspective-origin: 50% 100%;
}

.system {
  &--inner {
    width: 90%;
    padding: 2cqw;
    border: 0.3cqw solid #615f5c;
    border-radius: 2cqw;
    transform: skew(-0.6deg, 0deg) rotateX(1deg);
    transform-origin: 50% 100%;
    background-color: antiquewhite;
    color: #615f5c;
    font-weight: 600;
  }

  &--title {
    font-size: 6cqw;
    text-align: center;
    text-decoration: underline;
    margin-bottom: 2cqw;
  }
  &--menu {
    display: flex;
    flex-direction: column;
    gap: 1cqw;
  }

  &--menu-item {
    font-size: 7cqw;
    line-height: 1;
    padding: 0 1cqw;

    &.active {
      background: #615f5c;
      color: antiquewhite;
    }
  }
}

.volume-visualizer {
  position: absolute;
  top: 27%;
  left: 36.5%;
  width: 30%;
  height: 30%;
  pointer-events: none;
  z-index: 10;
}

@media (max-width: 600px) and (orientation: portrait) {
  .inner {
    width: max(100vw, calc(56vh * var(--ratio)));
  }

  .main-bg {
    left: 0.5%;
  }

  .column.system {
    padding-top: 27%;
  }

  .buttons {
    bottom: 20.5%;
    left: 29.5%;
    width: 40%;
    height: 8%;

    .hint-buttons {
      top: -56%;
      font-size: 4.5cqw;
    }
  }
}

// landscape
@media (max-height: 700px) and (orientation: landscape) {
  .column.system {
    padding-top: 11%;
  }

  .system {
    &--inner {
      transform: skew(-0.6deg, 0deg) rotateX(2deg);
    }
  }
}
// landscape mobile
@media (max-height: 400px) and (orientation: landscape) {
}
</style>
