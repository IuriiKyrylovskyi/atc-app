<template>
  <Transition name="popup">
    <div
      v-if="visible && plane"
      class="speed-popup"
      role="dialog"
      :aria-label="`Speed control for ${plane.callsign}`"
    >
      <!-- Header -->
      <div class="popup-header">
        <div class="header-icon" aria-hidden="true">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            width="22"
            height="22"
          >
            <path
              d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"
            />
          </svg>
        </div>
        <div class="header-text">
          <div class="header-type">{{ plane.aircraftType }} · {{ plane.callsign }}</div>
          <div class="header-sub">{{ plane.weightClass }} · {{ statusLabel }}</div>
        </div>
        <button class="close-btn" aria-label="Close speed control" @click="close">✕</button>
      </div>

      <!-- Body -->
      <div class="popup-body">
        <!-- Left column: commands -->
        <div class="col-actions">
          <div class="col-label">Commands</div>
          <div class="col-btns">
            <button class="action-btn" @click="stageSpeed(plane.maxSpeed)">
              <span class="btn-icon" aria-hidden="true">▲</span>
              Set max speed
            </button>
            <button class="action-btn" @click="stageSpeed(plane.minSpeed)">
              <span class="btn-icon" aria-hidden="true">▼</span>
              Set min speed
            </button>
            <button class="action-btn danger" :disabled="!liveIsConnected" @click="disconnect">
              <span class="btn-icon" aria-hidden="true">✕</span>
              {{ disconnectLabel }}
            </button>
          </div>
          <!-- APPLY button — full width, bottom of left column -->
          <button class="apply-btn" aria-label="Apply speed instruction" @click="applyAndClose">
            APPLY
          </button>
        </div>

        <!-- Right column: speed -->
        <div class="col-speed">
          <div class="col-label">Speed</div>

          <!-- Speed table -->
          <div class="speed-table">
            <div class="speed-row">
              <span class="speed-name">Max</span>
              <span class="speed-val dim"
                >{{ plane.maxSpeed }}<span class="speed-unit">kt</span></span
              >
            </div>
            <div class="speed-row highlight-row">
              <span class="speed-name set-label">Set</span>
              <span class="speed-val active" :class="{ pending: isPending }" aria-live="polite">
                {{ stagedSpeed }}<span class="speed-unit">kt</span>
              </span>
            </div>
            <div class="speed-row">
              <span class="speed-name">Min</span>
              <span class="speed-val dim"
                >{{ plane.minSpeed }}<span class="speed-unit">kt</span></span
              >
            </div>
          </div>

          <!-- ± controls — vertical stack: + top, display middle, − bottom -->
          <div class="speed-ctrl-col">
            <button
              class="pm-btn pm-plus"
              :class="{ 'pm-active': isPending }"
              :disabled="stagedSpeed >= plane.maxSpeed"
              aria-label="Increase speed by 10 knots"
              @click="adj(+STEP)"
            >
              +
            </button>
            <div class="pm-display" :class="{ pending: isPending }" aria-live="polite">
              {{ stagedSpeed }}
            </div>
            <button
              class="pm-btn pm-minus"
              :disabled="stagedSpeed <= plane.minSpeed"
              aria-label="Decrease speed by 10 knots"
              @click="adj(-STEP)"
            >
              −
            </button>
          </div>
        </div>
      </div>

      <!-- Status bar -->
      <div class="status-bar">
        <div class="status-dot" :class="{ 'dot-pending': isPending }" aria-hidden="true"></div>
        <span class="status-text">{{ statusBarLabel }}</span>
        <span class="step-badge">±10 kt</span>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
// =============================================================================
// CRITICAL FIXES — DO NOT REVERT (see inline comments at each site for detail)
// =============================================================================
//
// 1. liveIsApproaching / liveIsWaypoint MUST BE TWO SEPARATE REFS, NOT ONE
//    A plane can only ever be connected to a runway OR a waypoint, never
//    both — but the popup must independently track and react to EITHER
//    becoming true or false while it stays open. Collapsing these into a
//    single "liveIsConnected" boolean loses which TYPE of connection is
//    active, so the button label ("Cancel approach" vs "Cancel en-route")
//    cannot be derived correctly. liveIsConnected below is a COMPUTED
//    derived from these two — never make it a standalone ref again, or it
//    can drift out of sync with the two source flags.
//
// 2. INITIAL STATE COMES FROM props.plane, BUT MUST BE KEPT LIVE AFTER OPEN
//    The prop is a SNAPSHOT taken at tap time (see InputSystem.ts
//    'plane:tapped' emit — it must include BOTH isApproaching AND
//    isApproachingWaypoint, or this initial sync breaks for waypoint-
//    connected planes). After that snapshot, the prop never updates again
//    on its own. The plane:attached / plane:cancelApproach bus listeners
//    below are NOT optional extras — they are what keeps the button correct
//    if the plane connects or disconnects WHILE the popup is already open.
//    ⚠️  Do not remove the onMounted/onUnmounted bus listener registration —
//        without it the button only reflects the state at the moment the
//        popup was opened, never updates again afterward.
//
// 3. disconnect() MUST NOT BE A TOGGLE
//    There is no "resume" path — once cancelled, the plane is free-flying
//    and must be re-drawn by the player. disconnect() is a one-shot action
//    gated by liveIsConnected; do not reintroduce resume/un-cancel logic.
//
// =============================================================================

