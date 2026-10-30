<script setup lang="ts">
/**
 * Radar scope: draws an airspace pack's video map — airways, fixes, navaids,
 * runways, ILS extended centrelines, range rings — and the traffic of a scripted
 * scenario run by the sim in a Web Worker: targets, history dots, speed vectors
 * and full data blocks, updated once per radar sweep. Typed commands
 * (`DAL1192 D080 H240`, see @atc-app/voice command.ts) go to the sim; the comms
 * log shows the instruction, the pilot's readback and any "unable".
 *
 * The display follows the selected ATC system profile (generic, Selex, Indra),
 * and the active sector (dropdown) colours traffic by ownership: owned,
 * incoming (entering within 5 min) or other. Clicking a track symbol shows its
 * route with estimated times over each point.
 *
 * The area dropdown (New York, Kyiv, Bangkok — config/areas.ts) switches the
 * airspace pack; the sector dropdown lists that area's sectors.
 *
 * `?scenario=<id>` picks a scenario (default: the first one for the pack),
 * `?scenario=none` shows the map only.
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { type AircraftState, type AirspacePack, type LatLon, type Snapshot } from '@atc-app/sim';
import {
  buildVideoMap,
  DEFAULT_LAYERS,
  DEFAULT_TRAFFIC_OPTIONS,
  findSystem,
  hitTestDetail,
  routePath,
  SCOPE_SYSTEMS,
  RANGE_PRESETS_NM,
  ScopeRenderer,
  ScopeView,
  TrafficPicture,
  type LeaderDirection,
  type RoutePath,
  type ScopeLayers,
  type TrafficHit,
  type TrafficOptions,
  type VideoMap,
} from '@atc-app/scope';
import { buildScenario, findScenario, scenariosForPack } from '@atc-app/scenario';
import {
  KOKORO_DOWNLOAD_MB,
  MOONSHINE_DOWNLOAD_MB,
  instruction,
  interpret,
  pickTranscript,
  readback,
  sayAgain,
  type TransmissionContext,
} from '@atc-app/voice';
import { loadPack, loadPackManifest } from '@/services/packLoader';
import { AREAS } from '@/config/areas';
import { SIM_RATES, SimSession, type SimRate } from '@/services/simSession';
import {
  RadioVoice,
  VOICE_MODES,
  type RadioVoiceStatus,
  type VoiceMode,
} from '@/services/radioVoice';
import {
  ControllerMic,
  availableMicModes,
  type ControllerMicStatus,
  type MicMode,
} from '@/services/controllerMic';
import { isolationRequested, isolationUrl } from '@/utils/isolation';
import {
  aircraftDetail,
  aircraftFromSim,
  airspaceFromPack,
  areaOptions as buildAreaOptions,
  clockHms,
  clockMs,
  cursorReadout,
  EMPTY_TRAFFIC,
  logEntriesFromSim,
  pilotTransmissionsFromSim,
  runwayKey,
  trafficSummary,
  type AirspaceVM,
  type LogEntryVM,
  type TrafficSummaryVM,
} from '@/viewmodels';

const route = useRoute();
const router = useRouter();

const host = ref<HTMLDivElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const map = shallowRef<VideoMap | null>(null);
/** The loaded pack as the panels read it (sectors, sources, lookups). */
const airspace = shallowRef<AirspaceVM | null>(null);
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
const summary = ref<TrafficSummaryVM>(EMPTY_TRAFFIC);
const selectedAc = shallowRef<AircraftState | null>(null);
const VECTOR_MINUTES = [0, 1, 2, 4] as const;
let picture: TrafficPicture | null = null;
let session: SimSession | null = null;
let hits: TrafficHit[] = [];
const landedCount = ref(0);
let loadedPack: AirspacePack | null = null;
let blinkTimer: ReturnType<typeof setInterval> | null = null;
const scenarioId = ref('none');

