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
 * - A separation monitor runs every second of sim time: losses of separation
 *   and STCA predictions become events and are listed in every snapshot.
 * - No DOM, no timers: whoever owns the sim decides when to call `advance()`
 *   (a worker loop, the Academy server, or a test).
 */
import { magToTrue } from '../geo/magvar';
import type { LatLon } from '../geo/geodesy';
import { normDeg } from '../units';
import { performanceFor } from '../aircraft/performance';
import { stepAircraft, type Wind } from '../aircraft/dynamics';
import {
  ALERT_HOLD_S,
  assessPair,
  pairKey,
  TERMINAL_SEPARATION,
  type PairState,
  type SeparationConfig,
} from '../safety/separation';
import type {
  AircraftSpawn,
  Runway,
  Conflict,
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
  /** Separation minima and STCA look-ahead; default terminal 3 NM / 1 000 ft / 120 s. */
  separation?: Partial<SeparationConfig>;
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
  /** Pairs the separation monitor is alerting on. */
  conflicts: PairState[];
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
  readonly config: Readonly<Required<Omit<SimConfig, 'pack' | 'separation'>>> & {
    pack?: AirspacePack;
    separation: SeparationConfig;
  };
  private state: SimState;
  private rng: Rng;
  private readonly fixes = new Map<string, LatLon>();
  private readonly runways = new Map<string, Runway>();

  constructor(config: SimConfig, state?: SimState) {
    this.config = {
      seed: config.seed,
      pack: config.pack,
      stepS: config.stepS ?? DEFAULT_STEP_S,
      pilotDelayS: config.pilotDelayS ?? DEFAULT_PILOT_DELAY,
      wind: config.wind ?? CALM,
      magVar: config.pack?.meta.magVar ?? config.magVar ?? 0,
      separation: { ...TERMINAL_SEPARATION, ...config.separation },
    };
    for (const f of config.pack?.fixes ?? []) this.fixes.set(f.id, f.pos);
    for (const r of config.pack?.runways ?? []) this.runways.set(`${r.airport}|${r.id}`, r);
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
          conflicts: [],
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
    const landed: AircraftState[] = [];
    for (const ac of this.state.aircraft) {
      const approach = ac.target.approach;
      const res = stepAircraft(ac, {
        dtS: dt,
        perf: performanceFor(ac.icaoType, ac.wake),
        wind: this.config.wind,
        fixPos: (id) => this.fixes.get(id),
        runway: (airport, id) => this.runways.get(`${airport}|${id}`),
      });
      const at = this.time + dt;
      if (approach) {
        if (res.localizerCaptured) this.log({ t: at, type: 'localizer_captured', callsign: ac.callsign, runway: approach.runway });
        if (res.glideslopeCaptured) this.log({ t: at, type: 'glideslope_captured', callsign: ac.callsign, runway: approach.runway });
        if (res.landed) landed.push(ac);
        if (res.missed) this.goAround(ac, res.missed, at);
      }
      if (res.fixReached) {
        this.log({ t: this.time + dt, type: 'fix_reached', callsign: ac.callsign, fix: res.fixReached });
        if (res.routeEnded) this.log({ t: this.time + dt, type: 'route_ended', callsign: ac.callsign, fix: res.fixReached });
      }
    }
    this.state.step += 1;
    for (const ac of landed) {
      const a = ac.target.approach!;
      this.log({ t: this.time, type: 'landed', callsign: ac.callsign, airport: a.airport, runway: a.runway });
      this.removeAircraft(ac.callsign);
    }
    // After the step, so an aircraft scheduled at t is on the scope at t.
    this.spawnDue();
    if (this.state.step % Math.max(1, Math.round(1 / dt)) === 0) this.monitorSeparation();
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

  /** Missed approach: climb straight ahead on the runway course to 3 000 ft (or 2 000 ft above the field). */
  private goAround(ac: AircraftState, reason: string, at: number): void {
    const a = ac.target.approach!;
    const rwy = this.runways.get(`${a.airport}|${a.runway}`);
    const t = ac.target;
    delete t.approach;
    t.altFt = Math.max(3000, Math.ceil(((rwy?.thresholdElevFt ?? 0) + 2000) / 100) * 100);
    t.vsFpm = null;
    t.headingTrue = rwy?.ils?.courseTrue ?? rwy?.headingTrue ?? ac.headingTrue;
    t.turn = null;
    t.directFix = null;
    t.casKt = 180;
    this.log({ t: at, type: 'missed_approach', callsign: ac.callsign, airport: a.airport, runway: a.runway, reason });
  }

  removeAircraft(callsign: string): void {
    const before = this.state.aircraft.length;
    this.state.aircraft = this.state.aircraft.filter((a) => a.callsign !== callsign);
    if (this.state.aircraft.length !== before) {
      this.log({ t: this.time, type: 'aircraft_removed', callsign });
      for (const p of this.state.conflicts) {
        if (p.a === callsign || p.b === callsign) this.endPair(p);
      }
      this.state.conflicts = this.state.conflicts.filter((p) => p.a !== callsign && p.b !== callsign);
    }
  }

  // ── Separation ───────────────────────────────────────────────────────────

  private monitorSeparation(): void {
    const now = this.time;
    const cfg = this.config.separation;
    const acs = this.state.aircraft;
    const pairs = new Map(this.state.conflicts.map((p) => [`${p.a}|${p.b}`, p]));
    const seen = new Set<string>();

    for (let i = 0; i < acs.length; i++) {
      for (let j = i + 1; j < acs.length; j++) {
        const g = assessPair(acs[i]!, acs[j]!, cfg);
        if (!g.loss && g.inS === null) continue;
        const [a, b] = pairKey(acs[i]!.callsign, acs[j]!.callsign);
        const key = `${a}|${b}`;
        seen.add(key);
        const current: Conflict = {
          a,
          b,
          kind: g.loss ? 'loss' : 'predicted',
          inS: g.inS ?? 0,
          lateralNm: Math.round(g.lateralNm * 100) / 100,
          verticalFt: Math.round(g.verticalFt),
        };
        let p = pairs.get(key);
        if (!p) {
          p = {
            a, b, alertSince: now, lossSince: null, lastActive: now,
            minLateralNm: current.lateralNm, minVerticalFt: current.verticalFt, current,
          };
          this.state.conflicts.push(p);
          this.log({ t: now, type: 'conflict_alert', a, b, inS: current.inS });
        }
        p.lastActive = now;
        p.current = current;
        if (g.loss) {
          if (p.lossSince === null) {
            p.lossSince = now;
            p.minLateralNm = current.lateralNm;
            p.minVerticalFt = current.verticalFt;
            this.log({ t: now, type: 'separation_lost', a, b, lateralNm: current.lateralNm, verticalFt: current.verticalFt });
          }
          p.minLateralNm = Math.min(p.minLateralNm, current.lateralNm);
          p.minVerticalFt = Math.min(p.minVerticalFt, current.verticalFt);
        } else {
          this.restore(p);
        }
      }
    }

    const keep: PairState[] = [];
    for (const p of this.state.conflicts) {
      if (seen.has(`${p.a}|${p.b}`)) {
        keep.push(p);
        continue;
      }
      this.restore(p);
      if (now - p.lastActive >= ALERT_HOLD_S) this.log({ t: now, type: 'conflict_ended', a: p.a, b: p.b });
      else keep.push(p);
    }
    this.state.conflicts = keep;
  }

  private restore(p: PairState): void {
    if (p.lossSince === null) return;
    this.log({
      t: this.time, type: 'separation_restored', a: p.a, b: p.b,
      durationS: this.time - p.lossSince, minLateralNm: p.minLateralNm, minVerticalFt: p.minVerticalFt,
    });
    p.lossSince = null;
  }

  private endPair(p: PairState): void {
    this.restore(p);
    this.log({ t: this.time, type: 'conflict_ended', a: p.a, b: p.b });
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
      // "Turn left heading 220, maintain 3000 until established, cleared ILS": the vector and
      // the level come first, the approach clearance last (it must not be cancelled by them).
      const ordered = [...message.clearances].sort(
        (x, y) => Number(x.kind === 'approach') - Number(y.kind === 'approach')
      );
      for (const c of ordered) this.applyClearance(ac, c);
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
        // A new level breaks off the glideslope (before that it is "maintain … until established").
        if (t.approach?.phase === 'glideslope') delete t.approach;
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
        delete t.approach;
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
        delete t.approach;
        break;
      case 'approach': {
        const rwy = this.runways.get(`${c.airport}|${c.runway}`);
        if (!rwy) return reject(`no runway ${c.runway} at ${c.airport}`);
        if (!rwy.ils) return reject(`no ILS for runway ${c.runway}`);
        t.approach = { type: c.type, airport: c.airport, runway: c.runway, phase: 'armed' };
        break;
      }
    }
    this.log({ t: this.time, type: 'clearance_applied', callsign: ac.callsign, clearance: c });
  }

  // ── Output ───────────────────────────────────────────────────────────────

  /** Current traffic plus the events since the previous snapshot. */
  snapshot(): Snapshot {
    const events = this.state.log.slice(this.state.snapshotCursor);
    this.state.snapshotCursor = this.state.log.length;
    return {
      t: this.time,
      aircraft: clone(this.state.aircraft),
      conflicts: this.state.conflicts.map((p) => ({ ...p.current })),
      events: clone(events),
    };
  }

  get eventLog(): readonly SimEvent[] {
    return this.state.log;
  }

  /** Full serializable state (wind / rewind / reset / branch). */
  saveState(): SimState {
    this.state.rngState = this.rng.state;
    return clone(this.state);
  }

  /** Vectors: stop navigating (and flying any approach), but keep the route so the aircraft can resume it. */
  private leaveRoute(t: AircraftState['target']): void {
    if (t.directFix) t.route.unshift(t.directFix);
    t.directFix = null;
    delete t.approach;
  }

  private find(callsign: string): AircraftState | undefined {
    return this.state.aircraft.find((a) => a.callsign === callsign);
  }

  private log(e: SimEvent): void {
    this.state.log.push(e);
  }
}