import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { gameEventBus } from '@/services/EventBus';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PopupPlaneData {
  id: number;
  callsign: string;
  aircraftType: string;
  weightClass: string;
  currentSpeed: number;
  minSpeed: number;
  maxSpeed: number;
  /** True when locked onto a runway approach. */
  isApproaching: boolean;
  /** True when locked onto a waypoint en-route. */
  isApproachingWaypoint: boolean;
}

// ─── Props / emits ────────────────────────────────────────────────────────────

const props = defineProps<{ plane: PopupPlaneData | null; visible: boolean }>();
const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'cancel-approach', planeId: number): void;
}>();

// ─── State ────────────────────────────────────────────────────────────────────
const STEP = 10;
const stagedSpeed = ref(220);
const confirmedSpeed = ref(220);

/**
 * Two independent live flags — one per connection type.
 * Initialised from the prop snapshot on open, then kept current via bus
 * listeners so the button label and disabled state react instantly to game
 * state changes without requiring a new tap.
 *
 *   liveIsApproaching — plane is locked onto a runway  → "Cancel approach" active
 *   liveIsWaypoint    — plane is locked onto a waypoint → "Cancel en-route" active
 *
 * liveIsConnected is a computed derived from these two so it's always in sync.
 */
const liveIsApproaching = ref(false);
const liveIsWaypoint = ref(false);

// Sync from fresh prop snapshot each time the popup opens for a (possibly
// different) plane.
watch(
  () => props.plane,
  (p) => {
    if (p) {
      stagedSpeed.value = p.currentSpeed;
      confirmedSpeed.value = p.currentSpeed;
      liveIsApproaching.value = p.isApproaching;
      liveIsWaypoint.value = p.isApproachingWaypoint;
    }
  },
  { immediate: true }
);

// ─── Bus listeners ────────────────────────────────────────────────────────────

/**
 * plane:attached fires when a drag commits onto a runway or waypoint.
 * Signature: (planeId: number, type: 'runway' | 'waypoint')
 * Enables the correct button if this is the currently selected plane.
 */
function onAttached(planeId: number, type: 'runway' | 'waypoint') {
  if (props.plane?.id !== planeId) return;
  if (type === 'waypoint') {
    liveIsWaypoint.value = true;
    liveIsApproaching.value = false;
  } else {
    liveIsApproaching.value = true;
    liveIsWaypoint.value = false;
  }
}

/**
 * plane:cancelApproach fires when the disconnect button is pressed or the
 * game cancels the connection. Disables both buttons immediately.
 */
function onCancelApproach({ planeId }: { planeId: number }) {
  if (props.plane?.id !== planeId) return;
  liveIsApproaching.value = false;
  liveIsWaypoint.value = false;
}

onMounted(() => {
  gameEventBus.on('plane:attached', onAttached);
  gameEventBus.on('plane:cancelApproach', onCancelApproach);
});

onUnmounted(() => {
  gameEventBus.off('plane:attached', onAttached);
  gameEventBus.off('plane:cancelApproach', onCancelApproach);
});

// ─── Computed ─────────────────────────────────────────────────────────────────

const isPending = computed(() => stagedSpeed.value !== confirmedSpeed.value);

/** Derived — always in sync with the two live flags. */
const liveIsConnected = computed(() => liveIsApproaching.value || liveIsWaypoint.value);

/** Button label reflects current connection type. */
const disconnectLabel = computed(() =>
  liveIsWaypoint.value ? 'Cancel en-route' : 'Cancel approach'
);

const statusLabel = computed(() => {
  if (liveIsApproaching.value) return 'On approach';
  if (liveIsWaypoint.value) return 'En route (waypoint)';
  return 'En route';
});