// ── ATC system profile + active sector (remembered per viewer) ─────────────
const SYSTEM_KEY = 'atc.scope.system';
const sectorKey = () => `atc.scope.sector.${String(route.params.packId)}`;
const stored = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const store = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode / blocked storage: the choice just is not remembered.
  }
};
const systemId = ref(findSystem(stored(SYSTEM_KEY)).id);
const system = computed(() => findSystem(systemId.value));
const activeSector = ref<string>('');
const sectorOptions = computed(() => airspace.value?.sectors ?? []);

// ── Pilot voices (remembered; audio starts on the first click / key press) ──
const VOICE_KEY = 'atc.scope.voice';
const VOICE_LABELS: Record<VoiceMode, string> = {
  off: 'VOICE OFF',
  system: 'VOICE SYS',
  kokoro: `VOICE KOKORO (${KOKORO_DOWNLOAD_MB} MB once)`,
};
const storedVoice = stored(VOICE_KEY);
const voiceMode = ref<VoiceMode>(
  VOICE_MODES.includes(storedVoice as VoiceMode) ? (storedVoice as VoiceMode) : 'off'
);
const voiceStatus = shallowRef<RadioVoiceStatus | null>(null);
const radioVoice = new RadioVoice((s) => (voiceStatus.value = s));
let voiceArmed = false;

/** Browsers only start audio after a user gesture: apply the remembered mode on the first one. */
function armVoice(): void {
  if (voiceArmed) return;
  voiceArmed = true;
  window.removeEventListener('pointerdown', armVoice);
  window.removeEventListener('keydown', armVoice);
  radioVoice.setMode(voiceMode.value);
}

/**
 * Kokoro and Moonshine run twice as fast cross-origin isolated (multi-threaded
 * WASM): reload the scope as `?coi=1` (once — a server without the headers gives
 * a normal page; see utils/isolation).
 */
function reloadIsolated(): boolean {
  const wanted = voiceMode.value === 'kokoro' || micMode.value === 'moonshine';
  if (!wanted || window.crossOriginIsolated || isolationRequested()) return false;
  window.location.replace(isolationUrl(true));
  return true;
}

function setVoiceMode(mode: string): void {
  voiceMode.value = VOICE_MODES.includes(mode as VoiceMode) ? (mode as VoiceMode) : 'off';
  store(VOICE_KEY, voiceMode.value);
  if (reloadIsolated()) return;
  voiceArmed = true;
  radioVoice.setMode(voiceMode.value);
}

const voiceNote = computed(() => {
  const s = voiceStatus.value;
  if (!s) return null;
  if (s.loading !== null) return `KOKORO ${Math.round(s.loading * 100)}%`;
  if (s.speaking) return `TX ${s.speaking.callsign}`;
  return null;
});

// ── Controller push-to-talk (remembered; hold ` or the PTT button) ─────────
const MIC_KEY = 'atc.scope.mic';
const PTT_KEY = 'Backquote';
const MIC_LABELS: Record<MicMode, string> = {
  off: 'MIC OFF',
  browser: 'MIC BROWSER',
  moonshine: `MIC MOONSHINE (${MOONSHINE_DOWNLOAD_MB} MB once)`,
};
const micModes = availableMicModes();
const storedMic = stored(MIC_KEY);
const micMode = ref<MicMode>(
  micModes.includes(storedMic as MicMode) ? (storedMic as MicMode) : 'off'
);
const micStatus = shallowRef<ControllerMicStatus | null>(null);
const controllerMic = new ControllerMic((s) => (micStatus.value = s));

function setMicMode(mode: string): void {
  micMode.value = micModes.includes(mode as MicMode) ? (mode as MicMode) : 'off';
  store(MIC_KEY, micMode.value);
  if (reloadIsolated()) return;
  controllerMic.setMode(micMode.value);
}

const micNote = computed(() => {
  const s = micStatus.value;
  if (!s) return null;
  if (s.state === 'listening') return 'ATC TX';
  if (s.state === 'recognising') return 'ATC …';
  if (s.loading !== null) return `MOONSHINE ${Math.round(s.loading * 100)}%`;
  return null;
});

