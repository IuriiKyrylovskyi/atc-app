/**
 * Deterministic simulation loop.
 *
 * - Fixed physics step (default 0.5 s); time is `steps × stepS`, never accumulated
 *   floats, so two runs with the same seed and the same messages produce identical
 *   event logs and states.
 * - Clearances reach an aircraft after a pilot reaction delay drawn from the seeded
 *   RNG, and are logged as events.
 * - The whole state is plain JSON: `saveState()` / `Simulation.restore()` give wind,
 *   rewind, reset and branch (ATC_ARCHITECTURE.md §14.4) for free.
 * - Aircraft can be scheduled to appear at a sim time (scenario traffic), which
 *   keeps scripted sessions deterministic and part of the saved state.
 * - No DOM, no timers: whoever owns the sim decides when to call `advance()`
 *   (a worker loop, the Academy server, or a test).
 */
import { magToTrue } from '../geo/magvar';
import type { LatLon } from '../geo/geodesy';
import { normDeg } from '../units';
import { performanceFor } from '../aircraft/performance';
import { stepAircraft, type Wind } from '../aircraft/dynamics';
import type {
  AircraftSpawn,
  AircraftState,
  AirspacePack,
  Clearance,
  Message,
  SimEvent,
  Snapshot,
} from '../model/types';
import { Rng } from './rng';

export interface SimConfig {
  seed: number;
  pack?: AirspacePack;
  /** Physics step, s. */
  stepS?: number;
  /** Pilot reaction delay range, s. Use [0, 0] in tests for immediate response. */
  pilotDelayS?: [number, number];
  wind?: Wind;
  /** Magnetic variation (°E) when there is no pack; packs carry their own. */
  magVar?: number;
}

interface PendingMessage {
  applyAt: number;
  message: Message;
}

interface ScheduledSpawn {
  atS: number;
  spawn: AircraftSpawn;
}

/** Serializable simulation state. */
export interface SimState {
  version: 1;
  step: number;
  carryS: number;
  rngState: number;
  aircraft: AircraftState[];
  pending: PendingMessage[];
  scheduled: ScheduledSpawn[];
  log: SimEvent[];
  /** Index into `log` of the first event not yet returned by `snapshot()`. */
  snapshotCursor: number;
}

export interface IssueResult {
  ok: boolean;
  reason?: string;
  applyAt?: number;
}