const statusBarLabel = computed(() => {
  if (!props.plane) return '';
  if (isPending.value) return 'Pending — tap Apply to confirm';
  if (confirmedSpeed.value === props.plane.maxSpeed) return 'Max speed set — expedite';
  if (confirmedSpeed.value === props.plane.minSpeed) return 'Min speed set — sequence in';
  return 'Speed instruction active';
});

// ─── Actions ──────────────────────────────────────────────────────────────────

/**
 * ± buttons snap to the next/previous multiple of 10.
 *   +: 278 → 280 → 290 …
 *   −: 278 → 270 → 260 …
 */
function adj(delta: number) {
  console.log('-----delta----', delta);
  if (!props.plane) return;
  const cur = stagedSpeed.value;
  const next =
    delta > 0
      ? cur % 10 === 0
        ? cur + 10
        : Math.ceil(cur / 10) * 10
      : cur % 10 === 0
      ? cur - 10
      : Math.floor(cur / 10) * 10;
  if (next < props.plane.minSpeed || next > props.plane.maxSpeed) return;
  stagedSpeed.value = next;
}

function stageSpeed(val: number) {
  if (!props.plane) return;
  stagedSpeed.value = val;
}

function applyAndClose() {
  if (!props.plane) return;
  confirmedSpeed.value = stagedSpeed.value;
  gameEventBus.emit('plane:setSpeed', { planeId: props.plane.id, speed: stagedSpeed.value });
  close();
}

/**
 * Disconnect from runway or waypoint. One-shot — no resume.
 * GameScene clears path + resets level via plane:cancelApproach.
 * onCancelApproach above disables the button immediately.
 */
function disconnect() {
  if (!props.plane || !liveIsConnected.value) return;
  emit('cancel-approach', props.plane.id);
  gameEventBus.emit('plane:cancelApproach', { planeId: props.plane.id });
}

function close() {
  stagedSpeed.value = confirmedSpeed.value;
  gameEventBus.emit('plane:tap-deselect');
  emit('close');
}
</script>

<style scoped>
/* ── Layout ── */
.speed-popup {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 900;
  width: 340px;
  background: rgba(255, 255, 255, 0.9);
  border-radius: 18px;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0, 60, 130, 0.22), 0 1px 0 rgba(255, 255, 255, 0.9) inset;
}

/* ── Transitions ── */
.popup-enter-active,
.popup-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.popup-enter-from,
.popup-leave-to {
  opacity: 0;
  transform: translateY(12px) scale(0.97);
}

/* ── Header ── */
.popup-header {
  background: #1868c8;
  padding: 8px 12px 8px 14px;
  display: flex;
  align-items: center;
  gap: 11px;
}
.header-icon {
  width: 38px;
  height: 38px;
  background: rgba(255, 255, 255, 0.18);
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.header-text {
  flex: 1;
  min-width: 0;
}
.header-type {
  font-size: 14px;
  font-weight: 700;
  color: #fff;
  letter-spacing: 0.02em;
}
.header-sub {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.65);
  margin-top: 2px;
  letter-spacing: 0.02em;
}
.close-btn {
  width: 44px;
  height: 44px;
  background: rgba(255, 255, 255, 0.92);
  border: none;
  border-radius: 12px;
  color: #1868c8;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 16px;
  font-weight: 700;
  flex-shrink: 0;
  transition: background 0.12s, transform 0.1s;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
}
.close-btn:hover {
  background: #fff;
  transform: scale(1.05);
}
.close-btn:active {
  transform: scale(0.95);
}

/* ── Body ── */
.popup-body {
  display: flex;
}

/* ── Commands column ── */
.col-actions {
  flex: 1;
  padding: 8px 12px 8px 14px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 8px;
}
.col-label {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #3e6da0;
  margin-bottom: 1px;
}
.col-btns {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 22px;
}
.action-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 18px;
  font-weight: 600;
  color: #1868c8;
  background: #f0f5ff;
  border: 1px solid #ccdaf5;
  border-radius: 10px;
  padding: 16px 11px;
  cursor: pointer;
  text-align: left;
  letter-spacing: 0.01em;
  line-height: 1.2;
  transition: background 0.12s, border-color 0.12s;
  width: 100%;
}
.action-btn:hover {
  background: #ddeaff;
  border-color: #aac4ef;
}
.action-btn:active {
  background: #c8d8f8;
}
.action-btn.danger {
  color: #b33;
  background: #fff2f2;
  border-color: #f5c5c5;
}
.action-btn.danger:hover:not(:disabled) {
  background: #ffe0e0;
  border-color: #e8aaaa;
}
.action-btn.danger:disabled {
  color: #bbb;
  background: #f5f5f5;
  border-color: #e0e0e0;
  cursor: not-allowed;
  opacity: 0.5;
}
.action-btn.danger:disabled .btn-icon {
  background: rgba(0, 0, 0, 0.05);
  color: #bbb;
}
.btn-icon {
  width: 20px;
  height: 20px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 11px;
  background: rgba(24, 104, 200, 0.12);
  color: #1868c8;
}
.action-btn.danger .btn-icon {
  background: rgba(180, 0, 0, 0.1);
  color: #b33;
}