function pttDown(): void {
  if (micMode.value === 'off' || !scenarioName.value) return;
  // Pilot audio also needs a gesture; the PTT press is one.
  armVoice();
  if (!controllerMic.press() && micStatus.value?.loading != null)
    commandError.value = 'Moonshine still loading — type or wait';
}

async function pttUp(): Promise<void> {
  const t = await controllerMic.release();
  if (!t) {
    // Blocked microphone, recogniser down: say so where the controller looks.
    if (micStatus.value?.error) commandError.value = micStatus.value.error;
    return;
  }
  // Grammar re-scoring: the first alternative the phraseology parser understands.
  commandText.value = pickTranscript(t, (text) => interpret(text, commandContext()).ok);
  commandError.value = null;
  await submitCommand();
}

function onPttKey(e: KeyboardEvent): boolean {
  if (e.code !== PTT_KEY || micMode.value === 'off') return false;
  e.preventDefault();
  if (e.type === 'keydown' && !e.repeat) pttDown();
  if (e.type === 'keyup') void pttUp();
  return true;
}
const onKeyUp = (e: KeyboardEvent): void => void onPttKey(e);
/** A key released in another window never comes up here: end the transmission. */
const onWindowBlur = (): void => {
  if (micStatus.value?.state === 'listening') void pttUp();
};

function setSystem(id: string): void {
  systemId.value = findSystem(id).id;
  store(SYSTEM_KEY, systemId.value);
  requestDraw();
}

function setActiveSector(id: string): void {
  activeSector.value = id;
  store(sectorKey(), id);
  picture?.setSectors(map.value?.sectors ?? [], id || null);
  summarise();
  requestDraw();
}

function summarise(): void {
  summary.value = picture ? trafficSummary(picture.list(), picture.conflicts) : EMPTY_TRAFFIC;
}

/** Routes with ETOs of the tracks whose route is shown. */
function shownRoutes(): RoutePath[] {
  const a = airspace.value;
  if (!picture || !map.value || !a) return [];
  return picture
    .list()
    .filter((t) => t.routeShown)
    .map((t) => {
      const app = t.ac.target.approach;
      const threshold = app ? a.thresholds.get(runwayKey(app.airport, app.runway)) : undefined;
      return routePath(t.ac, simTime.value, map.value!.projection, (id) => a.fixes.get(id), threshold);
    });
}
const scenarioOptions = ref<{ id: string; name: string }[]>([]);

// ── Command line + comms log ───────────────────────────────────────────────
type LogLine = LogEntryVM & { id: number };
const commandInput = ref<HTMLInputElement | null>(null);
const commandText = ref('');
const commandError = ref<string | null>(null);
const log = ref<LogLine[]>([]);
const LOG_LINES = 6;
const history: string[] = [];
let historyIndex = -1;
let logId = 0;

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
  ['sectors', 'SECT'],
  ['areas', 'AREA'],
];

// ── Drawing ────────────────────────────────────────────────────────────────
function requestDraw(): void {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    if (!renderer || !map.value) return;
    const t0 = performance.now();
    renderer.draw(view, map.value, layers, system.value, { activeSector: activeSector.value || null });
    hits = picture
      ? renderer.drawTraffic(view, picture.list(), traffic, picture.conflicts, system.value, shownRoutes()).hits
      : [];
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
  for (const l of logEntriesFromSim(s.events)) addLog(l.kind, l.who, l.text, l.t);
  for (const t of pilotTransmissionsFromSim(s.events)) radioVoice.say(t.callsign, t.spoken);
  landedCount.value += s.events.filter((e) => e.type === 'landed').length;
  picture.update(s);
  simTime.value = s.t;
  summarise();
  if (traffic.selected && !picture.get(traffic.selected)) traffic.selected = null;
  selectedAc.value = traffic.selected ? picture.get(traffic.selected)!.ac : null;
  requestDraw();
}

