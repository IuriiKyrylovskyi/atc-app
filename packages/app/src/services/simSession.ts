/**
 * A running simulation session behind the scope.
 *
 * The sim lives in a Web Worker (main thread fallback where workers are not
 * available). The UI owns the clock: every radar sweep it asks the sim to
 * advance one sweep of sim time and draws the snapshot it gets back, so the
 * picture jumps once per sweep like a real terminal radar, and pause / sim rate
 * are just the sweep timer.
 */
import {
  createPortPair,
  serveSimulation,
  SimClient,
  type AircraftSpawn,
  type Message,
  type PortLike,
  type SimConfig,
  type Snapshot,
} from '@atc-app/sim';

/** ASR-9 terminal radar: one antenna revolution every 4.8 s. */
export const RADAR_SWEEP_S = 4.8;
export const SIM_RATES = [1, 2, 4, 8] as const;
export type SimRate = (typeof SIM_RATES)[number];

function workerPort(worker: Worker): PortLike {
  return {
    postMessage: (data) => worker.postMessage(data),
    onMessage(listener) {
      const handler = (e: MessageEvent) => listener(e.data);
      worker.addEventListener('message', handler);
      return () => worker.removeEventListener('message', handler);
    },
  };
}

export class SimSession {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private busy = false;
  private disposed = false;
  private rateValue: SimRate = 1;
  private pausedValue = false;

  private constructor(
    private readonly client: SimClient,
    private readonly onSnapshot: (s: Snapshot) => void,
    private readonly worker: Worker | null
  ) {}

  /** Starts a session: initialises the sim, schedules the traffic, draws t = 0. */
  static async start(
    config: SimConfig,
    traffic: readonly { atS: number; spawn: AircraftSpawn }[],
    onSnapshot: (s: Snapshot) => void
  ): Promise<SimSession> {
    let worker: Worker | null = null;
    let port: PortLike;
    if (typeof Worker !== 'undefined') {
      worker = new Worker(new URL('../workers/sim.worker.ts', import.meta.url), { type: 'module' });
      port = workerPort(worker);
    } else {
      const [ui, sim] = createPortPair();
      serveSimulation(sim);
      port = ui;
    }
    const session = new SimSession(new SimClient(port), onSnapshot, worker);
    await session.client.call({ op: 'init', config });
    for (const t of traffic) await session.client.call({ op: 'schedule', atS: t.atS, spawn: t.spawn });
    onSnapshot(await session.client.call({ op: 'snapshot' }));
    session.arm();
    return session;
  }

  get rate(): SimRate {
    return this.rateValue;
  }

  set rate(r: SimRate) {
    this.rateValue = r;
    this.arm();
  }

  get paused(): boolean {
    return this.pausedValue;
  }

  set paused(p: boolean) {
    this.pausedValue = p;
    this.arm();
  }

  issue(message: Message) {
    return this.client.call({ op: 'issue', message });
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.client.dispose();
    this.worker?.terminate();
  }

  /** (Re)starts the sweep timer for the current rate. */
  private arm(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.disposed || this.pausedValue) return;
    this.timer = setTimeout(() => void this.sweep(), (RADAR_SWEEP_S * 1000) / this.rateValue);
  }

  private async sweep(): Promise<void> {
    this.timer = null;
    if (this.busy || this.disposed) return;
    this.busy = true;
    try {
      const snap = await this.client.call({ op: 'advance', seconds: RADAR_SWEEP_S });
      if (!this.disposed) this.onSnapshot(snap);
    } catch (e) {
      if (!this.disposed) console.error('[sim] sweep failed', e);
    } finally {
      this.busy = false;
      if (!this.timer) this.arm();
    }
  }
}