/* APPLY button */
.apply-btn {
  position: relative;
  right: -24px;
  margin-top: 2px;
  width: 100%;
  padding: 12px 0;
  background: #1868c8;
  color: #fff;
  border: none;
  border-radius: 12px;
  font-size: 20px;
  font-weight: 800;
  letter-spacing: 0.1em;
  cursor: pointer;
  transition: background 0.12s, transform 0.1s;
  box-shadow: 0 2px 10px rgba(24, 104, 200, 0.32);
}
.apply-btn:hover {
  background: #1256a8;
}
.apply-btn:active {
  background: #0e3e80;
  transform: scale(0.97);
}

/* ── Speed column ── */
.col-speed {
  width: 116px;
  padding: 8px 13px 8px 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* Speed table */
.speed-table {
  display: flex;
  flex-direction: column;
}
.speed-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 5px 0;
  border-bottom: 1px solid #eef2f9;
}
.speed-row:last-child {
  border-bottom: none;
}
.speed-name {
  font-size: 14px;
  font-weight: 700;
  color: #698ab5;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.speed-name.set-label {
  color: #1868c8;
  font-weight: 800;
}
.speed-val {
  font-size: 22px;
  font-weight: 600;
  color: #1868c8;
  font-variant-numeric: tabular-nums;
}
.speed-val.active {
  font-size: 24px;
  font-weight: 800;
  color: #1868c8;
  transition: color 0.15s;
}
.speed-val.active.pending {
  color: #d97706;
}
.speed-val.dim {
  color: #7aa4db;
  font-size: 18px;
}
.speed-unit {
  font-size: 14px;
  color: inherit;
  margin-left: 1px;
  font-weight: 500;
}

/* ── ± controls — vertical stack ── */
.speed-ctrl-col {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
}
.pm-btn {
  width: 60px;
  height: 60px;
  border-radius: 14px;
  border: 1.5px solid #ccdaf5;
  background: #f4f8ff;
  color: #1868c8;
  font-size: 26px;
  font-weight: 400;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.1s, opacity 0.1s, transform 0.1s, border-color 0.15s;
  user-select: none;
  line-height: 1;
}
.pm-btn.pm-plus.pm-active {
  border-color: #f59e0b;
  box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.25);
}
.pm-btn:hover:not(:disabled) {
  background: #ddeaff;
  border-color: #aac4ef;
}
.pm-btn:active:not(:disabled) {
  transform: scale(0.93);
}
.pm-btn:disabled {
  opacity: 0.28;
  cursor: not-allowed;
}

.pm-display {
  width: 100px;
  height: 46px;
  text-align: center;
  line-height: 46px;
  font-size: 34px;
  font-weight: 800;
  color: #0e50a8;
  background: #eef4ff;
  border: 1.5px solid #ccdaf5;
  border-radius: 14px;
  font-variant-numeric: tabular-nums;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}
.pm-display.pending {
  color: #d97706;
  border-color: #fcd34d;
  background: #fffbeb;
}

/* ── Status bar ── */
.status-bar {
  padding: 4px 14px;
  background: #f6f9ff;
  border-top: 1px solid #e8eef8;
  display: flex;
  align-items: center;
  gap: 6px;
}
.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #1868c8;
  flex-shrink: 0;
  animation: blink 2s step-end infinite;
}
.status-dot.dot-pending {
  background: #d97706;
  animation: blink-fast 0.8s step-end infinite;
}
@keyframes blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.25;
  }
}
@keyframes blink-fast {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.2;
  }
}
.status-text {
  font-size: 10px;
  color: #6a90bb;
  font-weight: 500;
  flex: 1;
  letter-spacing: 0.02em;
}
.step-badge {
  font-size: 9px;
  font-weight: 700;
  color: #1868c8;
  background: #ddeaff;
  border-radius: 5px;
  padding: 2px 6px;
}
</style>