function select(callsign: string | null): void {
  traffic.selected = callsign;
  selectedAc.value = callsign ? picture?.get(callsign)?.ac ?? null : null;
  requestDraw();
}

// ── Commands ───────────────────────────────────────────────────────────────
function addLog(kind: LogLine['kind'], who: string, text: string, t = simTime.value): void {
  log.value = [...log.value, { id: ++logId, t, kind, who, text }].slice(-LOG_LINES);
}

const fixIds = computed(() => [...(airspace.value?.fixes.keys() ?? [])]);

const commandContext = (): TransmissionContext => ({
  callsigns: picture?.list().map((t) => t.callsign) ?? [],
  selected: traffic.selected,
  hasFix: (id) => airspace.value?.fixes.has(id) ?? false,
  fixes: fixIds.value,
  hasIls: (airport, runway) => airspace.value?.ilsRunways.has(runwayKey(airport, runway)) ?? false,
  aircraft: (cs) => picture?.get(cs)?.ac,
});

/** Live interpretation of what is being typed. */
const commandPreview = computed(() => {
  if (!commandText.value.trim() || !picture) return null;
  // Re-evaluate when the traffic or the selection changes.
  void simTime.value;
  void selectedAc.value;
  const r = interpret(commandText.value, commandContext());
  if (!r.ok) return { ok: false, text: r.error };
  return {
    ok: true,
    text: instruction(r.message, picture.get(r.message.to)?.ac, airspace.value?.phrase).text,
  };
});

function sent(input: string): void {
  history.unshift(input);
  historyIndex = -1;
  commandText.value = '';
}

async function submitCommand(): Promise<void> {
  const input = commandText.value.trim();
  if (!input || !session || !picture) return;
  const r = interpret(input, commandContext());
  const phrase = airspace.value?.phrase;
  if (!r.ok) {
    // Phraseology the addressed pilot did not understand still went out on frequency.
    if (r.spoken && r.callsign) {
      sent(input);
      addLog('atc', 'ATC', input);
      const said = sayAgain(r.callsign);
      addLog('pilot', r.callsign, said.text);
      radioVoice.say(r.callsign, said.spoken);
    }
    commandError.value = r.error;
    return;
  }
  const ac = picture.get(r.message.to)?.ac;
  sent(input);
  commandError.value = null;
  if (traffic.selected !== r.message.to) select(r.message.to);
  // The parser only accepts aircraft on the scope, so the readback follows at once;
  // performance problems come back later as "unable" (snapshot events).
  addLog('atc', 'ATC', r.spoken ? input : instruction(r.message, ac, phrase).text);
  const rb = readback(r.message, ac, phrase);
  addLog('pilot', r.message.to, rb.text);
  radioVoice.say(r.message.to, rb.spoken);
  const issued = await session.issue(r.message);
  if (!issued.ok) addLog('error', r.message.to, issued.reason ?? 'not delivered');
}

function onCommandKey(e: KeyboardEvent): void {
  switch (e.key) {
    case 'Enter':
      e.preventDefault();
      void submitCommand();
      break;
    case 'ArrowUp':
      e.preventDefault();
      if (historyIndex < history.length - 1) commandText.value = history[++historyIndex]!;
      break;
    case 'ArrowDown':
      e.preventDefault();
      historyIndex = Math.max(-1, historyIndex - 1);
      commandText.value = historyIndex >= 0 ? history[historyIndex]! : '';
      break;
    case 'Escape':
      e.preventDefault();
      if (commandText.value) commandText.value = '';
      else commandInput.value?.blur();
      break;
  }
}

function onCommandInput(): void {
  commandError.value = null;
  historyIndex = -1;
}

const commandPlaceholder = computed(() => {
  const typed = traffic.selected
    ? `${traffic.selected} › D080 H240 S220 or phraseology · Enter`
    : 'DAL1192 D080 H240 S220 or "Delta 1192 descend and maintain 8000" · Enter';
  return micMode.value === 'off' ? typed : `${typed} · hold \` to talk`;
});