const DEFAULT_STEP_S = 0.5;
const DEFAULT_PILOT_DELAY: [number, number] = [2, 6];
const CALM: Wind = { fromDeg: 0, speedKt: 0 };

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export class Simulation {
  readonly config: Readonly<Required<Omit<SimConfig, 'pack'>>> & { pack?: AirspacePack };
  private state: SimState;
  private rng: Rng;
  private readonly fixes = new Map<string, LatLon>();

  constructor(config: SimConfig, state?: SimState) {
    this.config = {
      seed: config.seed,
      pack: config.pack,
      stepS: config.stepS ?? DEFAULT_STEP_S,
      pilotDelayS: config.pilotDelayS ?? DEFAULT_PILOT_DELAY,
      wind: config.wind ?? CALM,
      magVar: config.pack?.meta.magVar ?? config.magVar ?? 0,
    };
    for (const f of config.pack?.fixes ?? []) this.fixes.set(f.id, f.pos);
    this.state = state
      ? clone(state)
      : {
          version: 1,
          step: 0,
          carryS: 0,
          rngState: config.seed >>> 0,
          aircraft: [],
          pending: [],
          scheduled: [],
          log: [],
          snapshotCursor: 0,
        };
    this.rng = new Rng(this.state.rngState);
  }

  /** Recreates a simulation from a saved state (same config, e.g. same pack). */
  static restore(config: SimConfig, state: SimState): Simulation {
    return new Simulation(config, state);
  }

  // ── Time ─────────────────────────────────────────────────────────────────

  get time(): number {
    return this.state.step * this.config.stepS;
  }

  /** Advances by `seconds` of sim time in fixed steps (remainder carried over). */
  advance(seconds: number): void {
    let budget = this.state.carryS + seconds;
    const dt = this.config.stepS;
    while (budget + 1e-9 >= dt) {
      this.tick();
      budget -= dt;
    }
    this.state.carryS = Math.max(0, budget);
  }

  private tick(): void {
    const dt = this.config.stepS;
    this.applyDueMessages();
    for (const ac of this.state.aircraft) {
      const res = stepAircraft(ac, {
        dtS: dt,
        perf: performanceFor(ac.icaoType, ac.wake),
        wind: this.config.wind,
        fixPos: (id) => this.fixes.get(id),
      });
      if (res.fixReached) {
        this.log({ t: this.time + dt, type: 'fix_reached', callsign: ac.callsign, fix: res.fixReached });
        if (res.routeEnded) this.log({ t: this.time + dt, type: 'route_ended', callsign: ac.callsign, fix: res.fixReached });
      }
    }
    this.state.step += 1;
    // After the step, so an aircraft scheduled at t is on the scope at t.
    this.spawnDue();
    this.state.rngState = this.rng.state;
  }

  // ── Traffic ──────────────────────────────────────────────────────────────

  addAircraft(spawn: AircraftSpawn): void {
    if (this.find(spawn.callsign)) throw new Error(`Duplicate callsign ${spawn.callsign}`);
    const route = spawn.route ?? [];
    const unknown = route.filter((f) => !this.fixes.has(f));
    if (unknown.length > 0) throw new Error(`${spawn.callsign}: unknown route fix ${unknown.join(', ')}`);
    const ac: AircraftState = {
      callsign: spawn.callsign,
      icaoType: spawn.icaoType,
      wake: spawn.wake ?? 'M',
      squawk: spawn.squawk ?? '2000',
      origin: spawn.origin ?? 'scenario',
      pos: { ...spawn.pos },
      altFt: spawn.altFt,
      headingTrue: normDeg(spawn.headingTrue),
      trackTrue: normDeg(spawn.headingTrue),
      casKt: spawn.casKt,
      tasKt: 0,
      gsKt: 0,
      mach: 0,
      vsFpm: 0,
      ...(spawn.destination ? { destination: spawn.destination } : {}),
      target: {
        altFt: spawn.clearedAltFt ?? spawn.altFt,
        headingTrue: route.length > 0 ? null : normDeg(spawn.headingTrue),
        turn: null,
        casKt: spawn.clearedCasKt ?? spawn.casKt,
        mach: null,
        vsFpm: null,
        directFix: route[0] ?? null,
        route: route.slice(1),
      },
    };
    this.state.aircraft.push(ac);
    this.log({ t: this.time, type: 'aircraft_added', callsign: ac.callsign });
  }

  /** Adds the aircraft when sim time reaches `atS` (immediately if already past). */
  schedule(atS: number, spawn: AircraftSpawn): void {
    if (atS <= this.time + 1e-9) {
      this.addAircraft(spawn);
      return;
    }
    this.state.scheduled.push({ atS, spawn: clone(spawn) });
    this.state.scheduled.sort((a, b) => a.atS - b.atS);
  }

  private spawnDue(): void {
    const now = this.time;
    while (this.state.scheduled.length > 0 && this.state.scheduled[0]!.atS <= now + 1e-9) {
      const { spawn } = this.state.scheduled.shift()!;
      this.addAircraft(spawn);
    }
  }

  removeAircraft(callsign: string): void {
    const before = this.state.aircraft.length;
    this.state.aircraft = this.state.aircraft.filter((a) => a.callsign !== callsign);
    if (this.state.aircraft.length !== before) {
      this.log({ t: this.time, type: 'aircraft_removed', callsign });
    }
  }

  getAircraft(callsign: string): AircraftState | undefined {
    const ac = this.find(callsign);
    return ac ? clone(ac) : undefined;
  }

  // ── Clearances ───────────────────────────────────────────────────────────

  /** Queues a message; the pilot acts on it after the reaction delay. */
  issue(message: Message): IssueResult {
    if (!this.find(message.to)) {
      this.log({ t: this.time, type: 'message_rejected', message, reason: 'unknown callsign' });
      return { ok: false, reason: 'unknown callsign' };
    }
    const [min, max] = this.config.pilotDelayS;
    const delay = max > min ? this.rng.range(min, max) : min;
    this.state.rngState = this.rng.state;
    const applyAt = this.time + delay;
    this.state.pending.push({ applyAt, message: clone(message) });
    this.log({ t: this.time, type: 'message_received', message: clone(message), applyAt });
    return { ok: true, applyAt };
  }

  private applyDueMessages(): void {
    const now = this.time;
    const due = this.state.pending.filter((p) => p.applyAt <= now + 1e-9);
    if (due.length === 0) return;
    this.state.pending = this.state.pending.filter((p) => p.applyAt > now + 1e-9);
    for (const { message } of due) {
      const ac = this.find(message.to);
      if (!ac) continue;
      for (const c of message.clearances) this.applyClearance(ac, c);
    }
  }

  private applyClearance(ac: AircraftState, c: Clearance): void {
    const reject = (reason: string) =>
      this.log({ t: this.time, type: 'clearance_rejected', callsign: ac.callsign, clearance: c, reason });
    const perf = performanceFor(ac.icaoType, ac.wake);
    const t = ac.target;

    switch (c.kind) {
      case 'altitude':
        if (c.altFt < 0 || c.altFt > perf.ceilingFt) return reject('altitude outside performance');
        t.altFt = c.altFt;
        t.vsFpm = c.vsFpm ?? null;
        break;
      case 'heading':
        if (c.headingMag <= 0 || c.headingMag > 360) return reject('invalid heading');
        t.headingTrue = magToTrue(c.headingMag, this.config.magVar);
        t.turn = c.turn ?? null;
        this.leaveRoute(t);
        break;
      case 'turn':
        if (c.degrees <= 0 || c.degrees >= 360) return reject('invalid turn');
        t.headingTrue = normDeg(ac.headingTrue + (c.direction === 'right' ? c.degrees : -c.degrees));
        t.turn = c.direction;
        this.leaveRoute(t);
        break;
      case 'speed':
        if (c.mach !== undefined) {
          if (c.mach <= 0 || c.mach > perf.maxMach) return reject('Mach outside performance');
          t.mach = c.mach;
        } else if (c.casKt !== undefined) {
          if (c.casKt < perf.minCasKt || c.casKt > perf.maxCasKt) return reject('speed outside performance');
          t.casKt = c.casKt;
          t.mach = null;
        } else {
          return reject('no speed given');
        }
        break;
      case 'direct':
        if (!this.fixes.has(c.fix)) return reject(`unknown fix ${c.fix}`);
        // A fix further down the route shortcuts it; any other fix replaces the route.
        if (c.fix !== t.directFix) {
          const at = t.route.indexOf(c.fix);
          t.route = at >= 0 ? t.route.slice(at + 1) : [];
        }
        t.directFix = c.fix;
        t.headingTrue = null;
        t.turn = null;
        break;
      case 'squawk':
        if (!/^[0-7]{4}$/.test(c.code)) return reject('invalid squawk');
        ac.squawk = c.code;
        break;
      case 'resume_own_navigation':
        if (t.directFix) return reject('already on own navigation');
        if (t.route.length === 0) return reject('no route to resume');
        // Phase 0: direct to the next route fix. The FMS (Phase 4) will intercept the leg instead.
        t.directFix = t.route.shift()!;
        t.headingTrue = null;
        t.turn = null;
        break;
    }
    this.log({ t: this.time, type: 'clearance_applied', callsign: ac.callsign, clearance: c });
  }

  // ── Output ───────────────────────────────────────────────────────────────

  /** Current traffic plus the events since the previous snapshot. */
  snapshot(): Snapshot {
    const events = this.state.log.slice(this.state.snapshotCursor);
    this.state.snapshotCursor = this.state.log.length;
    return { t: this.time, aircraft: clone(this.state.aircraft), events: clone(events) };
  }

  get eventLog(): readonly SimEvent[] {
    return this.state.log;
  }

  /** Full serializable state (wind / rewind / reset / branch). */
  saveState(): SimState {
    this.state.rngState = this.rng.state;
    return clone(this.state);
  }

  /** Vectors: stop navigating, but keep the route so the aircraft can resume it. */
  private leaveRoute(t: AircraftState['target']): void {
    if (t.directFix) t.route.unshift(t.directFix);
    t.directFix = null;
  }

  private find(callsign: string): AircraftState | undefined {
    return this.state.aircraft.find((a) => a.callsign === callsign);
  }

  private log(e: SimEvent): void {
    this.state.log.push(e);
  }
}
