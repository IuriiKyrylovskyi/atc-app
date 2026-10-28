<script setup lang="ts">
/**
 * Radar scope: draws an airspace pack's video map — airways, fixes, navaids,
 * runways, ILS extended centrelines, range rings — and the traffic of a scripted
 * scenario run by the sim in a Web Worker: targets, history dots, speed vectors
 * and full data blocks, updated once per radar sweep. Commands come next.
 *
 * `?scenario=<id>` picks a scenario (default: the first one for the pack),
 * `?scenario=none` shows the map only.
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { courseTo, distanceNm, normDeg, type AircraftState, type LatLon, type Snapshot } from '@atc-app/sim';
import {
  buildVideoMap,
  DEFAULT_LAYERS,
  DEFAULT_TRAFFIC_OPTIONS,
  hitTest,
  magneticHeading,
  RANGE_PRESETS_NM,
  ScopeRenderer,
  ScopeView,
  TrafficPicture,
  type LeaderDirection,
  type ScopeLayers,
  type TrafficHit,
  type TrafficOptions,
  type VideoMap,
} from '@atc-app/scope';
import { buildScenario, findScenario, scenariosForPack } from '@atc-app/scenario';
import { loadPack } from '@/services/packLoader';
import { SIM_RATES, SimSession, type SimRate } from '@/services/simSession';

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

// ── Traffic ────────────────────────────────────────────────────────────────
const traffic = reactive<TrafficOptions>({ ...DEFAULT_TRAFFIC_OPTIONS });
const scenarioName = ref<string | null>(null);
const simTime = ref(0);
const simRate = ref<SimRate>(1);
const paused = ref(false);
const aircraftCount = ref(0);
const selectedAc = shallowRef<AircraftState | null>(null);
const VECTOR_MINUTES = [0, 1, 2, 4] as const;
let picture: TrafficPicture | null = null;
let session: SimSession | null = null;
let hits: TrafficHit[] = [];

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
    const t0 = performance.now();
    renderer.draw(view, map.value, layers);
    hits = picture ? renderer.drawTraffic(view, picture.list(), traffic).hits : [];
    frameMs.value = performance.now() - t0;
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

// ── Sim session ────────────────────────────────────────────────────────────
function onSnapshot(s: Snapshot): void {
  if (!picture) return;
  picture.update(s);
  simTime.value = s.t;
  aircraftCount.value = picture.size;
  if (traffic.selected && !picture.get(traffic.selected)) traffic.selected = null;
  selectedAc.value = traffic.selected ? picture.get(traffic.selected)!.ac : null;
  requestDraw();
}

function select(callsign: string | null): void {
  traffic.selected = callsign;
  selectedAc.value = callsign ? picture?.get(callsign)?.ac ?? null : null;
  requestDraw();
}

function setRate(r: SimRate): void {
  simRate.value = r;
  paused.value = false;
  if (session) {
    session.rate = r;
    session.paused = false;
  }
}

function togglePause(): void {
  paused.value = !paused.value;
  if (session) session.paused = paused.value;
}

function cycleVector(): void {
  const i = VECTOR_MINUTES.indexOf(traffic.vectorMinutes as (typeof VECTOR_MINUTES)[number]);
  traffic.vectorMinutes = VECTOR_MINUTES[(i + 1) % VECTOR_MINUTES.length]!;
  requestDraw();
}

// ── Interaction: drag to pan, click to select, wheel / pinch to zoom, keys ─
const pointers = new Map<number, { x: number; y: number }>();
let pinchDistance = 0;
let pressAt: { x: number; y: number } | null = null;
const CLICK_SLOP_PX = 4;

const local = (e: PointerEvent | WheelEvent) => {
  const r = canvas.value!.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
};

function onPointerDown(e: PointerEvent): void {
  canvas.value?.setPointerCapture(e.pointerId);
  const p = local(e);
  pointers.set(e.pointerId, p);
  pressAt = pointers.size === 1 ? p : null;
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
  if (pressAt && Math.hypot(p.x - pressAt.x, p.y - pressAt.y) > CLICK_SLOP_PX) pressAt = null;
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
  if (e.type === 'pointerup' && pressAt && pointers.size === 1) select(hitTest(hits, local(e)));
  pressAt = null;
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
  // Numpad layout moves the selected data block (STARS-style leader direction).
  if (/^[1-46-9]$/.test(e.key) && traffic.selected && picture) {
    picture.setLeader(traffic.selected, Number(e.key) as LeaderDirection);
    requestDraw();
    return;
  }
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
    case 'v':
      cycleVector();
      return;
    case ' ':
      e.preventDefault();
      togglePause();
      return;
    case 'Escape':
      select(null);
      return;
    default:
      return;
  }
  requestDraw();
}

// ── Readouts ───────────────────────────────────────────────────────────────
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

const clock = computed(() => {
  const s = Math.floor(simTime.value);
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
});

const selectedInfo = computed(() => {
  const ac = selectedAc.value;
  if (!ac) return null;
  const fl = (ft: number) => String(Math.round(ft / 100)).padStart(3, '0');
  const t = ac.target;
  const next = [t.directFix, ...t.route].filter(Boolean).slice(0, 4).join(' ');
  return {
    head: [ac.callsign, `${ac.icaoType}/${ac.wake}`, ac.destination, `SQ ${ac.squawk}`].filter(Boolean).join('  '),
    alt: `ALT ${fl(ac.altFt)}${t.altFt !== ac.altFt ? ` → ${fl(t.altFt)}` : ''}`,
    spd: `IAS ${Math.round(ac.casKt)}  GS ${Math.round(ac.gsKt)}  M${ac.mach.toFixed(2).slice(1)}`,
    hdg: `HDG ${String(magneticHeading(ac, magVar.value)).padStart(3, '0')}`,
    nav: next ? `DCT ${next}` : t.headingTrue !== null ? 'VECTORS' : '',
  };
});

// ── Lifecycle ──────────────────────────────────────────────────────────────
async function startTraffic(pack: Parameters<typeof buildScenario>[1], m: VideoMap): Promise<void> {
  const wanted = typeof route.query.scenario === 'string' ? route.query.scenario : undefined;
  if (wanted === 'none') return;
  const script = wanted ? findScenario(wanted) : scenariosForPack(pack.meta.id)[0];
  if (!script) {
    if (wanted) throw new Error(`Unknown scenario "${wanted}"`);
    return;
  }
  const built = buildScenario(script, pack);
  picture = new TrafficPicture(m.projection);
  scenarioName.value = script.name;
  session = await SimSession.start(built.config, built.traffic, onSnapshot);
}

onMounted(async () => {
  ctx = canvas.value?.getContext('2d') ?? null;
  if (ctx) renderer = new ScopeRenderer(ctx);
  resizeObserver = new ResizeObserver(fitCanvas);
  if (host.value) resizeObserver.observe(host.value);
  window.addEventListener('keydown', onKey);
  try {
    const { pack } = await loadPack(String(route.params.packId));
    const m = buildVideoMap(pack);
    map.value = m;
    magVar.value = pack.meta.magVar;
    fitCanvas();
    await startTraffic(pack, m);
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
  session?.dispose();
  session = null;
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
      <span v-if="map" class="title">
        {{ map.name }} · AIRAC {{ map.airac }}<template v-if="scenarioName"> · {{ scenarioName }}</template>
      </span>
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
      <div v-if="scenarioName" class="row">
        <span class="clock" :class="{ dim: paused }">{{ clock }}</span>
        <button class="btn" :class="{ active: paused }" title="Pause (space)" @click="togglePause">
          {{ paused ? '▶' : 'II' }}
        </button>
        <button
          v-for="r in SIM_RATES"
          :key="r"
          class="btn"
          :class="{ active: !paused && simRate === r }"
          @click="setRate(r)"
        >
          ×{{ r }}
        </button>
        <button class="btn" :class="{ active: traffic.vectorMinutes > 0 }" title="Speed vector (v)" @click="cycleVector">
          VEC {{ traffic.vectorMinutes }}
        </button>
      </div>
    </div>

    <div v-if="selectedInfo" class="panel bottom-right">
      <div class="info">
        <div class="info-head">{{ selectedInfo.head }}</div>
        <div>{{ selectedInfo.alt }}  {{ selectedInfo.hdg }}</div>
        <div>{{ selectedInfo.spd }}</div>
        <div v-if="selectedInfo.nav" class="dim">{{ selectedInfo.nav }}</div>
      </div>
    </div>

    <div class="panel bottom-left">
      <span>RNG {{ rangeNm.toFixed(rangeNm < 10 ? 1 : 0) }} NM</span>
      <span v-if="scenarioName">ACFT {{ aircraftCount }}</span>
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
.bottom-right {
  bottom: calc(env(safe-area-inset-bottom, 0px) + 28px);
  right: 0;
}
.row {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
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
.clock {
  min-width: 64px;
  color: #cfe0e8;
  text-align: right;
}
.info {
  padding: 8px 10px;
  border: 1px solid #21404f;
  border-radius: 3px;
  background: rgba(11, 22, 32, 0.85);
  color: #a9bfca;
  line-height: 1.5;
  white-space: pre;
}
.info-head {
  color: #ffd27a;
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