const logTime = clockMs;

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

// ── Interaction: drag to pan, drag a data block to move it, click to select,
//    wheel / pinch to zoom, keys ─────────────────────────────────────────────
const pointers = new Map<number, { x: number; y: number }>();
let pinchDistance = 0;
let pressAt: { x: number; y: number } | null = null;
const CLICK_SLOP_PX = 4;
/** Data block held with the primary button: its callsign and the grab point inside it, px. */
let labelDrag: { callsign: string; grab: { x: number; y: number } } | null = null;
/** Pointer over a data block (grab cursor) or dragging one (grabbing). */
const labelHover = ref<'grab' | 'grabbing' | null>(null);

const local = (e: PointerEvent | WheelEvent) => {
  const r = canvas.value!.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
};

function onPointerDown(e: PointerEvent): void {
  canvas.value?.setPointerCapture(e.pointerId);
  const p = local(e);
  pointers.set(e.pointerId, p);
  pressAt = pointers.size === 1 ? p : null;
  labelDrag = null;
  if (pointers.size === 1 && e.button === 0) {
    const hit = hitTestDetail(hits, p);
    if (hit?.kind === 'label') {
      labelDrag = { callsign: hit.callsign, grab: { x: p.x - hit.x, y: p.y - hit.y } };
      labelHover.value = 'grabbing';
    }
  }
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchDistance = Math.hypot(a!.x - b!.x, a!.y - b!.y);
  }
}

