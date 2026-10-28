<script setup lang="ts">
/**
 * Radar scope (Phase 1 MVP): draws an airspace pack's video map — airways,
 * fixes, navaids, runways, ILS extended centrelines, range rings — with pan,
 * zoom, range presets and layer toggles. Traffic and commands come next.
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { courseTo, distanceNm, normDeg, type LatLon } from '@atc-app/sim';
import {
  buildVideoMap,
  DEFAULT_LAYERS,
  RANGE_PRESETS_NM,
  ScopeRenderer,
  ScopeView,
  type ScopeLayers,
  type VideoMap,
} from '@atc-app/scope';
import { loadPack } from '@/services/packLoader';

const route = useRoute();
const router = useRouter();

const host = ref<HTMLDivElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const map = shallowRef<VideoMap | null>(null);
const magVar = ref(0);
const error = ref<string | null>(null);
const loading = ref(true);
const layers = reactive<ScopeLayers>({ ...DEFAULT_LAYERS });
const rangeNm = ref(40);
const frameMs = ref(0);
const cursor = ref<LatLon | null>(null);

const view = new ScopeView({ rangeNm: 40 });
let renderer: ScopeRenderer | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let frame = 0;
let resizeObserver: ResizeObserver | null = null;

const LAYER_LABELS: [keyof ScopeLayers, string][] = [
  ['rangeRings', 'RINGS'],
  ['airways', 'AWY'],
  ['fixes', 'FIX'],
  ['labels', 'LBL'],
  ['runways', 'RWY'],
  ['centrelines', 'CL'],
  ['airports', 'APT'],
];

// ── Drawing ────────────────────────────────────────────────────────────────
function requestDraw(): void {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    if (!renderer || !map.value) return;
    frameMs.value = renderer.draw(view, map.value, layers).ms;
    rangeNm.value = view.rangeNm;
  });
}

function fitCanvas(): void {
  const el = host.value;
  const cv = canvas.value;
  if (!el || !cv) return;
  const dpr = window.devicePixelRatio || 1;
  const { width, height } = el.getBoundingClientRect();
  view.resize(width, height, dpr);
  cv.width = Math.round(width * dpr);
  cv.height = Math.round(height * dpr);
  cv.style.width = `${width}px`;
  cv.style.height = `${height}px`;
  requestDraw();
}

// ── Interaction: drag to pan, wheel / pinch to zoom, keys ──────────────────
const pointers = new Map<number, { x: number; y: number }>();
let pinchDistance = 0;

const local = (e: PointerEvent | WheelEvent) => {
  const r = canvas.value!.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
};

function onPointerDown(e: PointerEvent): void {
  canvas.value?.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, local(e));
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchDistance = Math.hypot(a!.x - b!.x, a!.y - b!.y);
  }
}

function onPointerMove(e: PointerEvent): void {
  const p = local(e);
  if (map.value) cursor.value = map.value.projection.toGeo(view.toLocal(p));
  const prev = pointers.get(e.pointerId);
  if (!prev) return;
  pointers.set(e.pointerId, p);
  if (pointers.size === 1) {
    view.panBy(p.x - prev.x, p.y - prev.y);
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
    if (pinchDistance > 0 && d > 0) view.zoomAt(pinchDistance / d, { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 });
    pinchDistance = d;
  }
  requestDraw();
}

function onPointerUp(e: PointerEvent): void {
  pointers.delete(e.pointerId);
  pinchDistance = 0;
}

function onWheel(e: WheelEvent): void {
  e.preventDefault();
  view.zoomAt(Math.exp(e.deltaY * 0.0015), local(e));
  requestDraw();
}

function setRange(nm: number): void {
  view.rangeNm = nm;
  requestDraw();
}

function stepRange(dir: 1 | -1): void {
  const presets = [...RANGE_PRESETS_NM];
  const next =
    dir > 0
      ? presets.find((p) => p > view.rangeNm + 0.01) ?? presets[presets.length - 1]!
      : [...presets].reverse().find((p) => p < view.rangeNm - 0.01) ?? presets[0]!;
  setRange(next);
}

function recentre(): void {
  view.centre = { x: 0, y: 0 };
  setRange(40);
}

function toggle(layer: keyof ScopeLayers): void {
  layers[layer] = !layers[layer];
  requestDraw();
}

function onKey(e: KeyboardEvent): void {
  const pan = 60;
  switch (e.key) {
    case '+':
    case '=':
      stepRange(-1);
      break;
    case '-':
    case '_':
      stepRange(1);
      break;
    case 'ArrowLeft':
      view.panBy(pan, 0);
      break;
    case 'ArrowRight':
      view.panBy(-pan, 0);
      break;
    case 'ArrowUp':
      view.panBy(0, pan);
      break;
    case 'ArrowDown':
      view.panBy(0, -pan);
      break;
    case '0':
      recentre();
      return;
    case 'l':
      toggle('labels');
      return;
    default:
      return;
  }
  requestDraw();
}

// ── Readout ────────────────────────────────────────────────────────────────
function dm(value: number, pos: string, neg: string, degDigits: number): string {
  const v = Math.abs(value);
  const deg = Math.floor(v);
  const min = (v - deg) * 60;
  return `${value >= 0 ? pos : neg}${String(deg).padStart(degDigits, '0')}°${min.toFixed(1).padStart(4, '0')}'`;
}

const readout = computed(() => {
  const c = cursor.value;
  const m = map.value;
  if (!c || !m) return '';
  const brgMag = normDeg(courseTo(m.reference, c) - magVar.value);
  const dist = distanceNm(m.reference, c);
  return `${dm(c.lat, 'N', 'S', 2)} ${dm(c.lon, 'E', 'W', 3)}   ${String(Math.round(brgMag) || 360).padStart(3, '0')}° ${dist.toFixed(1)} NM`;
});

// ── Lifecycle ──────────────────────────────────────────────────────────────
onMounted(async () => {
  ctx = canvas.value?.getContext('2d') ?? null;
  if (ctx) renderer = new ScopeRenderer(ctx);
  resizeObserver = new ResizeObserver(fitCanvas);
  if (host.value) resizeObserver.observe(host.value);
  window.addEventListener('keydown', onKey);
  try {
    const { pack } = await loadPack(String(route.params.packId));
    map.value = buildVideoMap(pack);
    magVar.value = pack.meta.magVar;
    fitCanvas();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  window.removeEventListener('keydown', onKey);
  if (frame) cancelAnimationFrame(frame);
});
</script>

<template>
  <div ref="host" class="scope">
    <canvas
      ref="canvas"
      class="scope-canvas"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @pointerleave="cursor = null"
      @wheel="onWheel"
    />

    <div class="panel top-left">
      <button class="btn" @click="router.push({ name: 'home' })">HOME</button>
      <span v-if="map" class="title">{{ map.name }} · AIRAC {{ map.airac }}</span>
    </div>

    <div class="panel top-right">
      <div class="row">
        <button
          v-for="nm in RANGE_PRESETS_NM"
          :key="nm"
          class="btn"
          :class="{ active: Math.round(rangeNm) === nm }"
          @click="setRange(nm)"
        >
          {{ nm }}
        </button>
      </div>
      <div class="row">
        <button
          v-for="[key, label] in LAYER_LABELS"
          :key="key"
          class="btn"
          :class="{ active: layers[key] }"
          @click="toggle(key)"
        >
          {{ label }}
        </button>
        <button class="btn" title="Recentre (0)" @click="recentre">CTR</button>
      </div>
    </div>

    <div class="panel bottom-left">
      <span>RNG {{ rangeNm.toFixed(rangeNm < 10 ? 1 : 0) }} NM</span>
      <span v-if="readout">{{ readout }}</span>
      <span class="dim">{{ frameMs.toFixed(1) }} ms</span>
    </div>

    <div v-if="loading" class="message">Loading pack…</div>
    <div v-else-if="error" class="message error">{{ error }}</div>
  </div>
</template>

<style scoped>
.scope {
  position: fixed;
  inset: 0;
  background: #0b1620;
  color: #8fb0c0;
  font: 12px ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  overflow: hidden;
  user-select: none;
}
.scope-canvas {
  display: block;
  touch-action: none;
  cursor: crosshair;
}
.panel {
  position: absolute;
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 8px;
}
.top-left {
  top: env(safe-area-inset-top, 0);
  left: 0;
}
.top-right {
  top: env(safe-area-inset-top, 0);
  right: 0;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
}
.bottom-left {
  bottom: env(safe-area-inset-bottom, 0);
  left: 0;
  gap: 16px;
}
.row {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.title {
  color: #a9bfca;
}
@media (max-width: 720px) {
  .title {
    display: none;
  }
}
.dim {
  color: #35596d;
}
.btn {
  min-width: 34px;
  padding: 4px 8px;
  border: 1px solid #21404f;
  border-radius: 3px;
  background: #0f2230;
  color: #5f8396;
  font: inherit;
  cursor: pointer;
}
.btn.active {
  border-color: #3a5f72;
  background: #163246;
  color: #cfe0e8;
}
.message {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  pointer-events: none;
}
.error {
  color: #e07a6a;
  padding: 24px;
  text-align: center;
}
</style>