function onPointerMove(e: PointerEvent): void {
  const p = local(e);
  if (map.value) cursor.value = map.value.projection.toGeo(view.toLocal(p));
  const prev = pointers.get(e.pointerId);
  if (!prev) {
    labelHover.value = hitTestDetail(hits, p)?.kind === 'label' ? 'grab' : null;
    return;
  }
  pointers.set(e.pointerId, p);
  if (pressAt && Math.hypot(p.x - pressAt.x, p.y - pressAt.y) > CLICK_SLOP_PX) pressAt = null;
  if (labelDrag && pointers.size === 1) {
    // Within the click slop the press may still be a click that selects.
    const track = pressAt ? undefined : picture?.get(labelDrag.callsign);
    if (track) {
      const s = view.toScreen(track.xy);
      picture!.setLabelOffset(labelDrag.callsign, {
        x: p.x - labelDrag.grab.x - s.x,
        y: p.y - labelDrag.grab.y - s.y,
      });
    }
  } else if (pointers.size === 1) {
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
  if (e.type === 'pointerup' && pressAt && pointers.size === 1) {
    const hit = hitTestDetail(hits, local(e));
    // The track symbol toggles the route with ETOs; the label only selects.
    if (hit?.kind === 'target') picture?.toggleRoute(hit.callsign);
    select(hit?.callsign ?? null);
    // Mouse users type the command next; on touch the keyboard would cover the scope.
    if (hit && e.pointerType === 'mouse') commandInput.value?.focus();
  }
  pressAt = null;
  if (labelDrag) labelHover.value = 'grab';
  labelDrag = null;
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
  // Push-to-talk works while typing, too.
  if (onPttKey(e)) return;
  // Typing in the command line is not a scope shortcut.
  if (e.target instanceof HTMLInputElement) return;
  if ((e.key === 'Enter' || e.key === '/') && commandInput.value) {
    e.preventDefault();
    commandInput.value.focus();
    return;
  }
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
const readout = computed(() => {
  const c = cursor.value;
  const a = airspace.value;
  return c && a ? cursorReadout(c, a.reference, a.magVar) : '';
});

const clock = computed(() => clockHms(simTime.value));

const selectedInfo = computed(() => {
  const ac = selectedAc.value;
  return ac ? aircraftDetail(aircraftFromSim(ac, airspace.value?.magVar ?? 0)) : null;
});

// ── Lifecycle ──────────────────────────────────────────────────────────────
async function startTraffic(pack: AirspacePack, m: VideoMap): Promise<void> {
  const wanted = typeof route.query.scenario === 'string' ? route.query.scenario : undefined;
  scenarioId.value = wanted ?? scenariosForPack(pack.meta.id)[0]?.id ?? 'none';
  if (wanted === 'none') return;
  const script = wanted ? findScenario(wanted) : scenariosForPack(pack.meta.id)[0];
  if (!script) {
    if (wanted) throw new Error(`Unknown scenario "${wanted}"`);
    return;
  }
  const built = buildScenario(script, pack);
  picture = new TrafficPicture(m.projection);
  picture.setSectors(m.sectors, activeSector.value || null);
  scenarioName.value = script.name;
  session = await SimSession.start(built.config, built.traffic, onSnapshot);
  session.rate = simRate.value;
  session.paused = paused.value;
}

function stopTraffic(): void {
  radioVoice.clear();
  session?.dispose();
  session = null;
  picture = null;
  scenarioName.value = null;
  summary.value = EMPTY_TRAFFIC;
  landedCount.value = 0;
  simTime.value = 0;
  log.value = [];
  select(null);
}

/** Switches scenario in place (keeps the view, restarts the sim). */
async function changeScenario(id: string): Promise<void> {
  if (!loadedPack || !map.value) return;
  await router.replace({ query: { ...route.query, scenario: id } });
  stopTraffic();
  try {
    await startTraffic(loadedPack, map.value);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
  requestDraw();
}

// "CA" blinks about twice a second while any pair is alerting.
function blink(): void {
  if (picture && picture.conflicts.length > 0) {
    traffic.blinkOn = !traffic.blinkOn;
    requestDraw();
  } else if (!traffic.blinkOn) {
    traffic.blinkOn = true;
  }
}

// ── Areas ──────────────────────────────────────────────────────────────────
const areaOptions = ref(buildAreaOptions(AREAS, null, !!import.meta.env.DEV));

function changeArea(packId: string): void {
  if (packId !== route.params.packId) void router.push({ name: 'Scope', params: { packId } });
}

/** Loads an area's pack (and its traffic), replacing whatever was on the scope. */
async function loadArea(packId: string): Promise<void> {
  stopTraffic();
  map.value = null;
  airspace.value = null;
  loadedPack = null;
  error.value = null;
  loading.value = true;
  view.centre = { x: 0, y: 0 };
  try {
    const { pack } = await loadPack(packId);
    loadedPack = pack;
    scenarioOptions.value = scenariosForPack(pack.meta.id).map((s) => ({ id: s.id, name: s.name }));
    const m = buildVideoMap(pack);
    map.value = m;
    airspace.value = airspaceFromPack(pack, m);
    const savedSector = stored(sectorKey()) ?? '';
    activeSector.value = m.sectors.some((s) => s.id === savedSector) ? savedSector : '';
    fitCanvas();
    await startTraffic(pack, m);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
  requestDraw();
}

watch(
  () => route.params.packId,
  (id) => {
    if (typeof id === 'string' && id) void loadArea(id);
  }
);

onMounted(async () => {
  ctx = canvas.value?.getContext('2d') ?? null;
  if (ctx) renderer = new ScopeRenderer(ctx);
  resizeObserver = new ResizeObserver(fitCanvas);
  if (host.value) resizeObserver.observe(host.value);
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onWindowBlur);
  blinkTimer = setInterval(blink, 500);
  loadPackManifest()
    .then((packs) => {
      areaOptions.value = buildAreaOptions(AREAS, packs, !!import.meta.env.DEV);
    })
    .catch(() => undefined);
  if (reloadIsolated()) return;
  controllerMic.setMode(micMode.value);
  if (voiceMode.value !== 'off') {
    window.addEventListener('pointerdown', armVoice);
    window.addEventListener('keydown', armVoice);
  }
  await loadArea(String(route.params.packId));
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  window.removeEventListener('keydown', onKey);
  window.removeEventListener('keyup', onKeyUp);
  window.removeEventListener('blur', onWindowBlur);
  if (frame) cancelAnimationFrame(frame);
  if (blinkTimer) clearInterval(blinkTimer);
  window.removeEventListener('pointerdown', armVoice);
  window.removeEventListener('keydown', armVoice);
  radioVoice.dispose();
  controllerMic.dispose();
  session?.dispose();
  session = null;
});
</script>

<template>
  <div ref="host" class="scope" :style="{ background: system.map.background }">
    <canvas
      ref="canvas"
      class="scope-canvas"
      :class="labelHover"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @pointerleave="(cursor = null), (labelHover = null)"
      @wheel="onWheel"
    />

    <div class="panel top-left">
      <button class="btn" @click="router.push({ name: 'home' })">HOME</button>
      <select class="btn area" :value="String(route.params.packId)" title="Area" @change="changeArea(($event.target as HTMLSelectElement).value)">
        <option v-for="a in areaOptions" :key="a.packId" :value="a.packId" :disabled="!a.available" :title="a.note">
          {{ a.name }}{{ a.available ? '' : ' (not built)' }}
        </option>
      </select>
      <select
        v-if="sectorOptions.length"
        class="btn sector"
        :value="activeSector"
        title="Sector"
        @change="setActiveSector(($event.target as HTMLSelectElement).value)"
      >
        <option value="">All sectors</option>
        <option v-for="s in sectorOptions" :key="s.id" :value="s.id">{{ s.label }}</option>
      </select>
      <span v-else-if="map" class="title dim-title">no sectors defined</span>
      <span v-if="airspace" class="title">AIRAC {{ airspace.airac }}</span>
      <select
        v-if="map && scenarioOptions.length"
        class="btn scenario"
        :value="scenarioId"
        title="Scenario"
        @change="changeScenario(($event.target as HTMLSelectElement).value)"
      >
        <option v-for="s in scenarioOptions" :key="s.id" :value="s.id">{{ s.name }}</option>
        <option value="none">No traffic</option>
      </select>
      <select class="btn" :value="systemId" title="ATC system" @change="setSystem(($event.target as HTMLSelectElement).value)">
        <option v-for="s in SCOPE_SYSTEMS" :key="s.id" :value="s.id" :title="s.description">{{ s.name }}</option>
      </select>
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
        <select
          class="btn voice"
          :value="voiceMode"
          :title="voiceStatus?.error ?? 'Pilot voices'"
          :class="{ bad: voiceStatus?.error }"
          @change="setVoiceMode(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="m in VOICE_MODES" :key="m" :value="m">{{ VOICE_LABELS[m] }}</option>
        </select>
        <span v-if="voiceNote" class="clock">{{ voiceNote }}</span>
        <select
          v-if="micModes.length > 1"
          class="btn voice"
          :value="micMode"
          :title="micStatus?.error ?? 'Controller speech recognition (hold ` to talk)'"
          :class="{ bad: micStatus?.error }"
          @change="setMicMode(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="m in micModes" :key="m" :value="m">{{ MIC_LABELS[m] }}</option>
        </select>
        <span v-if="micNote" class="clock">{{ micNote }}</span>
      </div>
      <div v-if="selectedInfo" class="info">
        <div class="info-head">{{ selectedInfo.head }}</div>
        <div>{{ selectedInfo.alt }}  {{ selectedInfo.hdg }}</div>
        <div>{{ selectedInfo.spd }}</div>
        <div v-if="selectedInfo.nav" class="dim">{{ selectedInfo.nav }}</div>
      </div>
    </div>


    <div v-if="scenarioName" class="comms">
      <div v-for="l in log" :key="l.id" class="log-line" :class="l.kind">
        <span class="dim">{{ logTime(l.t) }}</span>
        <span class="who">{{ l.who }}</span>
        <span>{{ l.text }}</span>
      </div>
      <div v-if="commandError || commandPreview" class="preview" :class="{ bad: commandError || !commandPreview?.ok }">
        {{ commandError ?? commandPreview?.text }}
      </div>
      <div class="command-row">
        <input
          ref="commandInput"
          v-model="commandText"
          class="command"
          :placeholder="commandPlaceholder"
          spellcheck="false"
          autocomplete="off"
          autocapitalize="characters"
          enterkeyhint="send"
          @keydown="onCommandKey"
          @input="onCommandInput"
        />
        <button
          v-if="micMode !== 'off'"
          class="btn ptt"
          :class="{ active: micStatus?.state === 'listening', bad: micStatus?.error }"
          :title="micStatus?.error ?? 'Hold to talk (or hold `)'"
          @pointerdown.prevent="pttDown"
          @pointerup="pttUp"
          @pointercancel="pttUp"
          @pointerleave="onWindowBlur"
          @contextmenu.prevent
        >
          PTT
        </button>
      </div>
    </div>

    <div class="panel bottom-left">
      <span>RNG {{ rangeNm.toFixed(rangeNm < 10 ? 1 : 0) }} NM</span>
      <span v-if="scenarioName">ACFT {{ summary.aircraft }}</span>
      <span v-if="scenarioName && activeSector">{{ activeSector }} OWN {{ summary.owned }} · INC {{ summary.incoming }}</span>
      <span v-if="summary.conflicts" class="alert-count">CA {{ summary.conflicts }}</span>
      <span v-if="landedCount">LDG {{ landedCount }}</span>
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
/* The size is set inline by fitCanvas(); cursors go through classes so Vue
   never patches (or removes) the canvas style attribute. */
.scope-canvas {
  display: block;
  touch-action: none;
  cursor: crosshair;
}
.scope-canvas.grab {
  cursor: grab;
}
.scope-canvas.grabbing {
  cursor: grabbing;
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
/* Readable on light system backgrounds (Selex grey) as well as dark ones. */
.bottom-left > span,
.title {
  padding: 2px 6px;
  border-radius: 3px;
  background: rgba(11, 22, 32, 0.78);
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
.comms {
  position: absolute;
  left: 8px;
  /* Clear of the status row and the scale bar. */
  bottom: calc(env(safe-area-inset-bottom, 0px) + 44px);
  width: min(620px, calc(100vw - 16px));
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.log-line {
  display: flex;
  gap: 8px;
  padding: 1px 6px;
  background: rgba(11, 22, 32, 0.75);
  color: #a9bfca;
}
.log-line > span:last-child {
  flex: 1;
}
.log-line .who {
  min-width: 64px;
}
.log-line.atc .who {
  color: #cfe0e8;
}
.log-line.pilot {
  color: #8fe3a8;
}
.log-line.alert {
  color: #ff5a4f;
}
.log-line.info {
  color: #5f8396;
}
.alert-count {
  color: #ff5a4f;
}
.scenario {
  max-width: 220px;
}
.sector {
  max-width: 260px;
}
.dim-title {
  color: #5f8396;
}
.log-line.unable,
.log-line.error {
  color: #e07a6a;
}
.preview {
  padding: 2px 6px;
  color: #8fb0c0;
  background: rgba(11, 22, 32, 0.75);
}
.preview.bad {
  color: #e0a46a;
}
.command-row {
  display: flex;
  gap: 4px;
  margin-top: 2px;
}
.command {
  flex: 1;
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid #21404f;
  border-radius: 3px;
  background: rgba(15, 34, 48, 0.92);
  color: #e6f2f8;
  font: inherit;
  font-size: 13px;
  text-transform: uppercase;
  outline: none;
}
.command:focus {
  border-color: #3a5f72;
}
.command::placeholder {
  color: #35596d;
  text-transform: none;
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
.ptt {
  touch-action: none;
  user-select: none;
}
.ptt.active {
  border-color: #b8483f;
  background: #4a1d1a;
  color: #ffd2cc;
}
.btn.bad {
  border-color: #6a3a2a;
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
